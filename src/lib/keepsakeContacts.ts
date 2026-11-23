/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guest keepsake email — client side.
 *
 * A guest who liked their photo can leave an address at the booth, once, and
 * get ONE email after the event with a link to the public recap page. This
 * module owns both halves of that: the guest's consented insert into
 * `guest_contacts` (migration 034), and the host's calls to the
 * `send-keepsakes` edge function.
 *
 * SHAPE: the pure helpers below are exported and node-tested; everything that
 * touches the network imports `./supabase` LAZILY, inside the function body, so
 * this module's static graph never reaches the browser client and a colocated
 * `.test.ts` can import it in the vitest node env. That is the same arrangement
 * `challengeValidation.ts` uses, for the same reason.
 *
 * `session.ts` is a plain static import: it reaches nothing but type-only
 * modules, and it owns the localStorage half (the "already opted in" flag).
 */
import { getSessionId, hasKeepsakeOptIn, markKeepsakeOptIn } from './session';
import { normalizeKeepsakeSettings, type KeepsakeSettings } from './keepsakeSettings';

/** Re-exported so callers have ONE import for the whole feature. The single
 *  definition stays in session.ts beside the other per-device flags. */
export { hasKeepsakeOptIn };

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Pragmatic shape check, not RFC 5322 — the same rule the edge functions use
 *  (card-publish/index.ts:40) and migration 034's CHECK enforces, so a guest
 *  can never be told "saved" by one layer and rejected by the next. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** RFC 5321's ceiling, matching 034's CHECK. */
const EMAIL_MAX = 320;

/**
 * Clean a typed address, or null when it is not one.
 *
 * Trimmed but NOT lower-cased: the domain half is case-insensitive but the
 * local half is not, and mangling an exotic-but-valid address to look tidy
 * would silently send the keepsake nowhere. Nothing here depends on case —
 * de-duplication is by `session_id`, not by address.
 */
export function normalizeKeepsakeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim();
  if (!clean || clean.length > EMAIL_MAX) return null;
  return EMAIL_RE.test(clean) ? clean : null;
}

export type KeepsakeOptInError =
  /** The address never looked like one — nothing was sent to the server. */
  | 'invalid_email'
  /** The event is a draft or no longer exists: RLS refused the row. */
  | 'event_closed'
  /** This event already holds 500 contacts (034's abuse cap). */
  | 'cap_reached'
  /** Transport, or an error we did not anticipate. */
  | 'failed';

export interface KeepsakeOptInResult {
  ok: boolean;
  /** True when this device had already opted in for this event. The guest IS
   *  subscribed either way, so the UI must show success, not an error. */
  alreadySaved: boolean;
  error: KeepsakeOptInError | null;
}

/**
 * Turn a PostgREST error into what the guest is told.
 *
 * `null`/undefined code = the insert succeeded.
 *
 * The interesting case is 23505 (unique_violation on `(event_id, session_id)`).
 * That is not a failure: it means this device already left an address for this
 * event. Since there is deliberately no UPDATE policy on `guest_contacts` — a
 * browser must not be able to rewrite another device's row — a second attempt
 * can only ever collide, and reporting an error would tell a guest who IS
 * subscribed that they are not.
 */
export function classifyOptInError(
  code: string | null | undefined,
  message?: string | null,
): KeepsakeOptInResult {
  if (code === null || code === undefined || code === '') {
    return { ok: true, alreadySaved: false, error: null };
  }
  if (code === '23505') return { ok: true, alreadySaved: true, error: null };
  // 42501 = the WITH CHECK failed (draft event); 23503 = the FK to events(slug)
  // failed (the event was deleted out from under the booth). Both mean the same
  // thing to a guest: this event is not taking addresses.
  if (code === '42501' || code === '23503') {
    return { ok: false, alreadySaved: false, error: 'event_closed' };
  }
  if (code === 'P0001' && (message ?? '').includes('guest_contact_cap')) {
    return { ok: false, alreadySaved: false, error: 'cap_reached' };
  }
  return { ok: false, alreadySaved: false, error: 'failed' };
}

