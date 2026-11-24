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
import { stripLayout } from './photoStrip';
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

/* ── The welcome page's living wall (round 3: dense drifting columns) ── */

export interface WallFieldColumns {
  cols: number;
  /** Distinct tiles per column; the column is drawn twice for a seamless loop. */
  perCol: number;
}

/**
 * Columns of tall 9:16 tiles that over-fill the tilted plane (platform.css
 * `.wf-plane`, 138%×128% of the viewport). Clamped as a DOM budget: a phone
 * gets 4 columns, a 1440 desktop 11; every column holds enough tiles to
 * cover the plane's height plus one, so the drift never shows a gap.
 */
export function wallFieldColumns(width: number, height: number): WallFieldColumns {
  const w = Number.isFinite(width) && width > 0 ? width : 390;
  const h = Number.isFinite(height) && height > 0 ? height : 844;
  const cols = Math.min(11, Math.max(4, Math.round(w / 135)));
  const tileH = ((1.38 * w) / cols) * (16 / 9);
  const perCol = Math.min(9, Math.max(3, Math.ceil((1.28 * h) / tileH) + 1));
  return { cols, perCol };
}

/**
 * Which photo (index into `n` photos) fills each tile, column by column, so
 * a handful of photos still fills every tile without looking repeated: the
 * photos cycle in a fixed scattered order, a tile never repeats the one
 * above it (nor, with 3+ photos, the one beside it), and a column's last
 * tile never repeats its first — the column loops, so those two meet.
 * No photos = every cell is -1 (glass).
 */
export function wallFieldFill(n: number, cols: number, perCol: number, seed = 7): number[][] {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const c = Math.max(0, Math.floor(cols));
  const r = Math.max(0, Math.floor(perCol));
  if (count === 0) return Array.from({ length: c }, () => Array.from({ length: r }, () => -1));
  const perm = tileOrder(count, seed);
  const grid: number[][] = [];
  let ptr = 0;
  for (let ci = 0; ci < c; ci += 1) {
    const col: number[] = [];
    ptr = (ptr + ci * 3) % count;
    for (let ri = 0; ri < r; ri += 1) {
      const banned = new Set<number>();
      if (ri > 0) banned.add(col[ri - 1]);
      if (ri === r - 1 && r > 1) banned.add(col[0]);
      if (ci > 0 && count >= 3) banned.add(grid[ci - 1][ri]);
      let pick = -1;
      for (let k = 0; k < count; k += 1) {
        const cand = perm[(ptr + k) % count];
        if (!banned.has(cand)) { pick = cand; ptr = (ptr + k + 1) % count; break; }
      }
      if (pick === -1) {
        // Too few photos to honour every rule: keep only "not the one above".
        const above = ri > 0 ? col[ri - 1] : -1;
        pick = perm[ptr % count] === above && count > 1 ? perm[(ptr + 1) % count] : perm[ptr % count];
        ptr = (ptr + 1) % count;
      }
      col.push(pick);
    }
    grid.push(col);
  }
  return grid;
}

/* ── Photo strips on the booth preview ─────────────────────────────── */

/** Size the booth preview samples a photo at to tell a strip from a shot. */
export const STRIP_SAMPLE_W = 90;
export const STRIP_SAMPLE_H = 160;

/**
 * Is this image a photo strip (photoStrip.composeStrip: 2 or 3 panels
 * stacked on one 9:16 card) rather than a single shot? Posts carry no
 * marker, so the booth preview looks: a strip's side margins are smooth
 * card background all the way down, the gutter between panels is smooth
 * across, and the panels themselves are busy. Returns the panel count, or
 * 0 for a single shot. `lum` is row-major luminance (0-255), w×h.
 * A false "strip" only means an older photo is previewed instead, so the
 * test leans towards saying strip.
 */
