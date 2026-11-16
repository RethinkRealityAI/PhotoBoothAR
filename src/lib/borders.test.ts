import { describe, it, expect } from 'vitest';
import {
  BUILTIN_BORDERS,
  BORDER_MAP,
  FRAME_COLOR_TOKENS,
  GENERIC_FRAMES,
  frameColorMap,
  frameDataUrl,
  recolorFrameSvg,
  replaceColorTokens,
  toDataUrl,
} from './borders';

describe('built-in frames — byte identity with no palette', () => {
  it('every built-in renders exactly as before when no palette is given', () => {
    for (const b of BUILTIN_BORDERS) {
      expect(recolorFrameSvg(b), b.id).toBe(b.svg);
      expect(recolorFrameSvg(b, null), b.id).toBe(b.svg);
      expect(frameDataUrl(b), b.id).toBe(toDataUrl(b.svg));
    }
  });

  it('an identity colour map leaves every built-in byte-identical', () => {
    for (const b of BUILTIN_BORDERS) {
      const identity: Record<string, string> = {};
      for (const hex of b.svg.match(/#[0-9A-Fa-f]{6}\b/g) ?? []) identity[hex.toUpperCase()] = hex;
      expect(replaceColorTokens(b.svg, identity), b.id).toBe(b.svg);
    }
  });

  it('an invalid accent falls back to the art as drawn', () => {
    const b = BORDER_MAP['dw-frame-classic'];
    expect(recolorFrameSvg(b, { accent: 'gold' })).toBe(b.svg);
  });

  it('legacy frames never recolour, even with a palette', () => {
    for (const b of BUILTIN_BORDERS.filter((x) => x.legacy)) {
      expect(b.recolor, b.id).toBeUndefined();
      expect(recolorFrameSvg(b, { accent: '#2FDD8B' }), b.id).toBe(b.svg);
    }
  });
});

describe('recolouring', () => {
  it('every generic frame is recolourable and tagged with occasions', () => {
    for (const { id } of GENERIC_FRAMES) {
      const b = BORDER_MAP[id];
      expect(b, id).toBeDefined();
      expect(b.recolor, id).toBeDefined();
      expect(b.occasions?.length ?? 0, id).toBeGreaterThan(0);
    }
  });

  it('a recolourable frame really uses its family tokens, and they all get replaced', () => {
    for (const b of BUILTIN_BORDERS.filter((x) => x.recolor)) {
      const tokens = FRAME_COLOR_TOKENS[b.recolor!];
      const present = tokens.filter((t) => b.svg.toUpperCase().includes(t));
      expect(present.length, b.id).toBeGreaterThan(0);
      const out = recolorFrameSvg(b, { accent: '#2FDD8B' }).toUpperCase();
      expect(out, b.id).not.toBe(b.svg.toUpperCase());
      for (const t of tokens) expect(out.includes(t), `${b.id} still has ${t}`).toBe(false);
      expect(out).toContain('#2FDD8B');
    }
  });

  it('gold map: accent is the base stop, explicit accent2 is honoured', () => {
    const m = frameColorMap('gold', { accent: '#2fdd8b', accent2: '#ffffff' })!;
    expect(m['#D4AF37']).toBe('#2FDD8B');
    expect(m['#E8C766']).toBe('#FFFFFF');
    for (const t of FRAME_COLOR_TOKENS.gold) expect(m[t]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('neon map keeps three distinct colours', () => {
    const m = frameColorMap('neon', { accent: '#FF6FD6' })!;
    expect(new Set(FRAME_COLOR_TOKENS.neon.map((t) => m[t])).size).toBe(3);
  });

  it('svg strings themselves are never rewritten (ids and art unchanged)', () => {
    const before = BUILTIN_BORDERS.map((b) => b.id + b.svg.length);
    recolorFrameSvg(BORDER_MAP['jj-neon-frame'], { accent: '#19E3FF' });
    expect(BUILTIN_BORDERS.map((b) => b.id + b.svg.length)).toEqual(before);
  });
});
