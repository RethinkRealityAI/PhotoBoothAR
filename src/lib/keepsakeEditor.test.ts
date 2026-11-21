import { describe, it, expect } from 'vitest';
import {
  KEEPSAKE_TOKEN_CHIPS,
  copyCounter,
  insertToken,
  isLastDownloadOn,
  keepsakeSettingsEqual,
  prefillHostName,
  resetKeepsakeLook,
  sampleCopyContext,
  toggleDownload,
} from './keepsakeEditor';
import { DEFAULT_KEEPSAKE_SETTINGS, KEEPSAKE_COPY_MAX, fillKeepsakeCopy, type KeepsakeSettings } from './keepsakeSettings';

const base = (): KeepsakeSettings => ({
  ...DEFAULT_KEEPSAKE_SETTINGS,
  downloads: { ...DEFAULT_KEEPSAKE_SETTINGS.downloads },
  copy: { ...DEFAULT_KEEPSAKE_SETTINGS.copy },
});

describe('KEEPSAKE_TOKEN_CHIPS', () => {
  it('offers exactly the five tokens fillKeepsakeCopy fills', () => {
    const ctx = sampleCopyContext('Gala', 'Acme', Date.UTC(2026, 10, 21, 12));
    for (const c of KEEPSAKE_TOKEN_CHIPS) {
      // A filled token leaves no braces behind; an unknown one would.
      expect(fillKeepsakeCopy(`x ${c.token}`, ctx, '')).not.toContain('{');
    }
    expect(KEEPSAKE_TOKEN_CHIPS.map((c) => c.label)).toEqual(['Event name', 'Photo count', 'Guest count', 'Day', 'Host']);
  });
});

describe('insertToken', () => {
  it('inserts at the caret and moves the caret past the token', () => {
    expect(insertToken('Hello !', '{event}', 6, 6, 80)).toEqual({ value: 'Hello {event}!', caret: 13 });
  });

  it('replaces a selection', () => {
    expect(insertToken('Hi NAME', '{host}', 3, 7, 80)).toEqual({ value: 'Hi {host}', caret: 9 });
  });

  it('appends when there is no caret (field never focused)', () => {
    expect(insertToken('Thanks ', '{guests}', null, null, 80)).toEqual({ value: 'Thanks {guests}', caret: 15 });
  });

  it('clamps an out-of-range caret instead of throwing', () => {
    expect(insertToken('ab', '{x}', 99, -4, 80)).toEqual({ value: 'ab{x}', caret: 5 });
  });

  it('refuses an insert that would pass the limit rather than truncating', () => {
    expect(insertToken('a'.repeat(38), '{host}', 38, 38, 40)).toBeNull();
    expect(insertToken('a'.repeat(34), '{host}', 34, 34, 40)?.value.length).toBe(40);
  });
});

describe('copyCounter', () => {
  it('reads length over max and warns within the last 10%', () => {
    expect(copyCounter('abc', 80)).toEqual({ text: '3 / 80', near: false });
    expect(copyCounter('a'.repeat(72), 80).near).toBe(true);
    expect(copyCounter('a'.repeat(71), 80).near).toBe(false);
  });
});

describe('downloads', () => {
  it('toggles freely while more than one is on', () => {
    const d = toggleDownload({ film: true, collage: true, photos: true }, 'film');
    expect(d).toEqual({ film: false, collage: true, photos: true });
    expect(toggleDownload(d, 'film')).toEqual({ film: true, collage: true, photos: true });
  });

  it('never turns off the last one left on', () => {
    const only = { film: false, collage: false, photos: true };
    expect(isLastDownloadOn(only, 'photos')).toBe(true);
    expect(toggleDownload(only, 'photos')).toBe(only);
    // An OFF option is never "the last one on".
    expect(isLastDownloadOn(only, 'film')).toBe(false);
    expect(toggleDownload(only, 'film')).toEqual({ film: true, collage: false, photos: true });
  });
});

describe('prefillHostName', () => {
  it('fills an empty signer with the org name', () => {
    expect(prefillHostName(base(), '  Acme Events ').copy.hostName).toBe('Acme Events');
  });

  it('keeps a name the host already saved', () => {
    const s = base();
    s.copy.hostName = 'Jenna & Jake';
    expect(prefillHostName(s, 'Acme').copy.hostName).toBe('Jenna & Jake');
  });

  it('leaves settings untouched with no org or a blank one', () => {
    const s = base();
    expect(prefillHostName(s, null)).toBe(s);
    expect(prefillHostName(s, '   ')).toBe(s);
  });

  it('clips a long org name to the field limit', () => {
    expect(prefillHostName(base(), 'x'.repeat(200)).copy.hostName.length).toBe(KEEPSAKE_COPY_MAX.hostName);
  });
});

describe('resetKeepsakeLook', () => {
  it('restores the defaults but keeps the delivery switch', () => {
    const s = base();
    s.autoSend = false;
    s.theme = 'ivory';
    s.music = 'none';
    s.copy.headline = 'Custom';
    const r = resetKeepsakeLook(s, 'Acme');
    expect(r.autoSend).toBe(false);
    expect(r.theme).toBe('beamwall');
    expect(r.music).toBe(DEFAULT_KEEPSAKE_SETTINGS.music);
    expect(r.copy.headline).toBe(DEFAULT_KEEPSAKE_SETTINGS.copy.headline);
    expect(r.copy.hostName).toBe('Acme');
  });

  it('does not mutate the shared defaults', () => {
    resetKeepsakeLook(base(), 'Acme');
    expect(DEFAULT_KEEPSAKE_SETTINGS.copy.hostName).toBe('');
  });
});

describe('keepsakeSettingsEqual', () => {
  it('is true for equal shapes and false for any one field changed', () => {
    expect(keepsakeSettingsEqual(base(), base())).toBe(true);
    const variants: ((s: KeepsakeSettings) => void)[] = [
      (s) => { s.autoSend = false; },
      (s) => { s.theme = 'confetti'; },
      (s) => { s.music = 'none'; },
      (s) => { s.beamy = false; },
      (s) => { s.downloads.collage = false; },
      (s) => { s.copy.signOff = 'Cheers,'; },
      (s) => { s.copy.hostName = 'A'; },
    ];
    for (const change of variants) {
      const s = base();
      change(s);
      expect(keepsakeSettingsEqual(base(), s)).toBe(false);
    }
  });
});

describe('sampleCopyContext', () => {
  it('dates the sample yesterday, so the default headline reads the morning-after way', () => {
    const now = Date.UTC(2026, 10, 21, 9, 30);
    const ctx = sampleCopyContext('Hope Gala', 'Acme', now);
    expect(fillKeepsakeCopy(DEFAULT_KEEPSAKE_SETTINGS.copy.headline, ctx, '')).toBe("Yesterday's Hope Gala was a hit!");
    expect(fillKeepsakeCopy('{photos} from {guests}, {host}', ctx, '')).toBe('128 photos from 46 guests, Acme');
  });
});