/** One short, warm sentence per outcome. No jargon, no error codes: a guest at
 *  a party is not going to debug this. */
export function keepsakeOptInMessage(error: KeepsakeOptInError | null): string {
  switch (error) {
    case null:
      return "We'll email you after the event ✓";
    case 'invalid_email':
      return 'That address looks incomplete — mind checking it?';
    case 'event_closed':
      return "This event isn't collecting addresses right now.";
    case 'cap_reached':
      return "We've got a full list for tonight — ask a host and they'll sort you out.";
    default:
      return "Couldn't save that just now. Try again?";
  }
}

export type KeepsakeSendError =
  | 'unauthorized'
  | 'forbidden'
  | 'event_not_found'
  | 'event_still_live'
  | 'recently_sent'
  | 'preview_rate_limited'
  | 'send_cap_reached'
  | 'invalid_email'
  | 'invalid_body'
  | 'email_not_configured'
  | 'email_failed'
  | 'internal'
  | 'network';

export interface KeepsakeSendResult {
  ok: boolean;
  sent: number;
  skipped: number;
  failed: number;
  /**
   * True ONLY when the server actually reported a completed send.
   *
   * Every error path leaves it false, including transport errors — we cannot
   * confirm a delivery we never heard back about, and a UI that reads this as
   * "email works" on a dropped connection would tell a host their guests were
   * mailed when nobody knows. `error` is where the reason lives.
   */
  emailConfigured: boolean;
  error: KeepsakeSendError | null;
}

export interface KeepsakePreviewResult {
  ok: boolean;
  sent: number;
  emailConfigured: boolean;
  error: KeepsakeSendError | null;
}

const SEND_ERRORS: readonly string[] = [
  'unauthorized',
  'forbidden',
  'event_not_found',
  'event_still_live',
  'recently_sent',
  'preview_rate_limited',
  'send_cap_reached',
  'invalid_email',
  'invalid_body',
  'email_not_configured',
  'email_failed',
  'internal',
  'network',
];

/** Keep an unrecognised server code out of the typed union rather than casting
 *  it in — an unknown failure is still a failure, and 'internal' says so. */
export function asSendError(code: unknown): KeepsakeSendError {
  return typeof code === 'string' && SEND_ERRORS.includes(code)
    ? (code as KeepsakeSendError)
    : 'internal';
}

/** Coerce a numeric field from an untrusted body; anything non-finite is 0. */
function count(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/**
 * Coerce the edge function's 200 body into a typed result.
 *
 * A body that does not actually say `emailConfigured: true` is NOT treated as a
 * success — a garbled or truncated response must not render as "sent to 40
 * guests" when we have no idea what happened.
 */
export function normalizeSendResult(raw: unknown): KeepsakeSendResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.emailConfigured !== true) {
    return { ok: false, sent: 0, skipped: 0, failed: 0, emailConfigured: false, error: 'internal' };
  }
  return {
    ok: true,
    sent: count(r.sent),
    skipped: count(r.skipped),
    failed: count(r.failed),
    emailConfigured: true,
    error: null,
  };
}

/** The failure shape, so no call site has to build one by hand. */
export function sendErrorResult(error: KeepsakeSendError): KeepsakeSendResult {
  return { ok: false, sent: 0, skipped: 0, failed: 0, emailConfigured: false, error };
}

/* ------------------------------------------------------------------ */
/* Guest: leave an address                                             */
/* ------------------------------------------------------------------ */

/**
 * Store one consented address for this device + event.
 *
 * A plain `.insert()` with no `.select()` chained: `guest_contacts` grants the
 * browser INSERT and nothing else, so asking for the row back would be denied
 * by the very policy that makes this safe.
 */
