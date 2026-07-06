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
  /** Populated in Phase 3 (orders table); null until then. */
  revenueCents: number | null;
}

export function fetchOverviewMetrics(): Promise<AdminResult<OverviewMetrics>> {
  return adminApi<OverviewMetrics>('overview_metrics');
}
