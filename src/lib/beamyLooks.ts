/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyLooks — the hero's filter demo ON Beamy. Pure, DOM-free, tested in node.
 *
 * He lands in the first look (the Christmas one), then tries on real platform assets one after another
 * (library 3D props, a 2D frame from the guide pack), each with a short line
 * in his bubble; a tap on him moves to the next one. Props are fitted in his
 * `body` bone's space (metres, +y up, +z toward the viewer; the bone sits
 * 0.12m above his feet, his crown tip at 0.48 in this space), so every clip
 * (hop, dance, drag-spin) carries the prop with him.
 */
import { HOME_ASSET_DEFAULTS, toBeamyLook } from './beamyAssets';

/** Where a prop's fitted box is pinned on him. */
export interface PropFit {
  /** The prop's box width (x) after fitting, metres. */
  width: number;
  /** The anchor point in the body bone's space, metres. */
  at: [number, number, number];
  /** Which point of the prop's box sits on `at`: its base (hats, crowns) or its centre (glasses, halo). */
  align: 'base' | 'centre';
  /** Forward tilt about x, radians (a hat sits back a little). */
  tilt?: number;
}

export interface BeamyLook {
  id: string;
  /** What he wears, for logs and assistive text. */
  name: string;
  kind: 'none' | 'prop' | 'frame';
  /** A library GLB (prop) or a transparent 9:16 frame PNG (frame). */
  url?: string;
  fit?: PropFit;
  /** His bubble line while he wears it. Short: it shares the hero with the headline. */
  line: string;
  /** A frame's height and centre in his heights (default: the hero's, see BeamyStage). */
  frame?: { h: number; c: number };
  /** A frame's see-through window (fractions of the frame). */
  opening?: { top: number; bottom: number; left: number; right: number };
  /** A prop worn together with a frame (the hero's Christmas look: Holiday cover + antlers). */
  prop?: { url: string; fit: PropFit };
}

/**
 * The hero's tour: the hero looks from the one asset-slot module (lib/
 * beamyAssets HOME_ASSET_DEFAULTS.heroLooks), in order. The first is what he
 * lands in and takes his selfie wearing (the Christmas look); the tour then
 * cycles through all of them, the first included.
 */
export const BEAMY_LOOKS: BeamyLook[] = HOME_ASSET_DEFAULTS.heroLooks.map((l) => toBeamyLook(l));

/** How long each look holds before he tries on the next (ms). */
export const LOOK_HOLD_MS = 4600;
/** Reduced motion: the same tour, slower. */
export const LOOK_HOLD_REDUCED_MS = 7000;
/** In the story's AR step the tour runs quicker (the step is one scroll stretch). */
export const STORY_LOOK_HOLD_MS = 2600;
export const STORY_LOOK_HOLD_REDUCED_MS = 5000;

/** The look after `i`, wrapping to the first. */
export function nextLook(i: number, n: number = BEAMY_LOOKS.length): number {
  if (n <= 1) return 0;
  const k = i + 1;
  return k >= n ? 0 : k;
}

/** The asset worth warming while `i` is up (the next look's file), or null. */
export function preloadUrl(i: number, looks: BeamyLook[] = BEAMY_LOOKS): string | null {
  const nx = looks[nextLook(i, looks.length)];
  return nx?.url ?? null;
}

/**
 * Where a prop's fitted box lands: the uniform scale that makes its box
 * `fit.width` wide, and the offset (applied AFTER that scale) that puts the
 * box's base-centre or centre on `fit.at`. `min`/`max` are the prop's box.
 */
export function fitProp(min: [number, number, number], max: [number, number, number], fit: PropFit): { scale: number; offset: [number, number, number] } {
  const w = Math.max(1e-6, max[0] - min[0]);
  const scale = fit.width / w;
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const py = fit.align === 'base' ? min[1] : (min[1] + max[1]) / 2;
  return { scale, offset: [fit.at[0] - cx * scale, fit.at[1] - py * scale, fit.at[2] - cz * scale] };
}
