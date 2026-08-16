/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed data-access layer over Supabase: experiences (AR studio assets),
 * posts (live wall submissions), realtime subscriptions, and storage uploads.
 *
 * This is the single source of truth for all backend I/O. UI components should
 * call these helpers rather than touching the Supabase client directly.
 *
 * Runtime tenancy: every helper that stamps or filters `event_id` takes the
 * eventId (slug) as its FIRST parameter — components obtain it via useEvent().
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase, POSTS_BUCKET, ASSETS_BUCKET, publicUrl } from './supabase';
import type { EventCopy } from '../events/types';
import {
  Experience,
  ExperienceDraft,
  Post,
  Challenge,
  WallSettings,
  LeaderboardEntry,
  LandingContent,
  PresetOverrides,
  BrandingOverrides,
  MediaType,
} from '../types';
import { getSessionId } from './session';
import { isDeleteToken } from './postDelete';
import { normalizeStudioSettings, DEFAULT_STUDIO_SETTINGS, type StudioSettings } from './studio/occluder';

/** The grandfathered single-tenant events whose RLS still permits the direct
 *  upload+insert path — used as a fallback if the edge function is down. */
const LEGACY_EVENT_IDS = new Set(['hope-gala', 'jenna-jake', 'detola-wuyi']);

/* ------------------------------------------------------------------ */
/* Experiences (studio-authored AR filters / borders / 3D / shaders)   */
/* ------------------------------------------------------------------ */

export async function fetchExperiencesResult(
  eventId: string,
  opts?: { publishedOnly?: boolean },
): Promise<ListResult<Experience>> {
  let q = supabase.from('experiences').select('*').eq('event_id', eventId).order('sort_order').order('created_at');
  if (opts?.publishedOnly) q = q.eq('is_published', true);
  const { data, error } = await q;
  if (error) {
    console.error('[db] fetchExperiences', error);
    return { rows: [], failed: true };
  }
  return { rows: (data as Experience[]) ?? [], failed: false };
}

/** Experiences, or [] on failure. Use fetchExperiencesResult wherever the caller
 *  renders an empty state a host could mistake for "you have no assets". */
export async function fetchExperiences(eventId: string, opts?: { publishedOnly?: boolean }): Promise<Experience[]> {
  return (await fetchExperiencesResult(eventId, opts)).rows;
}

/**
 * Read one experience, distinguishing "it isn't there" from "we couldn't ask".
 *
 * The difference is load-bearing in the studio: on a failed read the editor used
 * to open on a blank draft, and saving that draft CREATED a second experience
 * instead of updating the one the host opened — a silent duplicate fork of their
 * work. `*Result` sibling convention, so no existing caller changes.
 */
export async function getExperienceResult(
  eventId: string,
  id: string,
): Promise<{ experience: Experience | null; failed: boolean }> {
  const { data, error } = await supabase.from('experiences').select('*').eq('id', id).eq('event_id', eventId).maybeSingle();
  if (error) {
    console.error('[db] getExperience', error);
    return { experience: null, failed: true };
  }
  return { experience: (data as Experience) ?? null, failed: false };
}

export async function getExperience(eventId: string, id: string): Promise<Experience | null> {
  return (await getExperienceResult(eventId, id)).experience;
}

export async function createExperience(eventId: string, draft: ExperienceDraft): Promise<Experience | null> {
  const row = {
    name: draft.name ?? 'Untitled Experience',
    kind: draft.kind ?? '2d_filter',
    asset_url: draft.asset_url ?? null,
    thumbnail_url: draft.thumbnail_url ?? null,
    config: draft.config ?? {},
    is_published: draft.is_published ?? true,
    featured: draft.featured ?? true,
    sort_order: draft.sort_order ?? 0,
    event_id: eventId,
  };
  const { data, error } = await supabase.from('experiences').insert(row).select().single();
  if (error) {
    console.error('[db] createExperience', error);
    return null;
  }
  return data as Experience;
}

export async function updateExperience(eventId: string, id: string, patch: ExperienceDraft): Promise<Experience | null> {
  const { data, error } = await supabase.from('experiences').update(patch).eq('id', id).eq('event_id', eventId).select().single();
  if (error) {
    console.error('[db] updateExperience', error);
    return null;
  }
  return data as Experience;
}

