/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared, throttled HAND detection + the ONE smoothed hand pose every consumer
 * renders from — the hand-side sibling of faceRig.ts.
 *
 * Owns the module-global stash of the latest gesture scores + firing anchor
 * (trigger engine, BeamFX) AND, per tracked hand, the solved 6DOF pose, the
 * palm-local landmark cloud, the per-guest span lock and the render-rate
 * smoothing state. HandRig (gear) and HandOccluder (the depth shell) both call
 * `stepHandPose` and hang everything off the SAME filtered, predicted palm
 * pose, so a glove and the shell that hides the hand behind it move as a unit:
 * the previous design solved and filtered in each component separately, and
 * the shell — unsmoothed, stepping at the 15Hz detector rate — chewed into the
 * glove by exactly the filter's lag on every fast move.
 *
 * Cadence policy (all deliberate, see docs/STATE.md AR Power-Ups notes):
 *  - 66ms floor (~15/s) — half the face rate; gestures are held poses, not
 *    saccades, and detectForVideo blocks the main thread. Dead reckoning
 *    (smoothing.ts) carries the pose between inferences at render rate.
 *  - Never on the same rAF tick as a face inference: keyed on the face
 *    inference's END time (faceRig.lastFaceInferenceEndMs), not its start —
 *    the start stamp was already older than the lockout by the time a 15ms
 *    face inference returned, so the two blocks paired up every tick.
 *  - Back off to 150ms after several consecutive empty results: "no hand" is
 *    the EXPENSIVE state (the 192×192 palm detector is graph-gated off while
 *    tracking holds, and runs on every call once it's lost).
 */

import { getHandLandmarker } from './handTracking';
import { getLatestFaceKeypoints, lastFaceInferenceEndMs, medianOf } from './faceRig';
import { createDetectGate, markDetected, shouldDetect } from './faceDetectClock';
import {
  handAnchor,
  handGestureScores,
  type HandAnchorSample,
  type HandSample,
} from './handGestures';
import { landmarkLocalPositions, solveHandPose, type HandPose } from './handPose';
import {
  OneEuroQuat,
  OneEuroVec3,
  VelocityQuat,
  VelocityVec3,
  predictionLeadSec,
  type OneEuroConfig,
  type Quat,
  type Vec3,
} from './smoothing';
import { inferenceSource } from './trackingFrame';
import { CANONICAL_PALM_LEN_CM } from './studio/handRefAnchors';

const HAND_DETECT_INTERVAL_MS = 66;
const IDLE_DETECT_INTERVAL_MS = 150;
/** Consecutive empty results before dropping to the idle cadence. */
const IDLE_AFTER_MISSES = 8;
/** Never run hand inference within this window after a face inference ENDS. */
const FACE_LOCKOUT_MS = 12;
/** Keep the last pose through brief misses; hands re-acquire constantly. */
export const HAND_HOLD_MS = 400;
/** Frames of confident tracking before the palm span freezes. */
const SPAN_LOCK_SAMPLES = 30;
/** Per-guest gear scale bounds (the locked span over the canonical palm). */
const HAND_SCALE_MIN = 0.75;
const HAND_SCALE_MAX = 1.3;

/* Smoothing (research-tuned, now stepped at RENDER rate): depth is ~5× noisier
 * than X/Y (∂Z/∂px ≈ 0.8cm at 60cm) and the least visually sensitive channel,
 * so it keeps its own heavier filter. Rotation rides a 4-landmark basis and is
 * the noisiest DOF; its beta is high so a real turn is not smeared. */
const POS_XY: OneEuroConfig = { minCutoff: 1.5, beta: 0.6, dCutoff: 1.0 };
const POS_Z: OneEuroConfig = { minCutoff: 1.0, beta: 0.4, dCutoff: 1.0 };
const ROT: OneEuroConfig = { minCutoff: 1.8, beta: 1.5, dCutoff: 1.0 };
/* Dead reckoning: the hand samples at 15Hz, so the age term alone spans up to
 * 66ms — that is what turns the detector's stair-step into a glide. */
const VEL_CUTOFF_HZ = 5;
const LEAD_BIAS_MS = 24;
const LEAD_MAX_MS = 100;
const MAX_PREDICT_CM = 6;
const MAX_PREDICT_RAD = 0.4;

export type HandLabel = 'Left' | 'Right';
/** Which tracked hand a consumer wants: a specific REAL hand, or whichever was seen last. */
export type HandPick = HandLabel | 'any';

/** The render-rate output: RAW frame (unmirrored), palm-centroid origin. */
export interface SmoothedHandPose {
  /** Filtered + predicted palm-centroid position, world cm. */
  position: Vec3;
  /** Filtered + predicted hand-frame orientation. */
  quaternion: Quat;
  /** Real (label-swapped) hand this pose belongs to. */
  hand: HandLabel;
  /** Palm-local landmark cloud (21 × xyz, cm) from the last detection. */
  local: Float32Array;
  /** Per-guest gear scale: locked palm span over the canonical palm. */
  scale: number;
  /** Within the hold window of a detection. */
  visible: boolean;
  /** performance.now() the last detection returned. */
  detectT: number;
}

interface SlotState {
  pose: HandPose | null;
  seenAt: number; // performance.now() of the last detection that carried this hand
  detectT: number;
  local: Float32Array;
  posXY: OneEuroVec3;
  posZ: OneEuroVec3;
  rot: OneEuroQuat;
  posVel: VelocityVec3;
  rotVel: VelocityQuat;
  tracking: boolean;
  lastStepKey: number;
  lastStepMs: number;
  out: SmoothedHandPose;
}

function makeSlot(hand: HandLabel): SlotState {
  return {
    pose: null,
    seenAt: -Infinity,
    detectT: 0,
    local: new Float32Array(63),
    posXY: new OneEuroVec3(POS_XY),
    posZ: new OneEuroVec3(POS_Z),
    rot: new OneEuroQuat(ROT),
    posVel: new VelocityVec3(VEL_CUTOFF_HZ),
    rotVel: new VelocityQuat(VEL_CUTOFF_HZ),
    tracking: false,
    lastStepKey: NaN,
    lastStepMs: 0,
    out: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      hand,
      local: new Float32Array(63),
      scale: 1,
      visible: false,
      detectT: 0,
    },
  };
}

