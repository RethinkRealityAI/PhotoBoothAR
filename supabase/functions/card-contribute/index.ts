/**
 * card-contribute — guest contribution flow for greeting cards.
 *
 * Deployed with verify_jwt ON — the shared anon key passes the gate; the
 * card's contribute_token (uuid, from the host's share link) is the REAL
 * credential for every action. Mirrors submit-post's two-step signed-URL
 * upload into the PRIVATE 'cards' bucket.
 *
 * Three actions (JSON POST body):
 *   { action: 'meta', token }  (or { action: 'meta', publicId } for read-only)
 *     -> public metadata for the contribute page:
 *        { card: { title, recipientName, eventName, deadline, status, template } }
 *   { action: 'init', token, sessionId, mediaType: 'photo'|'video', contentType, ext }
 *     -> validates the card is collecting (status + deadline), the ext /
 *        content type, and the per-session quota (10 contributions per hour
 *        per card), then returns a signed upload URL: { path, token }.
 *   { action: 'finalize', token, sessionId, path?, contributorName?, message?,
 *     mediaType, durationSeconds?, textOnly? }
 *     -> media: verifies the uploaded object (card-scoped path, size cap:
 *        photo 8MB / video 60MB) and inserts the card_contributions row.
 *        text-only (textOnly: true or mediaType 'text'): message required
 *        (≤600 chars), no media object.
 *        -> { contribution: { id, contributorName, mediaType } }  (no paths)
 *
 * Errors: 400 invalid_json/unknown_action/invalid_body/invalid_session_id/
 *             invalid_media_type/invalid_ext/invalid_content_type/invalid_path/
 *             object_not_found/object_too_large/message_required
 *         403 card_closed | deadline_passed
 *         404 card_not_found
 *         429 quota_exceeded | card_full
 *         500 internal
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CARDS_BUCKET = 'cards';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60MB
const QUOTA_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const QUOTA_MAX_CONTRIBUTIONS = 10; // per (card, session) per window
// Hard per-card ceiling across ALL sessions — a cost/abuse backstop. The
// per-(card,session) window above is bypassable by rotating the client-chosen
// sessionId, so this bounds the worst-case total contributions per card.
const CARD_MAX_CONTRIBUTIONS = 500;
const MESSAGE_MAX = 600;
const NAME_MAX = 80;

const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_EXTS = ['webm', 'mp4'];
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
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

interface CardRow {
  id: string;
  event_id: string;
  status: string;
  title: string;
  recipient_name: string | null;
  template: string;
  contribution_deadline: string | null;
}

const CARD_COLUMNS = 'id, event_id, status, title, recipient_name, template, contribution_deadline';

async function getCardByToken(sb: Client, token: unknown): Promise<CardRow | null> {
  if (typeof token !== 'string' || !UUID_RE.test(token)) return null;
  const { data, error } = await sb
    .from('cards')
    .select(CARD_COLUMNS)
    .eq('contribute_token', token)
    .maybeSingle();
  if (error) throw error;
  return (data as CardRow | null) ?? null;
}

async function getCardByPublicId(sb: Client, publicId: unknown): Promise<CardRow | null> {
  if (typeof publicId !== 'string' || !UUID_RE.test(publicId)) return null;
  const { data, error } = await sb
    .from('cards')
    .select(CARD_COLUMNS)
    .eq('public_id', publicId)
    .maybeSingle();
  if (error) throw error;
  return (data as CardRow | null) ?? null;
}

function deadlinePassed(card: CardRow): boolean {
  return Boolean(
    card.contribution_deadline && Date.now() > new Date(card.contribution_deadline).getTime(),
  );
}

/** Non-null when the card can't accept contributions right now. */
function collectingGate(card: CardRow): Response | null {
  if (card.status !== 'collecting') return json(403, { error: 'card_closed' });
  if (deadlinePassed(card)) return json(403, { error: 'deadline_passed' });
  return null;
}

async function eventName(sb: Client, slug: string): Promise<string | null> {
  const { data, error } = await sb.from('events').select('name').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return (data?.name as string | undefined) ?? null;
}

