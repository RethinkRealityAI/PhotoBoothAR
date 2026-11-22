/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * openGesture — how each design asks to be opened, in the language of its art.
 *
 *   trace  window-shaped gates (iris): run a finger round the shape (traceOpen.ts)
 *   hold   doors, seals and lifting walls: press and hold the seal in the middle;
 *          a ring of light fills round it, the doors strain open a crack as it
 *          fills, and a buzz marks the moment it gives
 *   pull   drapes, cloth, leaves and clouds: drag outwards and the two halves
 *          follow the finger; let go past halfway and they glide the rest of the
 *          way, short of it and they settle back
 *
 * Every gesture has a one-press fallback (keyboard, switch access, a hurry).
 * Pure: the component turns pointer events into numbers and asks these
 * functions what the gate should look like and whether it opens.
 */
import { cardDesign, type CardDesignId, type GatewayKind } from './cardDesigns';

export type OpenGesture = 'trace' | 'hold' | 'pull';

export const GESTURE_FOR_KIND: Record<GatewayKind, OpenGesture> = {
  iris: 'trace',
  doors: 'hold',
  rise: 'hold',
  slide: 'pull',
};

export function gestureFor(id: CardDesignId): OpenGesture {
  return GESTURE_FOR_KIND[cardDesign(id).gateway.kind];
}

/** What the prompt says, in the design's own words. */
export const OPEN_HINT: Record<CardDesignId, string> = {
  'garden-gate': 'Hold the gate to open it',
  'balloon-bash': 'Hold to pop the balloons',
  'gala-night': 'Hold the seal to open',
  owambe: 'Pull the cloth apart',
  'city-lights': 'Hold to open the shutters',
  'moon-gate': 'Trace the circle to open',
  'cloud-nine': 'Part the clouds',
  'grand-hall': 'Hold the seal to open',
  'island-sunset': 'Part the palm leaves',
  'love-notes': 'Trace the heart to open',
  'festival-of-lights': 'Hold to open the doors',
  'crescent-night': 'Trace the arch to open',
  'golden-hour': 'Hold to lift the drapes',
  'jungle-party': 'Pull the leaves apart',
  'winter-glow': 'Trace the arch to open',
  'balloon-release': 'Hold to let the balloons go',
  showtime: 'Pull the curtains apart',
};

/* ------------------------------------------------------------------ */
/* hold                                                                */
/* ------------------------------------------------------------------ */

/** How long a full hold takes. Long enough to feel deliberate, short enough not to tire. */
export const HOLD_MS = 950;
/** How far into the opening timeline a full hold has pushed the gate (a crack). */
export const HOLD_CRACK_T = 0.05;

/** Hold progress 0..1 after `ms` of pressing (clamped, NaN-safe). */
export function holdProgress(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(1, ms / HOLD_MS);
}

/** A released hold drains back at twice the speed it filled. */
export function holdDrain(progress: number, msSinceRelease: number): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  if (!Number.isFinite(msSinceRelease) || msSinceRelease <= 0) return Math.min(1, progress);
  return Math.max(0, Math.min(1, progress) - msSinceRelease / (HOLD_MS / 2));
}

/** Opening-timeline position for a hold progress: eased, so the doors give slowly then more. */
export function holdT(progress: number): number {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return HOLD_CRACK_T * p * p;
}

/* ------------------------------------------------------------------ */
/* pull                                                                */
/* ------------------------------------------------------------------ */

/** A drag of this share of the stage's width counts as a full pull. */
export const PULL_FULL_SHARE = 0.3;
/** Let go past this and it opens. */
export const PULL_OPEN_AT = 0.5;
/** How open (0..1 of the gateway's travel) a full pull leaves the halves. */
export const PULL_MAX_OPEN = 0.5;
/**
 * The opening timeline eases its gate in (sceneFrame: open = easeInOut over
 * t 0..0.55, cubic). Driving it with raw t would make the halves lag the
 * finger and then lurch; inverting the ease keeps them moving WITH the finger.
 */
function tForOpen(o: number): number {
  const c = Math.max(0, Math.min(1, o));
  const x = c < 0.5 ? Math.cbrt(c / 4) : 1 - Math.cbrt(2 * (1 - c)) / 2;
  return 0.55 * x;
}
/** How far into the opening timeline a full pull reaches. */
export const PULL_MAX_T = tForOpen(PULL_MAX_OPEN);
/** Spring-back time when let go short. */
export const PULL_SETTLE_MS = 320;

/**
 * Pull progress from the finger's horizontal travel. Either direction pulls
 * (one finger drags one half; the other follows), so it is the distance that
 * counts. Vertical travel is ignored, so a scroll-ish wobble does nothing.
 */
export function pullProgress(dx: number, stageWidth: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(stageWidth) || stageWidth <= 0) return 0;
  return Math.min(1, Math.abs(dx) / (stageWidth * PULL_FULL_SHARE));
}

export function pullT(progress: number): number {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return tForOpen(PULL_MAX_OPEN * p);
}

export function pullOpens(progress: number): boolean {
  return Number.isFinite(progress) && progress >= PULL_OPEN_AT;
}

/** Progress while settling back after a short pull (ease-out to 0). */
export function pullSettle(from: number, ms: number): number {
  const f = Number.isFinite(from) ? Math.max(0, Math.min(1, from)) : 0;
  if (!Number.isFinite(ms) || ms <= 0) return f;
  const k = Math.min(1, ms / PULL_SETTLE_MS);
  return f * (1 - k) ** 3;
}
