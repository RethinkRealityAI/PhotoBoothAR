/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * COLORWAYS — curated one-tap colour schemes for configurable library assets,
 * plus "Match my outfit": the dominant colour of what the guest is ACTUALLY
 * wearing, read off a camera frame and turned into a two-tone piece.
 *
 * Pure data plus pure functions, following ./starterScenes.ts and
 * ./assetLibrary.ts: no React, no DOM, no three, no network — so vitest
 * exercises every scheme, the whole role mapper and the entire colour-detection
 * pass in the node env. The browser glue (grab the <video>, draw a small frame,
 * read its pixels) is ~20 lines in PropertiesDock.tsx and does nothing this
 * module cannot be asked directly.
 *
 * ── Why roles, not region ids ─────────────────────────────────────────────
 * A scheme keyed to `crown`/`brim`/`button` works for exactly one asset — the
 * baseball cap. The second library asset would need its own copy of all eight
 * schemes, and the third another, which is the mirror-table failure this repo
 * has already paid for elsewhere. So a colorway names three ROLES and the
 * mapper resolves them against whatever template it is handed.
 *
 * ── THE ROLE CONTRACT (authored order is body-first) ──────────────────────
 * `AssetTemplate.regions` carries no per-region size — nothing in the
 * descriptor says the crown is bigger than the button — so "primary goes on the
 * largest part" cannot be computed, only AUTHORED. The rule is therefore
 * positional and stated here once:
 *
 *     regions[0]  -> primary     (the body: the largest, most-seen surface)
 *     regions[1]  -> secondary   (the trim)
 *     regions[2+] -> accent      (details, hardware, buttons)
 *
 * which is the order `/dev/asset-prep` produces and the order the cap ships in
 * (`crown, brim, button`). An asset author who lists a button first gets a
 * button-coloured hero, and that is a descriptor bug, not a mapper bug.
 *
 * Role is assigned by the region's AUTHORED INDEX, and locked regions are
 * dropped AFTERWARDS. Indexing over the recolourable subset instead would mean
 * locking one region silently promotes its neighbour and repaints every part
 * below it — a licensed badge going read-only must not restyle the whole piece.
 *
 * ── Generic by mandate ────────────────────────────────────────────────────
 * Same rule as ./assetLibrary.ts: the colocated test checks every id and name
 * against the same legacy-brand deny-list, so branded content cannot arrive
 * here by a later edit either.
 */
import type { AssetCustomization, AssetPartStyle } from '../../types';
import type { AssetTemplate } from './assetTemplate';
import { DEFAULT_FINISH, normalizeFinish, normalizeTint, type FinishId } from './finish';

/* ── the scheme ───────────────────────────────────────────────────────────── */

export type ColorwayRole = 'primary' | 'secondary' | 'accent';

/** The three roles in the order they map onto `template.regions`. */
export const COLORWAY_ROLES: readonly ColorwayRole[] = ['primary', 'secondary', 'accent'];

export interface ColorwayStyle {
  /** `#rrggbb`. */
  hex: string;
  /** A FINISHES id (./finish.ts). Absent = 'original' = leave the material alone. */
  finish?: FinishId;
}

export interface Colorway {
  id: string;
  /** Generic and descriptive — never an event, a person or a brand. */
  name: string;
  styles: Record<ColorwayRole, ColorwayStyle>;
}

/**
 * The shipped shelf. Ordered most-broadly-appealing first — the first chip is
 * the one a host in a hurry taps.
 *
 * Finishes are used SPARINGLY and only on the accent role: a chrome or gold
 * BODY reads as a prop rather than a wearable, while a gold button on a navy
 * crown reads as considered. `matte` is the one exception worth making on a
 * body, because fabric genuinely is matte.
 */
