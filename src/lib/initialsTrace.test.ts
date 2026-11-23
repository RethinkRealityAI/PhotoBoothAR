import { describe, expect, it } from 'vitest';
import { CARD_DESIGN_IDS } from './cardDesigns';
import {
  DESIGN_LETTERING,
  GLYPHS,
  initialsComplete,
  initialsLayout,
  initialsLift,
  initialsLitPath,
  initialsOf,
  initialsProgress,
  initialsStep,
  LETTER_STYLES,
  newInitialsTrace,
  type InitialsLayout,
  type InitialsTrace,
} from './initialsTrace';

/** Run a finger along every stroke of the layout, one bin at a time. */
function traceAll(layout: InitialsLayout, every = 1): InitialsTrace {
  let st = newInitialsTrace(layout);
  for (const s of layout.strokes) {
    for (let i = 0; i < s.bins.length; i += every) st = initialsStep(st, layout, s.bins[i]);
    st = initialsLift(st);
  }
  return st;
}

describe('initialsOf', () => {
  it('takes first and last names, strips accents, keeps capitals', () => {
    expect(initialsOf('Zara')).toBe('Z');
    expect(initialsOf('Mummy Funke')).toBe('MF');
    expect(initialsOf('  émile   de la zoë ')).toBe('EZ');
    expect(initialsOf('Mary-Jane Watson')).toBe('MW');
    expect(initialsOf("O'Brien")).toBe('O');
  });

  it('is null when nothing is traceable', () => {
    expect(initialsOf(null)).toBeNull();
    expect(initialsOf('')).toBeNull();
    expect(initialsOf('   ')).toBeNull();
    expect(initialsOf('张伟')).toBeNull();
    expect(initialsOf('123')).toBeNull();
  });
});

describe('initialsLayout', () => {
  it('lays out every capital, centred and inside the safe middle of a phone', () => {
    for (const ch of Object.keys(GLYPHS)) {
      for (const letters of [ch, `${ch}W`]) {
        const l = initialsLayout(letters)!;
        expect(l.strokes.length).toBeGreaterThan(0);
        const xs = l.strokes.flatMap((s) => s.bins.map((b) => b.x));
        const ys = l.strokes.flatMap((s) => s.bins.map((b) => b.y));
        for (const v of [...xs, ...ys]) expect(Number.isFinite(v)).toBe(true);
        expect(Math.min(...xs)).toBeGreaterThan(130);
        expect(Math.max(...xs)).toBeLessThan(770);
        expect(Math.min(...ys)).toBeGreaterThan(520);
        expect(Math.max(...ys)).toBeLessThan(1000);
        for (const s of l.strokes) expect(s.d).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('is null for nothing traceable', () => {
    expect(initialsLayout(null)).toBeNull();
    expect(initialsLayout('12')).toBeNull();
  });
});

describe('tracing the initials', () => {
  const layout = initialsLayout('MF')!;

  it('starts dark and opens once (almost) all of it is traced', () => {
    expect(initialsProgress(newInitialsTrace(layout))).toBe(0);
    const done = traceAll(layout);
    expect(initialsProgress(done)).toBe(1);
    expect(initialsComplete(done)).toBe(true);
  });

  it('a fast finger (skipping bins) still fills each stroke', () => {
    expect(initialsComplete(traceAll(layout, 4))).toBe(true);
  });

  it('one letter is not enough for two', () => {
    let st = newInitialsTrace(layout);
    const m = layout.strokes.slice(0, GLYPHS.M.strokes.length);
    for (const s of m) for (const p of s.bins) st = initialsStep(st, layout, p);
    expect(initialsComplete(st)).toBe(false);
  });

  it('scribbling across the middle does not open it', () => {
    let st = newInitialsTrace(layout);
    for (let i = 0; i < 6; i++) {
      for (let x = 150; x <= 750; x += 25) st = initialsStep(st, layout, { x, y: 600 + i * 70 });
      st = initialsLift(st);
    }
    expect(initialsComplete(st)).toBe(false);
  });

  it('far from the letters nothing lights, and non-finite points are ignored', () => {
    const st = newInitialsTrace(layout);
    expect(initialsStep(st, layout, { x: 450, y: 1500 })).toBe(st);
    expect(initialsStep(st, layout, { x: NaN, y: 700 })).toBe(st);
  });

  it('draws the lit runs as a path', () => {
    expect(initialsLitPath(layout, newInitialsTrace(layout))).toBe('');
    expect(initialsLitPath(layout, traceAll(layout))).toMatch(/^M/);
  });
});

describe('lettering', () => {
  it('every design writes them in a known hand', () => {
    expect(Object.keys(DESIGN_LETTERING).sort()).toEqual([...CARD_DESIGN_IDS].sort());
    for (const s of Object.values(DESIGN_LETTERING)) expect(LETTER_STYLES).toContain(s);
  });
});
