/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client for the platform super-admin suite. Unlike host.ts (which reads
 * PostgREST directly, RLS-scoped to the caller's org), every cross-tenant call
 * here goes through the `admin-api` edge function — the anon/member client is
 * RLS-blocked from other orgs, so a direct `supabase.from('orgs')` would return
 * only your own row. The one exception is checkIsPlatformAdmin(), a self-scoped
 * read used purely to show/hide the UI; the real authorization is server-side.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { RevenueSummary } from './revenue';

/** Is the current session a platform admin? UX gate only. */
export async function checkIsPlatformAdmin(): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return false;
  const { data, error } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) {
    console.error('[admin] checkIsPlatformAdmin', error);
    return false;
  }
  return Boolean(data);
}

export interface AdminResult<T> {
  data: T | null;
  /** null on success, else an edge-fn error code ('forbidden'|'unauthorized'|'internal'|'network'|…). */
  error: string | null;
}

/** Invoke an admin-api action, unwrapping the `{ data }` envelope and the
 *  function's `{ error }` body on a non-2xx (mirrors host.ts invokeBillingFn). */
export async function adminApi<T = unknown>(
  action: string,
  args?: Record<string, unknown>,
): Promise<AdminResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-api', {
      body: { action, args: args ?? {} },
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          return { data: null, error: res.error ?? 'internal' };
        } catch {
          return { data: null, error: 'internal' };
        }
      }
      return { data: null, error: 'network' };
    }
    const res = (data ?? {}) as { data?: T };
    return { data: (res.data ?? null) as T | null, error: null };
  } catch (e) {
    console.error(`[admin] ${action}`, e);
    return { data: null, error: 'network' };
  }
}

export interface OverviewMetrics {
  orgs: number;
  users: number;
  events: { total: number; live: number; draft: number; ended: number };
  activeSubscriptions: number;
  outstandingCredits: number;
  engagement: { posts: number; cards: number };
  /** usd-only sum of paid orders; null only if the orders table itself errors. */
  revenueCents: number | null;
}

export function fetchOverviewMetrics(): Promise<AdminResult<OverviewMetrics>> {
  return adminApi<OverviewMetrics>('overview_metrics');
}

export interface OrgRow {
  id: string;
  name: string;
  ownerId: string | null;
  hasStripeCustomer: boolean;
  createdAt: string;
  eventCount: number;
  subscriptionStatus: string | null;
  subscriptionTier: string | null;
  creditBalance: number;
}

export function fetchOrgs(): Promise<AdminResult<{ orgs: OrgRow[] }>> {
  return adminApi('list_orgs');
}

export interface OrgMember {
  userId: string;
  role: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
}

export interface OrgEvent {
  id: string;
  slug: string;
  name: string;
  event_type: string;
  status: string;
  plan_tier: string;
  created_at: string;
}

export interface OrgEventPlan {
  id: string;
  event_id: string;
  tier: string;
  purchased_at: string;
}

export interface OrgLedgerRow {
  id: number;
  delta: number;
  reason: string;
  created_at: string;
}

export interface OrgDetail {
  org: { id: string; name: string; owner_id: string | null; stripe_customer_id: string | null; created_at: string };
  members: OrgMember[];
  events: OrgEvent[];
  eventPlans: OrgEventPlan[];
  subscription: { status: string; tier: string; current_period_end: string | null; stripe_subscription_id: string | null } | null;
  creditBalance: number;
  ledger: OrgLedgerRow[];
}

export function fetchOrg(orgId: string): Promise<AdminResult<OrgDetail>> {
  return adminApi('get_org', { orgId });
}

export interface AdminEventRow {
  id: string;
  slug: string;
  name: string;
  event_type: string;
  status: string;
  plan_tier: string;
  org_id: string;
  orgName: string;
  created_at: string;
}

export function fetchEvents(): Promise<AdminResult<{ events: AdminEventRow[] }>> {
  return adminApi('list_events');
}

export function setEventStatus(eventId: string, status: string): Promise<AdminResult<{ id: string; status: string }>> {
  return adminApi('set_event_status', { eventId, status });
}

export function setEventTier(eventId: string, tier: string): Promise<AdminResult<{ id: string; plan_tier: string }>> {
  return adminApi('set_event_tier', { eventId, tier });
}

export interface OrderRow {
  id: number;
  org_id: string;
  event_id: string | null;
  kind: 'event_package' | 'credit_pack' | 'pro_subscription';
  tier: string | null;
  amount_total: number;
  currency: string;
  status: string;
  stripe_ref: string | null;
  created_at: string;
  orgName: string;
}

export function fetchOrders(): Promise<AdminResult<{ orders: OrderRow[] }>> {
  return adminApi('list_orders');
}

export function fetchRevenueSummary(): Promise<AdminResult<RevenueSummary>> {
  return adminApi('revenue_summary');
}

export interface UserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  banned: boolean;
  orgId: string | null;
  orgName: string | null;
  role: string | null;
  isPlatformAdmin: boolean;
}

export function fetchUsers(): Promise<AdminResult<{ users: UserRow[] }>> {
  return adminApi('list_users');
}

/** Returns the recovery link once — a session-granting secret. Never log,
 *  store, or pass it anywhere except directly into the admin's clipboard/UI. */
export function resetPassword(userId: string): Promise<AdminResult<{ link: string | null }>> {
  return adminApi('reset_password', { userId });
}

export function setUserBanned(userId: string, banned: boolean): Promise<AdminResult<{ id: string; banned: boolean }>> {
  return adminApi('set_user_banned', { userId, banned });
}

export function adjustCredits(
  orgId: string,
  delta: number,
  reason: string,
): Promise<AdminResult<{ orgId: string; balance: number }>> {
  return adminApi('adjust_credits', { orgId, delta, reason });
}

/* ── Signup welcome credits (platform config) + promo codes ────────────── */

export function fetchPlatformConfig(): Promise<AdminResult<{ signupBonusCredits: number }>> {
  return adminApi('get_platform_config');
}

export function setSignupCredits(amount: number): Promise<AdminResult<{ signupBonusCredits: number }>> {
  return adminApi('set_signup_credits', { amount });
}

export interface PromoCode {
  id: string;
  code: string;
  credits: number;
  max_redemptions: number | null;
  redemptions: number;
  expires_at: string | null;
  active: boolean;
  created_at: string;
}

export function fetchPromos(): Promise<AdminResult<PromoCode[]>> {
  return adminApi('list_promos');
}

export function createPromo(args: {
  code: string;
  credits: number;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
}): Promise<AdminResult<PromoCode>> {
  return adminApi('create_promo', args);
}

export function setPromoActive(id: string, active: boolean): Promise<AdminResult<{ id: string; active: boolean }>> {
  return adminApi('set_promo_active', { id, active });
}

export interface AuditEntry {
  id: number;
  actor_user_id: string | null;
  actorEmail: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

/** Most recent 200 entries — the audit log is operational, not archival. */
export function fetchAudit(): Promise<AdminResult<{ entries: AuditEntry[] }>> {
  return adminApi('list_audit');
}

export interface AdminRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  addedBy: string | null;
  addedByEmail: string | null;
  createdAt: string;
}

export function fetchAdmins(): Promise<AdminResult<{ admins: AdminRow[] }>> {
  return adminApi('list_admins');
}

export function addAdmin(
  email: string,
): Promise<AdminResult<{ userId: string; email: string; invited: boolean }>> {
  return adminApi('add_admin', { email });
}

export function removeAdmin(userId: string): Promise<AdminResult<{ userId: string }>> {
  return adminApi('remove_admin', { userId });
}
