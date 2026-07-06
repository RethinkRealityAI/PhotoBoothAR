/**
 * admin-api — cross-tenant platform super-admin API (the ONE fortified door).
 *
 * POST { action: string, args?: object }
 *   (deploy with verify_jwt ON — requires a real user JWT in Authorization)
 *
 * Every request is gated in TWO steps, BEFORE any action runs:
 *   1. resolve the caller from their JWT (user-scoped client)  → 401
 *   2. assert that caller is in platform_admins                 → 403
 * The assert runs before the action switch, so a newly-added action cannot
 * forget its guard. All cross-tenant reads/writes then run with the service
 * role (RLS-bypassing); tenant RLS itself is never loosened. Mutations append
 * to admin_audit (added alongside the first mutating action, Phase 2).
 *
 * Actions:
 *   overview_metrics → { data: { orgs, users, events{…}, activeSubscriptions,
 *                                outstandingCredits, engagement{…}, revenueCents } }
 *   list_orgs        → { data: { orgs: [...] } }
 *   get_org          → { data: { org, members, events, eventPlans, subscription,
 *                                creditBalance, ledger } } (args: { orgId })
 *   list_events      → { data: { events: [...] } }
 *   set_event_status → { data: { id, status } } (args: { eventId, status }) — audited
 *   list_orders      → { data: { orders: [...] } }
 *   revenue_summary  → { data: { totalsByCurrency, oneTimeByCurrency,
 *                                subscriptionByCurrency, orderCount } }
 *   list_users       → { data: { users: [...] } }
 *   reset_password   → { data: { link } } (args: { userId }) — generateLink,
 *                       NEVER stored in admin_audit.meta (session-granting secret)
 *   set_user_banned  → { data: { id, banned } } (args: { userId, banned }) — audited;
 *                       ban only, never delete (delete orphans profiles/orgs)
 *   adjust_credits   → { data: { orgId, balance } } (args: { orgId, delta, reason }) — audited
 *   set_event_tier   → { data: { id, plan_tier } } (args: { eventId, tier }) — audited;
 *                       admin comp, does not insert an event_plans purchase row
 *   list_audit       → { data: { entries: [...] } } (most recent 200)
 *   list_admins      → { data: { admins: [...] } }
 *   add_admin        → { data: { userId, email, invited } } (args: { email }) — audited;
 *                       resolves an existing user by email, else invites one
 *   remove_admin     → { data: { userId } } (args: { userId }) — audited;
 *                       blocked: removing self, removing the last admin
 *
 * 400 { error:'invalid_json'|'invalid_args'|'cannot_remove_self'|'cannot_remove_last_admin'|
 *       'unknown_action' } · 401 unauthorized · 403 forbidden · 404 not_found ·
 * 409 already_admin · 500 internal
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

type Client = ReturnType<typeof serviceClient>;
// deno-lint-ignore no-explicit-any
type QueryMod = (q: any) => any;

async function countRows(sb: Client, table: string, mod?: QueryMod): Promise<number> {
  let q = sb.from(table).select('*', { count: 'exact', head: true });
  if (mod) q = mod(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function overviewMetrics(sb: Client): Promise<Response> {
  const [orgs, users, eventsTotal, eventsLive, eventsDraft, eventsEnded, activeSubscriptions, posts, cards] =
    await Promise.all([
      countRows(sb, 'orgs'),
      countRows(sb, 'profiles'),
      countRows(sb, 'events'),
      countRows(sb, 'events', (q) => q.eq('status', 'live')),
      countRows(sb, 'events', (q) => q.eq('status', 'draft')),
      countRows(sb, 'events', (q) => q.eq('status', 'ended')),
      countRows(sb, 'subscriptions', (q) => q.eq('status', 'active')),
      countRows(sb, 'posts'),
      countRows(sb, 'cards'),
    ]);

  const { data: creditRows, error: credErr } = await sb.from('credit_balances').select('balance');
  if (credErr) throw credErr;
  const outstandingCredits = (creditRows ?? []).reduce(
    (sum: number, r: { balance: number | null }) => sum + (Number(r.balance) || 0),
    0,
  );

  // usd-only sum — every checkout session today is created in usd (see
  // stripe-checkout); a true multi-currency total lives in revenue_summary.
  const { data: usdOrders, error: ordErr } = await sb
    .from('orders')
    .select('amount_total')
    .eq('status', 'paid')
    .eq('currency', 'usd');
  if (ordErr) throw ordErr;
  const revenueCents = (usdOrders ?? []).reduce((sum: number, o: { amount_total: number }) => sum + o.amount_total, 0);

  return json(200, {
    data: {
      orgs,
      users,
      events: { total: eventsTotal, live: eventsLive, draft: eventsDraft, ended: eventsEnded },
      activeSubscriptions,
      outstandingCredits,
      engagement: { posts, cards },
      revenueCents,
    },
  });
}

/** Append-only audit trail for a mutating action. Logs the error but never
 *  throws — a failed audit write must not roll back an already-applied change. */
