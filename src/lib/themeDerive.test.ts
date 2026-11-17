import { describe, it, expect } from 'vitest';
import { THEME_TOKEN_KEYS, contrastRatio, deriveTheme, normalizeHex, normalizePalette, readableOn } from './themeDerive';
import { rgbToHsl } from './studio/colorways';
import { ACCENT_SWATCHES } from './eventTemplates';

const hue = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255)[0];
};
const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// A spread of real picks: every curated swatch, plus awkward ones (near-black,
// pure white, mid grey, a dark navy that fails 3:1 on a dark background).
const PICKS = [...ACCENT_SWATCHES, '#000000', '#FFFFFF', '#808080', '#1F3A5F', '#B0223B', '#FFFF00', '#0000FF'];

describe('normalizeHex', () => {
  it('accepts #RRGGBB in any case and trims; rejects everything else', () => {
    expect(normalizeHex(' #d4af37 ')).toBe('#D4AF37');
    expect(normalizeHex('#FFF')).toBeNull();
    expect(normalizeHex('d4af37')).toBeNull();
    expect(normalizeHex(42)).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG endpoints', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe('readableOn', () => {
  it('always returns a colour meeting the requested minimum', () => {
    for (const bg of ['#000000', '#FFFFFF', '#1A1A1A', '#F0F0F0', '#7F7F7F']) {
      const c = readableOn(bg, 40, 0.3, 0.5, 4.5);
      expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('deriveTheme', () => {
  it('returns null for a non-hex input', () => {
    expect(deriveTheme('gold')).toBeNull();
    expect(deriveTheme('#FFF')).toBeNull();
  });

  for (const mode of ['dark', 'light'] as const) {
    it(`${mode}: all 8 tokens, WCAG-safe pairings, hue kept, for every pick`, () => {
      for (const pick of PICKS) {
        const t = deriveTheme(pick, mode)!;
        expect(Object.keys(t).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
        const bg = t['--color-brand-bg'];
        expect(contrastRatio(t['--color-brand-fg'], bg), `${pick} fg`).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(t['--color-brand-muted'], bg), `${pick} muted`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t['--color-accent'], bg), `${pick} accent`).toBeGreaterThanOrEqual(3);
        for (const k of THEME_TOKEN_KEYS) {
          if (k === '--accent-rgb') expect(t[k]).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
          else expect(t[k], `${pick} ${k}`).toMatch(/^#[0-9A-F]{6}$/);
        }
        // Saturated picks keep their hue (within rounding of the 8-bit round trip).
        const [, s] = (() => {
          const n = Number.parseInt(pick.slice(1), 16);
          return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
        })();
        if (s > 0.2) expect(hueDist(hue(t['--color-accent']), hue(pick)), pick).toBeLessThan(4);
      }
    });
  }

  it('keeps the exact colour when it already reads on the background', () => {
    expect(deriveTheme('#D4AF37', 'dark')!['--color-accent']).toBe('#D4AF37');
  });

  it('a greyscale pick gives neutral (untinted) backgrounds', () => {
    const t = deriveTheme('#C0C0C0', 'dark')!;
    const n = Number.parseInt(t['--color-brand-bg'].slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
  });

  it('dark mode gives a dark background, light mode a light one', () => {
    expect(contrastRatio(deriveTheme('#2FDD8B', 'dark')!['--color-brand-bg'], '#000000')).toBeLessThan(1.5);
    expect(contrastRatio(deriveTheme('#2FDD8B', 'light')!['--color-brand-bg'], '#FFFFFF')).toBeLessThan(1.2);
  });
});

describe('normalizePalette', () => {
  it('keeps valid hexes (uppercased), nulls the rest', () => {
    expect(normalizePalette({ bg: '#0a0806', fg: 'white', accent: '#d4af37', accent2: 7 })).toEqual({
      bg: '#0A0806', surface: null, fg: null, accent: '#D4AF37', accent2: null,
    });
  });
  it('null when nothing usable or not an object', () => {
    expect(normalizePalette({ bg: 'navy' })).toBeNull();
    expect(normalizePalette(null)).toBeNull();
    expect(normalizePalette('#D4AF37')).toBeNull();
    expect(normalizePalette(['#D4AF37'])).toBeNull();
  });
});
