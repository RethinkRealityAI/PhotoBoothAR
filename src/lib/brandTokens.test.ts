import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALL_FIELDS, CARD_FIELDS, COLOR_TOKENS, TEXT_FIELDS, cardOver, composite, contrastRatio, panelOver, tokenHex, tokenValue,
} from './brandTokens';

const css = readFileSync(resolve(__dirname, '../styles/brand.css'), 'utf8');
const norm = (v: string) => v.replace(/\s+/g, '').toUpperCase();

describe('brandTokens', () => {
  it('mirrors every colour declared in src/styles/brand.css', () => {
    for (const t of COLOR_TOKENS) {
      const m = new RegExp(`${t.cssVar}:\\s*([^;]+);`).exec(css);
      expect(m?.[1] === undefined ? undefined : norm(m[1]), t.cssVar).toBe(norm(t.value));
    }
  });

  it('scopes the tokens to [data-brand="2"] so the platform is untouched', () => {
    expect(css).toMatch(/\[data-brand="2"\]\s*\{[^}]*--bw-bg:/);
    expect(css).not.toMatch(/:root\s*\{/);
  });

  it('computes WCAG contrast, compositing a translucent foreground', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(composite('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080');
    expect(contrastRatio('rgba(0, 0, 0, 0)', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(() => contrastRatio('#FFFFFF', 'rgba(0, 0, 0, 0.5)')).toThrow();
  });

  it('keeps the field one gentle hue family (no multi-hue scene)', () => {
    const hue = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const hues = ALL_FIELDS.map((f) => hue(tokenHex(f)));
    expect(Math.max(...hues) - Math.min(...hues)).toBeLessThan(12);
  });

  it('white copy meets AA on the glass panel over every field stop the copy can sit on', () => {
    for (const f of TEXT_FIELDS) {
      const panel = panelOver(tokenHex(f));
      expect(contrastRatio(tokenValue('--bw-ink'), panel), `ink on ${f}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokenValue('--bw-muted'), panel), `ink 2 on ${f}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('large display type meets 3:1 on the panel over ANY field stop', () => {
    for (const f of ALL_FIELDS) {
      expect(contrastRatio(tokenValue('--bw-ink'), panelOver(tokenHex(f))), f).toBeGreaterThanOrEqual(3);
    }
  });

  it('glass cards keep body text at AA where cards are placed', () => {
    for (const f of CARD_FIELDS) {
      const card = cardOver(tokenHex(f));
      expect(contrastRatio(tokenValue('--bw-ink'), card), `ink on card over ${f}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokenValue('--bw-muted'), card), `ink 2 on card over ${f}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('meets AA on light surfaces: the primary button and selected states', () => {
    for (const fill of ['--bw-accent', '--bw-accent-hover', '--bw-accent-pressed']) {
      expect(contrastRatio(tokenHex('--bw-on-accent'), tokenHex(fill)), fill).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(tokenHex('--bw-on-light'), '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    // Selected cards re-point --bw-muted to this (brand.css).
    expect(css).toContain('--bw-muted: rgba(26, 23, 64, 0.74);');
    expect(contrastRatio('rgba(26, 23, 64, 0.74)', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the core, success and danger marks at 3:1 (UI) on the glass', () => {
    for (const f of CARD_FIELDS) {
      const panel = panelOver(tokenHex(f));
      for (const t of ['--bw-core', '--bw-success', '--bw-danger']) {
        expect(contrastRatio(tokenHex(t), panel), `${t} over ${f}`).toBeGreaterThanOrEqual(3);
      }
      // The secondary button's outline is its only boundary.
      expect(contrastRatio('rgba(255, 255, 255, 0.72)', panel), `outline over ${f}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses no gradient fills on buttons, text, borders, cards or chips', () => {
    const rules = css.split('}').filter((r) => /\.bw-(btn|glass-chip|glass-card|link|navlink|display|h2|h3|wordmark|label|body|eyebrow|pill|card)/.test(r));
    expect(rules.length).toBeGreaterThan(10);
    for (const r of rules) expect(r, r).not.toMatch(/gradient/);
  });

  it('gives the glass a solid fallback where backdrop-filter is unsupported', () => {
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  });
});