async function auditLog(
  sb: Client,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb
    .from('admin_audit')
    .insert({ actor_user_id: actorUserId, action, target_type: targetType, target_id: targetId, meta: meta ?? null });
  if (error) console.error('[admin-api] audit insert failed', error);
}

async function listOrgs(sb: Client): Promise<Response> {
  const { data: orgs, error } = await sb
    .from('orgs')
    .select('id, name, owner_id, stripe_customer_id, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const orgIds = (orgs ?? []).map((o) => o.id as string);
  if (orgIds.length === 0) return json(200, { data: { orgs: [] } });

  const [{ data: events, error: evErr }, { data: subs, error: subErr }, { data: credits, error: credErr }] =
    await Promise.all([
      sb.from('events').select('org_id').in('org_id', orgIds),
      sb.from('subscriptions').select('org_id, status, tier').in('org_id', orgIds),
      sb.from('credit_balances').select('org_id, balance').in('org_id', orgIds),
    ]);
  if (evErr) throw evErr;
  if (subErr) throw subErr;
  if (credErr) throw credErr;

  const eventCounts = new Map<string, number>();
  for (const e of events ?? []) {
    const orgId = e.org_id as string;
    eventCounts.set(orgId, (eventCounts.get(orgId) ?? 0) + 1);
  }
  const subByOrg = new Map((subs ?? []).map((s) => [s.org_id as string, s as { status: string; tier: string }]));
  const creditByOrg = new Map((credits ?? []).map((c) => [c.org_id as string, c.balance as number]));

  const rows = (orgs ?? []).map((o) => {
    const orgId = o.id as string;
    const sub = subByOrg.get(orgId);
    return {
      id: orgId,
      name: o.name,
      ownerId: o.owner_id,
      hasStripeCustomer: Boolean(o.stripe_customer_id),
      createdAt: o.created_at,
      eventCount: eventCounts.get(orgId) ?? 0,
      subscriptionStatus: sub?.status ?? null,
      subscriptionTier: sub?.tier ?? null,
      creditBalance: creditByOrg.get(orgId) ?? 0,
    };
  });
  return json(200, { data: { orgs: rows } });
}

async function getOrg(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const orgId = typeof args.orgId === 'string' ? args.orgId : '';
  if (!orgId) return json(400, { error: 'invalid_args' });

  const { data: org, error: orgErr } = await sb
    .from('orgs')
    .select('id, name, owner_id, stripe_customer_id, created_at')
    .eq('id', orgId)
    .maybeSingle();
  if (orgErr) throw orgErr;
  if (!org) return json(404, { error: 'not_found' });

  const [
    { data: members, error: memErr },
    { data: events, error: evErr },
    { data: sub, error: subErr },
    { data: creditRow, error: credErr },
    { data: ledger, error: ledErr },
  ] = await Promise.all([
    sb.from('org_members').select('user_id, role, created_at').eq('org_id', orgId),
    sb
      .from('events')
      .select('id, slug, name, event_type, status, plan_tier, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    sb.from('subscriptions').select('status, tier, current_period_end, stripe_subscription_id').eq('org_id', orgId)
      .maybeSingle(),
    sb.from('credit_balances').select('balance').eq('org_id', orgId).maybeSingle(),
    sb.from('credit_ledger').select('id, delta, reason, created_at').eq('org_id', orgId).order('created_at', {
      ascending: false,
    }).limit(20),
  ]);
  if (memErr) throw memErr;
  if (evErr) throw evErr;
  if (subErr) throw subErr;
  if (credErr) throw credErr;
  if (ledErr) throw ledErr;

  const memberIds = (members ?? []).map((m) => m.user_id as string);
  const [{ data: profiles, error: profErr }, { data: emails, error: emailErr }] = memberIds.length
    ? await Promise.all([
      sb.from('profiles').select('id, display_name').in('id', memberIds),
      sb.rpc('admin_user_emails', { p_ids: memberIds }),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (profErr) throw profErr;
  if (emailErr) throw emailErr;
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string | null]));
  const emailById = new Map((emails ?? []).map((e) => [e.id as string, e.email as string | null]));

  const eventIds = (events ?? []).map((e) => e.id as string);
  const { data: eventPlans, error: planErr } = eventIds.length
    ? await sb.from('event_plans').select('id, event_id, tier, purchased_at').in('event_id', eventIds)
    : { data: [], error: null };
  if (planErr) throw planErr;

  return json(200, {
    data: {
      org,
      members: (members ?? []).map((m) => ({
        userId: m.user_id,
        role: m.role,
        displayName: nameById.get(m.user_id as string) ?? null,
        email: emailById.get(m.user_id as string) ?? null,
        createdAt: m.created_at,
      })),
      events: events ?? [],
      eventPlans: eventPlans ?? [],
      subscription: sub ?? null,
      creditBalance: (creditRow?.balance as number | undefined) ?? 0,
      ledger: ledger ?? [],
    },
  });
}

async function listEvents(sb: Client): Promise<Response> {
  const { data: events, error } = await sb
    .from('events')
    .select('id, slug, name, event_type, status, plan_tier, org_id, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const orgIds = [...new Set((events ?? []).map((e) => e.org_id as string))];
  const { data: orgs, error: orgErr } = orgIds.length
    ? await sb.from('orgs').select('id, name').in('id', orgIds)
    : { data: [], error: null };
  if (orgErr) throw orgErr;
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  const rows = (events ?? []).map((e) => ({ ...e, orgName: orgNameById.get(e.org_id as string) ?? '—' }));
  return json(200, { data: { events: rows } });
}

const EVENT_STATUSES = new Set(['draft', 'live', 'ended', 'archived']);

async function setEventStatus(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const eventId = typeof args.eventId === 'string' ? args.eventId : '';
  const status = typeof args.status === 'string' ? args.status : '';
  if (!eventId || !EVENT_STATUSES.has(status)) return json(400, { error: 'invalid_args' });

  const { data, error } = await sb.from('events').update({ status }).eq('id', eventId).select('id, status')
    .maybeSingle();
  if (error) throw error;
  if (!data) return json(404, { error: 'not_found' });

  await auditLog(sb, actorUserId, 'set_event_status', 'event', eventId, { status });
  return json(200, { data });
}

async function listOrders(sb: Client): Promise<Response> {
  const { data: orders, error } = await sb
    .from('orders')
    .select('id, org_id, event_id, kind, tier, amount_total, currency, status, stripe_ref, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const orgIds = [...new Set((orders ?? []).map((o) => o.org_id as string))];
  const { data: orgs, error: orgErr } = orgIds.length
    ? await sb.from('orgs').select('id, name').in('id', orgIds)
    : { data: [], error: null };
  if (orgErr) throw orgErr;
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  const rows = (orders ?? []).map((o) => ({ ...o, orgName: orgNameById.get(o.org_id as string) ?? '—' }));
  return json(200, { data: { orders: rows } });
}

/** Server-side aggregate so the client never needs a PRICES copy — amounts
 *  are already the exact cents Stripe reported (see stripe-webhook). Mirrors
 *  src/lib/revenue.ts's summarizeOrders (tested there in isolation). */
async function revenueSummary(sb: Client): Promise<Response> {
  const { data: orders, error } = await sb
    .from('orders')
    .select('kind, amount_total, currency, status')
    .neq('status', 'refunded');
  if (error) throw error;

  const totalsByCurrency: Record<string, number> = {};
  const oneTimeByCurrency: Record<string, number> = {};
  const subscriptionByCurrency: Record<string, number> = {};
  for (const o of orders ?? []) {
    const currency = ((o.currency as string) || 'usd').toLowerCase();
    const amount = o.amount_total as number;
    totalsByCurrency[currency] = (totalsByCurrency[currency] ?? 0) + amount;
    if (o.kind === 'pro_subscription') {
      subscriptionByCurrency[currency] = (subscriptionByCurrency[currency] ?? 0) + amount;
    } else {
      oneTimeByCurrency[currency] = (oneTimeByCurrency[currency] ?? 0) + amount;
    }
  }

  return json(200, {
    data: { totalsByCurrency, oneTimeByCurrency, subscriptionByCurrency, orderCount: (orders ?? []).length },
  });
}

function isBanned(user: { banned_until?: string | null }): boolean {
  if (!user.banned_until) return false;
  const t = Date.parse(user.banned_until);
  return Number.isFinite(t) && t > Date.now();
}

async function listUsers(sb: Client): Promise<Response> {
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const users = data.users;
  const userIds = users.map((u) => u.id);

  const [{ data: profiles, error: profErr }, { data: memberships, error: memErr }, { data: admins, error: admErr }] =
    userIds.length
      ? await Promise.all([
        sb.from('profiles').select('id, display_name').in('id', userIds),
        sb.from('org_members').select('user_id, org_id, role').in('user_id', userIds),
        sb.from('platform_admins').select('user_id').in('user_id', userIds),
      ])
      : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (profErr) throw profErr;
  if (memErr) throw memErr;
  if (admErr) throw admErr;

  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string | null]));
  const membershipByUser = new Map((memberships ?? []).map((m) => [m.user_id as string, m]));
  const adminSet = new Set((admins ?? []).map((a) => a.user_id as string));

  const orgIds = [...new Set((memberships ?? []).map((m) => m.org_id as string))];
  const { data: orgs, error: orgErr } = orgIds.length
    ? await sb.from('orgs').select('id, name').in('id', orgIds)
    : { data: [], error: null };
  if (orgErr) throw orgErr;
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  const rows = users.map((u) => {
    const membership = membershipByUser.get(u.id) as { org_id: string; role: string } | undefined;
    return {
      id: u.id,
      email: u.email ?? null,
      displayName: nameById.get(u.id) ?? null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      banned: isBanned(u),
      orgId: membership?.org_id ?? null,
      orgName: membership ? orgNameById.get(membership.org_id) ?? null : null,
      role: membership?.role ?? null,
      isPlatformAdmin: adminSet.has(u.id),
    };
  });
  return json(200, { data: { users: rows } });
}

