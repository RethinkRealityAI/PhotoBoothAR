/**
 * stripe-webhook — Stripe event ingestion (fulfilment + subscription sync).
 *
 * ⚠ DEPLOY WITH verify_jwt DISABLED — Stripe calls this endpoint directly and
 *   cannot send a Supabase JWT:  `supabase functions deploy stripe-webhook --no-verify-jwt`
 *   Authentication is the Stripe-Signature header, verified manually below
 *   (HMAC-SHA256 over `${t}.${rawBody}` with STRIPE_WEBHOOK_SECRET, timing-safe
 *   compare, 5-minute timestamp tolerance).
 *
 * Handled events → DB effects (all writes service-role):
 *   checkout.session.completed
 *     kind=event_package → insert event_plans {event_id, tier, stripe_payment_intent,
 *                          features: entitlements snapshot} + events.plan_tier = tier
 *                          + grant_credits(20/100/130, 'plan_grant')
 *     kind=credit_pack   → grant_credits(50/120/300, 'pack')
 *     kind=pro_subscription → upsert subscriptions {org_id, stripe_subscription_id,
 *                          status:'active', current_period_end (fetched from Stripe)}
 *                          + grant_credits(300, 'pro_grant')
 *     ALL kinds also insert an `orders` row (amount_total/currency from the
 *     session — never recomputed from PRICES) for the admin Payments screen.
 *   invoice.payment_succeeded (billing_reason='subscription_cycle' only — the
 *     first period is already recorded via checkout.session.completed above)
 *     → insert an `orders` row for the Pro renewal
 *       + grant_credits(300, 'pro_grant') — the monthly credit re-grant.
 *   charge.refunded (full refunds only) → orders.status='refunded'
 *       + clawback_credits(<granted amount>, 'refund_clawback') (floors at 0);
 *       event_package tier is NOT auto-reverted (prior tier unrecorded) —
 *       an operator error line is logged instead. Partial refunds: log only.
 *   charge.dispute.created → orders.status='disputed' + operator error line.
 *   customer.subscription.updated → subscriptions.status/current_period_end sync
 *     (period end backfilled via the Stripe API when absent from the payload;
 *     a stored value is never overwritten with null)
 *   customer.subscription.deleted → subscriptions.status = 'canceled'
 *   (anything else → 200 {received:true, ignored:true})
 *
 * Idempotency FIRST: the Stripe event id is inserted into stripe_webhook_events
 * before any effect; a duplicate delivery conflicts → 200 {duplicate:true}.
 * If fulfilment fails after that insert, the row is deleted and 500 returned
 * so Stripe retries.
 *
 * Requires migrations 006_grant_credits.sql (public.grant_credits) and
 * 016_orders_status.sql (public.clawback_credits + orders.status 'disputed')
 * to be applied BEFORE this function is deployed.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injected),
 *      STRIPE_WEBHOOK_SECRET (secret — absent until keys are provisioned),
 *      STRIPE_SECRET_KEY (optional here; used to read the subscription's
 *      current_period_end on pro checkout — degrades to null if absent).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const TOLERANCE_SECONDS = 5 * 60;

/* Credit grants per purchase (must match PRICES in stripe-checkout). */
const PACKAGE_CREDITS: Record<string, number> = { essentials: 20, premium: 100, deluxe: 130 };
const PACK_CREDITS: Record<string, number> = { '50': 50, '120': 120, '300': 300 };
const PRO_MONTHLY_CREDITS = 300;

/* Entitlements snapshot stored on event_plans.features at purchase time.
 * Mirror of src/lib/entitlements.ts — keep the two in sync. */
