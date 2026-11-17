import { describe, it, expect } from 'vitest';
import { TrackingStatsRing } from './trackingStats';

/** Unit quaternion for `deg` about +Y. */
const yaw = (deg: number): [number, number, number, number] => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};

describe('TrackingStatsRing', () => {
  it('empty → zero rate, null jitter', () => {
    const r = new TrackingStatsRing();
    expect(r.stats(1000)).toEqual({ detectionsPerSec: 0, poseSamples: 0, posJitterCm: null, rotJitterDeg: null });
  });

  it('rate = samples per second over the 2s window (30/s steady)', () => {
    const r = new TrackingStatsRing();
    // Exact grid (k·1000/30, no accumulated float drift): 60 samples in (2000, 4000].
    for (let k = 0; k <= 120; k++) r.markDetection((k * 1000) / 30);
    expect(r.stats(4000).detectionsPerSec).toBeCloseTo(30, 5);
  });

  it('rate before a full window divides by the time actually seen', () => {
    const r = new TrackingStatsRing();
    for (let t = 0; t < 500; t += 50) r.markDetection(t); // 10 samples in 0.5s
    expect(r.stats(500).detectionsPerSec).toBeCloseTo(20, 5);
  });

  it('a perfectly still pose has zero jitter', () => {
    const r = new TrackingStatsRing();
    const q = yaw(10);
    for (let t = 0; t < 1000; t += 33) r.pushPose(t, 1, 2, -40, ...q);
    const s = r.stats(1000);
    expect(s.posJitterCm).toBeCloseTo(0, 9);
    expect(s.rotJitterDeg).toBeCloseTo(0, 4);
  });

  it('±1cm alternation along x is 1cm RMS; ±2° yaw alternation is 2° RMS', () => {
    const r = new TrackingStatsRing();
    let k = 0;
    for (let t = 0; t < 1000; t += 10, k++) {
      const s = k % 2 === 0 ? 1 : -1;
      r.pushPose(t, s, 0, -40, ...yaw(2 * s));
    }
    const st = r.stats(1000);
    expect(st.posJitterCm).toBeCloseTo(1, 6);
    expect(st.rotJitterDeg).toBeCloseTo(2, 3);
  });

  it('q and −q are the same rotation (sign-aligned mean)', () => {
    const r = new TrackingStatsRing();
    const q = yaw(30);
    for (let t = 0, k = 0; t < 1000; t += 20, k++) {
      const s = k % 2 === 0 ? 1 : -1;
      r.pushPose(t, 0, 0, -40, s * q[0], s * q[1], s * q[2], s * q[3]);
    }
    expect(r.stats(1000).rotJitterDeg).toBeCloseTo(0, 3);
  });

  it('samples older than the window age out', () => {
    const r = new TrackingStatsRing();
    for (let t = 0; t < 1000; t += 10) r.pushPose(t, t % 20 === 0 ? 5 : -5, 0, -40, 0, 0, 0, 1);
    for (let t = 3000; t < 4000; t += 10) r.pushPose(t, 0, 0, -40, 0, 0, 0, 1);
    const s = r.stats(4000);
    expect(s.posJitterCm).toBeCloseTo(0, 9);
    expect(s.poseSamples).toBe(100);
  });

  it('non-finite input is dropped, never poisons the stats', () => {
    const r = new TrackingStatsRing();
    r.pushPose(0, NaN, 0, 0, 0, 0, 0, 1);
    r.pushPose(10, 0, 0, -40, 0, 0, 0, 1);
    r.pushPose(20, 0, 0, -40, 0, 0, 0, 1);
    r.markDetection(Infinity);
    const s = r.stats(100);
    expect(s.poseSamples).toBe(2);
    expect(s.posJitterCm).toBe(0);
  });

  it('reset forgets everything', () => {
    const r = new TrackingStatsRing();
    r.markDetection(1);
    r.pushPose(1, 0, 0, 0, 0, 0, 0, 1);
    r.reset();
    expect(r.stats(10).detectionsPerSec).toBe(0);
    expect(r.stats(10).poseSamples).toBe(0);
  });
});
