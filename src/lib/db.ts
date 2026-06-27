/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed data-access layer over Supabase: experiences (AR studio assets),
 * posts (live wall submissions), realtime subscriptions, and storage uploads.
 *
 * This is the single source of truth for all backend I/O. UI components should
 * call these helpers rather than touching the Supabase client directly.
 */
import { supabase, POSTS_BUCKET, ASSETS_BUCKET, publicUrl } from './supabase';
import { EVENT_ID } from '../events/eventId';
import { activeEvent } from '../events/active';
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

/* ------------------------------------------------------------------ */
/* Experiences (studio-authored AR filters / borders / 3D / shaders)   */
/* ------------------------------------------------------------------ */

export async function fetchExperiences(opts?: { publishedOnly?: boolean }): Promise<Experience[]> {
  let q = supabase.from('experiences').select('*').eq('event_id', EVENT_ID).order('sort_order').order('created_at');
  if (opts?.publishedOnly) q = q.eq('is_published', true);
  const { data, error } = await q;
  if (error) {
    console.error('[db] fetchExperiences', error);
    return [];
  }
  return (data as Experience[]) ?? [];
}

export async function getExperience(id: string): Promise<Experience | null> {
  const { data, error } = await supabase.from('experiences').select('*').eq('id', id).eq('event_id', EVENT_ID).maybeSingle();
  if (error) {
    console.error('[db] getExperience', error);
    return null;
  }
  return (data as Experience) ?? null;
}

export async function createExperience(draft: ExperienceDraft): Promise<Experience | null> {
  const row = {
    name: draft.name ?? 'Untitled Experience',
    kind: draft.kind ?? '2d_filter',
    asset_url: draft.asset_url ?? null,
    thumbnail_url: draft.thumbnail_url ?? null,
    config: draft.config ?? {},
    is_published: draft.is_published ?? true,
    featured: draft.featured ?? true,
    sort_order: draft.sort_order ?? 0,
    event_id: EVENT_ID,
  };
  const { data, error } = await supabase.from('experiences').insert(row).select().single();
  if (error) {
    console.error('[db] createExperience', error);
    return null;
  }
  return data as Experience;
}

export async function updateExperience(id: string, patch: ExperienceDraft): Promise<Experience | null> {
  const { data, error } = await supabase.from('experiences').update(patch).eq('id', id).eq('event_id', EVENT_ID).select().single();
  if (error) {
    console.error('[db] updateExperience', error);
    return null;
  }
  return data as Experience;
}

export async function deleteExperience(id: string): Promise<boolean> {
  const { error } = await supabase.from('experiences').delete().eq('id', id).eq('event_id', EVENT_ID);
  if (error) {
    console.error('[db] deleteExperience', error);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Posts (live photo wall)                                             */
/* ------------------------------------------------------------------ */

export async function fetchPosts(opts?: { includeHidden?: boolean; limit?: number }): Promise<Post[]> {
  let q = supabase.from('posts').select('*').eq('event_id', EVENT_ID).order('created_at', { ascending: false });
  if (!opts?.includeHidden) q = q.eq('hidden', false).eq('approved', true);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) {
    console.error('[db] fetchPosts', error);
    return [];
  }
  return (data as Post[]) ?? [];
}

export async function fetchMyPosts(): Promise<Post[]> {
  const sid = getSessionId();
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('session_id', sid)
    .eq('event_id', EVENT_ID)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[db] fetchMyPosts', error);
    return [];
  }
  return (data as Post[]) ?? [];
}

export async function setPostHidden(id: string, hidden: boolean): Promise<boolean> {
  const { error } = await supabase.from('posts').update({ hidden }).eq('id', id).eq('event_id', EVENT_ID);
  if (error) {
    console.error('[db] setPostHidden', error);
    return false;
  }
  return true;
}

export async function deletePost(id: string): Promise<boolean> {
  const { error } = await supabase.from('posts').delete().eq('id', id).eq('event_id', EVENT_ID);
  if (error) {
    console.error('[db] deletePost', error);
    return false;
  }
  return true;
}

/**
 * Realtime subscription to new posts on the wall.
 * Returns an unsubscribe function. `onInsert` fires for each newly created post.
 */