export function stripShots(lum: ArrayLike<number>, w: number, h: number): 0 | 2 | 3 {
  if (!(w >= 20 && h >= 40) || lum.length < w * h) return 0;
  const at = (x: number, y: number) => lum[y * w + x];
  /** Mean neighbour difference inside a rect given as fractions. */
  const busy = (fx0: number, fx1: number, fy0: number, fy1: number, vertical = true): number => {
    const x0 = Math.max(0, Math.floor(fx0 * w));
    const x1 = Math.min(w - 2, Math.ceil(fx1 * w));
    const y0 = Math.max(0, Math.floor(fy0 * h));
    const y1 = Math.min(h - 2, Math.ceil(fy1 * h));
    let sum = 0;
    let k = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        sum += Math.abs(at(x + 1, y) - at(x, y));
        if (vertical) sum += Math.abs(at(x, y + 1) - at(x, y));
        k += 1;
      }
    }
    return k === 0 ? 0 : sum / k;
  };
  const sides = Math.max(busy(0.05, 0.13, 0.04, 0.88), busy(0.87, 0.95, 0.04, 0.88));
  if (sides > 3.5) return 0;
  for (const shots of [3, 2] as const) {
    const L = stripLayout(1080, 1920, shots);
    const p0 = L.panels[0];
    const p1 = L.panels[1];
    const px0 = (p0.x + p0.w * 0.12) / 1080;
    const px1 = (p0.x + p0.w * 0.88) / 1080;
    const gy = Math.floor(((p0.y + p0.h + p1.y) / 2 / 1920) * h);
    const gutter = busy(px0, px1, gy / h, gy / h, false);
    const panel = busy(0.3, 0.7, (p0.y + p0.h * 0.2) / 1920, (p0.y + p0.h * 0.8) / 1920);
    if (gutter <= 3.5 && panel > sides * 2 + 2) return shots;
  }
  return 0;
}

/**
 * How to show only a strip's first panel in a 9:16 preview: scale the image
 * by `scale` about the panel's centre (cx, cy as fractions), then move that
 * centre to the middle of the box. Cover-fit: the panel fills the box.
 */
