import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONTENT_MOTION_CLASSES, MIN_CUE_GAP_MS, currentCue, motionAttrs, motionLevel, nextChange, passAt, phaseAt, reached, sequence,
} from './beamyMotion';

/** Every rule's selector inside `@media (prefers-reduced-motion: reduce)` blocks. */
function reducedSelectors(css: string): string[] {
  const out: string[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    let sel = '';
    for (; i < clean.length && depth > 0; i++) {
      const c = clean[i];
      if (c === '{') { if (depth === 1) out.push(sel.trim()); depth++; sel = ''; }
      else if (c === '}') { depth--; sel = ''; }
      else if (depth === 1) sel += c;
    }
  }
  return out;
}

/** Selectors in that block that name a content class. */
function contentOffenders(css: string): string[] {
  return reducedSelectors(css).filter((s) => CONTENT_MOTION_CLASSES.some((c) => new RegExp(`\\.${c.replace(/-/g, '\\-')}`).test(s)));
}

describe('beamyMotion', () => {
  it('never turns content off, never softens decor', () => {
    expect(motionLevel('content', false)).toBe('full');
    expect(motionLevel('content', true)).toBe('soft');
    expect(motionLevel('decor', false)).toBe('full');
    expect(motionLevel('decor', true)).toBe('off');
    for (const r of [false, true]) expect(motionLevel('content', r)).not.toBe('off');
    expect(motionAttrs(true)).toEqual({ 'data-content-motion': 'soft', 'data-decor-motion': 'off' });
    expect(motionAttrs(false)).toEqual({ 'data-content-motion': 'full', 'data-decor-motion': 'full' });
  });

  it('finds content rules in a reduced-motion block (negative control)', () => {
    const bad = `.a { color: red; }
@media (prefers-reduced-motion: reduce) {
  [data-brand="2"] .bw-float { animation: none; }
  /* a comment { with braces } */
  [data-brand="2"] .bw-scene[data-on="true"] .bw-ch-bell { animation: none; }
  [data-brand="2"] .bw-ks-fly { display: none; }
}`;
    expect(reducedSelectors(bad)).toHaveLength(3);
    expect(contentOffenders(bad)).toEqual(['[data-brand="2"] .bw-scene[data-on="true"] .bw-ch-bell', '[data-brand="2"] .bw-ks-fly']);
  });

  it('the /beamy reduced-motion CSS touches decor only, never the story (the Chrome bug)', () => {
    const css = readFileSync(resolve(__dirname, '../styles/brand.css'), 'utf8');
    expect(reducedSelectors(css).length).toBeGreaterThan(5);
    expect(contentOffenders(css)).toEqual([]);
  });

  describe('sequencer', () => {
    const s = sequence([['a', 500], ['b', 1000], ['c', 2000]]);
    it('starts cues one at a time, in order, and holds the last frame', () => {
      expect([0, 499, 500, 999, 1000, 1999, 2000, 99999].map((t) => phaseAt(s, t))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
      expect(reached(s, 2, 'a')).toBe(true);
      expect(reached(s, 2, 'b')).toBe(true);
      expect(reached(s, 2, 'c')).toBe(false);
      expect(reached(s, 3, 'nope')).toBe(false);
      expect(currentCue(s, 0)).toBeNull();
      expect(currentCue(s, 2)).toBe('b');
      expect(nextChange(s, 0)).toBe(500);
      expect(nextChange(s, 700)).toBe(300);
      expect(nextChange(s, 2000)).toBeNull();
      expect(passAt(s, 99999)).toBe(0);
    });
    it('a looping sequence wraps to nothing shown, then plays again', () => {
      const l = sequence([['a', 500], ['b', 1000]], 3000);
      expect([0, 600, 1200, 2999, 3000, 3600].map((t) => phaseAt(l, t))).toEqual([0, 1, 2, 2, 0, 1]);
      expect(nextChange(l, 1200)).toBe(1800);
      expect(passAt(l, 3600)).toBe(1);
    });
    it('refuses timelines that would show things all at once or out of order', () => {
      expect(() => sequence([['a', 500], ['b', 500 + MIN_CUE_GAP_MS - 1]])).toThrow(/crowds/);
      expect(() => sequence([['a', 900], ['b', 500]])).toThrow();
      expect(() => sequence([['a', 0]])).toThrow(/after entry/);
      expect(() => sequence([['a', 500], ['a', 1500]])).toThrow(/duplicate/);
      expect(() => sequence([['a', 500]], 400)).toThrow(/loop/);
    });
  });
});
