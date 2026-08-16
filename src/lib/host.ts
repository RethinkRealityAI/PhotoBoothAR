/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed data helpers for the host platform (/host): orgs, events, credits and
 * day-of manager access tokens. Everything runs on the shared session-authed
 * supabase client — RLS scopes every query to the signed-in member.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { ListResult } from './db';
import { sha256Hex } from './hash';
import { mapBytesToChars, TOKEN_ALPHABET, TOKEN_LENGTH } from './token';

/* ------------------------------------------------------------------ */
/* Orgs & credits                                                      */
/* ------------------------------------------------------------------ */

export interface HostOrg {
  orgId: string;
  name: string;
  role: 'owner' | 'editor';
}

export interface MyOrgResult {
  org: HostOrg | null;
  /** True ONLY on a genuine query FAILURE (network/RLS) — distinct from a
   *  successful fetch that found no membership (org null, failed false). Lets
   *  callers show a retry state instead of false "create your first event". */
  failed: boolean;
}

/** The org half of an `org_members` row as PostgREST returns it. A to-one
 *  embed comes back as an object, but the client has historically handed back a
 *  one-element ARRAY for the same shape — both are handled below. */
interface OrgJoin {
  id: string;
  name: string;
  owner_id?: string | null;
}

/** One membership row of the caller's, joined to its org. */
export interface OrgMembershipRow {
  role: string;
  created_at?: string | null;
  orgs: OrgJoin | OrgJoin[] | null;
}

/**
 * Which of several memberships is "the" org — for billing, credits and the host
 * header. This is deliberately NOT an org switcher (a separate feature); it is
 * the rule that makes a multi-org host land on the SAME org every time instead
 * of on whatever row Postgres happened to return first:
 *
 *   1. the org this user OWNS (`orgs.owner_id` = them) — the one they created,
 *      and the one whose card is on file;
 *   2. else the org where their own membership role is 'owner' (migration 011
 *      enrols an org's owner as an 'owner' member, so this is the same fact
 *      read from the other side — and it still holds when `orgs.owner_id` was
 *      nulled out by a user deletion);
 *   3. else their earliest-joined membership.
 *
 * Ties within a tier fall to join order, because the caller asks the DB for
 * `created_at` ascending. `rows` must contain only the CALLER's memberships —
 * `org_members` RLS (`is_org_member(org_id)`) also exposes colleagues' rows.
 */
export function pickPrimaryOrg(rows: OrgMembershipRow[], userId: string | null): HostOrg | null {
  const joined = rows
    .map((row) => ({ row, org: (Array.isArray(row.orgs) ? row.orgs[0] ?? null : row.orgs) }))
    .filter((entry): entry is { row: OrgMembershipRow; org: OrgJoin } => entry.org !== null);
  if (joined.length === 0) return null;

  const owned =
    userId === null || userId === ''
      ? undefined
      : joined.find((entry) => entry.org.owner_id === userId);
  const chosen = owned ?? joined.find((entry) => entry.row.role === 'owner') ?? joined[0];
  return {
    orgId: chosen.org.id,
    name: chosen.org.name,
    role: chosen.row.role as 'owner' | 'editor',
  };
}

/** Like {@link fetchMyOrg} but distinguishes a query failure from a genuine
 *  no-org result. Mirrors fetchMyEvents' null-vs-[] contract. */
export async function fetchMyOrgResult(): Promise<MyOrgResult> {
  // The caller's own id is needed twice: to keep the query to THEIR membership
  // rows (RLS alone also returns co-members of the same org), and to spot the
  // org they own. Without it there is no answer to give, so a session read that
  // throws is a failure, not a no-org.
  let userId: string | null = null;
  try {
    const { data: sess } = await supabase.auth.getSession();
    userId = sess.session?.user?.id ?? null;
  } catch (e) {
    console.error('[host] fetchMyOrg (session)', e);
    return { org: null, failed: true };
  }
  // Signed out: RLS would return nothing anyway. Genuinely no org, not an error.
  if (userId === null || userId === '') return { org: null, failed: false };

  const { data, error } = await supabase
    .from('org_members')
    .select('role, created_at, orgs(id, name, owner_id)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[host] fetchMyOrg', error);
    return { org: null, failed: true };
  }
  return { org: pickPrimaryOrg((data ?? []) as unknown as OrgMembershipRow[], userId), failed: false };
}

