import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AR_COPY, STORY_LOOKS, STORY_SEQ, STORY_SCENE, lookThumb, qrModules, storySceneLines } from './beamyStory';
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

  it('says what the AR picker offers, on-brand', () => {
    expect(AR_COPY.line).toMatch(/frames/);
    expect(AR_COPY.line).not.toMatch(/filters/); // Looks vocabulary (owner rule)
    expect(AR_COPY.line).toMatch(/props/);
    expect(AR_COPY.line).toMatch(/effects/);
    for (const l of Object.values(AR_COPY)) {
      expect(l, l).not.toMatch(EMOJI_RE);
      expect(l, l).not.toMatch(/—|–/);
      expect(l, l).not.toMatch(/on[- ]site|in person|at your venue|technician|attendant|printed|print|physical/i);
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

  it('plays every scene in the owner’s order, one beat at a time', () => {
    const ids = (k: keyof typeof STORY_SEQ) => STORY_SEQ[k].cues.map((c) => c.id);
    expect(ids('qr')).toEqual(['hover', 'scan', 'dissolve', 'splash', 'rest']);
    expect(ids('wall')).toEqual(['flash', 'toast', 'fly', 'receive', 'beam', 'land']);
    expect(ids('medal')).toEqual(['alert', 'photo', 'sent', 'done', 'board', 'rank']);
    expect(ids('keepsake')).toEqual(['album', 'fly', 'making', 'play']);
    // The wall keeps receiving shots; the others hold their last frame.
    expect(STORY_SEQ.wall.loop).toBeGreaterThan(STORY_SEQ.wall.cues[STORY_SEQ.wall.cues.length - 1].at);
    for (const k of ['qr', 'medal', 'keepsake'] as const) expect(STORY_SEQ[k].loop).toBeUndefined();
    // The beam leaves him before the shot lands (the stage fires a mouth beam at 1.2s).
    const at = (id: string) => STORY_SEQ.wall.cues.find((c) => c.id === id)?.at ?? 0;
    expect(at('land') - at('beam')).toBeGreaterThanOrEqual(1200);
  });

  it('writes the event on its own splash screen, not in a pill', () => {
    expect(`${STORY_SCENE.qr.welcome} ${STORY_SCENE.qr.couple} ${STORY_SCENE.qr.booth}`).toBe('Welcome to Ade & Tunji’s immersive wedding booth');
    expect(STORY_SCENE.medal.done).toBe('Ada completed the challenge');
  });
});
