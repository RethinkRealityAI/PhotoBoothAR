/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  buildCardTheme,
  normalizeCardTheme,
  safeFontHref,
  hasThemeVars,
  CARD_THEME_VERSION,
} from './cardTheme';

describe('buildCardTheme', () => {
  it('snapshots coded theme vars', () => {
    const t = buildCardTheme({ themeVars: { '--color-accent': '#E8C766' } });
    expect(t.v).toBe(CARD_THEME_VERSION);
    expect(t.vars['--color-accent']).toBe('#E8C766');
  });

  it('layers branding overrides OVER coded vars, matching live precedence', () => {
    const t = buildCardTheme({
      themeVars: { '--color-accent': '#E8C766' },
      branding: { colors: { accent: '#5B8CFF' } },
    });
    expect(t.vars['--color-accent']).toBe('#5B8CFF');
  });

  it('carries the accent-derived helpers branding emits', () => {
    const t = buildCardTheme({ branding: { colors: { accent: '#5B8CFF' } } });
    expect(t.vars['--accent-rgb']).toBe('91, 140, 255');
    expect(t.vars['--on-accent']).toBeTruthy();
  });

  it('keeps the event name, trimmed', () => {
    expect(buildCardTheme({ eventName: '  Ada & Femi  ' }).eventName).toBe('Ada & Femi');
  });

  it('omits a blank event name rather than storing empty string', () => {
    expect(buildCardTheme({ eventName: '   ' }).eventName).toBeUndefined();
  });

  it('drops unknown CSS properties — a snapshot is replayed into the DOM', () => {
    const t = buildCardTheme({
      themeVars: { '--color-accent': '#fff', '--evil-thing': 'red', position: 'fixed' },
    });
    expect(t.vars['--color-accent']).toBe('#fff');
    expect(t.vars['--evil-thing']).toBeUndefined();
    expect(t.vars.position).toBeUndefined();
  });

  it('drops values that could escape the declaration or fetch a resource', () => {
    const t = buildCardTheme({
      themeVars: {
        '--color-accent': 'red; position:fixed',
        '--color-brand-bg': 'url(https://evil.example/x)',
        '--color-brand-fg': 'expression(alert(1))',
        '--color-ivory': '#F7F1E3',
      },
    });
    expect(t.vars['--color-accent']).toBeUndefined();
    expect(t.vars['--color-brand-bg']).toBeUndefined();
    expect(t.vars['--color-brand-fg']).toBeUndefined();
    expect(t.vars['--color-ivory']).toBe('#F7F1E3');
  });

  it('is empty, not broken, with no input at all', () => {
    const t = buildCardTheme({});
    expect(t.vars).toEqual({});
    expect(hasThemeVars(t)).toBe(false);
  });
});

describe('safeFontHref', () => {
  it('accepts https and root-relative paths', () => {
    expect(safeFontHref('https://fonts.googleapis.com/css2?family=Jost')).toBeTruthy();
    expect(safeFontHref('/fonts/jost.css')).toBe('/fonts/jost.css');
  });

  it('rejects javascript:, data:, protocol-relative and plain http', () => {
    expect(safeFontHref('javascript:alert(1)')).toBeUndefined();
    expect(safeFontHref('data:text/css,body{}')).toBeUndefined();
    expect(safeFontHref('//evil.example/x.css')).toBeUndefined();
    expect(safeFontHref('http://insecure.example/x.css')).toBeUndefined();
  });

  it('rejects non-strings and blanks', () => {
    expect(safeFontHref(undefined)).toBeUndefined();
    expect(safeFontHref(42)).toBeUndefined();
    expect(safeFontHref('   ')).toBeUndefined();
  });
});

describe('normalizeCardTheme — total over whatever is in the jsonb column', () => {
  it('round-trips a built snapshot', () => {
    const built = buildCardTheme({
      themeVars: { '--color-accent': '#E8C766' },
      fontHref: 'https://fonts.example/x.css',
      eventName: 'Hope Gala',
    });
    const parsed = normalizeCardTheme(JSON.parse(JSON.stringify(built)));
    expect(parsed).toEqual(built);
  });

  it('returns null for the shapes an unset column actually holds', () => {
    expect(normalizeCardTheme({})).toBeNull();
    expect(normalizeCardTheme(null)).toBeNull();
    expect(normalizeCardTheme(undefined)).toBeNull();
  });

  it('returns null for junk instead of throwing', () => {
    expect(normalizeCardTheme('nope')).toBeNull();
    expect(normalizeCardTheme(7)).toBeNull();
    expect(normalizeCardTheme([1, 2])).toBeNull();
    expect(normalizeCardTheme({ vars: 'not-an-object' })).toBeNull();
    expect(normalizeCardTheme({ vars: [1, 2] })).toBeNull();
  });

  it('keeps a name-only snapshot usable', () => {
    const t = normalizeCardTheme({ eventName: 'Ada & Femi' });
    expect(t?.eventName).toBe('Ada & Femi');
    expect(hasThemeVars(t)).toBe(false);
  });

  it('re-sanitizes on the way OUT — a hand-edited row cannot inject', () => {
    const t = normalizeCardTheme({
      vars: { '--color-accent': '#fff', onclick: 'steal()', '--x': 'y' },
    });
    expect(t?.vars).toEqual({ '--color-accent': '#fff' });
  });

  it('defaults a missing version rather than rejecting the snapshot', () => {
    expect(normalizeCardTheme({ vars: { '--color-accent': '#fff' } })?.v).toBe(CARD_THEME_VERSION);
  });
});

describe('hasThemeVars', () => {
  it('is false for null and for a colourless snapshot', () => {
    expect(hasThemeVars(null)).toBe(false);
    expect(hasThemeVars({ v: 1, vars: {}, eventName: 'X' })).toBe(false);
  });

  it('is true once there is something to paint', () => {
    expect(hasThemeVars({ v: 1, vars: { '--color-accent': '#fff' } })).toBe(true);
  });
});