/** The caller's primary org — see {@link pickPrimaryOrg} for which one that is
 *  when they belong to several. Returns null on BOTH failure and no-org — use
 *  fetchMyOrgResult when the distinction matters. */
export async function fetchMyOrg(): Promise<HostOrg | null> {
  return (await fetchMyOrgResult()).org;
}

export async function fetchCreditBalance(orgId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[host] fetchCreditBalance', error);
    return null;
  }
  return (data.balance as number) ?? null;
}

/* ------------------------------------------------------------------ */
/* Billing (subscriptions, ledger, Stripe sessions)                    */
/* ------------------------------------------------------------------ */

export interface SubscriptionRow {
  org_id: string;
  stripe_subscription_id: string | null;
  status: string;
  tier: string;
  current_period_end: string | null;
}

/** The org's Pro subscription row (RLS: members only). Null if none. */
export async function fetchSubscription(orgId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('org_id, stripe_subscription_id, status, tier, current_period_end')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[host] fetchSubscription', error);
    return null;
  }
  return data as SubscriptionRow;
}

export interface LedgerRow {
  id: number;
  delta: number;
  reason: string;
  ref: Record<string, unknown> | null;
  created_at: string;
}

export async function fetchLedgerResult(orgId: string, limit = 20): Promise<ListResult<LedgerRow>> {
  const { data, error } = await supabase
    .from('credit_ledger')
    .select('id, delta, reason, ref, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[host] fetchLedger', error);
    return { rows: [], failed: true };
  }
  return { rows: (data as LedgerRow[]) ?? [], failed: false };
}

export async function fetchLedger(orgId: string, limit = 20): Promise<LedgerRow[]> {
  return (await fetchLedgerResult(orgId, limit)).rows;
}

/**
 * Does the given EVENT's org have an active Pro subscription, from the viewer's
 * perspective? Scoped to the event's org (not the viewer's own): RLS on
 * `subscriptions` only returns rows for orgs the viewer is a member of, so a
 * guest — or a signed-in member of a DIFFERENT org — always resolves false.
 * This keeps the Pro entitlement floor on the viewer's OWN events and never
 * leaks it onto another org's event (e.g. dropping the watermark on a foreign
 * booth). Cached per event-uuid for the page load.
 */
const proFlagByEvent = new Map<string, Promise<boolean>>();
export function eventOrgHasActivePro(eventUuid: string): Promise<boolean> {
  let p = proFlagByEvent.get(eventUuid);
  if (!p) {
    p = (async () => {
      try {
        const { data: ev, error: evErr } = await supabase
          .from('events').select('org_id').eq('id', eventUuid).maybeSingle();
        if (evErr || !ev?.org_id) return false;
        const { data, error } = await supabase
          .from('subscriptions')
          .select('org_id')
          .eq('org_id', ev.org_id as string)
          .eq('status', 'active')
          .maybeSingle();
        if (error) return false;
        return Boolean(data);
      } catch {
        return false;
      }
    })();
    proFlagByEvent.set(eventUuid, p);
  }
  return p;
}
/** Drop the cached Pro flags (e.g. right after returning from checkout). */
export function invalidateProSubscriptionCache(): void {
  proFlagByEvent.clear();
}

export type CheckoutBody =
  | { kind: 'event_package'; tier: 'essentials' | 'premium' | 'deluxe'; eventUuid: string; returnUrl: string }
  | { kind: 'credit_pack'; pack: '50' | '120' | '300'; returnUrl: string }
  | { kind: 'pro_subscription'; returnUrl: string };

export interface BillingSessionResult {
  /** Stripe-hosted URL to redirect to; null on error. */
  url: string | null;
  /** 'billing_not_configured' while Stripe keys are pending, 'billing_test_mode'
   *  while the key is a test key (guests see the same "pending" notice for
   *  both), else edge-fn error code. */
  error: string | null;
}

