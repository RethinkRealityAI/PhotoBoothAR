import { describe, it, expect } from 'vitest';
import { fitStageBox, fillStageBox, stageBleed, STAGE_ASPECT } from './stageLayout';

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

describe('fillStageBox (booth phones: fill the screen)', () => {
  it('covers a typical phone edge to edge, trimming the sides', () => {
    const b = fillStageBox(390, 844);
    expect(b.w / b.h).toBeCloseTo(STAGE_ASPECT, 6);
    expect(b.h).toBeCloseTo(844, 6);
    expect(b.w).toBeGreaterThan(390);
    const bleed = stageBleed(b, 390, 844);
    expect(bleed.y).toBe(0);
    expect(bleed.x).toBeCloseTo((474.75 - 390) / 2, 6);
  });

  it('covers a 21:9 Fold outer screen', () => {
    const b = fillStageBox(412, 961);
    expect(b.h).toBeCloseTo(961, 6);
    expect(b.w).toBeGreaterThan(412);
  });

  it('letterboxes a near-square screen (Fold opened) instead of hiding a third of the frame', () => {
    expect(fillStageBox(720, 800)).toEqual(fitStageBox(720, 800));
  });

  it('covers a screen a little wider than 9:16 by trimming top and bottom', () => {
    const b = fillStageBox(500, 820);
    expect(b.w).toBeCloseTo(500, 6);
    expect(b.h).toBeGreaterThan(820);
    expect(stageBleed(b, 500, 820).x).toBe(0);
  });

  it('a screen already 9:16 is the fitted box with no bleed', () => {
    const b = fillStageBox(360, 640);
    expect(b.w).toBeCloseTo(360, 6);
    expect(b.h).toBeCloseTo(640, 6);
    expect(stageBleed(b, 360, 640)).toEqual({ x: 0, y: 0 });
  });

  it('bad input is a zero box, never NaN', () => {
    expect(fillStageBox(0, 800)).toEqual({ w: 0, h: 0 });
    expect(fillStageBox(Number.NaN, 800)).toEqual({ w: 0, h: 0 });
  });
});
