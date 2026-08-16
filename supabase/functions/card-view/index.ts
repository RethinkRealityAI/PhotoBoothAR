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
 * 200 → { card: { title, recipientName, template, theme, publishedAt, eventName,
 *                 filmUrl? },
 *         contributions: [{ id, contributorName, message, mediaType,
 *                           durationSeconds, url, sortOrder }] }
 *       (approved && !hidden only, ordered by sort_order then created_at;
 *        url is null for text contributions)
 *       `filmUrl` is a 1h signed MP4 of the keepsake film, present ONLY for a
 *       'rendered' card that has a finished render — it is how the RECIPIENT
 *       gets the deluxe film (the private 'renders' bucket has no member or
 *       anon read policy, so only a service-role signature can reach it). The
 *       key is omitted whenever there is no film or signing fails: a card must
 *       never fail to open because of its film.
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
const RENDERS_BUCKET = 'renders';
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

type Client = ReturnType<typeof serviceClient>;

/**
 * The recipient's copy of the keepsake film: the newest FINISHED render for
 * this card, signed for an hour. Mirrors card-render-status's signing (same
 * private bucket, same TTL) — that path is member-gated, this one rides the
 * card's public_id, which is the link the recipient was given.
 *
 * EVERY failure returns null on purpose: no render row, no output_path, a
 * query error, a signing error. The card itself must open regardless.
 */
async function latestFilmUrl(sb: Client, cardId: string): Promise<string | null> {
  try {
    const { data, error } = await sb
      .from('card_renders')
      .select('output_path')
      .eq('card_id', cardId)
      .eq('status', 'done')
      .not('output_path', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('[card-view] film lookup failed', error);
      return null;
    }
    const path = (data?.output_path as string | null) ?? null;
    if (!path) return null;

    const { data: signed, error: signErr } = await sb.storage
      .from(RENDERS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_S);
    if (signErr) {
      console.warn('[card-view] sign film failed', signErr);
      return null;
    }
    return signed?.signedUrl ?? null;
  } catch (e) {
    console.warn('[card-view] film unavailable', e);
    return null;
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

    // Only a 'rendered' card can have a finished film; every other status
    // skips the lookup entirely and the response stays byte-identical.
    const filmUrl =
      card.status === 'rendered' ? await latestFilmUrl(sb, card.id as string) : null;

    return json(200, {
      card: {
        title: card.title,
        recipientName: card.recipient_name,
        template: card.template,
        theme: card.theme ?? {},
        publishedAt: card.published_at,
        eventName: (event?.name as string | undefined) ?? null,
        ...(filmUrl ? { filmUrl } : {}),
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