const ENTITLEMENTS: Record<string, Record<string, unknown>> = {
  essentials: {
    maxPosts: 500, videoEnabled: true, watermark: false, aiStudio: true,
    cardsStandard: false, cardsPremiumRender: false, projectionMode: true, retentionDays: 90,
  },
  premium: {
    maxPosts: null, videoEnabled: true, watermark: false, aiStudio: true,
    cardsStandard: true, cardsPremiumRender: false, projectionMode: true, retentionDays: 365,
  },
  deluxe: {
    maxPosts: null, videoEnabled: true, watermark: false, aiStudio: true,
    cardsStandard: true, cardsPremiumRender: true, projectionMode: true, retentionDays: 365,
  },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

/* ── Signature verification ─────────────────────────────────────────── */

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Parse `t=...,v1=...[,v1=...]` and verify HMAC-SHA256(`${t}.${raw}`). */
async function verifyStripeSignature(
  raw: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  let t = '';
  const v1s: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1s.push(v);
  }
  if (!t || v1s.length === 0) return false;

  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${raw}`));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return v1s.some((v) => timingSafeEqualHex(expected, v));
}

/* ── Helpers ────────────────────────────────────────────────────────── */

async function grantCredits(
  sb: SupabaseClient,
  orgId: string,
  amount: number,
  reason: string,
  ref: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.rpc('grant_credits', {
    p_org: orgId,
    p_amount: amount,
    p_reason: reason,
    p_ref: ref,
  });
  if (error) throw error;
}

function epochToIso(seconds: unknown): string | null {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

/** current_period_end for a subscription id via the Stripe REST API.
 *  Newer API versions moved it onto the subscription items — check both.
 *  Best-effort: null when the key is missing or the call fails, but every
 *  null path logs at error level (a silently-null period end previously left
 *  subscriptions rows with no expiry; customer.subscription.updated backfills
 *  it — see handleSubscriptionChange). */
async function fetchPeriodEnd(subscriptionId: string): Promise<string | null> {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    console.error(`[stripe-webhook] fetchPeriodEnd: STRIPE_SECRET_KEY not set — current_period_end unknown for ${subscriptionId}`);
    return null;
  }
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.error(`[stripe-webhook] fetchPeriodEnd: Stripe API ${res.status} for ${subscriptionId}`);
      return null;
    }
    const sub = (await res.json()) as Record<string, unknown>;
    const items = (sub.items as { data?: Record<string, unknown>[] } | undefined)?.data;
    const end = epochToIso(sub.current_period_end) ?? epochToIso(items?.[0]?.current_period_end);
    if (end === null) {
      console.error(`[stripe-webhook] fetchPeriodEnd: no current_period_end on subscription or items for ${subscriptionId}`);
    }
    return end;
  } catch (err) {
    console.error(`[stripe-webhook] fetchPeriodEnd: request failed for ${subscriptionId}`, err);
    return null;
  }
}

interface OrderInsert {
  org_id: string;
  event_id: string | null;
  kind: 'event_package' | 'credit_pack' | 'pro_subscription';
  tier: string | null;
  amount_total: number;
  currency: string;
  stripe_ref: string | null;
}

async function insertOrder(sb: SupabaseClient, order: OrderInsert): Promise<void> {
  const { error } = await sb.from('orders').insert({ ...order, status: 'paid' });
  if (error) throw error;
}

interface OrderRow {
  id: number;
  org_id: string;
  event_id: string | null;
  kind: string;
  tier: string | null;
  status: string;
}

/** Locate the orders row a charge/dispute belongs to. `stripe_ref` holds the
 *  payment_intent (one-time checkouts), the subscription id (initial Pro
 *  checkout), or the invoice id (Pro renewals) — match on every identifier
 *  the Stripe object carries. Newest row wins if several match. */
async function findOrderByRefs(sb: SupabaseClient, refs: unknown[]): Promise<OrderRow | null> {
  const clean = refs.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (clean.length === 0) return null;
  const { data, error } = await sb
    .from('orders')
    .select('id, org_id, event_id, kind, tier, status')
    .in('stripe_ref', clean)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as OrderRow | null) ?? null;
}

/** Credits the original purchase granted, derived from the order row —
 *  mirrors the grant amounts in handleCheckoutCompleted/renewals above.
 *  null when the kind/tier no longer maps to a known grant. */
function creditsGrantedFor(order: OrderRow): number | null {
  if (order.kind === 'pro_subscription') return PRO_MONTHLY_CREDITS;
  if (order.kind === 'event_package') return PACKAGE_CREDITS[order.tier ?? ''] ?? null;
  if (order.kind === 'credit_pack') return PACK_CREDITS[order.tier ?? ''] ?? null;
  return null;
}

/* ── Event handlers ─────────────────────────────────────────────────── */

async function handleCheckoutCompleted(
  sb: SupabaseClient,
  eventId: string,
  session: Record<string, unknown>,
): Promise<void> {
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const orgId = meta.org_id;
  const kind = meta.kind;
  if (!orgId || !kind) {
    // Not one of ours (or created outside stripe-checkout) — record + ignore.
    console.warn('[stripe-webhook] checkout.session.completed without metadata, ignoring', session.id);
    return;
  }
  const ref = { stripe_event: eventId, checkout_session: session.id };
  const amountTotal = typeof session.amount_total === 'number' ? session.amount_total : 0;
  const currency = (session.currency as string) ?? 'usd';

  if (kind === 'event_package') {
    const tier = meta.tier;
    const eventUuid = meta.event_uuid;
    const credits = PACKAGE_CREDITS[tier];
    if (!eventUuid || !credits) throw new Error(`invalid event_package metadata on ${session.id}`);

    const { error: planErr } = await sb.from('event_plans').insert({
      event_id: eventUuid,
      tier,
      stripe_payment_intent: (session.payment_intent as string) ?? null,
      features: ENTITLEMENTS[tier] ?? {},
    });
    if (planErr) throw planErr;

    const { error: tierErr } = await sb
      .from('events')
      .update({ plan_tier: tier })
      .eq('id', eventUuid);
    if (tierErr) throw tierErr;

    await grantCredits(sb, orgId, credits, 'plan_grant', { ...ref, tier, event_uuid: eventUuid });
    await insertOrder(sb, {
      org_id: orgId,
      event_id: eventUuid,
      kind: 'event_package',
      tier,
      amount_total: amountTotal,
      currency,
      stripe_ref: (session.payment_intent as string) ?? (session.id as string),
    });
  } else if (kind === 'credit_pack') {
    const credits = PACK_CREDITS[meta.pack];
    if (!credits) throw new Error(`invalid credit_pack metadata on ${session.id}`);
    await grantCredits(sb, orgId, credits, 'pack', { ...ref, pack: meta.pack });
    await insertOrder(sb, {
      org_id: orgId,
      event_id: null,
      kind: 'credit_pack',
      tier: meta.pack,
      amount_total: amountTotal,
      currency,
      stripe_ref: (session.payment_intent as string) ?? (session.id as string),
    });
  } else if (kind === 'pro_subscription') {
    const subscriptionId = (session.subscription as string) ?? null;
    const periodEnd = subscriptionId ? await fetchPeriodEnd(subscriptionId) : null;
    const { error: subErr } = await sb.from('subscriptions').upsert(
      {
        org_id: orgId,
        stripe_subscription_id: subscriptionId,
        status: 'active',
        tier: 'pro',
        current_period_end: periodEnd,
      },
      { onConflict: 'org_id' },
    );
    if (subErr) throw subErr;
    await grantCredits(sb, orgId, PRO_MONTHLY_CREDITS, 'pro_grant', { ...ref, subscription: subscriptionId });
    await insertOrder(sb, {
      org_id: orgId,
      event_id: null,
      kind: 'pro_subscription',
      tier: 'pro',
      amount_total: amountTotal,
      currency,
      stripe_ref: subscriptionId ?? (session.id as string),
    });
  } else {
    console.warn('[stripe-webhook] unknown checkout kind', kind, session.id);
  }
}

/** Pro renewals only — the subscription's first period is already recorded
 *  (orders row + credit grant) by handleCheckoutCompleted above, so this is
 *  gated on billing_reason='subscription_cycle' to avoid double-counting it.
 *  Each renewal re-grants the monthly Pro credits. Webhook replay is safe:
 *  the entry point claims the Stripe event id in stripe_webhook_events BEFORE
 *  this runs, so a redelivered event returns {duplicate:true} without
 *  re-granting. */
async function handleInvoicePaymentSucceeded(
  sb: SupabaseClient,
  eventId: string,
  invoice: Record<string, unknown>,
): Promise<void> {
  if (invoice.billing_reason !== 'subscription_cycle') return;
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : null;
  if (!subscriptionId) return;

  const { data: sub, error: subErr } = await sb
    .from('subscriptions')
    .select('org_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (subErr) throw subErr;
  if (!sub) {
    console.warn('[stripe-webhook] invoice.payment_succeeded: unknown subscription', subscriptionId);
    return;
  }

  const invoiceId = typeof invoice.id === 'string' ? invoice.id : null;
  await insertOrder(sb, {
    org_id: sub.org_id as string,
    event_id: null,
    kind: 'pro_subscription',
    tier: 'pro',
    amount_total: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : 0,
    currency: (invoice.currency as string) ?? 'usd',
    stripe_ref: invoiceId,
  });
  // Monthly credit re-grant — deliberately LAST: if the grant fails mid-handler
  // the Stripe retry re-runs everything, and the op that can double-apply is
  // then the visible/reconcilable orders row, never spendable credits.
  await grantCredits(sb, sub.org_id as string, PRO_MONTHLY_CREDITS, 'pro_grant', {
    stripe_event: eventId,
    invoice: invoiceId,
    subscription: subscriptionId,
    billing_reason: 'subscription_cycle',
  });
}

/** Full refunds: mark the orders row 'refunded' and claw back the credits the
 *  purchase granted (negative credit_ledger entry, reason 'refund_clawback',
 *  balance floored at 0 by clawback_credits — a shortfall is logged). The
 *  events.plan_tier of a refunded event_package is NOT auto-reverted: the
 *  prior tier is not recorded on the orders row, so an operator error line is
 *  logged instead. Partial refunds (charge.refunded !== true): log only. */
async function handleChargeRefunded(
  sb: SupabaseClient,
  eventId: string,
  charge: Record<string, unknown>,
): Promise<void> {
  const chargeId = typeof charge.id === 'string' ? charge.id : null;
  if (!chargeId) return;
  if (charge.refunded !== true) {
    console.error(
      `[stripe-webhook] REFUND partial: charge ${chargeId} amount_refunded=${charge.amount_refunded} — no automatic clawback, review manually`,
    );
    return;
  }

  const order = await findOrderByRefs(sb, [charge.payment_intent, chargeId, charge.invoice]);
  if (!order) {
    console.error(
      `[stripe-webhook] REFUND unmatched: charge ${chargeId} (stripe event ${eventId}) has no orders row — no clawback applied, review manually`,
    );
    return;
  }
  if (order.status === 'refunded') {
    // Already processed (e.g. a second charge.refunded for the same charge).
    return;
  }

  // 1. Mark the order — idempotent, safe if a mid-handler failure retries us.
  const { error: updErr } = await sb.from('orders').update({ status: 'refunded' }).eq('id', order.id);
  if (updErr) throw updErr;

  // 2. event_package tier: not recoverable from the order row — operator log.
  if (order.kind === 'event_package' && order.event_id !== null) {
    console.error(
      `[stripe-webhook] REFUND tier-revert needed: order ${order.id} (event ${order.event_id}, tier ${order.tier}) refunded, but the prior plan_tier is not recorded — revert events.plan_tier manually`,
    );
  }

  // 3. Claw back the granted credits — deliberately LAST (sole non-idempotent
  //    op; a retry after failure only repeats the harmless status update).
  const credits = creditsGrantedFor(order);
  if (credits === null) {
    console.error(
      `[stripe-webhook] REFUND: cannot derive granted credits for order ${order.id} (kind=${order.kind}, tier=${order.tier}) — no clawback applied, review manually`,
    );
    return;
  }
  const { data: clawed, error: clawErr } = await sb.rpc('clawback_credits', {
    p_org: order.org_id,
    p_amount: credits,
    p_reason: 'refund_clawback',
    p_ref: { stripe_event: eventId, charge: chargeId, order_id: order.id, granted: credits },
  });
  if (clawErr) throw clawErr;
  if (typeof clawed === 'number' && clawed < credits) {
    console.error(
      `[stripe-webhook] REFUND clawback shortfall: org ${order.org_id} had only ${clawed}/${credits} credits left (charge ${chargeId}) — balance floored at 0`,
    );
  }
}

/** Disputes: mark the orders row 'disputed' and alert the operator. No
 *  automatic credit or tier changes — the dispute may still be won; outcomes
 *  are handled manually (a lost dispute later arrives as charge.refunded). */
async function handleDisputeCreated(
  sb: SupabaseClient,
  eventId: string,
  dispute: Record<string, unknown>,
): Promise<void> {
  const disputeId = typeof dispute.id === 'string' ? dispute.id : '(no id)';
  const order = await findOrderByRefs(sb, [dispute.payment_intent, dispute.charge]);
  if (!order) {
    console.error(
      `[stripe-webhook] DISPUTE unmatched: ${disputeId} (charge ${dispute.charge}, stripe event ${eventId}) has no orders row — review manually`,
    );
    return;
  }
  const { error } = await sb.from('orders').update({ status: 'disputed' }).eq('id', order.id);
  if (error) throw error;
  console.error(
    `[stripe-webhook] DISPUTE opened: order ${order.id} (org ${order.org_id}, kind ${order.kind}, tier ${order.tier}) marked disputed — dispute ${disputeId}, charge ${dispute.charge}, reason ${dispute.reason} — respond in the Stripe dashboard`,
  );
}

async function handleSubscriptionChange(
  sb: SupabaseClient,
  type: string,
  sub: Record<string, unknown>,
): Promise<void> {
  const subscriptionId = sub.id as string;
  const status = type === 'customer.subscription.deleted' ? 'canceled' : ((sub.status as string) ?? 'active');
  const items = (sub.items as { data?: Record<string, unknown>[] } | undefined)?.data;
  let periodEnd = epochToIso(sub.current_period_end) ?? epochToIso(items?.[0]?.current_period_end);
  if (periodEnd === null) {
    // Backfill: the event payload lacked a period end (e.g. the checkout-time
    // fetch failed earlier, or a partial payload) — re-fetch from the API.
    periodEnd = await fetchPeriodEnd(subscriptionId);
  }

  // Resolve the org: by known subscription id, then subscription metadata
  // (stamped by stripe-checkout), then the org's stripe_customer_id.
  let orgId: string | null = null;
  const { data: existing } = await sb
    .from('subscriptions')
    .select('org_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (existing) orgId = existing.org_id as string;
  if (!orgId) {
    const metaOrg = ((sub.metadata ?? {}) as Record<string, string>).org_id;
    if (metaOrg) orgId = metaOrg;
  }
  if (!orgId && typeof sub.customer === 'string') {
    const { data: org } = await sb
      .from('orgs')
      .select('id')
      .eq('stripe_customer_id', sub.customer)
      .maybeSingle();
    if (org) orgId = org.id as string;
  }
  if (!orgId) {
    // Unknown subscription (e.g. created outside this platform) — ignore.
    console.warn('[stripe-webhook] could not resolve org for subscription', subscriptionId);
    return;
  }

  const row: Record<string, unknown> = {
    org_id: orgId,
    stripe_subscription_id: subscriptionId,
    status,
    tier: 'pro',
  };
  // Only write current_period_end when known — never clobber a stored value
  // with null just because this payload/fetch could not resolve it (upsert
  // updates only the columns present in the payload).
  if (periodEnd !== null) row.current_period_end = periodEnd;
  const { error } = await sb.from('subscriptions').upsert(row, { onConflict: 'org_id' });
  if (error) throw error;
}

/* ── Entry point ────────────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return json(503, { error: 'billing_not_configured' });

  const raw = await req.text();
  const ok = await verifyStripeSignature(raw, req.headers.get('Stripe-Signature'), secret);
  if (!ok) return json(400, { error: 'invalid_signature' });

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const eventId = event.id as string;
  const type = event.type as string;
  if (!eventId || !type) return json(400, { error: 'invalid_event' });

  const sb = serviceClient();

  // Idempotency FIRST — claim the event id before any side effect.
  const { error: idemErr } = await sb.from('stripe_webhook_events').insert({ id: eventId, type });
  if (idemErr) {
    if ((idemErr as { code?: string }).code === '23505') {
      return json(200, { received: true, duplicate: true });
    }
    console.error('[stripe-webhook] idempotency insert failed', idemErr);
    return json(500, { error: 'internal' });
  }

  try {
    const object = ((event.data ?? {}) as { object?: Record<string, unknown> }).object ?? {};
    if (type === 'checkout.session.completed') {
      await handleCheckoutCompleted(sb, eventId, object);
    } else if (type === 'invoice.payment_succeeded') {
      await handleInvoicePaymentSucceeded(sb, eventId, object);
    } else if (type === 'charge.refunded') {
      await handleChargeRefunded(sb, eventId, object);
    } else if (type === 'charge.dispute.created') {
      await handleDisputeCreated(sb, eventId, object);
    } else if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      await handleSubscriptionChange(sb, type, object);
    } else {
      return json(200, { received: true, ignored: true });
    }
    return json(200, { received: true });
  } catch (err) {
    console.error(`[stripe-webhook] handling ${type} (${eventId}) failed`, err);
    // Release the idempotency claim so Stripe's retry can re-attempt.
    await sb.from('stripe_webhook_events').delete().eq('id', eventId);
    return json(500, { error: 'internal' });
  }
});
