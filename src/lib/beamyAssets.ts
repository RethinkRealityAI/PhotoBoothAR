/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyAssets — every swappable asset slot on the /beamy landing, in ONE
 * place, with stable ids. Pure, DOM-free, tested in node.
 *
 * `HOME_ASSET_DEFAULTS` is the bundled first paint. Its shape is the
 * homepage-assets override contract (films / heroLooks / arLooks /
 * sceneProps / wallPhotos / challengePhoto / demoEventSlug / keepsakePhotos),
 * so a later CMS override is a one-line merge over it. An undefined media
 * field means "use the bundled file" (the page resolves those imports; this
 * module stays importable in node).
 *
 * A Look's `url` is a file for frames (a transparent 9:16 PNG) and props (a
 * library GLB). Filters and effects are built into the page, so their url
 * names the built-in: `tint:<css colour | prismatic>` and
 * `fx:<sparkles | beam | dance>` (see `lookAction`). An override filter or
 * effect given as an image/clip url (what the CMS stores) shows that picture
 * on its tile.
 */
import type { FilmId } from './brandLanding';
import type { BeamyLook, PropFit } from './beamyLooks';

export type LookCategory = 'frame' | 'filter' | 'prop' | 'effect';

/** One look Beamy can wear (a CMS override uses exactly this shape). */
export interface HomeLook {
  id: string;
  name: string;
  category: LookCategory;
  url: string;
  /** A small picture for its picker tile (frames/props default to the library's own). */
  thumb?: string;
  /** His bubble line while he wears it (the hero shows it). */
  line?: string;
  /** Where a prop sits on him; absent = the category's default (DEFAULT_FIT_BY_CATEGORY). */
  fit?: PropFit;
}

export interface HomeFilm { video?: string; poster?: string; }

export interface HomeAssets {
  films: Record<FilmId, HomeFilm>;
  /** What he tries on in the hero (after his greeting). */
  heroLooks: HomeLook[];
  /** The "How it works" AR step's picker, by category. Never repeats the hero's. */
  arLooks: HomeLook[];
  /** The decorative props around the hero, by index (GLB urls). */
  sceneProps: string[];
  /** The live wall's photos; an override is used only when it has more than 9. */
  wallPhotos: string[];
  /** The challenge step's photo (Beamy with the bride); absent = the bundled one. */
  challengePhoto?: string;
  /** The event the real QR code opens. */
  demoEventSlug?: string;
  /** The photos that compile into the keepsake film; absent/empty = the wall's. */
  keepsakePhotos?: string[];
}

/**
 * Where a look sits on him when it names no fit of its own, in his `body`
 * bone's space (metres; his crown tip at 0.48). Props sit on his crown;
 * frames, filters and effects do not use a fit but carry the same sensible
 * crown anchor so an override can never leave one undefined.
 */
export const DEFAULT_FIT_BY_CATEGORY: Record<LookCategory, PropFit> = {
  prop: { width: 0.32, at: [0, 0.31, 0], align: 'base' },
  frame: { width: 0.32, at: [0, 0.31, 0], align: 'base' },
  filter: { width: 0.32, at: [0, 0.31, 0], align: 'base' },
  effect: { width: 0.32, at: [0, 0.31, 0], align: 'base' },
};

/** The AR step's category tabs, in order. */
export const AR_CATEGORIES: { id: LookCategory; label: string }[] = [
  { id: 'frame', label: 'Frames' },
  { id: 'prop', label: 'Props' },
  { id: 'filter', label: 'Filters' },
  { id: 'effect', label: 'Effects' },
];

const P = '/models/props/';
const F = '/guides/frames/';

