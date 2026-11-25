import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_PACKS, normalizeEventTheme, themePackById, themePackVars, themeTone } from './themePacks';
import { THEME_TOKEN_KEYS } from './themeDerive';
import { composite, contrastRatio } from './brandTokens';
import { GUIDES } from './guidesContent';

const HEX = /^#[0-9A-F]{6}$/;

describe('theme pack registry', () => {
  it('has unique ids and every colour token is an uppercase hex', () => {
    const ids = THEME_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of THEME_PACKS) {
      for (const v of Object.values(p.colors)) expect(v, `${p.id}`).toMatch(HEX);
      expect(p.swatches.length).toBeGreaterThan(0);
    }
  });

  it('only self-hosts its fonts (no runtime Google Fonts on guest pages)', () => {
    for (const p of THEME_PACKS) {
      expect(p.fonts.href.startsWith('/') && !p.fonts.href.startsWith('//'), p.id).toBe(true);
      const sheet = resolve(__dirname, '../../public', p.fonts.href.slice(1));
      expect(existsSync(sheet), `${sheet} is missing`).toBe(true);
      const css = readFileSync(sheet, 'utf8');
      expect(css).not.toMatch(/url\((?!\/fonts\/)|@import/);
      for (const m of css.matchAll(/url\((\/fonts\/[^)]+)\)/g)) {
        expect(existsSync(resolve(__dirname, '../../public', m[1].slice(1))), m[1]).toBe(true);
      }
    }
  });

  it('is named in the host guides (a new pack ships with its guides line)', () => {
    const text = JSON.stringify(GUIDES);
    for (const p of THEME_PACKS) expect(text, `guides never mention "${p.name}"`).toContain(p.name);
  });
});

describe('theme pack contrast (WCAG AA)', () => {
  for (const p of THEME_PACKS) {
    describe(p.name, () => {
      const c = p.colors;
      it('body text and muted text read on the background', () => {
        expect(contrastRatio(c.brandFg, c.brandBg)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(c.brandMuted, c.brandBg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.brandFg, c.brandSurface)).toBeGreaterThanOrEqual(7);
      });
      it('the CTA label reads on the darkest metal in its fill', () => {
        expect(contrastRatio(p.chrome.ctaInk, p.chrome.ctaSolid)).toBeGreaterThanOrEqual(4.5);
      });
      it('ink on the accent (bg-foil buttons, the classic shutter) reads', () => {
        const ink = themePackVars({ pack: p.id })!['--on-accent'];
        expect(contrastRatio(ink, c.accent)).toBeGreaterThanOrEqual(4.5);
      });
      it('text on glass reads over every field the scene puts text on', () => {
        for (const field of p.textFields) {
          expect(contrastRatio(c.brandFg, field), field).toBeGreaterThanOrEqual(4.5);
          const glass = composite(p.chrome.glass, field);
          expect(contrastRatio(c.brandFg, glass), `glass over ${field}`).toBeGreaterThanOrEqual(7);
          expect(contrastRatio(c.brandMuted, glass), `muted on glass over ${field}`).toBeGreaterThanOrEqual(4.5);
        }
      });
      it('the accent is visible as a UI colour on the background (3:1)', () => {
        expect(contrastRatio(c.accent, c.brandBg)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});

describe('normalizeEventTheme', () => {
  it('keeps a known pack and drops everything else', () => {
    expect(normalizeEventTheme({ pack: 'island-golden-hour' })).toEqual({ pack: 'island-golden-hour' });
    expect(normalizeEventTheme({ pack: 'island-golden-hour', extra: 1 })).toEqual({ pack: 'island-golden-hour' });
  });
  it('is total: absent, null, wrong shapes and unknown packs are undefined', () => {
    for (const raw of [undefined, null, '', 'island-golden-hour', 3, [], {}, { pack: 'nope' }, { pack: 7 }]) {
      expect(normalizeEventTheme(raw)).toBeUndefined();
    }
  });
  it('keeps only valid hex colour overrides, uppercased', () => {
    expect(normalizeEventTheme({
      pack: 'island-golden-hour',
      colors: { accent: '#c0ffee', brandBg: 'red', brandFg: ' #ffffff ', bogus: '#000000' },
    })).toEqual({ pack: 'island-golden-hour', colors: { accent: '#C0FFEE', brandFg: '#FFFFFF' } });
    expect(normalizeEventTheme({ pack: 'island-golden-hour', colors: { accent: 'nope' } })).toEqual({ pack: 'island-golden-hour' });
  });
});

describe('themePackVars', () => {
  it('sets all 8 theme tokens plus the chrome, fonts and legacy scale tokens', () => {
    const vars = themePackVars({ pack: 'island-golden-hour' })!;
    for (const k of THEME_TOKEN_KEYS) expect(vars[k], k).toBeTruthy();
    for (const k of ['--tp-glass', '--tp-cta-bg', '--tp-cta-ink', '--tp-shutter-core', '--tp-font-display', '--font-serif', '--color-gold-400', '--color-ivory', '--on-accent']) {
      expect(vars[k], k).toBeTruthy();
    }
    expect(vars['--accent-rgb']).toBe('226, 176, 74');
  });
  it('lets a host colour override win and re-derives accent-rgb from it', () => {
    const vars = themePackVars({ pack: 'island-golden-hour', colors: { accent: '#102030' } })!;
    expect(vars['--color-accent']).toBe('#102030');
    expect(vars['--accent-rgb']).toBe('16, 32, 48');
    expect(vars['--on-accent']).toBe('#F7F1E3');
  });
  it('is null for no theme or an unknown pack', () => {
    expect(themePackVars(undefined)).toBeNull();
    expect(themePackVars({ pack: 'nope' })).toBeNull();
  });
  it('never emits a value that could break out of the injected rule', () => {
    for (const p of THEME_PACKS) {
      for (const v of Object.values(themePackVars({ pack: p.id })!)) expect(v).not.toMatch(/[;{}<>]/);
    }
  });
});

describe('lookups', () => {
  it('themePackById / themeTone', () => {
    expect(themePackById('island-golden-hour')?.name).toBe('Island Golden Hour');
    expect(themePackById('x')).toBeUndefined();
    expect(themeTone({ pack: 'island-golden-hour' })).toBe('dark');
    expect(themeTone(undefined)).toBeUndefined();
  });
});