export function stripPanelCrop(shots: 2 | 3): { cx: number; cy: number; scale: number } {
  const p = stripLayout(1080, 1920, shots).panels[0];
  const wf = p.w / 1080;
  const hf = p.h / 1920;
  return { cx: (p.x + p.w / 2) / 1080, cy: (p.y + p.h / 2) / 1920, scale: 1 / Math.min(wf, hf) };
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

/** What the splash pages' phone screen shows: never a guest's photo. */
export interface BoothScreen {
  /** The picture on the screen. */
  photo: string;
  /** The event's frame drawn over it, when the event has one. */
  frame?: string;
}

/** The look the phone wears when the event has no frame of its own: a
 *  shipped preview of the Confetti Party starter (inset frame + the HD
 *  royal crown on a guest), so the screen still shows a real booth look. */
export const BOOTH_SCREEN_FALLBACK = '/starters/confetti-party.webp';

/**
 * The welcome page's and booth splash's phone screen. With a frame
 * (heroFrameUrl) it is a stand-in guest wearing the event's own frame;
 * without one, a finished booth look. Live-wall photos never appear here:
 * a guest's shot inside a marketing-style phone read as noise, and could be
 * anything a guest posted. A host-chosen photo (`own`:
 * events.config.boothScreen, e.g. the guest of honour) takes the stand-in's
 * place under the frame, or fills the screen alone when there is no frame.
 */
export function boothScreen(frameUrl: string | undefined, standin: string, own?: string): BoothScreen {
  if (frameUrl) return { photo: own || standin, frame: frameUrl };
  return { photo: own || BOOTH_SCREEN_FALLBACK };
}

/* ── Booth showcase (the cards floating round the welcome page's phone) ── */

export type ShowcaseKind = 'frame' | 'prop' | 'filter';

/** What a showcase card's tag says. */
export const SHOWCASE_LABEL: Record<ShowcaseKind, string> = {
  frame: 'Frame',
  prop: 'Prop',
  filter: 'Effect',
};

export interface ShowcaseCard {
  id: string;
  kind: ShowcaseKind;
  url: string;
  /** 'cover' for a picture of the look on a person; 'contain' for bare frame art. */
  fit: 'cover' | 'contain';
}

/** Generic looks for an event that has not added its own yet: shipped
 *  previews of the built-in starters, seasonless and never the gold look. */
export const SHOWCASE_DEFAULTS: readonly ShowcaseCard[] = [
  { id: 'default-neon', kind: 'frame', url: '/starters/neon-night.webp', fit: 'cover' },
  { id: 'default-visor', kind: 'prop', url: '/starters/hero-visor.webp', fit: 'cover' },
  { id: 'default-confetti', kind: 'filter', url: '/starters/confetti-party.webp', fit: 'cover' },
  { id: 'default-halo', kind: 'filter', url: '/starters/halo-light.webp', fit: 'cover' },
  { id: 'default-soft', kind: 'frame', url: '/starters/soft-portrait.webp', fit: 'cover' },
  { id: 'default-eq', kind: 'prop', url: '/starters/equalizer-live.webp', fit: 'cover' },
];

const SHOWCASE_KIND: Partial<Record<Experience['kind'], ShowcaseKind>> = {
  border: 'frame',
  '3d_attachment': 'prop',
  '2d_filter': 'filter',
  shader: 'filter',
  composite: 'filter',
};

function safeImageUrl(u: unknown): u is string {
  return typeof u === 'string' && (u.startsWith('data:image/') || u.startsWith('https://') || /^\/(?!\/)/.test(u));
}

/**
 * Up to `max` cards: the event's own looks first (the host's uploads before
 * shared catalogue items), kinds interleaved so one category cannot fill the
 * ring, then generic defaults to make up the count. A look shows its
 * thumbnail; a frame without one shows its own art (drawn over a stand-in
 * guest). Built-in looks and looks with no picture are skipped rather than
 * drawn as a blank.
 */
export function boothShowcase(catalog: readonly Experience[], max = 6): ShowcaseCard[] {
  const pools: Record<ShowcaseKind, ShowcaseCard[]> = { frame: [], prop: [], filter: [] };
  const ranked = [...catalog.filter((e) => !e.is_global), ...catalog.filter((e) => e.is_global)];
  const seen = new Set<string>();
  for (const e of ranked) {
    const kind = SHOWCASE_KIND[e.kind];
    // Built-in engine looks have no picture of their own (and the built-in
    // frames are an old event's art): the showcase is the host's looks.
    if (!kind || e.id.startsWith('builtin:')) continue;
    let card: ShowcaseCard | null = null;
    if (safeImageUrl(e.thumbnail_url)) card = { id: e.id, kind, url: e.thumbnail_url, fit: 'cover' };
    else if ((e.kind === 'border' || e.kind === '2d_filter') && safeImageUrl(e.asset_url)) {
      card = { id: e.id, kind, url: e.asset_url, fit: 'contain' };
    }
    if (!card || seen.has(card.url)) continue;
    seen.add(card.url);
    pools[kind].push(card);
  }
  const out: ShowcaseCard[] = [];
  const order: ShowcaseKind[] = ['frame', 'prop', 'filter'];
  while (out.length < max && order.some((k) => pools[k].length > 0)) {
    for (const k of order) {
      const next = pools[k].shift();
      if (next && out.length < max) out.push(next);
    }
  }
  for (const d of SHOWCASE_DEFAULTS) {
    if (out.length >= max) break;
    if (!seen.has(d.url)) out.push(d);
  }
  return out;
}

/** The kinds the showcase actually shows, in a fixed order, for the caption under the phone. */
export function showcaseKinds(cards: readonly ShowcaseCard[]): ShowcaseKind[] {
  return (['filter', 'prop', 'frame'] as const).filter((k) => cards.some((c) => c.kind === k));
}