export const COLORWAYS: readonly Colorway[] = [
  {
    id: 'midnight-gold',
    name: 'Midnight & Gold',
    styles: {
      primary: { hex: '#141a2b' },
      secondary: { hex: '#20293f' },
      accent: { hex: '#d4a017', finish: 'gold' },
    },
  },
  {
    id: 'cream-espresso',
    name: 'Cream & Espresso',
    styles: {
      primary: { hex: '#efe7d8', finish: 'matte' },
      secondary: { hex: '#3b2f2a' },
      accent: { hex: '#8c6a4a' },
    },
  },
  {
    id: 'forest-bone',
    name: 'Forest & Bone',
    styles: {
      primary: { hex: '#21453a' },
      secondary: { hex: '#e9e4d6' },
      accent: { hex: '#c9a227', finish: 'gold' },
    },
  },
  {
    id: 'coastal-blue',
    name: 'Coastal Blue',
    styles: {
      primary: { hex: '#2d5f8a' },
      secondary: { hex: '#e8eef3' },
      accent: { hex: '#f2a65a' },
    },
  },
  {
    id: 'blush-chrome',
    name: 'Blush & Chrome',
    styles: {
      primary: { hex: '#e8b4b8' },
      secondary: { hex: '#f7edee' },
      accent: { hex: '#e8e8e8', finish: 'chrome' },
    },
  },
  {
    id: 'slate-mono',
    name: 'Slate Monochrome',
    styles: {
      primary: { hex: '#2b3038', finish: 'matte' },
      secondary: { hex: '#6b7280' },
      accent: { hex: '#d9dde3' },
    },
  },
  {
    id: 'electric-night',
    name: 'Electric Night',
    styles: {
      primary: { hex: '#12141d' },
      secondary: { hex: '#242b3d' },
      accent: { hex: '#7df9ff', finish: 'neon' },
    },
  },
  {
    id: 'desert-clay',
    name: 'Desert Clay',
    styles: {
      primary: { hex: '#c2683f' },
      secondary: { hex: '#f0e2d0' },
      accent: { hex: '#6b4a34' },
    },
  },
];

export const COLORWAY_MAP: Record<string, Colorway> = Object.fromEntries(
  COLORWAYS.map((c) => [c.id, c]),
);

/** The role a region at this authored index plays. See THE ROLE CONTRACT above. */
export function roleForRegionIndex(index: number): ColorwayRole {
  if (index <= 0) return 'primary';
  if (index === 1) return 'secondary';
  return 'accent';
}

/**
 * Resolve a colorway against one template into a `SET_CUSTOMIZATION`-ready
 * `parts` map.
 *
 * Returns a plain object rather than `undefined` for "nothing mapped", so the
 * caller can always `Object.entries` it. `state.ts normalizeCustomization` is
 * still the one thing that decides what gets STORED — this only decides what
 * gets dispatched, and an empty map dispatches nothing.
 *
 * A `finish` equal to the default ('original') is OMITTED, matching
 * `state.ts normalizePart`: 'original' means "leave the material alone", so
 * writing it would be a stored value that means nothing.
 */
export function colorwayParts(
  colorway: Colorway,
  template: AssetTemplate | null | undefined,
): NonNullable<AssetCustomization['parts']> {
  const out: Record<string, AssetPartStyle> = {};
  if (!template) return out;
  template.regions.forEach((region, index) => {
    // Locked AFTER the role is decided — see the role contract.
    if (!region.recolourable) return;
    const style = colorway.styles[roleForRegionIndex(index)];
    const hex = normalizeTint(style.hex);
    if (!hex) return;
    const part: AssetPartStyle = { hex };
    const finish = normalizeFinish(style.finish);
    if (finish !== DEFAULT_FINISH) part.finish = finish;
    out[region.id] = part;
  });
  return out;
}

/* ── colour maths ─────────────────────────────────────────────────────────── */

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexChannels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB bytes -> [hue 0..360, sat 0..1, light 0..1]. Hue is 0 for any grey. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  // A grey has NO hue. Returning an arbitrary one here would let neutrals vote
  // in the hue histogram below and drag the mean off the real garment colour.
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, s, l];
}

/** [hue, sat, light] -> `#rrggbb`, always in gamut (the byte write clamps). */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/* ── "Match my outfit" ────────────────────────────────────────────────────── */

/** Alpha at/below which a pixel carries no colour at all. */
const ALPHA_FLOOR = 8;
/** Below this lightness there is no hue left to read — a black frame, a shadow. */
const BLACK_FLOOR = 0.05;
/** Below this saturation a pixel is a NEUTRAL, not a colour. */
const NEUTRAL_SAT = 0.12;
/** Coarse quantisation. 30-degree hue bins are wide enough that camera noise
 *  does not scatter one garment across three of them. */
const HUE_BINS = 12;
const SAT_BINS = 3;
const LIGHT_BINS = 3;
/** Neutrals get their own, finer lightness ladder: a black shirt and a white
 *  shirt must not land in the same bucket just because neither has a hue. */
