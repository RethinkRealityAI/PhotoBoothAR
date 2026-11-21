/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Booth viewport lock — keeps the platform booth inside the phone's real
 * visible viewport on iOS.
 *
 * Why this exists: index.html deliberately omits `maximum-scale` (WCAG 1.4.4
 * — the rest of the site stays zoomable), and iOS ignores `user-scalable=no`
 * anyway. The AppShell is `h-screen` (100vh), which on iOS Safari is the
 * LARGE viewport, taller than what is visible while the toolbars show — so
 * the document could scroll by that difference, a pinch zoomed the whole
 * booth, a double-tap zoomed it, and focusing a 14px input auto-zoomed it.
 * A camera screen must not move under the guest's thumb.
 *
 * While a lock is held:
 *   · html/body cannot scroll or rubber-band (overflow hidden, overscroll
 *     none, body pinned `position: fixed; inset: 0` — the iOS-proof form);
 *   · with `zoom: true`, iOS's proprietary `gesture*` events and any
 *     multi-touch `touchmove` are cancelled (pinch), and a second quick tap
 *     on NON-interactive surface is cancelled (double-tap zoom) — buttons are
 *     never touched, so two fast taps on a control both land;
 *   · `html[data-viewport-lock]` is set, which src/index.css uses to lift
 *     every input to 16px (iOS zooms on focus below that) — including inputs
 *     in dialogs portalled outside the booth root;
 *   · when a field loses focus the page is scrolled back to the top, because
 *     iOS scrolls the layout viewport to reveal the keyboard and leaves it.
 * Everything is restored exactly on release, and locks nest (ref-counted),
 * so a StrictMode double-mount or an overlapping route change cannot leave
 * the document frozen.
 *
 * DOM access goes through the minimal interfaces below so the whole thing is
 * testable in vitest's node environment with plain fakes.
 */
import { useEffect } from 'react';

/** Inline styles applied while locked, per element. */
export const LOCK_STYLES = {
  html: { overflow: 'hidden', 'overscroll-behavior': 'none' },
  body: {
    overflow: 'hidden',
    'overscroll-behavior': 'none',
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    width: '100%',
  },
} as const;

export const LOCK_ATTR = 'data-viewport-lock';

/** Two taps closer together than this (ms, px) are a double-tap. */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 32;

/** Targets whose own taps must never be cancelled. */
export const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, summary, [role="button"], [role="switch"], [role="tab"], [role="slider"], [contenteditable="true"]';

/** A pinch is any touch move with more than one finger down. */
export function shouldBlockTouchMove(touchCount: number): boolean {
  return touchCount > 1;
}

export interface TapPoint { t: number; x: number; y: number }

/**
 * True when `next` completes a double-tap that the browser would turn into a
 * zoom — and only on non-interactive surface (a control's second tap is a
 * real tap the guest meant).
 */
export function isDoubleTapZoom(prev: TapPoint | null, next: TapPoint, interactive: boolean): boolean {
  if (interactive || prev === null) return false;
  const dt = next.t - prev.t;
  if (dt < 0 || dt > DOUBLE_TAP_MS) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX;
}

/* ── Minimal DOM shapes (real DOM satisfies them; tests pass fakes) ───── */

export interface LockStyle {
  getPropertyValue(name: string): string;
  getPropertyPriority(name: string): string;
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): string;
}
export interface LockElement {
  style: LockStyle;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}
type Listener = (e: never) => void;
export interface LockDocument {
  documentElement: LockElement;
  body: LockElement | null;
  addEventListener(type: string, fn: Listener, opts?: AddEventListenerOptions): void;
  removeEventListener(type: string, fn: Listener, opts?: EventListenerOptions): void;
}
export interface LockWindow {
  scrollTo(x: number, y: number): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface ViewportLockOptions {
  /** Also block pinch and double-tap zoom (the booth). False = scroll only. */
  zoom: boolean;
}

interface TouchLike {
  touches?: { length: number };
  changedTouches?: { length: number; [i: number]: { clientX: number; clientY: number } | undefined };
  target?: unknown;
  timeStamp?: number;
  cancelable?: boolean;
  preventDefault(): void;
}

function isInteractive(target: unknown): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null;
  if (el === null || typeof el !== 'object' || typeof el.closest !== 'function') return false;
  try {
    return el.closest(INTERACTIVE_SELECTOR) !== null;
  } catch {
    return false;
  }
}

/* ── Ref-counted lock ─────────────────────────────────────────────────── */

let depth = 0;
let zoomDepth = 0;
let saved: { el: LockElement; name: string; value: string; priority: string }[] = [];
let releaseListeners: (() => void) | null = null;
let releaseZoomListeners: (() => void) | null = null;

function applyStyles(el: LockElement, styles: Record<string, string>) {
  for (const [name, value] of Object.entries(styles)) {
    saved.push({ el, name, value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) });
    el.style.setProperty(name, value);
  }
}

