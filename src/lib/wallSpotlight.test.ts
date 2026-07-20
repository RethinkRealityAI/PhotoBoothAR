import { describe, it, expect } from 'vitest';
import {
  enabledCtaKinds,
  slotForTick,
  pickSpotlightPost,
  PHOTO_POOL_LIMIT,
  CtaKind,
} from './wallSpotlight';

const posts = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + offset}` }));

describe('enabledCtaKinds', () => {
  it('returns all kinds in rotation order when everything is on', () => {
    expect(
      enabledCtaKinds({ showQR: true, showLeaderboard: true, hasChallenges: true }),
    ).toEqual(['qr', 'leaderboard', 'challenge']);
  });

  it('skips disabled kinds', () => {
    expect(
      enabledCtaKinds({ showQR: false, showLeaderboard: true, hasChallenges: false }),
    ).toEqual(['leaderboard']);
  });

  it('is empty when everything is off', () => {
    expect(
      enabledCtaKinds({ showQR: false, showLeaderboard: false, hasChallenges: false }),
    ).toEqual([]);
  });
});

describe('slotForTick', () => {
  const kinds: CtaKind[] = ['qr', 'leaderboard', 'challenge'];

  it('cycles photo, photo, photo, CTA', () => {
    expect(slotForTick(0, kinds).kind).toBe('photo');
    expect(slotForTick(1, kinds).kind).toBe('photo');
    expect(slotForTick(2, kinds).kind).toBe('photo');
    expect(slotForTick(3, kinds).kind).toBe('cta');
    expect(slotForTick(4, kinds).kind).toBe('photo');
    expect(slotForTick(7, kinds).kind).toBe('cta');
  });

  it('rotates the CTA card kind across CTA slots', () => {
    expect(slotForTick(3, kinds).cta).toBe('qr');
    expect(slotForTick(7, kinds).cta).toBe('leaderboard');
    expect(slotForTick(11, kinds).cta).toBe('challenge');
    expect(slotForTick(15, kinds).cta).toBe('qr'); // wraps
  });

  it('rotates within a shorter enabled list', () => {
    const two: CtaKind[] = ['leaderboard', 'challenge'];
    expect(slotForTick(3, two).cta).toBe('leaderboard');
    expect(slotForTick(7, two).cta).toBe('challenge');
    expect(slotForTick(11, two).cta).toBe('leaderboard');
  });

  it('is always a photo when no CTA kinds are enabled', () => {
    for (let t = 0; t < 12; t++) {
      expect(slotForTick(t, [])).toEqual({ kind: 'photo' });
    }
  });

  it('never sets cta on photo slots', () => {
    expect(slotForTick(0, kinds).cta).toBeUndefined();
  });
});

describe('pickSpotlightPost', () => {
  it('returns null on an empty list', () => {
    expect(pickSpotlightPost([], new Set())).toEqual({ post: null, resetRecent: false });
  });

  it('picks deterministically with an injected rand', () => {
    const list = posts(4);
    expect(pickSpotlightPost(list, new Set(), () => 0).post?.id).toBe('p0');
    expect(pickSpotlightPost(list, new Set(), () => 0.99).post?.id).toBe('p3');
  });

  it('avoids recently-shown ids', () => {
    const list = posts(3);
    const recent = new Set(['p0', 'p2']);
    // Only p1 remains fresh; any rand value must land on it.
    for (const r of [0, 0.5, 0.99]) {
      const pick = pickSpotlightPost(list, recent, () => r);
      expect(pick.post?.id).toBe('p1');
      expect(pick.resetRecent).toBe(false);
    }
  });

  it('signals resetRecent and re-picks from the pool when exhausted', () => {
    const list = posts(3);
    const recent = new Set(['p0', 'p1', 'p2']);
    const pick = pickSpotlightPost(list, recent, () => 0);
    expect(pick.resetRecent).toBe(true);
    expect(pick.post?.id).toBe('p0'); // full pool again
  });

  it('only considers the newest PHOTO_POOL_LIMIT posts', () => {
    const list = posts(PHOTO_POOL_LIMIT + 20);
    // Mark the entire eligible pool recent; the older 20 must NOT be used —
    // instead the pool is exhausted and resets.
    const recent = new Set(list.slice(0, PHOTO_POOL_LIMIT).map((p) => p.id));
    const pick = pickSpotlightPost(list, recent, () => 0.999);
    expect(pick.resetRecent).toBe(true);
    // Even at rand≈1 the pick stays inside the newest-60 window.
    expect(pick.post?.id).toBe(`p${PHOTO_POOL_LIMIT - 1}`);
  });

  it('never returns an out-of-range index at rand edge values', () => {
    const list = posts(1);
    expect(pickSpotlightPost(list, new Set(), () => 0.9999999).post?.id).toBe('p0');
  });
});
