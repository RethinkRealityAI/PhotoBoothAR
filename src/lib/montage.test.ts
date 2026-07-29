/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  montagePlan,
  slideAt,
  slideAlpha,
  easeInOut,
  kenBurns,
  coverRect,
  recapFileName,
  MAX_MONTAGE_SLIDES,
} from './montage';

describe('montagePlan', () => {
  it('lays slides end to end with no gaps', () => {
    const plan = montagePlan(3, { perSlideMs: 1000 });
    expect(plan.slides).toEqual([
      { index: 0, startMs: 0, endMs: 1000 },
      { index: 1, startMs: 1000, endMs: 2000 },
      { index: 2, startMs: 2000, endMs: 3000 },
    ]);
    expect(plan.durationMs).toBe(3000);
  });

  it('caps the number of slides', () => {
    const plan = montagePlan(40);
    expect(plan.slides).toHaveLength(MAX_MONTAGE_SLIDES);
    expect(MAX_MONTAGE_SLIDES).toBe(8);
  });

  it('never lets the fade outlast half a slide', () => {
    const plan = montagePlan(2, { perSlideMs: 600, fadeMs: 5000 });
    expect(plan.fadeMs).toBe(300);
  });

  it('produces a portrait frame by default', () => {
    const plan = montagePlan(2);
    expect(plan.width).toBe(720);
    expect(plan.height).toBe(1280);
    expect(plan.height).toBeGreaterThan(plan.width);
  });

  it('handles zero and negative counts', () => {
    expect(montagePlan(0).slides).toEqual([]);
    expect(montagePlan(0).durationMs).toBe(0);
    expect(montagePlan(-3).slides).toEqual([]);
  });
});

describe('slideAt', () => {
  const plan = montagePlan(3, { perSlideMs: 1000 });

  it('is null when there is nothing to show', () => {
    expect(slideAt(montagePlan(0), 0)).toBeNull();
  });

  it('maps time onto the right slide', () => {
    expect(slideAt(plan, 0)).toEqual({ index: 0, progress: 0 });
    expect(slideAt(plan, 500)).toEqual({ index: 1 - 1, progress: 0.5 });
    expect(slideAt(plan, 1000)).toEqual({ index: 1, progress: 0 });
    expect(slideAt(plan, 2500)).toEqual({ index: 2, progress: 0.5 });
  });

  it('clamps past the end instead of running off the array', () => {
    expect(slideAt(plan, 99_999)).toEqual({ index: 2, progress: 1 });
    expect(slideAt(plan, -50)).toEqual({ index: 0, progress: 0 });
  });
});

describe('slideAlpha', () => {
  const plan = montagePlan(3, { perSlideMs: 1000, fadeMs: 250 });

  it('fades in and then holds', () => {
    expect(slideAlpha(plan, 0)).toBe(0);
    expect(slideAlpha(plan, 0.125)).toBeCloseTo(0.5, 5);
    expect(slideAlpha(plan, 0.25)).toBe(1);
    expect(slideAlpha(plan, 0.9)).toBe(1);
  });

  it('stays opaque at the end, so the background never shows through', () => {
    expect(slideAlpha(plan, 1)).toBe(1);
  });

  it('is fully opaque throughout with no fade', () => {
    const hard = montagePlan(2, { perSlideMs: 1000, fadeMs: 0 });
    expect(slideAlpha(hard, 0)).toBe(1);
    expect(slideAlpha(hard, 0.5)).toBe(1);
  });
});

describe('easeInOut', () => {
  it('pins both ends and passes through the middle', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
  });

  it('clamps out-of-range input', () => {
    expect(easeInOut(-2)).toBe(0);
    expect(easeInOut(9)).toBe(1);
  });

  it('is monotonic', () => {
    let prev = -1;
    for (let t = 0; t <= 1.00001; t += 0.05) {
      const v = easeInOut(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('kenBurns', () => {
  it('only ever zooms in', () => {
    for (let i = 0; i < 5; i++) {
      expect(kenBurns(0, i).scale).toBeGreaterThanOrEqual(1);
      expect(kenBurns(1, i).scale).toBeGreaterThan(kenBurns(0, i).scale);
    }
  });

  it('keeps the pan inside the legal range', () => {
    for (let i = 0; i < 6; i++) {
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const kb = kenBurns(p, i);
        expect(Math.abs(kb.panX)).toBeLessThanOrEqual(1);
        expect(Math.abs(kb.panY)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('alternates direction so neighbours do not move identically', () => {
    expect(Math.sign(kenBurns(1, 0).panX)).toBe(1);
    expect(Math.sign(kenBurns(1, 1).panX)).toBe(-1);
  });

  it('is deterministic — the same gallery renders the same film', () => {
    expect(kenBurns(0.42, 3)).toEqual(kenBurns(0.42, 3));
  });
});

describe('coverRect', () => {
  it('crops a landscape source to a portrait frame, centred', () => {
    const r = coverRect(1000, 500, 720, 1280);
    // Portrait destination: the full height is used, width is cropped.
    expect(r.sh).toBeCloseTo(500, 5);
    expect(r.sw).toBeCloseTo(500 * (720 / 1280), 5);
    expect(r.sx + r.sw / 2).toBeCloseTo(500, 5); // horizontally centred
    expect(r.sy).toBeCloseTo(0, 5);
  });

  it('crops a portrait source to a portrait frame', () => {
    const r = coverRect(1080, 1920, 720, 1280);
    expect(r.sw).toBeCloseTo(1080, 5);
    expect(r.sh).toBeCloseTo(1920, 5);
  });

  it('never leaves the source bounds, at any zoom or pan', () => {
    for (const [w, h] of [[1000, 500], [1080, 1920], [640, 640]]) {
      for (const scale of [1, 1.06, 1.16, 2]) {
        for (const pan of [-1, -0.4, 0, 0.4, 1]) {
          const r = coverRect(w, h, 720, 1280, { scale, panX: pan, panY: pan });
          expect(r.sx).toBeGreaterThanOrEqual(-1e-6);
          expect(r.sy).toBeGreaterThanOrEqual(-1e-6);
          expect(r.sx + r.sw).toBeLessThanOrEqual(w + 1e-6);
          expect(r.sy + r.sh).toBeLessThanOrEqual(h + 1e-6);
        }
      }
    }
  });

  it('zooming in shrinks the source rectangle', () => {
    const wide = coverRect(1080, 1920, 720, 1280, { scale: 1, panX: 0, panY: 0 });
    const tight = coverRect(1080, 1920, 720, 1280, { scale: 1.5, panX: 0, panY: 0 });
    expect(tight.sw).toBeLessThan(wide.sw);
    expect(tight.sh).toBeLessThan(wide.sh);
  });

  it('refuses to divide by zero on a degenerate image', () => {
    expect(() => coverRect(0, 0, 720, 1280)).not.toThrow();
    const r = coverRect(0, 0, 720, 1280);
    expect(Number.isFinite(r.sw)).toBe(true);
  });
});

describe('recapFileName', () => {
  it('slugs the event and keeps the container extension', () => {
    expect(recapFileName('Hope Gala', 'webm')).toBe('Hope-Gala-recap.webm');
    expect(recapFileName('Hope Gala', 'mp4')).toBe('Hope-Gala-recap.mp4');
  });

  it('falls back on an empty or unusable prefix', () => {
    expect(recapFileName('', 'webm')).toBe('recap-recap.webm');
    expect(recapFileName('!!!', 'zzz')).toBe('recap-recap.webm');
  });
});
