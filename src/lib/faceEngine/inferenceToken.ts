/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE blocking inference per rendered frame — pure, so the policy is tested in
 * node without MediaPipe.
 *
 * Face and hand landmarkers both run synchronously on the main thread (CPU
 * delegate, 25-60ms each on a phone). Two of them in one rAF tick is a dropped
 * frame. The old guard was a time lockout against `lastFaceDetectMs()`, but
 * that stamp is the inference START, and the inference itself takes 27-59ms —
 * so a 10ms lockout measured from the start had always expired by the time the
 * hand side looked, and both ran back to back.
 *
 * A token keyed on the FRAME instead of a duration has no such race: whoever
 * claims first in a frame runs, everyone else waits for the next frame.
 *
 * Frame identity: `document.timeline.currentTime`, which the browser updates
 * once per rendering update before running rAF callbacks — so every callback
 * of one frame (R3F's loop, StageCanvas's loop, the booth trigger loop) reads
 * the SAME number. Outside a browser `frameClock()` returns NaN and the caller
 * passes its own ids (tests).
 */

export type InferenceOwner = 'face' | 'face-blend' | 'hand';

export interface InferenceToken {
  /** Frame id of the last claim (NaN = never claimed). */
  frame: number;
  owner: InferenceOwner | null;
}

export function createInferenceToken(): InferenceToken {
  return { frame: Number.NaN, owner: null };
}

/**
 * Claim this frame's one blocking inference. True = run it now; false =
 * someone already ran one this frame, try next frame. A non-finite frame id
 * (no frame clock) always grants: never go dark because a clock is missing.
 * Pure apart from writing the token it is given.
 */
export function claimInference(tok: InferenceToken, frameId: number, owner: InferenceOwner): boolean {
  if (!Number.isFinite(frameId)) {
    tok.owner = owner;
    return true;
  }
  if (tok.frame === frameId) return false;
  tok.frame = frameId;
  tok.owner = owner;
  return true;
}

/** Did anything claim an inference in `frameId`? (Read-only; for diagnostics.) */
export function frameClaimed(tok: InferenceToken, frameId: number): boolean {
  return Number.isFinite(frameId) && tok.frame === frameId;
}

/** The current rendering update's id, shared by every rAF callback of one frame. NaN without a document. */
export function frameClock(): number {
  try {
    const t = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
    return typeof t === 'number' && Number.isFinite(t) ? t : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/**
 * The ONE token every main-thread landmarker shares. The face side
 * (mediapipeEngine) claims it; HANDOFF: handRig.ts should replace its
 * FACE_LOCKOUT_MS check with `claimFrameInference('hand')`.
 */
export const FRAME_INFERENCE_TOKEN: InferenceToken = createInferenceToken();

/** Claim the shared token for the current frame. */
export function claimFrameInference(owner: InferenceOwner): boolean {
  return claimInference(FRAME_INFERENCE_TOKEN, frameClock(), owner);
}
