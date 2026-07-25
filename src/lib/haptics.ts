/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Haptic feedback for touch interactions.
 *
 * IMPORTANT, AND NOT A BUG WE CAN FIX: `navigator.vibrate` is unsupported on
 * iOS Safari — every iPhone, in every browser, since they all use WebKit.
 * Android Chrome supports it. So haptics are an ENHANCEMENT layered on top of
 * feedback that works everywhere: every control that calls `haptic()` also
 * carries the `.pressable` class, whose visual depress is what an iPhone user
 * actually perceives. Never make a haptic the only signal that something
 * happened.
 *
 * Patterns are deliberately short. A vibration long enough to notice
 * consciously reads as a malfunction; 8-20ms reads as physical.
 */

export type HapticKind =
  /** Light acknowledgement — nav taps, chips, menu opens. */
  | 'tap'
  /** A choice landed — filter/frame/3D orb, category tab. */
  | 'select'
  /** A binary flipped — mode switch, toggle. */
  | 'toggle'
  /** The shutter fired. The one moment worth a firmer thud. */
  | 'capture'
  /** Something completed — sent to the wall, saved. */
  | 'success'
  /** Something failed. The only double-buzz, because it must feel wrong. */
  | 'error';

/**
 * Vibration pattern in milliseconds, as `navigator.vibrate` expects: odd
 * indices are pauses. Pure, so the shape of the feedback is testable without
 * a device.
 */
export function hapticPattern(kind: HapticKind): number[] {
  switch (kind) {
    case 'tap':
      return [8];
    case 'select':
      return [12];
    case 'toggle':
      return [10, 30, 10];
    case 'capture':
      return [20];
    case 'success':
      return [12, 40, 18];
    case 'error':
      return [26, 60, 26];
  }
}

const STORAGE_KEY = 'beamwall:haptics';

/** Cached so a tap doesn't hit localStorage; `null` = not yet read. */
let enabledCache: boolean | null = null;

/** Haptics are on by default; guests never see a setup step for them. */
export function hapticsEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  try {
    enabledCache = localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    enabledCache = true; // storage unavailable (private mode) — default on
  }
  return enabledCache;
}

export function setHapticsEnabled(on: boolean): void {
  enabledCache = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // preference is best-effort; the in-memory value still applies this session
  }
}

/** Someone who asks for less motion is also asking for less buzzing. */
function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Fire a haptic. Silently does nothing when unsupported, disabled, or when the
 * user prefers reduced motion — callers never need to check.
 */
export function haptic(kind: HapticKind): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (!hapticsEnabled() || reducedMotion()) return;
  try {
    navigator.vibrate(hapticPattern(kind));
  } catch {
    // some browsers throw when the page is not visible/focused — never fatal
  }
}