export function subscribeToPosts(handlers: {
  onInsert?: (post: Post) => void;
  onUpdate?: (post: Post) => void;
  onDelete?: (id: string) => void;
}): () => void {
  const channel = supabase
    .channel('posts-stream')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: `event_id=eq.${EVENT_ID}` }, (payload) => {
      handlers.onInsert?.(payload.new as Post);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts', filter: `event_id=eq.${EVENT_ID}` }, (payload) => {
      handlers.onUpdate?.(payload.new as Post);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
      handlers.onDelete?.((payload.old as { id: string }).id);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

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

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Upload a studio asset (PNG/SVG/GLB). Returns its public URL. */
export async function uploadAsset(file: Blob, name?: string): Promise<string | null> {
  const path = `${uid()}-${(name ?? 'asset').replace(/[^a-z0-9.\-_]/gi, '_')}.${extFor(file, 'png')}`;
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

/** List every file in the assets bucket (newest first) — powers the Assets library. */
export async function listAssets(): Promise<StoredAsset[]> {
  const { data, error } = await supabase.storage
    .from(ASSETS_BUCKET)
    .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
  if (error || !data) {
    if (error) console.error('[db] listAssets', error);
    return [];
  }
  return data
    .filter((f) => f.name && !f.name.startsWith('.'))
    .map((f) => {
      const meta = (f.metadata ?? null) as { size?: number; mimetype?: string } | null;
      return {
        name: f.name,
        path: f.name,
        url: publicUrl(ASSETS_BUCKET, f.name),
        size: meta?.size,
        mimetype: meta?.mimetype,
        created_at: f.created_at ?? undefined,
      };
    });
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

/** Upload a captured photo/video and create the wall post. Returns the created Post. */
export async function submitPost(input: SubmitPostInput): Promise<Post | null> {
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
      session_id: getSessionId(),
      width: input.width ?? null,
      height: input.height ?? null,
      event_id: EVENT_ID,
    })
    .select()
    .single();
  if (error) {
    console.error('[db] submitPost insert', error);
    return null;
  }
  return data as Post;
}

/* ------------------------------------------------------------------ */
/* Challenges                                                          */
/* ------------------------------------------------------------------ */

export async function fetchChallenges(opts?: { activeOnly?: boolean }): Promise<Challenge[]> {
  let q = supabase.from('challenges').select('*').eq('event_id', EVENT_ID).order('sort_order').order('created_at');
  if (opts?.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) {
    console.error('[db] fetchChallenges', error);
    return [];
  }
  return (data as Challenge[]) ?? [];
}

export async function createChallenge(c: Partial<Challenge>): Promise<Challenge | null> {
  const row = {
    title: c.title ?? 'New Challenge',
    description: c.description ?? null,
    emoji: c.emoji ?? '✨',
    points: c.points ?? 10,
    sort_order: c.sort_order ?? 0,
    active: c.active ?? true,
    event_id: EVENT_ID,
  };
  const { data, error } = await supabase.from('challenges').insert(row).select().single();
  if (error) {
    console.error('[db] createChallenge', error);
    return null;
  }
  return data as Challenge;
}

export async function updateChallenge(id: string, patch: Partial<Challenge>): Promise<boolean> {
  const { error } = await supabase.from('challenges').update(patch).eq('id', id).eq('event_id', EVENT_ID);
  if (error) {
    console.error('[db] updateChallenge', error);
    return false;
  }
  return true;
}

export async function deleteChallenge(id: string): Promise<boolean> {
  const { error } = await supabase.from('challenges').delete().eq('id', id).eq('event_id', EVENT_ID);
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
  showQR: false,           // off by default — admin/operator turns it on
  showLeaderboard: true,
  showChallenges: true,
  galleryScroll: false,    // static masonry grid (clickable, no duplicates)
  galleryScrollSpeed: 1,
  slideshowInterval: 6,
  defaultExperienceId: null,
};

export async function getWallSettings(): Promise<WallSettings> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'wall').eq('event_id', EVENT_ID).maybeSingle();
  if (error || !data) return DEFAULT_WALL_SETTINGS;
  return { ...DEFAULT_WALL_SETTINGS, ...(data.value as Partial<WallSettings>) };
}

