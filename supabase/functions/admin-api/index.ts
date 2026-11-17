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
 * Every list_* action below takes the same optional paging args —
 * { search?, limit?, offset? } — and answers with `hasMore` beside its rows.
 * See the `paging` block for why, and ListMore.tsx for how it is surfaced.
 *
 *   list_orgs        → { data: { orgs: [...], hasMore } }
 *   get_org          → { data: { org, members, events, eventPlans, subscription,
 *                                creditBalance, ledger } } (args: { orgId })
 *   list_events      → { data: { events: [...], hasMore } }
 *   set_event_status → { data: { id, status } } (args: { eventId, status }) — audited
 *   list_orders      → { data: { orders: [...], hasMore } }
 *   revenue_summary  → { data: { totalsByCurrency, oneTimeByCurrency,
 *                                subscriptionByCurrency, orderCount } }
 *   list_users       → { data: { users: [...], hasMore } } — via admin_list_users (020),
 *                       NOT auth.admin.listUsers, which cannot search
 *   reset_password   → { data: { link } } (args: { userId }) — generateLink,
 *                       NEVER stored in admin_audit.meta (session-granting secret)
 *   set_user_banned  → { data: { id, banned } } (args: { userId, banned }) — audited;
 *                       ban only, never delete (delete orphans profiles/orgs)
 *   adjust_credits   → { data: { orgId, balance } } (args: { orgId, delta, reason }) — audited
 *   set_event_tier   → { data: { id, plan_tier } } (args: { eventId, tier }) — audited;
 *                       admin comp, does not insert an event_plans purchase row
 *   list_audit       → { data: { entries: [...], hasMore } }
 * The four registry lists are not paged — they are capped instead, at
 * REGISTRY_CAP, and report how many rows exist. See that constant for why:
 *   list_admins        → { data: { admins: [...], total } }
 *   list_promos        → { data: [...] }  (bare array — no room for a total)
 *   list_feature_flags → { data: { flags, planDefaults, totals: {…} } }
 *   list_catalog       → { data: { items: [...], total } }
 *   add_admin        → { data: { userId, email, invited } } (args: { email }) — audited;
 *                       resolves an existing user by email, else invites one
 *   remove_admin     → { data: { userId } } (args: { userId }) — audited;
 *                       blocked: removing self, removing the last admin
 *   get_landing_content_admin → { data: { draft, published, version, updatedAt } }
 *   save_landing_draft        → { data: { ok } } (args: { draft: object ≤200KB }) — audited
 *   publish_landing_content   → { data: { version } } — copies draft → published — audited
 *   revert_landing_draft      → { data: { ok } } — copies published → draft — audited
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

// Same shape every sibling function uses (card-contribute, ai-event-designer,
// validate-challenge-photo, …). The flag/plan actions below referenced this
// without declaring it — a ReferenceError, i.e. a guaranteed 500, on
// set_feature_override / clear_feature_override / resolve_features /
// set_org_plan. tsc never sees supabase/ and esbuild only parses, so only a
// runtime read caught it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/* ── Paging for the list screens ──────────────────────────────────────────
 * list_orgs, list_events and list_orders had NO limit at all: each one selected
 * every row in its table and shipped the lot to the browser, which then filtered
 * and paginated in JavaScript. That is fine at fifty customers and a cliff at
 * fifty thousand — the operator's first search would hang on a payload nobody
 * budgeted for, and every one of these screens also runs follow-up `.in()`
 * lookups whose URL length grows with the row count.
 *
 * So the server pages and searches now. `hasMore` is derived by asking for ONE
 * row more than requested, which is cheaper and more honest than a second
 * count(*) that can disagree with the page under concurrent writes. */

const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

/**
 * Ceiling for the lists that are NOT paged: the promo codes, the admin roster,
 * the feature-flag registry and the billing catalogue.
 *
 * Those four are small by construction — flags and catalogue rows are seeded by
 * migration and only an operator ever adds one — so a Load-more pager on them
 * would be furniture. What they were missing is a ceiling: each one selected
 * its whole table with no `limit` at all, so the size of the response was
 * whatever the table happened to hold. This is the same backstop reasoning as
 * `admin_list_users`'s own 1000-row cap (migration 020): not a page size, a
 * refusal to ship an unbounded payload.
 *
 * Each of these also reports a `total`, so the response says how many rows
 * exist even when the cap trimmed them. `list_promos` is the one exception —
 * its response body is a bare ARRAY that src/lib/admin.ts's `fetchPromos` is
 * typed against, and an array cannot carry a sibling field.
 */
const REGISTRY_CAP = 500;

interface Paging {
  limit: number;
  offset: number;
  /** Trimmed search term, or '' for none. */
  search: string;
}

