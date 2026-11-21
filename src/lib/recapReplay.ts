/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Relive the night" — the time maths behind the album's replay of the live
 * wall filling up.
 *
 * The replay re-plays every post in the order it actually reached the wall
 * (`posts.created_at`), compressing the night's hours into a fixed ~15–20 s so
 * a three-hour wedding and a forty-minute launch both feel like one breath. A
 * clock ticks along with it, a counter climbs, and it ends on the busiest
 * stretch of the night.
 *
 * PURE (no React, no DOM, no Date.now) so the whole thing is pinned in vitest's
 * node env. Every input is defensive: rows arrive newest-first from the album
 * read, a timestamp can be missing or junk, and an album can be one post or a
 * dozen posted in the same second. None of those may throw or produce NaN.
 *
 * THE CLOCK IS HONEST. A tile appears at the replay offset that maps linearly
 * from its real timestamp, and the clock reads the same linear map — so the
 * time on screen when a tile lands is the time it was posted (to the frame).
 * The one exception is a night with no span at all (one post, or every post in
 * the same instant): there is no time to compress, so the tiles are staggered
 * by order over a short beat and the clock simply holds.
 */

/** The shape the replay needs from a post; anything wider is fine. */
export interface ReplayPost {
  id: string;
  created_at: string | null | undefined;
}

export interface ReplayMoment<T extends ReplayPost = ReplayPost> {
  post: T;
  /** Real time it reached the wall, epoch ms. */
  t: number;
  /** When it lands in the replay, ms from the start of playback. */
  at: number;
  /** 0-based chronological rank. */
  index: number;
}

export interface PeakWindow {
  /** Window start/end, epoch ms (end exclusive). */
  start: number;
  end: number;
  count: number;
}

export interface ReplayPlan<T extends ReplayPost = ReplayPost> {
  /** Chronological, valid timestamps only. */
  moments: ReplayMoment<T>[];
  /** Rows skipped for an unreadable timestamp. */
  dropped: number;
  /** First and last post, epoch ms (0 when empty). */
  start: number;
  end: number;
  /** Playback length, ms (0 when empty). */
  durationMs: number;
  peak: PeakWindow | null;
}

/** Bounds on the replay's length for a night with real span. */
export const REPLAY_MIN_MS = 15_000;
export const REPLAY_MAX_MS = 20_000;
/** Each post adds a little time so a busy night breathes; capped by MAX. */
export const REPLAY_MS_PER_POST = 20;
/** A night with no span: one beat per post, inside these bounds. */
export const INSTANT_STAGGER_MS = 140;
export const INSTANT_MIN_MS = 1_800;
export const INSTANT_MAX_MS = 6_000;