const _slots: Record<HandLabel, SlotState> = { Left: makeSlot('Left'), Right: makeSlot('Right') };

const _gate = createDetectGate();
let _lastTs = 0;
let _misses = 0;
let _inferMs = 0;

let _scores: Record<string, number> = {};
let _anchor: HandAnchorSample | null = null;
let _hands: HandSample[] = [];
let _handedness: HandLabel[] = [];
let _t = 0;
let _has = false;

/* Palm-span lock: the per-guest hand size, MEDIAN over the first confident
 * frames (the getHeadFitEstimate idiom). Drives depth (world-landmark scale
 * noise leaves that channel entirely) AND the gear scale. One guest at a time
 * stands in front of a booth, so one lock serves both hands. */
const _spanRing = new Float32Array(SPAN_LOCK_SAMPLES);
const _spanScratch = new Float32Array(SPAN_LOCK_SAMPLES);
let _spanCount = 0;
let _lockedSpan: number | null = null;

/** The locked palm span over the canonical palm, clamped; 1 until locked. */
function handScaleFor(lockedSpan: number | null): number {
  if (lockedSpan === null || !(lockedSpan > 1)) return 1;
  return Math.min(HAND_SCALE_MAX, Math.max(HAND_SCALE_MIN, lockedSpan / CANONICAL_PALM_LEN_CM));
}

/** Scratch HandSample array rebuilt per detection (numHands is 1-2, tiny). */
function toSamples(landmarks: { x: number; y: number; z: number }[][], world: { x: number; y: number; z: number }[][]): HandSample[] {
  const out: HandSample[] = [];
  for (let i = 0; i < landmarks.length; i++) {
    out.push({ landmarks: landmarks[i], world: world[i] ?? [] });
  }
  return out;
}

const _vPos: Vec3 = [0, 0, 0];