export async function saveKeepsakeOptIn(
  eventId: string,
  email: string,
): Promise<KeepsakeOptInResult> {
  const clean = normalizeKeepsakeEmail(email);
  if (!clean) return { ok: false, alreadySaved: false, error: 'invalid_email' };

  try {
    const { supabase } = await import('./supabase');
    const { error } = await supabase.from('guest_contacts').insert({
      event_id: eventId,
      session_id: getSessionId(eventId),
      email: clean,
    });
    const outcome = classifyOptInError(error?.code, error?.message);
    // Set the local flag on BOTH success shapes: an already-present row means
    // this device is subscribed, and re-asking would read as "it didn't work".
    if (outcome.ok) markKeepsakeOptIn(eventId);
    if (!outcome.ok) console.warn('[keepsakeContacts] opt-in failed', error);
    return outcome;
  } catch (e) {
    console.warn('[keepsakeContacts] opt-in threw', e);
    return { ok: false, alreadySaved: false, error: 'failed' };
  }
}

/* ------------------------------------------------------------------ */
/* Host: send them                                                     */
/* ------------------------------------------------------------------ */

/** Unwrap a functions.invoke error into our code union (managerApi.ts's shape,
 *  with both imports lazy so this module stays node-importable). */
async function invokeError(error: unknown): Promise<KeepsakeSendError> {
  try {
    const { FunctionsHttpError } = await import('@supabase/supabase-js');
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json()) as { error?: string };
      return asSendError(body.error);
    }
  } catch {
    /* the body was not JSON, or the class could not be loaded */
  }
  return 'network';
}

/**
 * Mail every opted-in guest of an ended event.
 *
 * `resend: true` re-sends to contacts already stamped `last_sent_at` AND
 * overrides the server's 10-minute cooldown — it is the deliberate "yes, again"
 * and should always be an explicit host action, never a retry default.
 * `collageUrl` is an optional https image shown at the top of the email.
 */
export async function sendKeepsakes(
  eventUuid: string,
  opts?: { resend?: boolean; collageUrl?: string },
): Promise<KeepsakeSendResult> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.functions.invoke('send-keepsakes', {
      body: {
        op: 'send',
        eventUuid,
        resend: opts?.resend === true,
        collageUrl: opts?.collageUrl ?? undefined,
      },
    });
    if (error) return sendErrorResult(await invokeError(error));
    return normalizeSendResult(data);
  } catch (e) {
    console.error('[keepsakeContacts] sendKeepsakes', e);
    return sendErrorResult('network');
  }
}

/**
 * Send one keepsake to one address so a member can see it before the room does.
 * Reads and writes no guest data, and works on an event of any status.
 */
export async function sendKeepsakePreview(
  eventUuid: string,
  testEmail: string,
): Promise<KeepsakePreviewResult> {
  const clean = normalizeKeepsakeEmail(testEmail);
  if (!clean) return { ok: false, sent: 0, emailConfigured: false, error: 'invalid_email' };

  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.functions.invoke('send-keepsakes', {
      body: { op: 'preview', eventUuid, testEmail: clean },
    });
    if (error) {
      return { ok: false, sent: 0, emailConfigured: false, error: await invokeError(error) };
    }
    const r = normalizeSendResult(data);
    return { ok: r.ok, sent: r.sent, emailConfigured: r.emailConfigured, error: r.error };
  } catch (e) {
    console.error('[keepsakeContacts] sendKeepsakePreview', e);
    return { ok: false, sent: 0, emailConfigured: false, error: 'network' };
  }
}

/* ── The next-day autopilot switch (config.keepsakes.autoSend) ─────────
 * On unless a host turned it off — send-keepsakes/autopilot.ts
 * autoSendEnabled() is the reader, and only an explicit false means off. */

/** The host's switch for this event; null when it could not be read (the
 *  panel then shows no toggle rather than a guess). */
export async function fetchKeepsakeAutoSend(eventUuid: string): Promise<boolean | null> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.from('events').select('config').eq('id', eventUuid).maybeSingle();
    if (error || !data) return null;
    const k = (data.config as { keepsakes?: { autoSend?: unknown } } | null)?.keepsakes;
    return k?.autoSend !== false;
  } catch (e) {
    console.error('[keepsakeContacts] fetchKeepsakeAutoSend', e);
    return null;
  }
}

