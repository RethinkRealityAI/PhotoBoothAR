import { describe, expect, it } from 'vitest';
import {
  MAX_FLOATERS,
  REACTION_EMOJIS,
  REACTION_LABELS,
  SEND_BURST,
  floaterFlight,
  floaterOrigin,
  floaterRoom,
  isPostId,
  newBucket,
  parseReactionPayload,
  pickVisibleRect,
  rectOnScreen,
  takeToken,
  type Bucket,
} from './wallReactions';

const UUID = '3f2b8c1e-9a4d-4c7e-8f00-1b2c3d4e5f60';

describe('parseReactionPayload', () => {
  it('accepts every allow-listed emoji with a uuid post id', () => {
    for (const emoji of REACTION_EMOJIS) {
      expect(parseReactionPayload({ postId: UUID, emoji })).toEqual({ postId: UUID, emoji });
    }
  });

  it('copies only the two known keys', () => {
    const out = parseReactionPayload({ postId: UUID, emoji: '🔥', html: '<img onerror=x>', n: 99 });
    expect(out).toEqual({ postId: UUID, emoji: '🔥' });
    expect(Object.keys(out ?? {})).toEqual(['postId', 'emoji']);
  });

  it('rejects emoji outside the allow-list, including near misses', () => {
    expect(parseReactionPayload({ postId: UUID, emoji: '💩' })).toBeNull();
    // A heart without its variation selector is a different string.
    expect(parseReactionPayload({ postId: UUID, emoji: '❤' })).toBeNull();
    expect(parseReactionPayload({ postId: UUID, emoji: '🔥🔥' })).toBeNull();
    expect(parseReactionPayload({ postId: UUID, emoji: '' })).toBeNull();
    expect(parseReactionPayload({ postId: UUID, emoji: 1 })).toBeNull();
  });

  it('rejects malformed post ids (they end up in an attribute selector)', () => {
    for (const postId of ['', 'a"]', 'x'.repeat(65), 'a b', '../x', null, 42, undefined]) {
      expect(parseReactionPayload({ postId, emoji: '🎉' })).toBeNull();
    }
  });

  it('rejects non-objects', () => {
    for (const raw of [null, undefined, 'react', 7, [UUID, '🎉']]) {
      expect(parseReactionPayload(raw)).toBeNull();
    }
  });

  it('labels every emoji', () => {
    for (const e of REACTION_EMOJIS) expect(REACTION_LABELS[e]).toMatch(/\w/);
  });

  it('isPostId accepts a uuid and rejects the empty string', () => {
    expect(isPostId(UUID)).toBe(true);
    expect(isPostId('')).toBe(false);
  });
});

describe('takeToken (sender rate limit)', () => {
  it('allows a burst, then refuses until time passes', () => {
    let b: Bucket = newBucket(0);
    const results: boolean[] = [];
    for (let i = 0; i < SEND_BURST + 2; i += 1) {
      const r = takeToken(b, 0);
      results.push(r.ok);
      b = r.bucket;
    }
    expect(results).toEqual([true, true, true, true, false, false]);
    // 250 ms at 4/s refills exactly one token.
    const later = takeToken(b, 250);
    expect(later.ok).toBe(true);
    expect(takeToken(later.bucket, 250).ok).toBe(false);
  });

  it('sustains about 4 per second under constant hammering', () => {
    let b = newBucket(0);
    let sent = 0;
    // A tap every 20 ms for 10 s: 4 burst + 4/s * 10 s = ~44.
    for (let t = 0; t <= 10_000; t += 20) {
      const r = takeToken(b, t);
      if (r.ok) sent += 1;
      b = r.bucket;
    }
    expect(sent).toBeGreaterThanOrEqual(43);
    expect(sent).toBeLessThanOrEqual(45);
  });

  it('never refills past the burst size after a long idle', () => {
    let b = newBucket(0);
    b = takeToken(b, 0).bucket;
    let ok = 0;
    for (let i = 0; i < 10; i += 1) {
      const r = takeToken(b, 60_000);
      if (r.ok) ok += 1;
      b = r.bucket;
    }
    expect(ok).toBe(SEND_BURST);
  });

  it('treats a clock that goes backwards as no time passed', () => {
    let b = newBucket(1000);
    for (let i = 0; i < SEND_BURST; i += 1) b = takeToken(b, 1000).bucket;
    expect(takeToken(b, 0).ok).toBe(false);
  });
});

describe('floaterRoom (render cap)', () => {
  it('admits up to the cap and drops the rest', () => {
    expect(floaterRoom(0, 5)).toBe(5);
    expect(floaterRoom(10, 5)).toBe(2);
    expect(floaterRoom(MAX_FLOATERS, 1)).toBe(0);
    expect(floaterRoom(MAX_FLOATERS + 3, 1)).toBe(0);
    expect(floaterRoom(0, 0)).toBe(0);
  });
});

describe('origin + flight', () => {
  const VW = 1440;
  const VH = 900;

  it('rectOnScreen knows on, off and zero-size', () => {
    expect(rectOnScreen({ left: 10, top: 10, width: 100, height: 100 }, VW, VH)).toBe(true);
    expect(rectOnScreen({ left: -200, top: 10, width: 100, height: 100 }, VW, VH)).toBe(false);
    expect(rectOnScreen({ left: 10, top: VH + 1, width: 100, height: 100 }, VW, VH)).toBe(false);
    expect(rectOnScreen({ left: 10, top: 10, width: 0, height: 100 }, VW, VH)).toBe(false);
  });

  it('pickVisibleRect picks the most visible marquee copy', () => {
    const offLeft = { left: -150, top: 100, width: 200, height: 300 }; // 50px visible
    const full = { left: 600, top: 100, width: 200, height: 300 };
    const offRight = { left: 2000, top: 100, width: 200, height: 300 };
    expect(pickVisibleRect([offLeft, full, offRight], VW, VH)).toBe(full);
    expect(pickVisibleRect([offRight], VW, VH)).toBeNull();
    expect(pickVisibleRect([], VW, VH)).toBeNull();
  });

  it('starts inside a visible tile', () => {
    const tile = { left: 400, top: 200, width: 200, height: 300 };
    for (let s = 0; s < 50; s += 1) {
      const p = floaterOrigin(tile, VW, VH, s);
      expect(p.x).toBeGreaterThanOrEqual(tile.left);
      expect(p.x).toBeLessThanOrEqual(tile.left + tile.width);
      expect(p.y).toBeGreaterThanOrEqual(tile.top);
      expect(p.y).toBeLessThanOrEqual(tile.top + tile.height);
    }
  });

  it('falls back to the bottom edge with no tile or an off-screen tile', () => {
    for (const tile of [null, { left: -500, top: 0, width: 100, height: 100 }]) {
      const p = floaterOrigin(tile, 390, 844, 3);
      expect(p.y).toBe(844 - 24);
      expect(p.x).toBeGreaterThanOrEqual(24);
      expect(p.x).toBeLessThanOrEqual(390 - 24);
    }
  });

  it('is deterministic per seed, and flights stay in bounds', () => {
    expect(floaterOrigin(null, VW, VH, 11)).toEqual(floaterOrigin(null, VW, VH, 11));
    for (let s = 0; s < 100; s += 1) {
      const f = floaterFlight(s, VH, 2);
      expect(Math.abs(f.swayPx)).toBeLessThanOrEqual(60);
      expect(f.risePx).toBeGreaterThan(0);
      expect(f.risePx).toBeLessThanOrEqual(520);
      expect(Math.abs(f.tiltDeg)).toBeLessThanOrEqual(20);
      expect(f.delayMs).toBe(140);
    }
  });
});
