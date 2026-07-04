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
 *   customer.subscription.updated → subscriptions.status/current_period_end sync
 *   customer.subscription.deleted → subscriptions.status = 'canceled'
 *   (anything else → 200 {received:true, ignored:true})
 *
 * Idempotency FIRST: the Stripe event id is inserted into stripe_webhook_events
 * before any effect; a duplicate delivery conflicts → 200 {duplicate:true}.
 * If fulfilment fails after that insert, the row is deleted and 500 returned
 * so Stripe retries.
 *
 * Requires migration 006_grant_credits.sql (public.grant_credits) to be
 * applied BEFORE this function is deployed.
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
 *  Best-effort: null when the key is missing or the call fails. */
async function fetchPeriodEnd(subscriptionId: string): Promise<string | null> {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const sub = (await res.json()) as Record<string, unknown>;
    const items = (sub.items as { data?: Record<string, unknown>[] } | undefined)?.data;
    return epochToIso(sub.current_period_end) ?? epochToIso(items?.[0]?.current_period_end);
  } catch {
    return null;
  }
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
  } else if (kind === 'credit_pack') {
    const credits = PACK_CREDITS[meta.pack];
    if (!credits) throw new Error(`invalid credit_pack metadata on ${session.id}`);
    await grantCredits(sb, orgId, credits, 'pack', { ...ref, pack: meta.pack });
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
  } else {
    console.warn('[stripe-webhook] unknown checkout kind', kind, session.id);
  }
}

async function handleSubscriptionChange(
  sb: SupabaseClient,
  type: string,
  sub: Record<string, unknown>,
): Promise<void> {
  const subscriptionId = sub.id as string;
  const status = type === 'customer.subscription.deleted' ? 'canceled' : ((sub.status as string) ?? 'active');
  const items = (sub.items as { data?: Record<string, unknown>[] } | undefined)?.data;
  const periodEnd = epochToIso(sub.current_period_end) ?? epochToIso(items?.[0]?.current_period_end);

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

  const { error } = await sb.from('subscriptions').upsert(
    {
      org_id: orgId,
      stripe_subscription_id: subscriptionId,
      status,
      tier: 'pro',
      current_period_end: periodEnd,
    },
    { onConflict: 'org_id' },
  );
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