export async function deleteExperience(eventId: string, id: string): Promise<boolean> {
  const { error } = await supabase.from('experiences').delete().eq('id', id).eq('event_id', eventId);
  if (error) {
    console.error('[db] deleteExperience', error);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Global catalog (Beamwall-curated experiences linkable into events)  */
/* ------------------------------------------------------------------ */

/** All published global catalog experiences (for the Library picker). */
export async function fetchGlobalExperiences(): Promise<Experience[]> {
  const { data, error } = await supabase
    .from('experiences')
    .select('*')
    .eq('is_global', true)
    .eq('is_published', true)
    .order('sort_order');
  if (error) {
    console.error('[db] fetchGlobalExperiences', error);
    return [];
  }
  return (data as Experience[]) ?? [];
}

/** Ids of the global experiences linked into this event. */
export async function fetchCatalogLinks(eventId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('event_catalog_links')
    .select('experience_id')
    .eq('event_id', eventId);
  if (error) {
    console.error('[db] fetchCatalogLinks', error);
    return [];
  }
  return ((data as { experience_id: string }[]) ?? []).map((r) => r.experience_id);
}

export async function linkCatalogItem(eventId: string, experienceId: string): Promise<boolean> {
  const { error } = await supabase
    .from('event_catalog_links')
    .insert({ event_id: eventId, experience_id: experienceId });
  if (error) {
    console.error('[db] linkCatalogItem', error);
    return false;
  }
  return true;
}

export async function unlinkCatalogItem(eventId: string, experienceId: string): Promise<boolean> {
  const { error } = await supabase
    .from('event_catalog_links')
    .delete()
    .eq('event_id', eventId)
    .eq('experience_id', experienceId);
  if (error) {
    console.error('[db] unlinkCatalogItem', error);
    return false;
  }
  return true;
}

/** The linked global experiences themselves (for the booth catalog). */
export async function fetchLinkedGlobalExperiences(eventId: string): Promise<Experience[]> {
  const { data, error } = await supabase
    .from('event_catalog_links')
    .select('experiences(*)')
    .eq('event_id', eventId);
  if (error) {
    console.error('[db] fetchLinkedGlobalExperiences', error);
    return [];
  }
  const rows = (data ?? []) as unknown as { experiences: Experience | Experience[] | null }[];
  return rows
    .flatMap((r) => (Array.isArray(r.experiences) ? r.experiences : r.experiences ? [r.experiences] : []))
    .filter((e) => e.is_global && e.is_published);
}

/* ------------------------------------------------------------------ */
/* Posts (live photo wall)                                             */
/* ------------------------------------------------------------------ */

/** A list read that keeps "the query failed" apart from "there are no rows".
 *  Mirrors the fetchMyOrgResult/fetchMyOrg pair in host.ts. Without it, every
 *  failed fetch renders as a confident empty state — the wall telling guests
 *  nobody has posted, or a guest being told they have no photos. */
export interface ListResult<T> {
  rows: T[];
  failed: boolean;
}

export async function fetchPostsResult(
  eventId: string,
  opts?: { includeHidden?: boolean; limit?: number },
): Promise<ListResult<Post>> {
  let q = supabase.from('posts').select('*').eq('event_id', eventId).order('created_at', { ascending: false });
  if (!opts?.includeHidden) q = q.eq('hidden', false).eq('approved', true);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) {
    console.error('[db] fetchPosts', error);
    return { rows: [], failed: true };
  }
  return { rows: (data as Post[]) ?? [], failed: false };
}

/** Posts, or [] on failure. Use fetchPostsResult when the caller renders an
 *  empty state the guest could mistake for the truth. */
export async function fetchPosts(eventId: string, opts?: { includeHidden?: boolean; limit?: number }): Promise<Post[]> {
  return (await fetchPostsResult(eventId, opts)).rows;
}

export async function fetchMyPostsResult(eventId: string): Promise<ListResult<Post>> {
  const sid = getSessionId(eventId);
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('session_id', sid)
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[db] fetchMyPosts', error);
    return { rows: [], failed: true };
  }
  return { rows: (data as Post[]) ?? [], failed: false };
}

export async function fetchMyPosts(eventId: string): Promise<Post[]> {
  return (await fetchMyPostsResult(eventId)).rows;
}

/** Why a guest self-delete didn't go through. Server codes pass through
 *  verbatim; 'network' is the undecodable case (offline, malformed body). */
export type DeleteMyPostError =
  | 'event_not_found'
  | 'post_not_found'
  /** The supplied token doesn't match this post's — or the post predates them. */
  | 'not_yours'
  | 'rate_limited'
  /** The object could not be removed, so the row was deliberately kept. */
  | 'storage_failed'
  | 'invalid_post_id'
  | 'invalid_session_id'
  /** No usable delete token was held for this post; nothing was sent. */
  | 'invalid_delete_token'
  | 'invalid_path'
  | 'internal'
  | 'network';

/**
 * A guest removing their OWN post — from the wall and from storage.
 *
 * Goes through the `submit-post` edge function (`delete_post`), never a direct
 * `.delete()`: anonymous guests have no delete policy on `posts` (migration 003
 * grants delete to members only), and a client delete could not remove the
 * storage object either — the file would keep serving from its public URL after
 * the moment "disappeared". The function removes the object first, and only
 * then the row.
 *
 * `deleteToken` is the proof of ownership: the one-time secret `finalize`
 * returned when this device made the post (`post_secrets`, migration 035),
 * stored on its local `SavedPhoto`. It replaces the old proof — matching the
 * row's `session_id` — which every wall viewer could read off `select('*')` and
 * off the realtime frame, and could therefore use to delete anyone's photo.
 * A post this device holds no token for cannot be deleted from here, which is
 * why the caller asks `removeKindFor` before offering the control at all.
 *
 * Returns `deleted:false` with a code rather than throwing; the caller decides
 * what the guest is told.
 */
