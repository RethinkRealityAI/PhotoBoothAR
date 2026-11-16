/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "My events" — pure helpers for the host's event list: a human date line
 * ("Sat 12 Sep · in 3 days"), Upcoming / Drafts / Past grouping, the accent
 * strip colour, and the config clone behind "Duplicate event".
 *
 * PURE: no React, no supabase. Dates are compared as LOCAL CALENDAR DAYS
 * (Date.UTC over local y/m/d parts), never by adding 24h, so a DST change or
 * a viewer in another timezone cannot shift "tomorrow" into "today".
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The minimum of a host event row these helpers read. */
export interface ListableEvent {
  id: string;
  status: string;
  created_at: string;
  starts_at?: string | null;
  config?: Record<string, unknown> | null;
}

/** An ISO timestamp or a bare YYYY-MM-DD → a local Date, or null. A bare day
 *  is built from its parts (`new Date('2026-09-12')` would be UTC midnight —
 *  the previous evening west of Greenwich). */
export function parseEventDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole local calendar days from `now` to `date` (negative = in the past).
 *  Traces: Jan 31 → Feb 1 = 1; Dec 31 2026 → Jan 1 2027 = 1; across the
 *  2026-03-08 US DST jump, Mar 7 → Mar 9 = 2 (a fixed 86400000ms step would
 *  have rounded the 47h gap the same way here only by luck). */
export function dayDiff(date: Date, now: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000); // ms → days, both UTC-midnight stamps
}

export interface EventDateLabel {
  /** "Sat 12 Sep" (year added when it is not this year). */
  day: string;
  /** "Today" · "Tomorrow" · "in 3 days" · "Past". */
  relative: string;
  past: boolean;
}

/** The date line for an event card, or null when the event has no date. */
export function formatEventDate(startsAt: string | null | undefined, now: Date = new Date()): EventDateLabel | null {
  const d = parseEventDate(startsAt);
  if (!d) return null;
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  const day = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
  const n = dayDiff(d, now);
  const relative = n < 0 ? 'Past' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`;
  return { day, relative, past: n < 0 };
}

/** A YYYY-MM-DD as a human date ("Sat 12 Sep 2026") for review screens; the
 *  input string itself when it does not parse. Always shows the year. */
export function humanDate(ymd: string): string {
  const d = parseEventDate(ymd);
  if (!d) return ymd;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export interface GroupedEvents<T> {
  upcoming: T[];
  drafts: T[];
  past: T[];
}

/**
 * Upcoming / Drafts / Past. Past = ended, or dated before today and not live
 * (a live event is happening whatever its date says). Drafts = not yet live.
 * Upcoming = the rest (live events). Upcoming and drafts run soonest-first
 * (undated last, newest-created first among them); past runs most recent first.
 * Archived rows are the caller's job (they live on their own shelf).
 */
export function groupEvents<T extends ListableEvent>(events: T[], now: Date = new Date()): GroupedEvents<T> {
  const out: GroupedEvents<T> = { upcoming: [], drafts: [], past: [] };
  for (const ev of events) {
    const d = parseEventDate(ev.starts_at);
    const datedPast = d !== null && dayDiff(d, now) < 0;
    if (ev.status === 'ended' || (datedPast && ev.status !== 'live')) out.past.push(ev);
    else if (ev.status === 'draft') out.drafts.push(ev);
    else out.upcoming.push(ev);
  }
  const t = (ev: ListableEvent) => parseEventDate(ev.starts_at)?.getTime() ?? null;
  const created = (ev: ListableEvent) => Date.parse(ev.created_at) || 0;
  const soonest = (a: T, b: T) => {
    const ta = t(a), tb = t(b);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;
    return created(b) - created(a);
  };
  const latest = (a: T, b: T) => {
    const ta = t(a) ?? created(a), tb = t(b) ?? created(b);
    return tb - ta;
  };
  out.upcoming.sort(soonest);
  out.drafts.sort(soonest);
  out.past.sort(latest);
  return out;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** The event's accent colour from its config (themeVars, then the frame
 *  palette), for the card's colour strip. Null when none is set. */
export function accentOf(config: Record<string, unknown> | null | undefined): string | null {
  const vars = config?.themeVars as Record<string, unknown> | undefined;
  const v = vars?.['--color-accent'];
  if (typeof v === 'string' && HEX6.test(v.trim())) return v.trim();
  const ar = config?.arContent as { framePalette?: { accent?: unknown } } | undefined;
  const p = ar?.framePalette?.accent;
  return typeof p === 'string' && HEX6.test(p) ? p : null;
}

/** Config keys that belong to the ORIGINAL event and must not be copied:
 *  its pinned greeting card (cards are never duplicated), its uploaded poster
 *  (lives under the old slug's storage prefix), and one-off generation stamps. */
const NOT_CLONED = ['primary_card', 'posterUrl'] as const;

/**
 * events.config for "Duplicate event": the look, frames, filters, copy and
 * brief carry over; names are rewritten to the new name; the pinned card and
 * poster stay with the original; a booth default pointing at one of the
 * original's own custom experiences is dropped (experiences are not copied —
 * only built-in defaults survive). Guest copy is marked for regeneration by
 * dropping `copy.generatedAt`. Never mutates the input.
 */
export function cloneEventConfig(config: Record<string, unknown> | null | undefined, newName: string): Record<string, unknown> {
  const src: Record<string, unknown> = config ? structuredClone(config) : {};
  for (const k of NOT_CLONED) delete src[k];
  if (typeof src.defaultExperienceId === 'string' && !src.defaultExperienceId.startsWith('builtin:')) {
    delete src.defaultExperienceId;
  }
  const copy = (src.copy && typeof src.copy === 'object' ? { ...(src.copy as Record<string, unknown>) } : {}) as Record<string, unknown>;
  delete copy.generatedAt;
  copy.eventName = newName;
  copy.fullName = newName;
  src.copy = copy;
  if (typeof src.name === 'string') src.name = newName;
  return src;
}

/** "Jenna's Wedding" → "Jenna's Wedding (copy)", capped at the 80-char name limit. */
export function duplicateName(name: string): string {
  const suffix = ' (copy)';
  return `${name.trim().slice(0, 80 - suffix.length)}${suffix}`;
}

/** Slugs to try for a duplicate, in order: `<slug>-copy`, `-copy-2` … `-copy-5`,
 *  each trimmed to the 63-char slug limit without a trailing dash. */
export function duplicateSlugCandidates(slug: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const tail = i === 1 ? '-copy' : `-copy-${i}`;
    const head = slug.slice(0, 63 - tail.length).replace(/-+$/, '');
    out.push(`${head}${tail}`);
  }
  return out;
}
