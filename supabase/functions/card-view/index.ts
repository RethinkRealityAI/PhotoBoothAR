/**
 * card-view — public read path for a published greeting card.
 *
 * Deployed with verify_jwt ON — the shared anon key passes the gate; the
 * card's public_id (from the /c/<public_id> viewer URL) is the lookup key.
 * Only published/rendered cards resolve; media playback URLs are 1-hour
 * signed URLs from the PRIVATE 'cards' bucket (nothing else about the bucket
 * is exposed).
 *
 * POST { publicId }
 * 200 → { card: { title, recipientName, template, theme, publishedAt, eventName },
 *         contributions: [{ id, contributorName, message, mediaType,
 *                           durationSeconds, url, sortOrder }] }
 *       (approved && !hidden only, ordered by sort_order then created_at;
 *        url is null for text contributions)
 * 400 → { error: 'invalid_json' | 'invalid_body' }
 * 404 → { error: 'card_not_found' }   (missing OR not yet published)
 * 500 → { error: 'internal' }
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CARDS_BUCKET = 'cards';
const SIGNED_URL_TTL_S = 60 * 60; // 1 hour
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
    const { publicId } = body;
    if (typeof publicId !== 'string' || !UUID_RE.test(publicId)) {
      return json(400, { error: 'invalid_body' });
    }

    const sb = serviceClient();

    const { data: card, error: cardErr } = await sb
      .from('cards')
      .select('id, event_id, title, recipient_name, template, theme, status, published_at')
      .eq('public_id', publicId)
      .maybeSingle();
    if (cardErr) throw cardErr;
    // Unpublished cards are indistinguishable from missing ones on purpose.
    if (!card || (card.status !== 'published' && card.status !== 'rendered')) {
      return json(404, { error: 'card_not_found' });
    }

    const { data: event, error: evErr } = await sb
      .from('events')
      .select('name')
      .eq('slug', card.event_id as string)
      .maybeSingle();
    if (evErr) throw evErr;

    const { data: rows, error: contribErr } = await sb
      .from('card_contributions')
      .select('id, contributor_name, message, media_type, media_path, duration_seconds, sort_order')
      .eq('card_id', card.id as string)
      .eq('approved', true)
      .eq('hidden', false)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (contribErr) throw contribErr;
    const contributions = rows ?? [];

    // Batch-sign every media path (text contributions have none).
    const paths = contributions
      .map((c) => c.media_path as string | null)
      .filter((p): p is string => Boolean(p));
    const urlByPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed, error: signErr } = await sb.storage
        .from(CARDS_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_S);
      if (signErr) throw signErr;
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
      }
    }

    return json(200, {
      card: {
        title: card.title,
        recipientName: card.recipient_name,
        template: card.template,
        theme: card.theme ?? {},
        publishedAt: card.published_at,
        eventName: (event?.name as string | undefined) ?? null,
      },
      contributions: contributions.map((c) => ({
        id: c.id,
        contributorName: c.contributor_name,
        message: c.message,
        mediaType: c.media_type,
        durationSeconds: c.duration_seconds,
        url: c.media_path ? (urlByPath.get(c.media_path as string) ?? null) : null,
        sortOrder: c.sort_order,
      })),
    });
  } catch (err) {
    console.error('[card-view] internal error', err);
    return json(500, { error: 'internal' });
  }
});
