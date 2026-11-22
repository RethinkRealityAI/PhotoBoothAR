import { describe, expect, it } from 'vitest';
import { BASE_DPR_MAX, HARD_DPR_MAX, formatGranted, formatMax, photoDprMax } from './cameraQuality';

describe('photoDprMax', () => {
  it('lifts the cap so a 390 CSS-px phone fills the 1080 photo buffer', () => {
    const d = photoDprMax(390);
    expect(d).toBeCloseTo(2.77, 2);
    expect(390 * d).toBeGreaterThanOrEqual(1080);
  });

  it('covers common Android widths (412, 360) without falling short', () => {
    for (const w of [412, 393, 384, 360]) {
      expect(w * photoDprMax(w)).toBeGreaterThanOrEqual(1080);
    }
  });

  it('never goes below the previous default of 2 on wide screens', () => {
    expect(photoDprMax(1440)).toBe(BASE_DPR_MAX);
    expect(photoDprMax(600)).toBe(BASE_DPR_MAX);
  });

  it('never exceeds the hard ceiling on very narrow viewports', () => {
    expect(photoDprMax(280)).toBe(HARD_DPR_MAX);
  });

  it('falls back to the old default on bad input', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(photoDprMax(bad)).toBe(BASE_DPR_MAX);
    }
  });
});

describe('formatGranted', () => {
  it('formats size and rounded fps', () => {
    expect(formatGranted({ width: 1080, height: 1920, frameRate: 29.97 })).toBe('1080×1920 @30');
  });
  it('omits fps when unknown, null when no size yet', () => {
    expect(formatGranted({ width: 720, height: 1280 })).toBe('720×1280');
    expect(formatGranted({ width: 0, height: 0 })).toBeNull();
    expect(formatGranted(null)).toBeNull();
  });
});

describe('formatMax', () => {
  it('reports long×short regardless of orientation', () => {
    expect(formatMax({ width: { max: 2160 }, height: { max: 3840 }, frameRate: { max: 60 } })).toBe('3840×2160 @60');
  });
  it('is null when the browser exposes no capabilities', () => {
    expect(formatMax(null)).toBeNull();
    expect(formatMax({})).toBeNull();
  });
});