/** Epoch ms, or null for anything Date.parse cannot read. */
export function parsePostTime(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/** Playback length for a night spanning `spanMs` with `count` posts. */
export function replayDuration(spanMs: number, count: number): number {
  if (count <= 0) return 0;
  if (!(spanMs > 0)) {
    return Math.min(INSTANT_MAX_MS, Math.max(INSTANT_MIN_MS, count * INSTANT_STAGGER_MS));
  }
  return Math.min(REPLAY_MAX_MS, REPLAY_MIN_MS + count * REPLAY_MS_PER_POST);
}

/**
 * The window "Busiest moment" is measured over. Short nights get a tighter
 * window so the highlight still says something; a long night uses ten minutes,
 * which is how people remember a party ("around ten past ten").
 */
export function peakWindowMs(spanMs: number): number {
  if (spanMs <= 60 * 60_000) return 5 * 60_000;
  if (spanMs <= 8 * 60 * 60_000) return 10 * 60_000;
  return 30 * 60_000;
}

/**
 * The busiest clock-aligned window (10:10–10:20, not 10:07–10:17). Aligned to
 * multiples of `windowMs` since the epoch, which lands on round local minutes
 * in every whole- and half-hour time zone. Ties go to the EARLIER window.
 * `times` need not be sorted.
 */
export function peakWindow(times: readonly number[], windowMs: number): PeakWindow | null {
  if (times.length === 0 || !(windowMs > 0)) return null;
  const counts = new Map<number, number>();
  for (const t of times) {
    if (!Number.isFinite(t)) continue;
    const k = Math.floor(t / windowMs);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bestK: number | null = null;
  let best = 0;
  for (const [k, c] of counts) {
    if (c > best || (c === best && bestK !== null && k < bestK)) {
      best = c;
      bestK = k;
    }
  }
  if (bestK === null) return null;
  return { start: bestK * windowMs, end: (bestK + 1) * windowMs, count: best };
}

/** Build the replay. Input order does not matter. */
export function buildReplay<T extends ReplayPost>(posts: readonly T[]): ReplayPlan<T> {
  const timed: { post: T; t: number; i: number }[] = [];
  let dropped = 0;
  posts.forEach((post, i) => {
    const t = parsePostTime(post?.created_at);
    if (t === null) dropped++;
    else timed.push({ post, t, i });
  });
  // Stable: equal timestamps keep their input order reversed (the album read is
  // newest-first, so reversing ties restores the order they were written).
  timed.sort((a, b) => a.t - b.t || b.i - a.i);

  if (timed.length === 0) {
    return { moments: [], dropped, start: 0, end: 0, durationMs: 0, peak: null };
  }
  const start = timed[0].t;
  const end = timed[timed.length - 1].t;
  const span = end - start;
  const durationMs = replayDuration(span, timed.length);
  const n = timed.length;

  const moments: ReplayMoment<T>[] = timed.map((m, index) => {
    let at: number;
    if (span > 0) at = ((m.t - start) / span) * durationMs;
    else at = n === 1 ? 0 : (index / (n - 1)) * durationMs;
    return { post: m.post, t: m.t, at, index };
  });

  return {
    moments,
    dropped,
    start,
    end,
    durationMs,
    peak: peakWindow(timed.map((m) => m.t), peakWindowMs(span)),
  };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The real clock time shown at `replayMs` into playback, epoch ms. */
export function clockAt(plan: Pick<ReplayPlan, 'start' | 'end' | 'durationMs'>, replayMs: number): number {
  if (plan.durationMs <= 0) return plan.start;
  return plan.start + clamp01(replayMs / plan.durationMs) * (plan.end - plan.start);
}

/** How many moments have landed by `replayMs` (binary search; `at` is sorted). */
export function countAt(plan: Pick<ReplayPlan, 'moments'>, replayMs: number): number {
  const m = plan.moments;
  let lo = 0;
  let hi = m.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (m[mid].at <= replayMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Which moments get a TILE on the replay wall. A 400-photo night cannot put
 * 400 images on a phone, so a capped, evenly-spaced sample is drawn — always
 * keeping the first and the last — while the counter still counts every post.
 * Returned in chronological order.
 */
export function replayTiles<T extends ReplayPost>(plan: Pick<ReplayPlan<T>, 'moments'>, cap: number): ReplayMoment<T>[] {
  const m = plan.moments;
  const c = Math.max(0, Math.floor(cap));
  if (m.length <= c) return m.slice();
  if (c === 0) return [];
  if (c === 1) return [m[m.length - 1]];
  const out: ReplayMoment<T>[] = [];
  for (let k = 0; k < c; k++) out.push(m[Math.round((k * (m.length - 1)) / (c - 1))]);
  return out;
}

/** Counts across the night in `n` equal buckets — the static timeline. */
export function timelineBuckets(plan: Pick<ReplayPlan, 'moments' | 'start' | 'end'>, n: number): number[] {
  const size = Math.max(1, Math.floor(n));
  const out = new Array<number>(size).fill(0);
  const span = plan.end - plan.start;
  for (const mo of plan.moments) {
    const k = span > 0 ? Math.min(size - 1, Math.floor(((mo.t - plan.start) / span) * size)) : 0;
    out[k]++;
  }
  return out;
}

/** "8:42 PM". `timeZone` is for tests; the page shows the viewer's local time. */
export function formatClock(epochMs: number, timeZone?: string): string {
  return new Date(epochMs).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone !== undefined ? { timeZone } : {}),
  });
}

/** "10:10–10:20 PM" (or "11:55 PM–12:05 AM" across a meridiem). */
export function formatWindow(start: number, end: number, timeZone?: string): string {
  const a = formatClock(start, timeZone);
  const b = formatClock(end, timeZone);
  const [aTime, aMer] = a.split(' ');
  const [bTime, bMer] = b.split(' ');
  return aMer === bMer ? `${aTime}–${bTime} ${bMer}` : `${a}–${b}`;
}

/** "Busiest moment: 10:10–10:20 PM · 23 photos". */
export function peakLine(peak: PeakWindow | null, timeZone?: string): string | null {
  if (peak === null) return null;
  const n = peak.count;
  return `${formatWindow(peak.start, peak.end, timeZone)} · ${n.toLocaleString('en-US')} ${n === 1 ? 'photo' : 'photos'}`;
}
