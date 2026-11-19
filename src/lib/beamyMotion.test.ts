import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTENT_MOTION_CLASSES, motionAttrs, motionLevel } from './beamyMotion';

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
});
