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
  'bw-qr-', 'bw-scene-scan', 'bw-ch-', 'bw-ks-', 'bw-kb', 'bw-scene-track', 'bw-seq', 'bw-wl-', 'bw-ar-',
] as const;

/* ── The story's sequencer ─────────────────────────────────────────────
   Each "How it works" scene is an ordered timeline of cues (ms from the
   moment its step becomes active). A scene shows a piece only once its cue
   has started, so nothing appears all at once; leaving the step resets it,
   so it replays on every entry. `loop` (ms) repeats the whole timeline (a
   live wall keeps receiving shots); without it the last frame holds. The
   same timeline runs under reduced motion: only the CSS softens. */

export interface Cue { id: string; at: number; }
export interface Sequence { cues: readonly Cue[]; loop?: number; }

/** Minimum gap between two cues: the eye must be able to follow each one. */
export const MIN_CUE_GAP_MS = 400;

/** Build a sequence from [id, startMs] pairs; throws on duplicates, unsorted or crowded cues. */
export function sequence(pairs: readonly (readonly [string, number])[], loop?: number): Sequence {
  const cues = pairs.map(([id, at]) => ({ id, at }));
  for (let k = 0; k < cues.length; k++) {
    if (!(cues[k].at > 0)) throw new Error(`cue ${cues[k].id} must start after entry`);
    if (k > 0 && cues[k].at - cues[k - 1].at < MIN_CUE_GAP_MS) throw new Error(`cue ${cues[k].id} crowds ${cues[k - 1].id}`);
    if (cues.findIndex((c) => c.id === cues[k].id) !== k) throw new Error(`duplicate cue ${cues[k].id}`);
  }
  if (loop !== undefined && cues.length > 0 && !(loop > cues[cues.length - 1].at)) throw new Error('loop must outlast the last cue');
  return { cues, loop };
}

/** Elapsed time folded into one pass (looping sequences wrap). */
function local(s: Sequence, t: number): number {
  const u = Math.max(0, t);
  return s.loop !== undefined ? u % s.loop : u;
}

/** How many cues have started `t` ms after entry (0 = none yet). */
export function phaseAt(s: Sequence, t: number): number {
  const u = local(s, t);
  let n = 0;
  for (const c of s.cues) if (c.at <= u) n++;
  return n;
}

/** Which pass of a looping sequence `t` falls in (0 for one-shots). */
export function passAt(s: Sequence, t: number): number {
  return s.loop !== undefined ? Math.floor(Math.max(0, t) / s.loop) : 0;
}

/** Has cue `id` started at this phase? (Unknown ids never have.) */
export function reached(s: Sequence, phase: number, id: string): boolean {
  const k = s.cues.findIndex((c) => c.id === id);
  return k >= 0 && k < phase;
}

/** The cue that has most recently started, or null before the first. */
export function currentCue(s: Sequence, phase: number): string | null {
  return phase > 0 ? s.cues[Math.min(phase, s.cues.length) - 1].id : null;
}

/** Ms from `t` until the phase next changes (a cue starts or the loop wraps); null = held for good. */
export function nextChange(s: Sequence, t: number): number | null {
  const u = local(s, t);
  for (const c of s.cues) if (c.at > u) return c.at - u;
  return s.loop !== undefined ? s.loop - u : null;
}