const NEUTRAL_LIGHT_BINS = 5;
/** Fraction of the frame's WIDTH sampled, centred — the guest is in the middle. */
const CENTRE_WIDTH = 0.6;
/** Where the clothing starts. The face and hair own the top two thirds. */
const TORSO_TOP = 2 / 3;

interface Bucket { n: number; r: number; g: number; b: number }

function addTo(map: Map<number, Bucket>, key: number, r: number, g: number, b: number): void {
  const cell = map.get(key);
  if (cell) { cell.n += 1; cell.r += r; cell.g += g; cell.b += b; }
  else map.set(key, { n: 1, r, g, b });
}

function densestKey(map: Map<number, Bucket>): number | null {
  let bestN = 0;
  let bestKey: number | null = null;
  for (const [key, cell] of map) {
    // Strictly-greater keeps the FIRST densest bucket on a tie, so the same
    // pixels always produce the same answer whatever order Map iterates.
    if (cell.n > bestN) { bestN = cell.n; bestKey = key; }
  }
  return bestKey;
}

/**
 * The dominant clothing colour in a camera frame, as `#rrggbb`, or null when
 * there is nothing usable to read.
 *
 * ── The method, and why each part of it is there ──────────────────────────
 * 1. SAMPLE THE TORSO. Only the bottom third of the frame, and only the middle
 *    60% of its width. Above that is the guest's face and hair — matching a
 *    cap to somebody's skin tone is not the feature — and the outer bands are
 *    the room behind them.
 * 2. QUANTISE, DO NOT AVERAGE. A mean over the whole region on a patterned
 *    shirt returns mud: red and white stripes average to pink, which is on
 *    nobody. Pixels go into coarse (hue, sat, light) buckets and the DENSEST
 *    bucket wins, so the answer is a colour that is genuinely present.
 * 3. NEUTRALS ARE COUNTED SEPARATELY, not discarded. A near-grey pixel has no
 *    meaningful hue, so it must not vote in the hue histogram — but a black
 *    tee, a white shirt and a grey hoodie are the most common garments there
 *    are. So they fill a second histogram, and that one is used when neutrals
 *    are the MAJORITY of what was sampled.
 * 4. HUE BINS ARE OFFSET BY HALF A BIN so that red (hue 0) sits at a bin's
 *    CENTRE rather than on the seam between bin 0 and bin 11 — otherwise the
 *    single most common garment colour is the one the histogram splits in two.
 *    The winning bucket is then merged with its two hue-neighbours (wrapping)
 *    before the mean, the same stabilisation ./chromaKey.ts uses.
 *
 * Deterministic: same pixels in, same hex out, no randomness and no time.
 */
export function dominantOutfitColor(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): string | null {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  // A short buffer is a caller bug, not a colour — never read past its end.
  if (rgba.length < w * h * 4) return null;

  const yStart = Math.min(h - 1, Math.floor(h * TORSO_TOP));
  const margin = (1 - CENTRE_WIDTH) / 2;
  const xStart = Math.min(w - 1, Math.floor(w * margin));
  const xEnd = Math.max(xStart + 1, Math.min(w, Math.ceil(w * (1 - margin))));

  const chroma = new Map<number, Bucket>();
  const neutral = new Map<number, Bucket>();
  let chromaN = 0;
  let neutralN = 0;

  for (let y = yStart; y < h; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < ALPHA_FLOOR) continue;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const [hue, sat, light] = rgbToHsl(r, g, b);
      if (light < BLACK_FLOOR) continue;
      if (sat < NEUTRAL_SAT) {
        addTo(neutral, Math.min(NEUTRAL_LIGHT_BINS - 1, Math.floor(light * NEUTRAL_LIGHT_BINS)), r, g, b);
        neutralN += 1;
        continue;
      }
      const step = 360 / HUE_BINS;
      const shifted = ((hue + step / 2) % 360 + 360) % 360;
      const hBin = Math.min(HUE_BINS - 1, Math.floor(shifted / step));
      const sBin = Math.min(SAT_BINS - 1, Math.floor(sat * SAT_BINS));
      const lBin = Math.min(LIGHT_BINS - 1, Math.floor(light * LIGHT_BINS));
      addTo(chroma, (hBin * SAT_BINS + sBin) * LIGHT_BINS + lBin, r, g, b);
      chromaN += 1;
    }
  }

  const total = chromaN + neutralN;
  if (total === 0) return null;

  // Neutrals win only when they are genuinely MOST of what the guest is
  // wearing; otherwise a grey wall behind a red shirt would beat the shirt.
  if (chromaN === 0 || neutralN > total / 2) {
    const key = densestKey(neutral);
    if (key === null) return null;
    const cell = neutral.get(key)!;
    return toHex(cell.r / cell.n, cell.g / cell.n, cell.b / cell.n);
  }

  const best = densestKey(chroma);
  if (best === null) return null;
  const lBin = best % LIGHT_BINS;
  const sBin = Math.floor(best / LIGHT_BINS) % SAT_BINS;
  const hBin = Math.floor(best / (LIGHT_BINS * SAT_BINS));
  let n = 0, sr = 0, sg = 0, sb = 0;
  for (let d = -1; d <= 1; d++) {
    const hb = (hBin + d + HUE_BINS) % HUE_BINS;
    const cell = chroma.get((hb * SAT_BINS + sBin) * LIGHT_BINS + lBin);
    if (cell) { n += cell.n; sr += cell.r; sg += cell.g; sb += cell.b; }
  }
  if (n === 0) return null;
  return toHex(sr / n, sg / n, sb / n);
}

