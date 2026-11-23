import { describe, expect, it } from 'vitest';
import { KEEPSAKE_THEMES, normalizeKeepsakeSettings, keepsakeTheme } from './keepsakeSettings';
import {
  contrast,
  introSeenKey,
  isLightTheme,
  mixHex,
  readableAccent,
  recapEyebrow,
  recapGreeting,
  recapThemeVars,
  takeHomeChoices,
} from './recapKeepsake';

describe('theme colour', () => {
  it('every theme reads at AA: ink, muted and accent-as-text on background AND surface', () => {
    for (const t of KEEPSAKE_THEMES) {
      const v = recapThemeVars(t);
      for (const bg of [t.palette.background, t.palette.surface]) {
        expect(contrast(t.palette.ink, bg), `${t.id} ink on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.palette.muted, bg), `${t.id} muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(v['--k-accent-text'], t.palette.background), `${t.id} accent text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--k-on-accent'], t.palette.accent), `${t.id} on-accent`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('readableAccent leaves a readable accent alone and fixes ivory gold', () => {
    expect(readableAccent('#8b7dff', '#07060f', '#f5f3ff')).toBe('#8b7dff');
    const ivory = keepsakeTheme('ivory').palette;
    expect(contrast(ivory.accent, ivory.background)).toBeLessThan(4.5);
    const fixed = readableAccent(ivory.accent, ivory.background, ivory.ink);
    expect(fixed).not.toBe(ivory.accent);
    expect(contrast(fixed, ivory.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('readableAccent falls back to ink when nothing else works', () => {
    expect(readableAccent('#777777', '#777777', '#000000', 21)).toBe('#000000');
  });

  it('mixHex endpoints and junk', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('nope', '#ffffff', 0.5)).toBe('nope');
  });

  it('only ivory is a light page', () => {
    expect(KEEPSAKE_THEMES.filter(isLightTheme).map((t) => t.id)).toEqual(['ivory']);
    expect(recapThemeVars(keepsakeTheme('ivory')).colorScheme).toBe('light');
    expect(recapThemeVars(keepsakeTheme('beamwall')).colorScheme).toBe('dark');
  });

  it('junk config renders exactly the Beamwall defaults', () => {
    for (const junk of [undefined, null, 'x', 7, [], { theme: 'neon' }]) {
      const s = normalizeKeepsakeSettings(junk);
      expect(recapThemeVars(keepsakeTheme(s.theme))).toEqual(recapThemeVars(KEEPSAKE_THEMES[0]));
    }
  });
});

describe('takeHomeChoices', () => {
  const all = { film: true, collage: true, photos: true };
  const full = { film: true, stills: 10, moments: 12 };

  it('offers enabled + available options in film, collage, photos order', () => {
    expect(takeHomeChoices(all, full)).toEqual(['film', 'collage', 'photos']);
  });
  it('hides disabled ones', () => {
    expect(takeHomeChoices({ film: false, collage: true, photos: false }, full)).toEqual(['collage']);
  });
  it('hides what has nothing behind it', () => {
    expect(takeHomeChoices(all, { film: false, stills: 0, moments: 3 })).toEqual(['photos']);
    expect(takeHomeChoices(all, { film: false, stills: 0, moments: 0 })).toEqual([]);
  });
  it('falls back rather than offering nothing', () => {
    expect(takeHomeChoices({ film: true, collage: false, photos: false }, { film: false, stills: 4, moments: 4 })).toEqual(['collage']);
    expect(takeHomeChoices({ film: true, collage: false, photos: false }, { film: false, stills: 0, moments: 2 })).toEqual(['photos']);
  });
});

describe('recapGreeting', () => {
  const ctx = {
    eventName: 'Ada & Tobi',
    photos: 142,
    guests: 38,
    eventDate: '2026-11-14T00:00:00Z',
    now: Date.parse('2026-11-15T09:00:00Z'),
    orgName: '',
  };
  it('fills the default copy with real counts and signs as the host', () => {
    const s = normalizeKeepsakeSettings({ copy: { hostName: 'Ada' } });
    const g = recapGreeting(s, ctx);
    expect(g.headline).toBe("Yesterday's Ada & Tobi was a hit!");
    expect(g.message).toContain('142 photos');
    expect(g.signOff).toBe('With love,');
    expect(g.signer).toBe('Ada');
  });
  it('never signs with an empty name', () => {
    expect(recapGreeting(normalizeKeepsakeSettings(null), ctx).signer).toBe('Your host');
  });
  it('a month-old album does not say yesterday', () => {
    const g = recapGreeting(normalizeKeepsakeSettings(null), { ...ctx, now: Date.parse('2026-12-20T00:00:00Z') });
    expect(g.headline).toBe('Ada & Tobi was a hit!');
  });
});

describe('recapEyebrow', () => {
  it('keeps a real eyebrow', () => expect(recapEyebrow('Ada & Tobi', 'The wedding', null)).toBe('Ada & Tobi'));
  it('replaces a repeat of the title with the date (UTC day)', () => {
    expect(recapEyebrow('The Gala', ' the gala ', '2026-11-20T00:00:00Z')).toBe('Friday, November 20, 2026');
  });
  it('falls back to a label without a usable date', () => {
    expect(recapEyebrow('', 'Gala', null)).toBe('The event album');
    expect(recapEyebrow('Gala', 'Gala', 'junk')).toBe('The event album');
  });
});

it('introSeenKey is per album', () => {
  expect(introSeenKey('a')).not.toBe(introSeenKey('b'));
});
