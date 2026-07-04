/**
 * manager-api — token-authenticated day-of staff API for the manager console.
 *
 * POST { slug, token, op, args? }
 *   (deployed with verify_jwt ON — the anon key passes it; the BODY token is
 *   the real credential, checked against event_access_tokens by sha256 hash)
 *
 * ops:
 *   list_posts                              → { data: Post[] }   (incl hidden+unapproved, newest first, limit 200)
 *   set_post_hidden   { postId, hidden }    → { data: { ok: true } }
 *   set_post_approved { postId, approved }  → { data: { ok: true } }
 *   delete_post       { postId }            → { data: { ok: true } }   (row only — parity with db.deletePost)
 *   get_wall_settings                       → { data: object | null }
 *   set_wall_settings { value }             → { data: value }    (upsert app_settings key 'wall')
 *
 * 400 → { error: 'invalid_json' | 'invalid_body' | 'unknown_op' | 'invalid_args' }
 * 404 → { error: 'event_not_found' }
 * 403 → { error: 'bad_token' }
 * 500 → { error: 'internal' }
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function asPostId(args: Record<string, unknown>): string | null {
  const id = args.postId;
  return typeof id === 'string' && UUID_RE.test(id) ? id : null;
}

async function handleOp(
  sb: Client,
  event: { id: string; slug: string },
  op: string,
  args: Record<string, unknown>,
): Promise<Response> {
  // All post/settings tables key on the event SLUG (text event_id).
  const eventKey = event.slug;

  switch (op) {
    case 'list_posts': {
      const { data, error } = await sb
        .from('posts')
        .select('*')
        .eq('event_id', eventKey)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return json(200, { data: data ?? [] });
    }

    case 'set_post_hidden': {
      const postId = asPostId(args);
      if (!postId || typeof args.hidden !== 'boolean') return json(400, { error: 'invalid_args' });
      const { error } = await sb
        .from('posts')
        .update({ hidden: args.hidden })
        .eq('id', postId)
        .eq('event_id', eventKey);
      if (error) throw error;
      return json(200, { data: { ok: true } });
    }

    case 'set_post_approved': {
      const postId = asPostId(args);
      if (!postId || typeof args.approved !== 'boolean') return json(400, { error: 'invalid_args' });
      const { error } = await sb
        .from('posts')
        .update({ approved: args.approved })
        .eq('id', postId)
        .eq('event_id', eventKey);
      if (error) throw error;
      return json(200, { data: { ok: true } });
    }

    case 'delete_post': {
      const postId = asPostId(args);
      if (!postId) return json(400, { error: 'invalid_args' });
      // Row only — parity with db.deletePost (storage object left behind).
      const { error } = await sb
        .from('posts')
        .delete()
        .eq('id', postId)
        .eq('event_id', eventKey);
      if (error) throw error;
      return json(200, { data: { ok: true } });
    }

    case 'get_wall_settings': {
      const { data, error } = await sb
        .from('app_settings')
        .select('value')
        .eq('key', 'wall')
        .eq('event_id', eventKey)
        .maybeSingle();
      if (error) throw error;
      return json(200, { data: data?.value ?? null });
    }

    case 'set_wall_settings': {
      const value = args.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return json(400, { error: 'invalid_args' });
      }
      // Client sends the full merged settings object; upsert as-is.
      const { error } = await sb
        .from('app_settings')
        .upsert(
          { event_id: eventKey, key: 'wall', value, updated_at: new Date().toISOString() },
          { onConflict: 'event_id,key' },
        );
      if (error) throw error;
      return json(200, { data: value });
    }

    default:
      return json(400, { error: 'unknown_op' });
  }
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
    const { slug, token, op } = body;
    if (
      typeof slug !== 'string' || !slug ||
      typeof token !== 'string' || token.length < 6 ||
      typeof op !== 'string' || !op
    ) {
      return json(400, { error: 'invalid_body' });
    }
    const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args)
      ? body.args
      : {}) as Record<string, unknown>;

    const sb = serviceClient();

    const { data: event, error: evErr } = await sb
      .from('events')
      .select('id, slug')
      .eq('slug', slug)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) return json(404, { error: 'event_not_found' });

    // Token check — hashes only; expired tokens are rejected.
    const hash = await sha256Hex(token);
    const { data: tokenRow, error: tokErr } = await sb
      .from('event_access_tokens')
      .select('id, expires_at')
      .eq('event_id', event.id)
      .eq('token_hash', hash)
      .maybeSingle();
    if (tokErr) throw tokErr;
    if (!tokenRow) return json(403, { error: 'bad_token' });
    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return json(403, { error: 'bad_token' });
    }

    return await handleOp(sb, event as { id: string; slug: string }, op, args);
  } catch (err) {
    console.error('[manager-api] internal error', err);
    return json(500, { error: 'internal' });
  }
});
