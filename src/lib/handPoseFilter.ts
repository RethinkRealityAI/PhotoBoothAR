/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE filtered hand pose per hand inference, shared by every consumer — PURE
 * maths (no three.js, no MediaPipe), colocated tests.
 *
 * Why shared: HandRig and HandOccluder each used to solve the pose themselves,
 * and they disagreed. Each HandRig ran its own One-Euro filters and its own
 * palm-span lock; HandOccluder ran NEITHER (unfiltered, unlocked span), so the
 * depth-only hand shell sat at a different depth and a different lag from the
 * gear it was meant to wrap — and every extra hand piece paid for another solve
 * and another set of filters. handRig.ts now owns one HandPoseTracker and every
 * consumer reads the same SharedHandPose.
 *
 * Filtering (the constants HandRig shipped with, unchanged):
 *  - depth gets its own heavy filter (≈5× noisier than x/y, least visible);
 *  - orientation a quaternion One-Euro;
 *  - x/y per LANDMARK, in centimetres at the filtered depth — so any anchor
 *    (a midpoint of two landmarks) and every occluder sphere move together,
 *    and raw depth noise no longer leaks into x/y through the unprojection;
 *  - the palm span is median-locked over the first confident samples and then
 *    drives depth (world-landmark scale noise leaves the depth channel).
 * Filters step on NEW SAMPLES only (66/150ms), never on render frames, and
 * reset on re-acquisition or a change of hand.
 *
 * Between samples the render loop EXTRAPOLATES from the filtered velocity
 * (`extrapolatePosition`), capped, so a moving hand stops stepping at the
 * ~15/s inference rate.
 */

import { solveHandPose, type HandPose } from './handPose';
import type { HandPoint, HandSample } from './handGestures';
import { lowpassAlpha, OneEuroQuat, OneEuroVec3, type OneEuroConfig, type Quat, type Vec3 } from './smoothing';

export const HAND_POS_XY: OneEuroConfig = { minCutoff: 1.5, beta: 0.5, dCutoff: 1.0 };
export const HAND_POS_Z: OneEuroConfig = { minCutoff: 0.6, beta: 0.15, dCutoff: 1.0 };
export const HAND_ROT: OneEuroConfig = { minCutoff: 2.0, beta: 1.2, dCutoff: 1.0 };

/** Keep the last pose through brief misses; hands re-acquire constantly. A gap
 *  longer than this is a re-acquisition: filters reset instead of gliding. */
export const HAND_HOLD_MS = 400;
/** Confident samples before the palm span freezes. */
export const SPAN_LOCK_SAMPLES = 30;
/** Extrapolate at most this far past the last sample. Beyond it the guess is
 *  worth less than holding still (a hand that stopped would overshoot). */
export const HAND_EXTRAPOLATE_MAX_MS = 100;
/** Low-pass on the centroid velocity used for extrapolation. */
const VELOCITY_CUTOFF_HZ = 5;
const MAX_DT_S = 0.25;
const HALF_TAN = Math.tan((63 * Math.PI) / 360);
const PALM = [0, 5, 9, 13, 17] as const;

export interface SharedHandPose {
  /** performance.now() of the inference this pose came from. */
  t: number;
  /** REAL (label-swapped) handedness of the tracked hand. */
  realHand: 'Left' | 'Right';
  /** Filtered pose, RAW (unmirrored) frame. `position` is the filtered palm
   *  centroid, `depthCm` the filtered (span-locked) depth. */
  pose: HandPose;
  /** Filtered normalized image landmarks (x by width, y by height), RAW. */
  landmarks: readonly HandPoint[];
  /** This sample's metric world landmarks, unfiltered — per-landmark relief. */
  world: readonly HandPoint[];
  /** Filtered palm-centroid velocity, cm/s, RAW frame. */
  velocity: Vec3;
  /** Frame aspect (W/H) the pose was solved at. */
  aspect: number;
}