async function invokeBillingFn(name: string, body: Record<string, unknown>): Promise<BillingSessionResult> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          return { url: null, error: res.error ?? 'internal' };
        } catch {
          return { url: null, error: 'internal' };
        }
      }
      return { url: null, error: 'network' };
    }
    const res = (data ?? {}) as { url?: string };
    return res.url ? { url: res.url, error: null } : { url: null, error: 'internal' };
  } catch (e) {
    console.error(`[host] ${name}`, e);
    return { url: null, error: 'network' };
  }
}

/** Create a Stripe Checkout session; redirect the browser to `url`. */
export function startCheckout(body: CheckoutBody): Promise<BillingSessionResult> {
  return invokeBillingFn('stripe-checkout', body as unknown as Record<string, unknown>);
}

/** Create a Stripe billing-portal session for the org's customer. */
export function openPortal(returnUrl?: string): Promise<BillingSessionResult> {
  return invokeBillingFn('stripe-portal', {
    returnUrl: returnUrl ?? (typeof window !== 'undefined' ? window.location.href : ''),
  });
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export interface HostEventRow {
  id: string;
  slug: string;
  name: string;
  event_type: string;
  status: 'draft' | 'live' | 'ended' | 'archived' | string;
  plan_tier: string;
  created_at: string;
  config: Record<string, unknown> | null;
  /** When the event was archived (migration 031), for display only — `status`
   *  is the authority. Optional because rows that predate the column, and the
   *  create-event edge function's own returned row, simply do not carry it. */
  archived_at?: string | null;
}

/**
 * Slug of the platform's demo/sandbox event. Fixed — deliberately NOT derived
 * from VITE_DEFAULT_EVENT (that's a separate, per-deployment white-label knob
 * for legacy guest-route fallbacks; see App.tsx's own DEFAULT_EVENT_SLUG).
 * RESERVED_SLUGS (src/lib/slug.ts + the create-event edge function) reserves
 * this exact literal so no customer can ever create an event that claims it —
 * if this were tied to a configurable env var instead, a deployment could
 * silently un-reserve the slug just by changing VITE_DEFAULT_EVENT, reopening
 * the leak SHOW_DEMO_EVENT exists to avoid.
 */
export const DEMO_EVENT_SLUG = 'demo';

/**
 * Off by default: `events_public_read` RLS deliberately lets anyone read any
 * non-draft event (guest pages need that), so the demo event is otherwise
 * invisible to hosts with no org — it does NOT show up "by accident". Set
 * VITE_SHOW_DEMO_EVENT=true only to deliberately surface it as a showcase for
 * orgs that haven't created an event yet.
 */
export const SHOW_DEMO_EVENT =
  ((import.meta.env.VITE_SHOW_DEMO_EVENT as string | undefined) ?? '').trim() === 'true';

const EVENT_COLUMNS = 'id, slug, name, event_type, status, plan_tier, created_at, config, archived_at';

/** The caller's org_id memberships. Returned as a plain array — duplicates
 *  are harmless for the `.in('org_id', ...)` filters callers use it for, and
 *  org_members has at most one row per (user, org) pair anyway. Null on
 *  query failure (distinct from an empty array, i.e. genuinely orgless). */
async function fetchMyOrgIds(): Promise<string[] | null> {
  const { data, error } = await supabase.from('org_members').select('org_id');
  if (error) {
    console.error('[host] fetchMyOrgIds', error);
    return null;
  }
  return (data ?? []).map((m) => m.org_id as string);
}

/**
 * Every event the CALLER'S org(s) own — explicitly scoped here, not left to
 * RLS. `events_public_read` allows reading any non-draft event platform-wide
 * (guest pages depend on that), so without this filter every signed-in host
 * would see every customer's events on their own dashboard. Optionally also
 * surfaces the demo event for orgs with none of their own, gated by
 * SHOW_DEMO_EVENT (off by default).
 *
 * Returns null on QUERY FAILURE (network/RLS error) so callers can show a
 * retry state; [] strictly means the caller genuinely has no events.
 */
export async function fetchMyEvents(): Promise<HostEventRow[] | null> {
  const orgIds = await fetchMyOrgIds();
  if (orgIds === null) return null;

  if (orgIds.length === 0) {
    if (!SHOW_DEMO_EVENT) return [];
    const { data: demo, error: demoErr } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('slug', DEMO_EVENT_SLUG)
      .maybeSingle();
    if (demoErr) {
      console.error('[host] fetchMyEvents (demo)', demoErr);
      return null;
    }
    return demo ? [demo as HostEventRow] : [];
  }

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .in('org_id', orgIds)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[host] fetchMyEvents', error);
    return null;
  }
  return (data as HostEventRow[]) ?? [];
}

