import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLOR_TOKENS, contrastRatio, tokenHex } from './brandTokens';

const css = readFileSync(resolve(__dirname, '../styles/brand.css'), 'utf8');

describe('brandTokens', () => {
  it('mirrors every colour declared in src/styles/brand.css', () => {
    for (const t of COLOR_TOKENS) {
      const m = new RegExp(`${t.cssVar}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
      expect(m?.[1]?.toUpperCase(), t.cssVar).toBe(t.hex.toUpperCase());
    }
  });

  it('scopes the tokens to [data-brand="2"] so the platform is untouched', () => {
    expect(css).toMatch(/\[data-brand="2"\]\s*\{[^}]*--bw-bg:/);
    expect(css).not.toMatch(/:root\s*\{/);
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('meets AA for body text and the CTA label', () => {
    const bg = tokenHex('--bw-bg');
    for (const surface of [bg, tokenHex('--bw-surface'), tokenHex('--bw-surface-2')]) {
      expect(contrastRatio(tokenHex('--bw-ink'), surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokenHex('--bw-muted'), surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const fill of ['--bw-accent', '--bw-accent-hover', '--bw-accent-pressed']) {
      expect(contrastRatio(tokenHex('--bw-on-accent'), tokenHex(fill)), fill).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses no gradient fills on buttons, text or borders', () => {
    const rules = css.split('}').filter((r) => /\.bw-(btn|pill|link|card|display|h2|h3|wordmark|label|body)/.test(r));
    for (const r of rules) expect(r, r).not.toMatch(/gradient/);
  });
});
