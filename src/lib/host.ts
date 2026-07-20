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
import { sha256Hex } from './hash';

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

/** Like {@link fetchMyOrg} but distinguishes a query failure from a genuine
 *  no-org result. Mirrors fetchMyEvents' null-vs-[] contract. */
export async function fetchMyOrgResult(): Promise<MyOrgResult> {
  const { data, error } = await supabase
    .from('org_members')
    .select('role, orgs(id, name)')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[host] fetchMyOrg', error);
    return { org: null, failed: true };
  }
  if (!data) return { org: null, failed: false };
  const org = (Array.isArray(data.orgs) ? data.orgs[0] : data.orgs) as { id: string; name: string } | null;
  if (!org) return { org: null, failed: false };
  return { org: { orgId: org.id, name: org.name, role: data.role as 'owner' | 'editor' }, failed: false };
}

/** The caller's org membership (first one; Phase 2a assumes a single org).
 *  Returns null on BOTH failure and no-org — use fetchMyOrgResult when the
 *  distinction matters. */
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

export async function fetchLedger(orgId: string, limit = 20): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from('credit_ledger')
    .select('id, delta, reason, ref, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[host] fetchLedger', error);
    return [];
  }
  return (data as LedgerRow[]) ?? [];
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
  /** 'billing_not_configured' while Stripe keys are pending, else edge-fn error code. */
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

const EVENT_COLUMNS = 'id, slug, name, event_type, status, plan_tier, created_at, config';

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

export async function updateEventStatus(eventUuid: string, status: string): Promise<boolean> {
  const { error } = await supabase.from('events').update({ status }).eq('id', eventUuid);
  if (error) {
    console.error('[host] updateEventStatus', error);
    return false;
  }
  return true;
}

/** Set an event's date (YYYY-MM-DD → start-of-day ISO, same as createEvent).
 *  An empty string clears it. Returns false on error. */
export async function updateEventDate(eventUuid: string, date: string): Promise<boolean> {
  const startsAt = date ? new Date(`${date}T00:00:00`).toISOString() : null;
  const { error } = await supabase.from('events').update({ starts_at: startsAt }).eq('id', eventUuid);
  if (error) {
    console.error('[host] updateEventDate', error);
    return false;
  }
  return true;
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

export async function updateEventName(eventUuid: string, name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const { error } = await supabase.from('events').update({ name: trimmed }).eq('id', eventUuid);
  if (error) {
    console.error('[host] updateEventName', error);
    return false;
  }
  return true;
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

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 24;

function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return out;
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

export async function listManagerTokens(eventUuid: string): Promise<ManagerTokenRow[]> {
  const { data, error } = await supabase
    .from('event_access_tokens')
    .select('id, label, created_at, expires_at')
    .eq('event_id', eventUuid)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[host] listManagerTokens', error);
    return [];
  }
  return (data as ManagerTokenRow[]) ?? [];
}

export async function revokeManagerToken(id: string): Promise<boolean> {
  const { error } = await supabase.from('event_access_tokens').delete().eq('id', id);
  if (error) {
    console.error('[host] revokeManagerToken', error);
    return false;
  }
  return true;
}
