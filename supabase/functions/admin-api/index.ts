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
 *
 * 400 { error:'invalid_json'|'unknown_action' } · 401 unauthorized · 403 forbidden · 500 internal
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
    // args reserved for later actions:
    // const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args))
    //   ? body.args as Record<string, unknown> : {};

    switch (action) {
      case 'overview_metrics':
        return await overviewMetrics(sb);
      default:
        return json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('[admin-api] internal error', err);
    return json(500, { error: 'internal' });
  }
});