export async function deleteMyPost(
  eventId: string,
  postId: string,
  deleteToken: string,
): Promise<{ deleted: boolean; error: DeleteMyPostError | null }> {
  // Answer locally rather than spending a round trip to be told what we already
  // know. The server applies the same rule; this just doesn't make a guest wait
  // for it.
  if (!isDeleteToken(deleteToken)) {
    return { deleted: false, error: 'invalid_delete_token' };
  }
  try {
    const { data, error } = await supabase.functions.invoke('submit-post', {
      body: {
        action: 'delete_post',
        eventSlug: eventId,
        postId,
        deleteToken,
        // Belt-and-braces only — the server checks it against the row when
        // present, but it proves nothing on its own any more.
        sessionId: getSessionId(eventId),
      },
    });
    if (error) throw error;
    const res = (data ?? {}) as { deleted?: boolean };
    return res.deleted === true
      ? { deleted: true, error: null }
      : { deleted: false, error: 'internal' };
  } catch (e) {
    console.error('[db] deleteMyPost', e);
    return { deleted: false, error: (await decodeSubmitPostError(e)) as DeleteMyPostError };
  }
}

export async function setPostHidden(eventId: string, id: string, hidden: boolean): Promise<boolean> {
  const { error } = await supabase.from('posts').update({ hidden }).eq('id', id).eq('event_id', eventId);
  if (error) {
    console.error('[db] setPostHidden', error);
    return false;
  }
  return true;
}

export async function deletePost(eventId: string, id: string): Promise<boolean> {
  const { error } = await supabase.from('posts').delete().eq('id', id).eq('event_id', eventId);
  if (error) {
    console.error('[db] deletePost', error);
    return false;
  }
  return true;
}

/**
 * Realtime subscription to new posts on the wall.
 * Returns an unsubscribe function. `onInsert` fires for each newly created post.
 *
 * `opts.visibleOnly` (guest walls): only wall-visible posts (approved &&
 * !hidden) are delivered — an INSERT of an unapproved/hidden post is dropped
 * (pre-moderation events never flash unapproved posts), and an UPDATE that
 * makes a post non-visible arrives as `onDelete` so a host "hide"/"unapprove"
 * removes it from the wall instantly. Default (moderation surfaces) is the raw
 * pass-through, exactly as before.
 *
 * `onStatus` (optional, additive): the channel's own subscribe status. Without
 * it a socket that dies on venue wifi is completely unobserved — photos keep
 * trickling in on the fallback poll, but with no beam-in, no fresh glow and no
 * spotlight, so the magic stops and nobody in the room can tell. Callers that
 * do not pass it behave exactly as before.
 */
let postsStreamSeq = 0;

/** Channel states supabase-js reports to a `.subscribe()` callback. */
export type PostsStreamStatus =
  | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | (string & {});