/** Solve + stash one detected hand into its slot. */
function stashHand(slot: SlotState, hand: HandSample, label: HandLabel, aspect: number, inferEnd: number): void {
  const pose = solveHandPose(hand.landmarks, hand.world, label, aspect, _lockedSpan);
  if (pose === null) return; // degenerate frame: the slot holds its last good pose
  if (_lockedSpan === null && pose.palmSpanCm > 1) {
    _spanRing[_spanCount % SPAN_LOCK_SAMPLES] = pose.palmSpanCm;
    _spanCount++;
    if (_spanCount >= SPAN_LOCK_SAMPLES) {
      _lockedSpan = medianOf(_spanRing, SPAN_LOCK_SAMPLES, _spanScratch);
    }
  }
  // A gap past the hold window is a re-acquisition: seed the velocity afresh
  // rather than reading the jump as speed.
  if (slot.pose === null || inferEnd - slot.detectT > HAND_HOLD_MS) {
    slot.posVel.reset();
    slot.rotVel.reset();
  }
  const dtSec = slot.pose === null ? 0 : (inferEnd - slot.detectT) / 1000; // ms → s
  _vPos[0] = pose.position[0]; _vPos[1] = pose.position[1]; _vPos[2] = pose.position[2];
  slot.posVel.push(_vPos, dtSec);
  slot.rotVel.push(pose.quaternion, dtSec);
  landmarkLocalPositions(hand.landmarks, hand.world, pose, aspect, slot.local);
  slot.pose = pose;
  slot.out.hand = label;
  slot.seenAt = inferEnd;
  slot.detectT = inferEnd;
}

/**
 * Drive hand detection from a rAF loop. No-op until the landmarker is ready
 * and the video has data; self-throttles, so calling every frame is fine.
 */
export function detectHandsNow(video: HTMLVideoElement): void {
  const hl = getHandLandmarker();
  if (!hl || !video || video.readyState < 2) return;
  const now = performance.now();
  if (now - lastFaceInferenceEndMs() < FACE_LOCKOUT_MS) return;
  const interval = _misses >= IDLE_AFTER_MISSES ? IDLE_DETECT_INTERVAL_MS : HAND_DETECT_INTERVAL_MS;
  if (!shouldDetect(_gate, now, video.currentTime, { minIntervalMs: interval })) return;
  markDetected(_gate, now, video.currentTime);
  let results;
  try {
    const ts = Math.max(now, _lastTs + 1);
    _lastTs = ts;
    // The shared downscaled frame (trackingFrame.ts), never the 1080p video.
    results = hl.detectForVideo(inferenceSource(video), ts);
  } catch {
    return;
  }
  const inferEnd = performance.now();
  _inferMs = inferEnd - now;
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
  _scores = handGestureScores(hands, face, aspect);
  _anchor = handAnchor(hands, face, aspect);
  _hands = hands;
  // MediaPipe's handedness label assumes MIRRORED input; we feed raw frames,
  // so the label is swapped here, once, and every consumer sees the REAL hand.
  _handedness = (results?.handednesses ?? []).map((cats) =>
    cats[0]?.categoryName === 'Left' ? 'Right' : 'Left',
  );
  // Slots keyed by the REAL hand. MediaPipe occasionally labels both hands the
  // same; the second such hand takes the other slot rather than overwriting.
  let usedLeft = false;
  let usedRight = false;
  for (let i = 0; i < hands.length && i < 2; i++) {
    let label: HandLabel = _handedness[i] ?? 'Right';
    if (label === 'Left' && usedLeft) label = 'Right';
    else if (label === 'Right' && usedRight) label = 'Left';
    if (label === 'Left') usedLeft = true; else usedRight = true;
    stashHand(_slots[label], hands[i], label, aspect, inferEnd);
  }
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
  handedness: readonly HandLabel[];
  t: number;
} | null {
  return _has ? { scores: _scores, anchor: _anchor, hands: _hands, handedness: _handedness, t: _t } : null;
}

const _pPos: Vec3 = [0, 0, 0];
const _pQuat: Quat = [0, 0, 0, 1];
const _fXY: Vec3 = [0, 0, 0];
const _fZ: Vec3 = [0, 0, 0];