/** Contributions inserted by this session in the last hour (quota basis). */
async function recentContributionCount(sb: Client, cardId: string, sessionId: string): Promise<number> {
  const since = new Date(Date.now() - QUOTA_WINDOW_MS).toISOString();
  const { count, error } = await sb
    .from('card_contributions')
    .select('id', { count: 'exact', head: true })
    .eq('card_id', cardId)
    .eq('session_id', sessionId)
    .gte('created_at', since);
  if (error) throw error;
  return count ?? 0;
}

async function totalContributionCount(sb: Client, cardId: string): Promise<number> {
  const { count, error } = await sb
    .from('card_contributions')
    .select('id', { count: 'exact', head: true })
    .eq('card_id', cardId);
  if (error) throw error;
  return count ?? 0;
}

function trimmedOrNull(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().slice(0, maxLen);
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------
async function handleMeta(sb: Client, body: Record<string, unknown>): Promise<Response> {
  const card = body.token !== undefined
    ? await getCardByToken(sb, body.token)
    : await getCardByPublicId(sb, body.publicId);
  if (!card) return json(404, { error: 'card_not_found' });

  return json(200, {
    card: {
      title: card.title,
      recipientName: card.recipient_name,
      eventName: await eventName(sb, card.event_id),
      deadline: card.contribution_deadline,
      // Surface an already-passed deadline as closed so the page needs no clock math.
      status: card.status === 'collecting' && deadlinePassed(card) ? 'closed' : card.status,
      template: card.template,
    },
  });
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
async function handleInit(sb: Client, body: Record<string, unknown>): Promise<Response> {
  const { token, sessionId, mediaType, contentType, ext } = body;

  const card = await getCardByToken(sb, token);
  if (!card) return json(404, { error: 'card_not_found' });
  const gate = collectingGate(card);
  if (gate) return gate;

  // Hard per-card ceiling (sessionId-rotation quota bypass backstop).
  if ((await totalContributionCount(sb, card.id)) >= CARD_MAX_CONTRIBUTIONS) {
    return json(429, { error: 'card_full' });
  }

  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return json(400, { error: 'invalid_session_id' });
  }
  if (mediaType !== 'photo' && mediaType !== 'video') {
    return json(400, { error: 'invalid_media_type' });
  }
  const allowedExts = mediaType === 'photo' ? PHOTO_EXTS : VIDEO_EXTS;
  if (typeof ext !== 'string' || !allowedExts.includes(ext.toLowerCase())) {
    return json(400, { error: 'invalid_ext' });
  }
  const wantPrefix = mediaType === 'photo' ? 'image/' : 'video/';
  if (typeof contentType !== 'string' || !contentType.startsWith(wantPrefix)) {
    return json(400, { error: 'invalid_content_type' });
  }

  // Quota: simple count of this session's contributions in the last hour.
  // (guest_quota can't be reused — its event_id FKs events.slug, not cards.)
  if ((await recentContributionCount(sb, card.id, sessionId)) >= QUOTA_MAX_CONTRIBUTIONS) {
    return json(429, { error: 'quota_exceeded' });
  }

  const path = `${card.event_id}/${card.id}/${crypto.randomUUID()}.${ext.toLowerCase()}`;
  const { data: signed, error: signErr } = await sb.storage
    .from(CARDS_BUCKET)
    .createSignedUploadUrl(path);
  if (signErr || !signed) throw signErr ?? new Error('sign_failed');

  return json(200, { path: signed.path, token: signed.token });
}

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------
async function handleFinalize(sb: Client, body: Record<string, unknown>): Promise<Response> {
  const { token, sessionId, path, contributorName, message, durationSeconds } = body;
  const textOnly = body.textOnly === true || body.mediaType === 'text';
  const mediaType = textOnly ? 'text' : body.mediaType;

  const card = await getCardByToken(sb, token);
  if (!card) return json(404, { error: 'card_not_found' });
  const gate = collectingGate(card);
  if (gate) return gate;

  // Hard per-card ceiling (sessionId-rotation quota bypass backstop) — enforced
  // on both media and text-only finalize paths.
  if ((await totalContributionCount(sb, card.id)) >= CARD_MAX_CONTRIBUTIONS) {
    return json(429, { error: 'card_full' });
  }

  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return json(400, { error: 'invalid_session_id' });
  }
  if (mediaType !== 'photo' && mediaType !== 'video' && mediaType !== 'text') {
    return json(400, { error: 'invalid_media_type' });
  }

  const cleanMessage = trimmedOrNull(message, MESSAGE_MAX);
  if (mediaType === 'text' && !cleanMessage) {
    return json(400, { error: 'message_required' });
  }

  // Rows are what count against the quota — re-check here so the text-only
  // path (which never calls init) is metered too.
  const overQuota =
    (await recentContributionCount(sb, card.id, sessionId)) >= QUOTA_MAX_CONTRIBUTIONS;

  let mediaPath: string | null = null;
  if (mediaType !== 'text') {
    // Tenancy: the object must live under this card's prefix — prevents
    // cross-card path injection via a forged `path`.
    const prefix = `${card.event_id}/${card.id}/`;
    if (typeof path !== 'string' || !path.startsWith(prefix) || path.includes('..')) {
      return json(400, { error: 'invalid_path' });
    }
    const fileName = path.slice(prefix.length);
    if (!fileName || fileName.includes('/')) {
      return json(400, { error: 'invalid_path' });
    }

    if (overQuota) {
      await sb.storage.from(CARDS_BUCKET).remove([path]); // best-effort cleanup
      return json(429, { error: 'quota_exceeded' });
    }

    // Verify the object exists and respects the size cap (submit-post pattern).
    const { data: objects, error: listErr } = await sb.storage
      .from(CARDS_BUCKET)
      .list(`${card.event_id}/${card.id}`, { search: fileName, limit: 100 });
    if (listErr) throw listErr;
    const object = objects?.find((o) => o.name === fileName);
    if (!object) return json(400, { error: 'object_not_found' });

    const size = (object.metadata as { size?: number } | null)?.size ?? 0;
    const maxBytes = mediaType === 'photo' ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
    if (size > maxBytes) {
      await sb.storage.from(CARDS_BUCKET).remove([path]); // best-effort cleanup
      return json(400, { error: 'object_too_large' });
    }
    mediaPath = path;
  } else if (overQuota) {
    return json(429, { error: 'quota_exceeded' });
  }

  let duration: number | null = null;
  if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)) {
    duration = Math.max(0, Math.min(600, durationSeconds));
  }

  // Append at the end of the current order (host reorders overwrite this).
  // Accepted TOCTOU: both the per-session count re-check above and this
  // read-then-write of sort_order can race under concurrent finalizes —
  // acceptable for abuse-control/ordering (the host reorders anyway), and the
  // hard per-card ceiling bounds the worst case.
  const sortOrder = await totalContributionCount(sb, card.id);

  const { data: contribution, error: insertErr } = await sb
    .from('card_contributions')
    .insert({
      card_id: card.id,
      contributor_name: trimmedOrNull(contributorName, NAME_MAX),
      message: cleanMessage,
      media_type: mediaType,
      media_path: mediaPath,
      duration_seconds: duration,
      sort_order: sortOrder,
      approved: true,
      hidden: false,
      session_id: sessionId,
    })
    .select('id, contributor_name, media_type')
    .single();
  if (insertErr) throw insertErr;

  // Don't echo storage paths back to guests.
  return json(200, {
    contribution: {
      id: contribution.id,
      contributorName: contribution.contributor_name,
      mediaType: contribution.media_type,
    },
  });
}

// ---------------------------------------------------------------------------
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
    const sb = serviceClient();
    switch (body.action) {
      case 'meta':
        return await handleMeta(sb, body);
      case 'init':
        return await handleInit(sb, body);
      case 'finalize':
        return await handleFinalize(sb, body);
      default:
        return json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('[card-contribute] internal error', err);
    return json(500, { error: 'internal' });
  }
});
