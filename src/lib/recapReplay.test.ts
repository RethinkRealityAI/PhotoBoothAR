import { describe, expect, it } from 'vitest';
import {
  INSTANT_MAX_MS,
  INSTANT_MIN_MS,
  REPLAY_MAX_MS,
  REPLAY_MIN_MS,
  buildReplay,
  clockAt,
  countAt,
  formatClock,
  formatWindow,
  parsePostTime,
  peakLine,
  peakWindow,
  peakWindowMs,
  replayDuration,
  replayTiles,
  timelineBuckets,
} from './recapReplay';

const MIN = 60_000;
const BASE = Date.parse('2026-11-14T20:00:00Z');
const at = (minutes: number, seconds = 0) => new Date(BASE + minutes * MIN + seconds * 1000).toISOString();
const post = (id: string, created_at: string | null | undefined) => ({ id, created_at });

describe('parsePostTime', () => {
  it('reads ISO timestamps', () => {
    expect(parsePostTime('2026-11-14T20:00:00Z')).toBe(BASE);
    expect(parsePostTime('2026-11-14T20:00:00.123+00:00')).toBe(BASE + 123);
  });
  it('rejects junk without throwing', () => {
    for (const bad of [null, undefined, '', '   ', 'not a date', 42, {}, '2026-13-45T99:99']) {
      expect(parsePostTime(bad)).toBeNull();
    }
  });
});

describe('replayDuration', () => {
  it('is 0 for no posts', () => expect(replayDuration(1000, 0)).toBe(0));
  it('stays inside 15–20s for a real night, growing with the count', () => {
    expect(replayDuration(3 * 60 * MIN, 1)).toBe(REPLAY_MIN_MS + 20);
    expect(replayDuration(3 * 60 * MIN, 100)).toBe(17_000);
    expect(replayDuration(3 * 60 * MIN, 10_000)).toBe(REPLAY_MAX_MS);
  });
  it('a night with no span gets a short staggered beat', () => {
    expect(replayDuration(0, 1)).toBe(INSTANT_MIN_MS);
    expect(replayDuration(0, 20)).toBe(2_800);
    expect(replayDuration(0, 500)).toBe(INSTANT_MAX_MS);
  });
});

