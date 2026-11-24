/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Media retention: the pure half.
 *
 * The plans have always PROMISED retention (7 / 90 / 365 days, now 730 on
 * Deluxe), but until 2026-11-19 nothing ever removed anything, so storage grew
 * forever and the privacy promise in the pricing table was not kept. The
 * `media-retention` edge function is the enforcer; this file is the policy
 * both it and the host dashboard read, so the date a host is shown is the date
 * the purge will use.
 *
 * MIRRORED in supabase/functions/media-retention/index.ts (Deno cannot import
 * from src/). retention.test.ts reads that file and fails if any constant here
 * drifts from it — the same contract-by-test idiom as postDelete/mediaUrl.
 *
 * Pure: no React, no supabase import (node-env tests import this).
 */

/** Days before the deadline that the host is emailed a download reminder. */
export const RETENTION_NOTICE_DAYS = 14;

/**
 * The clock never starts before the policy existed. Every event that ended
 * before this date is treated as ending ON it, so turning enforcement on can
 * never delete an existing customer's photos without the full retention window
 * (and the reminder) first.
 */
export const RETENTION_POLICY_START = '2026-11-19T00:00:00Z';

/** The three frozen coded events. Never purged, whatever the resolver says. */
export const RETENTION_EXEMPT_SLUGS: readonly string[] = ['hope-gala', 'jenna-jake', 'detola-wuyi'];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionEvent {
  slug: string;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
}

function parse(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * When the clock starts: the event's end, else its start, else its creation,
 * and never before the policy date.
 */
export function retentionAnchor(ev: RetentionEvent): number | null {
  const own = parse(ev.ends_at) ?? parse(ev.starts_at) ?? parse(ev.created_at);
  if (own === null) return null;
  return Math.max(own, Date.parse(RETENTION_POLICY_START));
}

/** The moment media may be removed, or null when it is kept forever. */
export function retentionDeadline(ev: RetentionEvent, retentionDays: number | null): number | null {
  if (retentionDays === null || !Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  const anchor = retentionAnchor(ev);
  if (anchor === null) return null;
  return anchor + retentionDays * DAY_MS;
}

export type RetentionStage = 'keep' | 'notify' | 'purge';

/**
 * What the enforcer should do with this event right now.
 *
 * 'keep' for anything exempt, live, kept forever or not yet near its date.
 * A LIVE event is never purged even past its date: a host whose event is still
 * running has, by definition, not finished with the photos. The notice must
 * have gone out before a purge (`noticeSentAt`), and at least
 * RETENTION_NOTICE_DAYS before it — if the reminder could not be sent (no
 * email key, no owner address), the purge waits rather than deleting
 * unannounced.
 */
export function retentionStage(
  ev: RetentionEvent,
  retentionDays: number | null,
  noticeSentAt: string | null,
  now: number,
): RetentionStage {
  if (RETENTION_EXEMPT_SLUGS.includes(ev.slug)) return 'keep';
  if ((ev.status ?? '').trim().toLowerCase() === 'live') return 'keep';
  const deadline = retentionDeadline(ev, retentionDays);
  if (deadline === null) return 'keep';
  const notice = parse(noticeSentAt);
  if (notice === null) return now >= deadline - RETENTION_NOTICE_DAYS * DAY_MS ? 'notify' : 'keep';
  // The purge date is whichever is later: the plan deadline, or a full notice
  // period after the reminder actually went out.
  const purgeAt = Math.max(deadline, notice + RETENTION_NOTICE_DAYS * DAY_MS);
  return now >= purgeAt ? 'purge' : 'keep';
}

/* ------------------------------------------------------------------ */
/* Host "download everything"                                          */
/* ------------------------------------------------------------------ */

export interface DownloadablePost {
  id: string;
  media_type: string | null;
}

/** Worst-case sizes used to split the download BEFORE anything is fetched. */
const EST_PHOTO_BYTES = 1 * 1024 * 1024;
const EST_VIDEO_BYTES = 48 * 1024 * 1024; // = plans.ts VIDEO_CLIP_BYTE_BUDGET (a clip's worst case)
/** Per archive. Well under bulkSave's 1.5 GB in-memory ceiling and the classic
 *  ZIP 4 GB limit, so one part can never be refused half-way through. */
export const DOWNLOAD_PART_BYTES = 900 * 1024 * 1024;

/**
 * Split an event's posts into downloads small enough for a browser to zip in
 * memory. Order is preserved; every post lands in exactly one part.
 */
export function downloadParts<T extends DownloadablePost>(posts: T[], partBytes = DOWNLOAD_PART_BYTES): T[][] {
  const parts: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const p of posts) {
    const est = p.media_type === 'video' ? EST_VIDEO_BYTES : EST_PHOTO_BYTES;
    if (current.length > 0 && size + est > partBytes) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += est;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/** "Kept until 19 Nov 2027" / "Kept forever". */
export function formatKeptUntil(deadline: number | null): string {
  if (deadline === null) return 'Kept forever';
  return `Kept until ${new Date(deadline).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })}`;
}