/** Recovery link is a session-granting secret — returned once, NEVER logged
 *  to admin_audit.meta (only that a reset happened, and for whom). */
async function resetPassword(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const userId = typeof args.userId === 'string' ? args.userId : '';
  if (!userId) return json(400, { error: 'invalid_args' });

  const { data: userRes, error: userErr } = await sb.auth.admin.getUserById(userId);
  if (userErr) throw userErr;
  const email = userRes?.user?.email;
  if (!email) return json(404, { error: 'not_found' });

  const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email });
  if (error) throw error;

  await auditLog(sb, actorUserId, 'reset_password', 'user', userId);
  return json(200, { data: { link: data.properties?.action_link ?? null } });
}

/** Ban only — never delete (delete cascades profiles/org_members and orphans
 *  the org via orgs.owner_id). '876000h' (100y) approximates "indefinite". */
async function setUserBanned(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const userId = typeof args.userId === 'string' ? args.userId : '';
  const banned = typeof args.banned === 'boolean' ? args.banned : null;
  if (!userId || banned === null) return json(400, { error: 'invalid_args' });

  const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: banned ? '876000h' : 'none' });
  if (error) throw error;

  await auditLog(sb, actorUserId, banned ? 'ban_user' : 'unban_user', 'user', userId, { banned });
  return json(200, { data: { id: userId, banned } });
}

