/**
 * stripe-checkout — authenticated Stripe Checkout session creation.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { kind: 'event_package', tier: 'essentials'|'premium'|'deluxe', eventUuid, returnUrl }
 * | { kind: 'credit_pack',   pack: '50'|'120'|'300',                returnUrl }
 * | { kind: 'pro_subscription',                                     returnUrl }
 *
 * 200 → { url }                       Stripe-hosted checkout URL
 * 400 → { error: 'invalid_json' | 'invalid_body' | 'invalid_return_url' }
 * 401 → { error: 'unauthorized' }
 * 403 → { error: 'forbidden' }        caller is not a member of the org
 * 404 → { error: 'event_not_found' }
 * 500 → { error: 'internal' | 'stripe_error' }
 * 503 → { error: 'billing_not_configured' }  STRIPE_SECRET_KEY not set yet
 * 503 → { error: 'billing_test_mode' }       STRIPE_SECRET_KEY is a test key
 *        (not sk_live_) and ALLOW_TEST_BILLING !== 'true' — prevents test-card
 *        checkouts from minting real entitlements; set ALLOW_TEST_BILLING=true
 *        in the function secrets to deliberately sandbox-test end-to-end.
 *
 * Prices are inline price_data (no pre-created Stripe products). All amounts
 * in cents, usd. Metadata {org_id, kind, tier?/pack?, event_uuid?} is read
 * back by stripe-webhook on checkout.session.completed.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected),
 *      STRIPE_SECRET_KEY (secret — absent until keys are provisioned),
 *      ALLOW_TEST_BILLING (optional — 'true' permits checkout on a test key).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/* Business-model prices (docs/superpowers/specs/2026-07-03 §3), cents/usd.
 * Credit grants are applied by stripe-webhook, listed here for reference. */
const PRICES = {
  event_package: {
    essentials: { amount: 4900, credits: 20, name: 'Essentials event package' },
    premium: { amount: 9900, credits: 100, name: 'Premium event package' },
    deluxe: { amount: 16900, credits: 130, name: 'Deluxe event package' },
  },
  credit_pack: {
    '50': { amount: 500, credits: 50, name: '50 credit pack' },
    '120': { amount: 1000, credits: 120, name: '120 credit pack' },
    '300': { amount: 2000, credits: 300, name: '300 credit pack' },
  },
  pro_subscription: { amount: 7900, credits: 300, name: 'Beamwall Pro subscription' },
} as const;

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

/** Minimal Stripe REST client — raw form-encoded fetch, no npm SDK. */
async function stripePost(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error('[stripe-checkout] stripe error', path, JSON.stringify(body?.error ?? body));
    throw new Error('stripe_error');
  }
  return body;
}

/** returnUrl must be same-origin with the calling page (Origin header). */
function validReturnUrl(returnUrl: unknown, origin: string | null): returnUrl is string {
  if (typeof returnUrl !== 'string' || !origin) return false;
  return returnUrl === origin || returnUrl.startsWith(`${origin}/`);
}