function addScrollListeners(doc: LockDocument, win: LockWindow): () => void {
  let pending: number | null = null;
  // iOS scrolls the layout viewport up to clear the keyboard and leaves it
  // there; put the booth back once the field lets go.
  const onFocusOut = () => {
    if (pending !== null) win.clearTimeout(pending);
    pending = win.setTimeout(() => { pending = null; win.scrollTo(0, 0); }, 60);
  };
  doc.addEventListener('focusout', onFocusOut as Listener);
  return () => {
    if (pending !== null) win.clearTimeout(pending);
    doc.removeEventListener('focusout', onFocusOut as Listener);
  };
}

function addZoomListeners(doc: LockDocument): () => void {
  const block = (e: TouchLike) => { if (e.cancelable !== false) e.preventDefault(); };
  const onTouchMove = (e: TouchLike) => {
    if (shouldBlockTouchMove(e.touches?.length ?? 0)) block(e);
  };
  let lastTap: TapPoint | null = null;
  const onTouchEnd = (e: TouchLike) => {
    // A finger still down means this was part of a multi-touch, not a tap.
    if ((e.touches?.length ?? 0) > 0) { lastTap = null; return; }
    const p = e.changedTouches?.[0];
    if (!p) return;
    const tap: TapPoint = { t: e.timeStamp ?? Date.now(), x: p.clientX, y: p.clientY };
    if (isDoubleTapZoom(lastTap, tap, isInteractive(e.target))) {
      block(e);
      lastTap = null;
      return;
    }
    lastTap = tap;
  };
  const opts: AddEventListenerOptions = { passive: false };
  const gestures = ['gesturestart', 'gesturechange', 'gestureend'] as const;
  for (const g of gestures) doc.addEventListener(g, block as Listener, opts);
  doc.addEventListener('touchmove', onTouchMove as Listener, opts);
  doc.addEventListener('touchend', onTouchEnd as Listener, opts);
  return () => {
    for (const g of gestures) doc.removeEventListener(g, block as Listener, opts);
    doc.removeEventListener('touchmove', onTouchMove as Listener, opts);
    doc.removeEventListener('touchend', onTouchEnd as Listener, opts);
  };
}

/**
 * Take a lock. Returns its release; calling a release twice is harmless.
 * The first lock saves and applies the styles; the last release restores
 * them. Zoom blocking is held while ANY zoom lock is.
 */
export function lockViewport(doc: LockDocument, win: LockWindow, opts: ViewportLockOptions): () => void {
  if (depth === 0) {
    saved = [];
    applyStyles(doc.documentElement, LOCK_STYLES.html);
    if (doc.body) applyStyles(doc.body, LOCK_STYLES.body);
    doc.documentElement.setAttribute(LOCK_ATTR, '');
    releaseListeners = addScrollListeners(doc, win);
    win.scrollTo(0, 0);
  }
  depth += 1;
  if (opts.zoom) {
    if (zoomDepth === 0) releaseZoomListeners = addZoomListeners(doc);
    zoomDepth += 1;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (opts.zoom) {
      zoomDepth -= 1;
      if (zoomDepth === 0) { releaseZoomListeners?.(); releaseZoomListeners = null; }
    }
    depth -= 1;
    if (depth > 0) return;
    releaseListeners?.();
    releaseListeners = null;
    // Restore in reverse so a property set twice unwinds to the original.
    for (const s of saved.reverse()) {
      if (s.value === '') s.el.style.removeProperty(s.name);
      else s.el.style.setProperty(s.name, s.value, s.priority);
    }
    saved = [];
    doc.documentElement.removeAttribute(LOCK_ATTR);
  };
}

/**
 * The booth refinements in this lane are for PLATFORM events only: a DB-backed
 * event (`source === 'db'`) in a platform build. A `VITE_EVENT` legacy build is
 * excluded even if its event somehow resolved from the DB — those three sites
 * are frozen.
 */
export function isPlatformBooth(
  source: string | undefined,
  legacyEvent: string = ((import.meta.env?.VITE_EVENT as string | undefined) ?? ''),
): boolean {
  return source === 'db' && legacyEvent.trim() === '';
}

/** Test seam: the current nesting depth. */
export function _lockDepth(): { depth: number; zoomDepth: number } {
  return { depth, zoomDepth };
}

/**
 * Hold a viewport lock while mounted and `enabled`. Callers gate `enabled` on
 * a platform event (`source === 'db'`) so legacy builds are untouched.
 */
export function useViewportLock(enabled: boolean, zoom: boolean): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined' || typeof window === 'undefined') return;
    return lockViewport(document as unknown as LockDocument, window as unknown as LockWindow, { zoom });
  }, [enabled, zoom]);
}
