/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * homeAssets — the homepage ("/", BeamyPage) asset OVERRIDES the owner edits
 * at /admin/home-assets: the looks Beamy tries on in the hero, the AR step's
 * frames / 3D props / filters / effects (with each prop's anchor, size and
 * offset on him), the floating scene props, and the photos of the live wall,
 * the keepsake album, the virtual-celebrations card and the challenge step,
 * plus the demo event the real QR code opens.
 *
 * Pure (no React, no supabase, no runtime import of the page's defaults) so it
 * runs in vitest's node env and can ride landingContent.ts.
 *
 * Storage: the `home` key of the existing landing_content draft/published
 * jsonb (migration 030). No migration, the same draft → publish flow, the same
 * anonymous read (get_landing_content). normalizeLandingContent calls
 * normalizeHomeAssets, so BOTH admin editors (/admin/landing and
 * /admin/home-assets) carry this key through when they save the whole blob.
 *
 * EVERYTHING HERE IS AN OVERRIDE. An empty list means "use the page's bundled
 * list" (lib/beamyAssets HOME_ASSET_DEFAULTS), never "show nothing": a cleared
 * list must not blank a section of the public page. lib/beamyAssetsMerge lays
 * these over the defaults.
 *
 * Every URL is validated HERE, at normalize time (resolveAssetUrl): https on a
 * Supabase public-object path, or a same-origin bundled file under /models/ or
 * /guides/. Anything else is DROPPED, so the page can hand any surviving URL
 * straight to <img> or the GLB loader. The page's films are not here: they
 * live on /guides now.
 */
import { AR_FX_KINDS } from './arFx';
import type { FrameOpening, HomeLook, LookCategory } from './beamyAssets';
import type { PropFit } from './beamyLooks';

export type { HomeLook, LookCategory, FrameOpening, PropFit };

/* ── Types ──────────────────────────────────────────────────────────── */

export const LOOK_CATEGORIES: readonly LookCategory[] = ['frame', 'prop', 'filter', 'effect'];
/** The hero only puts things ON him: a filter or effect has nothing to wear there. */
export const HERO_CATEGORIES: readonly LookCategory[] = ['frame', 'prop'];

export interface HomeOverrides {
  /** Replaces the hero's try-on list when non-empty (frames and props only). */
  heroLooks: HomeLook[];
  /** Replaces the AR step's picker when non-empty (all four categories). */
  arLooks: HomeLook[];
  /** GLBs replacing the floating scene props BY INDEX (their spots stay the page's). */
  sceneProps: string[];
  /** The live wall's photo pool. Used only with at least WALL_MIN_PHOTOS. */
  wallPhotos: string[];
  /** The keepsake album. Used only with at least KEEPSAKE_MIN_PHOTOS. */
  keepsakePhotos: string[];
  /** The photos on step 6's virtual-celebrations card (its copy stays in code). */
  virtualPhotos: string[];
  /** The challenge step's photo. */
  challengePhoto?: string;
  /** The event the real QR code opens. */
  demoEventSlug?: string;
}

/* ── Limits ─────────────────────────────────────────────────────────── */

export const HERO_LOOKS_MAX = 12;
export const AR_LOOKS_MAX = 40;
export const SCENE_PROPS_MAX = 7;
export const WALL_PHOTOS_MAX = 30;
/** The wall is 3×3 and needs spares to swap in (the page uses an override only past 9). */
export const WALL_MIN_PHOTOS = 10;
export const KEEPSAKE_PHOTOS_MAX = 12;
/** The album shows six (StoryScenes uses an override only with six or more). */
export const KEEPSAKE_MIN_PHOTOS = 6;
export const VIRTUAL_PHOTOS_MAX = 6;
export const NAME_MAX = 60;
export const LINE_MAX = 140;
export const OCCASION_MAX = 40;
const URL_MAX = 2000;

export const EMPTY_HOME_OVERRIDES: HomeOverrides = {
  heroLooks: [],
  arLooks: [],
  sceneProps: [],
  wallPhotos: [],
  keepsakePhotos: [],
  virtualPhotos: [],
};

/* ── URL gate ───────────────────────────────────────────────────────── */

export type AssetKind = 'image' | 'video' | 'model';

const PUBLIC_OBJECT = '/storage/v1/object/public/';
const VIDEO_EXT = /\.(mp4|webm)$/i;
const MODEL_EXT = /\.glb$/i;
const IMAGE_EXT = /\.(png|webp|jpe?g|gif|avif)$/i;
/** A same-origin bundled file: the props under /models/, the frame pack under /guides/. */
const BUNDLED_PATH = /^\/(models|guides)\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

/**
 * `candidate` when it is safe to hand to <img>/<video>/the GLB loader as a
 * `kind` asset, else undefined. Accepts ONLY https: URLs on a Supabase
 * public-object path (uploads, Studio library copies) and plain root-relative
 * bundled paths under /models/ or /guides/ (no `//`, no `..`). The extension
 * must match the kind: storage serves whatever was uploaded, so it is the only
 * pre-flight signal there is.
 */
export function resolveAssetUrl(candidate: unknown, kind: AssetKind): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  const t = candidate.trim();
  if (t === '' || t.length > URL_MAX) return undefined;
  let path: string;
  if (t.startsWith('/')) {
    if (!BUNDLED_PATH.test(t) || t.includes('//') || t.includes('..')) return undefined;
    path = t;
  } else {
    let u: URL;
    try {
      u = new URL(t);
    } catch {
      return undefined;
    }
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || !u.pathname.startsWith(PUBLIC_OBJECT)) return undefined;
    if (u.pathname.includes('..')) return undefined;
    path = u.pathname;
  }
  const ok = kind === 'video' ? VIDEO_EXT.test(path) : kind === 'model' ? MODEL_EXT.test(path) : IMAGE_EXT.test(path);
  return ok ? t : undefined;
}

