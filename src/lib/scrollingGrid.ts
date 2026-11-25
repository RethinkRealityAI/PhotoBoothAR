/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure layout math for the split screen's auto-scrolling photo grid
 * (components/wall/ScrollingGridWall). N columns, N rows on screen, and the
 * whole list drifting upward on a seamless loop.
 */

/** Whether there is anything to scroll: more photos than one screen holds. */
export function gridScrolls(count: number, cols: number): boolean {
  return cols > 0 && count > cols * cols;
}

/**
 * Indexes (into the posts array) for ONE loop period, padded with the newest
 * photos so it fills whole rows. Without the padding a 10-photo, 3-column loop
 * would end on a one-photo row and the second copy would start mid-row, so the
 * wrap would visibly jump sideways.
 */
export function loopIndexes(count: number, cols: number): number[] {
  if (count <= 0 || cols <= 0) return [];
  const pad = (cols - (count % cols)) % cols;
  const out: number[] = [];
  for (let i = 0; i < count + pad; i++) out.push(i % count);
  return out;
}

/** Height of one loop period in px: whole rows of (tile + gap). */
export function loopHeight(periodLength: number, cols: number, tileH: number, gap: number): number {
  if (cols <= 0 || periodLength <= 0) return 0;
  return Math.ceil(periodLength / cols) * (tileH + gap);
}

/** Advance the scroll offset by `px` and wrap it into [0, period). */
export function wrapOffset(offset: number, px: number, period: number): number {
  if (!(period > 0)) return 0;
  const next = (offset + px) % period;
  return next < 0 ? next + period : next;
}
