/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Archiving — the pure half of /host's event lifecycle.
 *
 * `events.status` is the authority (001's CHECK: draft/live/ended/archived);
 * `events.archived_at` (migration 031) is a display companion, so nothing here
 * ever infers "archived" from the timestamp. Archiving is the product's
 * soft-delete: migration 032 caps an org at 100 NON-archived events, so this is
 * the headroom escape hatch — and it destroys nothing (posts, cards and the
 * credit ledger are untouched, and Restore puts the event back).
 *
 * Permanent delete lives at the bottom of this file, and the reason it needs a
 * service-role edge function is NOT the one first written here. Verified against
 * the live catalog: all 13 FKs to `public.events` are declared — posts, cards,
 * challenges, app_settings, experiences, event_catalog_links and guest_quota
 * CASCADE from `events.slug`; event_plans, event_access_tokens and
 * event_feature_overrides CASCADE from `events.id`; ai_jobs, orders and
 * support_tickets SET NULL (business records outlive the event). The DB rows
 * take care of themselves. What does NOT cascade is STORAGE: every capture,
 * asset, card media file and rendered film would be orphaned bytes with no row
 * left pointing at them — which is why `deleteEvent` sweeps the buckets first
 * and deletes the row last.
 */
import { formatDate } from './adminFormat';

/** Statuses an event can be archived FROM. A live event must be ended first —
 *  archiving one out from under a party in progress is never what was meant.
 *  Unknown statuses fail closed, the same stance `guestAccess` takes. */
export function canArchiveStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'draft' || s === 'ended';
}

export function isArchivedStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'archived';
}

/**
 * Restoring lands on 'ended', not on the status the event held before.
 * Nothing records that previous status, and guessing 'live' would reopen a
 * booth (submit-post accepts posts only while status === 'live'). 'ended' is
 * the one restore that can surprise nobody — Go live is still one click away.
 */
export const RESTORE_STATUS = 'ended';

/**
 * Split an already-fetched list into the two shelves the grid renders. One
 * pass, order preserved (fetchMyEvents sorts created_at desc) — the archive
 * view must never cost a second query.
 */
export function partitionByArchived<T extends { status: string }>(
  list: readonly T[],
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const item of list) (isArchivedStatus(item.status) ? archived : active).push(item);
  return { active, archived };
}

/**
 * Local calendar day as an integer day number.
 *
 * Built from the LOCAL y/m/d components through Date.UTC so the subtraction
 * never crosses a DST boundary: differencing raw timestamps by 86_400_000
 * reports 0 for the 23-hour US spring-forward day, i.e. "today" for something
 * archived yesterday. (JS months are 0-indexed; getDate() is day-of-month.)
 */
function localDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Calendar days older than this get an absolute date instead of "N days ago". */
const RELATIVE_DAYS_MAX = 30;

/**
 * "Archived today" / "Archived yesterday" / "Archived 6 days ago" /
 * "Archived on Jul 6, 2026".
 *
 * A missing or unparseable timestamp returns a bare "Archived" — the status
 * says it is archived, and inventing a date to fill the line would be a lie
 * about a column that is simply null (every event archived before migration
 * 031 landed has exactly that).
 *
 * Day-difference traces (localDayNumber differences, all DST-safe):
 *   Jan 31 → Feb 1  = 1 → "yesterday" (no month arithmetic is performed)
 *   Dec 31 → Jan 1  = 1 → "yesterday" (Date.UTC normalizes the year rollover)
 *   2024-03-09 → 2024-03-10 (US spring forward, 23h local day) = 1, not 0
 * A future timestamp (clock skew) floors to "today" rather than "-2 days ago".
 */
export function archivedLabel(
  archivedAt: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!archivedAt) return 'Archived';
  const t = Date.parse(archivedAt);
  if (Number.isNaN(t)) return 'Archived';
  const days = localDayNumber(new Date(now)) - localDayNumber(new Date(t));
  if (days <= 0) return 'Archived today';
  if (days === 1) return 'Archived yesterday';
  if (days < RELATIVE_DAYS_MAX) return `Archived ${days} days ago`;
  return `Archived on ${formatDate(archivedAt)}`;
}

/* ── Permanent delete ─────────────────────────────────────────────── */

/**
 * Permanent delete is offered ONLY on an already-archived event.
 *
 * Two steps, not one: archiving is the reversible retirement, and a host who
 * has lived with an event on the archived shelf for a while is a host who is
 * actually finished with it. `delete-event` re-checks this server-side (403
 * `must_archive_first`) — a client-only gate is a suggestion.
 */
export function canDeleteStatus(status: string | null | undefined): boolean {
  return isArchivedStatus(status);
}

/**
 * Type-to-confirm gate for the permanent delete: the host must retype the
 * event's own name.
 *
 * MIRRORED — `supabase/functions/delete-event/index.ts` (`confirmMatches`)
 * applies the identical rule to the name it reads from the row itself; Deno
 * cannot import from src/, so the tests beside this file are the contract both
 * halves are written against. Change one, change both.
 *
 * Rules: both sides trimmed (a name pasted out of the UI arrives with
 * whitespace, and "you typed a space" is a cruel failure); case-SENSITIVE
 * (this is the last gate in front of an irreversible delete, and case is the
 * cheapest evidence that the host read the name rather than pattern-matched
 * it); an empty target name can never be confirmed, so a nameless row cannot
 * be deleted by typing nothing.
 */
export function confirmNameMatches(
  typed: string | null | undefined,
  actual: string | null | undefined,
): boolean {
  const a = (typed ?? '').trim();
  const b = (actual ?? '').trim();
  return a.length > 0 && a === b;
}
