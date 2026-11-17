/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MediaPipe FaceLandmarker as a FaceEngine — the DETECTION half that used to
 * live inline in faceRig.ts `detectIfDue`, moved here unchanged so mode
 * 'mediapipe' runs EXACTLY the shipped path: the same DetectGate at the same
 * 33ms floor, the same strictly-monotonic timestamp guard, the same try/catch
 * around detectForVideo, and the same blendshape map / six keypoints
 * (faceRig's stash functions now read them off the FaceSample).
 *
 * Also owns the HYBRID side path: blendshapes only, at a reduced rate with its
 * OWN gate (8th Wall supplies the pose there, so this pose is discarded). Both
 * paths share ONE landmarker, so they share ONE timestamp guard — MediaPipe
 * rejects any non-increasing ts on a landmarker, whichever caller sent it.
 */
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { getFaceLandmarker, initializeFaceLandmarker } from '../faceTracking';
import { createDetectGate, shouldDetect, markDetected } from '../faceDetectClock';
import type { FaceEngine, FaceKeypoints, FaceSample } from './types';

/** ~30 detections/sec (floor, not a schedule) — faceRig's DETECT_INTERVAL_MS. */
const DETECT_INTERVAL_MS = 33;
/**
 * Hybrid blendshape cadence (~15/s). Expressions are slower than head motion,
 * and this inference blocks the main thread, so half the face rate keeps
 * 8th Wall's pose loop free. Same floor as the hand landmarker, which the
 * 10ms face lockout in handRig then interleaves with.
 */
export const HYBRID_BLEND_INTERVAL_MS = 66;

/** Monotonic timestamp guard — MediaPipe requires strictly increasing ts. */
let _lastTs = 0;

/** FaceLandmarkerResult → FaceSample, field for field what faceRig stashed. */
export function sampleFromResult(results: FaceLandmarkerResult | undefined, now: number): FaceSample {
  const cats = results?.faceBlendshapes?.[0]?.categories;
  const blendshapes: Record<string, number> = {};
  if (cats) for (const c of cats) if (c.categoryName) blendshapes[c.categoryName] = c.score;

  // The temple gesture needs exactly six landmarks: forehead 10, chin 152 and
  // the ear-pair midpoints 127/234 and 356/454. Raw, unmirrored, normalized.
  const lm = results?.faceLandmarks?.[0];
  let keypoints: FaceKeypoints | null = null;
  if (lm && lm.length >= 455) {
    keypoints = {
      forehead: { x: lm[10].x, y: lm[10].y },
      chin: { x: lm[152].x, y: lm[152].y },
      leftEar: { x: (lm[127].x + lm[234].x) / 2, y: (lm[127].y + lm[234].y) / 2 },
      rightEar: { x: (lm[356].x + lm[454].x) / 2, y: (lm[356].y + lm[454].y) / 2 },
    };
  }

  const mats = results?.facialTransformationMatrixes;
  const matrix = mats && mats.length > 0 ? mats[0].data : null;
  return { t: now, matrix, blendshapes, keypoints };
}

export interface MediapipeFaceEngine extends FaceEngine {
  readonly id: 'mediapipe';
  /**
   * Hybrid only: a blendshape sample at HYBRID_BLEND_INTERVAL_MS under its own
   * gate, or null. The sample's matrix/keypoints are ignored by the caller.
   */
  pollBlendshapes(video: HTMLVideoElement, now: number): FaceSample | null;
}

/** Run one detection, or `undefined`-vs-throw distinguished: null = it threw. */
function detect(video: HTMLVideoElement, now: number): { r: FaceLandmarkerResult | undefined } | null {
  const fl = getFaceLandmarker();
  if (!fl) return null;
  try {
    const ts = Math.max(now, _lastTs + 1);
    _lastTs = ts;
    return { r: fl.detectForVideo(video, ts) };
  } catch {
    return null;
  }
}

export function createMediapipeEngine(): MediapipeFaceEngine {
  /** Frame gate: rate limit PLUS "has the camera actually produced a new frame". */
  const gate = createDetectGate();
  const blendGate = createDetectGate();

  return {
    id: 'mediapipe',
    async init() {
      await initializeFaceLandmarker();
    },
    isReady() {
      return getFaceLandmarker() !== null;
    },
    poll(video, now) {
      if (getFaceLandmarker() === null) return null;
      // video.currentTime is the frame identity; the gate skips a frame already
      // analysed and has a watchdog so a stuck clock can never freeze tracking.
      const videoTime = video.currentTime;
      if (!shouldDetect(gate, now, videoTime, { minIntervalMs: DETECT_INTERVAL_MS })) return null;
      markDetected(gate, now, videoTime);
      const out = detect(video, now);
      return out === null ? null : sampleFromResult(out.r, now);
    },
    pollBlendshapes(video, now) {
      if (getFaceLandmarker() === null) return null;
      const videoTime = video.currentTime;
      if (!shouldDetect(blendGate, now, videoTime, { minIntervalMs: HYBRID_BLEND_INTERVAL_MS })) return null;
      markDetected(blendGate, now, videoTime);
      const out = detect(video, now);
      return out === null ? null : sampleFromResult(out.r, now);
    },
    lastInferenceMs() {
      // In mode 'mediapipe' the blend gate never runs (stays -Infinity), so
      // this is exactly the old faceRig `_detectGate.lastDetectMs`.
      return Math.max(gate.lastDetectMs, blendGate.lastDetectMs);
    },
    dispose() {
      // Deliberately does NOT close the landmarker: it is a cached module
      // singleton (faceTracking.ts) the hand tracker's fileset sits beside, it
      // holds no WebGL context (CPU delegate), and re-creating it on every
      // filter switch would leave the guest untracked for the re-init.
    },
  };
}
