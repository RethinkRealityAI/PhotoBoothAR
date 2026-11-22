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
 *   pop    a wall of balloons: tap them to pop them; once most are popped the
 *          rest float away
 *   bolts  a jewel box: slide its three gold bolts aside, each clicks open
 *   turn   a porthole: turn its brass wheel and the window cracks open with it
 *
 * A design can ask for any of these (CardDesign.gesture); otherwise its
 * gateway kind decides.
 *
 * Every gesture has a one-press fallback (keyboard, switch access, a hurry).
 * Pure: the component turns pointer events into numbers and asks these
 * functions what the gate should look like and whether it opens.
 */
import { cardDesign, type CardDesignId, type GatewayKind } from './cardDesigns';

export type OpenGesture = 'trace' | 'hold' | 'pull' | 'pop' | 'bolts' | 'turn';

export const GESTURE_FOR_KIND: Record<GatewayKind, OpenGesture> = {
  iris: 'trace',
  doors: 'hold',
  rise: 'hold',
  slide: 'pull',
};

export function gestureFor(id: CardDesignId): OpenGesture {
  const d = cardDesign(id);
  return d.gesture ?? GESTURE_FOR_KIND[d.gateway.kind];
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
  'pop-party': 'Pop the balloons',
  'jewel-box': 'Slide the bolts to open',
  'deep-blue': 'Turn the wheel to open',
};

/** The prompt when the host asked for the initials instead. */
export const INITIALS_HINT = 'Trace your initials to open';

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

/* ------------------------------------------------------------------ */
/* pop                                                                 */
/* ------------------------------------------------------------------ */

/** A tap pops every balloon whose centre is this close (stage units). */
export const POP_RADIUS = 150;
/** Share of the reachable balloons that opens it (the rest float away). */
export const POP_OPEN_AT = 0.7;
/** Balloons a finger can reach on a phone (the stage is cropped at the sides). */
export const POP_REACH = { x0: 90, x1: 810, y0: 40, y1: 1560 } as const;

export function popTargets(pieces: ReadonlyArray<{ x: number; y: number }>): number[] {
  const out: number[] = [];
  pieces.forEach((p, i) => {
    if (p.x >= POP_REACH.x0 && p.x <= POP_REACH.x1 && p.y >= POP_REACH.y0 && p.y <= POP_REACH.y1) out.push(i);
  });
  return out;
}

/** The balloons a tap at `at` pops (not already popped), nearest first. */
export function popAt(
  pieces: ReadonlyArray<{ x: number; y: number }>,
  popped: ReadonlySet<number>,
  at: { x: number; y: number },
  radius = POP_RADIUS,
): number[] {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return [];
  return pieces
    .map((p, i) => ({ i, d: Math.hypot(p.x - at.x, p.y - at.y) }))
    .filter((q) => q.d <= radius && !popped.has(q.i))
    .sort((a, b) => a.d - b.d)
    .map((q) => q.i);
}

/** How many reachable balloons are still to pop before it opens. */
export function popsLeft(targets: readonly number[], popped: ReadonlySet<number>): number {
  const need = Math.ceil(targets.length * POP_OPEN_AT);
  const done = targets.reduce((n, i) => n + (popped.has(i) ? 1 : 0), 0);
  return Math.max(0, need - done);
}

/* ------------------------------------------------------------------ */
/* bolts                                                               */
/* ------------------------------------------------------------------ */

/** The three bolts across the jewel box's seam, in stage space. dir: which way it slides open. */
export const BOLTS: ReadonlyArray<{ y: number; dir: -1 | 1 }> = [
  { y: 560, dir: -1 },
  { y: 800, dir: 1 },
  { y: 1040, dir: -1 },
];
/** How far a bolt slides to clear the seam (stage units). */
export const BOLT_TRAVEL = 150;
/** Let go past this and it clicks open; short of it, it slides back. */
export const BOLT_CLICK_AT = 0.7;
/** How far into the opening timeline each open bolt lets the doors give. */
export const BOLT_CRACK_T = 0.012;

/** Bolt progress 0..1 from the finger's horizontal travel (stage units). */
export function boltProgress(dx: number, dir: -1 | 1): number {
  if (!Number.isFinite(dx)) return 0;
  return Math.max(0, Math.min(1, (dx * dir) / BOLT_TRAVEL));
}

/** A flick counts: a release is carried this far ahead (ms) at the bolt's speed. */
export const BOLT_FLICK_MS = 140;

/**
 * Where a released bolt settles: open (1) or back home (0). `velocity` is the
 * bolt's speed toward open at release (progress per ms), so a quick flick
 * opens it without dragging all the way to the catch.
 */
export function boltRelease(p: number, velocity = 0): 0 | 1 {
  if (!Number.isFinite(p)) return 0;
  const v = Number.isFinite(velocity) ? Math.max(0, velocity) : 0;
  return p + v * BOLT_FLICK_MS >= BOLT_CLICK_AT ? 1 : 0;
}

/**
 * Release speed from the last moves (progress or radians per ms): a smoothed
 * average, and zero when the finger had stopped before letting go.
 */
export const RELEASE_STALE_MS = 90;
export function blendVelocity(prev: number, delta: number, dtMs: number): number {
  if (!Number.isFinite(delta) || !Number.isFinite(dtMs) || dtMs <= 0) return Number.isFinite(prev) ? prev : 0;
  const v = delta / Math.max(8, dtMs);
  const p = Number.isFinite(prev) ? prev : 0;
  return p * 0.6 + v * 0.4;
}

/* ------------------------------------------------------------------ */
/* turn                                                                */
/* ------------------------------------------------------------------ */

/** How far round the wheel turns to open (radians; either way round). */
export const TURN_FULL = (330 * Math.PI) / 180;
/** Samples this close to the hub are ignored (the angle is meaningless there). */
export const TURN_DEADZONE = 36;
/** How far into the opening timeline a full turn has cracked the window. */
export const TURN_CRACK_T = 0.06;

/** The signed change of angle between two samples, unwrapped to (-pi, pi]. */
export function turnDelta(prev: number, next: number): number {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return 0;
  let d = next - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Turn progress 0..1 from the accumulated angle (either direction). */
export function turnProgress(acc: number): number {
  if (!Number.isFinite(acc)) return 0;
  return Math.min(1, Math.abs(acc) / TURN_FULL);
}

/** Fastest spin a flick can give the wheel (radians per ms, ~1700 deg/s). */
export const TURN_MAX_SPIN = 0.03;
/** How quickly a spinning wheel slows once let go (per ms, exponential). */
export const TURN_FRICTION = 0.004;

/** The wheel's spin after coasting dtMs; settles to 0 once it is barely moving. */
export function turnCoast(spin: number, dtMs: number): number {
  if (!Number.isFinite(spin) || !Number.isFinite(dtMs) || dtMs <= 0) return 0;
  const s = Math.max(-TURN_MAX_SPIN, Math.min(TURN_MAX_SPIN, spin)) * Math.exp(-TURN_FRICTION * dtMs);
  return Math.abs(s) < 0.0002 ? 0 : s;
}

/** Opening-timeline position for a turn: the window cracks as the wheel turns. */
export function turnT(progress: number): number {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return TURN_CRACK_T * p * p;
}