function paging(args: Record<string, unknown>): Paging {
  const rawLimit = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.round(args.limit)
    : DEFAULT_PAGE;
  const rawOffset = typeof args.offset === 'number' && Number.isFinite(args.offset)
    ? Math.round(args.offset)
    : 0;
  const search = typeof args.search === 'string' ? args.search.trim().slice(0, 100) : '';
  return {
    limit: Math.max(1, Math.min(rawLimit, MAX_PAGE)),
    offset: Math.max(0, rawOffset),
    search,
  };
}

/**
 * Escape a user-typed search term for a PostgREST `ilike` pattern.
 *
 * `%` and `_` are wildcards, and a `,` or `)` would break out of the filter's
 * own syntax — an operator searching for "50% off" must not accidentally match
 * everything, and must not be able to inject a filter clause.
 */
function likeTerm(search: string): string {
  return `%${search.replace(/[\\%_,()]/g, (c) => `\\${c}`)}%`;
}

/** Trim the sentinel extra row and report whether it was there. */
function page<T>(rows: T[], limit: number): { rows: T[]; hasMore: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), hasMore: true } : { rows, hasMore: false };
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

async function listOrgs(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const { limit, offset, search } = paging(args);
  let q = sb
    .from('orgs')
    .select('id, name, owner_id, stripe_customer_id, created_at')
    .order('created_at', { ascending: false });
  if (search) q = q.ilike('name', likeTerm(search));
  const { data: raw, error } = await q.range(offset, offset + limit); // +1 sentinel
  if (error) throw error;
  const { rows: orgs, hasMore } = page(raw ?? [], limit);

  const orgIds = orgs.map((o) => o.id as string);
  if (orgIds.length === 0) return json(200, { data: { orgs: [], hasMore } });

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

  const rows = orgs.map((o) => {
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
  return json(200, { data: { orgs: rows, hasMore } });
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

async function listEvents(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const { limit, offset, search } = paging(args);
  let q = sb
    .from('events')
    .select('id, slug, name, event_type, status, plan_tier, org_id, created_at')
    .order('created_at', { ascending: false });
  // An operator looking up an event has either its name or the slug from a QR
  // code, so both are searched. `or` takes the already-escaped pattern.
  if (search) q = q.or(`name.ilike.${likeTerm(search)},slug.ilike.${likeTerm(search)}`);
  const { data: raw, error } = await q.range(offset, offset + limit); // +1 sentinel
  if (error) throw error;
  const { rows: events, hasMore } = page(raw ?? [], limit);

  const orgIds = [...new Set(events.map((e) => e.org_id as string))];
  const { data: orgs, error: orgErr } = orgIds.length
    ? await sb.from('orgs').select('id, name').in('id', orgIds)
    : { data: [], error: null };
  if (orgErr) throw orgErr;
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  const rows = events.map((e) => ({ ...e, orgName: orgNameById.get(e.org_id as string) ?? '—' }));
  return json(200, { data: { events: rows, hasMore } });
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

async function listOrders(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const { limit, offset, search } = paging(args);
  let q = sb
    .from('orders')
    .select('id, org_id, event_id, kind, tier, amount_total, currency, status, stripe_ref, created_at')
    .order('created_at', { ascending: false });
  // Orders are looked up by the Stripe reference from a receipt or a dispute —
  // org name lives on another table and is not filterable here.
  if (search) q = q.ilike('stripe_ref', likeTerm(search));
  const { data: raw, error } = await q.range(offset, offset + limit); // +1 sentinel
  if (error) throw error;
  const { rows: orders, hasMore } = page(raw ?? [], limit);

  const orgIds = [...new Set(orders.map((o) => o.org_id as string))];
  const { data: orgs, error: orgErr } = orgIds.length
    ? await sb.from('orgs').select('id, name').in('id', orgIds)
    : { data: [], error: null };
  if (orgErr) throw orgErr;
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  const rows = orders.map((o) => ({ ...o, orgName: orgNameById.get(o.org_id as string) ?? '—' }));
  return json(200, { data: { orders: rows, hasMore } });
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

interface AuthUserRow {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
}

/**
 * The Users screen, searched and paged on the server.
 *
 * This does NOT use `auth.admin.listUsers`, and that is the point: GoTrue's
 * admin list API takes only `page`/`perPage` — there is no search parameter to
 * pass — so the old call fetched a flat 1000 accounts and let the browser filter
 * them. Past 1000 users the 1001st was simply absent, with nothing on screen
 * saying so. `admin_list_users` (migration 020) reads the same five fields
 * straight out of `auth.users`, searchable across email, display name and org
 * name, and honest about there being more.
 */
async function listUsers(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const { limit, offset, search } = paging(args);
  const { data: raw, error } = await sb.rpc('admin_list_users', {
    p_search: search,
    p_limit: limit + 1, // +1 sentinel, same as the other lists
    p_offset: offset,
  });
  if (error) throw error;
  const { rows: users, hasMore } = page((raw ?? []) as AuthUserRow[], limit);
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
  return json(200, { data: { users: rows, hasMore } });
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

/* ── Platform config: the admin-editable welcome-credit amount ─────────── */
async function getPlatformConfig(sb: Client): Promise<Response> {
  const { data, error } = await sb.from('platform_config').select('key, int_value');
  if (error) throw error;
  const cfg: Record<string, number | null> = {};
  for (const row of (data ?? []) as { key: string; int_value: number | null }[]) cfg[row.key] = row.int_value;
  return json(200, { data: { signupBonusCredits: cfg['signup_bonus_credits'] ?? 25 } });
}

async function setSignupCredits(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const amount = typeof args.amount === 'number' && Number.isFinite(args.amount) ? Math.trunc(args.amount) : null;
  if (amount === null || amount < 0 || amount > 100000) return json(400, { error: 'invalid_args' });
  const { error } = await sb.from('platform_config').upsert({
    key: 'signup_bonus_credits', int_value: amount, updated_at: new Date().toISOString(), updated_by: actorUserId,
  });
  if (error) throw error;
  await auditLog(sb, actorUserId, 'set_signup_credits', 'config', 'signup_bonus_credits', { amount });
  return json(200, { data: { signupBonusCredits: amount } });
}

/* ── Landing-page CMS: the marketing "/" singleton (migration 030) ─────── */
/* The table has NO client policies (draft must never be publicly readable);
 * this service-role path is the only writer. Anonymous visitors read the
 * published half through the get_landing_content() SQL function. The blobs
 * are opaque jsonb here — the browser normalizes on every read, so a bad
 * draft can degrade only to bundled defaults, never to a broken page. */

async function getLandingContentAdmin(sb: Client): Promise<Response> {
  const { data, error } = await sb
    .from('landing_content')
    .select('draft, published, version, updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  // Migration 030 seeds row 1; a missing row means the migration never ran.
  if (!data) return json(404, { error: 'not_found' });
  return json(200, {
    data: { draft: data.draft, published: data.published, version: data.version, updatedAt: data.updated_at },
  });
}

async function saveLandingDraft(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const draft = args.draft;
  if (typeof draft !== 'object' || draft === null || Array.isArray(draft)) {
    return json(400, { error: 'invalid_args' });
  }
  // Size ceiling: the row is read on every admin-editor load; 200KB of copy is
  // already ~40× the shipped page's text. Audit meta records the size, never
  // the blob (audit rows are forever; drafts are not).
  const bytes = JSON.stringify(draft).length;
  if (bytes > 200_000) return json(400, { error: 'invalid_args' });
  const { error } = await sb
    .from('landing_content')
    .update({ draft, updated_at: new Date().toISOString(), updated_by: actorUserId })
    .eq('id', 1);
  if (error) throw error;
  await auditLog(sb, actorUserId, 'save_landing_draft', 'landing_content', '1', { bytes });
  return json(200, { data: { ok: true } });
}

async function publishLandingContent(sb: Client, actorUserId: string): Promise<Response> {
  // Read-then-write (supabase-js cannot express `version = version + 1`);
  // two admins publishing in the same instant is a lost version bump, not a
  // corruption — the copy itself is atomic within the single UPDATE.
  const { data: row, error: readErr } = await sb
    .from('landing_content')
    .select('draft, version')
    .eq('id', 1)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) return json(404, { error: 'not_found' });
  const version = (typeof row.version === 'number' && Number.isFinite(row.version) ? row.version : 0) + 1;
  const { error } = await sb
    .from('landing_content')
    .update({ published: row.draft, version, updated_at: new Date().toISOString(), updated_by: actorUserId })
    .eq('id', 1);
  if (error) throw error;
  await auditLog(sb, actorUserId, 'publish_landing_content', 'landing_content', '1', { version });
  return json(200, { data: { version } });
}

async function revertLandingDraft(sb: Client, actorUserId: string): Promise<Response> {
  const { data: row, error: readErr } = await sb
    .from('landing_content')
    .select('published')
    .eq('id', 1)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) return json(404, { error: 'not_found' });
  const { error } = await sb
    .from('landing_content')
    .update({ draft: row.published, updated_at: new Date().toISOString(), updated_by: actorUserId })
    .eq('id', 1);
  if (error) throw error;
  await auditLog(sb, actorUserId, 'revert_landing_draft', 'landing_content', '1');
  return json(200, { data: { ok: true } });
}

/* ── Promo codes ───────────────────────────────────────────────────────── */
async function listPromos(sb: Client): Promise<Response> {
  // Bare-array response (see REGISTRY_CAP): the cap is the whole guarantee here.
  const { data, error } = await sb.from('promo_codes')
    .select('id, code, credits, max_redemptions, redemptions, expires_at, active, created_at')
    .order('created_at', { ascending: false })
    .limit(REGISTRY_CAP);
  if (error) throw error;
  return json(200, { data: data ?? [] });
}

async function createPromo(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const code = typeof args.code === 'string' ? args.code.trim() : '';
  const credits = typeof args.credits === 'number' && Number.isFinite(args.credits) ? Math.trunc(args.credits) : 0;
  const maxRedemptions = typeof args.maxRedemptions === 'number' && Number.isFinite(args.maxRedemptions)
    ? Math.trunc(args.maxRedemptions) : null;
  const expiresAt = typeof args.expiresAt === 'string' && args.expiresAt ? args.expiresAt : null;
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(code) || credits <= 0 || credits > 100000) return json(400, { error: 'invalid_args' });
  if (maxRedemptions !== null && maxRedemptions <= 0) return json(400, { error: 'invalid_args' });

  const { data, error } = await sb.from('promo_codes').insert({
    code, credits, max_redemptions: maxRedemptions, expires_at: expiresAt, created_by: actorUserId,
  }).select('id, code, credits, max_redemptions, redemptions, expires_at, active, created_at').maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === '23505') return json(409, { error: 'code_exists' });
    throw error;
  }
  await auditLog(sb, actorUserId, 'create_promo', 'promo', String(data?.id ?? code), { code, credits, maxRedemptions, expiresAt });
  return json(200, { data });
}

async function setPromoActive(sb: Client, actorUserId: string, args: Record<string, unknown>): Promise<Response> {
  const id = typeof args.id === 'string' ? args.id : '';
  const active = args.active === true;
  if (!id) return json(400, { error: 'invalid_args' });
  const { data, error } = await sb.from('promo_codes').update({ active }).eq('id', id)
    .select('id, active').maybeSingle();
  if (error) throw error;
  if (!data) return json(404, { error: 'not_found' });
  await auditLog(sb, actorUserId, 'set_promo_active', 'promo', id, { active });
  return json(200, { data });
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

/**
 * The audit trail, searched and paged on the server.
 *
 * Was a flat `.limit(200)` with client-side filtering, which quietly made the
 * screen useless for the thing an audit log is FOR: "what happened to this org
 * last month" only ever searched the most recent 200 rows, so on a busy platform
 * the answer was always "nothing" — indistinguishable from a clean record.
 *
 * Search covers action, target type and target id. Actor EMAIL is deliberately
 * not searchable here: it lives in `auth.users`, not on the row, so matching it
 * would mean resolving every actor before filtering — the whole-table read this
 * change exists to remove. Emails are still resolved for the rows returned.
 */
async function listAudit(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const { limit, offset, search } = paging(args);
  let q = sb
    .from('admin_audit')
    .select('id, actor_user_id, action, target_type, target_id, meta, created_at')
    .order('created_at', { ascending: false });
  if (search) {
    const term = likeTerm(search);
    q = q.or(`action.ilike.${term},target_type.ilike.${term},target_id.ilike.${term}`);
  }
  const { data: rawEntries, error } = await q.range(offset, offset + limit); // +1 sentinel
  if (error) throw error;
  const { rows: entries, hasMore } = page(rawEntries ?? [], limit);

  const actorIds = [...new Set((entries ?? []).map((e) => e.actor_user_id as string).filter(Boolean))];
  const { data: emails, error: emailErr } = actorIds.length
    ? await sb.rpc('admin_user_emails', { p_ids: actorIds })
    : { data: [], error: null };
  if (emailErr) throw emailErr;
  const emailById = new Map((emails ?? []).map((e) => [e.id as string, e.email as string | null]));

  const rows = entries.map((e) => ({ ...e, actorEmail: emailById.get(e.actor_user_id as string) ?? null }));
  return json(200, { data: { entries: rows, hasMore } });
}

async function listAdmins(sb: Client): Promise<Response> {
  const { data: admins, error, count } = await sb
    .from('platform_admins')
    .select('user_id, email, added_by, created_at', { count: 'exact' })
    .order('created_at', { ascending: true })
    .limit(REGISTRY_CAP);
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
  return json(200, { data: { admins: rows, total: count ?? rows.length } });
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

  // Guard and delete in ONE locked statement (migration 033). This was a
  // count-then-delete: two admins removing each other at the same moment both
  // read "there are 2 of us", both passed, and both deletes landed — zero
  // admins, and platform_admins has no client write policy, so /admin would be
  // locked out permanently. The RPC serializes removals and raises instead.
  const { data, error } = await sb.rpc('admin_remove_platform_admin', { p_user: userId });
  if (error) {
    // Same two answers as before, now decided by the database. Matched on the
    // raised message (support-api's `support_rate_limited` precedent); the
    // function raises nothing else.
    const msg = error.message ?? '';
    if (msg.includes('cannot_remove_last_admin')) return json(400, { error: 'cannot_remove_last_admin' });
    if (msg.includes('admin_not_found')) return json(404, { error: 'not_found' });
    throw error;
  }
  // Unreachable while 033 is the deployed body (it raises rather than returning
  // null), so this is the "someone changed the function" path, not a real case.
  if (data === null || data === undefined) return json(404, { error: 'not_found' });

  await auditLog(sb, actorUserId, 'remove_admin', 'user', userId);
  return json(200, { data: { userId } });
}


/* ------------------------------------------------------------------ */
/* Feature flags, org plans, and the billing catalogue                 */
/* ------------------------------------------------------------------ */
/* The RESOLVER lives in SQL (migration 028), not here. That is the whole
 * point: ENTITLEMENTS was already mirrored by hand into four Deno functions,
 * and a fifth copy of precedence in this file would have made it five. These
 * handlers only read and write the tables the resolver reads. */

const TIERS_SET = new Set(['free', 'essentials', 'premium', 'deluxe']);

/** A flag value is a boolean or a nullable number — never an arbitrary blob. */
function flagValue(v: unknown, valueType: string): { ok: true; value: unknown } | { ok: false } {
  if (valueType === 'boolean') {
    return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false };
  }
  if (v === null) return { ok: true, value: null };
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    return { ok: true, value: Math.round(v) };
  }
  return { ok: false };
}

async function flagType(sb: Client, key: string): Promise<string | null> {
  const { data, error } = await sb
    .from('feature_flags').select('value_type').eq('key', key).maybeSingle();
  if (error) throw error;
  return (data?.value_type as string | undefined) ?? null;
}

async function listFeatureFlags(sb: Client): Promise<Response> {
  const [flags, defaults] = await Promise.all([
    sb.from('feature_flags').select('*', { count: 'exact' }).order('sort').limit(REGISTRY_CAP),
    // tiers × flags, so it grows as the product of two registries — capped on
    // the same reasoning, at the same ceiling.
    sb.from('plan_feature_defaults').select('tier, flag_key, value', { count: 'exact' }).limit(REGISTRY_CAP),
  ]);
  if (flags.error) throw flags.error;
  if (defaults.error) throw defaults.error;
  const flagRows = flags.data ?? [];
  const defaultRows = defaults.data ?? [];
  return json(200, {
    data: {
      flags: flagRows,
      planDefaults: defaultRows,
      totals: { flags: flags.count ?? flagRows.length, planDefaults: defaults.count ?? defaultRows.length },
    },
  });
}

async function setPlanDefault(
  sb: Client, actorUserId: string, args: Record<string, unknown>,
): Promise<Response> {
  const tier = typeof args.tier === 'string' ? args.tier : '';
  const key = typeof args.key === 'string' ? args.key : '';
  if (!TIERS_SET.has(tier) || key === '') return json(400, { error: 'invalid_args' });
  const vt = await flagType(sb, key);
  if (vt === null) return json(404, { error: 'flag_not_found' });
  const parsed = flagValue(args.value, vt);
  if (!parsed.ok) return json(400, { error: 'invalid_args' });

  const { error } = await sb.from('plan_feature_defaults')
    .upsert({ tier, flag_key: key, value: parsed.value }, { onConflict: 'tier,flag_key' });
  if (error) throw error;
  await auditLog(sb, actorUserId, 'set_plan_default', 'plan_tier', tier, { key, value: parsed.value });
  return json(200, { data: { ok: true } });
}

async function setOverride(
  sb: Client, actorUserId: string, args: Record<string, unknown>, scope: 'org' | 'event',
): Promise<Response> {
  const targetId = typeof args.targetId === 'string' ? args.targetId : '';
  const key = typeof args.key === 'string' ? args.key : '';
  if (!UUID_RE.test(targetId) || key === '') return json(400, { error: 'invalid_args' });
  const vt = await flagType(sb, key);
  if (vt === null) return json(404, { error: 'flag_not_found' });
  const parsed = flagValue(args.value, vt);
  if (!parsed.ok) return json(400, { error: 'invalid_args' });

  const table = scope === 'org' ? 'org_feature_overrides' : 'event_feature_overrides';
  const idCol = scope === 'org' ? 'org_id' : 'event_id';
  const expiresAt = typeof args.expiresAt === 'string' && args.expiresAt !== ''
    ? args.expiresAt : null;
  const reason = typeof args.reason === 'string' ? args.reason.slice(0, 500) : null;

  const { error } = await sb.from(table).upsert({
    [idCol]: targetId, flag_key: key, value: parsed.value,
    reason, expires_at: expiresAt, set_by: actorUserId, set_at: new Date().toISOString(),
  }, { onConflict: `${idCol},flag_key` });
  if (error) throw error;
  await auditLog(sb, actorUserId, `set_${scope}_override`, scope, targetId,
    { key, value: parsed.value, reason, expiresAt });
  return json(200, { data: { ok: true } });
}

async function clearOverride(
  sb: Client, actorUserId: string, args: Record<string, unknown>, scope: 'org' | 'event',
): Promise<Response> {
  const targetId = typeof args.targetId === 'string' ? args.targetId : '';
  const key = typeof args.key === 'string' ? args.key : '';
  if (!UUID_RE.test(targetId) || key === '') return json(400, { error: 'invalid_args' });
  const table = scope === 'org' ? 'org_feature_overrides' : 'event_feature_overrides';
  const idCol = scope === 'org' ? 'org_id' : 'event_id';
  const { error } = await sb.from(table).delete().eq(idCol, targetId).eq('flag_key', key);
  if (error) throw error;
  await auditLog(sb, actorUserId, `clear_${scope}_override`, scope, targetId, { key });
  return json(200, { data: { ok: true } });
}

/** The ops panic button. `killable = false` flags refuse: killing projection
 *  mode or the watermark mid-event would break a live legacy wall. */
async function setFlagKill(
  sb: Client, actorUserId: string, args: Record<string, unknown>,
): Promise<Response> {
  const key = typeof args.key === 'string' ? args.key : '';
  const killed = args.killed === true;
  if (key === '') return json(400, { error: 'invalid_args' });

  const { data: flag, error: fErr } = await sb
    .from('feature_flags').select('killable, value_type').eq('key', key).maybeSingle();
  if (fErr) throw fErr;
  if (!flag) return json(404, { error: 'flag_not_found' });
  if (killed && flag.killable !== true) return json(400, { error: 'flag_not_killable' });

  let killedValue: unknown = null;
  if (killed) {
    const parsed = flagValue(
      args.killedValue === undefined ? false : args.killedValue,
      flag.value_type as string,
    );
    if (!parsed.ok) return json(400, { error: 'invalid_args' });
    killedValue = parsed.value;
  }

  const { error } = await sb.from('feature_flags').update({
    killed,
    killed_value: killed ? killedValue : null,
    killed_reason: killed ? (typeof args.reason === 'string' ? args.reason.slice(0, 500) : null) : null,
    killed_at: killed ? new Date().toISOString() : null,
    killed_by: killed ? actorUserId : null,
  }).eq('key', key);
  if (error) throw error;
  await auditLog(sb, actorUserId, killed ? 'kill_flag' : 'unkill_flag', 'feature_flag', key,
    { killedValue, reason: args.reason ?? null });
  return json(200, { data: { ok: true } });
}

/** Effective values WITH provenance, for the admin screen and its preview. */
async function resolveFeatures(sb: Client, args: Record<string, unknown>): Promise<Response> {
  const orgId = typeof args.orgId === 'string' && UUID_RE.test(args.orgId) ? args.orgId : null;
  const eventId = typeof args.eventId === 'string' && UUID_RE.test(args.eventId) ? args.eventId : null;
  if (orgId === null && eventId === null) return json(400, { error: 'invalid_args' });
  const { data, error } = await sb.rpc('explain_features', { p_org: orgId, p_event: eventId });
  if (error) throw error;
  return json(200, { data: { features: data ?? {} } });
}

/* ── Org plan ─────────────────────────────────────────────────────────── */
/* DB-authoritative. Stripe is a follower here and may only: write customer
 * metadata, or stop a renewal. It may NEVER create a charge — an admin plan
 * change is a comp, and a control that bills a saved card from an internal
 * tool is a chargeback and an SCA failure waiting to happen. Upgrades hand
 * back a Checkout link to SEND, which charges nobody. */
async function setOrgPlan(
  sb: Client, actorUserId: string, args: Record<string, unknown>,
): Promise<Response> {
  const orgId = typeof args.orgId === 'string' ? args.orgId : '';
  const tier = typeof args.tier === 'string' ? args.tier : '';
  if (!UUID_RE.test(orgId) || !TIERS_SET.has(tier)) return json(400, { error: 'invalid_args' });

  const expiresAt = typeof args.expiresAt === 'string' && args.expiresAt !== ''
    ? args.expiresAt : null;
  const note = typeof args.note === 'string' ? args.note.slice(0, 500) : null;

  const { data: org, error: oErr } = await sb
    .from('orgs').select('id, plan_tier, stripe_customer_id').eq('id', orgId).maybeSingle();
  if (oErr) throw oErr;
  if (!org) return json(404, { error: 'org_not_found' });

  const { data: sub } = await sb
    .from('subscriptions').select('stripe_subscription_id, status')
    .eq('org_id', orgId).maybeSingle();
  const hasActiveSub = sub?.status === 'active';

  // 1. The DB write. This is the part that takes effect, and it happens whether
  //    or not Stripe is reachable or even configured.
  const { error: uErr } = await sb.from('orgs').update({
    plan_tier: tier,
    plan_expires_at: expiresAt,
    plan_note: note,
    plan_source: 'admin_override',
    plan_set_by: actorUserId,
    plan_set_at: new Date().toISOString(),
  }).eq('id', orgId);
  if (uErr) throw uErr;

  await auditLog(sb, actorUserId, 'set_org_plan', 'org', orgId, {
    from: org.plan_tier, to: tier, expiresAt, note, syncStripe: args.syncStripe === true,
  });

  // 2. Stripe, best effort and never able to fail the plan change.
  let stripeSynced = false;
  let stripeError: string | null = null;
  const key = Deno.env.get('STRIPE_SECRET_KEY');

  if (args.syncStripe === true) {
    if (!key) {
      stripeError = 'billing_not_configured';
    } else if (!org.stripe_customer_id) {
      stripeError = 'no_stripe_customer';
    } else {
      try {
        const body = new URLSearchParams({
          'metadata[beamwall_plan_tier]': tier,
          'metadata[beamwall_plan_expires_at]': expiresAt ?? '',
          'metadata[beamwall_plan_source]': 'admin_override',
        });
        const res = await fetch(`https://api.stripe.com/v1/customers/${org.stripe_customer_id}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        });
        if (!res.ok) {
          stripeError = `stripe_${res.status}`;
          console.error('[admin-api] stripe metadata write failed', res.status, await res.text().catch(() => ''));
        } else {
          stripeSynced = true;
        }

        // A downgrade away from a live subscription stops the RENEWAL. It does
        // not refund, and they keep what they paid for until the period ends.
        if (tier === 'free' && hasActiveSub && sub?.stripe_subscription_id) {
          const cancelRes = await fetch(
            `https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({ cancel_at_period_end: 'true' }),
            },
          );
          if (!cancelRes.ok) {
            stripeError = `stripe_cancel_${cancelRes.status}`;
          } else {
            await auditLog(sb, actorUserId, 'stripe_cancel_at_period_end', 'org', orgId,
              { subscription: sub.stripe_subscription_id });
          }
        }
      } catch (e) {
        console.error('[admin-api] stripe sync threw', e);
        stripeError = 'stripe_unreachable';
      }
    }
  }

  // The plan applied regardless; the UI is told the truth about Stripe so it
  // never implies a sync that did not happen.
  return json(200, { data: { tier, expiresAt, stripeSynced, stripeError } });
}

