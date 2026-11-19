/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure helpers behind the scene-dressed guest pages (GuestWelcome, the booth
 * splash and intro) and the host's "Event page look" picker (ScenePicker).
 * No React, no DOM, no supabase import — every branch is unit-tested.
 *
 * The stored contract itself lives in sceneThemes.ts; this module only
 * answers the questions the UI asks about it.
 */
import type { Experience, Post } from '../types';
import {
  isHex,
  normalizeScene,
  paletteById,
  resolveSceneImageUrl,
  sceneTemplateById,
  SCENE_TEMPLATES,
  toneForColor,
  type EventScene,
  type ScenePageBorder,
  type SceneTone,
} from './sceneThemes';

/** The kinds of look the picker offers, in tab order. */
export type SceneKind = EventScene['kind'];
export const SCENE_KINDS: readonly SceneKind[] = ['template', 'gradient', 'color', 'image', 'frame'];

/** '#RRGGBB' → 'r, g, b' for `rgba(var(--x), a)` tokens; null for anything else. */
export function rgbTriplet(hex: string): string | null {
  if (!isHex(hex)) return null;
  const n = parseInt(hex.trim().slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/* ── Photo uploads ─────────────────────────────────────────────────── */

export const SCENE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const SCENE_UPLOAD_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/**
 * Why a picked file cannot become a page background, or null when it can.
 * GIF/SVG are refused on purpose: an animated or scripted background is not
 * what this control promises.
 */
export function sceneUploadError(file: { type: string; size: number }): string | null {
  if (!SCENE_UPLOAD_TYPES.includes(file.type)) return 'Use a JPG, PNG, WebP or AVIF photo.';
  if (!(file.size > 0)) return 'That file is empty. Pick another photo.';
  if (file.size > SCENE_UPLOAD_MAX_BYTES) return 'That photo is over 10 MB. Pick a smaller one.';
  return null;
}

/* ── Frames as backdrops ───────────────────────────────────────────── */

export interface SceneFrameChoice {
  id: string;
  name: string;
  url: string;
}

/**
 * The event's frames that can dress the page: border/overlay experiences
 * whose art is a real stored file. Built-in frames are inline `data:` SVGs,
 * which resolveSceneImageUrl refuses by design (a stored value must never be
 * able to inject markup into CSS), so they are not offered. Unpublished
 * frames are skipped — the page should not show art the booth hides.
 */
export function sceneFrameChoices(experiences: readonly Experience[]): SceneFrameChoice[] {
  const seen = new Set<string>();
  const out: SceneFrameChoice[] = [];
  for (const e of experiences) {
    if (e.kind !== 'border') continue;
    if (!e.is_published) continue;
    const url = resolveSceneImageUrl(e.asset_url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ id: e.id, name: e.name.trim() || 'Frame', url });
  }
  return out;
}

/* ── Picker state ──────────────────────────────────────────────────── */

/** Structural equality of two (normalized) scenes; undefined = the default. */
export function sceneEquals(a: EventScene | undefined, b: EventScene | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return JSON.stringify(normalizeScene(a)) === JSON.stringify(normalizeScene(b));
}

/** One line for the picker's "Now showing" status. */
export function sceneSummary(scene: EventScene | undefined): string {
  if (!scene) return 'The Beamwall default';
  switch (scene.kind) {
    case 'template':
      return `${sceneTemplateById(scene.id)?.name ?? 'Template'} template`;
    case 'gradient':
      return `${paletteById(scene.paletteId)?.name ?? 'Custom'} gradient`;
    case 'color':
      return `Solid colour ${scene.color.toUpperCase()}`;
    case 'image':
      return `Your photo, ${scene.tone} text`;
    case 'frame':
      return 'A frame from your booth';
  }
}

/**
 * The value the picker writes. A draft that fails normalization (an unsafe
 * URL, a deleted palette) is never saved half-valid: null = "nothing to save".
 */
export function sceneToSave(draft: EventScene | undefined): EventScene | null {
  return normalizeScene(draft) ?? null;
}

/**
 * A draft with the page border set. 'none' removes the field (it is never
 * stored); a border chosen before any look starts from the first template,
 * so "just add a border" is one click.
 */
export function withPageBorder(scene: EventScene | undefined, border: ScenePageBorder): EventScene | undefined {
  if (border === 'none') {
    if (!scene || scene.border === undefined) return scene;
    const { border: _drop, ...rest } = scene;
    void _drop;
    return rest as EventScene;
  }
  return { ...(scene ?? { kind: 'template', id: SCENE_TEMPLATES[0].id }), border };
}

/** The tone a scene draft implies, for the live preview's ink. */
export function draftTone(scene: EventScene | undefined, fallback: SceneTone = 'dark'): SceneTone {
  if (!scene) return fallback;
  switch (scene.kind) {
    case 'template':
      return paletteById(sceneTemplateById(scene.id)?.paletteId)?.tone ?? fallback;
    case 'gradient':
    case 'frame':
      return paletteById(scene.paletteId)?.tone ?? fallback;
    case 'image':
      return scene.tone;
    case 'color':
      return isHex(scene.color) ? toneForColor(scene.color) : fallback;
  }
}

/* ── The welcome page's live strip ─────────────────────────────────── */

/**
 * The newest photos for the welcome page's "live from the wall" strip:
 * visible, approved, still images only (a video URL in an <img> is a broken
 * tile), newest first, at most `limit`.
 */
export function recentWallPhotos(posts: readonly Post[], limit: number): Post[] {
  if (!(limit > 0)) return [];
  return posts
    .filter((p) => p.media_type === 'image' && p.approved !== false && p.hidden !== true && typeof p.image_url === 'string' && p.image_url !== '')
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, limit);
}

