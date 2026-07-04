/**
 * stripe-portal — authenticated Stripe billing-portal session creation.
 *
 * POST { returnUrl? }   (deployed with verify_jwt ON — requires a user JWT)
 *
 * 200 → { url }                        Stripe-hosted billing portal URL
 * 400 → { error: 'invalid_json' | 'invalid_return_url' | 'no_stripe_customer' }
 * 401 → { error: 'unauthorized' }
 * 403 → { error: 'forbidden' }         caller has no org membership
 * 500 → { error: 'internal' | 'stripe_error' }
 * 503 → { error: 'billing_not_configured' }  STRIPE_SECRET_KEY not set yet
 *
 * The org must already have a Stripe customer (created on first checkout);
 * without one there is nothing to manage → 400 no_stripe_customer.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected),
 *      STRIPE_SECRET_KEY (secret — absent until keys are provisioned).
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return json(503, { error: 'billing_not_configured' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  try {
    // 1. Auth.
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

    // 2. returnUrl — optional; when present it must be same-origin.
    const origin = req.headers.get('Origin');
    let returnUrl = origin ? `${origin}/host/billing` : '';
    if (body.returnUrl !== undefined && body.returnUrl !== null && body.returnUrl !== '') {
      if (
        typeof body.returnUrl !== 'string' ||
        !origin ||
        !(body.returnUrl === origin || body.returnUrl.startsWith(`${origin}/`))
      ) {
        return json(400, { error: 'invalid_return_url' });
      }
      returnUrl = body.returnUrl;
    }
    if (!returnUrl) return json(400, { error: 'invalid_return_url' });

    // 3. Caller's org → its Stripe customer.
    const sb = serviceClient();
    const { data: member, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) return json(403, { error: 'forbidden' });

    const { data: org, error: orgErr } = await sb
      .from('orgs')
      .select('stripe_customer_id')
      .eq('id', member.org_id)
      .single();
    if (orgErr || !org) throw orgErr ?? new Error('org_not_found');
    const customerId = org.stripe_customer_id as string | null;
    if (!customerId) return json(400, { error: 'no_stripe_customer' });

    // 4. Create the billing-portal session (raw REST, form-encoded).
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ customer: customerId, return_url: returnUrl }).toString(),
    });
    const session = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      console.error('[stripe-portal] stripe error', JSON.stringify(session?.error ?? session));
      return json(500, { error: 'stripe_error' });
    }
    return json(200, { url: session.url });
  } catch (err) {
    console.error('[stripe-portal] internal error', err);
    return json(500, { error: 'internal' });
  }
});