async function adjustCredits(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const orgId = typeof args.orgId === 'string' ? args.orgId : '';
  const delta = typeof args.delta === 'number' && Number.isFinite(args.delta) ? Math.trunc(args.delta) : null;
  const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
  if (!orgId || !delta || !reason) return json(400, { error: 'invalid_args' });

  const { data, error } = await sb.rpc('admin_adjust_credits', {
    p_org: orgId,
    p_delta: delta,
    p_reason: reason,
    p_ref: null,
  });
  if (error) throw error;

  await auditLog(sb, actorUserId, 'adjust_credits', 'org', orgId, { delta, reason, newBalance: data });
  return json(200, { data: { orgId, balance: data } });
}

const EVENT_TIERS = new Set(['free', 'essentials', 'premium', 'deluxe']);

async function setEventTier(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const eventId = typeof args.eventId === 'string' ? args.eventId : '';
  const tier = typeof args.tier === 'string' ? args.tier : '';
  if (!eventId || !EVENT_TIERS.has(tier)) return json(400, { error: 'invalid_args' });

  const { data, error } = await sb.from('events').update({ plan_tier: tier }).eq('id', eventId)
    .select('id, plan_tier').maybeSingle();
  if (error) throw error;
  if (!data) return json(404, { error: 'not_found' });

  await auditLog(sb, actorUserId, 'set_event_tier', 'event', eventId, { tier, comped: true });
  return json(200, { data });
}