/**
 * Whether the caller may enter the studio for the event at `slug` — either
 * because they're a real member (the `is_event_member` RPC, the actual
 * RLS-backed check) or, when SHOW_DEMO_EVENT is on, because this is the demo
 * showcase slug AND the caller has no org of their own yet. That second
 * condition matters: without it, a host who already has real events of their
 * own would ALSO get the demo bypass (skipping the membership check
 * entirely) for a slug that isn't theirs — this keeps the demo bypass exactly
 * as narrow as what fetchMyEvents already shows on the dashboard, so the two
 * can't drift into disagreeing about who gets demo access.
 */
/**
 * Is the signed-in viewer a member of this event's org?
 *
 * Used by the guest surface to decide whether a draft or ended event is
 * openable (a host previewing their own build) or closed (a guest who scanned
 * early). Returns false for a signed-out visitor and false on ANY error —
 * failing closed is the whole point of the gate.
 */
export async function isEventMember(slug: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_event_member', { p_slug: slug });
  if (error) {
    console.error('[host] isEventMember', error);
    return false;
  }
  return Boolean(data);
}

export async function canEnterStudio(slug: string): Promise<boolean> {
  if (SHOW_DEMO_EVENT && slug === DEMO_EVENT_SLUG) {
    const orgIds = await fetchMyOrgIds();
    if (orgIds !== null && orgIds.length === 0) return true;
  }
  const { data: isMember, error } = await supabase.rpc('is_event_member', { p_slug: slug });
  if (error) {
    console.error('[host] canEnterStudio', error);
    return false;
  }
  return Boolean(isMember);
}

export interface CreateEventInput {
  orgName?: string;
  eventName: string;
  slug: string;
  eventType?: string;
  startsAt?: string;
}

export type CreateEventError =
  | 'invalid_json'
  | 'invalid_body'
  | 'invalid_slug'
  | 'reserved_slug'
  | 'unauthorized'
  | 'slug_taken'
  | 'internal'
  | 'network';

export interface CreateEventResult {
  event: HostEventRow | null;
  orgId: string | null;
  error: CreateEventError | null;
}

/**
 * Create an event via the create-event edge function.
 * `functions.invoke` attaches the user JWT automatically; on a non-2xx the
 * function's `{ error }` body is surfaced via err.context.
 */
export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  try {
    const { data, error } = await supabase.functions.invoke('create-event', { body: input });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const body = (await error.context.json()) as { error?: string };
          return { event: null, orgId: null, error: (body.error as CreateEventError) ?? 'internal' };
        } catch {
          return { event: null, orgId: null, error: 'internal' };
        }
      }
      return { event: null, orgId: null, error: 'network' };
    }
    const res = (data ?? {}) as { event?: HostEventRow; orgId?: string };
    if (!res.event) return { event: null, orgId: null, error: 'internal' };
    return { event: res.event, orgId: res.orgId ?? null, error: null };
  } catch (e) {
    console.error('[host] createEvent', e);
    return { event: null, orgId: null, error: 'network' };
  }
}

/**
 * Shallow-merge a patch into events.config (jsonb) for a DB event.
 * Fetches the current config, merges, and writes it back — member RLS allows
 * both steps. Note: read-merge-write, so concurrent editors can race; fine for
 * the low-frequency admin settings stored here (e.g. background_template).
 */
export async function updateEventConfig(
  eventUuid: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('events')
    .select('config')
    .eq('id', eventUuid)
    .maybeSingle();
  if (error || !data) {
    console.error('[host] updateEventConfig (read)', error);
    return false;
  }
  const current = (data.config ?? {}) as Record<string, unknown>;
  const merged = { ...current, ...patch };
  const { error: writeError } = await supabase
    .from('events')
    .update({ config: merged })
    .eq('id', eventUuid);
  if (writeError) {
    console.error('[host] updateEventConfig (write)', writeError);
    return false;
  }
  return true;
}

