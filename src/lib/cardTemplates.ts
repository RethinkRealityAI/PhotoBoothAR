/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cardTemplates — the CLOSED SET of greeting-card templates, plus the pure
 * placement maths the Polaroid template renders from.
 *
 * Why a separate module from lib/cards.ts: cards.ts imports the Supabase
 * client, so nothing under vitest's node env may reach it. Everything here is
 * DOM-free and side-effect free, which keeps the template registry and the
 * scatter maths unit-testable (the templates themselves are .tsx and therefore
 * outside the test glob by policy).
 *
 * DETERMINISM: no Math.random anywhere. A polaroid's tilt/offset is a pure
 * function of the CONTRIBUTION ID, so the same print lands at the same angle
 * across re-renders, StrictMode double-invokes, reorders of the list and a
 * future frame-by-frame render. (lib/beamGeometry.ts:62 `polaroidTilt` solves
 * the neighbouring problem for the landing showcase, but keys on the list
 * INDEX — that is reorder-unstable, so cards key on the id instead. Its 2dp
 * rounding idiom, which keeps CSS values jitter-free, is kept.)
 */

/* ------------------------------------------------------------------ */
/* The closed set                                                      */
/* ------------------------------------------------------------------ */

export type CardTemplateId = 'storybook' | 'filmstrip' | 'polaroid' | 'carousel' | 'constellation';

/** Every shipped template id, in the order hosts should see them. */
export const CARD_TEMPLATE_IDS = ['storybook', 'filmstrip', 'polaroid', 'carousel', 'constellation'] as const;

/** What a card falls back to: an unknown id must still render something. */
export const DEFAULT_CARD_TEMPLATE: CardTemplateId = 'storybook';

export interface CardTemplateOption {
  id: CardTemplateId;
  /** Host-facing name (the <option> label). */
  label: string;
  /** One line telling a host what they are choosing. */
  description: string;
}

export const CARD_TEMPLATE_OPTIONS: readonly CardTemplateOption[] = [
  {
    id: 'storybook',
    label: 'Storybook',
    description: 'A page-turning book — one message per page, read start to finish.',
  },
  {
    id: 'filmstrip',
    label: 'Film strip',
    description: 'One long scrolling reel — every message is a frame on the strip.',
  },
  {
    id: 'polaroid',
    label: 'Polaroid',
    description: 'Scattered instant prints — handwritten captions on tilted photos.',
  },
  {
    id: 'carousel',
    label: 'Carousel',
    description: 'A 3D ring of photos that turns as you read — the showpiece.',
  },
  {
    id: 'constellation',
    label: 'Constellation',
    // Premium tier (WebGL); phones without it get the Storybook pages instead.
    description: 'Photos and videos floating in 3D around you. Drag to explore, tap one to bring it close.',
  },
];

export function isCardTemplateId(raw: unknown): raw is CardTemplateId {
  return typeof raw === 'string' && (CARD_TEMPLATE_IDS as readonly string[]).includes(raw);
}

/** Any stored/typed value → a template this build can actually render. */
export function normalizeCardTemplate(raw: string | null | undefined): CardTemplateId {
  return isCardTemplateId(raw) ? raw : DEFAULT_CARD_TEMPLATE;
}

/* ------------------------------------------------------------------ */
/* Polaroid scatter — seeded from the contribution id                  */
/* ------------------------------------------------------------------ */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Largest tilt a single print may take, degrees (± this). */
export const POLAROID_MAX_TILT_DEG = 3.2;
/** Largest horizontal nudge a single print may take, % of its own width. */
export const POLAROID_MAX_SHIFT_X_PCT = 2.4;
/** Largest vertical nudge a single print may take, % of its own height. */
export const POLAROID_MAX_SHIFT_Y_PCT = 1.6;
/** Angle between neighbouring prints in the cover fan, degrees. */
export const POLAROID_FAN_STEP_DEG = 9;
/** Horizontal step between neighbouring prints in the cover fan, % of a print's
 *  own width. MEASURED at 390x844: below ~50% the outer prints hide behind the
 *  centre one and the stack reads as a single print with white edges. */
export const POLAROID_FAN_STEP_X_PCT = 62;
/** How far the outer prints of the fan sit below the centre one, %. */
export const POLAROID_FAN_LIFT_PCT = 7;

/**
 * FNV-1a (32-bit) over the id, salted so one id yields several independent
 * streams. Returns an unsigned 32-bit integer.
 */
