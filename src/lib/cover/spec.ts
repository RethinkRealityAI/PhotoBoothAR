/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Magazine cover Frames: the host's settings, the guest's names, and the
 * words a cover actually prints. PURE (no React, no DOM), unit-tested.
 *
 * Stored in `events.config.arContent.covers` (an array, one entry per cover
 * the host turned on). Absent on every event made before covers existed, so
 * nothing changes for them; legacy coded events never read it (Booth gates
 * on source === 'db').
 */
import type { Experience } from '../../types';
import {
  COVER_TEMPLATE_MAP, isCoverTemplateId,
  type CoverLine, type CoverTemplate, type CoverTemplateId,
} from './templates';

/** What the host sets for one cover. */
export interface CoverSettings {
  template: CoverTemplateId;
  /** Masthead override ("AMOUR" by default). Short, so it fits one line. */
  title?: string;
  /** Up to three names the cover is about ("Ada", "Tunde"). */
  honorees?: string[];
  /** Replaces the lead cover line's headline. */
  headline?: string;
  /** The issue date, YYYY-MM-DD (the event day). */
  date?: string;
  /** Ask guests for their names when they pick it. Default on. */
  guestNames?: boolean;
}

export const COVER_TITLE_MAX = 12;
export const COVER_NAME_MAX = 24;
export const COVER_HEADLINE_MAX = 48;
export const COVER_MAX_HONOREES = 3;
export const COVER_MAX_GUESTS = 3;
/** One of each template at most. */
export const COVER_MAX_COVERS = 12;

const clip = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '';

/** Clean a list of names: trimmed, non-empty, capped in count and length. */
export function normalizeNames(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const n = clip(v, COVER_NAME_MAX);
    if (n !== '' && out.length < max) out.push(n);
  }
  return out;
}

/** One stored entry → settings, or null when it is not a cover. */
export function normalizeCover(raw: unknown): CoverSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isCoverTemplateId(r.template)) return null;
  const out: CoverSettings = { template: r.template };
  const title = clip(r.title, COVER_TITLE_MAX);
  if (title !== '') out.title = title;
  const honorees = normalizeNames(r.honorees, COVER_MAX_HONOREES);
  if (honorees.length > 0) out.honorees = honorees;
  const headline = clip(r.headline, COVER_HEADLINE_MAX);
  if (headline !== '') out.headline = headline;
  if (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) out.date = r.date;
  if (r.guestNames === false) out.guestNames = false;
  return out;
}

/** `arContent.covers` → the covers to offer, one per template, in order. */
export function normalizeCovers(raw: unknown): CoverSettings[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<CoverTemplateId>();
  const out: CoverSettings[] = [];
  for (const v of raw) {
    const c = normalizeCover(v);
    if (!c || seen.has(c.template) || out.length >= COVER_MAX_COVERS) continue;
    seen.add(c.template);
    out.push(c);
  }
  return out;
}

/* ── Words ─────────────────────────────────────────────────────────────── */

/** "Ada" · "Ada & Tunde" · "Ada, Tunde & Kemi". */
export function joinNames(names: readonly string[]): string {
  const n = names.filter((s) => s.trim() !== '');
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
}

