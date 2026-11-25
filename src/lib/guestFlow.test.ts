import { describe, it, expect } from 'vitest';
import {
  CAMERA_HINT_KEY,
  FROM_WELCOME_STATE,
  cameraHintSeen,
  markCameraHintSeen,
  sendOffFooterLines,
  skipBoothSplash,
  challengeLinkState,
  challengeFromRouterState,
  nextChallenge,
  pointsLabel,
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

describe('challenge hand-off', () => {
  const chals = [
    { id: 'b', active: true, sort_order: 2, points: 10 },
    { id: 'a', active: true, sort_order: 1, points: 25 },
    { id: 'off', active: false, sort_order: 0, points: 5 },
    { id: 'c', active: true, sort_order: 2, points: 0 },
  ];

  it('builds router state carrying only the id', () => {
    expect(challengeLinkState('a')).toEqual({ challengeId: 'a' });
  });

  it('preselects only a live, unfinished challenge on a platform event', () => {
    expect(challengeFromRouterState(true, { challengeId: 'b' }, chals, [], true)?.id).toBe('b');
    expect(challengeFromRouterState(false, { challengeId: 'b' }, chals, [], true)).toBeNull();
    expect(challengeFromRouterState(true, { challengeId: 'b' }, chals, [], false)).toBeNull();
    expect(challengeFromRouterState(true, { challengeId: 'b' }, chals, ['b'], true)).toBeNull();
    expect(challengeFromRouterState(true, { challengeId: 'off' }, chals, [], true)).toBeNull();
    expect(challengeFromRouterState(true, { challengeId: 'nope' }, chals, [], true)).toBeNull();
    for (const s of [null, undefined, 'b', 1, {}, { challengeId: 7 }, { challengeId: '' }]) {
      expect(challengeFromRouterState(true, s, chals, [], true)).toBeNull();
    }
  });

  it('suggests the next open challenge in host order, never the one just done', () => {
    expect(nextChallenge(chals, [], null)?.id).toBe('a');
    expect(nextChallenge(chals, [], 'a')?.id).toBe('b');
    expect(nextChallenge(chals, ['a'], 'b')?.id).toBe('c');
    expect(nextChallenge(chals, ['a', 'b'], 'c')).toBeNull();
    expect(nextChallenge([], [], null)).toBeNull();
  });

  it('labels points, and says nothing for none', () => {
    expect(pointsLabel(25)).toBe('+25 pts');
    expect(pointsLabel(1)).toBe('+1 pt');
    expect(pointsLabel(2.6)).toBe('+3 pts');
    for (const p of [0, -4, NaN, Infinity, null, undefined]) expect(pointsLabel(p as number)).toBeNull();
  });
});
