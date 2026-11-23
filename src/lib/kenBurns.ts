/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ken-Burns drift for wall photos (Spotlight + Slideshow).
 *
 * The original drift zooms IN to 1.06-1.2. A framed post is a 1080×1920 image
 * whose frame art runs right to the edges (equalizer bars along the bottom,
 * lettering at the top), and any zoom past 1 pushes those edges out of the
 * tile — the wall showed guests' frames with the bottom cut off.
 *
 * FRAMED_KB keeps the same slow "breathing" motion but never goes past 1:
 * every keyframe scales at or below 1, and any pixel offset is smaller than
 * the margin that scale leaves, so the whole frame stays inside the tile.
 * Legacy walls keep LEGACY_KB unchanged.
 */

export type KbKeyframe = { scale: number; x: number; y: number };
export type KbConfig = { from: KbKeyframe; to: KbKeyframe };

/** The shipped drift (legacy walls). Zooms in — crops the edges. */
export const LEGACY_KB: readonly KbConfig[] = [
  { from: { scale: 1.08, x: -2, y: -2 }, to: { scale: 1.18, x: 2, y: 2 } },
  { from: { scale: 1.1, x: 1, y: -1 }, to: { scale: 1.2, x: -2, y: 1 } },
  { from: { scale: 1.12, x: -1, y: 2 }, to: { scale: 1.06, x: 2, y: -2 } },
  { from: { scale: 1.15, x: 0, y: -1 }, to: { scale: 1.08, x: 0, y: 1 } },
];

/** Platform walls: the same drift family, contained (scale ≤ 1). */
export const FRAMED_KB: readonly KbConfig[] = [
  { from: { scale: 0.95, x: -2, y: -2 }, to: { scale: 1, x: 0, y: 0 } },
  { from: { scale: 1, x: 0, y: 0 }, to: { scale: 0.95, x: 2, y: 1 } },
  { from: { scale: 0.97, x: 1, y: -1 }, to: { scale: 0.94, x: -2, y: 1 } },
  { from: { scale: 0.94, x: 0, y: 1 }, to: { scale: 0.98, x: 0, y: -1 } },
];

/** The drift for slide/spotlight number `n`. */
export function kenBurnsFor(n: number, framed: boolean): KbConfig {
  const set = framed ? FRAMED_KB : LEGACY_KB;
  const i = ((Math.trunc(n) % set.length) + set.length) % set.length;
  return set[i];
}

/**
 * Does this keyframe keep a `w`×`h` image entirely inside its own `w`×`h`
 * box? Scaling about the centre leaves (1 - scale)/2 of each side free; the
 * x/y offset (px) must fit inside that margin.
 */
export function keyframeContained(k: KbKeyframe, w: number, h: number): boolean {
  if (k.scale > 1) return false;
  const mx = ((1 - k.scale) / 2) * w;
  const my = ((1 - k.scale) / 2) * h;
  return Math.abs(k.x) <= mx + 1e-9 && Math.abs(k.y) <= my + 1e-9;
}