/** The slot a `HandPick` resolves to right now, or null when nothing is held. */
function pickSlot(which: HandPick, now: number): SlotState | null {
  if (which !== 'any') {
    const s = _slots[which];
    return s.pose !== null && now - s.seenAt < HAND_HOLD_MS ? s : null;
  }
  const l = _slots.Left;
  const r = _slots.Right;
  const lOk = l.pose !== null && now - l.seenAt < HAND_HOLD_MS;
  const rOk = r.pose !== null && now - r.seenAt < HAND_HOLD_MS;
  if (lOk && rOk) return l.seenAt >= r.seenAt ? l : r;
  return lOk ? l : rOk ? r : null;
}

/**
 * The smoothed, predicted pose of the picked hand for THIS render frame, or
 * null while no such hand is held. Idempotent per `frameKey` (R3F's
 * `state.clock.elapsedTime`, identical for every useFrame callback of one
 * tick): N rigs + the occluder step the filters exactly once per frame.
 *
 * RAW frame: a mirrored surface negates position.x, conjugates the quaternion
 * by diag(−1,1,1) and negates the local cloud's x — the same reflection
 * faceRig applies, done by the consumer so this module never needs to know
 * which camera it is looking through.
 */
export function stepHandPose(which: HandPick, frameKey: number, now: number): SmoothedHandPose | null {
  const s = pickSlot(which, now);
  if (s === null) {
    // Any slot that dropped out of the hold window resets its filters, so the
    // next acquisition snaps in cleanly instead of gliding from a stale pose.
    for (const slot of [_slots.Left, _slots.Right]) {
      if (slot.tracking && now - slot.seenAt >= HAND_HOLD_MS) {
        slot.tracking = false;
        slot.out.visible = false;
      }
    }
    return null;
  }
  const pose = s.pose as HandPose;
  if (s.lastStepKey !== frameKey) {
    s.lastStepKey = frameKey;
    const lead = predictionLeadSec(now - s.detectT, LEAD_BIAS_MS, LEAD_MAX_MS);
    _vPos[0] = pose.position[0]; _vPos[1] = pose.position[1]; _vPos[2] = pose.position[2];
    s.posVel.predict(_vPos, lead, MAX_PREDICT_CM, _pPos);
    s.rotVel.predict(pose.quaternion, lead, MAX_PREDICT_RAD, _pQuat);
    // Frame-rate-independent step, clamped like faceRig; a re-acquisition
    // (tracking=false) snaps via dt=0 instead of gliding across the frame.
    const dtSec = s.tracking ? Math.min(Math.max(now - s.lastStepMs, 1), 100) / 1000 : 0;
    if (!s.tracking) {
      s.posXY.reset();
      s.posZ.reset();
      s.rot.reset();
    }
    _fXY[0] = _pPos[0]; _fXY[1] = _pPos[1]; _fXY[2] = 0;
    _fZ[0] = _pPos[2]; _fZ[1] = 0; _fZ[2] = 0;
    s.posXY.filter(_fXY, dtSec, _fXY);
    s.posZ.filter(_fZ, dtSec, _fZ);
    s.rot.filter(_pQuat, dtSec, s.out.quaternion);
    s.out.position[0] = _fXY[0];
    s.out.position[1] = _fXY[1];
    s.out.position[2] = _fZ[0];
    s.out.local.set(s.local);
    s.out.scale = handScaleFor(_lockedSpan);
    s.out.detectT = s.detectT;
    s.out.visible = true;
    s.lastStepMs = now;
    s.tracking = true;
  }
  return s.out;
}

/** Live diagnostics for the studio readout and the headless harness. */
export function handTrackingStats(): { inferMs: number; hands: number; lockedSpanCm: number | null; scale: number } {
  return { inferMs: _inferMs, hands: _hands.length, lockedSpanCm: _lockedSpan, scale: handScaleFor(_lockedSpan) };
}

/** Scene switch / booth unmount — forget everything (next scene must not see
 *  a stale fist from the previous guest, nor the previous guest's hand size). */
export function resetHandRig(): void {
  _scores = {};
  _anchor = null;
  _hands = [];
  _handedness = [];
  _has = false;
  _misses = 0;
  _gate.lastDetectMs = -Infinity;
  _gate.lastVideoTime = -1;
  _spanCount = 0;
  _lockedSpan = null;
  for (const label of ['Left', 'Right'] as const) _slots[label] = makeSlot(label);
}
