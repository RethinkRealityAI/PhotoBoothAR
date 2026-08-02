/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Storage I/O for the platform landing-page CMS (/admin/landing).
 *
 * Mirrors db.ts uploadAsset/listAssetsResult/deleteAsset, but under the
 * `_platform/landing/` prefix of the SAME public assets bucket. `_platform` is
 * not an event slug, so under migration 018's policies
 * (`is_event_member((storage.foldername(name))[1]) or is_platform_admin(...)`)
 * only platform admins can write, list or delete there — no new policy needed,
 * and the public-object URLs it yields are exactly what
 * landingContent.resolveMediaUrl accepts.
 *
 * db.ts is deliberately NOT edited to export its private helpers (it is on a
 * standing do-not-edit fence for parallel work); `extFor`/`uid` below are
 * small, honest duplications of db.ts:331-345.
 */
import { supabase, ASSETS_BUCKET, publicUrl } from './supabase';

const LANDING_PREFIX = '_platform/landing';

/** Duplicated from db.ts extFor (same contract). */
function extFor(file: Blob, fallback: string): string {
  const t = file.type;
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('svg')) return 'svg';
  if (t.includes('webm')) return 'webm';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('gltf-binary') || t.includes('octet-stream')) return 'glb';
  return fallback;
}

/** Duplicated from db.ts uid (same contract). */
function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Upload one landing-page media file; public URL back, or null on failure
 * (callers surface the failure — a silent null must not read as success).
 */
export async function uploadLandingMedia(file: Blob | File, name?: string): Promise<string | null> {
  const rawName = name ?? (file instanceof File ? file.name : 'media');
  const safe = rawName.replace(/[^a-z0-9.\-_]/gi, '_');
  const path = `${LANDING_PREFIX}/${uid()}-${safe}.${extFor(file, 'png')}`;
  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) {
    console.error('[landingMedia] upload', error);
    return null;
  }
  return publicUrl(ASSETS_BUCKET, path);
}

export interface LandingMediaItem {
  name: string;
  path: string;
  url: string;
  size?: number;
  mimetype?: string;
  created_at?: string;
}

export interface LandingMediaList {
  rows: LandingMediaItem[];
  /** True when the LIST call failed — "no media" and "couldn't ask" must not
   *  render the same (the *Result convention from db.ts). */
  failed: boolean;
}

/** Everything uploaded for the landing page, newest first. */
export async function listLandingMedia(): Promise<LandingMediaList> {
  const { data, error } = await supabase.storage
    .from(ASSETS_BUCKET)
    .list(LANDING_PREFIX, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
  if (error || !data) {
    if (error) console.error('[landingMedia] list', error);
    // No data with no error is an empty folder, not a failure.
    return { rows: [], failed: !!error };
  }
  const rows = data
    .filter((f) => f.name && !f.name.startsWith('.'))
    .map((f) => {
      const meta = (f.metadata ?? null) as { size?: number; mimetype?: string } | null;
      // `list` returns names relative to the prefix; consumers need the full path.
      const path = `${LANDING_PREFIX}/${f.name}`;
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

export async function deleteLandingMedia(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(ASSETS_BUCKET).remove([path]);
  if (error) {
    console.error('[landingMedia] delete', error);
    return false;
  }
  return true;
}
