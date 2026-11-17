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
import { getFaceLandmarker, initializeFaceLandmarker, resetFaceLandmarker } from '../faceTracking';
import { createDetectGate, shouldDetect, markDetected } from '../faceDetectClock';
import { claimFrameInference } from './inferenceToken';
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

/**
 * Detection input size (platform): the SHORT side of a same-aspect canvas the
 * frame is downscaled into before inference. The landmarker resizes to its own
 * 192/256px tensors internally, so a 1080x1920 element only bought a bigger
 * internal resize — measured face inference p50: 35.3ms at 1080x1920, 24.9 at
 * 540x960, 19.8 at 360x640. Landmarks are normalized and the transform matrix
 * is solved in metric space, so neither depends on the input size.
 */
export const DETECT_SHORT_SIDE = 360;

/** Same-aspect size with the short side clamped to `short` (never upscales). Pure. */
export function detectInputSize(vw: number, vh: number, short = DETECT_SHORT_SIDE): { w: number; h: number } {
  if (!(vw > 0) || !(vh > 0)) return { w: 0, h: 0 };
  const s = Math.min(vw, vh);
  if (s <= short) return { w: Math.round(vw), h: Math.round(vh) };
  const k = short / s;
  return { w: Math.max(1, Math.round(vw * k)), h: Math.max(1, Math.round(vh * k)) };
}

/** Consecutive detectForVideo throws before the landmarker is presumed dead. */
export const DETECT_THROWS_BEFORE_RESET = 10;

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
  /** The full-res frame the latest POSE sample was computed from (frame-lock), or null. */
  getAnalysedFrame(): HTMLCanvasElement | null;
  /** Keep a full-res copy of each analysed frame (only while a surface frame-locks). */
  setFrameSnapshot(on: boolean): void;
  /** Platform-only detection path (downscaled input + per-frame token). Off = the shipped element path. */
  setPlatformPath(on: boolean): void;
  /** The reused downscaled detection input, or null (legacy path / no frame yet). HANDOFF: the hand
   *  landmarker can adopt this instead of the full-res element (handRig.ts, not edited here). */
  getDetectionCanvas(): HTMLCanvasElement | null;
  /** Main-thread cost of the latest frame staging (snapshot + downscale), ms. Diagnostics. */
  lastStagingMs(): number;
}

export interface MediapipeEngineOptions {
  /**
   * Called when DETECT_THROWS_BEFORE_RESET consecutive inferences threw and the
   * landmarker was closed. The caller re-initializes and surfaces it.
   */
  onLost?: (reason: string) => void;
}

function makeCanvas(): HTMLCanvasElement | null {
  try {
    return typeof document !== 'undefined' ? document.createElement('canvas') : null;
  } catch {
    return null;
  }
}