/** Hue rotation applied to build a companion colour, in degrees. */
const COMPANION_HUE_SHIFT = 30;
/** Saturation floor for a companion: a dead grey is not a colour scheme. */
const COMPANION_SAT_MIN = 0.18;
/** Saturation ceiling: the companion supports the garment, it does not shout. */
const COMPANION_SAT_MAX = 0.85;
const COMPANION_LIGHT_SHIFT = 0.42;

/**
 * A pleasant companion colour for `hex` — analogous in hue, decisively the
 * other side of mid-tone in lightness.
 *
 * ANALOGOUS (+30 degrees), not the true opposite (+180): a strict complement of
 * a red shirt is a green cap, which is a costume. A 30-degree rotation reads as
 * "chosen to go with that", and the CONTRAST that makes the piece visible is
 * carried by the lightness swing instead — a light garment gets a dark
 * companion and a dark garment a light one, clamped so the result always
 * crosses the mid-tone line.
 *
 * Never throws and always returns a valid `#rrggbb`: unparseable input is
 * treated as mid-grey, because the caller is a click handler in a render tree.
 */
export function complementFor(hex: string): string {
  const [r, g, b] = hexChannels(normalizeTint(hex) ?? '#808080');
  const [h, s, l] = rgbToHsl(r, g, b);
  const sat = Math.min(COMPANION_SAT_MAX, Math.max(COMPANION_SAT_MIN, s));
  const light = l > 0.5
    ? Math.max(0.12, Math.min(0.5, l - COMPANION_LIGHT_SHIFT))
    : Math.min(0.88, Math.max(0.5, l + COMPANION_LIGHT_SHIFT));
  return hslToHex(h + COMPANION_HUE_SHIFT, sat, light);
}

/** The id the outfit-derived scheme reports; never present in COLORWAYS. */
export const OUTFIT_COLORWAY_ID = 'outfit-match';

/**
 * Build a colorway from one sampled garment colour.
 *
 * THE DELIBERATE CHOICE, because the obvious one is wrong: the PRIMARY role —
 * the body of the piece, the largest surface — gets the COMPANION colour, and
 * the trim and details get the garment colour itself.
 *
 * A cap in the exact colour of the shirt underneath it vanishes: in the guest's
 * own photo the crown sits directly against the torso, so an exact match
 * removes the silhouette that makes the piece read as a piece at all. Putting
 * the garment colour on the trim and details instead keeps the MATCH visible —
 * the eye picks up the repeat on the brim and the button — while the body still
 * separates from the body behind it. Matched, not camouflaged.
 */
export function outfitColorway(outfitHex: string): Colorway {
  const outfit = normalizeTint(outfitHex) ?? '#808080';
  const body = complementFor(outfit);
  return {
    id: OUTFIT_COLORWAY_ID,
    name: 'Your outfit',
    styles: {
      primary: { hex: body },
      secondary: { hex: outfit },
      accent: { hex: outfit },
    },
  };
}
