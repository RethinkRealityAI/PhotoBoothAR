/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scene themes — the ONE contract for how a platform event's guest pages and
 * its live wall are dressed. Pure (no React, no DOM, no supabase import) so
 * every normalizer is unit-tested and the host editor, the guest pages and the
 * wall all read the same answers.
 *
 * Two stored shapes, both inside jsonb that already exists (no migration):
 *   - events.config.scene        → EventScene   (welcome page, splash, booth intro)
 *   - app_settings 'wall'.wallLook → WallLook    (the projected wall)
 *
 * Absent = today's behaviour, byte-for-byte. Legacy coded events never read
 * either (callers gate on `source === 'db'`).
 *
 * Owner direction (2026-11-19): subtle gradients that fit the liquid-glass
 * brand; dark AND light; a full-bleed image, a colour, a gradient or a frame;
 * a set of templates — and the gold line-art look is opt-in, never the default.
 */

/* ── Palettes: the subtle gradients shared by scenes and walls ─────────── */

export type SceneTone = 'dark' | 'light';

export interface ScenePalette {
  id: string;
  name: string;
  tone: SceneTone;
  /** Three stops, top-left → middle → bottom-right. */
  stops: [string, string, string];
  /** A soft highlight colour used for the glow layers and the accent. */
  glow: string;
  /** Accent for pills/selected states on this palette (readable on it). */
  accent: string;
}

export const SCENE_PALETTES: readonly ScenePalette[] = [
  // The brand field (platform.css): steel blue → deep indigo → mauve-rose.
  { id: 'dusk', name: 'Dusk', tone: 'dark', stops: ['#4A5FA8', '#33318A', '#7E5A9E'], glow: '#B9B6FF', accent: '#D4D6FF' },
  { id: 'aurora', name: 'Aurora', tone: 'dark', stops: ['#1F5C73', '#2B2F7A', '#5B3D8F'], glow: '#7FE3D8', accent: '#BDF4EC' },
  { id: 'midnight', name: 'Midnight', tone: 'dark', stops: ['#121A3A', '#0D1028', '#2A1E4A'], glow: '#6E7BFF', accent: '#C7CCFF' },
  { id: 'ember', name: 'Ember', tone: 'dark', stops: ['#4A1F4F', '#2C1638', '#8A4252'], glow: '#FFB38A', accent: '#FFD2BA' },
  { id: 'lagoon', name: 'Lagoon', tone: 'dark', stops: ['#0F4B5C', '#123247', '#2D5F7A'], glow: '#8EE3FF', accent: '#C6F1FF' },
  { id: 'graphite', name: 'Graphite', tone: 'dark', stops: ['#2A2C33', '#16171C', '#34303D'], glow: '#C9C3E8', accent: '#E6E2F7' },
  { id: 'pearl', name: 'Pearl', tone: 'light', stops: ['#E9E8FF', '#F7F5FB', '#F4E4EE'], glow: '#B9B6FF', accent: '#4B47B8' },
  { id: 'mist', name: 'Mist', tone: 'light', stops: ['#DCE6FA', '#EEF1FB', '#E3DEF7'], glow: '#8FA8F0', accent: '#3E4FA6' },
  { id: 'blush', name: 'Blush', tone: 'light', stops: ['#FBE3DA', '#F8EEF2', '#E9DDF6'], glow: '#F2A7B8', accent: '#9A3D5C' },
  { id: 'sage', name: 'Sage', tone: 'light', stops: ['#DDE9DF', '#F4F2EA', '#E6E3D2'], glow: '#9CC4A7', accent: '#2F5E44' },
] as const;

export const DEFAULT_PALETTE_ID = 'dusk';

export function paletteById(id: unknown): ScenePalette | undefined {
  return typeof id === 'string' ? SCENE_PALETTES.find((p) => p.id === id) : undefined;
}

/**
 * The layered CSS background for a palette: a soft diagonal base plus two
 * glow pools, so the field reads as depth rather than a flat two-stop sweep.
 */
export function paletteCss(p: ScenePalette): string {
  const [a, b, c] = p.stops;
  return [
    `radial-gradient(60% 55% at 18% 12%, ${withAlpha(p.glow, p.tone === 'dark' ? 0.28 : 0.35)} 0%, transparent 70%)`,
    `radial-gradient(55% 50% at 86% 88%, ${withAlpha(c, 0.55)} 0%, transparent 72%)`,
    `linear-gradient(135deg, ${a} 0%, ${b} 52%, ${c} 100%)`,
  ].join(', ');
}

/* ── Validation helpers ─────────────────────────────────────────────── */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v.trim());
}