export function subscribeToPosts(eventId: string, handlers: {
  onInsert?: (post: Post) => void;
  onUpdate?: (post: Post) => void;
  onDelete?: (id: string) => void;
  onStatus?: (status: PostsStreamStatus) => void;
}, opts?: { visibleOnly?: boolean }): () => void {
  const visibleOnly = opts?.visibleOnly === true;
  const isVisible = (p: Post) => p.approved && !p.hidden;
  const channel = supabase
    // Topic must be unique PER SUBSCRIBER: supabase-js reuses the channel
    // instance for a duplicate topic, so two same-topic subscribers on one
    // page (e.g. EventStudio's ModerationTab + the admin Moderation grid)
    // stack their bindings onto one channel whose join reply then mismatches
    // positionally and errors the channel — killing realtime for BOTH.
    .channel(`posts-stream:${eventId}:${++postsStreamSeq}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: `event_id=eq.${eventId}` }, (payload) => {
      const post = payload.new as Post;
      if (visibleOnly && !isVisible(post)) return;
      handlers.onInsert?.(post);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts', filter: `event_id=eq.${eventId}` }, (payload) => {
      const post = payload.new as Post;
      if (visibleOnly && !isVisible(post)) {
        handlers.onDelete?.(post.id);
        return;
      }
      handlers.onUpdate?.(post);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
      handlers.onDelete?.((payload.old as { id: string }).id);
    })
    .subscribe((status) => {
      handlers.onStatus?.(status as PostsStreamStatus);
    });
  return () => {
    supabase.removeChannel(channel);
  };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

function extFor(file: Blob, fallback: string, name?: string): string {
  const t = file.type;
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('svg')) return 'svg';
  if (t.includes('webm')) return 'webm';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('gltf-binary')) return 'glb';
  // A .gltf is JSON, not a binary container: it used to miss every branch above
  // and land on the 'png' fallback, so it was stored `…gltf.png` and read back
  // as an IMAGE (classifyAsset keys on the extension) — the model was lost.
  if (t.includes('gltf+json')) return 'gltf';
  // Browsers hand back 'application/octet-stream' or '' for .glb/.gltf on many
  // platforms and OSes, so the picked filename is the only thing that can tell
  // the two model formats apart. Checked BEFORE the octet-stream default below.
  const named = /\.(glb|gltf)$/i.exec(name ?? '');
  if (named) return named[1].toLowerCase();
  if (t.includes('octet-stream')) return 'glb';
  return fallback;
}

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Upload a studio asset (PNG/SVG/GLB) into THIS event's folder. Public URL back.
 *
 * `eventId` (the event SLUG) is first and required on purpose. Uploads used to
 * land flat at the bucket root — `<uid>-name.png` with no tenant in the path —
 * which made per-tenant storage rules impossible to express and meant
 * `listAssets` handed every host every other host's files. Making it required
 * turns the compiler into the reference sweep: no call site can forget it.
 *
 * The shape matches what the edge functions already write (`<slug>/ai/<id>.png`),
 * so one storage policy covers uploads and generated assets alike — see
 * migration 017.
 */
export async function uploadAsset(eventId: string, file: Blob, name?: string): Promise<string | null> {
  const safe = (name ?? 'asset').replace(/[^a-z0-9.\-_]/gi, '_');
  const path = `${eventId}/uploads/${uid()}-${safe}.${extFor(file, 'png', safe)}`;
  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) {
    console.error('[db] uploadAsset', error);
    return null;
  }
  return publicUrl(ASSETS_BUCKET, path);
}

export interface StoredAsset {
  name: string;
  path: string;
  url: string;
  size?: number;
  mimetype?: string;
  created_at?: string;
}

/**
 * This event's uploaded assets, newest first — powers the Assets library.
 *
 * Scoped to `<eventId>/uploads`. It used to list the bucket ROOT, so every host
 * saw every other host's uploads in their studio, with a delete button next to
 * them. Files uploaded before namespacing still serve from their public URLs
 * (nothing on a live event breaks); they simply no longer appear in anyone's
 * library, and platform admins retain full read for support (migration 017).
 */
export async function listAssetsResult(eventId: string): Promise<ListResult<StoredAsset>> {
  const prefix = `${eventId}/uploads`;
  const { data, error } = await supabase.storage
    .from(ASSETS_BUCKET)
    .list(prefix, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
  if (error || !data) {
    if (error) console.error('[db] listAssets', error);
    // No data with no error is an empty folder, not a failure.
    return { rows: [], failed: !!error };
  }
  const rows = data
    .filter((f) => f.name && !f.name.startsWith('.'))
    .map((f) => {
      const meta = (f.metadata ?? null) as { size?: number; mimetype?: string } | null;
      // `list` returns names relative to the prefix; every consumer (delete,
      // public URL) needs the FULL object path.
      const path = `${prefix}/${f.name}`;
      return {
        name: f.name,
        path,
        url: publicUrl(ASSETS_BUCKET, path),
        size: meta?.size,
        mimetype: meta?.mimetype,
        created_at: f.created_at ?? undefined,
      };
    });
  return { rows, failed: false };
}

/** Uploaded assets, or [] on failure. Use listAssetsResult wherever the caller
 *  renders an empty state a host could mistake for "you have not uploaded any". */
export async function listAssets(eventId: string): Promise<StoredAsset[]> {
  return (await listAssetsResult(eventId)).rows;
}

export async function deleteAsset(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(ASSETS_BUCKET).remove([path]);
  if (error) {
    console.error('[db] deleteAsset', error);
    return false;
  }
  return true;
}

export interface SubmitPostInput {
  blob: Blob;                 // composited JPEG/PNG or recorded webm/mp4
  mediaType?: MediaType;      // 'image' (default) | 'video'
  durationMs?: number;        // for video
  message?: string;
  guestName?: string;
  experienceId?: string | null;
  challengeId?: string | null;
  width?: number;
  height?: number;
}

/** Legacy direct upload+insert path — grandfathered RLS allows it for the
 *  three coded events, so they keep working even if the function is down. */
async function submitPostDirect(eventId: string, input: SubmitPostInput): Promise<Post | null> {
  const isVideo = input.mediaType === 'video';
  const ext = extFor(input.blob, isVideo ? 'webm' : 'jpg');
  const path = `${uid()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(POSTS_BUCKET).upload(path, input.blob, {
    upsert: true,
    contentType: input.blob.type || (isVideo ? 'video/webm' : 'image/jpeg'),
  });
  if (upErr) {
    console.error('[db] submitPost upload', upErr);
    return null;
  }
  const image_url = publicUrl(POSTS_BUCKET, path);
  const { data, error } = await supabase
    .from('posts')
    .insert({
      image_url,
      media_type: input.mediaType ?? 'image',
      duration_ms: input.durationMs ?? null,
      message: input.message?.trim() || null,
      guest_name: input.guestName?.trim() || null,
      // Built-in catalog ids (e.g. "builtin:shader:golden-hour") are not DB rows
      // and would violate the uuid FK — only persist real experience uuids.
      experience_id:
        input.experienceId && !input.experienceId.startsWith('builtin:') ? input.experienceId : null,
      challenge_id: input.challengeId ?? null,
      session_id: getSessionId(eventId),
      width: input.width ?? null,
      height: input.height ?? null,
      event_id: eventId,
    })
    .select()
    .single();
  if (error) {
    console.error('[db] submitPost insert', error);
    return null;
  }
  return data as Post;
}

/** Result of a wall submission attempt. `error` is present iff `post` is null:
 *  a server code passed through verbatim ('event_not_live', 'post_limit_reached',
 *  'video_not_allowed', 'rate_limited', …) or 'network' when the failure kind
 *  couldn't be decoded (offline, storage upload error, malformed body). */
export interface SubmitPostResult {
  post: Post | null;
  error?: string;
  /**
   * The one-time delete capability for the post just created (`post_secrets`,
   * migration 035) — store it on this device's `SavedPhoto` and nowhere else.
   * Absent when the server couldn't mint one (deliberately non-fatal: the photo
   * is on the wall either way, it just can't be self-deleted) and always absent
   * on the legacy direct-insert fallback below, which bypasses `finalize`.
   */
  deleteToken?: string;
}

/** Decode the `{ error }` body of a submit-post FunctionsHttpError, same idiom
 *  as managerApi.ts; anything unreadable is reported as 'network'. */
async function decodeSubmitPostError(e: unknown): Promise<string> {
  if (e instanceof FunctionsHttpError) {
    try {
      const body = (await e.context.json()) as { error?: string };
      if (body.error) return body.error;
    } catch { /* unreadable body */ }
  }
  return 'network';
}

/**
 * Upload a captured photo/video and create the wall post via the `submit-post`
 * edge function (init → signed upload → finalize). Returns the created Post
 * plus the failure kind when it didn't go through — callers with UI for it
 * (the booth) branch their copy on `error`; others can use submitPost below.
 * Legacy events fall back to the direct path on any function error.
 */
export async function submitPostDetailed(eventId: string, input: SubmitPostInput): Promise<SubmitPostResult> {
  const isVideo = input.mediaType === 'video';
  const mediaType: MediaType = input.mediaType ?? 'image';
  const ext = extFor(input.blob, isVideo ? 'webm' : 'jpg');
  const contentType = input.blob.type || (isVideo ? 'video/webm' : 'image/jpeg');
  const sessionId = getSessionId(eventId);

  try {
    const { data: init, error: initErr } = await supabase.functions.invoke('submit-post', {
      body: { action: 'init', eventSlug: eventId, sessionId, mediaType, contentType, ext },
    });
    if (initErr) throw initErr;
    const { path, token } = (init ?? {}) as { path?: string; token?: string };
    if (!path || !token) throw new Error('submit-post init returned no upload token');

    const { error: upErr } = await supabase.storage
      .from(POSTS_BUCKET)
      .uploadToSignedUrl(path, token, input.blob, { contentType });
    if (upErr) throw upErr;

    const { data: fin, error: finErr } = await supabase.functions.invoke('submit-post', {
      body: {
        action: 'finalize',
        eventSlug: eventId,
        sessionId,
        path,
        message: input.message?.trim() || null,
        guestName: input.guestName?.trim() || null,
        experienceId:
          input.experienceId && !input.experienceId.startsWith('builtin:') ? input.experienceId : null,
        challengeId: input.challengeId ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        mediaType,
        durationMs: input.durationMs ?? null,
      },
    });
    if (finErr) throw finErr;
    const finBody = (fin ?? null) as { post?: Post; deleteToken?: string } | null;
    const post = (finBody?.post ?? fin) as Post | null;
    if (!post?.id) throw new Error('submit-post finalize returned no post');
    // The delete token rides the finalize RESPONSE and nothing else — never a
    // posts payload, so it cannot reach the wall or a realtime frame. (Named
    // `minted`, not `token`: `token` is already the signed-UPLOAD token above,
    // and two different secrets under one name in one scope is how they get
    // swapped.)
    const minted = finBody?.deleteToken;
    return isDeleteToken(minted) ? { post, deleteToken: minted } : { post };
  } catch (e) {
    if (LEGACY_EVENT_IDS.has(eventId)) {
      console.warn('[db] submitPost edge function failed — falling back to direct upload', e);
      const post = await submitPostDirect(eventId, input);
      return post ? { post } : { post: null, error: 'network' };
    }
    console.error('[db] submitPost', e);
    return { post: null, error: await decodeSubmitPostError(e) };
  }
}

/** Back-compat wrapper: same signature as before SubmitPostResult existed —
 *  null on any failure. It has no callers left (UploadToWall moved to
 *  submitPostDetailed) and NEW code that saves a local gallery record must not
 *  use it: it drops `deleteToken`, and that token is minted exactly once, so a
 *  post saved through here can never be self-deleted by the guest again. */
export async function submitPost(eventId: string, input: SubmitPostInput): Promise<Post | null> {
  return (await submitPostDetailed(eventId, input)).post;
}

/* ------------------------------------------------------------------ */
/* Challenges                                                          */
/* ------------------------------------------------------------------ */

export async function fetchChallengesResult(
  eventId: string,
  opts?: { activeOnly?: boolean },
): Promise<ListResult<Challenge>> {
  let q = supabase.from('challenges').select('*').eq('event_id', eventId).order('sort_order').order('created_at');
  if (opts?.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) {
    console.error('[db] fetchChallenges', error);
    return { rows: [], failed: true };
  }
  return { rows: (data as Challenge[]) ?? [], failed: false };
}

export async function fetchChallenges(eventId: string, opts?: { activeOnly?: boolean }): Promise<Challenge[]> {
  return (await fetchChallengesResult(eventId, opts)).rows;
}

export async function createChallenge(eventId: string, c: Partial<Challenge>): Promise<Challenge | null> {
  const row = {
    title: c.title ?? 'New Challenge',
    description: c.description ?? null,
    emoji: c.emoji ?? '✨',
    points: c.points ?? 10,
    sort_order: c.sort_order ?? 0,
    active: c.active ?? true,
    // AI photo-check config (jsonb); absent → null (no check). updateChallenge
    // spreads its patch, so it carries `validation` through automatically.
    validation: c.validation ?? null,
    event_id: eventId,
  };
  const { data, error } = await supabase.from('challenges').insert(row).select().single();
  if (error) {
    console.error('[db] createChallenge', error);
    return null;
  }
  return data as Challenge;
}

export async function updateChallenge(eventId: string, id: string, patch: Partial<Challenge>): Promise<boolean> {
  const { error } = await supabase.from('challenges').update(patch).eq('id', id).eq('event_id', eventId);
  if (error) {
    console.error('[db] updateChallenge', error);
    return false;
  }
  return true;
}

export async function deleteChallenge(eventId: string, id: string): Promise<boolean> {
  const { error } = await supabase.from('challenges').delete().eq('id', id).eq('event_id', eventId);
  if (error) {
    console.error('[db] deleteChallenge', error);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* App settings (live-synced feature flags, e.g. wall QR visibility)   */
/* ------------------------------------------------------------------ */

const DEFAULT_WALL_SETTINGS: WallSettings = {
  showQR: true,            // on by default — stored rows keep their persisted value
  showLeaderboard: true,
  showChallenges: true,
  galleryScroll: false,    // static masonry grid (clickable, no duplicates)
  galleryScrollSpeed: 1,
  slideshowInterval: 6,
  featuredSpotlight: true,
  featuredIntervalSec: 45,
  defaultExperienceId: null,
};

/**
 * Wall settings, distinguishing "never configured" (no row — the defaults ARE
 * the truth) from "we couldn't ask". `getWallSettings` folds both into the
 * defaults, which is right for the wall itself (a projector must render
 * something) but wrong for a reader that REPORTS the values: the copilot's event
 * snapshot rendered a failed read as `challenges feature ON` and told the host so.
 * `*Result` sibling convention, so no existing caller changes.
 */
export async function getWallSettingsResult(eventId: string): Promise<{ settings: WallSettings; failed: boolean }> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'wall').eq('event_id', eventId).maybeSingle();
  if (error) {
    console.error('[db] getWallSettings', error);
    return { settings: DEFAULT_WALL_SETTINGS, failed: true };
  }
  if (!data) return { settings: DEFAULT_WALL_SETTINGS, failed: false };
  return { settings: { ...DEFAULT_WALL_SETTINGS, ...(data.value as Partial<WallSettings>) }, failed: false };
}

export async function getWallSettings(eventId: string): Promise<WallSettings> {
  return (await getWallSettingsResult(eventId)).settings;
}

export async function setWallSettings(eventId: string, patch: Partial<WallSettings>): Promise<WallSettings> {
  const current = await getWallSettings(eventId);
  const value = { ...current, ...patch };
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'wall', value, updated_at: new Date().toISOString(), event_id: eventId }, { onConflict: 'event_id,key' });
  if (error) console.error('[db] setWallSettings', error);
  return value;
}

