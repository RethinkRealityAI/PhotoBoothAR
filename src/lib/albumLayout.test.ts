import { describe, expect, it } from 'vitest';
import { albumHoldSec, albumPages, albumSpreads, nextSpread, pageSlots, photosOnPage, spreadOf, tiltFor } from './albumLayout';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${n - 1 - i}`); // newest first: p(n-1)..p0

describe('albumLayout', () => {
  it('fills pages 4, 4, 3 in the order photos were taken', () => {
    expect([0, 1, 2, 3, 4, 5].map(photosOnPage)).toEqual([4, 4, 3, 4, 4, 3]);
    const pages = albumPages(ids(12));
    expect(pages.map((p) => p.length)).toEqual([4, 4, 3, 1]);
    expect(pages[0]).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(pages[3]).toEqual(['p11']);
  });

  it('never reshuffles earlier pages when a photo arrives', () => {
    const before = albumPages(ids(9));
    const after = albumPages(ids(10));
    expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, -1));
    expect(after[after.length - 1]).toContain('p9');
  });

  it('pairs pages into spreads and finds a post', () => {
    const spreads = albumSpreads(albumPages(ids(12)), 2);
    expect(spreads.length).toBe(2);
    expect(spreadOf(spreads, 'p11')).toBe(1);
    expect(spreadOf(spreads, 'nope')).toBe(-1);
    expect(albumSpreads(albumPages(ids(12)), 1).length).toBe(4);
  });

  it('reads forward, loops, and lets a new photo jump the queue', () => {
    expect(nextSpread(0, 3)).toBe(1);
    expect(nextSpread(2, 3)).toBe(0);
    expect(nextSpread(0, 3, 2)).toBe(2);
    expect(nextSpread(2, 3, 2)).toBe(0);
    expect(nextSpread(0, 1)).toBe(0);
    expect(nextSpread(0, 0)).toBe(0);
  });

  it('tilts every photo a little, never flat, never wild', () => {
    for (let i = 0; i < 200; i++) {
      const t = Math.abs(tiltFor(`post-${i}`, i % 4));
      expect(t).toBeGreaterThanOrEqual(1.5);
      expect(t).toBeLessThanOrEqual(5);
    }
    // Neighbours lean opposite ways.
    expect(Math.sign(tiltFor('a', 0))).toBe(-Math.sign(tiltFor('a', 1)));
  });

  it('is deterministic and keeps photos on the page', () => {
    const page = ['x1', 'x2', 'x3', 'x4'];
    expect(pageSlots(page)).toEqual(pageSlots(page));
    for (const n of [1, 2, 3, 4]) {
      for (const s of pageSlots(page.slice(0, n))) {
        expect(s.cx - s.maxW / 2).toBeGreaterThan(0);
        expect(s.cx + s.maxW / 2).toBeLessThan(1);
        expect(s.cy - s.maxH / 2).toBeGreaterThan(0);
        expect(s.cy + s.maxH / 2).toBeLessThan(1);
      }
    }
  });

  it('turns faster when the album is long', () => {
    expect(albumHoldSec(3)).toBeGreaterThan(albumHoldSec(50));
  });
});
