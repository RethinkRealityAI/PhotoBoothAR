/**
 * provider-keys — bring-your-own provider credentials, per org, per provider.
 *
 * POST (deployed with verify_jwt ON — a real user JWT is required; there is no
 *       anonymous path here at all)
 *   { action: 'set' | 'clear' | 'status',
 *     provider?: 'higgsfield',   (default 'higgsfield')
 *     orgId?: string,            (omitted → the caller's own org, when they
 *                                 belong to exactly one)
 *     keyId?: string,            ('set' only)
 *     keySecret?: string }       ('set' only)
 *
 *   Fields may arrive flat or nested under `args` — src/lib/providerKeys.ts
 *   uses the house `{ action, args }` convention that admin-api/support-api
 *   share, and both shapes are read below so neither half can drift.
 *
 * 200 → { data: { configured, keyIdMasked, platformAvailable, status? } }
 *       The SAME payload for all three actions, so the client re-renders from
 *       one decoder (normalizeProviderKeyStatus).
 * 400 → { error: 'invalid_json' | 'invalid_body' | 'unknown_action' }
 * 401 → { error: 'unauthorized' }
 * 403 → { error: 'forbidden' }
 * 405 → { error: 'method_not_allowed' }
 * 500 → { error: 'internal' }
 *
 * THE SECRET TRAVELS ONE WAY. `public.org_provider_keys` (migration 030) has
 * RLS enabled with NO policies, so anon and authenticated cannot read it at
 * all; this function on the service role is its only reader, and `key_secret`
 * is never SELECTed here, never logged, and never in a response. What comes
 * back is whether a key exists plus a masked id.
 *
 * WHY A DEDICATED FUNCTION and not an admin-api action: this is a CUSTOMER
 * capability (a host installs their own key), and admin-api is
 * is_platform_admin-gated by construction. Authorization here is org
 * membership, resolved exactly the way ai-generate-image resolves it — JWT →
 * user, then a service-role org_members assert.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected).
 *      HIGGSFIELD_API_KEY | (HIGGSFIELD_API_KEY_ID + HIGGSFIELD_API_SECRET) —
 *      read ONLY to answer `platformAvailable`, i.e. "can this host generate
 *      without bringing a key of their own". Their values never leave here.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Providers a host may bring their own credentials for. Mirrors the CHECK
 *  constraint on org_provider_keys.provider (migration 030) and the ProviderId
 *  union in src/lib/providerKeysModel.ts. */
const PROVIDERS = new Set(['higgsfield']);

/** Longest key half we will store. Mirrors KEY_FIELD_MAX in
 *  src/lib/providerKeysModel.ts — past this the paste is a file or a page. */
const KEY_FIELD_MAX = 200;

/** How many leading/trailing characters of a key id stay visible in the mask.
 *  MIRROR of maskKeyId in src/lib/providerKeysModel.ts: the client paints an
 *  optimistic mask before the round trip, so the two must produce the same
 *  string or the field visibly changes under the host after a refetch. */
const MASK_VISIBLE = 4;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Success envelope — `{ data }`, the shape admin-api/support-api/manager-api
 *  all use and src/lib/providerKeys.ts unwraps. */