/* ── Billing catalogue ────────────────────────────────────────────────── */

async function listCatalog(sb: Client): Promise<Response> {
  const { data, error, count } = await sb
    .from('billing_catalog').select('*', { count: 'exact' }).order('sort').limit(REGISTRY_CAP);
  if (error) throw error;
  const items = data ?? [];
  return json(200, { data: { items, total: count ?? items.length } });
}

async function upsertCatalogItem(
  sb: Client, actorUserId: string, args: Record<string, unknown>,
): Promise<Response> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (id === '' || id.length > 120) return json(400, { error: 'invalid_args' });
  const patch: Record<string, unknown> = {};
  if (typeof args.name === 'string') patch.name = args.name.slice(0, 200);
  if (typeof args.description === 'string') patch.description = args.description.slice(0, 500);
  if (typeof args.amountCents === 'number' && Number.isFinite(args.amountCents) && args.amountCents >= 0) {
    patch.amount_cents = Math.round(args.amountCents);
  }
  if (typeof args.creditsGranted === 'number' && args.creditsGranted >= 0) {
    patch.credits_granted = Math.round(args.creditsGranted);
  }
  if (typeof args.active === 'boolean') patch.active = args.active;
  if (Object.keys(patch).length === 0) return json(400, { error: 'invalid_args' });

  // A price change invalidates the provisioned Stripe Price: Stripe prices are
  // immutable, so a new one must be created. Clearing the id forces that on the
  // next sync rather than silently charging the old amount.
  if (patch.amount_cents !== undefined) {
    patch.stripe_price_id = null;
    patch.synced_at = null;
  }

  const { error } = await sb.from('billing_catalog').update(patch).eq('id', id);
  if (error) throw error;
  await auditLog(sb, actorUserId, 'upsert_catalog_item', 'billing_catalog', id, patch);
  return json(200, { data: { ok: true } });
}

