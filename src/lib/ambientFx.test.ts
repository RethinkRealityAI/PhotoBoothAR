import { describe, expect, it } from 'vitest';
import { SNOW_LOOKS, ambientCount, ambientFor, moteAlpha, seedMotes, stepMotes } from './ambientFx';
import { BEAMY_LOOKS } from './beamyLooks';
import { seededRandom } from './brandLanding';

describe('ambient decor', () => {
  it('snows on every Christmas hero look and glints on the rest', () => {
    expect(ambientFor('holiday')).toBe('snow');
    expect(ambientFor('glasses')).toBe('glint');
    expect(ambientFor(undefined)).toBe('glint');
    // Every snow id is a real hero look (a renamed look would silently stop snowing).
    const ids = BEAMY_LOOKS.map((l) => l.id);
    for (const id of SNOW_LOOKS) expect(ids, id).toContain(id);
  });

  it('keeps counts low, scales with the box, and draws nothing under reduced motion', () => {
    expect(ambientCount('snow', 390, 700, false)).toBeGreaterThanOrEqual(14);
    expect(ambientCount('snow', 1440, 800, false)).toBeLessThanOrEqual(48);
    expect(ambientCount('glint', 1440, 800, false)).toBeLessThanOrEqual(18);
    expect(ambientCount('snow', 390, 700, true)).toBe(0);
    expect(ambientCount('glint', 1440, 800, true)).toBe(0);
    expect(ambientCount('snow', 0, 700, false)).toBe(0);
  });

  it('lets snow fall and wrap inside the box; glints hold still and twinkle within 0..1', () => {
    const w = 400, h = 600;
    const snow = seedMotes('snow', 30, w, h, seededRandom(7));
    const y0 = snow.map((m) => m.y);
    stepMotes('snow', snow, 0.05, w, h, 0);
    expect(snow.filter((m, k) => m.y > y0[k]).length).toBeGreaterThan(20);
    for (let k = 0; k < 2000; k++) stepMotes('snow', snow, 0.05, w, h, k * 0.05);
    for (const m of snow) {
      expect(m.y).toBeLessThanOrEqual(h + m.r);
      expect(m.x).toBeGreaterThanOrEqual(-m.r);
      expect(m.x).toBeLessThanOrEqual(w + m.r);
    }
    const gl = seedMotes('glint', 10, w, h, seededRandom(3));
    const at = gl.map((m) => [m.x, m.y]);
    stepMotes('glint', gl, 0.05, w, h, 1);
    expect(gl.map((m) => [m.x, m.y])).toEqual(at);
    for (let t = 0; t < 10; t += 0.37) for (const m of gl) {
      const a = moteAlpha('glint', m, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});