/** "Ada & Tunde’s" · "The Okafors’". */
export function possessive(name: string): string {
  if (name === '') return '';
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2027-06-14" → "June 14, 2027"; anything else → null. Never via Date (no time-zone shift). */
export function formatCoverDate(iso: string | null | undefined): string | null {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${MONTHS[mo - 1]} ${d}, ${m[1]}`;
}

/** Everything a cover's tokens can be filled from. */
export interface CoverContext {
  eventName: string;
  honorees: readonly string[];
  /** YYYY-MM-DD, or null. */
  date: string | null;
  /** The year when there is no date (the current one). */
  fallbackYear: number;
}

/**
 * Fill {honorees} {honoreesPossessive} {event} {date} {year}. Returns null
 * when the text needs a token this event has not got, so the caller can use
 * the line's `alt` instead.
 */
export function fillCoverText(text: string, ctx: CoverContext): string | null {
  const who = joinNames(ctx.honorees);
  const date = formatCoverDate(ctx.date);
  const year = ctx.date && /^\d{4}/.test(ctx.date) ? ctx.date.slice(0, 4) : String(ctx.fallbackYear);
  const values: Record<string, string> = {
    honorees: who,
    honoreesPossessive: possessive(who),
    event: ctx.eventName.trim(),
    date: date ?? '',
    year,
  };
  let missing = false;
  const out = text.replace(/\{(\w+)\}/g, (all, key: string) => {
    if (!(key in values)) return all;
    if (values[key] === '') missing = true;
    return values[key];
  });
  return missing ? null : out;
}

export interface ResolvedLine { kicker: string; head: string; deck: string }

/** A cover line with its tokens filled, its alt used when needed, or null. */
export function resolveLine(line: CoverLine, ctx: CoverContext): ResolvedLine | null {
  const fill = (l: { kicker?: string; head: string; deck?: string }): ResolvedLine | null => {
    const head = fillCoverText(l.head, ctx);
    const kicker = l.kicker ? fillCoverText(l.kicker, ctx) : '';
    const deck = l.deck ? fillCoverText(l.deck, ctx) : '';
    if (head === null || kicker === null || deck === null) return null;
    return { kicker, head, deck };
  };
  return fill(line) ?? (line.alt ? fill(line.alt) : null);
}

/** Everything a cover prints, ready for the 2D and the 3D renderers. */
export interface ResolvedCover {
  template: CoverTemplate;
  masthead: string;
  issue: string;
  /** "June 14, 2027" or the event name, under the masthead. */
  dateLine: string;
  star: { kicker: string; names: string; deck: string };
  left: ResolvedLine[];
  right: ResolvedLine[];
  banner: [string, string, string];
}

export function resolveCover(settings: CoverSettings, eventName: string, guests: readonly string[], now = new Date()): ResolvedCover {
  const template = COVER_TEMPLATE_MAP[settings.template];
  const ctx: CoverContext = {
    eventName,
    honorees: settings.honorees ?? [],
    date: settings.date ?? null,
    fallbackYear: now.getFullYear(),
  };
  const lines = (ls: readonly CoverLine[]) => ls.map((l) => resolveLine(l, ctx)).filter((l): l is ResolvedLine => l !== null);
  const left = lines(template.left);
  if (settings.headline && left.length > 0) left[0] = { ...left[0], head: settings.headline };
  else if (settings.headline) left.push({ kicker: '', head: settings.headline, deck: '' });
  const names = joinNames(normalizeNames(guests, COVER_MAX_GUESTS));
  return {
    template,
    masthead: (settings.title ?? template.masthead.text).toUpperCase(),
    issue: template.issue,
    dateLine: formatCoverDate(settings.date) ?? eventName.trim(),
    star: {
      kicker: template.star.kicker,
      names: names !== '' ? names : (fillCoverText(template.star.fallback, ctx) ?? 'You'),
      deck: fillCoverText(template.star.deck, ctx) ?? fillCoverText(template.star.alt, ctx) ?? '',
    },
    left,
    right: lines(template.right),
    banner: [...template.banner],
  };
}

/* ── Catalog ───────────────────────────────────────────────────────────── */

export const COVER_ID_PREFIX = 'builtin:cover:';

export function coverExperienceId(t: CoverTemplateId): string {
  return `${COVER_ID_PREFIX}${t}`;
}

/** The template behind a cover Frame id (or a world tile of one), else null. */
export function coverTemplateOfId(id: string | null | undefined): CoverTemplateId | null {
  if (!id) return null;
  const i = id.indexOf(COVER_ID_PREFIX);
  if (i < 0) return null;
  const t = id.slice(i + COVER_ID_PREFIX.length);
  return isCoverTemplateId(t) ? t : null;
}

/**
 * The cover Frames for the booth: one `border` per cover, its art being the
 * rendered 2D cover. A cover whose art is not ready yet is left out (an
 * empty tile would be a broken frame).
 */
export function coverExperiences(covers: readonly CoverSettings[], art: Readonly<Record<string, string>>): Experience[] {
  const out: Experience[] = [];
  covers.forEach((c, i) => {
    const url = art[c.template];
    if (!url) return;
    const t = COVER_TEMPLATE_MAP[c.template];
    out.push({
      id: coverExperienceId(c.template),
      name: `${t.label} cover`,
      created_at: '2026-11-25T00:00:00Z',
      updated_at: '2026-11-25T00:00:00Z',
      is_published: true,
      featured: true,
      sort_order: 150 + i,
      thumbnail_url: null,
      kind: 'border',
      asset_url: url,
      config: { transform: { scale: 1, x: 0, y: 0, rotation: 0 }, opacity: 1 },
    });
  });
  return out;
}

/** Whether picking this cover should ask the guests for their names. */
export function coverWantsGuestNames(c: CoverSettings | null | undefined): boolean {
  return !!c && c.guestNames !== false;
}

/* ── Host edits ────────────────────────────────────────────────────────── */

/** Turn a cover on, or replace its settings (keeps its place in the list). */
export function upsertCover(list: readonly CoverSettings[], c: CoverSettings): CoverSettings[] {
  const clean = normalizeCover(c);
  if (!clean) return [...list];
  const i = list.findIndex((x) => x.template === clean.template);
  if (i < 0) return [...list, clean].slice(0, COVER_MAX_COVERS);
  return list.map((x, j) => (j === i ? clean : x));
}

export function removeCover(list: readonly CoverSettings[], t: CoverTemplateId): CoverSettings[] {
  return list.filter((x) => x.template !== t);
}

/**
 * The events.config patch that stores the covers. arContent is rebuilt from
 * the current one (updateEventConfig merges shallowly); no covers → the key
 * goes, so the event reads exactly as before covers existed.
 */
export function coversConfigPatch(currentConfig: Record<string, unknown> | null | undefined, covers: readonly CoverSettings[]): Record<string, unknown> {
  const raw = currentConfig?.arContent;
  const cur = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  if (covers.length > 0) cur.covers = covers.map((c) => ({ ...c }));
  else delete cur.covers;
  return { arContent: cur };
}

/** The event day as YYYY-MM-DD from `events.starts_at`, or undefined. */
export function coverDateFrom(startsAt: string | null | undefined): string | undefined {
  return typeof startsAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(startsAt) ? startsAt.slice(0, 10) : undefined;
}
