/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallRuntime — the pure arithmetic behind a wall that has to survive six
 * unattended hours on a venue projector.
 *
 * Everything here was extracted from a component where it was either wrong or
 * unreachable by a test:
 *   • marquee wrap   — a single `if` could not recover from a tab that slept.
 *   • poll cadence   — a fixed 20 s full-table pull, running while hidden.
 *   • type / card scale — fixed pixels, phone-sized on a 3840×2160 projector.
 *   • video + DOM caps — every video decoding at once, 2000 marquee elements.
 */

/* ------------------------------------------------------------------ */
/* Marquee scroll (W3)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Longest frame delta the marquee will honour, in seconds.
 *
 * rAF does not fire while the tab is hidden or the projector output is
 * occluded. On return the first timestamp delta is however long the machine
 * was away — minutes, in the case that matters. Advancing the strip by four
 * real seconds of scroll in one frame is a visible lurch; advancing by four
 * minutes is a strip that has left the screen. 50 ms ≈ three frames at 60 Hz:
 * enough to ride out a GC pause, short enough that a sleep is simply skipped.
 */
export const MAX_FRAME_DT_S = 0.05;

/** Sanitise a raw rAF delta: non-finite or negative → 0, long stalls → capped. */
export function clampFrameDelta(dtSeconds: number): number {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return 0;
  return Math.min(dtSeconds, MAX_FRAME_DT_S);
}

/**
 * Fold an offset back into [0, halfLen) with a TRUE modulo.
 *
 * The original wrapped with one subtraction, which only recovers an overshoot
 * of less than a single period. Any longer stall left the track translated off
 * screen permanently — a projector laptop that slept meant a blank wall for
 * the rest of the night.
 */
export function wrapOffset(offset: number, halfLen: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(halfLen) || halfLen <= 0) return 0;
  const m = offset % halfLen;
  return m < 0 ? m + halfLen : m;
}

/** One marquee frame: clamp the delta, advance, wrap. */
export function advanceOffset(
  offset: number,
  direction: 1 | -1,
  pxPerSec: number,
  dtSeconds: number,
  halfLen: number,
): number {
  const dt = clampFrameDelta(dtSeconds);
  const speed = Number.isFinite(pxPerSec) ? pxPerSec : 0;
  return wrapOffset(offset + direction * speed * dt, halfLen);
}

/* ------------------------------------------------------------------ */
/* Poll cadence (W4)                                                    */
/* ------------------------------------------------------------------ */

/** Health of the realtime socket, as the wall understands it. */
export type SocketStatus = 'connecting' | 'live' | 'down';

/** The wall's poll heartbeat. Every decision below is in whole ticks. */
export const POLL_TICK_MS = 15_000;

/** Rows an incremental catch-up asks for. Newest-first, so this is "anything
 *  that landed while we were not listening", not the whole event. */
export const INCREMENTAL_LIMIT = 60;

export type PollAction = 'skip' | 'incremental' | 'full';

/**
 * What the poll should do on tick `tick`.
 *
 * A hidden wall does nothing at all: a throttled interval does not stop, it
 * queues, and five backed-up full-table fetches all landing at once on return
 * is the worst possible moment for them.
 *
 * With the socket live the poll is only a safety net (incremental every 4
 * ticks = 1 min, full reconcile every 16 = 4 min). With the socket down it is
 * the ONLY source of new photos, so it tightens to every tick, with a full
 * reconcile every 4 — the full pass is what still removes a post a host hid
 * while realtime was unavailable.
 */
export function pollActionFor(opts: {
  visible: boolean;
  status: SocketStatus;
  tick: number;
}): PollAction {
  if (!opts.visible) return 'skip';
  if (!Number.isFinite(opts.tick) || opts.tick <= 0) return 'skip';
  const down = opts.status === 'down';
  const fullEvery = down ? 4 : 16;
  const incEvery = down ? 1 : 4;
  if (opts.tick % fullEvery === 0) return 'full';
  if (opts.tick % incEvery === 0) return 'incremental';
  return 'skip';
}

/** Map a supabase-js channel status onto the wall's three-state view. */
export function socketStatusFrom(raw: string): SocketStatus {
  if (raw === 'SUBSCRIBED') return 'live';
  if (raw === 'CHANNEL_ERROR' || raw === 'TIMED_OUT' || raw === 'CLOSED') return 'down';
  return 'connecting';
}

/* ------------------------------------------------------------------ */
/* Legibility at twenty feet (W5)                                       */
/* ------------------------------------------------------------------ */

/** The viewport the current fixed pixel sizes were designed against. */
export const WALL_BASE_W = 1440;
export const WALL_BASE_H = 900;
export const WALL_SCALE_MIN = 0.9;
export const WALL_SCALE_MAX = 2.2;
/** Projection mode is a room, not a window — push it a little further. */
export const PROJECTION_BOOST = 1.08;

