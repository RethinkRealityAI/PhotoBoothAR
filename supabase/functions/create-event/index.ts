/**
 * create-event — authenticated event creation for the self-serve host studio.
 *
 * POST { orgName?, eventName, slug, eventType?, startsAt? }
 *   (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *
 * 200 → { event, orgId }        event = full inserted events row
 * 400 → { error: 'invalid_json' | 'invalid_body' | 'invalid_slug' | 'reserved_slug' }
 * 401 → { error: 'unauthorized' }
 * 409 → { error: 'slug_taken' }
 * 500 → { error: 'internal' }
 *
 * Flow: resolve the caller's user → validate name/slug → ensure the user has
 * an org (creating one + signup credit grant when needed) → insert the draft
 * event. All writes run with the service role; membership comes from the
 * caller's verified JWT, never from the body.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Route words / platform names, plus the three coded legacy slugs (they
 *  resolve from the code registry, not the events table, so the taken-check
 *  below would miss them). Keep in sync with src/lib/slug.ts. */
const RESERVED_SLUGS = new Set([
  'admin', 'host', 'login', 'signup', 'api', 'e', 'c', 'm', 'app', 'www',
  'assets', 'posts', 'wall', 'booth', 'upload', 'me', 'gallery', 'join',
  'experience', 'beamwall', 'legal', 'pricing', 'help', 'about',
  // Coded legacy events
  'hope-gala', 'jenna-jake', 'detola-wuyi',
  // The platform's own demo/sandbox event (src/lib/host.ts DEMO_EVENT_SLUG) —
  // must stay reserved so no customer event can ever claim this slug and get
  // surfaced by the SHOW_DEMO_EVENT showcase toggle.
  'demo',
]);

const EVENT_TYPES = new Set(['wedding', 'gala', 'birthday', 'party', 'remote']);
const SIGNUP_CREDITS = 10;

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
    // 1. Auth — resolve the caller from their JWT (user-scoped client).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'unauthorized' });
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json(401, { error: 'unauthorized' });

    // 2. Validate body.
    const { orgName, eventName, slug, eventType, startsAt } = body;
    if (typeof eventName !== 'string' || !eventName.trim() || eventName.trim().length > 80) {
      return json(400, { error: 'invalid_body' });
    }
    const name = eventName.trim();

    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
      return json(400, { error: 'invalid_slug' });
    }
    if (RESERVED_SLUGS.has(slug)) {
      return json(400, { error: 'reserved_slug' });
    }

    let event_type = 'wedding';
    if (eventType !== undefined && eventType !== null) {
      if (typeof eventType !== 'string' || !EVENT_TYPES.has(eventType)) {
        return json(400, { error: 'invalid_body' });
      }
      event_type = eventType;
    }

    let starts_at: string | null = null;
    if (startsAt !== undefined && startsAt !== null && startsAt !== '') {
      if (typeof startsAt !== 'string' || Number.isNaN(Date.parse(startsAt))) {
        return json(400, { error: 'invalid_body' });
      }
      starts_at = new Date(startsAt).toISOString();
    }

    const sb = serviceClient();

    // Taken-check (covers DB slugs; legacy coded slugs are in the reserved set).
    const { data: existing, error: existErr } = await sb
      .from('events')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (existErr) throw existErr;
    if (existing) return json(409, { error: 'slug_taken' });

    // 3. Org — reuse the caller's membership, else create one + signup grant.
    let orgId: string;
    const { data: membership, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (memErr) throw memErr;

    if (membership) {
      orgId = membership.org_id as string;
    } else {
      const { data: org, error: orgErr } = await sb
        .from('orgs')
        .insert({
          name: (typeof orgName === 'string' && orgName.trim()) || `${name} Events`,
          owner_id: user.id,
        })
        .select('id')
        .single();
      if (orgErr || !org) throw orgErr ?? new Error('org_insert_failed');
      orgId = org.id as string;
      // (A DB trigger enrolls the owner into org_members.)

      // Signup credit grant — idempotent on the balance row.
      const { error: balErr } = await sb
        .from('credit_balances')
        .upsert(
          { org_id: orgId, balance: SIGNUP_CREDITS },
          { onConflict: 'org_id', ignoreDuplicates: true },
        );
      if (balErr) throw balErr;
      const { error: ledgerErr } = await sb
        .from('credit_ledger')
        .insert({ org_id: orgId, delta: SIGNUP_CREDITS, reason: 'signup_grant' });
      if (ledgerErr) throw ledgerErr;
    }

    // 4. Insert the draft event.
    const { data: event, error: insErr } = await sb
      .from('events')
      .insert({
        org_id: orgId,
        slug,
        name,
        event_type,
        status: 'draft',
        config: { copy: { fullName: name } },
        starts_at,
      })
      .select()
      .single();
    if (insErr) {
      // Unique violation → a concurrent create won the slug race.
      if ((insErr as { code?: string }).code === '23505') {
        return json(409, { error: 'slug_taken' });
      }
      throw insErr;
    }

    return json(200, { event, orgId });
  } catch (err) {
    console.error('[create-event] internal error', err);
    return json(500, { error: 'internal' });
  }
});
