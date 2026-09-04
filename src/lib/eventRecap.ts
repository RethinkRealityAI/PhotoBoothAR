/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The post-event recap's rules — who may see an album, and what the album says
 * about itself.
 *
 * WHY THIS IS A SEPARATE RULE FROM `eventAccess.ts`. That module answers "may
 * this viewer open the BOOTH", and its answer for a finished event is a firm no:
 * a guest who scans a poster weeks later must not be able to post to an event
 * that is over. The recap asks the opposite question. It is the thing that
 * survives the night — the album a host sends round the next morning — so it
 * must open precisely when the booth has closed. Two questions, two rules; a
 * single shared function would have to be told which caller was asking, which
 * is how a gate ends up accidentally open.
 *
 * A DRAFT event has no album because it has no night yet, and an unknown status
 * is treated as draft for the same reason `guestAccess` does: a status added
 * server-side must never publish an album by default.
 *
 * Pure — no React, no supabase, no DOM — so every rule here is checked in the
 * node suite rather than inferred from a component.
 */

/** The shape the recap needs from a post row; anything wider is fine. */
export interface RecapPost {
  id: string;
  session_id: string | null;
  /** 'video' for clips; absent or anything else counts as a still. */
  media_type?: string | null;
}

/** What the /r/:slug page should render for an event in a given status. */
export type RecapAccess =
  /** Show the album. */
  | 'open'
  /** There is no album to show — the event never happened (draft/unknown). */
  | 'not-available';

/**
 * Recap visibility by event status.
 *
 * `live` is included on purpose: a host wants the link to work while the party
 * is still running, and a guest who opens it mid-event should see the night so
 * far rather than a locked door. `archived` is included because archiving is a
 * host's filing decision about their own dashboard, and it would be a nasty
 * surprise if it silently broke a link already sent to a hundred guests.
 */
export function recapAccess(status: string): RecapAccess {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'live' || s === 'ended' || s === 'archived') return 'open';
  return 'not-available';
}

export interface RecapCounts {
  /** Photos and clips on the wall. */
  moments: number;
  /**
   * Distinct devices that posted. Called "guests" in the copy, and that is an
   * approximation worth being honest about internally: `session_id` is a
   * per-device key, so one person on two phones counts twice and a shared
   * booth iPad counts once. It is the only number the wall can actually know,
   * and it is right far more often than it is wrong.
   */
  guests: number;
}

/** Count an album. Rows with no session id still count as moments — the post
 *  is real — but they cannot be attributed to a device, so they add no guest. */
export function recapCounts(posts: readonly RecapPost[]): RecapCounts {
  const devices = new Set<string>();
  for (const p of posts) {
    const sid = (p.session_id ?? '').trim();
    if (sid !== '') devices.add(sid);
  }
  return { moments: posts.length, guests: devices.size };
}

/** Pluralise without the "1 moments" bug that makes a page look unfinished. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The line under the event name: "142 moments · 38 guests".
 *
 * An album with no attributable device drops the second half rather than
 * printing "0 guests" over a wall that plainly has photos on it.
 */
export function recapCountLine(counts: RecapCounts): string {
  const moments = plural(counts.moments, 'moment', 'moments');
  if (counts.guests <= 0) return moments;
  return `${moments} · ${plural(counts.guests, 'guest', 'guests')}`;
}

/**
 * Just the stills.
 *
 * The collage is drawn with `drawImage` from an `HTMLImageElement`, and a clip's
 * URL handed to `new Image()` simply fails to decode — it would silently become
 * a blank slot in the middle of the keepsake. Clips still appear in the album;
 * they are only excluded from the thing that has to be painted.
 */
export function stillPhotos<T extends RecapPost>(posts: readonly T[]): T[] {
  return posts.filter((p) => p.media_type !== 'video');
}

/** File name for a single photo saved off the recap. Mirrors WallLightbox's
 *  `<prefix>-<id8>.<ext>` so a guest's downloads folder looks consistent
 *  whether they saved from the wall on the night or the album afterwards. */
