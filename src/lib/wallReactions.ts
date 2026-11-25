/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallReactions: the pure rules behind the Live wall's emoji reactions.
 *
 * A guest taps an emoji in the wall lightbox and it floats up from that
 * photo's tile on every screen showing the wall: the projector and every
 * guest phone. The wire is an anonymous Supabase Realtime BROADCAST channel
 * (lib/wallReactTransport), the same ephemeral pattern as the landing demo
 * beam. No table, no storage, nothing persisted. So everything that arrives
 * is untrusted, and the two places a flood could hurt are bounded here:
 *
 *  - SENDER: a token bucket, ~4 a second per device, with a small burst so
 *    the first rapid taps all feel answered.
 *  - RENDER: at most MAX_FLOATERS emoji in flight on a screen. Past that,
 *    new ones are DROPPED, never queued. A queue would replay a flood for
 *    minutes after it stopped.
 *
 * No React and no supabase import, so every rule is unit-tested in node.
 */

/** The only emoji a reaction may carry. Anything else on the wire is dropped. */
export const REACTION_EMOJIS = ['❤️', '😂', '🔥', '😍', '👏', '🎉'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/** Spoken names for the buttons (screen readers announce emoji unevenly). */
export const REACTION_LABELS: Record<ReactionEmoji, string> = {
  '❤️': 'Love',
  '😂': 'Haha',
  '🔥': 'Fire',
  '😍': 'Adore',
  '👏': 'Applause',
  '🎉': 'Celebrate',
};

/** Broadcast event name on the `wall-react:<eventSlug>` channel. */
export const REACTION_EVENT = 'react';

export interface ReactionPayload {
  postId: string;
  emoji: ReactionEmoji;
}

/** Post ids are uuids today; a slightly wider safe shape keeps sample ids valid.
 *  Anchored and length-bounded: it ends up in a CSS attribute selector. */
const POST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isPostId(v: unknown): v is string {
  return typeof v === 'string' && POST_ID_RE.test(v);
}

export function isReactionEmoji(v: unknown): v is ReactionEmoji {
  return typeof v === 'string' && (REACTION_EMOJIS as readonly string[]).includes(v);
}

/** Validate an incoming broadcast payload. Returns a fresh, minimal object or
 *  null. Extra keys are ignored and never copied through. */
export function parseReactionPayload(raw: unknown): ReactionPayload | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { postId?: unknown; emoji?: unknown };
  if (!isPostId(r.postId) || !isReactionEmoji(r.emoji)) return null;
  return { postId: r.postId, emoji: r.emoji };
}

// ── Sender-side rate limit: token bucket ─────────────────────────────────

/** Sustained sends per second per device. */
export const SEND_RATE_PER_SEC = 4;
/** Taps allowed back to back before the sustained rate applies. */
export const SEND_BURST = 4;

export interface Bucket {
  tokens: number;
  /** Last refill time, in ms on the caller's clock. */
  atMs: number;
}

export function newBucket(nowMs: number, burst = SEND_BURST): Bucket {
  return { tokens: burst, atMs: nowMs };
}

/**
 * Try to spend one token. Pure: returns the next bucket state either way.
 * A clock that goes backwards (tab restore, a test) refills nothing rather
 * than minting negative time.
 */
export function takeToken(
  b: Bucket,
  nowMs: number,
  ratePerSec = SEND_RATE_PER_SEC,
  burst = SEND_BURST,
): { ok: boolean; bucket: Bucket } {
  const elapsedMs = Math.max(0, nowMs - b.atMs);
  // elapsedMs / 1000 converts ms to seconds for a per-second rate.
  const tokens = Math.min(burst, b.tokens + (elapsedMs / 1000) * ratePerSec);
  if (tokens >= 1) return { ok: true, bucket: { tokens: tokens - 1, atMs: nowMs } };
  return { ok: false, bucket: { tokens, atMs: nowMs } };
}

// ── Render-side cap ──────────────────────────────────────────────────────

/** Emoji in flight on one screen at once. Extra arrivals are dropped. */
export const MAX_FLOATERS = 12;
/** A tap on this phone throws a small burst of its own emoji. */
export const LOCAL_BURST = 5;
/** How long one floater lives, ms. Reduced motion uses a short pulse. */
export const FLOAT_MS = 2400;
export const PULSE_MS = 900;

/** How many of `wanted` new floaters fit beside `active` ones. Never negative. */
export function floaterRoom(active: number, wanted: number, cap = MAX_FLOATERS): number {
  return Math.max(0, Math.min(wanted, cap - active));
}

// ── Where a floater starts ───────────────────────────────────────────────

export interface Rect { left: number; top: number; width: number; height: number }
export interface Point { x: number; y: number }

/** True when at least part of the rect is on screen. */
export function rectOnScreen(r: Rect, viewportW: number, viewportH: number): boolean {
  return r.width > 0 && r.height > 0
    && r.left < viewportW && r.left + r.width > 0
    && r.top < viewportH && r.top + r.height > 0;
}

/** Pick the most on-screen rect from several copies of the same tile (the
 *  marquee renders each photo several times). Null when none is visible. */
export function pickVisibleRect(rects: readonly Rect[], viewportW: number, viewportH: number): Rect | null {
  let best: Rect | null = null;
  let bestArea = 0;
  for (const r of rects) {
    if (!rectOnScreen(r, viewportW, viewportH)) continue;
    const w = Math.min(r.left + r.width, viewportW) - Math.max(r.left, 0);
    const h = Math.min(r.top + r.height, viewportH) - Math.max(r.top, 0);
    const area = w * h;
    if (area > bestArea) { best = r; bestArea = area; }
  }
  return best;
}

/** A small deterministic 0..1 from an integer seed (mulberry32 step). */
export function seeded(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The start point for one floater. From the tile when it is on screen (inside
 * its lower half, jittered so a burst fans out), else from the bottom edge.
 * Clamped so an emoji never starts outside the viewport.
 */
export function floaterOrigin(tile: Rect | null, viewportW: number, viewportH: number, seed: number): Point {
  const j = seeded(seed);
  const k = seeded(seed + 7919);
  const pad = 24;
  const clampX = (x: number) => Math.min(Math.max(x, pad), Math.max(pad, viewportW - pad));
  if (tile !== null && rectOnScreen(tile, viewportW, viewportH)) {
    const x = tile.left + tile.width * (0.25 + 0.5 * j);
    const y = tile.top + tile.height * (0.55 + 0.35 * k);
    return { x: clampX(x), y: Math.min(Math.max(y, pad), viewportH - pad) };
  }
  return { x: clampX(viewportW * (0.2 + 0.6 * j)), y: viewportH - pad };
}

/** Per-floater flight: sideways sway (px), rise (px), tilt (deg), scale. */
export interface Flight { swayPx: number; risePx: number; tiltDeg: number; scale: number; delayMs: number }

export function floaterFlight(seed: number, viewportH: number, burstIndex = 0): Flight {
  const a = seeded(seed + 1);
  const b = seeded(seed + 2);
  const c = seeded(seed + 3);
  return {
    swayPx: Math.round((a - 0.5) * 120),
    risePx: Math.round(Math.min(viewportH * 0.55, 520) * (0.7 + 0.3 * b)),
    tiltDeg: Math.round((c - 0.5) * 40),
    scale: 0.9 + 0.35 * b,
    // A local burst staggers its emoji so it reads as a spray, not a stack.
    delayMs: burstIndex * 70,
  };
}
