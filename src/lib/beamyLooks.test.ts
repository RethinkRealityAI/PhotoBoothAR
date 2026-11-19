import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BEAMY_LOOKS, fitProp, nextLook, preloadUrl } from './beamyLooks';
import { EMOJI_RE } from './brandLanding';

describe('beamyLooks', () => {
  it('opens with the greeting, then real platform assets that exist in public/', () => {
    expect(BEAMY_LOOKS[0].kind).toBe('none');
    expect(BEAMY_LOOKS[0].line).toMatch(/Beamy/);
    const worn = BEAMY_LOOKS.slice(1);
    expect(worn.length).toBeGreaterThanOrEqual(4);
    for (const l of worn) {
      expect(l.url, l.id).toBeDefined();
      expect(existsSync(resolve(__dirname, '../../public', `.${l.url}`)), l.url).toBe(true);
      if (l.kind === 'prop') expect(l.fit, l.id).toBeDefined();
    }
    // One of each kind the owner asked to see: a crown, a hat, glasses, a frame.
    for (const id of ['crown', 'hat', 'glasses', 'frame']) expect(BEAMY_LOOKS.map((l) => l.id)).toContain(id);
    expect(new Set(BEAMY_LOOKS.map((l) => l.id)).size).toBe(BEAMY_LOOKS.length);
  });

  it('keeps every line short and on-brand', () => {
    for (const l of BEAMY_LOOKS) {
      expect(l.line.length, l.line).toBeLessThanOrEqual(56);
      expect(l.line, l.line).not.toMatch(EMOJI_RE);
      expect(l.line, l.line).not.toMatch(/—|–/);
      expect(l.line, l.line).not.toMatch(/\bstudio\b/i);
      expect(l.line, l.line).not.toMatch(/on[- ]site|in person|at your venue|technician|attendant/i);
    }
    expect(BEAMY_LOOKS.some((l) => /Snapchat and Instagram/.test(l.line))).toBe(true);
  });

  it('cycles through the worn looks, the greeting only once', () => {
    const n = BEAMY_LOOKS.length;
    const seen = [0];
    let i = 0;
    for (let k = 0; k < n * 2; k++) { i = nextLook(i, n); seen.push(i); }
    expect(seen.slice(0, n)).toEqual(Array.from({ length: n }, (_, k) => k));
    expect(seen.slice(1).includes(0)).toBe(false);
    expect(nextLook(n - 1, n)).toBe(1);
    expect(nextLook(0, 1)).toBe(0);
    expect(preloadUrl(0)).toBe(BEAMY_LOOKS[1].url);
  });

  it('fits a prop box by width and pins its base or centre on the anchor', () => {
    const base = fitProp([-1, 0, -0.5], [1, 0.5, 0.5], { width: 0.3, at: [0, 0.33, 0], align: 'base' });
    expect(base.scale).toBeCloseTo(0.15, 9);
    expect(base.offset).toEqual([0, 0.33, 0]);
    // Off-centre box: its centre lands on the anchor's x/z, its base on y.
    const off = fitProp([1, 2, 3], [3, 4, 5], { width: 1, at: [0.1, 0.2, 0.3], align: 'base' });
    expect(off.scale).toBeCloseTo(0.5, 9);
    expect(off.offset[0] + 2 * off.scale).toBeCloseTo(0.1, 9);
    expect(off.offset[1] + 2 * off.scale).toBeCloseTo(0.2, 9);
    expect(off.offset[2] + 4 * off.scale).toBeCloseTo(0.3, 9);
    const mid = fitProp([0, 0, 0], [2, 2, 2], { width: 1, at: [0, 0, 0], align: 'centre' });
    expect(mid.offset[1] + 1 * mid.scale).toBeCloseTo(0, 9);
  });
});