export function createMediapipeEngine(opts: MediapipeEngineOptions = {}): MediapipeFaceEngine {
  /** Frame gate: rate limit PLUS "has the camera actually produced a new frame". */
  const gate = createDetectGate();
  const blendGate = createDetectGate();
  let platform = false;
  let snapshotOn = false;
  /** Full-res copy of the frame the latest pose sample came from (frame-lock). */
  let snap: HTMLCanvasElement | null = null;
  let snapCtx: CanvasRenderingContext2D | null = null;
  let snapValid = false;
  /** Reused downscaled detection input (platform). */
  let small: HTMLCanvasElement | null = null;
  let smallCtx: CanvasRenderingContext2D | null = null;
  let throws = 0;
  let stagingMs = 0;

  function ensure2d(c: HTMLCanvasElement | null, w: number, h: number): CanvasRenderingContext2D | null {
    if (!c) return null;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    return c.getContext('2d', { alpha: false });
  }

  /**
   * The image this inference runs on. Legacy: the element itself (shipped path,
   * byte-identical). Platform: the frame is copied ONCE (full-res snapshot when
   * frame-locking) and the detector reads a downscale OF THAT COPY, so the
   * snapshot is provably the frame the pose came from.
   */
  function stage(video: HTMLVideoElement, wantSnap: boolean): TexImageSource {
    if (!platform) return video;
    const t0 = performance.now();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let src: TexImageSource = video;
    if (wantSnap && vw > 0 && vh > 0) {
      if (!snap) snap = makeCanvas();
      snapCtx = ensure2d(snap, vw, vh);
      if (snap && snapCtx) {
        snapCtx.drawImage(video, 0, 0, vw, vh);
        src = snap;
      }
    }
    const { w, h } = detectInputSize(vw, vh);
    if (w > 0 && h > 0 && (w !== vw || h !== vh)) {
      if (!small) small = makeCanvas();
      smallCtx = ensure2d(small, w, h);
      if (small && smallCtx) {
        smallCtx.drawImage(src as CanvasImageSource, 0, 0, w, h);
        src = small;
      }
    }
    stagingMs = performance.now() - t0;
    return src;
  }

  /** Run one detection; null = no landmarker or it threw (counted toward a reset). */
  function detect(input: TexImageSource, now: number): { r: FaceLandmarkerResult | undefined } | null {
    const fl = getFaceLandmarker();
    if (!fl) return null;
    try {
      const ts = Math.max(now, _lastTs + 1);
      _lastTs = ts;
      const r = fl.detectForVideo(input, ts);
      throws = 0;
      return { r };
    } catch (e) {
      throws++;
      if (platform && throws >= DETECT_THROWS_BEFORE_RESET) {
        throws = 0;
        snapValid = false;
        resetFaceLandmarker();
        const msg = e instanceof Error ? e.message : String(e);
        opts.onLost?.(`face landmarker stopped responding (${DETECT_THROWS_BEFORE_RESET} failed inferences): ${msg.slice(0, 120)}`);
      }
      return null;
    }
  }

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
      // Platform: one blocking inference per rendered frame (the hand side
      // shares the token). Not claimed → retry next frame, gate untouched.
      if (platform && !claimFrameInference('face')) return null;
      markDetected(gate, now, videoTime);
      const out = detect(stage(video, snapshotOn), now);
      snapValid = out !== null && snapshotOn && snap !== null && platform;
      return out === null ? null : sampleFromResult(out.r, now);
    },
    pollBlendshapes(video, now) {
      if (getFaceLandmarker() === null) return null;
      const videoTime = video.currentTime;
      if (!shouldDetect(blendGate, now, videoTime, { minIntervalMs: HYBRID_BLEND_INTERVAL_MS })) return null;
      if (platform && !claimFrameInference('face-blend')) return null;
      markDetected(blendGate, now, videoTime);
      // Expressions only: never touches the pose snapshot (8th Wall owns the pose).
      const out = detect(stage(video, false), now);
      return out === null ? null : sampleFromResult(out.r, now);
    },
    lastInferenceMs() {
      // In mode 'mediapipe' the blend gate never runs (stays -Infinity), so
      // this is exactly the old faceRig `_detectGate.lastDetectMs`.
      return Math.max(gate.lastDetectMs, blendGate.lastDetectMs);
    },
    getAnalysedFrame() {
      return snapshotOn && snapValid ? snap : null;
    },
    setFrameSnapshot(on) {
      if (snapshotOn === on) return;
      snapshotOn = on;
      snapValid = false; // the next analysed frame fills it
      if (!on && snap) {
        // Release the full-res buffer while nobody frame-locks.
        snap.width = 0;
        snap.height = 0;
      }
    },
    setPlatformPath(on) {
      platform = on;
      if (!on) snapValid = false;
    },
    getDetectionCanvas() {
      return platform ? small : null;
    },
    lastStagingMs() {
      return stagingMs;
    },
    dispose() {
      // Deliberately does NOT close the landmarker: it is a cached module
      // singleton (faceTracking.ts) the hand tracker's fileset sits beside, it
      // holds no WebGL context (CPU delegate), and re-creating it on every
      // filter switch would leave the guest untracked for the re-init.
      snapValid = false;
    },
  };
}