describe('buildReplay', () => {
  it('empty input → an empty plan, no NaN', () => {
    const p = buildReplay([]);
    expect(p).toEqual({ moments: [], dropped: 0, start: 0, end: 0, durationMs: 0, peak: null });
    expect(clockAt(p, 500)).toBe(0);
    expect(countAt(p, 500)).toBe(0);
  });

  it('sorts unsorted (newest-first) input chronologically', () => {
    const p = buildReplay([post('c', at(90)), post('a', at(0)), post('b', at(30))]);
    expect(p.moments.map((m) => m.post.id)).toEqual(['a', 'b', 'c']);
    expect(p.moments.map((m) => m.index)).toEqual([0, 1, 2]);
    expect(p.start).toBe(BASE);
    expect(p.end).toBe(BASE + 90 * MIN);
  });

  it('maps time linearly onto playback: first at 0, last at the end', () => {
    const p = buildReplay([post('a', at(0)), post('b', at(30)), post('c', at(120))]);
    expect(p.moments[0].at).toBe(0);
    expect(p.moments[1].at).toBeCloseTo(p.durationMs / 4, 6);
    expect(p.moments[2].at).toBe(p.durationMs);
    expect(p.durationMs).toBeGreaterThanOrEqual(REPLAY_MIN_MS);
    expect(p.durationMs).toBeLessThanOrEqual(REPLAY_MAX_MS);
  });

  it('the clock reads the time a tile was posted when that tile lands', () => {
    const p = buildReplay([post('a', at(0)), post('b', at(42)), post('c', at(170))]);
    for (const m of p.moments) expect(clockAt(p, m.at)).toBeCloseTo(m.t, 3);
    // and clamps outside playback
    expect(clockAt(p, -100)).toBe(p.start);
    expect(clockAt(p, p.durationMs * 2)).toBe(p.end);
  });

  it('drops unreadable timestamps and counts them', () => {
    const p = buildReplay([post('a', at(0)), post('x', 'garbage'), post('y', null), post('z', undefined), post('b', at(5))]);
    expect(p.dropped).toBe(3);
    expect(p.moments.map((m) => m.post.id)).toEqual(['a', 'b']);
  });

  it('all posts bad → empty plan with the drop count', () => {
    const p = buildReplay([post('x', 'nope'), post('y', '')]);
    expect(p.moments).toHaveLength(0);
    expect(p.dropped).toBe(2);
    expect(p.durationMs).toBe(0);
  });

  it('a single post lands at 0 and the clock holds', () => {
    const p = buildReplay([post('only', at(13))]);
    expect(p.moments).toHaveLength(1);
    expect(p.moments[0].at).toBe(0);
    expect(p.durationMs).toBe(INSTANT_MIN_MS);
    expect(clockAt(p, 1000)).toBe(BASE + 13 * MIN);
    expect(p.peak).toEqual({ start: BASE + 10 * MIN, end: BASE + 15 * MIN, count: 1 });
  });

  it('all posts in the same second are staggered by order, in input-reversed order', () => {
    const same = at(10);
    // Newest-first input (as the album read returns it) — reversing ties
    // restores the order the rows were written.
    const p = buildReplay([post('d', same), post('c', same), post('b', same), post('a', same)]);
    expect(p.moments.map((m) => m.post.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(p.moments.map((m) => m.at)).toEqual([0, p.durationMs / 3, (2 * p.durationMs) / 3, p.durationMs]);
    expect(new Set(p.moments.map((m) => clockAt(p, m.at)))).toEqual(new Set([BASE + 10 * MIN]));
    expect(p.peak?.count).toBe(4);
  });

  it('posts within one second but not identical still use the time map', () => {
    const p = buildReplay([post('a', at(0, 0)), post('b', new Date(BASE + 400).toISOString()), post('c', new Date(BASE + 999).toISOString())]);
    expect(p.end - p.start).toBe(999);
    expect(p.moments[2].at).toBe(p.durationMs);
    expect(p.moments[1].at).toBeCloseTo((400 / 999) * p.durationMs, 6);
  });

  it('`at` is non-decreasing (countAt relies on it)', () => {
    const rows = Array.from({ length: 300 }, (_, i) => post(`p${i}`, at((i * 37) % 180, i % 60)));
    const p = buildReplay(rows);
    for (let i = 1; i < p.moments.length; i++) expect(p.moments[i].at).toBeGreaterThanOrEqual(p.moments[i - 1].at);
    expect(p.moments).toHaveLength(300);
  });
});

describe('countAt', () => {
  const p = buildReplay([post('a', at(0)), post('b', at(60)), post('c', at(60)), post('d', at(120))]);
  it('counts moments landed so far, inclusive of the current instant', () => {
    expect(countAt(p, -1)).toBe(0);
    expect(countAt(p, 0)).toBe(1);
    expect(countAt(p, p.durationMs / 2 - 1)).toBe(1);
    expect(countAt(p, p.durationMs / 2)).toBe(3);
    expect(countAt(p, p.durationMs)).toBe(4);
    expect(countAt(p, p.durationMs * 5)).toBe(4);
  });
});

describe('peakWindow', () => {
  it('finds the busiest clock-aligned window', () => {
    const times = [0, 3, 11, 12, 13, 14, 19.9, 25].map((m) => BASE + m * MIN);
    expect(peakWindow(times, 10 * MIN)).toEqual({ start: BASE + 10 * MIN, end: BASE + 20 * MIN, count: 5 });
  });
  it('ties go to the earlier window, regardless of input order', () => {
    const times = [25, 21, 1, 2].map((m) => BASE + m * MIN);
    expect(peakWindow(times, 10 * MIN)).toEqual({ start: BASE, end: BASE + 10 * MIN, count: 2 });
  });
  it('window boundaries are [start, end)', () => {
    const p = peakWindow([BASE + 10 * MIN, BASE + 10 * MIN], 10 * MIN);
    expect(p?.start).toBe(BASE + 10 * MIN);
  });
  it('handles empty, non-finite and bad window sizes', () => {
    expect(peakWindow([], 10 * MIN)).toBeNull();
    expect(peakWindow([NaN, Infinity], 10 * MIN)).toBeNull();
    expect(peakWindow([BASE], 0)).toBeNull();
  });
  it('window size scales with the night', () => {
    expect(peakWindowMs(0)).toBe(5 * MIN);
    expect(peakWindowMs(60 * MIN)).toBe(5 * MIN);
    expect(peakWindowMs(4 * 60 * MIN)).toBe(10 * MIN);
    expect(peakWindowMs(12 * 60 * MIN)).toBe(30 * MIN);
  });
});

describe('replayTiles', () => {
  const p = buildReplay(Array.from({ length: 300 }, (_, i) => post(`p${i}`, at(i))));
  it('keeps everything under the cap', () => {
    const small = buildReplay([post('a', at(0)), post('b', at(1))]);
    expect(replayTiles(small, 40).map((m) => m.post.id)).toEqual(['a', 'b']);
  });
  it('samples evenly, keeps first and last, stays chronological', () => {
    const tiles = replayTiles(p, 24);
    expect(tiles).toHaveLength(24);
    expect(tiles[0].post.id).toBe('p0');
    expect(tiles[23].post.id).toBe('p299');
    for (let i = 1; i < tiles.length; i++) expect(tiles[i].index).toBeGreaterThan(tiles[i - 1].index);
  });
  it('degenerate caps', () => {
    expect(replayTiles(p, 0)).toEqual([]);
    expect(replayTiles(p, -3)).toEqual([]);
    expect(replayTiles(p, 1).map((m) => m.post.id)).toEqual(['p299']);
  });
});

describe('timelineBuckets', () => {
  it('spreads moments across the night and sums to the total', () => {
    const p = buildReplay([post('a', at(0)), post('b', at(10)), post('c', at(55)), post('d', at(60))]);
    const b = timelineBuckets(p, 6);
    expect(b).toEqual([1, 1, 0, 0, 0, 2]); // 10-min buckets: minute 10 opens bucket 1
    expect(b.reduce((x, y) => x + y, 0)).toBe(4);
  });
  it('a night with no span puts everything in the first bucket', () => {
    const p = buildReplay([post('a', at(3)), post('b', at(3))]);
    expect(timelineBuckets(p, 4)).toEqual([2, 0, 0, 0]);
  });
  it('n < 1 still returns one bucket', () => {
    expect(timelineBuckets(buildReplay([post('a', at(0))]), 0)).toEqual([1]);
  });
});

describe('formatting', () => {
  it('clock', () => {
    expect(formatClock(Date.parse('2026-11-14T20:42:00Z'), 'UTC')).toBe('8:42 PM');
    expect(formatClock(Date.parse('2026-11-14T00:05:00Z'), 'UTC')).toBe('12:05 AM');
  });
  it('window, same and crossing meridiem', () => {
    expect(formatWindow(Date.parse('2026-11-14T22:10:00Z'), Date.parse('2026-11-14T22:20:00Z'), 'UTC')).toBe('10:10–10:20 PM');
    expect(formatWindow(Date.parse('2026-11-14T23:55:00Z'), Date.parse('2026-11-15T00:05:00Z'), 'UTC')).toBe('11:55 PM–12:05 AM');
  });
  it('peak line', () => {
    expect(peakLine({ start: Date.parse('2026-11-14T22:10:00Z'), end: Date.parse('2026-11-14T22:20:00Z'), count: 23 }, 'UTC'))
      .toBe('10:10–10:20 PM · 23 photos');
    expect(peakLine({ start: Date.parse('2026-11-14T22:10:00Z'), end: Date.parse('2026-11-14T22:20:00Z'), count: 1 }, 'UTC'))
      .toBe('10:10–10:20 PM · 1 photo');
    expect(peakLine(null)).toBeNull();
  });
});
