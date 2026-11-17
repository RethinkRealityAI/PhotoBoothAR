/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared, throttled HAND detection — the hand-side sibling of faceRig.ts.
 * Owns the module-global stash of the latest gesture scores + firing anchor so
 * every consumer (booth trigger loop, BeamFX, HandRig) reuses ONE detection.
 *
 * Cadence policy (all deliberate, see docs/STATE.md AR Power-Ups notes):
 *  - 66ms floor (~15/s) — half the face rate; gestures are held poses, not
 *    saccades, and detectForVideo blocks the main thread.
 *  - Never on the same rAF tick as a face inference (FACE_LOCKOUT_MS) — the
 *    pair is ~25-30ms of block on a mid phone, a visible frame drop.
 *  - Back off to 150ms after several consecutive empty results: "no hand" is
 *    the EXPENSIVE state (the 192×192 palm detector is graph-gated off while
 *    tracking holds, and runs on every call once it's lost).
 */

import { getHandLandmarker } from './handTracking';
import { getLatestFaceKeypoints, lastFaceDetectMs } from './faceRig';
import { createDetectGate, markDetected, shouldDetect } from './faceDetectClock';
import {
  handAnchor,
  handGestureScores,
  type HandAnchorSample,
  type HandSample,
} from './handGestures';
import { HandPoseTracker, type SharedHandPose } from './handPoseFilter';
import { claimFrameInference, isLegacyFaceSession } from './faceEngine';
import { detectInputSize } from './faceEngine/mediapipeEngine';

const HAND_DETECT_INTERVAL_MS = 66;
const IDLE_DETECT_INTERVAL_MS = 150;
/** Consecutive empty results before dropping to the idle cadence. */
const IDLE_AFTER_MISSES = 8;
/** Never run hand inference within this window after a face inference. */
const FACE_LOCKOUT_MS = 10;

const _gate = createDetectGate();
let _lastTs = 0;
let _misses = 0;

let _scores: Record<string, number> = {};
let _anchor: HandAnchorSample | null = null;
let _hands: HandSample[] = [];
let _handedness: ('Left' | 'Right')[] = [];
let _t = 0;
let _has = false;
/** ONE filtered pose for every consumer (HandRig, HandOccluder) — see
 *  handPoseFilter.ts for why they must not each solve their own. */
const _tracker = new HandPoseTracker();
let _shared: SharedHandPose | null = null;

/**
 * PLATFORM ONLY: the hand landmarker's reused downscaled input (short side
 * DETECT_SHORT_SIDE, same aspect, so normalized landmarks and `aspect` are
 * unchanged). Its own canvas, not the face engine's: the per-frame token means
 * the face canvas always holds an EARLIER frame by the time the hand runs.
 */
let _small: HTMLCanvasElement | null = null;
let _smallCtx: CanvasRenderingContext2D | null = null;

function stageSmall(video: HTMLVideoElement): HTMLCanvasElement | null {
  const { w, h } = detectInputSize(video.videoWidth, video.videoHeight);
  if (w === 0 || h === 0) return null;
  if (_small === null) {
    _small = document.createElement('canvas');
    _smallCtx = _small.getContext('2d', { willReadFrequently: false });
  }
  if (_smallCtx === null) return null;
  if (_small.width !== w || _small.height !== h) {
    _small.width = w;
    _small.height = h;
  }
  _smallCtx.drawImage(video, 0, 0, w, h);
  return _small;
}

/** The camera stream the stash belongs to (undefined = none seen yet). */
let _streamId: string | null | undefined;

function streamIdOf(video: HTMLVideoElement): string | null {
  const so = (video as { srcObject?: unknown }).srcObject as { id?: unknown } | null | undefined;
  return so && typeof so.id === 'string' ? so.id : null;
}

/** Scratch HandSample array rebuilt per detection (numHands is 1-2, tiny). */
function toSamples(landmarks: { x: number; y: number; z: number }[][], world: { x: number; y: number; z: number }[][]): HandSample[] {
  const out: HandSample[] = [];
  for (let i = 0; i < landmarks.length; i++) {
    out.push({ landmarks: landmarks[i], world: world[i] ?? [] });
  }
  return out;
}

/**
 * Drive hand detection from a rAF loop. No-op until the landmarker is ready
 * and the video has data; self-throttles, so calling every frame is fine.
 */
export function detectHandsNow(video: HTMLVideoElement): void {
  const hl = getHandLandmarker();
  if (!hl || !video || video.readyState < 2) return;
  // A camera STREAM change (front↔back flip) forgets the old camera's hand,
  // exactly like faceRig's resetFaceRig: its pose and gesture stash would
  // otherwise linger over the new feed, mirrored the wrong way.
  const sid = streamIdOf(video);
  if (sid !== _streamId) {
    if (_streamId !== undefined) resetHandRig();
    _streamId = sid;
  }
  const now = performance.now();
  // Legacy keeps the original time lockout and the raw <video> input, byte for
  // byte. The platform shares lane B's per-FRAME token instead (the lockout is
  // measured from the face inference's START, so it had always expired).
  const platform = !isLegacyFaceSession();
  if (!platform && now - lastFaceDetectMs() < FACE_LOCKOUT_MS) return;
  const interval = _misses >= IDLE_AFTER_MISSES ? IDLE_DETECT_INTERVAL_MS : HAND_DETECT_INTERVAL_MS;
  if (!shouldDetect(_gate, now, video.currentTime, { minIntervalMs: interval })) return;
  // Not claimed → someone already ran a blocking inference this frame; retry
  // next frame with the gate untouched (same idiom as mediapipeEngine).
  if (platform && !claimFrameInference('hand')) return;
  markDetected(_gate, now, video.currentTime);
  let results;
  try {
    const ts = Math.max(now, _lastTs + 1);
    _lastTs = ts;
    const input = platform ? stageSmall(video) : video;
    results = hl.detectForVideo(input ?? video, ts);
  } catch {
    return;
  }
  // Stash rebuilt on EVERY detection — an empty result zeroes all channels so
  // a hand leaving frame decays every gesture instead of latching it.
  const hands = results ? toSamples(results.landmarks ?? [], results.worldLandmarks ?? []) : [];
  _misses = hands.length === 0 ? _misses + 1 : 0;
  const face = getLatestFaceKeypoints();
  // Landmarks are normalized per-axis (x/W, y/H); every gesture ratio compares
  // distances, so the scorer needs W/H to undo that anisotropy — without it a
  // portrait feed stretches every x-distance by 1.78 and biases each band.
  // Falls back to 1 (square) before metadata lands, never to 0/NaN.
  const aspect = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 1;
  // MediaPipe's handedness label assumes MIRRORED input; we feed raw frames,
  // so the label is swapped here, once, and every consumer sees the REAL hand.
  _handedness = (results?.handednesses ?? []).map((cats) =>
    cats[0]?.categoryName === 'Left' ? 'Right' : 'Left',
  );
  _scores = handGestureScores(hands, face, aspect);
  // Handedness signs the palm normal, so the fallback beam fires out of a LEFT
  // palm too rather than into the scene behind it.
  _anchor = handAnchor(hands, face, aspect, _handedness);
  _hands = hands;
  // An empty result keeps the last shared pose (consumers hide it after their
  // hold window by its own `t`); a degenerate solve also keeps it.
  if (hands.length > 0) {
    const shared = _tracker.update(hands[0], _handedness[0] ?? 'Right', aspect, now);
    if (shared !== null) _shared = shared;
  }
  _t = now;
  _has = true;
}

/**
 * The shared filtered hand pose (RAW frame), or null before the first solved
 * hand. Its `t` is the inference that produced it; it is NOT cleared when the
 * hand leaves, so consumers decide visibility from `t` (HAND_HOLD_MS).
 */
export function getSharedHandPose(): SharedHandPose | null {
  return _shared;
}

/**
 * Latest gesture scores + firing anchor, or null before the first detection.
 * `t` is the detection's performance.now(), so callers step their engine once
 * per NEW detection. Zero allocation on read.
 */
export function getLatestHandFrame(): {
  scores: Record<string, number>;
  anchor: HandAnchorSample | null;
  /** Raw samples + REAL (label-swapped) handedness, index-aligned. */
  hands: readonly HandSample[];
  handedness: readonly ('Left' | 'Right')[];
  t: number;
} | null {
  return _has ? { scores: _scores, anchor: _anchor, hands: _hands, handedness: _handedness, t: _t } : null;
}

/** Scene switch / booth unmount — forget everything (next scene must not see
 *  a stale fist from the previous guest). */
export function resetHandRig(): void {
  _scores = {};
  _anchor = null;
  _hands = [];
  _handedness = [];
  _has = false;
  _misses = 0;
  _tracker.reset();
  _shared = null;
  _gate.lastDetectMs = -Infinity;
  _gate.lastVideoTime = -1;
}
