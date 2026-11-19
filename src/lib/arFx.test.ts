import { describe, expect, it } from 'vitest';
import { AR_FX_KINDS, SOFT_SPEED, fxAlpha, fxCount, seedFx, spotBeams, stepFx } from './arFx';
import { seededRandom } from './brandLanding';

describe('arFx (the AR step effects)', () => {
  it('keeps every effect cheap: bounded counts, fewer under reduced motion, spotlight draws no bits', () => {
    for (const k of AR_FX_KINDS) {
      for (const [w, h] of [[300, 520], [600, 900], [2000, 2000]]) {
        const n = fxCount(k, w, h, false);
        expect(n, k).toBeLessThanOrEqual(70);
        if (k === 'spotlight') expect(n).toBe(0);
        else {
          expect(n, k).toBeGreaterThan(0);
          expect(fxCount(k, w, h, true), k).toBeLessThan(n);
          expect(fxCount(k, w, h, true), k).toBeGreaterThan(0);
        }
      }
      expect(fxCount(k, 0, 500, false)).toBe(0);
      expect(fxCount(k, Number.NaN, 500, false)).toBe(0);
    }
  });

  it('seeds exactly from a seed, inside the box', () => {
    const a = seedFx('confetti', 20, 400, 600, seededRandom(3));
    const b = seedFx('confetti', 20, 400, 600, seededRandom(3));
    expect(a).toEqual(b);
    for (const p of seedFx('snow', 30, 400, 600, seededRandom(5))) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(600);
    }
  });

  it('snow and confetti fall, hearts and notes rise; a bit that leaves starts again in the box', () => {
    for (const k of ['snow', 'confetti', 'hearts', 'notes'] as const) {
      const rnd = seededRandom(9);
      const bits = seedFx(k, 12, 400, 600, rnd);
      const y0 = bits.map((b) => b.y);
      stepFx(k, bits, 0.05, 400, 600, 1, false, rnd);
      const moved = bits.map((b, i) => b.y - y0[i]);
      const mean = moved.reduce((s, v) => s + v, 0) / moved.length;
      if (k === 'snow' || k === 'confetti') expect(mean, k).toBeGreaterThan(0);
      else expect(mean, k).toBeLessThan(0);
      // Run long enough for every bit to wrap many times: all stay near the box.
      for (let s = 0; s < 2000; s++) stepFx(k, bits, 0.05, 400, 600, s * 0.05, false, rnd);
      for (const b of bits) {
        expect(b.y, k).toBeGreaterThan(-600 * 0.3);
        expect(b.y, k).toBeLessThan(600 + 40);
        expect(b.x, k).toBeGreaterThan(-60);
        expect(b.x, k).toBeLessThan(460);
      }
    }
  });

  it('reduced motion softens (slower), never stops', () => {
    const full = seedFx('snow', 1, 400, 600, seededRandom(2));
    const soft = seedFx('snow', 1, 400, 600, seededRandom(2));
    stepFx('snow', full, 0.05, 400, 600, 0, false, seededRandom(1));
    stepFx('snow', soft, 0.05, 400, 600, 0, true, seededRandom(1));
    const y = seedFx('snow', 1, 400, 600, seededRandom(2))[0].y;
    expect(soft[0].y - y).toBeGreaterThan(0);
    expect(soft[0].y - y).toBeCloseTo((full[0].y - y) * SOFT_SPEED, 5);
  });

  it('fades hearts and notes out near the top; stage lights sweep, and hold still under reduced motion', () => {
    const b = { x: 0, y: 0, vx: 0, vy: 0, r: 8, rot: 0, vrot: 0, phase: 0, hue: 0 };
    expect(fxAlpha('hearts', { ...b, y: 0 }, 600)).toBe(0);
    expect(fxAlpha('hearts', { ...b, y: 400 }, 600)).toBeCloseTo(0.9);
    expect(fxAlpha('snow', b, 600)).toBeGreaterThan(0.4);
    const a = spotBeams(0, false);
    const c = spotBeams(1.5, false);
    expect(a.left).not.toBeCloseTo(c.left);
    expect(spotBeams(0, true)).toEqual(spotBeams(9, true));
    for (let t = 0; t < 20; t += 0.37) {
      const s = spotBeams(t, false);
      expect(s.left).toBeGreaterThan(0.1);
      expect(s.left).toBeLessThan(0.6);
      expect(s.glow).toBeGreaterThan(0.6);
    }
  });
});