function withParam(url: string, key: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return json(503, { error: 'billing_not_configured' });
  // Refuse checkout on a non-live key: test-card sessions would otherwise mint
  // real entitlements via the webhook. ALLOW_TEST_BILLING='true' opts back in
  // for deliberate sandbox end-to-end testing.
  if (!stripeKey.startsWith('sk_live_') && Deno.env.get('ALLOW_TEST_BILLING') !== 'true') {
    console.warn('[stripe-checkout] refused: STRIPE_SECRET_KEY is not sk_live_ and ALLOW_TEST_BILLING is not "true"');
    return json(503, { error: 'billing_test_mode' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  try {
    // 1. Auth — resolve the caller from their JWT (user-scoped client).
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

    // 2. Validate body shape + returnUrl (must start with the request Origin).
    const { kind, returnUrl } = body;
    const origin = req.headers.get('Origin');
    if (!validReturnUrl(returnUrl, origin)) return json(400, { error: 'invalid_return_url' });

    const sb = serviceClient();

    // 3. Resolve the org this purchase belongs to + verify membership.
    let orgId: string;
    let eventUuid: string | null = null;

    if (kind === 'event_package') {
      const tier = body.tier;
      if (typeof tier !== 'string' || !(tier in PRICES.event_package)) {
        return json(400, { error: 'invalid_body' });
      }
      if (typeof body.eventUuid !== 'string') return json(400, { error: 'invalid_body' });
      eventUuid = body.eventUuid;
      const { data: event, error: evErr } = await sb
        .from('events')
        .select('id, org_id')
        .eq('id', eventUuid)
        .maybeSingle();
      if (evErr) throw evErr;
      if (!event) return json(404, { error: 'event_not_found' });
      orgId = event.org_id as string;
      const { data: member, error: memErr } = await sb
        .from('org_members')
        .select('org_id')
        .eq('org_id', orgId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (memErr) throw memErr;
      if (!member) return json(403, { error: 'forbidden' });
    } else if (kind === 'credit_pack' || kind === 'pro_subscription') {
      if (kind === 'credit_pack') {
        const pack = body.pack;
        if (typeof pack !== 'string' || !(pack in PRICES.credit_pack)) {
          return json(400, { error: 'invalid_body' });
        }
      }
      const { data: member, error: memErr } = await sb
        .from('org_members')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (memErr) throw memErr;
      if (!member) return json(403, { error: 'forbidden' });
      orgId = member.org_id as string;
    } else {
      return json(400, { error: 'invalid_body' });
    }

    // 4. Ensure the org has a Stripe customer.
    const { data: org, error: orgErr } = await sb
      .from('orgs')
      .select('id, name, stripe_customer_id')
      .eq('id', orgId)
      .single();
    if (orgErr || !org) throw orgErr ?? new Error('org_not_found');

    let customerId = org.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripePost(stripeKey, '/v1/customers', {
        name: (org.name as string) ?? '',
        ...(user.email ? { email: user.email } : {}),
        'metadata[org_id]': orgId,
      });
      customerId = customer.id as string;
      const { error: updErr } = await sb
        .from('orgs')
        .update({ stripe_customer_id: customerId })
        .eq('id', orgId);
      if (updErr) throw updErr;
    }

    // 5. Create the Checkout Session (inline price_data — no products needed).
    const params: Record<string, string> = {
      customer: customerId,
      success_url: withParam(returnUrl, 'checkout', 'success'),
      cancel_url: withParam(returnUrl, 'checkout', 'cancelled'),
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'metadata[org_id]': orgId,
      'metadata[kind]': kind,
    };

    if (kind === 'event_package') {
      const tier = body.tier as keyof typeof PRICES.event_package;
      const price = PRICES.event_package[tier];
      params.mode = 'payment';
      params['line_items[0][price_data][unit_amount]'] = String(price.amount);
      params['line_items[0][price_data][product_data][name]'] = price.name;
      params['metadata[tier]'] = tier;
      params['metadata[event_uuid]'] = eventUuid!;
    } else if (kind === 'credit_pack') {
      const pack = body.pack as keyof typeof PRICES.credit_pack;
      const price = PRICES.credit_pack[pack];
      params.mode = 'payment';
      params['line_items[0][price_data][unit_amount]'] = String(price.amount);
      params['line_items[0][price_data][product_data][name]'] = price.name;
      params['metadata[pack]'] = pack;
    } else {
      params.mode = 'subscription';
      params['line_items[0][price_data][unit_amount]'] = String(PRICES.pro_subscription.amount);
      params['line_items[0][price_data][product_data][name]'] = PRICES.pro_subscription.name;
      params['line_items[0][price_data][recurring][interval]'] = 'month';
      // Also stamp the subscription object so subscription.* events carry it.
      params['subscription_data[metadata][org_id]'] = orgId;
    }

    const session = await stripePost(stripeKey, '/v1/checkout/sessions', params);
    return json(200, { url: session.url });
  } catch (err) {
    if (err instanceof Error && err.message === 'stripe_error') {
      return json(500, { error: 'stripe_error' });
    }
    console.error('[stripe-checkout] internal error', err);
    return json(500, { error: 'internal' });
  }
});
