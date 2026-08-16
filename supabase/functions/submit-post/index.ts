/**
 * submit-post — guest post submission for the multi-tenant platform.
 *
 * Two actions (JSON POST body):
 *   { action: 'init', eventSlug, sessionId, mediaType, contentType, ext }
 *     -> validates event is live, enforces the plan-tier post cap
 *        (403 { error: 'post_limit_reached' } when at/over), rate-limits per
 *        (event, session) [429 quota_exceeded], per (event, IP)
 *        [429 rate_limited] and per event/day [429 event_daily_cap], and
 *        returns a signed upload URL token: { path, token }.
 *   { action: 'finalize', eventSlug, sessionId, path, mediaType, ... }
 *     -> verifies the uploaded object (tenant-scoped path, size cap) and
 *        inserts the public.posts row via service role: { post }. Honors
 *        events.config.moderation: 'pre' inserts approved=false.
 *   { action: 'delete_post', eventSlug, postId, sessionId }
 *     -> a guest removing their OWN moment: removes the storage object first,
 *        then the row: { deleted: true }. Deliberately NOT gated on the event
 *        being live — the wall closes, the right to withdraw your own photo
 *        does not.
 *
 * Anonymous guests never get direct write access to posts/storage; this
 * function is the only write path and enforces tenancy + quotas.
 *
 * SECURITY NOTE ON delete_post — READ BEFORE HARDENING ANYTHING ELSE.
 * Ownership is proved by (postId, sessionId) matching the row. That pair is NOT
 * a secret today: `posts_public_read` (migration 003) lets anon SELECT every
 * approved, non-hidden post of a public event, the wall reads `select('*')`
 * (src/lib/db.ts fetchPostsResult), the realtime payload carries the whole row,
 * and fetchLeaderboard selects session_id by name — so anyone who can see the
 * wall can read any post's session_id and delete that post. The pair is the
 * strongest proof available without a schema change, so it is what ships, and
 * the blast radius is bounded by BOTH rate buckets below. The real fix is
 * server-side and belongs in a migration: stop exposing posts.session_id to
 * anon (a column-level revoke plus a view/RPC for the wall read), or issue a
 * per-post delete token at finalize time.
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
/** Per-IP hourly cap. Deliberately well above the per-session cap: an event
 *  venue's guests usually share ONE NAT'd public IP, so this must hold a whole
 *  party, while still bounding a single abusive IP rotating session ids. */
const IP_QUOTA_MAX = 150;
/** Absolute per-event daily ceiling — applies to EVERY tier, including
 *  unlimited ones (an abuse backstop, not a plan limit). */
const EVENT_DAILY_MAX = 2000;
/** Self-deletes per (event, session) per hour. A guest clearing out a night's
 *  worth of shots stays well inside it; a loop does not. */
const DELETE_QUOTA_MAX = 30;
/** Self-deletes per (event, IP) per hour. This is the one that matters: the
 *  session bucket is keyed on the session id the CALLER supplies, so a client
 *  deleting other guests' posts would open a fresh bucket for every victim.
 *  Set above a whole family sharing a venue's NAT but far below a wall. */
const DELETE_IP_QUOTA_MAX = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60MB

/* The per-tier post cap and the legacy-slug list used to live here — the last
 * of five hand-kept mirrors of ENTITLEMENTS across the Deno functions.
 * public.resolve_features_raw (migration 028) owns them now.
 *
 * The abuse backstops below are NOT plan limits and deliberately stay local:
 * QUOTA_MAX_POSTS, IP_QUOTA_MAX, EVENT_DAILY_MAX and the byte ceilings bound
 * what one session, one venue or one event can do in an hour regardless of
 * what they paid, and no feature flag may raise them. */

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