function clamp(min: number, v: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Multiplier every wall type size and chrome dimension is expressed in.
 *
 * Driven by the SMALLER of the two axis ratios so a very wide, short window
 * does not blow the type up past the height available. 1 at 1440×900 — the
 * design size — which means the browser view is pixel-identical to before and
 * only larger screens change.
 */
export function wallScale(
  viewportW: number,
  viewportH: number,
  projection = false,
): number {
  if (!Number.isFinite(viewportW) || !Number.isFinite(viewportH)) return 1;
  if (viewportW <= 0 || viewportH <= 0) return 1;
  const raw = Math.min(viewportW / WALL_BASE_W, viewportH / WALL_BASE_H);
  const base = clamp(WALL_SCALE_MIN, raw, WALL_SCALE_MAX);
  return Math.round(base * (projection ? PROJECTION_BOOST : 1) * 1000) / 1000;
}

export interface MarqueeMetrics {
  cardH: number;
  minCardW: number;
  maxCardW: number;
  gap: number;
}

/** Today's fixed values — the floor, so no screen gets a SMALLER card. */
const BASE_CARD_H = 290;
const MAX_CARD_H = 620;

/**
 * Marquee card geometry for a viewport.
 *
 * Card size is driven by HEIGHT, not the global scale: rows stack vertically,
 * so height is what decides whether a face reads across a room, and a 4K
 * projector's extra width is worth nothing if the card is still 290 px tall
 * (9% of a 3840 px screen — the audit's number, and correct).
 * Never smaller than today's 290, never so tall that the rows cannot fit.
 */
export function marqueeMetrics(viewportH: number, numRows: number): MarqueeMetrics {
  const rows = Math.max(1, Math.round(numRows) || 1);
  const h = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : WALL_BASE_H;
  const fit = Math.floor((h - 40) / rows) - 16;
  const cardH = Math.round(clamp(BASE_CARD_H, Math.min(Math.round(h * 0.3), fit), MAX_CARD_H));
  const k = cardH / BASE_CARD_H;
  return {
    cardH,
    // Ratios preserved from the original 150 / 360 / 12 at cardH 290.
    minCardW: Math.round(150 * k),
    maxCardW: Math.round(360 * k),
    gap: Math.round(clamp(8, 12 * k, 28)),
  };
}

/**
 * Height ceiling for a mosaic tile, or 0 for "no ceiling".
 *
 * The mosaic is a CSS `columns` masonry of 9:16 captures. On a 3840×2160
 * projector a five-column tile is ~740 px wide and therefore ~1300 px tall, so
 * the wall shows FIVE photos and 40% black — the extra resolution buys nothing.
 * Above laptop height each tile is capped and cover-cropped instead, which
 * roughly doubles how much of the party is on screen. Below the threshold this
 * returns 0 so the existing browser view is byte-for-byte unchanged.
 */
export function mosaicTileMaxH(viewportH: number): number {
  if (!Number.isFinite(viewportH) || viewportH <= 1200) return 0;
  return Math.round(viewportH * 0.44);
}

/* ------------------------------------------------------------------ */
/* Six-hour caps (W4)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Simultaneously decoding videos.
 *
 * Browsers cap concurrent hardware video decoders (commonly ~16 on desktop
 * Chrome); past it further <video> elements simply render black. A wall with
 * twenty video posts therefore turned into a grid of black rectangles. Only
 * the newest few actually play; the rest show a still first frame.
 */
export const MOSAIC_VIDEO_CAP = 4;
export const MARQUEE_VIDEO_CAP = 4;

export function autoplayVideoIds(
  posts: { id: string; media_type?: string | null }[],
  cap: number,
): Set<string> {
  const out = new Set<string>();
  if (cap <= 0) return out;
  for (const p of posts) {
    if (p.media_type !== 'video') continue;
    out.add(p.id);
    if (out.size >= cap) break;
  }
  return out;
}

/**
 * Cards one marquee row may hold before duplication.
 *
 * 500 posts across 4 rows was 125 items per row, duplicated into at least four
 * copies: ~2000 card elements, every video among them a separate decoder.
 * 28 per row keeps the strip well past two screen widths at any realistic card
 * size while holding the whole marquee under ~450 elements.
 */
export const MAX_ROW_ITEMS = 28;

/** Newest `max` items of a row (rows are built newest-first). */
export function boundRowItems<T>(items: T[], max: number = MAX_ROW_ITEMS): T[] {
  if (max <= 0) return [];
  return items.length <= max ? items : items.slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Burn-in (W7)                                                         */
/* ------------------------------------------------------------------ */

/**
 * Slow drift applied to persistent high-contrast chrome so a projector or an
 * OLED venue panel never holds the same bright pixel for six hours. A very
 * long period and a few pixels of travel: invisible to a guest, sufficient to
 * keep any given phosphor/pixel from being pinned.
 */
export const BURN_IN_PERIOD_S = 210;
export const BURN_IN_RADIUS_PX = 9;

/** Lissajous offset for elapsed seconds — pure, so the drift is testable. */
export function burnInOffset(elapsedS: number): { x: number; y: number } {
  if (!Number.isFinite(elapsedS)) return { x: 0, y: 0 };
  const t = (elapsedS / BURN_IN_PERIOD_S) * Math.PI * 2;
  return {
    x: Math.round(Math.sin(t) * BURN_IN_RADIUS_PX * 100) / 100,
    y: Math.round(Math.sin(t * 0.5 + 1.1) * BURN_IN_RADIUS_PX * 0.6 * 100) / 100,
  };
}
