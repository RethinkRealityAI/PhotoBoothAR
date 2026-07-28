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