export const HOME_ASSET_DEFAULTS: HomeAssets = {
  films: { booth: {}, wall: {}, challenges: {}, cards: {} },
  heroLooks: [
    { id: 'crown', name: 'Royal crown', category: 'prop', url: `${P}royal-crown.glb`, fit: { width: 0.32, at: [0, 0.31, 0], align: 'base' }, line: 'Real 3D filters, like this crown. Tap me for more!' },
    { id: 'hat', name: 'Santa hat', category: 'prop', url: `${P}santa-hat.glb`, fit: { width: 0.29, at: [0, 0.35, -0.01], align: 'base', tilt: -0.14 }, line: 'Build your own filters, or customise any of ours.' },
    { id: 'glasses', name: 'Neon shades', category: 'prop', url: `${P}neon-shades.glb`, fit: { width: 0.4, at: [0, 0.225, 0.19], align: 'centre' }, line: 'Got a design? Upload it, or ask us to make one.' },
    { id: 'frame', name: 'Gala cover frame', category: 'frame', url: `${F}gala-magazine-cover.png`, line: 'Frames too, made in your event’s colours.' },
    { id: 'antlers', name: 'Reindeer antlers', category: 'prop', url: `${P}reindeer-antlers.glb`, fit: { width: 0.58, at: [0, 0.33, -0.02], align: 'base' }, line: 'A whole library of 3D props for your event.' },
    { id: 'tiara', name: 'Tiara', category: 'prop', url: `${P}queens-tiara.glb`, fit: { width: 0.34, at: [0, 0.31, 0.03], align: 'base' }, line: 'Snapchat and Instagram in one, right in the browser.' },
  ],
  arLooks: [
    { id: 'ar-wedding-cover', name: 'Wedding cover', category: 'frame', url: `${F}wedding-magazine-cover.png` },
    { id: 'ar-floral-arch', name: 'Floral arch', category: 'frame', url: `${F}wedding-arch-mask.png` },
    { id: 'ar-birthday', name: 'Birthday monogram', category: 'frame', url: `${F}birthday-monogram-corner.png` },
    { id: 'ar-countdown', name: 'New Year countdown', category: 'frame', url: `${F}nye-countdown.png` },
    { id: 'ar-asoebi', name: 'Aso ebi arch', category: 'frame', url: `${F}cultural-asoebi-arch.png` },
    { id: 'ar-art-deco', name: 'Art deco mask', category: 'frame', url: `${F}gala-artdeco-mask.png` },
    { id: 'ar-holly', name: 'Holly crown', category: 'prop', url: `${P}holly-crown.glb`, fit: { width: 0.36, at: [0, 0.31, 0], align: 'base' } },
    { id: 'ar-snowflake', name: 'Snowflake tiara', category: 'prop', url: `${P}snowflake-tiara.glb`, fit: { width: 0.34, at: [0, 0.31, 0.03], align: 'base' } },
    { id: 'ar-elf', name: 'Elf hat', category: 'prop', url: `${P}elf-hat.glb`, fit: { width: 0.3, at: [0, 0.35, -0.01], align: 'base', tilt: -0.14 } },
    { id: 'ar-halo', name: 'Halo', category: 'prop', url: `${P}halo-ring.glb`, fit: { width: 0.34, at: [0, 0.5, 0], align: 'centre' } },
    { id: 'ar-prismatic', name: 'Prismatic', category: 'filter', url: 'tint:prismatic' },
    { id: 'ar-aurora', name: 'Aurora', category: 'filter', url: 'tint:#34D399' },
    { id: 'ar-neon', name: 'Neon pulse', category: 'filter', url: 'tint:#E879F9' },
    { id: 'ar-golden', name: 'Golden hour', category: 'filter', url: 'tint:#FFB547' },
    { id: 'ar-sparkles', name: 'Sparkle burst', category: 'effect', url: 'fx:sparkles' },
    { id: 'ar-beam', name: 'Light beam', category: 'effect', url: 'fx:beam' },
    { id: 'ar-dance', name: 'Dance party', category: 'effect', url: 'fx:dance' },
  ],
  sceneProps: ['royal-crown', 'halo-ring', 'queens-tiara', 'royal-crown', 'halo-ring', 'queens-tiara', 'royal-crown'].map((n) => `${P}${n}.glb`),
  wallPhotos: [],
  demoEventSlug: 'demo',
  keepsakePhotos: [],
};

/** A look's fit: its own, else its category's default. */
export function lookFit(l: HomeLook): PropFit {
  return l.fit ?? DEFAULT_FIT_BY_CATEGORY[l.category];
}

/** A look's picker picture: its own thumb, else the library's (prop .webp beside the GLB, frame thumb/), else null. */
export function lookThumb(l: { url?: string; thumb?: string; category?: LookCategory; kind?: string }): string | null {
  if (l.thumb !== undefined && l.thumb !== '') return l.thumb;
  const url = l.url;
  if (url === undefined) return null;
  if (/\.(webp|jpe?g|gif|avif)$/i.test(url)) return url;
  if (url.endsWith('.glb')) return url.replace(/\.glb$/, '.webp');
  if (url.endsWith('.png')) {
    const i = url.lastIndexOf('/');
    return `${url.slice(0, i)}/thumb/${url.slice(i + 1).replace(/\.png$/, '.webp')}`;
  }
  return null;
}

