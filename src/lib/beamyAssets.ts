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
  /** A frame's see-through window, as fractions of the frame; absent = DEFAULT_OPENING. */
  opening?: FrameOpening;
}

/** A frame's see-through window: fractions of the frame's height (top/bottom) and width (left/right). */
export interface FrameOpening { top: number; bottom: number; left: number; right: number; }

/** A frame override with no opening of its own: a typical portrait window. */
export const DEFAULT_OPENING: FrameOpening = { top: 0.22, bottom: 0.86, left: 0.14, right: 0.86 };

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
    { id: 'ar-wedding-cover', name: 'Wedding cover', category: 'frame', url: `${F}wedding-magazine-cover.png`, opening: { top: 0.242, bottom: 0.91, left: 0.13, right: 0.87 } },
    // Window measured from the PNG's alpha below the monogram's line art (the
    // strokes are see-through between lines, so the raw clear region reaches
    // 0.156; a face that high would sit behind the "M").
    { id: 'ar-monogram', name: 'Wedding monogram', category: 'frame', url: `${F}wedding-monogram-drop.png`, opening: { top: 0.433, bottom: 0.839, left: 0.056, right: 0.943 } },
    { id: 'ar-birthday', name: 'Birthday monogram', category: 'frame', url: `${F}birthday-monogram-corner.png`, opening: { top: 0.056, bottom: 0.946, left: 0.093, right: 0.915 } },
    { id: 'ar-countdown', name: 'New Year countdown', category: 'frame', url: `${F}nye-countdown.png`, opening: { top: 0.212, bottom: 0.812, left: 0.144, right: 0.863 } },
    { id: 'ar-asoebi', name: 'Aso ebi arch', category: 'frame', url: `${F}cultural-asoebi-arch.png`, opening: { top: 0.177, bottom: 0.89, left: 0, right: 1 } },
    { id: 'ar-art-deco', name: 'Art deco mask', category: 'frame', url: `${F}gala-artdeco-mask.png`, opening: { top: 0.256, bottom: 0.723, left: 0.226, right: 0.778 } },
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

/** The smallest a prop shrinks to so a frame's window can hold it (smaller reads as lost on him). */
export const PROP_MIN_SCALE = 0.6;

/** Lexicographic: is `a` ranked ahead of `b` (first differing entry larger)? */
function ahead(a: number[], b: number[]): boolean {
  for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) return a[n] > b[n];
  return false;
}

/**
 * Where the AR step's frame stands IN FRONT of him (a page image; the stage
 * never wears it), in viewport px, from where the stage draws him: his tip
 * (head top), mouth, centre x and height, and how far his prop reaches above
 * his tip at full size (`lift`) and shrunk to nothing (`liftBase`, its seat).
 *
 * Hard rules, always: (1) the whole frame inside the box (below the nav,
 * above the fold); (2) its top edge never below the prop's top, so nothing
 * pokes out of it. Within those it tries frame sizes and prop scales and
 * keeps the best, ranked: his face (eyes to chin) in the window; then the
 * prop fully in the window (`fits`); then the prop as big as it can stay
 * (`propScale`, down to PROP_MIN_SCALE); then his face nearest the middle of
 * the window. When nothing holds the prop, the frame's border crops it, as a
 * tight booth frame crops a tall hat.
 */
export function frameOnBeamy(i: {
  tip: number; mouth: number; x: number; heightPx: number; lift: number; liftBase?: number;
  opening: FrameOpening; box: { top: number; bottom: number; left: number; right: number };
  minH?: number;
}): { left: number; top: number; h: number; propScale: number; fits: boolean; faceIn: boolean } {
  const o = i.opening;
  const hp = Math.max(1, i.heightPx);
  const lift = Math.max(0, i.lift);
  const base = Math.min(lift, Math.max(0, i.liftBase ?? 0));
  const liftAt = (k: number) => base + (lift - base) * k;
  const pad = hp * 0.04;
  // His face as the stage draws it, from the mouth node: eye tops ~0.2 of
  // him above it, chin ~0.12 below, the face's middle just above it.
  const eyes = i.mouth - hp * 0.2;
  const chin = i.mouth + hp * 0.12;
  const face = i.mouth - hp * 0.06;
  const maxH = Math.max(1, Math.min(i.box.bottom - i.box.top, ((i.box.right - i.box.left) * 16) / 9));
  const minH = Math.min(maxH, hp * (i.minH ?? 1.3));
  const scales = lift - base > 0.5 ? [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, PROP_MIN_SCALE] : [1];
  let best: { score: number[]; top: number; h: number; k: number; fits: boolean; faceIn: boolean } | null = null;
  for (let s = 0; s <= 10; s++) {
    const h = maxH - ((maxH - minH) * s) / 10;
    for (const k of scales) {
      const propTop = i.tip - liftAt(k);
      // Hard: inside the box, and its top edge above the prop's top.
      const lo = i.box.top;
      const hi = Math.min(i.box.bottom - h, propTop);
      if (lo > hi + 0.01) continue;
      // His face in the window, and the prop in the window, as top ranges.
      const fLo = chin - o.bottom * h;
      const fHi = eyes - o.top * h;
      const pHi = propTop - pad - o.top * h;
      const clampTo = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
      let top = clampTo(face - ((o.top + o.bottom) / 2) * h, lo, hi);
      const faceOk = Math.max(lo, fLo) <= Math.min(hi, fHi) + 0.01;
      if (faceOk) top = clampTo(top, Math.max(lo, fLo), Math.min(hi, fHi));
      const fits = faceOk && Math.max(lo, fLo) <= Math.min(hi, fHi, pHi) + 0.01;
      if (fits) top = clampTo(top, Math.max(lo, fLo), Math.min(hi, fHi, pHi));
      const off = Math.abs(top + ((o.top + o.bottom) / 2) * h - face) / hp;
      const score = [faceOk ? 1 : 0, fits ? 1 : 0, k, -off, h / maxH];
      if (best === null || ahead(score, best.score)) best = { score, top, h, k, fits, faceIn: faceOk };
    }
  }
  const b = best ?? { top: i.box.top, h: maxH, k: scales[scales.length - 1], fits: false, faceIn: false };
  const w = (b.h * 9) / 16;
  const cx = i.x - ((o.left + o.right) / 2 - 0.5) * w;
  const left = Math.min(Math.max(cx - w / 2, i.box.left), i.box.right - w);
  return { left, top: b.top, h: b.h, propScale: b.k, fits: b.fits, faceIn: b.faceIn };
}

