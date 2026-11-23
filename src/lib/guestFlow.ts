/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The guest's path from /welcome into the camera, and the screen after a send.
 * Pure (no React, no storage globals) so every rule here is unit-tested.
 *
 * Platform events only — every caller gates on a db-sourced event, so coded
 * legacy events keep their splash, five-step intro and footer exactly.
 */

/** Router state the welcome page's booth CTA navigates with. */
export const FROM_WELCOME_STATE = Object.freeze({ fromWelcome: true as const });

/**
 * Skip the booth's "Step inside" splash? Only on a platform event, and only
 * when the guest arrived by tapping the welcome page's booth CTA (which shows
 * the same camera/privacy line). Opening /booth directly — a QR printed to
 * the booth, a bookmark, a shared link — still gets the splash.
 */
export function skipBoothSplash(platform: boolean, routerState: unknown): boolean {
  if (!platform) return false;
  if (typeof routerState !== 'object' || routerState === null) return false;
  return (routerState as { fromWelcome?: unknown }).fromWelcome === true;
}

/* ── First-run camera hint (replaces the five-slide intro on platform) ── */

/** Versioned so a reworded hint can be shown again without clearing anything. */
export const CAMERA_HINT_KEY = 'beamwall.booth.cameraHint.v1';
export const CAMERA_HINT_COPY =
  'Tap a look below, then the big button. Your photo goes to the live wall when you send it.';

/**
 * Has this device already seen the hint? Storage that is missing or throws
 * (private mode, blocked site data, some webviews) reads as NOT seen: it is
 * one dismissible line, and showing it once per visit beats never.
 */
export function cameraHintSeen(storage: Pick<Storage, 'getItem'> | null): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(CAMERA_HINT_KEY) !== null;
  } catch {
    return false;
  }
}

/** Best effort: a failed write only means the hint may show once more. */
export function markCameraHintSeen(storage: Pick<Storage, 'setItem'> | null): void {
  if (storage === null) return;
  try {
    storage.setItem(CAMERA_HINT_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

/** `localStorage`, or null where touching it throws. */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/* ── Send-off footer ─────────────────────────────────────────────────── */

/**
 * The lines under the "Sent!" screen. A platform event's eyebrow defaults to
 * the event's own name (events/runtime.ts), so printing both showed the name
 * twice. Same text (ignoring case and spacing) = one line; a host who set a
 * distinct eyebrow keeps both. Blank lines are dropped.
 */
export function sendOffFooterLines(eyebrow: string, eventName: string): string[] {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const a = eyebrow.trim();
  const b = eventName.trim();
  if (a === '') return b === '' ? [] : [b];
  if (b === '' || norm(a) === norm(b)) return [a];
  return [a, b];
}
