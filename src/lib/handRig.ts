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
  const now = performance.now();
  if (now - lastFaceDetectMs() < FACE_LOCKOUT_MS) return;
  const interval = _misses >= IDLE_AFTER_MISSES ? IDLE_DETECT_INTERVAL_MS : HAND_DETECT_INTERVAL_MS;
  if (!shouldDetect(_gate, now, video.currentTime, { minIntervalMs: interval })) return;
  markDetected(_gate, now, video.currentTime);
  let results;
  try {
    const ts = Math.max(now, _lastTs + 1);
    _lastTs = ts;
    results = hl.detectForVideo(video, ts);
  } catch {
    return;
  }
  // Stash rebuilt on EVERY detection — an empty result zeroes all channels so
  // a hand leaving frame decays every gesture instead of latching it.
  const hands = results ? toSamples(results.landmarks ?? [], results.worldLandmarks ?? []) : [];
  _misses = hands.length === 0 ? _misses + 1 : 0;
  const face = getLatestFaceKeypoints();
  _scores = handGestureScores(hands, face);
  _anchor = handAnchor(hands, face);
  _hands = hands;
  // MediaPipe's handedness label assumes MIRRORED input; we feed raw frames,
  // so the label is swapped here, once, and every consumer sees the REAL hand.
  _handedness = (results?.handednesses ?? []).map((cats) =>
    cats[0]?.categoryName === 'Left' ? 'Right' : 'Left',
  );
  _t = now;
  _has = true;
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
  _gate.lastDetectMs = -Infinity;
  _gate.lastVideoTime = -1;
}