/** A window under this share of its frame (width × height) is "small": a face oval, not a picture window. */
export const SMALL_WINDOW_AREA = 0.35;
/** His face, ear to ear, is about this share of his height: a window that wide is filled by it. */
export const FACE_FILL_W = 0.42;

export function smallWindow(o: FrameOpening): boolean {
  return (o.right - o.left) * (o.bottom - o.top) < SMALL_WINDOW_AREA;
}

/**
 * Phones, a small-window frame (a face oval): standing still, his face can
 * only reach the oval of a small frame, which leaves dead space under the
 * picker. Instead the frame takes all the room in `box` (its top on the
 * box's top, centred across), and HE moves: sized so his face fills the
 * window's width (never taller than the window), standing so his face sits
 * mid-window. `mouthAt` = how far his mouth stands above his feet, in his
 * heights (read live from the stage). A prop may sit behind the frame or
 * above it. Returns the frame and the stand (feet x/y, height in px).
 */
export function stepIntoFrame(i: { opening: FrameOpening; box: { top: number; bottom: number; left: number; right: number }; mouthAt: number }): {
  frame: { left: number; top: number; h: number };
  stand: { x: number; y: number; heightPx: number };
} {
  const o = i.opening;
  const h = Math.max(1, Math.min(i.box.bottom - i.box.top, ((i.box.right - i.box.left) * 16) / 9));
  const w = (h * 9) / 16;
  const left = (i.box.left + i.box.right) / 2 - w / 2;
  const top = i.box.top;
  const hp = Math.max(1, Math.min(((o.right - o.left) * w) / FACE_FILL_W, ((o.bottom - o.top) * h) / 0.4));
  const face = top + ((o.top + o.bottom) / 2) * h;
  const mouth = face + hp * 0.06;
  return {
    frame: { left, top, h },
    stand: { x: left + ((o.left + o.right) / 2) * w, y: mouth + Math.max(0, i.mouthAt) * hp, heightPx: hp },
  };
}

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

/** The AR step's look: at most one pick per category (category → look id). */
export type ArSelection = Partial<Record<LookCategory, string>>;

/** A tap on a look: wears it (replacing its category's pick), or takes it off when it was already on. */
export function toggleLook(sel: ArSelection, l: HomeLook): ArSelection {
  const out = { ...sel };
  if (out[l.category] === l.id) delete out[l.category];
  else out[l.category] = l.id;
  return out;
}

/** The picked looks in category order; an id no longer in `looks` (or in the wrong category) is dropped. */
export function selectedLooks(sel: ArSelection, looks: HomeLook[]): HomeLook[] {
  return AR_CATEGORIES.flatMap((c) => {
    const id = sel[c.id];
    const l = id === undefined ? undefined : looks.find((x) => x.id === id && x.category === c.id);
    return l === undefined ? [] : [l];
  });
}

/**
 * The AR step's auto tour (it runs until the visitor's first tap): step `k`
 * builds a look one category at a time (a frame, then a prop on top, then a
 * filter, then an effect), and the next round starts a fresh look from each
 * category's next item. Returns the selection and the tab to show.
 */
export function arTour(k: number, looks: HomeLook[]): { sel: ArSelection; tab: LookCategory } {
  const cats = AR_CATEGORIES.map((c) => c.id).filter((id) => looks.some((l) => l.category === id));
  if (cats.length === 0) return { sel: {}, tab: 'frame' };
  const kk = Math.max(0, Math.floor(k));
  const round = Math.floor(kk / cats.length);
  const upto = kk % cats.length;
  const sel: ArSelection = {};
  for (let j = 0; j <= upto; j++) {
    const inCat = looks.filter((l) => l.category === cats[j]);
    sel[cats[j]] = inCat[round % inCat.length].id;
  }
  return { sel, tab: cats[upto] };
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