export async function setWallSettings(patch: Partial<WallSettings>): Promise<WallSettings> {
  const current = await getWallSettings();
  const value = { ...current, ...patch };
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'wall', value, updated_at: new Date().toISOString(), event_id: EVENT_ID }, { onConflict: 'event_id,key' });
  if (error) console.error('[db] setWallSettings', error);
  return value;
}

export function subscribeToSettings(onChange: (s: WallSettings) => void): () => void {
  const channel = supabase
    .channel('app-settings-stream')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `event_id=eq.${EVENT_ID}` },
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

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).eq('event_id', EVENT_ID).maybeSingle();
  if (error || !data) return fallback;
  return { ...fallback, ...(data.value as Partial<T>) };
}

async function setSetting<T extends object>(key: string, value: T): Promise<T> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString(), event_id: EVENT_ID }, { onConflict: 'event_id,key' });
  if (error) console.error('[db] setSetting', key, error);
  return value;
}

export const DEFAULT_LANDING: LandingContent = {
  eyebrow: activeEvent.copy.fullName,
  title: 'Join the Photo Booth',
  subtitle: activeEvent.copy.tagline,
  intro: '',
  steps: activeEvent.copy.steps.length
    ? activeEvent.copy.steps.map((s) => ({ title: s.title, body: s.body }))
    : [
        { title: 'Scan QR', body: '' },
        { title: 'Select a Filter', body: '' },
        { title: 'Snap Photo', body: '' },
        { title: 'Share', body: '' },
      ],
  ctaLabel: 'Open the Booth',
  url: '',
  footer: activeEvent.copy.fullName,
};

export async function getLandingContent(): Promise<LandingContent> {
  const c = await getSetting<LandingContent>('landing', DEFAULT_LANDING);
  // steps may come back as a non-array if never set — guard it
  if (!Array.isArray(c.steps) || c.steps.length === 0) c.steps = DEFAULT_LANDING.steps;
  return c;
}

export async function setLandingContent(content: LandingContent): Promise<LandingContent> {
  return setSetting('landing', content);
}

export function subscribeToLanding(onChange: (c: LandingContent) => void): () => void {
  const channel = supabase
    .channel('landing-stream')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `event_id=eq.${EVENT_ID}` },
      (payload) => {
        const row = payload.new as { key?: string; value?: Partial<LandingContent> };
        if (row.key !== 'landing') return;
        if (row.value) onChange({ ...DEFAULT_LANDING, ...row.value });
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

export async function getBranding(): Promise<BrandingOverrides> {
  return getSetting<BrandingOverrides>('branding', DEFAULT_BRANDING);
}

export async function setBranding(patch: BrandingOverrides): Promise<BrandingOverrides> {
  const current = await getBranding();
  return setSetting('branding', { ...current, ...patch });
}

export function subscribeToBranding(onChange: (b: BrandingOverrides) => void): () => void {
  const channel = supabase
    .channel('branding-stream')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `event_id=eq.${EVENT_ID}` },
      (payload) => {
        const row = payload.new as { key?: string; value?: BrandingOverrides };
        if (row.key !== 'branding') return;
        if (row.value) onChange(row.value);
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

const DEFAULT_PRESET_OVERRIDES: PresetOverrides = { hidden: [], order: [] };

export async function getPresetOverrides(): Promise<PresetOverrides> {
  const o = await getSetting<PresetOverrides>('presets', DEFAULT_PRESET_OVERRIDES);
  return {
    hidden: Array.isArray(o.hidden) ? o.hidden : [],
    order: Array.isArray(o.order) ? o.order : [],
  };
}

export async function setPresetOverrides(patch: Partial<PresetOverrides>): Promise<PresetOverrides> {
  const current = await getPresetOverrides();
  return setSetting('presets', { ...current, ...patch });
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
export async function fetchLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const [{ data: posts, error }, challenges] = await Promise.all([
    supabase
      .from('posts')
      .select('session_id, guest_name, challenge_id, created_at')
      .eq('hidden', false)
      .eq('event_id', EVENT_ID),
    fetchChallenges({ activeOnly: true }),
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