/** '#RRGGBB' + alpha → rgba(). Non-hex input passes through unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(hex.trim().slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** WCAG relative luminance of a '#RRGGBB'; null for anything else. */
export function luminance(hex: string): number | null {
  if (!isHex(hex)) return null;
  const n = parseInt(hex.trim().slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** The tone a solid colour implies (text goes light on dark, dark on light). */
export function toneForColor(hex: string): SceneTone {
  const l = luminance(hex);
  return l !== null && l > 0.4 ? 'light' : 'dark';
}

const PUBLIC_OBJECT = '/storage/v1/object/public/';

/**
 * A background/frame image URL that is safe to put in CSS `url()` or an
 * <img src>: https Supabase public objects (what uploadAsset returns) or a
 * root-relative bundled path ('/frames/x.png'). Anything else — data:,
 * javascript:, http:, protocol-relative, quotes/parens that could break out
 * of `url("…")` — is rejected so a stored value can never inject CSS.
 */
export function resolveSceneImageUrl(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  const v = candidate.trim();
  if (v === '' || v.length > 2000) return undefined;
  if (/["'()\\\s<>]/.test(v)) return undefined;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (!url.pathname.includes(PUBLIC_OBJECT)) return undefined;
  return v;
}

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* ── Event scene (welcome page, splash, booth intro) ────────────────── */

/** Decorative layer a template adds over its field. 'gilded' is the old gold
 *  line-art look — available, never the default. */
export type SceneOrnament = 'none' | 'beams' | 'orbs' | 'grain' | 'gilded';

/** How a full-bleed photo sits in the page (the setup wizard's fit tool).
 *  x/y = the focal point in % of the image (0…100, what `object-position`
 *  takes); zoom = 1…3 scale about that point. Absent = centred, no zoom. */
export interface SceneImageFit {
  x: number;
  y: number;
  zoom: number;
}

/** Coerce a stored fit; the default (centre, 1×) is dropped so old and new
 *  scenes compare equal. */
export function normalizeImageFit(raw: unknown): SceneImageFit | undefined {
  if (!isRecord(raw)) return undefined;
  const fit = {
    x: Math.round(clamp(raw.x, 0, 100, 50) * 10) / 10,
    y: Math.round(clamp(raw.y, 0, 100, 50) * 10) / 10,
    zoom: Math.round(clamp(raw.zoom, 1, 3, 1) * 100) / 100,
  };
  return fit.x === 50 && fit.y === 50 && fit.zoom === 1 ? undefined : fit;
}

export type EventScene = (
  /** A curated template: palette + ornament, picked as one look. */
  | { kind: 'template'; id: string }
  /** A subtle gradient from the shared palettes. */
  | { kind: 'gradient'; paletteId: string }
  /** One solid colour. */
  | { kind: 'color'; color: string }
  /** A full-bleed photo, dimmed for legibility (0 = none … 0.8). */
  | { kind: 'image'; url: string; dim: number; tone: SceneTone; fit?: SceneImageFit }
  /** A frame artwork shown as the page backdrop over a palette. */
  | { kind: 'frame'; url: string; paletteId: string }
) & {
  /** Optional decorative border around the whole guest page (additive,
   *  2026-11-19 round 2). Absent = no border; 'none' is never stored. */
  border?: ScenePageBorder;
};

/** A decorative frame around the whole guest welcome page. 'gilded' is the
 *  gold line-art look — opt-in, like the Gilded template. */
export type ScenePageBorder = 'none' | 'glow' | 'glass' | 'filmstrip' | 'gilded';
export const SCENE_PAGE_BORDERS: readonly ScenePageBorder[] = ['none', 'glow', 'glass', 'filmstrip', 'gilded'];
export const SCENE_PAGE_BORDER_META: Readonly<Record<ScenePageBorder, { label: string; blurb: string }>> = {
  none: { label: 'None', blurb: 'Edge to edge, no border.' },
  glow: { label: 'Glow', blurb: 'A thin rim of light that slowly travels round.' },
  glass: { label: 'Glass', blurb: 'A frosted glass frame with soft rounded corners.' },
  filmstrip: { label: 'Film strip', blurb: 'Sprocket rails down both sides, like a photo strip.' },
  gilded: { label: 'Gilded', blurb: 'Fine gold lines with corner flourishes.' },
};

/** Total coercion of a stored border; anything unknown is 'none'. */
export function normalizePageBorder(raw: unknown): ScenePageBorder {
  return SCENE_PAGE_BORDERS.includes(raw as ScenePageBorder) ? (raw as ScenePageBorder) : 'none';
}

export interface SceneTemplate {
  id: string;
  name: string;
  blurb: string;
  paletteId: string;
  ornament: SceneOrnament;
}

export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  { id: 'beamwall', name: 'Beamwall', blurb: 'Our dusk gradient with soft light beams.', paletteId: 'dusk', ornament: 'beams' },
  { id: 'aurora-glow', name: 'Aurora', blurb: 'Teal into violet with floating light.', paletteId: 'aurora', ornament: 'orbs' },
  { id: 'midnight-club', name: 'Midnight', blurb: 'Deep navy for late nights and big screens.', paletteId: 'midnight', ornament: 'beams' },
  { id: 'ember-lounge', name: 'Ember', blurb: 'Warm plum and rose, lounge-lit.', paletteId: 'ember', ornament: 'orbs' },
  { id: 'pearl-studio', name: 'Pearl', blurb: 'Bright, airy and clean. Great for daytime.', paletteId: 'pearl', ornament: 'orbs' },
  { id: 'blush-garden', name: 'Blush', blurb: 'Peach to lilac for showers and weddings.', paletteId: 'blush', ornament: 'grain' },
  { id: 'sage-linen', name: 'Sage', blurb: 'Soft green and linen, calm and natural.', paletteId: 'sage', ornament: 'grain' },
  { id: 'gilded-noir', name: 'Gilded', blurb: 'Classic gold line-art on graphite.', paletteId: 'graphite', ornament: 'gilded' },
] as const;

export const DEFAULT_SCENE_TEMPLATE_ID = 'beamwall';

export function sceneTemplateById(id: unknown): SceneTemplate | undefined {
  return typeof id === 'string' ? SCENE_TEMPLATES.find((t) => t.id === id) : undefined;
}

/**
 * Total coercion of a stored `events.config.scene`. Returns undefined for
 * absent/invalid input — the caller then keeps today's background. Never
 * throws; an unsafe image URL drops the whole scene rather than half-render.
 */
export function normalizeScene(raw: unknown): EventScene | undefined {
  const scene = normalizeSceneKind(raw);
  if (!scene || !isRecord(raw)) return scene;
  // The page border rides on the scene object; only a real choice is kept,
  // so a scene saved without one normalizes exactly as before.
  const border = normalizePageBorder(raw.border);
  return border === 'none' ? scene : { ...scene, border };
}

/** The scene itself, by kind (normalizeScene adds the optional border). */
function normalizeSceneKind(raw: unknown): EventScene | undefined {
  if (!isRecord(raw)) return undefined;
  switch (raw.kind) {
    case 'template':
      return sceneTemplateById(raw.id) ? { kind: 'template', id: raw.id as string } : undefined;
    case 'gradient':
      return paletteById(raw.paletteId) ? { kind: 'gradient', paletteId: raw.paletteId as string } : undefined;
    case 'color':
      return isHex(raw.color) ? { kind: 'color', color: (raw.color as string).trim() } : undefined;
    case 'image': {
      const url = resolveSceneImageUrl(raw.url);
      if (!url) return undefined;
      const fit = normalizeImageFit(raw.fit);
      return {
        kind: 'image',
        url,
        dim: clamp(raw.dim, 0, 0.8, 0.35),
        tone: raw.tone === 'light' ? 'light' : 'dark',
        ...(fit ? { fit } : {}),
      };
    }
    case 'frame': {
      const url = resolveSceneImageUrl(raw.url);
      if (!url) return undefined;
      return { kind: 'frame', url, paletteId: paletteById(raw.paletteId)?.id ?? DEFAULT_PALETTE_ID };
    }
    default:
      return undefined;
  }
}

/** Everything a renderer needs, resolved once. */
export interface ResolvedScene {
  tone: SceneTone;
  /** CSS `background` for the full-bleed field (always set). */
  background: string;
  /** Full-bleed image (photo or frame art), already validated. */
  imageUrl?: string;
  /** 'cover' for photos, 'contain' for frame art. */
  imageFit?: 'cover' | 'contain';
  /** Photo focal point + zoom (cover photos only; absent = centred, 1×). */
  imagePlacement?: SceneImageFit;
  /** Legibility scrim over the image, 0…0.8. */
  dim: number;
  ornament: SceneOrnament;
  /** Accent suggestion for chrome on this scene. */
  accent: string;
}

export function resolveScene(scene: EventScene | undefined): ResolvedScene {
  const fallback = paletteById(DEFAULT_PALETTE_ID)!;
  if (!scene) {
    return { tone: 'dark', background: paletteCss(fallback), dim: 0, ornament: 'beams', accent: fallback.accent };
  }
  switch (scene.kind) {
    case 'template': {
      const t = sceneTemplateById(scene.id)!;
      const p = paletteById(t.paletteId) ?? fallback;
      return { tone: p.tone, background: paletteCss(p), dim: 0, ornament: t.ornament, accent: p.accent };
    }
    case 'gradient': {
      const p = paletteById(scene.paletteId) ?? fallback;
      return { tone: p.tone, background: paletteCss(p), dim: 0, ornament: 'none', accent: p.accent };
    }
    case 'color': {
      const tone = toneForColor(scene.color);
      return {
        tone,
        background: scene.color,
        dim: 0,
        ornament: 'none',
        accent: tone === 'light' ? '#2E2C7E' : '#FFFFFF',
      };
    }
    case 'image':
      return {
        tone: scene.tone,
        background: scene.tone === 'light' ? '#F4F2FA' : '#14132E',
        imageUrl: scene.url,
        imageFit: 'cover',
        ...(scene.fit ? { imagePlacement: scene.fit } : {}),
        dim: scene.dim,
        ornament: 'none',
        accent: scene.tone === 'light' ? '#2E2C7E' : '#FFFFFF',
      };
    case 'frame': {
      const p = paletteById(scene.paletteId) ?? fallback;
      return {
        tone: p.tone,
        background: paletteCss(p),
        imageUrl: scene.url,
        imageFit: 'contain',
        dim: 0,
        ornament: 'none',
        accent: p.accent,
      };
    }
  }
}

/* ── Wall look (the projected live wall) ────────────────────────────── */

/** How the feed is laid out. 'grid' = an N×N wall of live tiles. */
export type WallLayout = 'grid' | 'masonry' | 'marquee' | 'carousel' | 'slideshow';
export const WALL_LAYOUTS: readonly WallLayout[] = ['grid', 'masonry', 'marquee', 'carousel', 'slideshow'];

export type WallGridSize = 3 | 4 | 5;
export const WALL_GRID_SIZES: readonly WallGridSize[] = [3, 4, 5];

/** How a grid tile changes when a new photo takes its place. */
export type WallTransition = 'flip' | 'fade' | 'zoom';
export const WALL_TRANSITIONS: readonly WallTransition[] = ['flip', 'fade', 'zoom'];

export type WallBackdrop =
  /** Follow the event's own scene/theme (today's behaviour). */
  | { kind: 'event' }
  | { kind: 'gradient'; paletteId: string }
  | { kind: 'color'; color: string }
  | { kind: 'image'; url: string; dim: number };

export interface WallLook {
  layout: WallLayout;
  gridSize: WallGridSize;
  transition: WallTransition;
  backdrop: WallBackdrop;
  /** 'auto' = whatever the backdrop implies. */
  tone: 'auto' | SceneTone;
}

export const DEFAULT_WALL_LOOK: WallLook = {
  layout: 'masonry',
  gridSize: 4,
  transition: 'flip',
  backdrop: { kind: 'event' },
  tone: 'auto',
};

function normalizeBackdrop(raw: unknown): WallBackdrop {
  if (!isRecord(raw)) return { kind: 'event' };
  switch (raw.kind) {
    case 'gradient':
      return paletteById(raw.paletteId) ? { kind: 'gradient', paletteId: raw.paletteId as string } : { kind: 'event' };
    case 'color':
      return isHex(raw.color) ? { kind: 'color', color: (raw.color as string).trim() } : { kind: 'event' };
    case 'image': {
      const url = resolveSceneImageUrl(raw.url);
      return url ? { kind: 'image', url, dim: clamp(raw.dim, 0, 0.8, 0.45) } : { kind: 'event' };
    }
    default:
      return { kind: 'event' };
  }
}

/**
 * Total coercion of the stored wall look. `legacyGalleryScroll` is the
 * pre-existing WallSettings.galleryScroll flag: a wall that never saved a
 * look keeps exactly the gallery it had (marquee when that flag was on).
 */
export function normalizeWallLook(raw: unknown, legacyGalleryScroll = false): WallLook {
  const base: WallLook = { ...DEFAULT_WALL_LOOK, layout: legacyGalleryScroll ? 'marquee' : 'masonry' };
  if (!isRecord(raw)) return base;
  return {
    layout: WALL_LAYOUTS.includes(raw.layout as WallLayout) ? (raw.layout as WallLayout) : base.layout,
    gridSize: WALL_GRID_SIZES.includes(raw.gridSize as WallGridSize) ? (raw.gridSize as WallGridSize) : base.gridSize,
    transition: WALL_TRANSITIONS.includes(raw.transition as WallTransition)
      ? (raw.transition as WallTransition)
      : base.transition,
    backdrop: normalizeBackdrop(raw.backdrop),
    tone: raw.tone === 'dark' || raw.tone === 'light' ? raw.tone : 'auto',
  };
}

/**
 * What the wall should paint behind the feed, or null = keep rendering the
 * event's own background (EventBackground) exactly as today.
 */
export function resolveWallBackdrop(look: WallLook): (ResolvedScene & { followsEvent: false }) | null {
  const b = look.backdrop;
  let scene: ResolvedScene;
  if (b.kind === 'event') return null;
  if (b.kind === 'gradient') scene = resolveScene({ kind: 'gradient', paletteId: b.paletteId });
  else if (b.kind === 'color') scene = resolveScene({ kind: 'color', color: b.color });
  else scene = resolveScene({ kind: 'image', url: b.url, dim: b.dim, tone: look.tone === 'light' ? 'light' : 'dark' });
  const tone = look.tone === 'auto' ? scene.tone : look.tone;
  return { ...scene, tone, followsEvent: false };
}

/** The wall tone in effect: explicit choice, else the backdrop's, else dark. */
export function wallTone(look: WallLook, eventSceneTone: SceneTone = 'dark'): SceneTone {
  if (look.tone !== 'auto') return look.tone;
  return resolveWallBackdrop(look)?.tone ?? eventSceneTone;
}

/** Tiles on screen for a grid size (3 → 9). */
export function gridCellCount(size: WallGridSize): number {
  return size * size;
}

/* ── Wall look: shared copy + comparisons (host editor AND the wall) ──── */

/** Names and one-line descriptions for each layout — the wall's view tabs
 *  and the host's Wall design picker read the same words. */
export const WALL_LAYOUT_META: Readonly<Record<WallLayout, { label: string; blurb: string }>> = {
  grid: { label: 'Grid', blurb: 'An edge-to-edge wall of live tiles that turn over one at a time.' },
  masonry: { label: 'Gallery', blurb: 'Every photo in a flowing masonry wall, newest first.' },
  marquee: { label: 'Scrolling', blurb: 'Rows of photos gliding past in opposite directions.' },
  carousel: { label: 'Carousel', blurb: 'A slow turning ring of photos in 3D.' },
  slideshow: { label: 'Slideshow', blurb: 'One photo at a time, full screen, with a gentle drift.' },
};

export const WALL_TRANSITION_META: Readonly<Record<WallTransition, { label: string }>> = {
  flip: { label: 'Flip' },
  fade: { label: 'Fade' },
  zoom: { label: 'Zoom' },
};

/** True when two looks put the SAME arrangement on screen (layout + grid
 *  size). The wall drops a device's own tab choice when the host changes
 *  this, and only this — a colour change must not yank a projector's view. */
export function sameWallArrangement(a: WallLook, b: WallLook): boolean {
  return a.layout === b.layout && a.gridSize === b.gridSize;
}

/** Structural equality of two normalized looks (the editor's dirty check). */
export function wallLookEquals(a: WallLook, b: WallLook): boolean {
  if (a.layout !== b.layout || a.gridSize !== b.gridSize || a.transition !== b.transition || a.tone !== b.tone) {
    return false;
  }
  const x = a.backdrop;
  const y = b.backdrop;
  if (x.kind === 'event' && y.kind === 'event') return true;
  if (x.kind === 'gradient' && y.kind === 'gradient') return x.paletteId === y.paletteId;
  if (x.kind === 'color' && y.kind === 'color') return x.color.toLowerCase() === y.color.toLowerCase();
  if (x.kind === 'image' && y.kind === 'image') return x.url === y.url && x.dim === y.dim;
  return false;
}

/** A short human summary for the host ("Grid 4×4 · Aurora · Dark"). */
export function describeWallLook(look: WallLook): string {
  const layout = look.layout === 'grid'
    ? `Grid ${look.gridSize}×${look.gridSize}`
    : WALL_LAYOUT_META[look.layout].label;
  const b = look.backdrop;
  const backdrop = b.kind === 'event'
    ? 'Event theme'
    : b.kind === 'gradient'
      ? paletteById(b.paletteId)?.name ?? 'Gradient'
      : b.kind === 'color'
        ? 'Solid colour'
        : 'Your image';
  const tone = look.tone === 'auto' ? 'Auto' : look.tone === 'dark' ? 'Dark' : 'Light';
  return `${layout} · ${backdrop} · ${tone}`;
}
