/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stage box sizing.
 *
 * The studio stage and the preview inside it both used
 * `className="h-full" style={{ aspectRatio: '9/16', maxWidth: '100%' }}`, which
 * silently is NOT a 9:16 box. CSS `aspect-ratio` only derives the axis that is
 * missing; with `height: 100%` definite, the height is never recomputed when
 * `max-width` clamps the width. So on any layout where width binds first — a
 * phone, or a laptop with the Director panel open — the box quietly became
 * narrower than 9:16 and the `object-cover` composite inside it cropped the
 * host's own frame edges off. Placements tuned there do not match the capture.
 *
 * fitStageBox is the honest version: pick the largest 9:16 box that fits inside
 * the space available on BOTH axes.
 */

/** Guest capture is portrait 9:16 — the booth's fixed buffer (StageCanvas). */
export const STAGE_ASPECT = 9 / 16;

export interface StageBox {
  w: number;
  h: number;
}

/**
 * Largest box of `ratio` (width / height) fitting within `availW` x `availH`.
 * Non-finite or non-positive input yields a zero box rather than NaN geometry.
 */
export function fitStageBox(availW: number, availH: number, ratio: number = STAGE_ASPECT): StageBox {
  if (!Number.isFinite(availW) || !Number.isFinite(availH) || !Number.isFinite(ratio)) return { w: 0, h: 0 };
  if (availW <= 0 || availH <= 0 || ratio <= 0) return { w: 0, h: 0 };
  // Height-bound unless the width cannot support it.
  const h = Math.min(availH, availW / ratio);
  return { w: h * ratio, h };
}

/**
 * How much of the 9:16 stage may sit off-screen on a phone before the booth
 * gives up filling the screen: 30% of the box on one axis (15% a side). A
 * 390x844 phone hides 18%, a Fold outer screen (21:9) 24%; a near-square
 * screen (a Fold opened, a tablet) would hide 37%, so it letterboxes instead.
 */
export const MAX_STAGE_TRIM = 0.3;

/**
 * The booth's guest stage on a phone: the smallest 9:16 box that COVERS the
 * space (camera-app style, no black bars, edges run off-screen), unless that
 * would hide more than `maxTrim` of the box on either axis, in which case it
 * is the fitted box. The capture is unchanged either way: StageCanvas always
 * writes the full 9:16 frame.
 */
export function fillStageBox(
  availW: number,
  availH: number,
  maxTrim: number = MAX_STAGE_TRIM,
  ratio: number = STAGE_ASPECT,
): StageBox {
  const fit = fitStageBox(availW, availH, ratio);
  if (fit.w === 0) return fit;
  // Cover: height-bound when the space is narrower than the ratio.
  const h = Math.max(availH, availW / ratio);
  const cover = { w: h * ratio, h };
  const hidden = Math.max(1 - availW / cover.w, 1 - availH / cover.h);
  return hidden <= maxTrim + 1e-9 ? cover : fit;
}

/** Pixels of the stage hidden past each edge of the space (0 when it fits). */
export function stageBleed(box: StageBox, availW: number, availH: number): { x: number; y: number } {
  return {
    x: Math.max(0, (box.w - availW) / 2),
    y: Math.max(0, (box.h - availH) / 2),
  };
}