function ok(body: unknown): Response {
  return json(200, { data: body });
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

type Client = ReturnType<typeof serviceClient>;

/** Mask a key id for display. Short ids are masked ENTIRELY — showing 4 of 6
 *  characters is not a mask. Longer ones keep the first and last 4 with a
 *  fixed-width middle, so the mask does not leak the length either. */
function maskKeyId(keyId: string): string {
  const s = keyId.trim();
  if (!s) return '';
  if (s.length <= MASK_VISIBLE * 2) return '•'.repeat(s.length);
  return `${s.slice(0, MASK_VISIBLE)}${'•'.repeat(8)}${s.slice(-MASK_VISIBLE)}`;
}

/** Read a secret/env value the way ai-generate-image reads GEMINI_API_KEY:
 *  dashboard-set values arrive quoted or newline-terminated often enough that
 *  not stripping them reads as "no key configured". Empty → null. */
function secretEnv(name: string): string | null {
  const raw = Deno.env.get(name)?.trim().replace(/^["']|["']$/g, '').trim();
  return raw ? raw : null;
}

/**
 * Does the PLATFORM hold credentials for this provider? Only a boolean ever
 * leaves this function. MIRROR of platformHiggsfieldCreds in
 * ai-generate-image/index.ts — the two must agree, because this boolean is what
 * tells a host "you can generate without a key of your own" and that function
 * is what would then actually charge them credits.
 */
function platformAvailable(provider: string): boolean {
  if (provider !== 'higgsfield') return false;
  const combined = secretEnv('HIGGSFIELD_API_KEY');
  if (combined) {
    const sep = combined.indexOf(':');
    if (sep > 0 && combined.slice(0, sep).trim() && combined.slice(sep + 1).trim()) return true;
  }
  return secretEnv('HIGGSFIELD_API_KEY_ID') !== null && secretEnv('HIGGSFIELD_API_SECRET') !== null;
}

/**
 * Validate one half of a key pair. Returns the trimmed value, or null.
 *
 * WHITESPACE IS REJECTED, not stripped, and that is a security decision rather
 * than tidiness: these values are interpolated into an outbound
 * `Authorization: Key <id>:<secret>` header by ai-generate-image, so a stored
 * CR/LF would be header injection into the provider request. A wrapped
 * copy-paste is also by far the most common way a key arrives broken, so
 * refusing it gives the host a real answer instead of a mystery 401 later.
 */
function keyHalf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > KEY_FIELD_MAX) return null;
  if (/\s/.test(s)) return null;
  return s;
}

/** The status payload — the ONLY shape this function returns on success. */
async function statusPayload(sb: Client, orgId: string, provider: string): Promise<Response> {
  // key_secret is deliberately NOT in this select. Nothing in this function
  // ever reads it; the generation path is the only reader that needs it.
  const { data, error } = await sb
    .from('org_provider_keys')
    .select('key_id, status')
    .eq('org_id', orgId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw error;

  const keyId = typeof data?.key_id === 'string' ? data.key_id : '';
  const configured = keyId !== '';
  return ok({
    configured,
    keyIdMasked: configured ? maskKeyId(keyId) : null,
    platformAvailable: platformAvailable(provider),
    ...(configured && typeof data?.status === 'string' ? { status: data.status } : {}),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  try {
    // Accept both `{ action, args: {...} }` (the house convention the client
    // uses) and a flat body. Nested wins where both carry a field.
    const nested = (body.args !== null && typeof body.args === 'object' && !Array.isArray(body.args))
      ? body.args as Record<string, unknown>
      : {};
    const args: Record<string, unknown> = { ...body, ...nested };

    const action = typeof args.action === 'string' ? args.action : '';
    if (action !== 'set' && action !== 'clear' && action !== 'status') {
      return json(400, { error: 'unknown_action' });
    }

    const provider = typeof args.provider === 'string' && args.provider ? args.provider : 'higgsfield';
    if (!PROVIDERS.has(provider)) return json(400, { error: 'invalid_body' });

    // 1. Auth — resolve the caller from their JWT (ai-generate-image's pattern).
    //    There is no anonymous path: a missing header is an immediate 401.
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

    // 2. Authorization — org membership, asserted on the SERVICE role.
    //    orgId is optional: the client omits it for "my org", which is the
    //    normal case. Resolved from membership then, and only accepted when it
    //    is unambiguous — guessing which of several orgs a key belongs to would
    //    install a credential against the wrong customer's billing.
    let orgId: string;
    const requestedOrg = typeof args.orgId === 'string' ? args.orgId.trim() : '';
    if (requestedOrg) {
      if (!UUID_RE.test(requestedOrg)) return json(400, { error: 'invalid_body' });
      const { data: member, error: memErr } = await sb
        .from('org_members')
        .select('org_id')
        .eq('org_id', requestedOrg)
        .eq('user_id', user.id)
        .maybeSingle();
      if (memErr) throw memErr;
      if (!member) return json(403, { error: 'forbidden' });
      orgId = requestedOrg;
    } else {
      const { data: mine, error: mineErr } = await sb
        .from('org_members')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(2);
      if (mineErr) throw mineErr;
      const rows = (mine ?? []) as { org_id: string }[];
      if (rows.length === 0) return json(403, { error: 'forbidden' });
      if (rows.length > 1) return json(400, { error: 'invalid_body' });
      orgId = rows[0].org_id;
    }

    // 3. Dispatch.
    if (action === 'status') return await statusPayload(sb, orgId, provider);

    if (action === 'set') {
      const keyId = keyHalf(args.keyId);
      const keySecret = keyHalf(args.keySecret);
      if (!keyId || !keySecret) return json(400, { error: 'invalid_body' });
      // Upsert on the (org_id, provider) primary key: re-pasting a rotated key
      // must replace the old one, not fail on a conflict. status resets to
      // 'unverified' because nothing has called the provider with THIS pair.
      const { error: upErr } = await sb
        .from('org_provider_keys')
        .upsert({
          org_id: orgId,
          provider,
          key_id: keyId,
          key_secret: keySecret,
          status: 'unverified',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'org_id,provider' });
      if (upErr) throw upErr;
      // Read back through the same path the client polls, so a successful save
      // and a later refetch can never disagree. (The secret is not in it.)
      return await statusPayload(sb, orgId, provider);
    }

    // clear — deleting a key that is not there is a success, not a 404: the
    // caller's intent ("no BYO key on this org") is satisfied either way.
    const { error: delErr } = await sb
      .from('org_provider_keys')
      .delete()
      .eq('org_id', orgId)
      .eq('provider', provider);
    if (delErr) throw delErr;
    return await statusPayload(sb, orgId, provider);
  } catch (err) {
    // Never echo the error body: a Postgres error on this table can quote the
    // row, and that row contains the secret.
    console.error('[provider-keys] internal error', err instanceof Error ? err.message : 'unknown');
    return json(500, { error: 'internal' });
  }
});
