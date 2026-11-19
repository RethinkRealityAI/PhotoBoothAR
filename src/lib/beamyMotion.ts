/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyMotion — the /beamy page's ONE rule for what reduced motion may do.
 * Pure, DOM-free, tested in node.
 *
 * Two kinds of motion:
 *   • content — the story itself: a phone scanning a code, a shot landing on
 *     the wall, a challenge being completed, a keepsake film playing. It plays
 *     for EVERYONE, in the same order and at the same pace. Under reduced
 *     motion it is only softened (fades instead of flights, no bounce).
 *   • decor — ambience: floating pieces, pointer parallax, shards, glints.
 *     Off under reduced motion.
 *
 * Why this exists: v7 put the story's sequences inside the CSS
 * `@media (prefers-reduced-motion: reduce)` block as "straight to the last
 * frame". Desktop Chrome on a machine with animations turned off (Windows
 * "Show animations" off, Android "Remove animations") reports reduce, so for
 * those visitors the challenge, the keepsake film and the scan never played,
 * while iOS (no Reduce Motion set) was fine. The page now stamps the policy
 * on its root (`data-content-motion` / `data-decor-motion`) and content
 * softening keys on that attribute; the reduced-motion media block may only
 * touch decor. beamyMotion.test.ts reads brand.css and fails if a content
 * class ever appears in that block again.
 */

export type MotionKind = 'content' | 'decor';
/** full = as designed; soft = same story, gentler (fades, no bounce); off = held still. */
export type MotionLevel = 'full' | 'soft' | 'off';

/** The policy: content is never 'off'; decor is never 'soft'. */
export function motionLevel(kind: MotionKind, reduced: boolean): MotionLevel {
  if (kind === 'content') return reduced ? 'soft' : 'full';
  return reduced ? 'off' : 'full';
}

/** The page root's attributes for the policy (CSS keys content softening on them). */
export function motionAttrs(reduced: boolean): { 'data-content-motion': MotionLevel; 'data-decor-motion': MotionLevel } {
  return { 'data-content-motion': motionLevel('content', reduced), 'data-decor-motion': motionLevel('decor', reduced) };
}

/**
 * Class-name prefixes whose animation IS story content. The reduced-motion
 * media block must never name one of these (the test enforces it).
 */
export const CONTENT_MOTION_CLASSES = [
  'bw-qr-', 'bw-scene-scan', 'bw-ch-', 'bw-ks-', 'bw-kb', 'bw-scene-track', 'bw-seq', 'bw-wl-',
] as const;