/**
 * Provision the catalogue into Stripe: one Product + one Price per active row.
 *
 * Idempotent by construction. A Stripe Price is IMMUTABLE, so this never edits
 * one — it looks for an existing Price carrying our catalogue id in metadata at
 * the current amount, and only creates a new one when there is none. Products
 * are matched by metadata too, so re-running does not duplicate anything.
 */
async function syncCatalogToStripe(
  sb: Client, actorUserId: string, args: Record<string, unknown>,
): Promise<Response> {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json(503, { error: 'billing_not_configured' });
  const live = key.startsWith('sk_live_');
  if (!live && Deno.env.get('ALLOW_TEST_BILLING') !== 'true') {
    return json(503, { error: 'billing_test_mode' });
  }

  const onlyId = typeof args.id === 'string' ? args.id : null;
  let q = sb.from('billing_catalog').select('*').eq('active', true);
  if (onlyId !== null) q = q.eq('id', onlyId);
  const { data: items, error } = await q;
  if (error) throw error;

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const results: Array<Record<string, unknown>> = [];

  for (const item of items ?? []) {
    const id = item.id as string;
    try {
      // 1. Product — reuse the stored id if we have one.
      let productId = item.stripe_product_id as string | null;
      if (!productId) {
        const res = await fetch('https://api.stripe.com/v1/products', {
          method: 'POST',
          headers,
          body: new URLSearchParams({
            name: item.name as string,
            description: (item.description as string | null) ?? '',
            'metadata[beamwall_catalog_id]': id,
          }),
        });
        if (!res.ok) throw new Error(`product_${res.status}:${await res.text().catch(() => '')}`);
        productId = ((await res.json()) as { id: string }).id;
      }

      // 2. Price — immutable, so create only when the amount has no Price yet.
      let priceId = item.stripe_price_id as string | null;
      if (!priceId) {
        const params = new URLSearchParams({
          product: productId,
          currency: (item.currency as string) ?? 'usd',
          unit_amount: String(item.amount_cents),
          lookup_key: id,
          'transfer_lookup_key': 'true',
          'metadata[beamwall_catalog_id]': id,
        });
        if (item.recurring_interval) {
          params.set('recurring[interval]', item.recurring_interval as string);
        }
        const res = await fetch('https://api.stripe.com/v1/prices', {
          method: 'POST', headers, body: params,
        });
        if (!res.ok) throw new Error(`price_${res.status}:${await res.text().catch(() => '')}`);
        priceId = ((await res.json()) as { id: string }).id;
      }

      const { error: uErr } = await sb.from('billing_catalog').update({
        stripe_product_id: productId,
        stripe_price_id: priceId,
        synced_at: new Date().toISOString(),
        sync_error: null,
      }).eq('id', id);
      if (uErr) throw uErr;
      results.push({ id, productId, priceId, ok: true });
    } catch (e) {
      const message = String(e).slice(0, 300);
      console.error('[admin-api] catalog sync failed', id, message);
      await sb.from('billing_catalog').update({ sync_error: message }).eq('id', id);
      // Keep going: one bad row must not strand the rest of the catalogue.
      results.push({ id, ok: false, error: message });
    }
  }

  await auditLog(sb, actorUserId, 'sync_catalog_to_stripe', 'billing_catalog', onlyId ?? 'all',
    { mode: live ? 'live' : 'test', results });
  return json(200, { data: { results, mode: live ? 'live' : 'test' } });
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
        return await listOrgs(sb, args);
      case 'get_org':
        return await getOrg(sb, args);
      case 'list_events':
        return await listEvents(sb, args);
      case 'set_event_status':
        return await setEventStatus(sb, user.id, args);
      case 'list_orders':
        return await listOrders(sb, args);
      case 'revenue_summary':
        return await revenueSummary(sb);
      case 'list_users':
        return await listUsers(sb, args);
      case 'reset_password':
        return await resetPassword(sb, user.id, args);
      case 'set_user_banned':
        return await setUserBanned(sb, user.id, args);
      case 'adjust_credits':
        return await adjustCredits(sb, user.id, args);
      case 'get_platform_config':
        return await getPlatformConfig(sb);
      case 'set_signup_credits':
        return await setSignupCredits(sb, user.id, args);
      case 'get_landing_content_admin':
        return await getLandingContentAdmin(sb);
      case 'save_landing_draft':
        return await saveLandingDraft(sb, user.id, args);
      case 'publish_landing_content':
        return await publishLandingContent(sb, user.id);
      case 'revert_landing_draft':
        return await revertLandingDraft(sb, user.id);
      case 'list_promos':
        return await listPromos(sb);
      case 'create_promo':
        return await createPromo(sb, user.id, args);
      case 'set_promo_active':
        return await setPromoActive(sb, user.id, args);
      case 'set_event_tier':
        return await setEventTier(sb, user.id, args);
      case 'list_audit':
        return await listAudit(sb, args);
      case 'list_admins':
        return await listAdmins(sb);
      case 'add_admin':
        return await addAdmin(sb, user.id, args);
      case 'remove_admin':
        return await removeAdmin(sb, user.id, args);
      case 'list_feature_flags':
        return await listFeatureFlags(sb);
      case 'set_plan_default':
        return await setPlanDefault(sb, user.id, args);
      case 'set_org_override':
        return await setOverride(sb, user.id, args, 'org');
      case 'clear_org_override':
        return await clearOverride(sb, user.id, args, 'org');
      case 'set_event_override':
        return await setOverride(sb, user.id, args, 'event');
      case 'clear_event_override':
        return await clearOverride(sb, user.id, args, 'event');
      case 'set_flag_kill':
        return await setFlagKill(sb, user.id, args);
      case 'resolve_features':
        return await resolveFeatures(sb, args);
      case 'set_org_plan':
        return await setOrgPlan(sb, user.id, args);
      case 'list_catalog':
        return await listCatalog(sb);
      case 'upsert_catalog_item':
        return await upsertCatalogItem(sb, user.id, args);
      case 'sync_catalog_to_stripe':
        return await syncCatalogToStripe(sb, user.id, args);
      default:
        return json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('[admin-api] internal error', err);
    return json(500, { error: 'internal' });
  }
});
