/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_KEEPSAKE_SETTINGS,
  KEEPSAKE_COPY_MAX,
  KEEPSAKE_MUSIC_IDS,
  KEEPSAKE_THEMES,
  KEEPSAKE_THEME_IDS,
  fillKeepsakeCopy,
  keepsakeTheme,
  normalizeKeepsakeSettings,
  whenPhrase,
  type KeepsakeCopyContext,
} from './keepsakeSettings';

const DAY = 24 * 60 * 60 * 1000;
const EVENT = '2026-11-20T00:00:00.000Z';
const ctx = (over: Partial<KeepsakeCopyContext> = {}): KeepsakeCopyContext => ({
  eventName: 'Jenna & Jake',
  photos: 42,
  guests: 17,
  eventDate: EVENT,
  now: Date.parse(EVENT) + DAY + 9 * 60 * 60 * 1000, // next morning, 09:00 UTC
  orgName: 'Rethink Events',
  ...over,
});

describe('normalizeKeepsakeSettings', () => {
  it('returns the defaults for junk', () => {
    for (const raw of [undefined, null, 7, 'x', [], { theme: 42 }]) {
      expect(normalizeKeepsakeSettings(raw)).toEqual(DEFAULT_KEEPSAKE_SETTINGS);
    }
  });

  it('keeps autoSend true unless it is exactly false (autopilot reads the same rule)', () => {
    expect(normalizeKeepsakeSettings({ autoSend: false }).autoSend).toBe(false);
    expect(normalizeKeepsakeSettings({ autoSend: 0 }).autoSend).toBe(true);
    expect(normalizeKeepsakeSettings({}).autoSend).toBe(true);
  });

  it('falls back on an unknown theme or music id (a newer build wrote it)', () => {
    const s = normalizeKeepsakeSettings({ theme: 'aurora-2030', music: 'future-track' });
    expect(s.theme).toBe('beamwall');
    expect(s.music).toBe('glow');
  });

  it('accepts every known theme and music id, including silent', () => {
    for (const theme of KEEPSAKE_THEME_IDS) expect(normalizeKeepsakeSettings({ theme }).theme).toBe(theme);
    for (const music of KEEPSAKE_MUSIC_IDS) expect(normalizeKeepsakeSettings({ music }).music).toBe(music);
    expect(normalizeKeepsakeSettings({ music: 'none' }).music).toBe('none');
  });

  it('never leaves an album with nothing to download', () => {
    const s = normalizeKeepsakeSettings({ downloads: { film: false, collage: false, photos: false } });
    expect(s.downloads).toEqual({ film: false, collage: false, photos: true });
    expect(normalizeKeepsakeSettings({ downloads: { film: false } }).downloads).toEqual({
      film: false,
      collage: true,
      photos: true,
    });
  });

  it('cleans copy: control chars, whitespace runs, caps, empty = default', () => {
    const s = normalizeKeepsakeSettings({
      copy: {
        headline: '  Big\n\nnight\u0007 ',
        message: 'x'.repeat(500),
        signOff: '   ',
        hostName: '  The Adetoyis  ',
      },
    });
    expect(s.copy.headline).toBe('Big night');
    expect(s.copy.message).toHaveLength(KEEPSAKE_COPY_MAX.message);
    expect(s.copy.signOff).toBe(DEFAULT_KEEPSAKE_SETTINGS.copy.signOff);
    expect(s.copy.hostName).toBe('The Adetoyis');
  });

  it('does not share the default object (editing the result cannot mutate defaults)', () => {
    const s = normalizeKeepsakeSettings({});
    s.downloads.film = false;
    expect(DEFAULT_KEEPSAKE_SETTINGS.downloads.film).toBe(true);
  });
});

describe('themes', () => {
  it('has one entry per id, beamwall first (the default)', () => {
    expect(KEEPSAKE_THEMES.map((t) => t.id)).toEqual([...KEEPSAKE_THEME_IDS]);
    expect(KEEPSAKE_THEMES[0].id).toBe(DEFAULT_KEEPSAKE_SETTINGS.theme);
  });

  it('palettes are 6-digit hex (the film worker parses them)', () => {
    for (const t of KEEPSAKE_THEMES) {
      for (const v of Object.values(t.palette)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keepsakeTheme looks up by id', () => {
    expect(keepsakeTheme('ivory').intro).toBe('fade');
  });
});

describe('whenPhrase', () => {
  const t0 = Date.parse(EVENT);
  it('is honest about elapsed time', () => {
    expect(whenPhrase(EVENT, t0 + 3 * 60 * 60 * 1000)).toBe("Tonight's ");
    expect(whenPhrase(EVENT, t0 + DAY + 1)).toBe("Yesterday's ");
    expect(whenPhrase(EVENT, t0 + 3 * DAY)).toBe("Friday's "); // 2026-11-20 is a Friday
    expect(whenPhrase(EVENT, t0 + 7 * DAY)).toBe('');
    expect(whenPhrase(EVENT, t0 - DAY)).toBe('');
  });

  it('is empty for no date or a bad date', () => {
    expect(whenPhrase(null, t0)).toBe('');
    expect(whenPhrase('not a date', t0)).toBe('');
  });
});

describe('fillKeepsakeCopy', () => {
  it('fills the default headline and message', () => {
    const d = DEFAULT_KEEPSAKE_SETTINGS.copy;
    expect(fillKeepsakeCopy(d.headline, ctx(), '')).toBe("Yesterday's Jenna & Jake was a hit!");
    expect(fillKeepsakeCopy(d.message, ctx(), '')).toContain('42 photos were shared');
  });

  it('capitalises a headline whose {when} filled empty', () => {
    const late = ctx({ now: Date.parse(EVENT) + 30 * DAY, eventName: 'the spring gala' });
    expect(fillKeepsakeCopy('{when}{event} was a hit!', late, '')).toBe('The spring gala was a hit!');
  });

  it('singular counts and a zero count stay grammatical', () => {
    expect(fillKeepsakeCopy('{photos}, {guests}', ctx({ photos: 1, guests: 0 }), '')).toBe('1 photo, 0 guests');
    expect(fillKeepsakeCopy('{photos}', ctx({ photos: 1234 }), '')).toBe('1,234 photos');
  });

  it('{host}: typed name, else org name, else a neutral fallback', () => {
    expect(fillKeepsakeCopy('{host}', ctx(), 'The Adetoyis')).toBe('The Adetoyis');
    expect(fillKeepsakeCopy('{host}', ctx(), '  ')).toBe('Rethink Events');
    expect(fillKeepsakeCopy('{host}', ctx({ orgName: '' }), '')).toBe('Your host');
  });

  it('leaves unknown tokens as typed', () => {
    expect(fillKeepsakeCopy('Hi {name} at {event}', ctx(), '')).toBe('Hi {name} at Jenna & Jake');
  });
});
