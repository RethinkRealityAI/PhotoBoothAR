/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * homeAssets — the homepage ASSET slots the owner manages from
 * /admin/home-assets (films, AR looks, 3D scene props, wall / keepsake photos,
 * the challenge photo, the demo event the real QR code opens).
 *
 * Pure (no React, no supabase import) so it runs in vitest's node env.
 *
 * Storage: the `home` key of the existing landing_content draft/published
 * jsonb (migration 030) — so no migration, the same draft → publish flow, and
 * the same anonymous read (get_landing_content). normalizeLandingContent calls
 * normalizeHomeAssets, so BOTH admin editors (/admin/landing and
 * /admin/home-assets) preserve this key when they save the whole blob.
 *
 * Contract with the page (agreed with the /beamy thread, 2026-11-18):
 * EVERYTHING HERE IS AN OVERRIDE. Every field is optional / may be empty; the
 * page keeps its bundled defaults (HOME_ASSET_DEFAULTS on its side) and swaps
 * an override in only when present. An empty list means "use the defaults",
 * never "show nothing" — an accidentally cleared list must not blank a
 * section of the public page.
 *
 * Every URL is validated HERE, at normalize time, by resolveAssetUrl: an entry
 * that is not a safe URL of the right kind is DROPPED, so the page can hand
 * any surviving URL straight to <img>/<video>/the GLB loader.
 */

/* ── Types ──────────────────────────────────────────────────────────── */

export type HomeFilmId = 'booth' | 'wall' | 'challenges' | 'cards';
export const HOME_FILM_IDS: readonly HomeFilmId[] = ['booth', 'wall', 'challenges', 'cards'];

export interface HomeFilm {
  video?: string;
  poster?: string;
}

/** The AR step's tabs. The hero uses the same shape. */
export type HomeLookCategory = 'frame' | 'filter' | 'prop' | 'effect';
export const HOME_LOOK_CATEGORIES: readonly HomeLookCategory[] = ['frame', 'filter', 'prop', 'effect'];

/** Where a prop's fitted box is pinned on Beamy — the page's PropFit shape
 *  (body-bone space, metres; see src/lib/beamyLooks.ts on the /beamy branch). */
export interface HomeLookFit {
  width: number;
  at: [number, number, number];
  align: 'base' | 'centre';
  tilt?: number;
}

export interface HomeLook {
  id: string;
  name: string;
  category: HomeLookCategory;
  /** prop → a GLB; frame → a transparent image; filter → image, video or `tint:…`;
   *  effect → image, video or `fx:…`. */
  url: string;
  thumb?: string;
  /** Beamy's bubble line while he wears it. */
  line?: string;
  /** Props only. Absent = the page's default fit for its category. */
  fit?: HomeLookFit;
  /** Frames only: the see-through window as fractions of the frame (top/bottom of
   *  its height, left/right of its width). Absent = the page's default window. */
  opening?: HomeFrameOpening;
}

export interface HomeFrameOpening { top: number; bottom: number; left: number; right: number }

export interface HomeAssets {
  films: Partial<Record<HomeFilmId, HomeFilm>>;
  heroLooks: HomeLook[];
  arLooks: HomeLook[];
  /** GLBs replacing the floating scene props BY INDEX (position/size stay the page's). */
  sceneProps: string[];
  /** The live wall's photo pool. Used only when it has at least WALL_MIN_PHOTOS. */
  wallPhotos: string[];
  /** The photos that fly together and compile into the keepsake video. */
  keepsakePhotos: string[];
  challengePhoto?: string;
  /** The event the landing page's real QR code opens. */
  demoEventSlug?: string;
}

/* ── Limits ─────────────────────────────────────────────────────────── */

export const LOOKS_MAX = 16;
export const SCENE_PROPS_MAX = 7;
export const WALL_PHOTOS_MAX = 30;
/** The wall is 3×3 and needs a spare to swap in — fewer falls back to defaults. */
export const WALL_MIN_PHOTOS = 10;
export const KEEPSAKE_PHOTOS_MAX = 12;
const NAME_MAX = 80;
const LINE_MAX = 140;
const URL_MAX = 2000;