/** The file kinds a look's `url` may be, by category. */
export function urlKindsFor(category: LookCategory): AssetKind[] {
  if (category === 'prop') return ['model'];
  if (category === 'frame') return ['image'];
  return ['image', 'video'];
}

/**
 * The page's built-in, file-less looks (lib/beamyAssets lookAction): a filter
 * may be `tint:<#rgb | #rrggbb | prismatic>` (recolours Beamy), an effect
 * `fx:<sparkles | lib/arFx kinds>`. Anything else in those schemes is refused.
 */
const TINT_RE = /^tint:(prismatic|#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)$/;
export const FX_IDS: readonly string[] = ['sparkles', ...AR_FX_KINDS];

/** A file kind, or 'builtin' for a `tint:` / `fx:` look. */
export type LookUrlKind = AssetKind | 'builtin';

/** The kind `url` resolves as for this category, or undefined when it fits none. */
export function lookUrlKind(url: unknown, category: LookCategory): LookUrlKind | undefined {
  if (typeof url === 'string') {
    const t = url.trim();
    if (category === 'filter' && TINT_RE.test(t)) return 'builtin';
    if (category === 'effect' && t.startsWith('fx:') && FX_IDS.includes(t.slice(3))) return 'builtin';
  }
  return urlKindsFor(category).find((k) => resolveAssetUrl(url, k) !== undefined);
}

/** The CSS colour a `tint:` look shows as in the admin, or undefined. */
export function tintSwatch(url: string): string | undefined {
  const m = TINT_RE.exec(url.trim());
  if (m === null) return undefined;
  return m[1] === 'prismatic' ? 'conic-gradient(#38BDF8, #A78BFA, #F472B6, #38BDF8)' : m[1];
}

/* ── Where a prop sits on Beamy: anchor presets ─────────────────────── */

export type AnchorId = 'crown' | 'hat' | 'tall' | 'wide' | 'glasses' | 'mask' | 'paint' | 'neck' | 'ears';

/**
 * One starting fit per place a prop can go on him, in his `body` bone's space
 * (metres; his crown tip at 0.48, +z toward the viewer). Copied from the
 * homepage's own measured fits (lib/beamyAssets: the crown, elf hat, top hat,
 * antlers, aviators, mask, face paint, necklace and the split earring pair).
 * The admin picks one, then tunes size and offset.
 */
export const ANCHOR_PRESETS: Record<AnchorId, { label: string; place: 'head' | 'face' | 'neck' | 'ears'; fit: PropFit }> = {
  crown: { label: 'Head: crown', place: 'head', fit: { width: 0.4, at: [0, 0.29, 0], align: 'base' } },
  hat: { label: 'Head: hat, tilted back', place: 'head', fit: { width: 0.3, at: [0, 0.35, -0.01], align: 'base', tilt: -0.14 } },
  tall: { label: 'Head: tall hat', place: 'head', fit: { width: 0.34, at: [0, 0.4, 0], align: 'base', tilt: -0.06 } },
  wide: { label: 'Head: wide (antlers)', place: 'head', fit: { width: 0.58, at: [0, 0.33, -0.02], align: 'base' } },
  glasses: { label: 'Face: glasses', place: 'face', fit: { width: 0.42, at: [0, 0.235, -0.01], align: 'centre' } },
  mask: { label: 'Face: mask', place: 'face', fit: { width: 0.574, at: [0, 0.267, 0.102], align: 'centre' } },
  paint: { label: 'Face: face paint', place: 'face', fit: { width: 0.54, at: [0, 0.255, 0.09], align: 'centre' } },
  neck: { label: 'Neck: necklace', place: 'neck', fit: { width: 0.13, at: [0, 0.06, 0.2], align: 'centre' } },
  ears: { label: 'Ears: earring pair', place: 'ears', fit: { width: 0.042, pair: 0.4, at: [0, 0.15, 0.135], align: 'centre' } },
};
export const ANCHOR_IDS = Object.keys(ANCHOR_PRESETS) as AnchorId[];

/** Bounds every fit is clamped to (a typo can never fling a prop off screen). */
export const FIT_WIDTH_MIN = 0.02;
export const FIT_WIDTH_MAX = 1.2;
export const FIT_AT_MAX = 0.8;
export const FIT_TILT_MAX = 0.8;
/** Rotation in his face's plane (PropFit.roll), radians either way. */
export const FIT_ROLL_MAX = 0.8;
export const FIT_PAIR_MIN = 0.05;
export const FIT_PAIR_MAX = 1;

/** The preset a fit is closest to (a split pair is always the ears). */
export function anchorOf(fit: PropFit | undefined): AnchorId {
  if (fit === undefined) return 'crown';
  if (fit.pair !== undefined) return 'ears';
  let best: AnchorId = 'crown';
  let bestD = Infinity;
  for (const id of ANCHOR_IDS) {
    const p = ANCHOR_PRESETS[id].fit;
    if (p.pair !== undefined) continue;
    const d = Math.hypot(p.at[0] - fit.at[0], p.at[1] - fit.at[1], p.at[2] - fit.at[2]) + (p.align === fit.align ? 0 : 1)
      + Math.abs((p.tilt ?? 0) - (fit.tilt ?? 0)) * 0.05 + Math.abs(p.width - fit.width) * 0.02;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

/** A fresh copy of a preset's fit (never shares its arrays). */
export function presetFit(id: AnchorId): PropFit {
  const f = ANCHOR_PRESETS[id].fit;
  return { ...f, at: [f.at[0], f.at[1], f.at[2]] };
}

/** A first guess at where a prop goes, from its file or name (the admin can change it). */
export function guessAnchor(nameOrUrl: string): AnchorId {
  const s = nameOrUrl.toLowerCase();
  if (/earring|stud|hoop/.test(s)) return 'ears';
  if (/necklace|chain|pendant|choker|bowtie|bow-tie|tie\b|scarf|lei/.test(s)) return 'neck';
  if (/glasses|shades|aviator|sunglass|goggle|visor/.test(s)) return 'glasses';
  if (/paint|tattoo|freckle|blush/.test(s)) return 'paint';
  if (/mask|masquerade|beard|nose|moustache|mustache/.test(s)) return 'mask';
  if (/antler|horn|ears|tree/.test(s)) return 'wide';
  if (/top-?hat|tophat|chef/.test(s)) return 'tall';
  if (/hat|cap|beanie|beret|bonnet|helmet/.test(s)) return 'hat';
  return 'crown';
}

/* ── Normalizer helpers ─────────────────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/\s+/g, ' ');
  return t === '' ? undefined : t.slice(0, max);
}

function num(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, v));
}

/** A fit the page can use as is, or undefined (then the page uses its category default). */
export function normalizeFit(raw: unknown): PropFit | undefined {
  if (!isRecord(raw)) return undefined;
  const width = num(raw.width, FIT_WIDTH_MIN, FIT_WIDTH_MAX);
  const at = Array.isArray(raw.at) && raw.at.length === 3 ? raw.at.map((n) => num(n, -FIT_AT_MAX, FIT_AT_MAX)) : [];
  if (width === undefined || at.length !== 3 || at.some((n) => n === undefined)) return undefined;
  const align = raw.align === 'centre' ? 'centre' : raw.align === 'base' ? 'base' : undefined;
  if (align === undefined) return undefined;
  const tilt = num(raw.tilt, -FIT_TILT_MAX, FIT_TILT_MAX);
  const roll = num(raw.roll, -FIT_ROLL_MAX, FIT_ROLL_MAX);
  const pair = raw.pair === undefined ? undefined : num(raw.pair, FIT_PAIR_MIN, FIT_PAIR_MAX);
  return {
    width,
    at: at as [number, number, number],
    align,
    ...(tilt === undefined || tilt === 0 ? {} : { tilt }),
    ...(roll === undefined || roll === 0 ? {} : { roll }),
    ...(pair === undefined ? {} : { pair }),
  };
}

/** A stable slug for a look id (the page keys taps and React lists on it). */
export function slugifyLookId(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function normalizeOpening(raw: unknown): FrameOpening | undefined {
  if (!isRecord(raw)) return undefined;
  const [top, bottom, left, right] = [raw.top, raw.bottom, raw.left, raw.right].map((n) => num(n, 0, 1));
  if (top === undefined || bottom === undefined || left === undefined || right === undefined) return undefined;
  // A window must have area: a collapsed or inverted one would hide Beamy.
  if (bottom - top < 0.05 || right - left < 0.05) return undefined;
  return { top, bottom, left, right };
}

/** One look, render-safe, or null when it cannot be shown in `allowed` categories. */
export function normalizeLook(raw: unknown, allowed: readonly LookCategory[] = LOOK_CATEGORIES): HomeLook | null {
  if (!isRecord(raw)) return null;
  const category = allowed.find((c) => c === raw.category);
  if (category === undefined) return null;
  if (lookUrlKind(raw.url, category) === undefined) return null;
  const name = text(raw.name, NAME_MAX);
  if (name === undefined) return null;
  const id = slugifyLookId(typeof raw.id === 'string' ? raw.id : '') || slugifyLookId(name);
  if (id === '') return null;
  const thumb = resolveAssetUrl(raw.thumb, 'image');
  const line = text(raw.line, LINE_MAX);
  const isFrame = category === 'frame';
  const withProp = isFrame ? resolveAssetUrl(raw.with, 'model') : undefined;
  // A frame's fit only places the prop it is worn with.
  const fit = category === 'prop' || withProp !== undefined ? normalizeFit(raw.fit) : undefined;
  const opening = isFrame ? normalizeOpening(raw.opening) : undefined;
  const occasion = isFrame ? text(raw.occasion, OCCASION_MAX) : undefined;
  return {
    id,
    name,
    category,
    url: (raw.url as string).trim(),
    ...(thumb === undefined ? {} : { thumb }),
    ...(line === undefined ? {} : { line }),
    ...(fit === undefined ? {} : { fit }),
    ...(opening === undefined ? {} : { opening }),
    ...(withProp === undefined ? {} : { with: withProp }),
    ...(occasion === undefined ? {} : { occasion }),
  };
}

/** A list of looks: invalid entries dropped, ids made unique, capped. */
export function normalizeLooks(raw: unknown, allowed: readonly LookCategory[], max: number): HomeLook[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: HomeLook[] = [];
  for (const r of raw) {
    const l = normalizeLook(r, allowed);
    if (l === null) continue;
    let id = l.id;
    for (let n = 2; seen.has(id); n++) id = `${l.id}-${n}`;
    seen.add(id);
    out.push({ ...l, id });
    if (out.length >= max) break;
  }
  return out;
}

function urlList(raw: unknown, kind: AssetKind, max: number, dedupe = true): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    const u = resolveAssetUrl(r, kind);
    if (u !== undefined && (!dedupe || !out.includes(u))) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** Scene props are by index, so a gap (null / '') keeps the page's prop in that spot. */
function slotList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = raw.slice(0, max).map((r) => resolveAssetUrl(r, 'model') ?? '');
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * TOTAL: any input → render-safe overrides. Unknown keys (an older draft's
 * `films`) are dropped, invalid entries are dropped, lists are de-duplicated
 * and capped. normalizeHomeAssets(normalizeHomeAssets(x)) equals
 * normalizeHomeAssets(x).
 */
export function normalizeHomeAssets(raw: unknown): HomeOverrides {
  const r = isRecord(raw) ? raw : {};
  const challengePhoto = resolveAssetUrl(r.challengePhoto, 'image');
  const slug = typeof r.demoEventSlug === 'string' ? r.demoEventSlug.trim().toLowerCase() : '';
  return {
    heroLooks: normalizeLooks(r.heroLooks, HERO_CATEGORIES, HERO_LOOKS_MAX),
    arLooks: normalizeLooks(r.arLooks, LOOK_CATEGORIES, AR_LOOKS_MAX),
    sceneProps: slotList(r.sceneProps, SCENE_PROPS_MAX),
    wallPhotos: urlList(r.wallPhotos, 'image', WALL_PHOTOS_MAX),
    keepsakePhotos: urlList(r.keepsakePhotos, 'image', KEEPSAKE_PHOTOS_MAX),
    virtualPhotos: urlList(r.virtualPhotos, 'image', VIRTUAL_PHOTOS_MAX),
    ...(challengePhoto === undefined ? {} : { challengePhoto }),
    ...(SLUG_RE.test(slug) ? { demoEventSlug: slug } : {}),
  };
}

/** How many slots differ from the bundled page: the admin's "N custom" badge (0 = all built-in). */
export function countOverrides(a: HomeOverrides): number {
  return (
    (a.heroLooks.length > 0 ? 1 : 0) +
    (a.arLooks.length > 0 ? 1 : 0) +
    a.sceneProps.filter((u) => u !== '').length +
    (a.wallPhotos.length >= WALL_MIN_PHOTOS ? 1 : 0) +
    (a.keepsakePhotos.length >= KEEPSAKE_MIN_PHOTOS ? 1 : 0) +
    (a.virtualPhotos.length > 0 ? 1 : 0) +
    (a.challengePhoto !== undefined ? 1 : 0) +
    (a.demoEventSlug !== undefined ? 1 : 0)
  );
}