/**
 * Set an event's lifecycle status, stamping `archived_at` (migration 031)
 * alongside it. The timestamp is a pure function of the status — written on the
 * way into 'archived', cleared on every way out — so a restored event can never
 * keep a stale "Archived 3 days ago" line, and `status` stays the single
 * authority (001's CHECK) that every guard already reads.
 *
 * ZERO ROWS IS NOT SUCCESS: an UPDATE that matches nothing — filtered out by
 * tenant RLS, or aimed at an id that has since moved — returns 204 with
 * `error === null`, indistinguishable from a real write unless the rows are
 * asked for. That is how the copilot came to announce "Your event is LIVE" over
 * a write that changed nothing. `.select('id')` costs no extra round trip, and
 * `events_public_read` (003) covers a member reading back their own row,
 * drafts included.
 */
export async function updateEventStatus(eventUuid: string, status: string): Promise<boolean> {
  const archivedAt = status === 'archived' ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from('events')
    .update({ status, archived_at: archivedAt })
    .eq('id', eventUuid)
    .select('id');
  if (error) {
    console.error('[host] updateEventStatus', error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** Set an event's date (YYYY-MM-DD → start-of-day ISO, same as createEvent).
 *  An empty string clears it. Returns false on error, and on a zero-row write
 *  (see updateEventStatus — a no-match UPDATE reports no error at all). */
export async function updateEventDate(eventUuid: string, date: string): Promise<boolean> {
  const startsAt = date ? new Date(`${date}T00:00:00`).toISOString() : null;
  const { data, error } = await supabase
    .from('events')
    .update({ starts_at: startsAt })
    .eq('id', eventUuid)
    .select('id');
  if (error) {
    console.error('[host] updateEventDate', error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** Current lifecycle status of an event (draft/live/ended/archived), or null.
 *  Used to re-snapshot after an in-chat "go live" flips the status. */
export async function fetchEventStatus(eventUuid: string): Promise<string | null> {
  const { data, error } = await supabase.from('events').select('status').eq('id', eventUuid).maybeSingle();
  if (error || !data) {
    if (error) console.error('[host] fetchEventStatus', error);
    return null;
  }
  return (data.status as string) ?? null;
}

/** Rename an event. False on an empty name, on error, and on a zero-row write
 *  (see updateEventStatus — a no-match UPDATE reports no error at all). */
export async function updateEventName(eventUuid: string, name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const { data, error } = await supabase
    .from('events')
    .update({ name: trimmed })
    .eq('id', eventUuid)
    .select('id');
  if (error) {
    console.error('[host] updateEventName', error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export type DeleteEventError =
  | 'invalid_json'
  | 'invalid_body'
  /** The typed confirmation did not match the row's own name. */
  | 'name_mismatch'
  | 'unauthorized'
  /** Not a member of the event's org. */
  | 'forbidden'
  /** Delete is offered on archived events only — archive it first. */
  | 'must_archive_first'
  | 'not_found'
  | 'internal'
  | 'network';

export interface DeleteEventResult {
  /** True only when the storage sweep AND the row delete both completed. */
  deleted: boolean;
  /** Storage objects actually removed — reported even on a partial sweep. */
  objectsRemoved: number;
  /** Bucket prefixes the sweep could not clear. Non-empty means the event row
   *  is still THERE, on purpose: see below. */
  remaining: string[];
  error: DeleteEventError | null;
}

/**
 * Permanently delete an ARCHIVED event through the `delete-event` edge function.
 *
 * Not a client DELETE, even though `events_member_delete` (migration 003) would
 * allow one: the dependent ROWS cascade (all 13 FKs to public.events are
 * declared), but a Postgres cascade cannot reach Storage, so a client-side
 * delete would leave every capture, asset, card file and rendered film orphaned
 * in the buckets — two of which are PUBLIC. The function sweeps those buckets
 * first and deletes the row last.
 *
 * PARTIAL IS NOT SUCCESS AND NOT AN ERROR. If the sweep cannot finish, the
 * function deletes nothing and returns `deleted:false` with the prefixes it
 * could not clear; the host still has an intact archived event and retrying is
 * safe (the sweep is idempotent). Callers must branch on `deleted`, never on
 * `error === null`.
 */
export async function deleteEvent(eventUuid: string, confirmName: string): Promise<DeleteEventResult> {
  const fail = (error: DeleteEventError): DeleteEventResult =>
    ({ deleted: false, objectsRemoved: 0, remaining: [], error });
  try {
    const { data, error } = await supabase.functions.invoke('delete-event', {
      body: { eventUuid, confirmName },
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const body = (await error.context.json()) as { error?: string };
          return fail((body.error as DeleteEventError) ?? 'internal');
        } catch {
          return fail('internal');
        }
      }
      return fail('network');
    }
    const res = (data ?? {}) as { deleted?: boolean; objectsRemoved?: number; remaining?: string[] };
    return {
      deleted: res.deleted === true,
      objectsRemoved: typeof res.objectsRemoved === 'number' ? res.objectsRemoved : 0,
      remaining: Array.isArray(res.remaining) ? res.remaining : [],
      error: null,
    };
  } catch (e) {
    console.error('[host] deleteEvent', e);
    return fail('network');
  }
}

/** Client-side availability hint for the wizard. RLS hides other orgs' drafts,
 *  so a "free" answer here isn't final — the server has the last word. */
export async function isSlugVisiblyTaken(slug: string): Promise<boolean> {
  const { data, error } = await supabase.from('events').select('id').eq('slug', slug).maybeSingle();
  if (error) return false;
  return Boolean(data);
}

/* ------------------------------------------------------------------ */
/* Manager access tokens (day-of staff)                                */
/* ------------------------------------------------------------------ */

export interface ManagerTokenRow {
  id: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
}

/** TOKEN_LENGTH characters drawn UNIFORMLY from TOKEN_ALPHABET.
 *  `mapBytesToChars` (src/lib/token.ts) discards the byte values that cannot be
 *  mapped without bias — 8 of every 256 — so one draw yields ~97% of the
 *  characters it asks for and the loop tops up whatever fell short. */
function randomToken(): string {
  let out = '';
  while (out.length < TOKEN_LENGTH) {
    const bytes = new Uint8Array(TOKEN_LENGTH);
    crypto.getRandomValues(bytes);
    out += mapBytesToChars(bytes, TOKEN_ALPHABET);
  }
  return out.slice(0, TOKEN_LENGTH);
}

/**
 * Mint a manager token for an event. The RAW token is returned exactly once
 * and never stored — only its sha256 hash lands in event_access_tokens.
 */
export async function createManagerToken(
  eventUuid: string,
  label: string,
  expiresAt?: string,
): Promise<{ raw: string; row: ManagerTokenRow } | null> {
  const raw = randomToken();
  const token_hash = await sha256Hex(raw);
  const { data, error } = await supabase
    .from('event_access_tokens')
    .insert({
      event_id: eventUuid,
      token_hash,
      role: 'manager',
      label: label.trim() || null,
      expires_at: expiresAt ?? null,
    })
    .select('id, label, created_at, expires_at')
    .single();
  if (error || !data) {
    console.error('[host] createManagerToken', error);
    return null;
  }
  return { raw, row: data as ManagerTokenRow };
}

export async function listManagerTokensResult(eventUuid: string): Promise<ListResult<ManagerTokenRow>> {
  const { data, error } = await supabase
    .from('event_access_tokens')
    .select('id, label, created_at, expires_at')
    .eq('event_id', eventUuid)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[host] listManagerTokens', error);
    return { rows: [], failed: true };
  }
  return { rows: (data as ManagerTokenRow[]) ?? [], failed: false };
}

export async function listManagerTokens(eventUuid: string): Promise<ManagerTokenRow[]> {
  return (await listManagerTokensResult(eventUuid)).rows;
}

export async function revokeManagerToken(id: string): Promise<boolean> {
  const { error } = await supabase.from('event_access_tokens').delete().eq('id', id);
  if (error) {
    console.error('[host] revokeManagerToken', error);
    return false;
  }
  return true;
}
