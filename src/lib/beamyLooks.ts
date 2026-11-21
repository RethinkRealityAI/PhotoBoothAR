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
  /** Rotation in his face's plane, about z, radians (+ = counterclockwise as you look at him). */
  roll?: number;
  /**
   * A PAIR of earrings (one library model, its twin baked ~15cm away): the
   * hook-to-hook spacing on him, metres. The stage splits the model in two
   * (lib/studio/earPair splitScenePair) and `width` is then ONE earring's.
   */
  pair?: number;
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

/** How a fitted prop is hung on his body bone: a holder ON the anchor (so
 *  tilt and roll turn about the anchor itself) holding the scaled model. */
export interface WornPlacement {
  /** The model's uniform scale (multiplies its own). */
  scale: number;
  /** The model's position inside the holder. */
  objPos: [number, number, number];
  /** The holder's position in the body bone's space: `fit.at`. */
  holderPos: [number, number, number];
  /** The holder's rotation (x = tilt, z = roll; three's default XYZ order). */
  holderRot: [number, number, number];
  /** A split pair: where the far earring moves (model units); null otherwise. */
  farShift: [number, number, number] | null;
}

/**
 * THE placement of a worn prop, used both when he puts it on and when the
 * admin's adjust mode moves it live (BeamyStage), so the two cannot drift.
 * `pairDelta` = a split pair's authored hook delta (null: not split).
 */
export function wornPlacement(min: [number, number, number], max: [number, number, number], fit: PropFit, pairDelta: [number, number, number] | null): WornPlacement {
  const laid = pairDelta !== null ? fitPair(min, max, pairDelta, fit) : null;
  const f = laid ?? fitProp(min, max, fit);
  return {
    scale: f.scale,
    objPos: [f.offset[0] - fit.at[0], f.offset[1] - fit.at[1], f.offset[2] - fit.at[2]],
    holderPos: [fit.at[0], fit.at[1], fit.at[2]],
    holderRot: [fit.tilt ?? 0, 0, fit.roll ?? 0],
    farShift: laid !== null ? laid.farShift : null,
  };
}

/**
 * Where a split earring pair lands (see PropFit.pair): `min`/`max` are the
 * WHOLE pair's box, `delta` the far hook minus the near hook as authored
 * (splitScenePair's authoredDelta). The two earrings are taken as the same
 * width, so one is the pair's width less the hook spacing. Returns the scale
 * and offset (as fitProp) and how far to move the far earring (model units)
 * so the hooks end up `fit.pair` apart; null when the pair cannot be laid out.
 */
export function fitPair(min: [number, number, number], max: [number, number, number], delta: [number, number, number], fit: PropFit): { scale: number; offset: [number, number, number]; farShift: [number, number, number] } | null {
  const dx = delta[0];
  const w = max[0] - min[0] - Math.abs(dx);
  if (fit.pair === undefined || !(fit.pair > 0) || !(w > 0) || !(Math.abs(dx) > 0) || !(fit.width > 0)) return null;
  const scale = fit.width / w;
  const shift = Math.sign(dx) * (fit.pair / scale) - dx;
  // The near earring stays at its end of the box; the far one moves by `shift`.
  const nearLo = dx < 0 ? max[0] - w : min[0];
  const farLo = (dx < 0 ? min[0] : max[0] - w) + shift;
  const lo = Math.min(nearLo, farLo);
  const hi = Math.max(nearLo, farLo) + w;
  const f = fitProp([lo, min[1], min[2]], [hi, max[1], max[2]], { ...fit, width: (hi - lo) * scale });
  return { scale: f.scale, offset: f.offset, farShift: [shift, -delta[1], -delta[2]] };
}