async function listAudit(sb: Client): Promise<Response> {
  const { data: entries, error } = await sb
    .from('admin_audit')
    .select('id, actor_user_id, action, target_type, target_id, meta, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const actorIds = [...new Set((entries ?? []).map((e) => e.actor_user_id as string).filter(Boolean))];
  const { data: emails, error: emailErr } = actorIds.length
    ? await sb.rpc('admin_user_emails', { p_ids: actorIds })
    : { data: [], error: null };
  if (emailErr) throw emailErr;
  const emailById = new Map((emails ?? []).map((e) => [e.id as string, e.email as string | null]));

  const rows = (entries ?? []).map((e) => ({ ...e, actorEmail: emailById.get(e.actor_user_id as string) ?? null }));
  return json(200, { data: { entries: rows } });
}

async function listAdmins(sb: Client): Promise<Response> {
  const { data: admins, error } = await sb
    .from('platform_admins')
    .select('user_id, email, added_by, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const ids = [...new Set([
    ...(admins ?? []).map((a) => a.user_id as string),
    ...(admins ?? []).map((a) => a.added_by as string).filter(Boolean),
  ])];
  const [{ data: emails, error: emailErr }, { data: profiles, error: profErr }] = ids.length
    ? await Promise.all([
      sb.rpc('admin_user_emails', { p_ids: ids }),
      sb.from('profiles').select('id, display_name').in('id', ids),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (emailErr) throw emailErr;
  if (profErr) throw profErr;
  const emailById = new Map((emails ?? []).map((e) => [e.id as string, e.email as string | null]));
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string | null]));

  const rows = (admins ?? []).map((a) => ({
    userId: a.user_id,
    email: emailById.get(a.user_id as string) ?? a.email ?? null,
    displayName: nameById.get(a.user_id as string) ?? null,
    addedBy: a.added_by,
    addedByEmail: a.added_by ? emailById.get(a.added_by as string) ?? null : null,
    createdAt: a.created_at,
  }));
  return json(200, { data: { admins: rows } });
}