export function subscribeToSettings(eventId: string, onChange: (s: WallSettings) => void): () => void {
  const channel = supabase
    .channel(`app-settings-stream:${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `event_id=eq.${eventId}` },
      (payload) => {
        const row = payload.new as { key?: string; value?: Partial<WallSettings> };
        if (row.key !== 'wall') return;
        if (row.value) onChange({ ...DEFAULT_WALL_SETTINGS, ...row.value });
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/* ------------------------------------------------------------------ */
/* Generic app_settings (key/value JSON) — landing page + preset mgmt  */
/* ------------------------------------------------------------------ */

async function getSetting<T>(eventId: string, key: string, fallback: T): Promise<T> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).eq('event_id', eventId).maybeSingle();
  if (error || !data) return fallback;
  return { ...fallback, ...(data.value as Partial<T>) };
}

async function setSetting<T extends object>(eventId: string, key: string, value: T): Promise<T> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString(), event_id: eventId }, { onConflict: 'event_id,key' });
  if (error) console.error('[db] setSetting', key, error);
  return value;
}

/** Coded default /join content, derived from the event's copy. */
export function defaultLanding(copy: EventCopy): LandingContent {
  return {
    eyebrow: copy.fullName,
    title: 'Join the Photo Booth',
    subtitle: copy.tagline,
    intro: '',
    steps: copy.steps.length
      ? copy.steps.map((s) => ({ title: s.title, body: s.body }))
      : [
          { title: 'Scan QR', body: '' },
          { title: 'Select a Filter', body: '' },
          { title: 'Snap Photo', body: '' },
          { title: 'Share', body: '' },
        ],
    ctaLabel: 'Open the Booth',
    url: '',
    footer: copy.fullName,
  };
}

export async function getLandingContent(eventId: string, copy: EventCopy): Promise<LandingContent> {
  const defaults = defaultLanding(copy);
  const c = await getSetting<LandingContent>(eventId, 'landing', defaults);
  // steps may come back as a non-array if never set — guard it
  if (!Array.isArray(c.steps) || c.steps.length === 0) c.steps = defaults.steps;
  return c;
}

export async function setLandingContent(eventId: string, content: LandingContent): Promise<LandingContent> {
  return setSetting(eventId, 'landing', content);
}

export function subscribeToLanding(eventId: string, copy: EventCopy, onChange: (c: LandingContent) => void): () => void {
  const defaults = defaultLanding(copy);
  const channel = supabase
    .channel(`landing-stream:${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `event_id=eq.${eventId}` },
      (payload) => {
        const row = payload.new as { key?: string; value?: Partial<LandingContent> };
        if (row.key !== 'landing') return;
        if (row.value) onChange({ ...defaults, ...row.value });
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/* ------------------------------------------------------------------ */
/* Branding overrides (admin-editable event identity, key='branding')   */
/* ------------------------------------------------------------------ */

/** No overrides by default — the coded EventConfig supplies every value. */
export const DEFAULT_BRANDING: BrandingOverrides = {};

export async function getBranding(eventId: string): Promise<BrandingOverrides> {
  return getSetting<BrandingOverrides>(eventId, 'branding', DEFAULT_BRANDING);
}

export async function setBranding(eventId: string, patch: BrandingOverrides): Promise<BrandingOverrides> {
  const current = await getBranding(eventId);
  return setSetting(eventId, 'branding', { ...current, ...patch });
}

export function subscribeToBranding(eventId: string, onChange: (b: BrandingOverrides) => void): () => void {
  const channel = supabase
    .channel(`branding-stream:${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `event_id=eq.${eventId}` },
      (payload) => {
        const row = payload.new as { key?: string; value?: BrandingOverrides };
        if (row.key !== 'branding') return;
        if (row.value) onChange(row.value);
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/* ------------------------------------------------------------------ */
/* Studio settings (app_settings key='studio') — head calibration       */
/* ------------------------------------------------------------------ */

/**
 * Per-event studio/booth settings: `headScale` calibrates the AR head
 * occluder + reference head to the guest's real head size, and `occlusion`
 * is the event-wide master switch. Optional `baselineFit` (+ `autoHeadScale`)
 * are written when the host uses the calibration "Apply" chip and drive the
 * booth's opt-in per-guest head-size transfer; absent for every pre-existing
 * row, so those behave exactly as before. Defaults preserve today's behaviour.
 * `eventId` here is the slug (app_settings.event_id = events.slug). Both helpers
 * route through normalizeStudioSettings, so a `baselineFit`/`autoHeadScale`
 * patch persists and clamps without any change to these signatures.
 */
export async function getStudioSettings(eventId: string): Promise<StudioSettings> {
  const raw = await getSetting<StudioSettings>(eventId, 'studio', DEFAULT_STUDIO_SETTINGS);
  return normalizeStudioSettings(raw);
}

export async function setStudioSettings(eventId: string, patch: Partial<StudioSettings>): Promise<StudioSettings> {
  const current = await getStudioSettings(eventId);
  return setSetting(eventId, 'studio', normalizeStudioSettings({ ...current, ...patch }));
}

/* ------------------------------------------------------------------ */
/* Upload passcode (app_settings key='upload') — runtime events only    */
/* ------------------------------------------------------------------ */

/**
 * Public-upload gate settings. `passcodeHash` is a sha256 hex of the passcode.
 * Note: readable via app_settings public-read RLS — a friction layer with the
 * same threat model as the legacy env passcode, fine for Phase 2a.
 */
export interface UploadSettings {
  passcodeHash?: string | null;
}

/** Returns null when the row has never been configured (vs configured-closed). */
export async function getUploadSettings(eventId: string): Promise<UploadSettings | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'upload')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.value as UploadSettings) ?? null;
}

export async function saveUploadSettings(eventId: string, value: UploadSettings): Promise<UploadSettings> {
  return setSetting(eventId, 'upload', value);
}

const DEFAULT_PRESET_OVERRIDES: PresetOverrides = { hidden: [], order: [] };

export async function getPresetOverrides(eventId: string): Promise<PresetOverrides> {
  const o = await getSetting<PresetOverrides>(eventId, 'presets', DEFAULT_PRESET_OVERRIDES);
  return {
    hidden: Array.isArray(o.hidden) ? o.hidden : [],
    order: Array.isArray(o.order) ? o.order : [],
  };
}

export async function setPresetOverrides(eventId: string, patch: Partial<PresetOverrides>): Promise<PresetOverrides> {
  const current = await getPresetOverrides(eventId);
  return setSetting(eventId, 'presets', { ...current, ...patch });
}

/* ------------------------------------------------------------------ */
/* Leaderboard (aggregated from posts + challenges)                    */
/* ------------------------------------------------------------------ */

/**
 * Leaderboard ranking.
 *
 * Winners = the first guests to complete EVERY active challenge, ordered by
 * when they finished their final challenge (earliest finisher = 1st place).
 * Finishers are listed first (in completion order), then everyone else by
 * challenges-completed → points → photos.
 */
export async function fetchLeaderboard(eventId: string, limit = 20): Promise<LeaderboardEntry[]> {
  const [{ data: posts, error }, challenges] = await Promise.all([
    supabase
      .from('posts')
      .select('session_id, guest_name, challenge_id, created_at')
      .eq('hidden', false)
      // Pre-moderation ('pre') events insert approved=false — a pending post
      // must not score photos/challenge points before a host approves it.
      .eq('approved', true)
      .eq('event_id', eventId),
    fetchChallenges(eventId, { activeOnly: true }),
  ]);
  if (error || !posts) {
    console.error('[db] fetchLeaderboard', error);
    return [];
  }

  const activeIds = new Set(challenges.map((c) => c.id));
  const totalActive = activeIds.size;
  const pointsByChallenge = new Map(challenges.map((c) => [c.id, c.points]));

  interface Agg extends LeaderboardEntry {
    _done: Map<string, number>; // active challenge id → earliest completion time (ms)
  }
  const map = new Map<string, Agg>();

  const rows = posts as { session_id: string | null; guest_name: string | null; challenge_id: string | null; created_at: string }[];
  for (const p of rows) {
    const key = p.session_id ?? `anon-${p.guest_name ?? 'guest'}`;
    let e = map.get(key);
    if (!e) {
      e = { sessionId: key, name: p.guest_name || 'Anonymous Guest', photos: 0, challengesCompleted: 0, points: 0, _done: new Map() };
      map.set(key, e);
    }
    e.photos += 1;
    if (p.guest_name) e.name = p.guest_name; // prefer a provided name
    if (p.challenge_id && activeIds.has(p.challenge_id)) {
      const t = new Date(p.created_at).getTime();
      const prev = e._done.get(p.challenge_id);
      if (prev === undefined) {
        e._done.set(p.challenge_id, t);
        e.challengesCompleted += 1;
        e.points += pointsByChallenge.get(p.challenge_id) ?? 10;
      } else if (t < prev) {
        e._done.set(p.challenge_id, t); // keep the earliest completion of this challenge
      }
    }
  }

  const entries = Array.from(map.values()).map((e) => {
    const completedAll = totalActive > 0 && e._done.size >= totalActive;
    const finishTime = completedAll ? Math.max(...e._done.values()) : undefined;
    const { _done, ...rest } = e;
    void _done;
    return { ...rest, completedAll, finishTime } as LeaderboardEntry;
  });

  const finishers = entries
    .filter((e) => e.completedAll)
    .sort((a, b) => (a.finishTime ?? 0) - (b.finishTime ?? 0)); // earliest finisher first

  const rest = entries
    .filter((e) => !e.completedAll)
    .sort((a, b) => b.challengesCompleted - a.challengesCompleted || b.points - a.points || b.photos - a.photos);

  return [...finishers, ...rest].slice(0, limit);
}