/** What selecting a look does on the stage. */
export type LookAction =
  | { kind: 'frame'; url: string }
  | { kind: 'prop'; url: string; fit: PropFit }
  | { kind: 'tint'; color: string }
  | { kind: 'fx'; fx: 'sparkles' | 'beam' | 'dance' }
  /** A filter or effect given as a picture or clip (a CMS override): shown on its tile only. */
  | { kind: 'media'; url: string }
  | { kind: 'none' };

const FX = new Set(['sparkles', 'beam', 'dance']);
/** A colour the tint accepts: #rgb / #rrggbb, or the prismatic cycle. */
const TINT_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|prismatic)$/i;

/** Parse a look into its stage action; anything malformed is 'none' (never throws). */
export function lookAction(l: HomeLook): LookAction {
  const u = l.url ?? '';
  // The CMS stores filters and effects as an image or clip url: those show on their tile.
  const media = (): LookAction => (/^(https:\/\/|\/)/.test(u) ? { kind: 'media', url: u } : { kind: 'none' });
  if (l.category === 'filter') {
    if (!u.startsWith('tint:')) return media();
    const c = u.slice(5);
    return TINT_RE.test(c) ? { kind: 'tint', color: c } : { kind: 'none' };
  }
  if (l.category === 'effect') {
    if (!u.startsWith('fx:')) return media();
    const f = u.slice(3);
    return FX.has(f) ? { kind: 'fx', fx: f as 'sparkles' | 'beam' | 'dance' } : { kind: 'none' };
  }
  if (u === '') return { kind: 'none' };
  if (l.category === 'frame') return { kind: 'frame', url: u };
  return { kind: 'prop', url: u, fit: lookFit(l) };
}

/** The frame geometry the AR step uses (his heights): the frame stands behind him, a little taller than he is. */
export const AR_FRAME_GEO = { h: 1.24, c: 0.62 } as const;

/** A HomeLook as the stage's BeamyLook (frames/props only; others are not worn). */
export function toBeamyLook(l: HomeLook, frame?: { h: number; c: number }): BeamyLook {
  const a = lookAction(l);
  if (a.kind === 'frame') return { id: l.id, name: l.name, kind: 'frame', url: a.url, line: l.line ?? '', frame };
  if (a.kind === 'prop') return { id: l.id, name: l.name, kind: 'prop', url: a.url, fit: a.fit, line: l.line ?? '' };
  return { id: l.id, name: l.name, kind: 'none', line: l.line ?? '' };
}

/** The AR picker's looks in category order (frames, props, filters, effects); unknown categories dropped. */
export function arOrder(looks: HomeLook[]): HomeLook[] {
  return AR_CATEGORIES.flatMap((c) => looks.filter((l) => l.category === c.id));
}

/** The first index of a category in an ordered list, or -1. */
export function categoryStart(ordered: HomeLook[], cat: LookCategory): number {
  return ordered.findIndex((l) => l.category === cat);
}

/** Auto-advance: the next look, wrapping to the first. */
export function nextAr(i: number, n: number): number {
  return n <= 0 ? 0 : (i + 1) % n;
}

/**
 * The frames carousel around the current frame: the frame before it and
 * the two after it in the frame list (wrapping), as indices into `frames`.
 * With fewer frames, positions repeat as little as possible (null = none).
 */
export function carousel(cur: number, n: number): { prev: number | null; next: number | null; after: number | null } {
  if (n <= 1) return { prev: null, next: null, after: null };
  const w = (k: number) => ((k % n) + n) % n;
  return { prev: n >= 3 ? w(cur - 1) : null, next: w(cur + 1), after: n >= 4 ? w(cur + 2) : null };
}

/** Where the landing's real QR code goes: the public demo event's guest welcome, tagged. */
export function demoQrUrl(origin: string, slug: string): string {
  const base = /^https:\/\//.test(origin) ? origin.replace(/\/+$/, '') : 'https://beamwall.app';
  return `${base}/e/${encodeURIComponent(slug)}/welcome?from=beamy-qr`;
}
