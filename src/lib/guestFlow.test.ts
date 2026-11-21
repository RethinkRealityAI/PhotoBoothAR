import { describe, it, expect } from 'vitest';
import {
  CAMERA_HINT_KEY,
  FROM_WELCOME_STATE,
  cameraHintSeen,
  markCameraHintSeen,
  sendOffFooterLines,
  skipBoothSplash,
} from './guestFlow';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

const throwing = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
};

describe('skipBoothSplash', () => {
  it('skips only for a platform event reached from the welcome CTA', () => {
    expect(skipBoothSplash(true, FROM_WELCOME_STATE)).toBe(true);
    expect(skipBoothSplash(true, { fromWelcome: true, other: 1 })).toBe(true);
  });
  it('legacy events always keep the splash', () => {
    expect(skipBoothSplash(false, FROM_WELCOME_STATE)).toBe(false);
  });
  it('opening /booth directly keeps the splash', () => {
    for (const s of [null, undefined, '', 0, 'fromWelcome', {}, { fromWelcome: 'true' }, { fromWelcome: 1 }]) {
      expect(skipBoothSplash(true, s)).toBe(false);
    }
  });
});

describe('camera hint storage', () => {
  it('unseen → mark → seen', () => {
    const s = memStorage();
    expect(cameraHintSeen(s)).toBe(false);
    markCameraHintSeen(s);
    expect(cameraHintSeen(s)).toBe(true);
    expect(s.getItem(CAMERA_HINT_KEY)).toBe('1');
  });
  it('missing or throwing storage reads as unseen and never throws', () => {
    expect(cameraHintSeen(null)).toBe(false);
    expect(cameraHintSeen(throwing)).toBe(false);
    expect(() => markCameraHintSeen(null)).not.toThrow();
    expect(() => markCameraHintSeen(throwing)).not.toThrow();
  });
});

describe('sendOffFooterLines', () => {
  it('the default platform eyebrow (= the name) renders once', () => {
    expect(sendOffFooterLines('Maya & Leo', 'Maya & Leo')).toEqual(['Maya & Leo']);
    expect(sendOffFooterLines(' maya  &  LEO ', 'Maya & Leo')).toEqual(['maya  &  LEO']);
  });
  it('a distinct eyebrow keeps both lines', () => {
    expect(sendOffFooterLines('Hosted by Acme', 'Summer Party')).toEqual(['Hosted by Acme', 'Summer Party']);
  });
  it('drops blanks', () => {
    expect(sendOffFooterLines('', 'Summer Party')).toEqual(['Summer Party']);
    expect(sendOffFooterLines('Acme', '  ')).toEqual(['Acme']);
    expect(sendOffFooterLines('', '')).toEqual([]);
  });
});
