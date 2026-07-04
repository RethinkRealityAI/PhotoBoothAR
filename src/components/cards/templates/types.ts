/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Card template contract — the normalized progress model.
 * =======================================================
 *
 * Every card template (Storybook, FilmStrip, …) is a PURE function of the
 * props below: no internal timers, no data fetching, no ambient/store state.
 * The VIEWER owns the progress state and passes it down, which means a future
 * Remotion (or any frame-by-frame) render can drive the exact same components
 * deterministically by computing `index` / `frameProgress` from the frame
 * number instead of from user input.
 *
 *   index          0            = cover page (title / recipient / count)
 *                  1..N         = contributions[index - 1]
 *                  N + 1        = end page ("Made with Beamwall")
 *                  → total page count = contributions.length + 2
 *   frameProgress  optional 0..1 position WITHIN the current index. Frame
 *                  renderers use it to drive intra-page motion; the
 *                  interactive viewer leaves it undefined and lets motion/CSS
 *                  transitions play instead.
 *   onNext/onPrev  interactive affordances only — templates must render
 *                  correctly when they are omitted (static/render mode).
 *   reducedMotion  true → no page-turn animation (prefers-reduced-motion, or
 *                  a renderer that wants exact per-frame output).
 */
import type { CardViewData, CardViewContribution } from '../../../lib/cards';

export interface CardTemplateProps {
  card: CardViewData;
  contributions: CardViewContribution[];
  index: number;
  frameProgress?: number;
  onNext?: () => void;
  onPrev?: () => void;
  reducedMotion?: boolean;
}

/** Total page count for the normalized progress model. */
export function pageCount(contributions: CardViewContribution[]): number {
  return contributions.length + 2;
}

/** Clamp an arbitrary index into the template's valid page range. */
export function clampIndex(index: number, contributions: CardViewContribution[]): number {
  return Math.max(0, Math.min(pageCount(contributions) - 1, Math.round(index)));
}