async function findUserIdByEmail(sb: Client, email: string): Promise<string | null> {
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const match = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
  return match?.id ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function addAdmin(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_RE.test(email)) return json(400, { error: 'invalid_args' });

  let userId = await findUserIdByEmail(sb, email);
  let invited = false;
  if (!userId) {
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email);
    if (error) throw error;
    userId = data.user?.id ?? null;
    invited = true;
  }
  if (!userId) return json(500, { error: 'internal' });

  const { error: insErr } = await sb
    .from('platform_admins')
    .insert({ user_id: userId, email, added_by: actorUserId });
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') return json(409, { error: 'already_admin' });
    throw insErr;
  }

  await auditLog(sb, actorUserId, 'add_admin', 'user', userId, { email, invited });
  return json(200, { data: { userId, email, invited } });
}

async function removeAdmin(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const userId = typeof args.userId === 'string' ? args.userId : '';
  if (!userId) return json(400, { error: 'invalid_args' });
  if (userId === actorUserId) return json(400, { error: 'cannot_remove_self' });

  const { count, error: countErr } = await sb
    .from('platform_admins')
    .select('*', { count: 'exact', head: true });
  if (countErr) throw countErr;
  if ((count ?? 0) <= 1) return json(400, { error: 'cannot_remove_last_admin' });

  const { data, error } = await sb
    .from('platform_admins')
    .delete()
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return json(404, { error: 'not_found' });

  await auditLog(sb, actorUserId, 'remove_admin', 'user', userId);
  return json(200, { data: { userId } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  try {
    // 1. Auth — resolve the caller from their verified JWT (never a body field).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'unauthorized' });
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json(401, { error: 'unauthorized' });

    const sb = serviceClient();

    // 2. Platform-admin assert — BEFORE the action switch (structural guard).
    const { data: adm, error: admErr } = await sb
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (admErr) throw admErr;
    if (!adm) return json(403, { error: 'forbidden' });

    // 3. Dispatch.
    const action = typeof body.action === 'string' ? body.action : '';
    const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args))
      ? body.args as Record<string, unknown>
      : {};

    switch (action) {
      case 'overview_metrics':
        return await overviewMetrics(sb);
      case 'list_orgs':
        return await listOrgs(sb);
      case 'get_org':
        return await getOrg(sb, args);
      case 'list_events':
        return await listEvents(sb);
      case 'set_event_status':
        return await setEventStatus(sb, user.id, args);
      case 'list_orders':
        return await listOrders(sb);
      case 'revenue_summary':
        return await revenueSummary(sb);
      case 'list_users':
        return await listUsers(sb);
      case 'reset_password':
        return await resetPassword(sb, user.id, args);
      case 'set_user_banned':
        return await setUserBanned(sb, user.id, args);
      case 'adjust_credits':
        return await adjustCredits(sb, user.id, args);
      case 'set_event_tier':
        return await setEventTier(sb, user.id, args);
      case 'list_audit':
        return await listAudit(sb);
      case 'list_admins':
        return await listAdmins(sb);
      case 'add_admin':
        return await addAdmin(sb, user.id, args);
      case 'remove_admin':
        return await removeAdmin(sb, user.id, args);
      default:
        return json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('[admin-api] internal error', err);
    return json(500, { error: 'internal' });
  }
});
