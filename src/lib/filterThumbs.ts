/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live filter-thumbnail scheduling — the pure half of the "each orb shows YOUR
 * face through THAT filter" feature.
 *
 * Every effect orb used to be a static Tailwind gradient with a generic
 * sparkle glyph, so "Prismatic Holo" and "Aurora Lumina" were indistinguishable
 * until you applied them one at a time. The fix is a tiny live preview per orb.
 *
 * The whole risk of that idea is COST, so the cost decisions live here where
 * they are visible and tested rather than buried in a rAF callback:
 *
 *   • ONE shared WebGL context, never one per orb. The renderer round-robins:
 *     exactly one shader is drawn per tick, so the per-tick cost is constant no
 *     matter how many filters the event has.
 *   • A 96px square target. That is 9,216 pixels — 0.7% of the 720x1280 preview
 *     canvas the booth already shades every frame.
 *   • A slow cadence, and it is a CADENCE not a frame loop: the thumbnails are
 *     an identification aid, not an animation. `THUMB_TICK_MS` is the interval
 *     between single-shader draws.
 *   • It refuses to run at all unless the orbs are actually on screen and
 *     everything else is healthy (`thumbsEnabled`).
 */

/** Edge length of the shared thumbnail buffer, in device-independent pixels. */
export const THUMB_PX = 96;

/**
 * Milliseconds between single-shader draws. 8 draws/second total, so an event
 * with 8 filters refreshes every orb about once a second — fast enough to look
 * live when you move, far too slow to matter to the frame budget.
 */
export const THUMB_TICK_MS = 125;

export interface ThumbGateInputs {
  /** A shared ShaderRunner reported `available` (WebGL got a context). */
  webgl: boolean;
  /** The camera is streaming and the <video> has decodable frames. */
  cameraReady: boolean;
  /** matchMedia('(prefers-reduced-motion: reduce)'). */
  reducedMotion: boolean;
  /** document.hidden — a backgrounded tab must not spin the GPU. */
  documentHidden: boolean;
  /** At least one orb is mounted and visible (the Effect tab, or the open
   *  "All filters" sheet). Zero subscribers ⇒ nothing to paint. */
  subscribers: number;
}

/**
 * The single decision point for whether the thumbnail renderer may run.
 *
 * Every one of these is a DEGRADE-TO-GRADIENT condition, not an error: the orb
 * keeps the static gradient it has today, which is exactly the pre-existing
 * behaviour. That is why this returns a boolean and never throws.
 */
export function thumbsEnabled(i: ThumbGateInputs): boolean {
  if (!i.webgl) return false;
  if (!i.cameraReady) return false;
  if (i.reducedMotion) return false;
  if (i.documentHidden) return false;
  return i.subscribers > 0;
}

/**
 * Next index in the round-robin.
 *
 * Guards an empty list explicitly: `(i + 1) % 0` is NaN, which would poison the
 * index for the rest of the session rather than failing loudly.
 */
export function nextThumbIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return (current + 1) % total;
}

/**
 * Whether enough time has passed to draw the next thumbnail.
 *
 * `last` is null before the first draw — an explicit null, because 0 is a real
 * `performance.now()` reading on a fresh page and a truthiness test would treat
 * it as "never drawn" forever.
 */
export function shouldTick(last: number | null, now: number, intervalMs = THUMB_TICK_MS): boolean {
  if (last === null) return true;
  return now - last >= intervalMs;
}
