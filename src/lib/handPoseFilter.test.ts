import { describe, expect, it } from 'vitest';
import {
  extrapolatePosition,
  HAND_EXTRAPOLATE_MAX_MS,
  HAND_HOLD_MS,
  HandPoseTracker,
  SPAN_LOCK_SAMPLES,
} from './handPoseFilter';
import { solveHandPose } from './handPose';
import type { HandPoint, HandSample } from './handGestures';

const F_OVER_H = 0.5 / Math.tan((63 * Math.PI) / 360);
const ASPECT = 9 / 16;
const HALF_TAN = Math.tan((63 * Math.PI) / 360);

/** A flat right hand facing the camera, metres (world y is DOWN). */
function worldHand(scale = 1): HandPoint[] {
  const w: HandPoint[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  w[0] = { x: 0, y: 0.05 * scale, z: 0 };
  w[5] = { x: 0.03 * scale, y: -0.04 * scale, z: 0 };
  w[9] = { x: 0.01 * scale, y: -0.048 * scale, z: 0 };
  w[13] = { x: -0.012 * scale, y: -0.045 * scale, z: 0 };
  w[17] = { x: -0.032 * scale, y: -0.035 * scale, z: 0 };
  for (let i = 1; i < 21; i++) if (w[i].x === 0 && w[i].y === 0) w[i] = { x: 0.002 * i * scale, y: -0.06 * scale, z: 0 };
  return w;
}

/** Project the TRUE hand (true world, not the noisy one) at a centre/depth. */
function frame(depthCm: number, cx: number, cy = 0.5, worldScale = 1): HandSample {
  const world = worldHand();
  const s = F_OVER_H / depthCm;
  const landmarks = world.map((p) => ({ x: (cx * ASPECT + p.x * 100 * s) / ASPECT, y: cy + p.y * 100 * s, z: 0 }));
  return { landmarks, world: worldHand(worldScale) };
}

/** Deterministic noise in [-1, 1]. */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const sd = (a: number[]): number => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

describe('HandPoseTracker — one filtered pose for every hand consumer', () => {
  it('a still, noiseless hand passes through unchanged and agrees with the solver', () => {
    const tr = new HandPoseTracker();
    const f = frame(60, 0.4);
    let out = null;
    for (let i = 0; i < 10; i++) out = tr.update(f, 'Right', ASPECT, i * 66);
    const raw = solveHandPose(f.landmarks, f.world, 'Right', ASPECT, null);
    if (out === null || raw === null) throw new Error('degenerate');
    expect(out.pose.depthCm).toBeCloseTo(raw.depthCm, 6);
    for (let k = 0; k < 3; k++) expect(out.pose.position[k]).toBeCloseTo(raw.position[k], 6);
    for (let i = 0; i < 21; i++) {
      expect(out.landmarks[i].x).toBeCloseTo(f.landmarks[i].x, 9);
      expect(out.landmarks[i].y).toBeCloseTo(f.landmarks[i].y, 9);
    }
    expect(Math.hypot(...out.velocity)).toBeLessThan(1e-6);
  });

  it('span-locks and filters depth — the occluder used to get neither', () => {
    // World-landmark SCALE noise is what the span lock removes from depth: a
    // ±6% per-frame scale wobble reads as a ±6% depth wobble when unlocked.
    const tr = new HandPoseTracker();
    const rawDepth: number[] = [];
    const sharedDepth: number[] = [];
    for (let i = 0; i < 120; i++) {
      const f = frame(60, 0.5, 0.5, 1 + 0.06 * noise(i));
      const out = tr.update(f, 'Right', ASPECT, i * 66);
      const raw = solveHandPose(f.landmarks, f.world, 'Right', ASPECT, null);
      if (i >= SPAN_LOCK_SAMPLES + 10 && out !== null && raw !== null) {
        rawDepth.push(raw.depthCm);
        sharedDepth.push(out.pose.depthCm);
      }
    }
    expect(tr.spanLockCm).not.toBeNull();
    expect(sd(sharedDepth)).toBeLessThan(sd(rawDepth) * 0.2);
  });

  it('a re-acquisition after HAND_HOLD_MS snaps instead of gliding across frame', () => {
    const tr = new HandPoseTracker();
    for (let i = 0; i < 5; i++) tr.update(frame(60, 0.3), 'Right', ASPECT, i * 66);
    const back = tr.update(frame(60, 0.7), 'Right', ASPECT, 4 * 66 + HAND_HOLD_MS + 50);
    const raw = solveHandPose(frame(60, 0.7).landmarks, frame(60, 0.7).world, 'Right', ASPECT, null);
    if (back === null || raw === null) throw new Error('degenerate');
    expect(back.pose.position[0]).toBeCloseTo(raw.position[0], 6);
    expect(back.velocity).toEqual([0, 0, 0]);
  });

  it('switching hands resets too (never a glide from one hand to the other)', () => {
    const tr = new HandPoseTracker();
    for (let i = 0; i < 5; i++) tr.update(frame(60, 0.3), 'Right', ASPECT, i * 66);
    const other = tr.update(frame(60, 0.7), 'Left', ASPECT, 5 * 66);
    const raw = solveHandPose(frame(60, 0.7).landmarks, frame(60, 0.7).world, 'Left', ASPECT, null);
    if (other === null || raw === null) throw new Error('degenerate');
    expect(other.pose.position[0]).toBeCloseTo(raw.position[0], 6);
  });
});

describe('extrapolatePosition — no more 15/s staircase', () => {
  it('a hand moving at 20cm/s is tracked far closer between samples than a held pose', () => {
    // Inference at 15/s, render at 60/s: today the gear holds the last sample
    // for up to 66ms, a 1.3cm stair-step at 20cm/s on top of the filter lag.
    const tr = new HandPoseTracker();
    const speed = 20; // cm/s in x
    const depth = 60;
    const widthCm = 2 * HALF_TAN * depth * ASPECT;
    const cxAt = (tMs: number) => 0.2 + (speed * tMs) / 1000 / widthCm;
    let last = null;
    let heldErr = 0;
    let extErr = 0;
    let n = 0;
    for (let tMs = 0; tMs <= 2000; tMs += 1000 / 60) {
      // A new inference lands on every 4th render frame.
      if (Math.round(tMs / (1000 / 60)) % 4 === 0) last = tr.update(frame(depth, cxAt(tMs)), 'Right', ASPECT, tMs);
      if (last === null || tMs < 1000) continue;
      const truthX = (cxAt(tMs) * 2 - 1) * HALF_TAN * depth * ASPECT;
      const ext = extrapolatePosition(last.pose.position, last.velocity, tMs - last.t);
      heldErr += Math.abs(last.pose.position[0] - truthX);
      extErr += Math.abs(ext[0] - truthX);
      n++;
    }
    expect(n).toBeGreaterThan(50);
    expect(extErr / n).toBeLessThan((heldErr / n) * 0.5);
  });

  it('caps the reach so a hand that stopped does not overshoot far', () => {
    expect(extrapolatePosition([0, 0, 0], [100, 0, 0], 5000)[0]).toBeCloseTo((100 * HAND_EXTRAPOLATE_MAX_MS) / 1000, 9);
    expect(extrapolatePosition([1, 2, 3], [100, 100, 100], -10)).toEqual([1, 2, 3]);
  });
});
