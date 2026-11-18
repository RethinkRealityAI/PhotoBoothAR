import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { STORY_LOOKS, lookThumb, qrModules, storySceneLines } from './beamyStory';
import { EMOJI_RE } from './brandLanding';

describe('beamyStory', () => {
  it('keeps the scene copy short and on-brand', () => {
    for (const l of storySceneLines()) {
      expect(l.length, l).toBeGreaterThan(0);
      expect(l.length, l).toBeLessThanOrEqual(28);
      expect(l, l).not.toMatch(EMOJI_RE);
      expect(l, l).not.toMatch(/—|–/);
      expect(l, l).not.toMatch(/\bstudio\b/i);
      expect(l, l).not.toMatch(/on[- ]site|in person|at your venue|technician|attendant|printed|print|physical/i);
    }
  });

  it('cycles real assets in the AR step, each with a thumbnail that exists', () => {
    expect(STORY_LOOKS.length).toBeGreaterThanOrEqual(4);
    expect(STORY_LOOKS.some((l) => l.kind === 'frame')).toBe(true);
    for (const l of STORY_LOOKS) {
      const t = lookThumb(l);
      expect(t, l.id).not.toBeNull();
      expect(existsSync(resolve(__dirname, '../../public', `.${t}`)), String(t)).toBe(true);
    }
  });

  it('draws a stable code with the three finder squares', () => {
    const g = qrModules(21, 7);
    expect(g.length).toBe(21);
    expect(g.every((r) => r.length === 21)).toBe(true);
    expect(qrModules(21, 7)).toEqual(g);
    for (const [fx, fy] of [[0, 0], [14, 0], [0, 14]]) {
      expect(g[fy][fx]).toBe(true); // outer ring
      expect(g[fy + 1][fx + 1]).toBe(false); // gap ring
      expect(g[fy + 3][fx + 3]).toBe(true); // centre
    }
    expect(g[7][7]).toBe(false); // quiet ring beside the top-left finder
    const fill = g.flat().filter(Boolean).length / (21 * 21);
    expect(fill).toBeGreaterThan(0.35);
    expect(fill).toBeLessThan(0.65);
  });
});
