import { describe, expect, it } from 'vitest';
import {
  FRAME_LOCK_MAX_LAG_MS,
  FRAME_LOCK_RESUME_LAG_MS,
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

  it('falls back to live when samples keep coming but their frames trail the camera too far', () => {
    const g = createFrameLockGuard();
    // A slowed tracker: a new sample every 200 ms, each from a frame 2 samples old.
    expect(frameLockShouldUseLive(g, 1000, 1000, 1000 - 100)).toBe(false); // 100 ms behind: locked
    expect(frameLockShouldUseLive(g, 1200, 1200, 1200 - 400)).toBe(true); // 400 ms behind: live
    expect(g.fallbacks).toBe(1);
    // Fresh samples whose frames are still too old never re-lock.
    expect(frameLockShouldUseLive(g, 1400, 1400, 1000)).toBe(true);
    expect(frameLockShouldUseLive(g, 1600, 1600, 1200)).toBe(true);
    // The tracker recovers: two fresh samples within the lag budget re-lock.
    expect(frameLockShouldUseLive(g, 1700, 1690, 1640)).toBe(true);
    expect(frameLockShouldUseLive(g, 1750, 1740, 1690)).toBe(false);
  });

  it('the lag limit is inclusive and the frame time defaults to the sample time', () => {
    const g = createFrameLockGuard();
    expect(frameLockShouldUseLive(g, 2000, 2000, 2000 - FRAME_LOCK_MAX_LAG_MS)).toBe(false);
    expect(frameLockShouldUseLive(g, 2010, 2000)).toBe(false);
    expect(frameLockShouldUseLive(g, 2010, 2000, Number.NaN)).toBe(false);
  });

  it('does not flip back and forth while the lag hovers near the limit', () => {
    const g = createFrameLockGuard();
    expect(frameLockShouldUseLive(g, 1000, 1000, 1000 - (FRAME_LOCK_MAX_LAG_MS + 10))).toBe(true);
    // Back under the fall-back limit but above the resume limit: stays live.
    for (let i = 1; i <= 5; i++) {
      const t = 1000 + i * 100;
      expect(frameLockShouldUseLive(g, t, t, t - (FRAME_LOCK_RESUME_LAG_MS + 20))).toBe(true);
    }
    expect(g.fallbacks).toBe(1);
    // Under the resume limit for two samples: locks again.
    expect(frameLockShouldUseLive(g, 1600, 1600, 1600 - 100)).toBe(true);
    expect(frameLockShouldUseLive(g, 1700, 1700, 1700 - 100)).toBe(false);
  });

  it('holdLive: once live it stays live until released, then re-locks normally', () => {
    const g = createFrameLockGuard();
    g.holdLive = true;
    // Healthy samples: holdLive alone never forces live.
    expect(frameLockShouldUseLive(g, 1010, 1000, 950)).toBe(false);
    // A stall falls back...
    expect(frameLockShouldUseLive(g, 1400, 1000, 950)).toBe(true);
    expect(g.fallbacks).toBe(1);
    // ...and healthy samples do NOT re-lock while held (a clip changes source once).
    for (let t = 1440; t < 2400; t += 40) expect(frameLockShouldUseLive(g, t + 5, t, t - 60)).toBe(true);
    expect(g.fallbacks).toBe(1);
    // Released: the usual resume rule applies again.
    g.holdLive = false;
    let live = true;
    for (let i = 0; i < FRAME_LOCK_RESUME_SAMPLES; i++) live = frameLockShouldUseLive(g, 2445 + i * 40, 2440 + i * 40, 2380 + i * 40);
    expect(live).toBe(false);
  });

  it('reset keeps holdLive', () => {
    const g = createFrameLockGuard();
    g.holdLive = true;
    resetFrameLockGuard(g);
    expect(g.holdLive).toBe(true);
  });
});