export const EMPTY_HOME_ASSETS: HomeAssets = {
  films: {},
  heroLooks: [],
  arLooks: [],
  sceneProps: [],
  wallPhotos: [],
  keepsakePhotos: [],
};

/* ── URL gate ───────────────────────────────────────────────────────── */

export type AssetKind = 'image' | 'video' | 'model';

const PUBLIC_OBJECT = '/storage/v1/object/public/';
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const MODEL_EXT = /\.(glb|gltf)$/i;
const IMAGE_EXT = /\.(png|webp|jpe?g|gif|avif|svg)$/i;
/** A same-origin bundled file (public/models/props/…, public/guides/frames/…). */
const BUNDLED_PATH = /^\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

/**
 * `candidate` when it is safe to hand to <img>/<video>/the GLB loader as a
 * `kind` asset, else undefined. Accepts ONLY:
 *   • https: URLs on a Supabase public-object path (uploads + library copies);
 *   • root-relative bundled paths (no `//`, no `..`, plain characters).
 * The extension must match the kind — storage serves whatever was uploaded, so
 * it is the only pre-flight signal available.
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
    if (u.protocol !== 'https:' || !u.pathname.includes(PUBLIC_OBJECT)) return undefined;
    path = u.pathname;
  }
  const ok =
    kind === 'video' ? VIDEO_EXT.test(path) : kind === 'model' ? MODEL_EXT.test(path) : IMAGE_EXT.test(path);
  return ok ? t : undefined;
}

/** The asset kinds a look's `url` may be, by category. */
export function urlKindsFor(category: HomeLookCategory): AssetKind[] {
  if (category === 'prop') return ['model'];
  if (category === 'frame') return ['image'];
  return ['image', 'video'];
}

/**
 * The page's built-in, file-less filter and effect looks (agreed with the
 * /beamy thread, src/lib/beamyAssets.ts there): a filter may be
 * `tint:<#hex | prismatic>` (recolours Beamy) and an effect
 * `fx:<sparkles | beam | dance>`. Anything else in those schemes is refused.
 */
