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
  toneForColor,
  type EventScene,
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
