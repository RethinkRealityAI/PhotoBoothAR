/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Viewfinder gestures + orientation, as pure functions.
 *
 * The booth's viewfinder had no gestures at all, which is below the baseline a
 * guest brings from Instagram/Snapchat: swipe sideways to change the look,
 * double-tap to flip the camera. Both are decided here so the component only
 * has to feed in coordinates and timestamps — the thresholds are the whole
 * design and they deserve tests, not a code review of an event handler.
 */

export type SwipeDirection = 'left' | 'right';

export interface PointerSample {
  x: number;
  y: number;
  /** performance.now()-style milliseconds. */
  t: number;
}

/** Minimum horizontal travel, in CSS px, before a drag counts as a swipe. */
export const SWIPE_MIN_PX = 48;
/** A swipe must be mostly horizontal: |dx| must beat |dy| by this factor. */
export const SWIPE_AXIS_RATIO = 1.6;
/** Slower than this and it is a drag, not a flick. */
export const SWIPE_MAX_MS = 700;

/**
 * Classify a pointer down→up pair.
 *
 * Returns null for taps, vertical drags (which must stay available for the
 * browser's own scroll/overscroll) and slow drags. `'left'` means the finger
 * moved leftwards, i.e. "bring me the NEXT one" — the same polarity as a
 * carousel.
 */
export function detectSwipe(start: PointerSample, end: PointerSample): SwipeDirection | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dt = end.t - start.t;
  if (dt > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return null;
  return dx < 0 ? 'left' : 'right';
}

/** Two taps closer than this in time count as one double-tap. */
export const DOUBLE_TAP_MS = 320;
/** …and closer than this in space, so two deliberate taps in two places don't. */
export const DOUBLE_TAP_PX = 44;

/**
 * True when `tap` completes a double-tap started at `previous`.
 *
 * `previous` is null on the first tap of a session — an explicit null rather
 * than a sentinel timestamp, because 0 is a legitimate `performance.now()`
 * value on a freshly-loaded page and a truthiness check would drop it.
 */
export function isDoubleTap(previous: PointerSample | null, tap: PointerSample): boolean {
  if (previous === null) return false;
  if (tap.t - previous.t > DOUBLE_TAP_MS) return false;
  return Math.hypot(tap.x - previous.x, tap.y - previous.y) <= DOUBLE_TAP_PX;
}

/**
 * Step through a list with wraparound, including the "nothing selected" slot.
 *
 * The filter row is `[none, ...filters]` from the guest's point of view: a
 * swipe past the last filter must land back on the untouched camera, not stick.
 * `index` is -1 for "none". Returns the new index in the same encoding.
 *
 * An empty list always yields -1 — swiping on an event with no filters is a
 * no-op rather than a modulo-by-zero NaN.
 */
export function cycleIndex(index: number, count: number, direction: SwipeDirection): number {
  if (count <= 0) return -1;
  // Map [-1..count-1] onto [0..count] so the wrap is a plain modulo.
  const slots = count + 1;
  const cur = index + 1;
  const delta = direction === 'left' ? 1 : -1;
  const next = (cur + delta + slots) % slots;
  return next - 1;
}

/**
 * True when the viewport is landscape AND too short to lay the booth out
 * honestly.
 *
 * The stage is a fixed 9:16 box and the capture buffer is 1080x1920 by
 * construction (StageCanvas CAPTURE_W/H) — a phone held sideways therefore
 * still produces a PORTRAIT photo. Below this height the 9:16 stage collapses
 * to a sliver and the control deck overlaps it, so the guest is framing a shot
 * against a frame they cannot see. 520px is the threshold because a 390x844
 * phone rotated is 844x390, and a small tablet (1024x768) stays comfortably
 * above it — a tablet in landscape has the height to lay out properly and must
 * NOT be nagged.
 */
export const CRAMPED_LANDSCAPE_MAX_H = 520;

export function isCrampedLandscape(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return width > height && height <= CRAMPED_LANDSCAPE_MAX_H;
}
