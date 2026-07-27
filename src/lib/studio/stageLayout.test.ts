import { describe, it, expect } from 'vitest';
import { fitStageBox, STAGE_ASPECT } from './stageLayout';

describe('fitStageBox', () => {
  it('keeps 9:16 when the width binds — the case the CSS got wrong', () => {
    // 366x716 is the real stage space on a 390px phone. The shipped CSS
    // (h-full + aspectRatio + maxWidth) produced 366x716 = 0.511, not 0.5625.
    const b = fitStageBox(366, 716);
    expect(b.w / b.h).toBeCloseTo(STAGE_ASPECT, 6);
    expect(b.w).toBeLessThanOrEqual(366);
    expect(b.h).toBeLessThanOrEqual(716);
  });

  it('keeps 9:16 when the height binds', () => {
    const b = fitStageBox(2000, 800);
    expect(b.w / b.h).toBeCloseTo(STAGE_ASPECT, 6);
    expect(b.h).toBeCloseTo(800, 6);
  });

  it('fills exactly one axis and never overflows the other', () => {
    for (const [w, h] of [[366, 716], [2000, 800], [500, 500], [1080, 1920]]) {
      const b = fitStageBox(w, h);
      expect(b.w).toBeLessThanOrEqual(w + 1e-9);
      expect(b.h).toBeLessThanOrEqual(h + 1e-9);
      // One of the two must be tight, otherwise the box is smaller than it need be.
      expect(Math.abs(b.w - w) < 1e-6 || Math.abs(b.h - h) < 1e-6).toBe(true);
    }
  });

  it('is exact on a perfectly matched box', () => {
    const b = fitStageBox(900, 1600);
    expect(b.w).toBeCloseTo(900, 6);
    expect(b.h).toBeCloseTo(1600, 6);
  });

  it('honours a custom ratio', () => {
    const b = fitStageBox(1000, 1000, 1);
    expect(b.w).toBeCloseTo(1000, 6);
    expect(b.h).toBeCloseTo(1000, 6);
  });

  it('returns a zero box for degenerate input instead of NaN geometry', () => {
    for (const [w, h] of [[0, 100], [100, 0], [-5, 100], [NaN, 100], [100, Infinity]]) {
      const b = fitStageBox(w, h);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        expect(b).toEqual({ w: 0, h: 0 });
      }
    }
    expect(fitStageBox(100, 100, 0)).toEqual({ w: 0, h: 0 });
  });
});
