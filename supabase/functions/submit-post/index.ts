/**
 * submit-post — guest post submission for the multi-tenant platform.
 *
 * Two actions (JSON POST body):
 *   { action: 'init', eventSlug, sessionId, mediaType, contentType, ext }
 *     -> validates event is live, enforces the plan-tier post cap
 *        (403 { error: 'post_limit_reached' } when at/over), rate-limits per
 *        (event, session), and returns a signed upload URL token: { path, token }.
 *   { action: 'finalize', eventSlug, sessionId, path, mediaType, ... }
 *     -> verifies the uploaded object (tenant-scoped path, size cap) and
 *        inserts the public.posts row via service role: { post }.
 *
 * Anonymous guests never get direct write access to posts/storage; this
 * function is the only write path and enforces tenancy + quotas.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const POSTS_BUCKET = 'posts';
const QUOTA_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const QUOTA_MAX_POSTS = 30;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60MB

/** Per-event post cap by plan tier (mirror of src/lib/entitlements.ts
 *  maxPosts). premium/deluxe = unlimited (no entry). The three grandfathered
 *  legacy events are never capped (LEGACY_ENTITLEMENTS = uncapped). */
const TIER_MAX_POSTS: Record<string, number> = { free: 25, essentials: 500 };
const LEGACY_SLUGS = new Set(['hope-gala', 'jenna-jake', 'detola-wuyi']);

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
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

/** Returns the live event row, or null if missing / not live. */
async function getLiveEvent(sb: Client, eventSlug: unknown) {
  if (typeof eventSlug !== 'string' || !eventSlug) return null;
  const { data, error } = await sb
    .from('events')
    .select('id, slug, status, org_id, plan_tier')
    .eq('slug', eventSlug)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'live') return null;
  return data;
}

function asUuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function asIntOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function trimmedOrNull(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().slice(0, maxLen);
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
async function handleInit(sb: Client, body: Record<string, unknown>): Promise<Response> {
  const { eventSlug, sessionId, mediaType, contentType, ext } = body;

  const event = await getLiveEvent(sb, eventSlug);
  if (!event) return json(403, { error: 'event_not_live' });

  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return json(400, { error: 'invalid_session_id' });
  }
  if (mediaType !== 'image' && mediaType !== 'video') {
    return json(400, { error: 'invalid_media_type' });
  }
  const allowedExts = mediaType === 'image' ? IMAGE_EXTS : VIDEO_EXTS;
  if (typeof ext !== 'string' || !allowedExts.includes(ext.toLowerCase())) {
    return json(400, { error: 'invalid_ext' });
  }
  if (typeof contentType !== 'string' || !contentType.startsWith(`${mediaType}/`)) {
    return json(400, { error: 'invalid_content_type' });
  }

  // Plan-tier post cap (free 25 / essentials 500 / premium+deluxe unlimited),
  // checked BEFORE the rate-limit bump so a capped event never burns quota.
  // An active org Pro subscription lifts the cap to premium-level (unlimited),
  // matching entitlementsFor() in src/lib/entitlements.ts.
  const cap = TIER_MAX_POSTS[(event.plan_tier as string) ?? 'free'];
  if (cap !== undefined && !LEGACY_SLUGS.has(event.slug)) {
    const { count, error: countErr } = await sb
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.slug);
    if (countErr) throw countErr;
    if ((count ?? 0) >= cap) {
      const { data: sub, error: subErr } = await sb
        .from('subscriptions')
        .select('org_id')
        .eq('org_id', event.org_id as string)
        .eq('status', 'active')
        .maybeSingle();
      if (subErr) throw subErr;
      if (!sub) return json(403, { error: 'post_limit_reached' });
    }
  }

  // Quota: sliding-ish window of 1h per (event, session). Counted at INIT —
  // signed URLs are the gate to storage, so init spam can't fill the bucket
  // unmetered (a failed upload still consumes quota; acceptable).
  const { data: quota, error: quotaErr } = await sb
    .from('guest_quota')
    .select('window_start, post_count')
    .eq('event_id', event.slug)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (quotaErr) throw quotaErr;

  if (!quota) {
    const { error: insErr } = await sb
      .from('guest_quota')
      .upsert(
        { event_id: event.slug, session_id: sessionId, window_start: new Date().toISOString(), post_count: 1 },
        { onConflict: 'event_id,session_id' },
      );
    if (insErr) throw insErr;
  } else if (Date.now() - new Date(quota.window_start).getTime() > QUOTA_WINDOW_MS) {
    const { error: resetErr } = await sb
      .from('guest_quota')
      .update({ window_start: new Date().toISOString(), post_count: 1 })
      .eq('event_id', event.slug)
      .eq('session_id', sessionId);
    if (resetErr) throw resetErr;
  } else if (quota.post_count >= QUOTA_MAX_POSTS) {
    return json(429, { error: 'quota_exceeded' });
  } else {
    const { error: bumpErr } = await sb
      .from('guest_quota')
      .update({ post_count: quota.post_count + 1 })
      .eq('event_id', event.slug)
      .eq('session_id', sessionId);
    if (bumpErr) throw bumpErr;
  }

  const path = `${event.slug}/${sessionId}/${crypto.randomUUID()}.${ext.toLowerCase()}`;
  const { data: signed, error: signErr } = await sb.storage
    .from(POSTS_BUCKET)
    .createSignedUploadUrl(path);
  if (signErr || !signed) throw signErr ?? new Error('sign_failed');

  return json(200, { path: signed.path, token: signed.token });
}

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------
async function handleFinalize(sb: Client, body: Record<string, unknown>): Promise<Response> {
  const {
    eventSlug,
    sessionId,
    path,
    message,
    guestName,
    experienceId,
    challengeId,
    width,
    height,
    mediaType,
    durationMs,
  } = body;

  const event = await getLiveEvent(sb, eventSlug);
  if (!event) return json(403, { error: 'event_not_live' });

  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return json(400, { error: 'invalid_session_id' });
  }
  if (mediaType !== 'image' && mediaType !== 'video') {
    return json(400, { error: 'invalid_media_type' });
  }

  // Tenancy: the object must live under this event+session prefix — prevents
  // cross-tenant path injection via a forged `path`.
  const prefix = `${event.slug}/${sessionId}/`;
  if (typeof path !== 'string' || !path.startsWith(prefix) || path.includes('..')) {
    return json(400, { error: 'invalid_path' });
  }
  const fileName = path.slice(prefix.length);
  if (!fileName || fileName.includes('/')) {
    return json(400, { error: 'invalid_path' });
  }

  // Verify the object exists and respects the size cap.
  const { data: objects, error: listErr } = await sb.storage
    .from(POSTS_BUCKET)
    .list(`${event.slug}/${sessionId}`, { search: fileName, limit: 100 });
  if (listErr) throw listErr;
  const object = objects?.find((o) => o.name === fileName);
  if (!object) return json(400, { error: 'object_not_found' });

  const size = (object.metadata as { size?: number } | null)?.size ?? 0;
  const maxBytes = mediaType === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (size > maxBytes) {
    // Don't leave oversized uploads lying around (best-effort).
    await sb.storage.from(POSTS_BUCKET).remove([path]);
    return json(400, { error: 'object_too_large' });
  }

  const { data: pub } = sb.storage.from(POSTS_BUCKET).getPublicUrl(path);

  // 'builtin:*' experience ids (bundled experiences) are not DB rows — null them.
  const experience_id = asUuidOrNull(experienceId);
  const challenge_id = asUuidOrNull(challengeId);

  const { data: post, error: insertErr } = await sb
    .from('posts')
    .insert({
      event_id: event.slug,
      image_url: pub.publicUrl,
      media_type: mediaType,
      duration_ms: asIntOrNull(durationMs),
      message: trimmedOrNull(message, 500),
      guest_name: trimmedOrNull(guestName, 80),
      experience_id,
      challenge_id,
      session_id: sessionId,
      width: asIntOrNull(width),
      height: asIntOrNull(height),
      approved: true,
      hidden: false,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;

  // Quota is counted at init (signed-URL issuance), not here.
  return json(200, { post });
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
      case 'init':
        return await handleInit(sb, body);
      case 'finalize':
        return await handleFinalize(sb, body);
      default:
        return json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('[submit-post] internal error', err);
    return json(500, { error: 'internal' });
  }
});
