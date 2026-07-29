import { describe, it, expect } from 'vitest';
import { thumbsEnabled, nextThumbIndex, shouldTick, THUMB_PX, THUMB_TICK_MS } from './filterThumbs';

const healthy = {
  webgl: true,
  cameraReady: true,
  reducedMotion: false,
  documentHidden: false,
  subscribers: 4,
};

describe('thumbsEnabled', () => {
  it('runs when everything is healthy and orbs are on screen', () => {
    expect(thumbsEnabled(healthy)).toBe(true);
  });

  it('degrades to gradients when WebGL is unavailable', () => {
    expect(thumbsEnabled({ ...healthy, webgl: false })).toBe(false);
  });

  it('degrades when the camera is not ready', () => {
    expect(thumbsEnabled({ ...healthy, cameraReady: false })).toBe(false);
  });

  it('degrades under prefers-reduced-motion', () => {
    expect(thumbsEnabled({ ...healthy, reducedMotion: true })).toBe(false);
  });

  it('stops in a backgrounded tab', () => {
    expect(thumbsEnabled({ ...healthy, documentHidden: true })).toBe(false);
  });

  it('stops when no orb is mounted — zero subscribers means nothing to paint', () => {
    expect(thumbsEnabled({ ...healthy, subscribers: 0 })).toBe(false);
  });

  it('needs every condition, not just one', () => {
    expect(thumbsEnabled({ ...healthy, webgl: false, subscribers: 0 })).toBe(false);
  });
});

describe('nextThumbIndex', () => {
  it('advances round-robin', () => {
    expect(nextThumbIndex(0, 3)).toBe(1);
    expect(nextThumbIndex(1, 3)).toBe(2);
  });

  it('wraps to the first', () => {
    expect(nextThumbIndex(2, 3)).toBe(0);
  });

  it('returns 0 rather than NaN for an empty list', () => {
    expect(nextThumbIndex(0, 0)).toBe(0);
    expect(nextThumbIndex(5, 0)).toBe(0);
  });

  it('visits every index exactly once per cycle', () => {
    const seen: number[] = [];
    let i = 0;
    for (let n = 0; n < 5; n += 1) { seen.push(i); i = nextThumbIndex(i, 5); }
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('shouldTick', () => {
  it('always allows the very first draw', () => {
    expect(shouldTick(null, 0)).toBe(true);
    // 0 is a real performance.now() reading — the null sentinel is what makes
    // "never drawn" distinguishable from "drawn at time zero".
    expect(shouldTick(0, 1)).toBe(false);
  });

  it('waits out the interval', () => {
    expect(shouldTick(1000, 1000 + THUMB_TICK_MS - 1)).toBe(false);
    expect(shouldTick(1000, 1000 + THUMB_TICK_MS)).toBe(true);
  });

  it('accepts a custom interval', () => {
    expect(shouldTick(1000, 1400, 500)).toBe(false);
    expect(shouldTick(1000, 1500, 500)).toBe(true);
  });
});

describe('cost constants', () => {
  it('keeps the shared thumbnail buffer tiny next to the 720x1280 preview', () => {
    // The booth already shades 921,600 px/frame; the thumbnail buffer must be
    // a rounding error against that, or this feature is not worth its risk.
    expect(THUMB_PX * THUMB_PX).toBeLessThan(720 * 1280 * 0.02);
  });

  it('keeps the cadence far below frame rate', () => {
    expect(1000 / THUMB_TICK_MS).toBeLessThanOrEqual(10);
  });
});