/** `p + v·min(elapsed, cap)` — the render-frame position between samples. */
export function extrapolatePosition(
  p: readonly [number, number, number],
  v: readonly [number, number, number],
  elapsedMs: number,
  out: Vec3 = [0, 0, 0],
): Vec3 {
  const e = elapsedMs > 0 ? Math.min(elapsedMs, HAND_EXTRAPOLATE_MAX_MS) / 1000 : 0;
  out[0] = p[0] + v[0] * e;
  out[1] = p[1] + v[1] * e;
  out[2] = p[2] + v[2] * e;
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class HandPoseTracker {
  private readonly lm: OneEuroVec3[] = Array.from({ length: 21 }, () => new OneEuroVec3(HAND_POS_XY));
  private readonly depth = new OneEuroVec3(HAND_POS_Z);
  private readonly rot = new OneEuroQuat(HAND_ROT);
  private spans: number[] = [];
  private lockedSpan: number | null = null;
  private lastT = -Infinity;
  private lastHand: 'Left' | 'Right' | null = null;
  private prevPos: Vec3 | null = null;
  private vel: Vec3 = [0, 0, 0];
  private readonly _xy: Vec3 = [0, 0, 0];
  private readonly _d: Vec3 = [0, 0, 0];

  /** Forget everything, including the span lock (a new scene / guest). */
  reset(): void {
    this.resetFilters();
    this.spans = [];
    this.lockedSpan = null;
    this.lastT = -Infinity;
    this.lastHand = null;
  }

  /** The frozen per-user palm span, or null until SPAN_LOCK_SAMPLES arrive. */
  get spanLockCm(): number | null {
    return this.lockedSpan;
  }

  private resetFilters(): void {
    for (const f of this.lm) f.reset();
    this.depth.reset();
    this.rot.reset();
    this.prevPos = null;
    this.vel = [0, 0, 0];
  }

  /**
   * Feed one inference's hand. Returns the shared pose, or null on a degenerate
   * frame (edge-on palm, missing landmarks) — callers keep the last good one.
   */
  update(hand: HandSample, realHand: 'Left' | 'Right', aspect: number, nowMs: number): SharedHandPose | null {
    const raw = solveHandPose(hand.landmarks, hand.world, realHand, aspect, this.lockedSpan);
    if (raw === null) return null;

    if (this.lockedSpan === null && raw.palmSpanCm > 1) {
      this.spans.push(raw.palmSpanCm);
      if (this.spans.length >= SPAN_LOCK_SAMPLES) this.lockedSpan = median(this.spans);
    }

    const gap = nowMs - this.lastT;
    const fresh = !(gap > 0 && gap < HAND_HOLD_MS) || realHand !== this.lastHand;
    if (fresh) this.resetFilters();
    const dt = fresh ? 0 : Math.min(MAX_DT_S, gap / 1000);
    this.lastT = nowMs;
    this.lastHand = realHand;

    const depthCm = this.depth.filter([raw.depthCm, 0, 0], dt, this._d)[0];
    const q: Quat = this.rot.filter(raw.quaternion, dt, [0, 0, 0, 1]);

    const halfH = HALF_TAN * depthCm;
    const halfW = halfH * aspect;
    const landmarks: HandPoint[] = new Array(hand.landmarks.length);
    for (let i = 0; i < hand.landmarks.length; i++) {
      const l = hand.landmarks[i];
      const f = i < this.lm.length
        ? this.lm[i].filter([(l.x * 2 - 1) * halfW, (1 - l.y * 2) * halfH, 0], dt, this._xy)
        : null;
      landmarks[i] = f === null
        ? { x: l.x, y: l.y, z: l.z }
        : { x: (f[0] / halfW + 1) / 2, y: (1 - f[1] / halfH) / 2, z: l.z };
    }

    let mx = 0, my = 0;
    for (const i of PALM) { mx += landmarks[i].x; my += landmarks[i].y; }
    mx /= PALM.length; my /= PALM.length;
    const position: [number, number, number] = [(mx * 2 - 1) * halfW, (1 - my * 2) * halfH, -depthCm];

    if (this.prevPos !== null && dt > 0) {
      const a = lowpassAlpha(VELOCITY_CUTOFF_HZ, dt);
      for (let k = 0; k < 3; k++) {
        const rv = (position[k] - this.prevPos[k]) / dt;
        this.vel[k] += a * (rv - this.vel[k]);
      }
    }
    this.prevPos = [position[0], position[1], position[2]];

    return {
      t: nowMs,
      realHand,
      pose: { position, quaternion: q, palmSpanCm: raw.palmSpanCm, depthCm },
      landmarks,
      world: hand.world,
      velocity: [this.vel[0], this.vel[1], this.vel[2]],
      aspect,
    };
  }
}
