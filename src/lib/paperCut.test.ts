import { describe, expect, it } from 'vitest';
import { leaf, palmFrond, palmTrunk, polygon, tornLeaf, waveBand } from './paperCut';

/** Every number in a path is finite and the path closes. */
function wellFormed(d: string) {
  expect(d.length).toBeGreaterThan(0);
  const nums = d.match(/-?\d+(\.\d+)?(e-?\d+)?|NaN|Infinity/g) ?? [];
  for (const n of nums) expect(Number.isFinite(Number(n)), `${n} in ${d.slice(0, 60)}`).toBe(true);
  expect(d.trim().endsWith('Z')).toBe(true);
}

describe('paper-cut geometry', () => {
  it('polygon closes and is empty for no points', () => {
    expect(polygon([[0, 0], [1, 0], [1, 1]])).toBe('M0,0L1,0L1,1Z');
    expect(polygon([])).toBe('');
  });

  it('a frond is one closed piece with 2n leaflet tips plus spine points', () => {
    const d = palmFrond([100, 100], -60, 150, 40, 30, 10);
    wellFormed(d);
    // origin + 2 points per leaflet per side + tip
    expect(d.split('L').length).toBe(1 + 2 * 10 * 2 + 1);
    expect(d).toBe(palmFrond([100, 100], -60, 150, 40, 30, 10)); // deterministic
  });

  it('a trunk returns an outline and ring cuts', () => {
    const t = palmTrunk([100, 600], [180, 150], -40, 30, 14, 10);
    wellFormed(t.outline);
    expect(t.rings.split('M').filter(Boolean)).toHaveLength(9);
  });

  it('a torn leaf is many separate closed strips', () => {
    const d = tornLeaf([0, 0], -30, 200, 30, 40, 7);
    expect(d.split('Z').filter(Boolean)).toHaveLength(14);
    wellFormed(d);
  });

  it('a leaf and a wave band are closed and finite', () => {
    wellFormed(leaf([0, 0], 45, 80, 20));
    const w = waveBand(1600, 300, 120, 30, 160, 0.3);
    wellFormed(w);
    expect(w.startsWith('M0,300')).toBe(true);
  });
});
