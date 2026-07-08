import { describe, it, expect } from 'vitest';
import { lowpassAlpha, OneEuroVec3, OneEuroQuat, slerp, type Vec3, type Quat } from './smoothing';

const DT = 1 / 60; // 60 fps frame time in seconds

describe('lowpassAlpha', () => {
  it('is 0 for non-positive dt or cutoff and always below 1', () => {
    expect(lowpassAlpha(1, 0)).toBe(0);
    expect(lowpassAlpha(1, -0.01)).toBe(0);
    expect(lowpassAlpha(0, DT)).toBe(0);
    expect(lowpassAlpha(1000, 1)).toBeLessThan(1);
    expect(lowpassAlpha(1000, 1)).toBeGreaterThan(0.99);
  });

  it('grows with cutoff and with dt', () => {
    expect(lowpassAlpha(5, DT)).toBeGreaterThan(lowpassAlpha(1, DT));
    expect(lowpassAlpha(1, 1 / 30)).toBeGreaterThan(lowpassAlpha(1, 1 / 120));
  });
});

describe('OneEuroVec3', () => {
  const cfg = { minCutoff: 1.15, beta: 0.08, dCutoff: 1 };

  it('snaps to the first sample', () => {
    const f = new OneEuroVec3(cfg);
    const out = f.filter([3, -2, 5], DT);
    expect(out).toEqual([3, -2, 5]);
  });

  it('converges to a constant target', () => {
    const f = new OneEuroVec3(cfg);
    f.filter([0, 0, 0], DT);
    let out: Vec3 = [0, 0, 0];
    for (let i = 0; i < 300; i++) out = f.filter([10, 4, -6], DT, out);
    expect(Math.abs(out[0] - 10)).toBeLessThan(0.01);
    expect(Math.abs(out[1] - 4)).toBeLessThan(0.01);
    expect(Math.abs(out[2] + 6)).toBeLessThan(0.01);
  });

  it('attenuates small jitter far more than it lags big motion', () => {
    // Deterministic ±0.05 jitter around 0 (sensor noise at rest).
    const f = new OneEuroVec3(cfg);
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      const noise = 0.05 * Math.sin(i * 2.399); // pseudo-random phase walk
      const out = f.filter([noise, 0, 0], DT);
      if (i > 30) peak = Math.max(peak, Math.abs(out[0]));
    }
    expect(peak).toBeLessThan(0.02); // jitter cut by >60%

    // A fast 20-unit jump (deliberate motion) is followed quickly.
    const g = new OneEuroVec3(cfg);
    g.filter([0, 0, 0], DT);
    let out: Vec3 = [0, 0, 0];
    for (let i = 0; i < 30; i++) out = g.filter([20, 0, 0], DT, out); // 0.5s
    expect(out[0]).toBeGreaterThan(18); // >90% there within half a second
  });

  it('reset() snaps the next sample instead of gliding', () => {
    const f = new OneEuroVec3(cfg);
    f.filter([0, 0, 0], DT);
    f.filter([0, 0, 0], DT);
    f.reset();
    const out = f.filter([100, 0, 0], DT);
    expect(out[0]).toBe(100);
  });
});

describe('slerp', () => {
  const IDENT: Quat = [0, 0, 0, 1];
  const Y90: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // 90° about Y

  it('returns the endpoints at t=0 and t=1', () => {
    const a = slerp(IDENT, Y90, 0);
    const b = slerp(IDENT, Y90, 1);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(a[i] - IDENT[i])).toBeLessThan(1e-9);
      expect(Math.abs(b[i] - Y90[i])).toBeLessThan(1e-9);
    }
  });

  it('stays unit-length and takes the short path against a negated target', () => {
    const negY90: Quat = [-Y90[0], -Y90[1], -Y90[2], -Y90[3]]; // same rotation
    const out = slerp(IDENT, negY90, 0.5);
    expect(Math.abs(Math.hypot(...out) - 1)).toBeLessThan(1e-9);
    // Midpoint of a 90° turn is 45°: w = cos(22.5°).
    expect(Math.abs(Math.abs(out[3]) - Math.cos(Math.PI / 8))).toBeLessThan(1e-6);
  });
});

describe('OneEuroQuat', () => {
  const cfg = { minCutoff: 1.5, beta: 0.6, dCutoff: 1 };
  const IDENT: Quat = [0, 0, 0, 1];
  const Y90: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

  it('snaps to the first sample and converges to a held rotation', () => {
    const f = new OneEuroQuat(cfg);
    expect(f.filter(Y90, DT)).toEqual(Y90);

    const g = new OneEuroQuat(cfg);
    g.filter(IDENT, DT);
    let out: Quat = [0, 0, 0, 1];
    for (let i = 0; i < 300; i++) out = g.filter(Y90, DT, out);
    const dot = Math.abs(out[0] * Y90[0] + out[1] * Y90[1] + out[2] * Y90[2] + out[3] * Y90[3]);
    expect(dot).toBeGreaterThan(0.9999);
  });
});
