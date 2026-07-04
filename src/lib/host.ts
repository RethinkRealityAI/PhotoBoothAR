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

/** The caller's org membership (first one; Phase 2a assumes a single org). */
export async function fetchMyOrg(): Promise<HostOrg | null> {
  const { data, error } = await supabase
    .from('org_members')
    .select('role, orgs(id, name)')
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[host] fetchMyOrg', error);
    return null;
  }
  const org = (Array.isArray(data.orgs) ? data.orgs[0] : data.orgs) as { id: string; name: string } | null;
  if (!org) return null;
  return { orgId: org.id, name: org.name, role: data.role as 'owner' | 'editor' };
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

/** Every event the member can see (RLS: their org's, incl. drafts). */
export async function fetchMyEvents(): Promise<HostEventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id, slug, name, event_type, status, plan_tier, created_at, config')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[host] fetchMyEvents', error);
    return [];
  }
  return (data as HostEventRow[]) ?? [];
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

export async function updateEventStatus(eventUuid: string, status: string): Promise<boolean> {
  const { error } = await supabase.from('events').update({ status }).eq('id', eventUuid);
  if (error) {
    console.error('[host] updateEventStatus', error);
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