const TINT_RE = /^tint:(prismatic|#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)$/;
const FX_RE = /^fx:(sparkles|beam|dance)$/;

/** A file kind, or 'builtin' for a `tint:` / `fx:` look. */
export type LookUrlKind = AssetKind | 'builtin';

/** The kind `url` resolves as for this category, or undefined when it fits none. */
export function lookUrlKind(url: unknown, category: HomeLookCategory): LookUrlKind | undefined {
  if (typeof url === 'string') {
    const t = url.trim();
    if (category === 'filter' && TINT_RE.test(t)) return 'builtin';
    if (category === 'effect' && FX_RE.test(t)) return 'builtin';
  }
  return urlKindsFor(category).find((k) => resolveAssetUrl(url, k) !== undefined);
}

/** The CSS colour a `tint:` look shows as in the admin, or undefined. */
export function tintSwatch(url: string): string | undefined {
  const m = TINT_RE.exec(url.trim());
  if (m === null) return undefined;
  return m[1] === 'prismatic' ? 'conic-gradient(#a78bfa, #60a5fa, #34d399, #fbbf24, #f472b6, #a78bfa)' : m[1];
}

/* ── Prop placement presets (admin UI; the page only sees the numbers) ── */

export type FitPresetId = 'crown' | 'hat' | 'eyes' | 'wide';

/** Measured on Beamy by the /beamy thread (beamyLooks.ts): crown, Santa hat,
 *  neon shades, antlers. `wide` is for anything broader than his head. */
export const FIT_PRESETS: Record<FitPresetId, { label: string; fit: HomeLookFit }> = {
  crown: { label: 'On his head', fit: { width: 0.32, at: [0, 0.31, 0], align: 'base' } },
  hat: { label: 'Hat, tilted back', fit: { width: 0.29, at: [0, 0.35, -0.01], align: 'base', tilt: -0.14 } },
  eyes: { label: 'Over his eyes', fit: { width: 0.4, at: [0, 0.225, 0.19], align: 'centre' } },
  wide: { label: 'Wide headwear', fit: { width: 0.58, at: [0, 0.33, -0.02], align: 'base' } },
};
export const FIT_WIDTH_MIN = 0.05;
export const FIT_WIDTH_MAX = 1.2;

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

function normalizeFit(raw: unknown): HomeLookFit | undefined {
  if (!isRecord(raw)) return undefined;
  const width = num(raw.width, FIT_WIDTH_MIN, FIT_WIDTH_MAX);
  const at = Array.isArray(raw.at) && raw.at.length === 3 ? raw.at.map((n) => num(n, -2, 2)) : [];
  if (width === undefined || at.length !== 3 || at.some((n) => n === undefined)) return undefined;
  const align = raw.align === 'centre' ? 'centre' : raw.align === 'base' ? 'base' : undefined;
  if (align === undefined) return undefined;
  const tilt = num(raw.tilt, -Math.PI, Math.PI);
  return { width, at: at as [number, number, number], align, ...(tilt === undefined || tilt === 0 ? {} : { tilt }) };
}

/** A stable slug for a look id; the page uses it as a React key. */
export function slugifyLookId(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function normalizeOpening(raw: unknown): HomeFrameOpening | undefined {
  if (!isRecord(raw)) return undefined;
  const [top, bottom, left, right] = [raw.top, raw.bottom, raw.left, raw.right].map((n) => num(n, 0, 1));
  if (top === undefined || bottom === undefined || left === undefined || right === undefined) return undefined;
  // A window must have area: a collapsed or inverted one would hide Beamy.
  if (bottom - top < 0.05 || right - left < 0.05) return undefined;
  return { top, bottom, left, right };
}

function normalizeLook(raw: unknown): HomeLook | null {
  if (!isRecord(raw)) return null;
  const category = HOME_LOOK_CATEGORIES.find((c) => c === raw.category);
  if (category === undefined) return null;
  if (lookUrlKind(raw.url, category) === undefined) return null;
  const name = text(raw.name, NAME_MAX);
  if (name === undefined) return null;
  const id = slugifyLookId(typeof raw.id === 'string' ? raw.id : '') || slugifyLookId(name);
  if (id === '') return null;
  const thumb = resolveAssetUrl(raw.thumb, 'image');
  const line = text(raw.line, LINE_MAX);
  const fit = category === 'prop' ? normalizeFit(raw.fit) : undefined;
  const opening = category === 'frame' ? normalizeOpening(raw.opening) : undefined;
  return {
    id,
    name,
    category,
    url: (raw.url as string).trim(),
    ...(thumb === undefined ? {} : { thumb }),
    ...(line === undefined ? {} : { line }),
    ...(fit === undefined ? {} : { fit }),
    ...(opening === undefined ? {} : { opening }),
  };
}

function normalizeLooks(raw: unknown): HomeLook[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: HomeLook[] = [];
  for (const r of raw) {
    const l = normalizeLook(r);
    if (l === null) continue;
    // Ids must be unique (React keys, tap targets): suffix a repeat.
    let id = l.id;
    for (let n = 2; seen.has(id); n++) id = `${l.id}-${n}`;
    seen.add(id);
    out.push({ ...l, id });
    if (out.length >= LOOKS_MAX) break;
  }
  return out;
}

function urlList(raw: unknown, kind: AssetKind, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    const u = resolveAssetUrl(r, kind);
    if (u !== undefined && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeFilms(raw: unknown): Partial<Record<HomeFilmId, HomeFilm>> {
  const r = isRecord(raw) ? raw : {};
  const out: Partial<Record<HomeFilmId, HomeFilm>> = {};
  for (const id of HOME_FILM_IDS) {
    const f = isRecord(r[id]) ? (r[id] as Record<string, unknown>) : {};
    const video = resolveAssetUrl(f.video, 'video');
    const poster = resolveAssetUrl(f.poster, 'image');
    if (video === undefined && poster === undefined) continue;
    out[id] = { ...(video === undefined ? {} : { video }), ...(poster === undefined ? {} : { poster }) };
  }
  return out;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * TOTAL: any input → a render-safe HomeAssets. Unknown keys are dropped,
 * invalid entries are dropped (never kept for "render-time" checks), lists are
 * de-duplicated and capped. normalize(normalize(x)) === normalize(x).
 */
export function normalizeHomeAssets(raw: unknown): HomeAssets {
  const r = isRecord(raw) ? raw : {};
  const challengePhoto = resolveAssetUrl(r.challengePhoto, 'image');
  const slug = typeof r.demoEventSlug === 'string' ? r.demoEventSlug.trim().toLowerCase() : '';
  return {
    films: normalizeFilms(r.films),
    heroLooks: normalizeLooks(r.heroLooks),
    arLooks: normalizeLooks(r.arLooks),
    sceneProps: urlList(r.sceneProps, 'model', SCENE_PROPS_MAX),
    wallPhotos: urlList(r.wallPhotos, 'image', WALL_PHOTOS_MAX),
    keepsakePhotos: urlList(r.keepsakePhotos, 'image', KEEPSAKE_PHOTOS_MAX),
    ...(challengePhoto === undefined ? {} : { challengePhoto }),
    ...(SLUG_RE.test(slug) ? { demoEventSlug: slug } : {}),
  };
}

/* ── Page-side helpers ──────────────────────────────────────────────── */

/** The override list when it has entries, else the page's defaults. */
export function pickList<T>(override: readonly T[], defaults: readonly T[], min = 1): readonly T[] {
  return override.length >= min ? override : defaults;
}

/** The wall pool to render: the override only when the wall can run on it. */
export function pickWallPhotos(assets: HomeAssets, defaults: readonly string[]): readonly string[] {
  return pickList(assets.wallPhotos, defaults, WALL_MIN_PHOTOS);
}

/** How many slots differ from the defaults — the admin's "N overrides" badge. */
export function countOverrides(a: HomeAssets): number {
  const films = Object.values(a.films).reduce((n, f) => n + (f?.video ? 1 : 0) + (f?.poster ? 1 : 0), 0);
  return (
    films +
    a.heroLooks.length +
    a.arLooks.length +
    a.sceneProps.length +
    a.wallPhotos.length +
    a.keepsakePhotos.length +
    (a.challengePhoto ? 1 : 0) +
    (a.demoEventSlug ? 1 : 0)
  );
}

/* ── Picking from the shared Studio library ─────────────────────────── */

/** The fields of an admin-api `list_library_items` row this module reads. */
export interface LibraryItemLike {
  id: string;
  name: string;
  kind: string;
  assetUrl: string | null;
  thumbnailUrl: string | null;
}

/** The homepage category a library item lands in by default. */
export function categoryForLibraryKind(kind: string): HomeLookCategory {
  if (kind === 'border') return 'frame';
  if (kind === '3d_attachment') return 'prop';
  if (kind === 'shader') return 'filter';
  return 'effect'; // 2d_filter (stickers), composite scenes
}

/**
 * A library item as a homepage look, or null when it has no usable media for
 * its category (e.g. a shader filter with no thumbnail). A filter / effect
 * with no image asset shows its thumbnail — the "after" shot of the look.
 */
export function lookFromLibraryItem(item: LibraryItemLike, category = categoryForLibraryKind(item.kind)): HomeLook | null {
  const thumb = resolveAssetUrl(item.thumbnailUrl, 'image');
  const candidates = category === 'filter' || category === 'effect' ? [item.assetUrl, item.thumbnailUrl] : [item.assetUrl];
  const url = candidates.find((c) => lookUrlKind(c, category) !== undefined);
  if (url == null) return null;
  const fit = category === 'prop' ? FIT_PRESETS.crown.fit : undefined;
  return normalizeLook({ id: `lib-${item.id.slice(0, 8)}-${item.name}`, name: item.name, category, url, thumb, fit });
}

/** Bundled props and frames shipped in public/, offered beside the library. */
export interface BuiltinAsset {
  name: string;
  category: HomeLookCategory;
  url: string;
  thumb: string;
}

const BUILTIN_PROPS: Array<[string, string]> = [
  ['royal-crown', 'Royal crown'], ['queens-tiara', 'Tiara'], ['halo-ring', 'Halo'], ['neon-shades', 'Neon shades'],
  ['santa-hat', 'Santa hat'], ['reindeer-antlers', 'Reindeer antlers'], ['elf-hat', 'Elf hat'], ['elf-ears', 'Elf ears'],
  ['holly-crown', 'Holly crown'], ['rudolph-nose', 'Rudolph nose'], ['santa-beard', 'Santa beard'],
  ['snowflake-tiara', 'Snowflake tiara'], ['tree-hat', 'Tree hat'],
];
const BUILTIN_FRAMES: Array<[string, string]> = [
  ['gala-magazine-cover', 'Gala cover'], ['wedding-magazine-cover', 'Wedding cover'], ['wedding-arch-mask', 'Wedding arch'],
  ['wedding-monogram-drop', 'Wedding monogram'], ['birthday-monogram-corner', 'Birthday monogram'],
  ['birthday-character-hands', 'Birthday hands'], ['christmas-santa-cover', 'Christmas cover'],
  ['christmas-elf-hands', 'Elf hands'], ['gala-artdeco-mask', 'Art deco'], ['corporate-badge-mask', 'Corporate badge'],
  ['cultural-asoebi-arch', 'Asoebi arch'], ['cultural-mehndi-arch', 'Mehndi arch'], ['nye-countdown', 'NYE countdown'],
  ['launch-product-side', 'Product launch'],
];

export const BUILTIN_ASSETS: BuiltinAsset[] = [
  ...BUILTIN_PROPS.map(([f, name]) => ({
    name, category: 'prop' as const, url: `/models/props/${f}.glb`, thumb: `/models/props/${f}.webp`,
  })),
  ...BUILTIN_FRAMES.map(([f, name]) => ({
    name, category: 'frame' as const, url: `/guides/frames/${f}.png`, thumb: `/guides/frames/thumb/${f}.webp`,
  })),
];

/** The page's built-in filters and effects (mirrors its defaults), offered under Built-in. */
export const BUILTIN_EFFECT_LOOKS: HomeLook[] = [
  { id: 'ar-prismatic', name: 'Prismatic', category: 'filter', url: 'tint:prismatic' },
  { id: 'ar-aurora', name: 'Aurora', category: 'filter', url: 'tint:#34D399' },
  { id: 'ar-neon', name: 'Neon pulse', category: 'filter', url: 'tint:#E879F9' },
  { id: 'ar-golden', name: 'Golden hour', category: 'filter', url: 'tint:#FFB547' },
  { id: 'ar-sparkles', name: 'Sparkle burst', category: 'effect', url: 'fx:sparkles' },
  { id: 'ar-beam', name: 'Light beam', category: 'effect', url: 'fx:beam' },
  { id: 'ar-dance', name: 'Dance party', category: 'effect', url: 'fx:dance' },
];

/** A bundled asset as a homepage look (props get the crown fit to start). */
export function lookFromBuiltin(a: BuiltinAsset): HomeLook | null {
  return normalizeLook({
    id: `builtin-${a.name}`, name: a.name, category: a.category, url: a.url, thumb: a.thumb,
    fit: a.category === 'prop' ? (/shades|nose|beard/i.test(a.url) ? FIT_PRESETS.eyes.fit : /antlers|tree/i.test(a.url) ? FIT_PRESETS.wide.fit : FIT_PRESETS.crown.fit) : undefined,
  });
}