export function polaroidSeed(id: string, salt = 0): number {
  let h = FNV_OFFSET_BASIS ^ (salt >>> 0);
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i) & 0xff;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Seed → [0, 1). Uses the top 24 bits: FNV's low byte is its weakest. */
function unit(id: string, salt: number): number {
  return (polaroidSeed(id, salt) >>> 8) / 0x1000000;
}

/** Seed → [-1, 1). */
function signedUnit(id: string, salt: number): number {
  return unit(id, salt) * 2 - 1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Where one instant print sits relative to its slot. */
export interface PolaroidPlacement {
  /** Rotation in degrees, within ±POLAROID_MAX_TILT_DEG. */
  rotationDeg: number;
  /** Horizontal nudge in % of the print's width. */
  offsetXPct: number;
  /** Vertical nudge in % of the print's height. */
  offsetYPct: number;
}

/**
 * THE SEEDING RULE: rotation, x-nudge and y-nudge are three salts (0/1/2) of
 * FNV-1a over the contribution id, each mapped to [-1, 1) and scaled by its
 * own bound, then rounded to 2dp.
 */
export function polaroidPlacement(id: string): PolaroidPlacement {
  return {
    rotationDeg: round2(signedUnit(id, 0) * POLAROID_MAX_TILT_DEG),
    offsetXPct: round2(signedUnit(id, 1) * POLAROID_MAX_SHIFT_X_PCT),
    offsetYPct: round2(signedUnit(id, 2) * POLAROID_MAX_SHIFT_Y_PCT),
  };
}

/** Fraction of a page over which a print settles under a driven render. */
export const POLAROID_ENTRANCE_SPAN = 0.28;

export interface PolaroidEntrance {
  opacity: number;
  /** Vertical offset in px, settling to 0. */
  y: number;
  scale: number;
}

/**
 * The entrance a print is showing at `frameProgress` within its page — the
 * deterministic counterpart to the interactive spring, so a frame renderer
 * driving `frameProgress` gets the same picture every time it asks for the
 * same frame. Out-of-range and non-finite input settles (never NaN in a
 * transform).
 */
export function polaroidEntrance(progress: number): PolaroidEntrance {
  const raw = Number.isFinite(progress) ? progress : 1;
  const p = Math.max(0, Math.min(1, raw / POLAROID_ENTRANCE_SPAN));
  const eased = 1 - (1 - p) ** 3; // cubic ease-out
  return {
    opacity: round2(eased),
    y: round2((1 - eased) * 26),
    scale: round2(0.96 + eased * 0.04),
  };
}

/**
 * The cover's fanned stack: an even spread about the centre (so the fan is
 * symmetric however many prints there are) plus HALF of each print's own
 * seeded jitter, so no two covers fan identically.
 */
export function polaroidFan(ids: readonly string[]): PolaroidPlacement[] {
  const n = ids.length;
  return ids.map((id, i) => {
    const spread = i - (n - 1) / 2; // …-1, 0, +1…
    const jitter = polaroidPlacement(id);
    return {
      rotationDeg: round2(spread * POLAROID_FAN_STEP_DEG + jitter.rotationDeg / 2),
      offsetXPct: round2(spread * POLAROID_FAN_STEP_X_PCT + jitter.offsetXPct / 2),
      offsetYPct: round2(Math.abs(spread) * POLAROID_FAN_LIFT_PCT + jitter.offsetYPct / 2),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Cover + closing copy decisions                                      */
/* ------------------------------------------------------------------ */

/** The slice of a contribution these copy helpers read. */
export interface ContributorLike {
  contributorName: string | null;
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Does the title already say who the card is for? "Happy birthday, Dapo!"
 * with recipient "Dapo" → true. Case-insensitive, whitespace-normalised. An
 * empty recipient never "matches" (there is nothing to repeat).
 */
export function titleMentionsRecipient(title: string | null | undefined, recipient: string | null | undefined): boolean {
  const r = clean(recipient).toLocaleLowerCase();
  if (r === '') return false;
  return clean(title).toLocaleLowerCase().includes(r);
}

/**
 * The "for Maya" line under a cover title, or null when it would only repeat
 * the title (the owner called repeated names redundant). The event name is
 * never shown on a card: the recipient knows which party it was.
 */
export function coverRecipientLine(title: string | null | undefined, recipient: string | null | undefined): string | null {
  const r = clean(recipient);
  if (r === '' || titleMentionsRecipient(title, r)) return null;
  return `for ${r}`;
}

/** "8 messages inside" / "1 message inside" / "Nothing inside yet". */
export function contributionCountLabel(n: number): string {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (count === 0) return 'Nothing inside yet';
  return `${count} ${count === 1 ? 'message' : 'messages'} inside`;
}

/**
 * Up to two initials for an avatar: "The Squad" → "TS", "Tola & Femi" → "TF",
 * "Beamy" → "B". Letters and digits only (any script). An empty name gets a
 * star, never an empty circle.
 */
export function contributorInitials(name: string | null | undefined): string {
  const words = clean(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
  if (words.length === 0) return '✦';
  return words
    .slice(0, 2)
    .map((w) => w[0].toLocaleUpperCase())
    .join('');
}

/** Distinct contributor names, first-seen order, compared case-insensitively. */
export function uniqueContributors(contributions: readonly ContributorLike[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of contributions) {
    const name = clean(c.contributorName);
    if (name === '') continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * How many people signed the card: distinct names, plus every unsigned
 * contribution (two anonymous notes cannot be proven to be one person, and
 * undercounting someone's note is the worse error on a keepsake).
 */
export function contributorCount(contributions: readonly ContributorLike[]): number {
  const anonymous = contributions.filter((c) => clean(c.contributorName) === '').length;
  return uniqueContributors(contributions).length + anonymous;
}

/** The closing page's headline: "With love from 8 people" / "With love from Kemi". */
export function closingHeadline(contributions: readonly ContributorLike[]): string {
  const people = contributorCount(contributions);
  if (people === 0) return 'With love';
  const names = uniqueContributors(contributions);
  if (people === 1) return names.length === 1 ? `With love from ${names[0]}` : 'With love';
  return `With love from ${people} people`;
}

/**
 * "Kemi, Marcus and Aunty Bisi" — at most `max` names, then "and 3 more".
 * No Oxford comma (the way a card is signed).
 */
export function formatNameList(names: readonly string[], max = 6): string {
  const list = names.map(clean).filter((n) => n !== '');
  const cap = Math.max(1, Math.floor(max));
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length <= cap) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  const rest = list.length - cap;
  return `${list.slice(0, cap).join(', ')} and ${rest} more`;
}

/** Messages up to this many characters are set in the display face. */
export const SHORT_MESSAGE_MAX_CHARS = 110;

/**
 * How a message is set: a short line reads like a headline in the display
 * face; anything longer is set in the readable text face (≥15px) so a
 * heartfelt paragraph never shrinks into a wall of display type.
 */
export function messageTone(message: string | null | undefined): 'display' | 'text' | 'none' {
  const m = clean(message);
  if (m === '') return 'none';
  return [...m].length <= SHORT_MESSAGE_MAX_CHARS ? 'display' : 'text';
}

/**
 * Which contributions headline the cover: media first (photos, then videos,
 * in card order), written notes only to fill. A cover is a picture of the
 * people in the card.
 */
export function coverPicks<T extends { mediaType: string; url: string | null }>(
  contributions: readonly T[],
  max = 5,
): T[] {
  const cap = Math.max(0, Math.floor(max));
  const photos = contributions.filter((c) => c.mediaType === 'photo' && c.url !== null && c.url !== '');
  const videos = contributions.filter((c) => c.mediaType === 'video' && c.url !== null && c.url !== '');
  const rest = contributions.filter((c) => !photos.includes(c) && !videos.includes(c));
  return [...photos, ...videos, ...rest].slice(0, cap);
}

/** One tile of the cover's arc. Percentages are of the tile's own size. */
export interface CoverArcSlot {
  rotationDeg: number;
  offsetXPct: number;
  offsetYPct: number;
  scale: number;
  zIndex: number;
}

/**
 * The cover hero: tiles fanned on a shallow arc, the centre one forward and
 * largest, the outer ones dropping and turning away — like a hand of cards
 * held up to the light. Symmetric for any count; pure.
 */
export function coverArc(n: number): CoverArcSlot[] {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const mid = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => {
    const s = i - mid; // …-1, 0, +1…
    const a = Math.abs(s);
    return {
      rotationDeg: round2(s * 7),
      offsetXPct: round2(s * 46),
      offsetYPct: round2(a * a * 5 + a * 4),
      scale: round2(Math.max(0.72, 1 - a * 0.11)),
      zIndex: 10 - Math.round(a * 2),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Letterpress ornament — the frame geometry, sized to its box         */
/* ------------------------------------------------------------------ */

export interface OrnamentFrame {
  /** Two hairline rules just inside the edge (outer, inner). */
  rules: [string, string];
  /** The notched inner border with an ogee arch at top and bottom. */
  arch: string;
  /** A rule to bead with round dots (dasharray 0 + gap). */
  beads: string;
  /** Transforms for the four filigree corners: TL, TR, BR, BL. */
  corners: [string, string, string, string];
  /** Transforms for the top and bottom crests (the sprig in each arch). */
  crests: [string, string];
}

const f1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const ww = Math.max(0, w);
  const hh = Math.max(0, h);
  const rr = Math.max(0, Math.min(r, ww / 2, hh / 2));
  return (
    `M${f1(x + rr)} ${f1(y)}H${f1(x + ww - rr)}A${f1(rr)} ${f1(rr)} 0 0 1 ${f1(x + ww)} ${f1(y + rr)}` +
    `V${f1(y + hh - rr)}A${f1(rr)} ${f1(rr)} 0 0 1 ${f1(x + ww - rr)} ${f1(y + hh)}` +
    `H${f1(x + rr)}A${f1(rr)} ${f1(rr)} 0 0 1 ${f1(x)} ${f1(y + hh - rr)}` +
    `V${f1(y + rr)}A${f1(rr)} ${f1(rr)} 0 0 1 ${f1(x + rr)} ${f1(y)}Z`
  );
}

/**
 * The frame for a box of `width`×`height` CSS px. Drawn in pixels (never a
 * stretched viewBox) so the corners stay round and the hairlines stay one
 * hairline at every size. Degenerate sizes return valid geometry — never NaN
 * in a `d` attribute.
 */
export function ornamentFrame(width: number, height: number): OrnamentFrame {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const short = Math.min(w, h);
  const m = Math.max(18, Math.min(34, short * 0.07)); // inner border inset
  const rise = Math.max(8, Math.min(34, h * 0.045)); // arch height
  const yTop = m + rise;
  const c = m * 0.7; // corner notch radius
  const cx = w / 2;
  const aw = Math.max(24, Math.min(118, w * 0.22)); // arch half-width
  const s = Math.max(0.6, Math.min(1.05, short / 440)); // motif scale

  const arch =
    `M${f1(m + c)} ${f1(yTop)}` +
    `H${f1(cx - aw)}` +
    `C${f1(cx - aw * 0.4)} ${f1(yTop)} ${f1(cx - aw * 0.15)} ${f1(m + rise * 0.2)} ${f1(cx)} ${f1(m)}` +
    `C${f1(cx + aw * 0.15)} ${f1(m + rise * 0.2)} ${f1(cx + aw * 0.4)} ${f1(yTop)} ${f1(cx + aw)} ${f1(yTop)}` +
    `H${f1(w - m - c)}` +
    `A${f1(c)} ${f1(c)} 0 0 0 ${f1(w - m)} ${f1(yTop + c)}` +
    `V${f1(h - yTop - c)}` +
    `A${f1(c)} ${f1(c)} 0 0 0 ${f1(w - m - c)} ${f1(h - yTop)}` +
    `H${f1(cx + aw)}` +
    `C${f1(cx + aw * 0.4)} ${f1(h - yTop)} ${f1(cx + aw * 0.15)} ${f1(h - m - rise * 0.2)} ${f1(cx)} ${f1(h - m)}` +
    `C${f1(cx - aw * 0.15)} ${f1(h - m - rise * 0.2)} ${f1(cx - aw * 0.4)} ${f1(h - yTop)} ${f1(cx - aw)} ${f1(h - yTop)}` +
    `H${f1(m + c)}` +
    `A${f1(c)} ${f1(c)} 0 0 0 ${f1(m)} ${f1(h - yTop - c)}` +
    `V${f1(yTop + c)}` +
    `A${f1(c)} ${f1(c)} 0 0 0 ${f1(m + c)} ${f1(yTop)}Z`;

  const k = (x: number, y: number, sx: number, sy: number) =>
    `translate(${f1(x)} ${f1(y)}) scale(${round2(sx * s)} ${round2(sy * s)})`;
  const ci = m + 5; // corner motif origin, inside the notch
  const cyTop = yTop + 5;

  return {
    rules: [roundedRect(9, 9, w - 18, h - 18, 22), roundedRect(13.5, 13.5, w - 27, h - 27, 18)],
    arch,
    beads: roundedRect(m - 5, m - 5, w - 2 * (m - 5), h - 2 * (m - 5), 14),
    corners: [k(ci, cyTop, 1, 1), k(w - ci, cyTop, -1, 1), k(w - ci, h - cyTop, -1, -1), k(ci, h - cyTop, 1, -1)],
    crests: [k(cx, m + 9, 1, 1), k(cx, h - m - 9, 1, -1)],
  };
}

/* ------------------------------------------------------------------ */
/* Constellation — deterministic 3D placement                          */
/* ------------------------------------------------------------------ */

export type Vec3 = [number, number, number];

export interface ConstellationNode {
  id: string;
  position: Vec3;
  /** Phase 0..2π for the tile's slow drift (seeded, so tiles never bob in sync). */
  phase: number;
  /** Tile scale multiplier, 0.9..1.1 (seeded). */
  scale: number;
}

/** Golden angle in radians — the Fibonacci sphere's even spiral step. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Tiles stay inside ±this (as sin(latitude)): the poles sit straight above /
 *  below the viewer, where a tile reads as a sliver. */
export const CONSTELLATION_MAX_LAT = 0.62;

/** Shell radius for `n` tiles: room for the title inside, and more room as
 *  the card fills so tiles never crowd. */
export function constellationRadius(n: number): number {
  const count = Number.isFinite(n) && n > 0 ? n : 0;
  return round2(Math.max(3.6, 1.15 * Math.sqrt(count) + 1.6));
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Tiles on a latitude-limited Fibonacci sphere, each nudged by its OWN id's
 * seed (radius ±8%, longitude ±0.18 rad) — so the same card always forms the
 * same constellation. No Math.random.
 */
export function constellationLayout(ids: readonly string[]): ConstellationNode[] {
  const n = ids.length;
  const R = constellationRadius(n);
  return ids.map((id, i) => {
    const y = n === 1 ? 0 : (1 - ((i + 0.5) / n) * 2) * CONSTELLATION_MAX_LAT;
    const ring = Math.sqrt(1 - y * y);
    const theta = i * GOLDEN_ANGLE + signedUnit(id, 11) * 0.18;
    const radius = R * (1 + signedUnit(id, 12) * 0.08);
    return {
      id,
      position: [r3(Math.sin(theta) * ring * radius), r3(y * radius), r3(Math.cos(theta) * ring * radius)],
      phase: r3(unit(id, 13) * Math.PI * 2),
      scale: r3(1 + signedUnit(id, 14) * 0.1),
    };
  });
}

/**
 * The faint threads of light between tiles: each tile to its `k` nearest
 * neighbours, deduplicated, as index pairs [a, b] with a < b, sorted. Ties
 * break on index, so the star map is stable.
 */
export function constellationThreads(positions: readonly Vec3[], k = 2): Array<[number, number]> {
  const edges = new Set<string>();
  const out: Array<[number, number]> = [];
  const kk = Math.max(0, Math.floor(k));
  positions.forEach((p, i) => {
    const near = positions
      .map((q, j) => ({ j, d: (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d || a.j - b.j)
      .slice(0, kk);
    for (const { j } of near) {
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = `${a}-${b}`;
      if (edges.has(key)) continue;
      edges.add(key);
      out.push([a, b]);
    }
  });
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/**
 * Where the camera stands to look at a tile: outward from the centre along
 * the tile's own direction, `distance` in front of it — so the focused tile
 * is nearest, with the rest of the constellation behind it.
 */
export function focusCameraPosition(position: Vec3, distance: number): Vec3 {
  const len = Math.hypot(position[0], position[1], position[2]);
  const dir: Vec3 = len > 1e-6 ? [position[0] / len, position[1] / len, position[2] / len] : [0, 0, 1];
  const d = Number.isFinite(distance) ? distance : 0;
  return [r3(position[0] + dir[0] * d), r3(position[1] + dir[1] * d), r3(position[2] + dir[2] * d)];
}

/**
 * How far back the overview camera stands so a shell of `radius` fits the
 * canvas: the narrower of the vertical and horizontal fields of view decides,
 * which keeps a portrait phone from cropping the sides.
 */
export function overviewDistance(radius: number, aspect: number, fovDeg: number): number {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const v = ((Number.isFinite(fovDeg) && fovDeg > 0 ? fovDeg : 50) * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(v / 2) * a);
  const fov = Math.min(v, hfov);
  return round2((Math.max(0, radius) * 1.15) / Math.sin(fov / 2));
}
