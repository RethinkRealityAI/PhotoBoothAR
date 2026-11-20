import { describe, it, expect } from 'vitest';
import { SteadyPoseFilter, STEADY_PIVOT } from './steadyPoseFilter';
import type { Quat, Vec3 } from './smoothing';

const yaw = (r: number): Quat => [0, Math.sin(r / 2), 0, Math.cos(r / 2)];
const pitch = (r: number): Quat => [Math.sin(r / 2), 0, 0, Math.cos(r / 2)];
function rot(q: Quat, v: readonly number[]): Vec3 {
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
  return [v[0] + 2 * (w * cx + y * cz - z * cy), v[1] + 2 * (w * cy + z * cx - x * cz), v[2] + 2 * (w * cz + x * cy - y * cx)];
}
/** Image position (x/z, y/z) of a head-space point under a pose. */
function image(pos: Vec3, q: Quat, v: readonly number[]): [number, number] {
  const r = rot(q, v);
  return [(pos[0] + r[0]) / (pos[2] + r[2]), (pos[1] + r[1]) / (pos[2] + r[2])];
}
/** Deterministic noise in [-1, 1]. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 0xffffffff) * 2 - 1; };
}
const CROWN = [0, 13, -2];
const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('SteadyPoseFilter', () => {
  it('the first sample passes through unchanged', () => {
    const f = new SteadyPoseFilter();
    const p: Vec3 = [0, 0, 0]; const q: Quat = [0, 0, 0, 1];
    f.filter([1, 2, -45], yaw(0.3), 0.033, p, q);
    expect(p[0]).toBeCloseTo(1, 9); expect(p[1]).toBeCloseTo(2, 9); expect(p[2]).toBeCloseTo(-45, 9);
    expect(q[1]).toBeCloseTo(Math.sin(0.15), 9);
  });

  it('keeps the face pivot at its RAW image position whatever depth and rotation do', () => {
    const f = new SteadyPoseFilter();
    const p: Vec3 = [0, 0, 0]; const q: Quat = [0, 0, 0, 1];
    const r = rng(7);
    for (let i = 0; i < 60; i++) {
      const pos: Vec3 = [3 + i * 0.2, -2 + r(), -45 + 3 * r()];
      const quat = yaw(0.01 * i + 0.05 * r());
      f.filter(pos, quat, 0.033, p, q);
      const raw = image(pos, quat, STEADY_PIVOT);
      const shown = image(p, q, STEADY_PIVOT);
      expect(shown[0]).toBeCloseTo(raw[0], 9);
      expect(shown[1]).toBeCloseTo(raw[1], 9);
    }
  });

  it('a still face with depth and pitch noise: the crown wobbles less than half as much as raw', () => {
    const f = new SteadyPoseFilter();
    const p: Vec3 = [0, 0, 0]; const q: Quat = [0, 0, 0, 1];
    const r = rng(11);
    const rawY: number[] = []; const outY: number[] = [];
    for (let i = 0; i < 200; i++) {
      // The measured noise: ~0.33cm of depth, ~0.25 degrees of pitch.
      const pos: Vec3 = [0, 0, -47 + 0.5 * r()];
      const quat = pitch(0.0065 * r());
      f.filter(pos, quat, 0.05, p, q);
      if (i < 20) continue;
      rawY.push(image(pos, quat, CROWN)[1]);
      outY.push(image(p, q, CROWN)[1]);
    }
    const dev = (a: number[]) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return rms(a.map((v) => v - m)); };
    expect(dev(outY)).toBeLessThan(dev(rawY) / 2); // white noise is the worst case; real 8th Wall noise measured 5x
  });

  it('follows a real turn: after the head stops, the shown rotation converges on the raw one', () => {
    const f = new SteadyPoseFilter();
    const p: Vec3 = [0, 0, 0]; const q: Quat = [0, 0, 0, 1];
    for (let i = 0; i < 20; i++) f.filter([0, 0, -45], yaw(Math.min(i, 10) * 0.05), 0.033, p, q);
    for (let i = 0; i < 40; i++) f.filter([0, 0, -45], yaw(0.5), 0.033, p, q);
    expect(q[1]).toBeCloseTo(Math.sin(0.25), 3);
    expect(p[2]).toBeCloseTo(-45, 3);
  });

  it('reset forgets the history (the next sample passes through)', () => {
    const f = new SteadyPoseFilter();
    const p: Vec3 = [0, 0, 0]; const q: Quat = [0, 0, 0, 1];
    f.filter([0, 0, -45], yaw(0), 0.033, p, q);
    f.reset();
    f.filter([5, 1, -30], yaw(1), 0.033, p, q);
    expect(p[2]).toBeCloseTo(-30, 9);
    expect(q[1]).toBeCloseTo(Math.sin(0.5), 9);
  });

  it('a pivot at the camera plane passes through instead of dividing by zero', () => {
    const f = new SteadyPoseFilter();
    const p: Vec3 = [0, 0, 0]; const q: Quat = [0, 0, 0, 1];
    f.filter([0, 0, -45], yaw(0), 0.033, p, q);
    f.filter([0, 0, -STEADY_PIVOT[2]], yaw(0), 0.033, p, q);
    expect(p.every(Number.isFinite)).toBe(true);
  });
});