/* ── The host's keepsake settings (config.keepsakes, keepsakeSettings.ts) ── */

/**
 * Lay the editor's settings over what is stored, key by key. PURE.
 *
 * Unknown keys survive at the top level AND inside `downloads`/`copy`: a newer
 * build (or the film worker) may keep its own field there, and an older editor
 * saving over it must not delete it. Known keys always take the editor's value.
 */
export function mergeKeepsakeSettings(prevRaw: unknown, next: KeepsakeSettings): Record<string, unknown> {
  const obj = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const prev = obj(prevRaw);
  return {
    ...prev,
    autoSend: next.autoSend,
    theme: next.theme,
    music: next.music,
    beamy: next.beamy,
    downloads: { ...obj(prev.downloads), ...next.downloads },
    copy: { ...obj(prev.copy), ...next.copy },
  };
}

export interface KeepsakeSettingsRead {
  settings: KeepsakeSettings;
  /** events.slug — the key the feature resolver and the album page use. */
  slug: string;
}

/** The event's keepsake settings, normalised; null when they could not be read
 *  (the editor then shows a retry, never defaults it could save over a real
 *  configuration). */
export async function fetchKeepsakeSettings(eventUuid: string): Promise<KeepsakeSettingsRead | null> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.from('events').select('slug, config').eq('id', eventUuid).maybeSingle();
    if (error || !data) {
      if (error) console.error('[keepsakeContacts] fetchKeepsakeSettings', error);
      return null;
    }
    const k = (data.config as { keepsakes?: unknown } | null)?.keepsakes;
    return { settings: normalizeKeepsakeSettings(k), slug: typeof data.slug === 'string' ? data.slug : '' };
  } catch (e) {
    console.error('[keepsakeContacts] fetchKeepsakeSettings', e);
    return null;
  }
}

/** Save the editor's settings. Merges into config.keepsakes (unknown keys kept,
 *  see mergeKeepsakeSettings). True only when the row was actually written —
 *  a refused read, a write error and a zero-row write all return false. */
export async function saveKeepsakeSettings(eventUuid: string, settings: KeepsakeSettings): Promise<boolean> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.from('events').select('config').eq('id', eventUuid).maybeSingle();
    if (error || !data) return false;
    const { updateEventConfig } = await import('./host');
    const prev = (data.config as { keepsakes?: unknown } | null)?.keepsakes;
    return await updateEventConfig(eventUuid, { keepsakes: mergeKeepsakeSettings(prev, settings) });
  } catch (e) {
    console.error('[keepsakeContacts] saveKeepsakeSettings', e);
    return false;
  }
}

/** Whether this event's plan includes the keepsake film: a paid event is one
 *  whose resolved features drop the watermark. null when unknown (the editor
 *  then says nothing rather than a guess). */
export async function fetchKeepsakeFilmIncluded(slug: string): Promise<boolean | null> {
  if (slug === '') return null;
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.rpc('event_features', { p_slug: slug });
    if (error || data === null || typeof data !== 'object') return null;
    const raw = (data as Record<string, unknown>).watermark;
    return typeof raw === 'boolean' ? raw === false : null;
  } catch (e) {
    console.error('[keepsakeContacts] fetchKeepsakeFilmIncluded', e);
    return null;
  }
}

/** Turn the next-day send on or off. Merges into config.keepsakes so a
 *  future key there survives. Returns whether the write landed. */
export async function setKeepsakeAutoSend(eventUuid: string, on: boolean): Promise<boolean> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.from('events').select('config').eq('id', eventUuid).maybeSingle();
    if (error || !data) return false;
    const { updateEventConfig } = await import('./host');
    const prev = (data.config as { keepsakes?: Record<string, unknown> } | null)?.keepsakes;
    return await updateEventConfig(eventUuid, { keepsakes: { ...(prev ?? {}), autoSend: on } });
  } catch (e) {
    console.error('[keepsakeContacts] setKeepsakeAutoSend', e);
    return false;
  }
}
