/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which 8th Wall frame the compositor may draw under the pose the app holds.
 * Pure, so it is tested in node without XR8.
 *
 * 8th Wall redraws its draw canvas on EVERY pipeline pass (its own rAF loop),
 * but a pose reaches the app only when poll() hands it over. A pass that runs
 * after poll() and before the compositor draws would show frame N+1 under pose
 * N, so the frame would lead the pose by one sample. The fix: before a pass
 * redraws a canvas that shows the HANDED sample's frame, copy it into a held
 * slot. The compositor then draws the live canvas while it matches the handed
 * sample, and the held copy while the canvas has run ahead.
 *
 * Times are the samples' `t` (performance.now()); NaN = none / unmatched.
 */

export interface AnalysedFrameSync {
  /** t of the sample whose frame the live canvas shows (NaN: a frame with no sample). */
  canvasT: number;
  /** t of the last sample poll() handed to the app. */
  handedT: number;
  /** t of the sample whose frame the held copy shows. */
  heldT: number;
}

export function createAnalysedFrameSync(): AnalysedFrameSync {
  return { canvasT: Number.NaN, handedT: Number.NaN, heldT: Number.NaN };
}

/** A pass is about to redraw the live canvas: true = copy it into the held slot first. */
export function analysedFrameNeedsHold(s: AnalysedFrameSync): boolean {
  return Number.isFinite(s.handedT) && s.canvasT === s.handedT && s.heldT !== s.handedT;
}

/** The copy succeeded: the held slot now shows the handed sample's frame. */
export function analysedFrameMarkHeld(s: AnalysedFrameSync): void {
  s.heldT = s.handedT;
}

/**
 * A pass finished. `emittedT`: the sample it produced (its frame is what the
 * pass drew), or null. `drewNewFrame`: it drew a new camera frame (non-repeat).
 */
export function analysedFrameAfterPass(s: AnalysedFrameSync, emittedT: number | null, drewNewFrame: boolean): void {
  if (emittedT !== null) s.canvasT = emittedT;
  else if (drewNewFrame) s.canvasT = Number.NaN;
}

/** poll() handed sample `t` to the app. */
export function analysedFrameHandOver(s: AnalysedFrameSync, t: number): void {
  s.handedT = t;
}

/** 'held' only when the live canvas has run past the handed sample and the held copy is its frame. */
export function pickAnalysedFrame(s: AnalysedFrameSync): 'live' | 'held' {
  if (s.canvasT === s.handedT) return 'live';
  return Number.isFinite(s.handedT) && s.heldT === s.handedT ? 'held' : 'live';
}

export function resetAnalysedFrameSync(s: AnalysedFrameSync): void {
  s.canvasT = Number.NaN;
  s.handedT = Number.NaN;
  s.heldT = Number.NaN;
}
