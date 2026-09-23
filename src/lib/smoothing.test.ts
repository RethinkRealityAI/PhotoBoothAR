import { describe, it, expect } from 'vitest';
import {
  lowpassAlpha,
  OneEuroVec3,
  OneEuroQuat,
  VelocityVec3,
  VelocityQuat,
  predictionLeadSec,
  slerp,
  type Vec3,
  type Quat,
} from './smoothing';

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

describe('VelocityVec3 (dead reckoning)', () => {
  const DT30 = 1 / 30; // detections arrive at camera rate, not render rate

  it('converges to the true velocity of a constant-speed sample stream', () => {
    const v = new VelocityVec3(6);
    for (let i = 0; i < 60; i++) v.push([20 * i * DT30, -5 * i * DT30, 0], DT30); // 20cm/s, -5cm/s
    expect(v.v[0]).toBeCloseTo(20, 1);
    expect(v.v[1]).toBeCloseTo(-5, 1);
    expect(v.v[2]).toBeCloseTo(0, 6);
  });

  it('predicts along that velocity and caps the step', () => {
    const v = new VelocityVec3(6);
    for (let i = 0; i < 60; i++) v.push([20 * i * DT30, 0, 0], DT30);
    const out: Vec3 = [0, 0, 0];
    v.predict([100, 1, 2], 0.05, 10, out); // 50ms lead → 1cm
    expect(out[0]).toBeCloseTo(101, 1);
    expect(out[1]).toBe(1);
    expect(out[2]).toBe(2);
    v.predict([100, 1, 2], 1, 0.5, out); // 1s lead wants 20cm; capped at 0.5
    expect(out[0]).toBeCloseTo(100.5, 6);
  });

  it('is exactly the input at rest — no jitter is manufactured', () => {
    const v = new VelocityVec3(6);
    for (let i = 0; i < 40; i++) v.push([3, 3, 3], DT30);
    const out: Vec3 = [0, 0, 0];
    v.predict([3, 3, 3], 0.08, 10, out);
    expect(out).toEqual([3, 3, 3]);
  });

  it('seeds on the first sample, ignores a non-positive dt, and reset() forgets', () => {
    const v = new VelocityVec3(6);
    v.push([1, 0, 0], DT30);
    expect(v.v).toEqual([0, 0, 0]);
    v.push([5, 0, 0], 0); // duplicate timestamp: no division by zero, no update
    expect(v.v).toEqual([0, 0, 0]);
    v.push([1 + 10 * DT30, 0, 0], DT30);
    expect(v.v[0]).toBeGreaterThan(0);
    v.reset();
    expect(v.v).toEqual([0, 0, 0]);
    v.push([0, 0, 0], DT30);
    expect(v.v).toEqual([0, 0, 0]);
  });
});

describe('VelocityQuat (dead reckoning)', () => {
  const DT30 = 1 / 30;
  const aboutY = (rad: number): Quat => [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];

  it('recovers a steady 1 rad/s turn about Y', () => {
    const w = new VelocityQuat(6);
    for (let i = 0; i < 60; i++) w.push(aboutY(i * DT30), DT30);
    expect(w.w[0]).toBeCloseTo(0, 6);
    expect(w.w[1]).toBeCloseTo(1, 1);
    expect(w.w[2]).toBeCloseTo(0, 6);
  });

  it('predicts the turn forward and caps the extrapolated angle', () => {
    const w = new VelocityQuat(6);
    for (let i = 0; i < 60; i++) w.push(aboutY(i * DT30), DT30);
    const out: Quat = [0, 0, 0, 1];
    w.predict(aboutY(0.3), 0.5, 1, out); // +0.5 rad → 0.8 rad about Y
    const want = aboutY(0.8);
    const dot = Math.abs(out[0] * want[0] + out[1] * want[1] + out[2] * want[2] + out[3] * want[3]);
    expect(dot).toBeGreaterThan(0.9999);
    expect(Math.abs(Math.hypot(...out) - 1)).toBeLessThan(1e-9);
    w.predict(aboutY(0), 2, 0.1, out); // wants 2 rad, capped at 0.1
    expect(Math.abs(out[3] - Math.cos(0.05))).toBeLessThan(1e-9);
  });

  it('is exactly the input when nothing is turning', () => {
    const w = new VelocityQuat(6);
    for (let i = 0; i < 40; i++) w.push(aboutY(0.4), DT30);
    const out: Quat = [0, 0, 0, 1];
    const from = aboutY(0.4);
    w.predict(from, 0.1, 1, out);
    expect(out).toEqual(from);
  });

  it('takes the short way round a sign-flipped sample', () => {
    const w = new VelocityQuat(6);
    const q = aboutY(0.2);
    w.push(q, DT30);
    w.push([-q[0], -q[1], -q[2], -q[3]], DT30); // same rotation, negated
    expect(Math.hypot(...w.w)).toBeLessThan(1e-6);
  });
});

describe('predictionLeadSec', () => {
  it('is age plus bias, capped, in seconds', () => {
    expect(predictionLeadSec(10, 24, 80)).toBeCloseTo(0.034, 9);
    expect(predictionLeadSec(200, 24, 80)).toBeCloseTo(0.08, 9);
    expect(predictionLeadSec(0, 0, 80)).toBe(0);
  });
  it('refuses a non-finite or negative age', () => {
    expect(predictionLeadSec(NaN, 24, 80)).toBe(0);
    expect(predictionLeadSec(-5, 24, 80)).toBe(0);
    expect(predictionLeadSec(Infinity, 24, 80)).toBe(0);
  });
});
