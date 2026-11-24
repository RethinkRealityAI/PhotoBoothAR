import { describe, expect, it } from 'vitest';
import {
  FRAME_LOCK_RESUME_SAMPLES,
  FRAME_LOCK_STALE_MS,
  createFrameLockGuard,
  frameLockShouldUseLive,
  resetFrameLockGuard,
} from './frameLockGuard';

describe('frameLockShouldUseLive', () => {
  it('keeps the tracked frame while samples keep arriving', () => {
    const g = createFrameLockGuard();
    // 8th Wall cadence ~44 ms; the compositor draws at 60 Hz in between.
    for (let t = 1000; t < 2000; t += 16) {
      const key = 1000 + Math.floor((t - 1000) / 44) * 44;
      expect(frameLockShouldUseLive(g, t, key)).toBe(false);
    }
    expect(g.fallbacks).toBe(0);
  });

  it('falls back to live once the newest sample is older than the stale limit', () => {
    const g = createFrameLockGuard();
    expect(frameLockShouldUseLive(g, 1000 + FRAME_LOCK_STALE_MS, 1000)).toBe(false); // exactly at the limit: still locked
    expect(frameLockShouldUseLive(g, 1001 + FRAME_LOCK_STALE_MS, 1000)).toBe(true);
    expect(g.fallbacks).toBe(1);
    // Still stalled: stays live, counted once.
    expect(frameLockShouldUseLive(g, 1400, 1000)).toBe(true);
    expect(g.fallbacks).toBe(1);
  });

  it('locks again only after enough fresh samples in a row', () => {
    const g = createFrameLockGuard();
    frameLockShouldUseLive(g, 1300, 1000); // stall -> live
    // First fresh sample: still live (one sample is not a recovery).
    expect(frameLockShouldUseLive(g, 1310, 1305)).toBe(true);
    // Same sample redrawn: does not count twice.
    expect(frameLockShouldUseLive(g, 1326, 1305)).toBe(true);
    if (FRAME_LOCK_RESUME_SAMPLES === 2) {
      expect(frameLockShouldUseLive(g, 1350, 1349)).toBe(false);
    }
    expect(g.live).toBe(false);
  });

  it('a stall during recovery restarts the count', () => {
    const g = createFrameLockGuard();
    frameLockShouldUseLive(g, 1300, 1000);
    frameLockShouldUseLive(g, 1310, 1305); // 1 fresh
    expect(frameLockShouldUseLive(g, 1500, 1305)).toBe(true); // stale again
    expect(g.freshRun).toBe(0);
    expect(g.fallbacks).toBe(1); // never re-locked, so not a second fallback
  });

  it('draws live before the first sample, without counting a fallback', () => {
    const g = createFrameLockGuard();
    expect(frameLockShouldUseLive(g, 500, Number.NaN)).toBe(true);
    expect(g.fallbacks).toBe(0);
  });

  it('reset forgets the history but keeps the counter', () => {
    const g = createFrameLockGuard();
    frameLockShouldUseLive(g, 1300, 1000);
    resetFrameLockGuard(g);
    expect(g.live).toBe(false);
    expect(g.fallbacks).toBe(1);
    expect(frameLockShouldUseLive(g, 1310, 1305)).toBe(false);
  });
});
