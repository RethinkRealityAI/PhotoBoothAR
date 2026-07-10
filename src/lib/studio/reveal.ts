/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure timing for the booth "reveal" moment — the transient DOM shimmer +
 * 3D scale-in spring played when a guest applies a NEW db-sourced experience
 * selection (Booth.tsx). Zero three/react imports so this is unit-testable
 * in plain node/vitest, mirroring animation.ts alongside it. The DOM shimmer
 * itself (motion/react keyframes, CSS gradients) is declarative and lives in
 * RevealShimmer.tsx — only the numeric 3D scale curve is pure math.
 */

/**
 * How long Booth keeps its `reveal` flag true (drives both the DOM shimmer's
 * AnimatePresence mount window and the moment Overlay3D's per-piece spring is
 * triggered). The 3D spring below finishes well inside this window.
 */
export const REVEAL_SHIMMER_MS = 600;

/** How long the 3D group scale-in spring takes to settle at exactly 1. */
export const REVEAL_SCALE_MS = 500;

/** Scale at the very start of the reveal (elapsedMs<=0). */
const REVEAL_START_SCALE = 0.6;

/**
 * Scale multiplier for the 3D reveal spring at `elapsedMs` since the piece's
 * reveal started. 0.6 at t<=0, a soft overshoot through the middle, and
 * EXACTLY 1 once elapsedMs >= REVEAL_SCALE_MS — settles precisely so a
 * capture taken any time after the reveal has finished is byte-identical to
 * one taken with no reveal at all.
 */
export function revealScaleAt(elapsedMs: number): number {
  if (elapsedMs <= 0) return REVEAL_START_SCALE;
  if (elapsedMs >= REVEAL_SCALE_MS) return 1;
  const t = elapsedMs / REVEAL_SCALE_MS;
  // easeOutBack: soft overshoot past 1 before settling — reads as a gentle spring.
  const c1 = 1.28;
  const c3 = c1 + 1;
  const tm1 = t - 1;
  const eased = 1 + c3 * tm1 * tm1 * tm1 + c1 * tm1 * tm1;
  return REVEAL_START_SCALE + (1 - REVEAL_START_SCALE) * eased;
}
