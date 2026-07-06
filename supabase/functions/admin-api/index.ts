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
 *
 * 400 { error:'invalid_json'|'invalid_args'|'unknown_action' } · 401 unauthorized ·
 * 403 forbidden · 404 not_found · 500 internal
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

  return json(200, {
    data: {
      orgs,
      users,
      events: { total: eventsTotal, live: eventsLive, draft: eventsDraft, ended: eventsEnded },
      activeSubscriptions,
      outstandingCredits,
      engagement: { posts, cards },
      revenueCents: null, // populated in Phase 3 (orders table)
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
      default:
        return json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('[admin-api] internal error', err);
    return json(500, { error: 'internal' });
  }
});