/** Returns the event row whatever its status, or null if missing. */
async function getEventRow(sb: Client, eventSlug: unknown) {
  if (typeof eventSlug !== 'string' || !eventSlug) return null;
  const { data, error } = await sb
    .from('events')
    .select('id, slug, status, org_id, plan_tier, config')
    .eq('slug', eventSlug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Returns the live event row, or null if missing / not live. */
async function getLiveEvent(sb: Client, eventSlug: unknown) {
  const data = await getEventRow(sb, eventSlug);
  if (!data || data.status !== 'live') return null;
  return data;
}

/** First hop of x-forwarded-for (the client, per Supabase edge routing). */
function clientIp(req: Request): string {
  const first = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  return first && first.length <= 64 ? first : 'unknown';
}

/**
 * Sliding-ish window counter in guest_quota, keyed (event_id, key). Returns
 * true when the bump stayed within `max`, false when over. `key` is either a
 * raw guest session id (the original quota) or a ':'-prefixed bucket
 * ('ip:<addr>', 'day:<YYYY-MM-DD>') — SESSION_ID_RE forbids ':' so buckets can
 * never collide with real sessions. Same read-then-write pattern as before
 * (races can miscount by a hair; acceptable for abuse control).
 */
async function bumpQuota(
  sb: Client,
  eventSlug: string,
  key: string,
  windowMs: number,
  max: number,
): Promise<boolean> {
  const { data: quota, error } = await sb
    .from('guest_quota')
    .select('window_start, post_count')
    .eq('event_id', eventSlug)
    .eq('session_id', key)
    .maybeSingle();
  if (error) throw error;

  if (!quota) {
    const { error: insErr } = await sb
      .from('guest_quota')
      .upsert(
        { event_id: eventSlug, session_id: key, window_start: new Date().toISOString(), post_count: 1 },
        { onConflict: 'event_id,session_id' },
      );
    if (insErr) throw insErr;
    return true;
  }
  if (Date.now() - new Date(quota.window_start).getTime() > windowMs) {
    const { error: resetErr } = await sb
      .from('guest_quota')
      .update({ window_start: new Date().toISOString(), post_count: 1 })
      .eq('event_id', eventSlug)
      .eq('session_id', key);
    if (resetErr) throw resetErr;
    return true;
  }
  if (quota.post_count >= max) return false;
  const { error: bumpErr } = await sb
    .from('guest_quota')
    .update({ post_count: quota.post_count + 1 })
    .eq('event_id', eventSlug)
    .eq('session_id', key);
  if (bumpErr) throw bumpErr;
  return true;
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

/**
 * The posts-bucket object key a public `image_url` was built from, or null.
 *
 * MIRRORS `publicObjectPath` in src/lib/mediaUrl.ts (tested in
 * mediaUrl.test.ts) — Deno cannot import from src/, so that test file is the
 * contract both halves are written against. Same three rules: the origin is
 * matched as a literal PREFIX (an indexOf would accept
 * `https://evil.example/?u=/storage/v1/object/public/posts/…`), the query and
 * fragment are dropped, and the key is never percent-decoded (decoding could
 * only ever manufacture a traversal out of `%2e%2e`).
 */
function objectKeyForUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  const origin = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  if (!origin) return null;
  const prefix = `${origin}/storage/v1/object/public/${POSTS_BUCKET}/`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const cut = rest.search(/[?#]/);
  const key = cut === -1 ? rest : rest.slice(0, cut);
  if (!key || key.includes('..') || key.startsWith('/')) return null;
  return key;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
async function handleInit(sb: Client, body: Record<string, unknown>, ip: string): Promise<Response> {
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

  // Server-side videoEnabled gate: the free tier cannot post video (mirrors
  // entitlementsFor() in src/lib/entitlements.ts — free videoEnabled=false;
  // essentials/premium/deluxe=true). Legacy slugs, and events whose org holds
  // an active Pro subscription, are exempt (same lift as the post cap below).
  // Both gates below now read ONE resolved feature set from the database
  // (migration 028) instead of a tier constant in this file. That is what makes
  // "grant video to this one customer" from /admin/features actually work at
  // the point it matters. The resolver reproduces every rule these constants
  // encoded — free has videoEnabled false, an active org Pro raises the floor
  // to premium, and the three legacy slugs short-circuit to deluxe (uncapped).
  const { data: featuresRaw, error: featErr } = await sb.rpc('resolve_features_raw', {
    p_org: event.org_id as string,
    p_event: event.id as string,
  });
  // FAIL CLOSED. This is the guest hot path, so the temptation is to let a
  // resolver blip through — but the resolver lives in the same Postgres as the
  // insert this guards. If it cannot answer, the write was not going to land
  // either, and failing open here means an unbounded post flood on a free event.
  if (featErr) {
    console.error('[submit-post] resolve_features_raw failed', featErr);
    return json(503, { error: 'features_unavailable' });
  }
  const features = (featuresRaw ?? {}) as Record<string, unknown>;

  if (mediaType === 'video' && features.videoEnabled !== true) {
    return json(403, { error: 'video_not_allowed' });
  }

  // Plan-tier post cap (free 25 / essentials 500 / premium+deluxe unlimited),
  // checked BEFORE the rate-limit bump so a capped event never burns quota.
  // An active org Pro subscription lifts the cap to premium-level (unlimited),
  // matching entitlementsFor() in src/lib/entitlements.ts.
  // maxPosts: null means UNLIMITED, which is why this is an explicit null check
  // and not a truthiness test — 0 would be a real (if unkind) cap.
  const cap = features.maxPosts;
  if (typeof cap === 'number' && Number.isFinite(cap)) {
    const { count, error: countErr } = await sb
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.slug);
    if (countErr) throw countErr;
    if ((count ?? 0) >= cap) return json(403, { error: 'post_limit_reached' });
  }

  // Quotas: counted at INIT — signed URLs are the gate to storage, so init
  // spam can't fill the bucket unmetered (a failed upload still consumes
  // quota; acceptable). Three layers, all in guest_quota:
  //   1. per (event, session): 30/h  — the original quota, same keys as before.
  //   2. per (event, IP):     150/h  — 'ip:*' bucket; stops session-id rotation.
  //   3. per event/day:      2000/d  — 'day:*' bucket; absolute ceiling, ALL tiers.
  if (!(await bumpQuota(sb, event.slug, sessionId, QUOTA_WINDOW_MS, QUOTA_MAX_POSTS))) {
    return json(429, { error: 'quota_exceeded' });
  }
  if (!(await bumpQuota(sb, event.slug, `ip:${ip}`, QUOTA_WINDOW_MS, IP_QUOTA_MAX))) {
    return json(429, { error: 'rate_limited' });
  }
  const day = new Date().toISOString().slice(0, 10);
  if (!(await bumpQuota(sb, event.slug, `day:${day}`, DAY_MS, EVENT_DAILY_MAX))) {
    return json(429, { error: 'event_daily_cap' });
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

  // Moderation mode (events.config.moderation, migration 014): 'pre' events
  // insert unapproved — the post reaches the wall only after a host/manager
  // approves. Absent / 'post' (default) keeps today's behavior.
  const moderation = (event.config as Record<string, unknown> | null)?.['moderation'];

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
      approved: moderation !== 'pre',
      hidden: false,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;

  // Quota is counted at init (signed-URL issuance), not here.
  return json(200, { post });
}

// ---------------------------------------------------------------------------
// delete_post — a guest withdrawing their own moment
// ---------------------------------------------------------------------------
async function handleDeletePost(
  sb: Client,
  body: Record<string, unknown>,
  ip: string,
): Promise<Response> {
  const { eventSlug, postId, sessionId } = body;

  // NOT getLiveEvent: a guest must still be able to take their photo down after
  // the party ends, and an ended/archived event is exactly when they ask.
  const event = await getEventRow(sb, eventSlug);
  if (!event) return json(404, { error: 'event_not_found' });

  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return json(400, { error: 'invalid_session_id' });
  }
  if (typeof postId !== 'string' || !UUID_RE.test(postId)) {
    return json(400, { error: 'invalid_post_id' });
  }

  const { data: post, error: postErr } = await sb
    .from('posts')
    .select('id, event_id, session_id, image_url')
    .eq('id', postId)
    .eq('event_id', event.slug)
    .maybeSingle();
  if (postErr) throw postErr;
  if (!post) return json(404, { error: 'post_not_found' });

  // Ownership. `post.session_id` can be null (a legacy-era row) — null is not
  // ownership, and === would already say so, but the explicit check keeps the
  // intent readable next to a comparison the whole endpoint rests on.
  if (typeof post.session_id !== 'string' || post.session_id !== sessionId) {
    return json(403, { error: 'not_yours' });
  }

  // Metered only once ownership holds — see the header note: the session bucket
  // cannot bound a caller who supplies someone else's session id, which is what
  // the IP bucket is for.
  if (!(await bumpQuota(sb, event.slug, `del:${sessionId}`, QUOTA_WINDOW_MS, DELETE_QUOTA_MAX))) {
    return json(429, { error: 'rate_limited' });
  }
  if (!(await bumpQuota(sb, event.slug, `delip:${ip}`, QUOTA_WINDOW_MS, DELETE_IP_QUOTA_MAX))) {
    return json(429, { error: 'rate_limited' });
  }

  // Storage FIRST, row second. The other order deletes the guest's proof that
  // anything is left while the object keeps serving from a public URL — the
  // exact thing a privacy-motivated delete is asking us to remove.
  const key = objectKeyForUrl(post.image_url);
  if (key) {
    // Re-assert the shape submit-post itself wrote: `<slug>/<sessionId>/<file>`.
    // The key comes from the row, not the caller, so this is belt-and-braces —
    // but a stored URL is still data, and a remove() is not a reversible call.
    const expected = `${event.slug}/${post.session_id}/`;
    if (!key.startsWith(expected)) {
      console.error('[submit-post] delete_post: key outside its own prefix', key);
      return json(400, { error: 'invalid_path' });
    }
    const { error: rmErr } = await sb.storage.from(POSTS_BUCKET).remove([key]);
    if (rmErr) {
      // Keep the row: the moment stays visible and retryable rather than
      // vanishing from the wall while the file is still public. (A key that is
      // simply already gone is NOT an error — remove() reports no rows, not a
      // failure — so a retry after a half-finished delete still completes.)
      console.error('[submit-post] delete_post: storage remove failed', rmErr);
      return json(502, { error: 'storage_failed' });
    }
  }
  // key === null: the URL is not one of our public posts objects (an
  // externally-hosted legacy row). Nothing to remove; the row still goes.

  const { data: gone, error: delErr } = await sb
    .from('posts')
    .delete()
    .eq('id', postId)
    .eq('event_id', event.slug)
    .eq('session_id', sessionId) // last-line tenancy check, in the statement itself
    .select('id');
  if (delErr) throw delErr;
  // Zero rows is not success (a no-match DELETE returns no error at all).
  if ((gone?.length ?? 0) === 0) return json(404, { error: 'post_not_found' });

  return json(200, { deleted: true });
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
        return await handleInit(sb, body, clientIp(req));
      case 'finalize':
        return await handleFinalize(sb, body);
      case 'delete_post':
        return await handleDeletePost(sb, body, clientIp(req));
      default:
        return json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('[submit-post] internal error', err);
    return json(500, { error: 'internal' });
  }
});
