/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure helpers behind the partnerships hub and the /pitch deck viewer.
 *
 * No React, no supabase import — this stays importable from a node-env
 * .test.ts (salesHub.test.ts). Everything a UI decision hangs on that can be
 * got wrong quietly (an off-by-one slide hash, a ref that breaks the URL, a
 * booking link that is really `javascript:`) lives here and is tested.
 */
import { TEMPLATE_TOKENS, type IcpId, type Market, type MessageTemplate, type Objection, type TemplateChannel, type TemplateStage } from './salesTypes';

// ── Deck navigation ────────────────────────────────────────────────────────

/** Clamp a slide index into [0, count-1]. An empty deck clamps to 0. */
export function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
}

/**
 * `#3` → slide index 2. The hash is 1-based because it is what a human reads
 * and types ("send them to slide 3"). Anything that is not a positive integer
 * within the deck returns null, so a stray `#top` never jumps the deck.
 */
export function parseSlideHash(hash: string, count: number): number | null {
  const m = /^#?(\d{1,4})$/.exec(hash.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  if (n < 1 || n > count) return null;
  return n - 1;
}

/** Slide index → its 1-based hash. */
export function slideHash(index: number): string {
  return `#${Math.max(0, Math.trunc(index)) + 1}`;
}

/**
 * A horizontal swipe → a direction. Mostly-vertical gestures (a scroll) and
 * short ones (a tap) return null.
 */
export function swipeDirection(dx: number, dy: number, threshold = 48): 'next' | 'prev' | null {
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.2) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** The keys a presenter's clicker or keyboard sends. */
export function keyToStep(key: string): 'next' | 'prev' | 'first' | 'last' | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
    case 'Spacebar':
      return 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

// ── Share links ────────────────────────────────────────────────────────────

/** A rep code, cleaned: trimmed, internal whitespace dropped, capped at 40. */
export function normalizeRef(ref: string | null | undefined): string {
  if (ref === null || ref === undefined) return '';
  return ref.trim().replace(/\s+/g, '').slice(0, 40);
}

/**
 * `path` with `?ref=` added when `ref` is non-empty (url-encoded). Keeps any
 * query/hash already on the path. An empty ref returns the path unchanged.
 */
export function withRef(path: string, ref: string | null | undefined): string {
  const r = normalizeRef(ref);
  if (r === '') return path;
  const hashAt = path.indexOf('#');
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}ref=${encodeURIComponent(r)}${hash}`;
}

/** Full shareable URL: origin (trailing slash tolerated) + path + optional ref. */
export function buildShareLink(origin: string, path: string, ref: string | null | undefined): string {
  const o = origin.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${o}${withRef(p, ref)}`;
}

/** Only http(s) URLs are allowed into an href that a prospect will click. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** A cheap email shape check, enough to refuse to build `mailto:` from junk. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email);
}

export interface ContactCta {
  href: string;
  label: string;
  external: boolean;
}

/**
 * The prospect's "talk to us" button: the booking link if one is set, else a
 * mailto, else the main site. Empty strings mean "not provided".
 */
export function contactCta(contact: { name: string; email: string; bookingUrl: string }): ContactCta {
  const booking = contact.bookingUrl.trim();
  if (booking !== '' && isSafeHttpUrl(booking)) {
    return { href: booking, label: 'Book a call', external: true };
  }
  const email = contact.email.trim();
  if (email !== '' && looksLikeEmail(email)) {
    return { href: `mailto:${email}`, label: 'Email us', external: true };
  }
  return { href: '/', label: 'Visit Beamwall', external: false };
}

// ── Templates ──────────────────────────────────────────────────────────────

export interface TemplateFilter {
  /** The hub's market switch. A template for 'any' market shows in both. */
  market: Market;
  channel: TemplateChannel | 'all';
  stage: TemplateStage | 'all';
  icp: IcpId | 'all';
}

/** Market/channel/stage/ICP filter. 'any' market/ICP templates match every value. */
export function filterTemplates(list: readonly MessageTemplate[], f: TemplateFilter): MessageTemplate[] {
  return list.filter(
    (t) =>
      (t.market === f.market || t.market === 'any') &&
      (f.channel === 'all' || t.channel === f.channel) &&
      (f.stage === 'all' || t.stage === f.stage) &&
      (f.icp === 'all' || t.icp === f.icp || t.icp === 'any'),
  );
}

export interface TextSegment {
  text: string;
  /** true = an unfilled `[token]` that fillTemplate left visible. */
  token: boolean;
}

const TOKEN_RE = new RegExp(`\\[(?:${TEMPLATE_TOKENS.join('|')})\\]`, 'g');

/**
 * Split filled template text so the unfilled `[token]` markers can be drawn
 * highlighted. Only real template tokens are marked; a literal "[note]" stays
 * plain text.
 */
export function splitUnfilled(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), token: false });
    out.push({ text: m[0], token: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), token: false });
  return out;
}

/** How many unfilled tokens remain in a filled body. */
export function countUnfilled(text: string): number {
  return splitUnfilled(text).filter((s) => s.token).length;
}

/** Parse a stored market value; anything unknown → Nigeria (the primary market). */
export function parseMarket(v: string | null | undefined): Market {
  return v === 'na' ? 'na' : 'ng';
}

// ── Objections ─────────────────────────────────────────────────────────────

/** Case-insensitive search over objection + answer; every word must match. */
export function searchObjections(list: readonly Objection[], query: string): Objection[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [...list];
  return list.filter((o) => {
    const hay = `${o.objection} ${o.answer}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ── 30-day plan ────────────────────────────────────────────────────────────

/** Parse a `YYYY-MM-DD` date (local calendar day). null when malformed. */
export function parseIsoDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const date = new Date(y, mo, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  return date;
}

/**
 * Which plan week `today` falls in, given the plan's start day. Week 1 is
 * days 0-6. Before the start → null; past the last week → the last week.
 * Calendar days, not 24h blocks, so a DST change cannot shift a week.
 */
export function currentPlanWeek(startIso: string, today: Date, weekCount: number): number | null {
  const start = parseIsoDay(startIso);
  if (start === null || weekCount <= 0) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) -
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000);
  if (days < 0) return null;
  return Math.min(Math.floor(days / 7) + 1, weekCount);
}

/** Today as `YYYY-MM-DD` in local time (for a date input's default). */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