/* ── The welcome page's living wall (round 2) ──────────────────────── */

export interface WallFieldSize {
  cols: number;
  rows: number;
  tiles: number;
}

/**
 * How many glass tiles the tilted background wall gets for a viewport. The
 * grid is drawn larger than the screen (it is tilted and scaled), so it
 * over-fills; the clamps keep a phone at 24 tiles and a 1440 desktop at
 * 63 (9×7 is the ceiling) — a DOM budget. Only the photo and beat tiles
 * animate; the rest are still glass.
 */
export function wallFieldSize(width: number, height: number): WallFieldSize {
  const w = Number.isFinite(width) && width > 0 ? width : 390;
  const h = Number.isFinite(height) && height > 0 ? height : 844;
  const cols = Math.min(9, Math.max(4, Math.round(w / 165)));
  const rows = Math.min(7, Math.max(5, Math.ceil(h / 175) + 1));
  return { cols, rows, tiles: cols * rows };
}

/** At most this many photos live on the background wall at once. */
export const WALL_FIELD_MAX_PHOTOS = 12;

/** A small deterministic integer hash (no Math.random: stable across renders). */
function mix(n: number, seed: number): number {
  let x = (Math.imul(n + 1, 2654435761) ^ Math.imul(seed + 1, 40503)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

/**
 * A fixed, scattered visiting order over `tiles` tile indices. The wall
 * fills tiles in this order, so photo k always lands on the same tile and a
 * new arrival never shuffles the ones already up.
 */
export function tileOrder(tiles: number, seed = 7): number[] {
  if (!(tiles > 0)) return [];
  return Array.from({ length: tiles }, (_, i) => i).sort((a, b) => mix(a, seed) - mix(b, seed) || a - b);
}

/**
 * Where on screen the centre of tile `t` lands, as fractions of the
 * viewport. Mirrors platform.css `.wf-plane` (138%×128% at 50%/48%,
 * rotateX(24deg) then rotateZ(-9deg)), ignoring perspective — good to a
 * tile, which is all the ranking below needs.
 */
export function wallFieldTileCentre(t: number, cols: number, rows: number, w: number, h: number): { x: number; y: number } {
  const u = ((t % cols) + 0.5) / cols - 0.5;
  const v = (Math.floor(t / cols) + 0.5) / rows - 0.5;
  const dx = u * 1.38 * w;
  const dy = v * 1.28 * h * Math.cos((24 * Math.PI) / 180);
  const a = (-9 * Math.PI) / 180;
  return {
    x: (w / 2 + dx * Math.cos(a) - dy * Math.sin(a)) / w,
    y: (h * 0.48 + dx * Math.sin(a) + dy * Math.cos(a)) / h,
  };
}

/**
 * The tile order photos and beams fill, best first: tiles a guest can
 * actually see (on screen, not under the words or the booth preview), then
 * tiles under the page's calm pool, then tiles off screen. Within a band the
 * order is tileOrder's scatter, so the wall never fills in rows.
 * The "busy" boxes mirror GuestWelcome's layout per breakpoint.
 */
export function wallFieldSlots(cols: number, rows: number, w: number, h: number, seed = 7): number[] {
  const tiles = cols * rows;
  const scatter = tileOrder(tiles, seed);
  const rank = new Map(scatter.map((t, i) => [t, i]));
  const desk = w >= 1024;
  // [x0, x1, y0, y1] as viewport fractions.
  const busy: Array<[number, number, number, number]> = desk
    ? [[0.1, 0.52, 0.12, 0.86], [0.57, 0.85, 0.1, 0.98], [0.08, 0.3, 0, 0.12], [0.76, 0.92, 0, 0.12]]
    : [[0.06, 0.94, 0.1, 0.38], [0.1, 0.9, 0.38, 1], [0, 1, 0, 0.1]];
  const band = (t: number): number => {
    const { x, y } = wallFieldTileCentre(t, cols, rows, w, h);
    if (x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98) return 2;
    return busy.some(([x0, x1, y0, y1]) => x > x0 && x < x1 && y > y0 && y < y1) ? 1 : 0;
  };
  return Array.from({ length: tiles }, (_, t) => t).sort(
    (a, b) => band(a) - band(b) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0),
  );
}

/**
 * Photos for the wall, OLDEST first among the newest `max` — so the k-th
 * photo keeps tile order[k] as newer ones arrive behind it.
 */
export function wallFieldPhotos(posts: readonly Post[], max = WALL_FIELD_MAX_PHOTOS): Post[] {
  return recentWallPhotos(posts, max).reverse();
}

/**
 * The art that frames the welcome page's booth preview: the booth's opening
 * look when that is a frame (what a guest really sees on entry), otherwise
 * the first frame the host added themselves, otherwise none. A built-in
 * (`data:` SVG) frame is only used when it IS the opening look: the shared
 * built-in set carries other events' artwork, and the booth opens on no
 * frame at all unless one is chosen. Used as an <img src> only (never CSS);
 * anything that is not an image data URL, an https URL or a root-relative
 * path is refused.
 */
export function heroFrameUrl(catalog: readonly Experience[], openingId: string | null): string | undefined {
  const ok = (u: unknown): u is string =>
    typeof u === 'string' && (u.startsWith('data:image/') || u.startsWith('https://') || /^\/(?!\/)/.test(u));
  const frames = catalog.filter((e) => e.kind === 'border' && ok(e.asset_url));
  const opening = openingId === null ? undefined : frames.find((e) => e.id === openingId);
  const own = frames.find((e) => !String(e.asset_url).startsWith('data:'));
  return (opening ?? own)?.asset_url ?? undefined;
}