export function recapPhotoFileName(prefix: string, post: { id: string; media_type?: string | null; }, url: string): string {
  const clean = (prefix || 'event').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
  const ext = post.media_type === 'video' ? (url.includes('.mp4') ? 'mp4' : 'webm') : 'jpg';
  return `${clean}-${post.id.slice(0, 8)}.${ext}`;
}

/* ------------------------------------------------------------------ */
/* Telling the host what the send actually did                         */
/* ------------------------------------------------------------------ */

/**
 * `keepsakeContacts.ts` returns a typed result; it does not say it out loud,
 * because the words belong to whichever surface is asking. This is the host's
 * wording, for the Share & Print kit.
 *
 * The rule that governs every line: NEVER claim a delivery we cannot confirm.
 * `emailConfigured` is only true when the server reported a completed send, so
 * a network failure and an unreadable body both say "we can't tell" rather than
 * a reassuring number — a host who believes forty guests were mailed and finds
 * out on Monday that nobody was is the failure worth designing against.
 */
export interface KeepsakeSendOutcome {
  ok: boolean;
  sent: number;
  skipped?: number;
  failed?: number;
  /** The typed `KeepsakeSendError` union, or null on success. Widened to string
   *  so this module carries no import from the send client. */
  error: string | null;
}

export interface KeepsakeToast {
  tone: 'success' | 'error' | 'info';
  message: string;
}

const SEND_ERROR_COPY: Record<string, string> = {
  email_not_configured:
    'Email isn’t switched on for Beamwall yet, so nothing was sent. Your platform admin needs to add a sending address — no guest was emailed.',
  email_failed:
    'The email service turned the send down. Nothing went out — give it a few minutes and try again.',
  event_still_live:
    'This event is still live. End it first, then send the album — guests should get it once the night is over.',
  recently_sent:
    'You sent this a few minutes ago. Wait a moment, or use Send again if you really do want a second copy to go out.',
  preview_rate_limited:
    'That’s a lot of previews in a short time. Wait a minute and try again.',
  invalid_email: 'That doesn’t look like an email address.',
  unauthorized: 'You’ve been signed out. Sign in again and retry — nothing was sent.',
  forbidden: 'This account can’t send for this event. Nothing was sent.',
  event_not_found: 'We couldn’t find this event. Nothing was sent.',
  invalid_body: 'Something about the request was wrong, so nothing was sent.',
  network:
    'We couldn’t reach the server, so we can’t tell you whether anything was sent. Check your connection before sending again.',
  internal:
    'The server answered, but not with anything we could read — we can’t confirm the send either way.',
};

/** Human wording for a finished (or failed) keepsake send. */
export function keepsakeSendMessage(result: KeepsakeSendOutcome): KeepsakeToast {
  if (!result.ok || result.error !== null) {
    const code = result.error ?? 'internal';
    return { tone: 'error', message: SEND_ERROR_COPY[code] ?? SEND_ERROR_COPY.internal };
  }
  if (result.sent <= 0) {
    // A real success with nothing to do. Calling that an error would send a
    // host hunting for a bug that is really just an empty opt-in list.
    return {
      tone: 'info',
      message: 'Nobody has left an address for this event yet, so there was nothing to send.',
    };
  }
  const parts = [`Album sent to ${plural(result.sent, 'guest', 'guests')}.`];
  if ((result.skipped ?? 0) > 0) parts.push(`${result.skipped} already had it.`);
  if ((result.failed ?? 0) > 0) parts.push(`${result.failed} didn’t go through.`);
  return { tone: (result.failed ?? 0) > 0 ? 'info' : 'success', message: parts.join(' ') };
}

/** Human wording for the one-address preview send. */
export function keepsakePreviewMessage(
  result: { ok: boolean; sent: number; error: string | null },
  email: string,
): KeepsakeToast {
  if (!result.ok || result.error !== null) {
    const code = result.error ?? 'internal';
    return { tone: 'error', message: SEND_ERROR_COPY[code] ?? SEND_ERROR_COPY.internal };
  }
  return { tone: 'success', message: `Preview sent to ${email}. Check your inbox — and your spam folder.` };
}
