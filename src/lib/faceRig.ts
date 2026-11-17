/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Named head attachment points + the shared head-pose math used by BOTH the
 * booth and the 3D studio editor, so "what you place is what guests see".
 *
 * Tracking engine: whichever FaceEngine src/lib/faceEngine runs (MediaPipe,
 * 8th Wall, or both) — every engine hands over its pose in MediaPipe's
 * `facialTransformationMatrixes` convention (full 4x4 head pose), so nothing
 * below knows which one produced it. The matrix is METRIC (centimetres), right-handed,
 * +X = subject's left, +Y = up, +Z = toward the camera (nose points +Z), with
 * the origin at the face centre (behind the nose). The virtual camera sits at
 * the ORIGIN looking down −Z with a 63° vertical FOV — so we attach assets in
 * real centimetres and they land on the real face.
 *
 * Anchors below are therefore in CENTIMETRES, calibrated against MediaPipe's
 * canonical face model (top of head y≈+8.3, ears x≈±7.7, nose tip z≈+7.6,
 * chin y≈−9.4). The studio's live preview is the final calibration surface.
 */
import * as THREE from 'three';
import { HeadAnchor } from '../types';
import { OneEuroVec3, OneEuroQuat, type OneEuroConfig, type Vec3, type Quat } from './smoothing';
import { faceInferenceMs, isFrameLockActive, isLegacyFaceSession, pollFaceEngine } from './faceEngine';
import type { FaceKeypoints, FaceSample } from './faceEngine/types';

export interface AnchorPreset {
  id: HeadAnchor;
  label: string;
  /** starting local offset in head space [x,y,z], in CENTIMETRES */
  offset: [number, number, number];
  hint: string;
}

export const ANCHOR_PRESETS: AnchorPreset[] = [
  { id: 'crown',     label: 'Crown',      offset: [0, 8.3, 4.0],    hint: 'Top of head — crowns, halos, top hats' },
  { id: 'forehead',  label: 'Forehead',   offset: [0, 5.5, 5.4],    hint: 'Tiaras, headbands, third-eye gems' },
  { id: 'noseBridge',label: 'Nose Bridge',offset: [0, 2.5, 5.8],    hint: 'Glasses, masquerade masks' },
  { id: 'noseTip',   label: 'Nose Tip',   offset: [0, -0.5, 7.6],   hint: 'Noses, beaks' },
  { id: 'leftEye',   label: 'Left Eye',   offset: [4.3, 3.4, 4.0],  hint: 'Monocles, eye sparkles' },
  { id: 'rightEye',  label: 'Right Eye',  offset: [-4.3, 3.4, 4.0], hint: 'Monocles, eye sparkles' },
  { id: 'leftEar',   label: 'Left Ear',   offset: [7.7, 1.5, -1.5], hint: 'Earrings' },
  { id: 'rightEar',  label: 'Right Ear',  offset: [-7.7, 1.5, -1.5],hint: 'Earrings' },
  { id: 'leftCheek', label: 'Left Cheek', offset: [3.6, -2.0, 5.0], hint: 'Cheek gems, blush sparkle' },
  { id: 'rightCheek',label: 'Right Cheek',offset: [-3.6, -2.0, 5.0],hint: 'Cheek gems, blush sparkle' },
  { id: 'mouth',     label: 'Mouth',      offset: [0, -4.0, 5.8],   hint: 'Moustaches, lips' },
  { id: 'chin',      label: 'Chin',       offset: [0, -7.5, 5.0],   hint: 'Beards, chin straps' },
];

export const ANCHOR_MAP: Record<HeadAnchor, AnchorPreset> = Object.fromEntries(
  ANCHOR_PRESETS.map((a) => [a.id, a]),
) as Record<HeadAnchor, AnchorPreset>;

/** Camera config shared by booth + live editor: at the origin, looking −Z,
 *  63° vertical FOV to match MediaPipe's metric face-transform projection. */
export const RIG_CAMERA = {
  position: [0, 0, 0] as [number, number, number],
  fov: 63,
  near: 0.1,
  far: 2000,
};

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _euler = new THREE.Euler();
const _tPos = new THREE.Vector3();
const _tQuat = new THREE.Quaternion();
const _tScale = new THREE.Vector3();

/**
 * Detection is shared across every rig and throttled to ~camera rate. R3F can
 * call useFrame at 60-120fps, but the camera only yields ~30 new frames/sec;
 * running the landmarker on every render wastes GPU and (worse) returns more
 * empty results, which used to blink the asset. The active engine detects on
 * an interval (MediaPipe: its 33ms DetectGate + monotonic-ts guard, now in
 * faceEngine/mediapipeEngine.ts) and we cache the latest RAW pose so every rig
 * in the frame reuses one detection.
 */
/** Keep showing the last good pose through brief detection misses (fast motion,
 *  a blink, a hand passing by) instead of hard-hiding it every dropped frame. */
const HOLD_MS = 500;

const _gPos = new THREE.Vector3();
const _gQuat = new THREE.Quaternion();
const _gScale = new THREE.Vector3(1, 1, 1);
let _gSeen = 0;          // performance.now() of the last successful detection
let _gHas = false;       // a face has been detected at least once
/** Bumped by resetFaceRig so every rig's own (legacy) filter state restarts too. */
let _rigGen = 0;
/** srcObject id of the stream the cached pose came from (undefined = none seen yet). */
let _streamId: string | null | undefined;

/**
 * Latest face blendshape scores (categoryName → score) + timestamp, consumed by
 * the face-triggered-effects engine (src/lib/studio/triggers.ts). Written on
 * DETECTION frames only (~30/s); rebuilt fresh (even to {} when no face) so a
 * lost face can't leave a stale high score latched. `null` until first detect.
 */
let _blendScores: Record<string, number> = {};
let _blendT = 0;
let _hasBlend = false;

/** `null` = this sample carries no expression output → keep the previous stash
 *  (8th Wall without blendshapes); `{}` = no face → clear it so nothing latches. */
function stashBlendshapes(scores: Record<string, number> | null, now: number): void {
  if (scores === null) return;
  _blendScores = scores;
  _blendT = now;
  _hasBlend = true;
}

/**
 * Latest face blendshape scores for the trigger engine, or null before the very
 * first detection. `t` is the performance.now() of that detection, so a caller
 * can step its engine once per NEW detection (t change) rather than per rAF.
 * Zero allocation on read (returns references to the module's current map).
 */
export function getLatestBlendshapes(): { scores: Record<string, number>; t: number } | null {
  return _hasBlend ? { scores: _blendScores, t: _blendT } : null;
}

/* — Face keypoints for the hand-to-temple gesture ---------------------------
 * The raw 478 landmarks stay unexported on purpose; the temple gesture needs
 * exactly six of them (forehead 10, chin 152, the ear-pair midpoints 127/234
 * and 356/454 — the anchors the PlayCanvas optic-blast reference uses), so
 * only those are stashed, on detection frames, normalized image space, raw
 * and UNMIRRORED like everything else in this module.
 */
type FaceKeypointStash = FaceKeypoints;
let _faceKeypoints: FaceKeypointStash | null = null;

/** null = no face → the temple gesture must decay, not latch. */
function stashFaceKeypoints(kp: FaceKeypoints | null): void {
  _faceKeypoints = kp;
}

/** Latest temple-gesture keypoints, or null while no face is tracked. */
export function getLatestFaceKeypoints(): FaceKeypointStash | null {
  return _faceKeypoints;
}

/** performance.now() of the last face inference. handRig reads this to avoid
 *  running two blocking CPU landmarkers on the same rAF tick. In hybrid it is
 *  the later of the two engines' last inference. */
export function lastFaceDetectMs(): number {
  return faceInferenceMs();
}

/**
 * Debug tap for the tracking readout (?trackdebug / ?faceEngine=): called with
 * every NEW pose-engine sample, RAW (pre-One-Euro). null = off (the default),
 * which costs one null check per detection.
 */
type RawPoseTap = (sample: FaceSample, pos: THREE.Vector3 | null, quat: THREE.Quaternion | null) => void;
let _rawPoseTap: RawPoseTap | null = null;
export function setRawPoseTap(tap: RawPoseTap | null): void {
  _rawPoseTap = tap;
}

/** Tracked head distance from the camera in cm (positive), or null before the
 *  first face. The monocular hand-depth estimate clamps around this. */
export function getHeadDepthCm(): number | null {
  if (!_gHas) return null;
  const d = -_gPos.z;
  return Number.isFinite(d) && d > 0 ? d : null;
}

/* ── Live head-fit estimator ───────────────────────────────────────────────
 * MediaPipe's facialTransformationMatrix carries a SCALE component — the fit of
 * the canonical head to THIS face. On every DETECTION frame we push that uniform
 * scale magnitude ((sx+sy+sz)/3) into a small ring and getHeadFitEstimate()
 * returns the MEDIAN over the window (~1.5s of detections).
 *
 * RATIONALE (do not overclaim): the matrix scale largely NORMALIZES face size
 * already — the occluder sits INSIDE the group we scale by it — so mapping an
 * absolute factor straight onto headScale is only a heuristic STARTING POINT,
 * not ground truth. The defensible signal is the RATIO of a live factor to the
 * host's calibration baseline; the booth's per-guest transfer uses exactly that.
 * Zero per-frame allocation beyond the ring write; the read reuses a scratch buf.
 */
const FIT_RING_SIZE = 45;   // ~1.5s at ~30 detections/sec
const FIT_MIN_SAMPLES = 10; // null before the window is meaningfully filled
const _fitRing = new Float32Array(FIT_RING_SIZE);
const _fitScratch = new Float32Array(FIT_RING_SIZE); // reused by getHeadFitEstimate (no per-read alloc)
let _fitCount = 0;  // valid samples in the ring (caps at FIT_RING_SIZE)
let _fitWrite = 0;  // next ring write index

/** Push one head-fit sample: the detected uniform scale magnitude. Rejects
 *  non-finite / non-positive values so a bad decompose can't poison the median. */
function pushFitSample(sx: number, sy: number, sz: number): void {
  const mag = (sx + sy + sz) / 3;
  if (!Number.isFinite(mag) || mag <= 0) return;
  _fitRing[_fitWrite] = mag;
  _fitWrite = (_fitWrite + 1) % FIT_RING_SIZE;
  if (_fitCount < FIT_RING_SIZE) _fitCount++;
}

/**
 * Median of the first `n` entries of `src`, sorted into `scratch` in place so
 * the caller allocates nothing. `n` is clamped to both buffers' lengths; n<=0
 * returns 0. Even counts average the two middle values. Pure (exported for tests).
 */
export function medianOf(src: ArrayLike<number>, n: number, scratch: Float32Array): number {
  const len = Math.min(n, src.length, scratch.length);
  if (len <= 0) return 0;
  for (let i = 0; i < len; i++) scratch[i] = src[i];
  // Insertion sort of the first `len` entries — len ≤ 45, in place, zero alloc.
  for (let i = 1; i < len; i++) {
    const v = scratch[i];
    let j = i - 1;
    while (j >= 0 && scratch[j] > v) { scratch[j + 1] = scratch[j]; j--; }
    scratch[j + 1] = v;
  }
  const mid = len >> 1;
  return len % 2 ? scratch[mid] : (scratch[mid - 1] + scratch[mid]) / 2;
}

export interface HeadFitEstimate {
  /** Median detected uniform head-fit factor over the window. */
  factor: number;
  /** Samples backing the estimate (≥ FIT_MIN_SAMPLES when non-null). */
  samples: number;
}

/**
 * Live head-fit estimate (median detected uniform scale + sample count), or null
 * until ~10 detection samples have accrued (no face yet / just acquired). See the
 * estimator note above: a heuristic starting point, NOT ground truth. Zero
 * allocation on read (reuses the module scratch buffer).
 */
export function getHeadFitEstimate(): HeadFitEstimate | null {
  if (_fitCount < FIT_MIN_SAMPLES) return null;
  return { factor: medianOf(_fitRing, _fitCount, _fitScratch), samples: _fitCount };
}

/**
 * Drive the shared, throttled detection from a surface with NO FaceRig mounted
 * (e.g. the booth trigger loop for a scene that has triggers but no 3D piece).
 * When a FaceRig IS present its useFrame already runs this path via
 * updateHeadPose; the engine's throttle (MediaPipe: 33ms gate + monotonic-ts
 * guard) is module-level, so calling from both places still detects at most
 * once per interval. No-op until the engine is ready (each engine's poll
 * returns null before then) and the video has data.
 */
export function detectFaceNow(video: HTMLVideoElement): void {
  if (!video || video.readyState < 2) return;
  detectIfDue(video, performance.now());
}

/**
 * One-Euro tuning (see smoothing.ts). Position/scale speeds are in cm/s
 * (MediaPipe's metric head space); rotation speed is rad/s. Low minCutoff
 * keeps a resting face rock-steady; beta raises the cutoff under motion so
 * fast head turns track without trailing.
 */
const POS_FILTER: OneEuroConfig = { minCutoff: 1.15, beta: 0.08, dCutoff: 1.0 };
const ROT_FILTER: OneEuroConfig = { minCutoff: 1.5, beta: 0.6, dCutoff: 1.0 };
const SCALE_FILTER: OneEuroConfig = { minCutoff: 1.0, beta: 0.5, dCutoff: 1.0 };

interface SmoothState {
  pos: OneEuroVec3;
  quat: OneEuroQuat;
  scale: OneEuroVec3;
  lastMs: number; // performance.now() of the previous filter step, ms
  gen: number;    // _rigGen when this state was last valid
}

/* ── Shared head-pose filter (platform) ─────────────────────────────────────
 * The legacy path below filters PER RIG, EVERY RENDER FRAME, against a held
 * target. That re-filters the same sample 2-4x between detections (a 120Hz
 * display measured +21% jitter vs 60Hz, purely from the extra steps), and a
 * piece mounted late starts from the RAW pose while its siblings are still
 * lagging — two props on one head visibly disagree for ~half a second.
 *
 * Platform: ONE filter over the UNMIRRORED pose, stepped only when the engine
 * hands over a NEW sample, with dt = the time between samples. Every rig reads
 * the same output and mirrors it itself. Mirroring commutes with this filter
 * (x-negation is linear and leaves speed unchanged; the quaternion reflection
 * preserves dot products, so slerp commutes), so per-rig mirroring is exact.
 * Legacy keeps its shipped per-rig filter byte-for-byte.
 *
 * FRAME-LOCKED: the image IS the analysed frame, so the raw sample is already
 * registered with it — any smoothing lag now shows as the prop trailing its
 * own frame. The filter is swapped for FRAMELOCK_* (see setFrameLockFilterProfile).
 */
export type FrameLockFilterProfile = 'standard' | 'light' | 'bypass';
const FRAMELOCK_POS_LIGHT: OneEuroConfig = { minCutoff: 3.0, beta: 0.5, dCutoff: 1.0 };
const FRAMELOCK_ROT_LIGHT: OneEuroConfig = { minCutoff: 3.0, beta: 2.0, dCutoff: 1.0 };
let _lockProfile: FrameLockFilterProfile = 'light';
/**
 * Which filter a frame-locked surface uses. Chosen by measurement (see
 * docs/STATE.md); exported so the check harness can A/B all three on one clip.
 */
export function setFrameLockFilterProfile(p: FrameLockFilterProfile): void {
  if (p === _lockProfile) return;
  _lockProfile = p;
  _sf.cfgKey = ''; // rebuild on the next sample
}
export function getFrameLockFilterProfile(): FrameLockFilterProfile {
  return _lockProfile;
}

const _sf = {
  pos: new OneEuroVec3(POS_FILTER),
  quat: new OneEuroQuat(ROT_FILTER),
  scale: new OneEuroVec3(SCALE_FILTER),
  lastT: Number.NaN,
  cfgKey: 'standard',
};
const _sfPos = new THREE.Vector3();
const _sfQuat = new THREE.Quaternion();
const _sfScale = new THREE.Vector3(1, 1, 1);
let _sfHas = false;

/** Step the shared filter with the NEW raw sample in _gPos/_gQuat/_gScale, taken at `t`. */
function stepSharedFilter(t: number, prevSeen: number, hadFace: boolean): void {
  const key = isFrameLockActive() ? `lock:${_lockProfile}` : 'standard';
  if (key !== _sf.cfgKey) {
    _sf.cfgKey = key;
    const lockOn = key !== 'standard';
    const prof = _lockProfile;
    _sf.pos = new OneEuroVec3(lockOn && prof === 'light' ? FRAMELOCK_POS_LIGHT : POS_FILTER);
    _sf.quat = new OneEuroQuat(lockOn && prof === 'light' ? FRAMELOCK_ROT_LIGHT : ROT_FILTER);
    _sf.scale = new OneEuroVec3(SCALE_FILTER);
    _sfHas = false;
  }
  // A face lost for longer than the hold window snaps back in, never glides.
  if (!hadFace || t - prevSeen > HOLD_MS) {
    _sf.pos.reset();
    _sf.quat.reset();
    _sf.scale.reset();
  }
  const bypass = _sf.cfgKey === 'lock:bypass';
  const dtSec = Math.min(Math.max(Number.isFinite(_sf.lastT) ? t - _sf.lastT : 0, 1), 100) / 1000;
  _sf.lastT = t;
  _fpIn[0] = _gPos.x; _fpIn[1] = _gPos.y; _fpIn[2] = _gPos.z;
  _fqIn[0] = _gQuat.x; _fqIn[1] = _gQuat.y; _fqIn[2] = _gQuat.z; _fqIn[3] = _gQuat.w;
  _fsIn[0] = _gScale.x; _fsIn[1] = _gScale.y; _fsIn[2] = _gScale.z;
  if (bypass) {
    _sfPos.copy(_gPos);
    _sfQuat.copy(_gQuat);
  } else {
    _sf.pos.filter(_fpIn, dtSec, _fpOut);
    _sf.quat.filter(_fqIn, dtSec, _fqOut);
    _sfPos.set(_fpOut[0], _fpOut[1], _fpOut[2]);
    _sfQuat.set(_fqOut[0], _fqOut[1], _fqOut[2], _fqOut[3]);
  }
  _sf.scale.filter(_fsIn, dtSec, _fsOut);
  _sfScale.set(_fsOut[0], _fsOut[1], _fsOut[2]);
  _sfHas = true;
}

/**
 * Forget the tracked face: cached pose, every filter, keypoints, blendshapes
 * (to "no face", so triggers decay), and the head-fit window. Called on a
 * camera STREAM change (front↔back flip): the old camera's pose used to stay
 * drawn over the new camera for up to HOLD_MS, mirrored the wrong way.
 */
export function resetFaceRig(): void {
  _gHas = false;
  _gSeen = 0;
  _sfHas = false;
  _sf.pos.reset();
  _sf.quat.reset();
  _sf.scale.reset();
  _sf.lastT = Number.NaN;
  _rigGen++;
  _faceKeypoints = null;
  if (_hasBlend) {
    _blendScores = {};
    _blendT = performance.now();
  }
  _fitCount = 0;
  _fitWrite = 0;
}

function streamIdOf(video: HTMLVideoElement): string | null {
  const so = (video as { srcObject?: unknown }).srcObject as { id?: unknown } | null | undefined;
  return so && typeof so.id === 'string' ? so.id : null;
}

/* Scratch tuples shared across calls (one rig filters at a time). */
const _fpIn: Vec3 = [0, 0, 0];
const _fpOut: Vec3 = [0, 0, 0];
const _fqIn: Quat = [0, 0, 0, 1];
const _fqOut: Quat = [0, 0, 0, 1];
const _fsIn: Vec3 = [1, 1, 1];
const _fsOut: Vec3 = [1, 1, 1];

/** Take the active engine's new samples (if any); cache the raw pose. */
function detectIfDue(video: HTMLVideoElement, now: number) {
  const sid = streamIdOf(video);
  if (sid !== _streamId) {
    if (_streamId !== undefined) resetFaceRig();
    _streamId = sid;
  }
  const p = pollFaceEngine(video, now);
  // Hybrid: expressions come from MediaPipe's low-rate side path; its pose is
  // discarded (8th Wall owns the pose there).
  if (p.expr) stashBlendshapes(p.expr.blendshapes, p.expr.t);
  const s = p.pose;
  if (!s) return;
  // Refresh the trigger-engine blendshape stash on every detection frame (even
  // an empty/no-face result, so signals decay). Additive: pose consumers below
  // are untouched, so legacy events stay byte-identical.
  if (p.poseHasExpr) stashBlendshapes(s.blendshapes, s.t);
  stashFaceKeypoints(s.keypoints);
  if (!s.matrix) {
    _rawPoseTap?.(s, null, null);
    return;
  }
  _mat.fromArray(s.matrix);
  _mat.decompose(_gPos, _gQuat, _gScale); // raw, un-mirrored
  const prevSeen = _gSeen;
  const hadFace = _gHas;
  _gSeen = s.t;
  _gHas = true;
  if (!isLegacyFaceSession()) stepSharedFilter(s.t, prevSeen, hadFace);
  _rawPoseTap?.(s, _gPos, _gQuat);
  // Feed the head-fit estimator on every detection frame (~30/s). Pure
  // bookkeeping — a module ring write with no effect on the pose consumers
  // below, so legacy/booth rendering is byte-identical whether or not any
  // surface reads getHeadFitEstimate().
  pushFitSample(_gScale.x, _gScale.y, _gScale.z);
}

/**
 * Update `group` to the tracked head pose for the current video frame.
 * Returns true when the asset should be visible.
 *
 * `mirror` MUST be true whenever the camera preview is shown mirrored (selfie /
 * front camera). We then reflect the pose so the asset tracks the *mirrored*
 * face: position.x is negated and the rotation's Y/Z components are flipped
 * (equivalent to conjugating the matrix by diag(-1,1,1) — determinant stays +1
 * so child geometry is not turned inside-out).
 *
 * Detection is throttled + shared; the pose is held briefly through misses and
 * smoothed every render frame (lerp position/scale, slerp rotation) so the asset
 * glides with the face instead of flickering.
 */
export function updateHeadPose(
  group: THREE.Object3D,
  video: HTMLVideoElement,
  mirror: boolean,
): boolean {
  const now = performance.now();

  // Only run detection on a ready frame, but DON'T hard-hide when the frame is
  // briefly unavailable (e.g. the video stalls for a moment on resume) — the
  // hold window below decides visibility so the asset doesn't blink. Engine
  // readiness is checked inside each engine's poll (null until ready).
  if (video && video.readyState >= 2) {
    detectIfDue(video, now);
  }

  // Platform: every rig shows the ONE shared filtered pose (stepped per new
  // sample in detectIfDue), mirrored for its own preview.
  if (!isLegacyFaceSession()) {
    if (!_gHas || !_sfHas || now - _gSeen > HOLD_MS) return false;
    group.position.set(mirror ? -_sfPos.x : _sfPos.x, _sfPos.y, _sfPos.z);
    group.quaternion.set(_sfQuat.x, mirror ? -_sfQuat.y : _sfQuat.y, mirror ? -_sfQuat.z : _sfQuat.z, _sfQuat.w);
    group.scale.copy(_sfScale);
    return true;
  }

  // Never seen a face, or lost it for longer than the hold window → hide + reset
  // so the next acquisition snaps in cleanly rather than gliding from a stale pose.
  if (!_gHas || now - _gSeen > HOLD_MS) {
    const stale = group.userData._smooth as SmoothState | undefined;
    if (stale) {
      stale.pos.reset();
      stale.quat.reset();
      stale.scale.reset();
    }
    return false;
  }

  // Target = latest raw pose, mirrored per this rig's preview if needed.
  _tPos.copy(_gPos);
  _tQuat.copy(_gQuat);
  _tScale.copy(_gScale);
  if (mirror) {
    _tPos.x = -_tPos.x;
    _tQuat.y = -_tQuat.y;
    _tQuat.z = -_tQuat.z;
  }

  // Smoothing state lives on the object so multiple rigs don't interfere.
  const s = (group.userData._smooth as SmoothState | undefined) ?? {
    pos: new OneEuroVec3(POS_FILTER),
    quat: new OneEuroQuat(ROT_FILTER),
    scale: new OneEuroVec3(SCALE_FILTER),
    lastMs: 0,
    gen: _rigGen,
  };
  group.userData._smooth = s;
  if (s.gen !== _rigGen) {
    // resetFaceRig() since this rig last filtered: snap, never glide from the old camera.
    s.pos.reset();
    s.quat.reset();
    s.scale.reset();
    s.gen = _rigGen;
  }

  // Frame-rate-independent step: real elapsed time since this rig's last
  // filter pass, clamped to [1ms, 100ms] (coarsened timers can repeat a value;
  // a tab-switch gap should snap, not integrate a huge velocity).
  const dtSec = Math.min(Math.max(now - s.lastMs, 1), 100) / 1000;
  s.lastMs = now;

  // One-Euro filter every render frame (even between detections): steady when
  // the face is still, tight on the face during fast motion.
  _fpIn[0] = _tPos.x; _fpIn[1] = _tPos.y; _fpIn[2] = _tPos.z;
  _fqIn[0] = _tQuat.x; _fqIn[1] = _tQuat.y; _fqIn[2] = _tQuat.z; _fqIn[3] = _tQuat.w;
  _fsIn[0] = _tScale.x; _fsIn[1] = _tScale.y; _fsIn[2] = _tScale.z;
  s.pos.filter(_fpIn, dtSec, _fpOut);
  s.quat.filter(_fqIn, dtSec, _fqOut);
  s.scale.filter(_fsIn, dtSec, _fsOut);

  group.position.set(_fpOut[0], _fpOut[1], _fpOut[2]);
  group.quaternion.set(_fqOut[0], _fqOut[1], _fqOut[2], _fqOut[3]);
  group.scale.set(_fsOut[0], _fsOut[1], _fsOut[2]);
  return true;
}

/**
 * An anchor base scaled by the head-size calibration.
 *
 * headScale sizes the occluder shell (FaceOccluder), but the anchor bases were
 * left at their raw centimetres — so turning the slider UP grew the invisible
 * head without moving the props outward, and the occluder swallowed them. That
 * reaches real guests through the booth, not just the studio.
 *
 * IDENTITY AT headScale = 1, deliberately: DEFAULT_STUDIO_SETTINGS.headScale is
 * 1 and normalizeStudioSettings clamps a missing value to 1, so every legacy /
 * coded event renders byte-identically.
 */
export function scaledAnchorBase(
  offset: readonly [number, number, number],
  headScale: number,
): [number, number, number] {
  if (!Number.isFinite(headScale) || headScale === 1) return [offset[0], offset[1], offset[2]];
  return [offset[0] * headScale, offset[1] * headScale, offset[2] * headScale];
}

/** Build the THREE.Matrix4 for a fine transform relative to an anchor base. */
export function composeAnchorMatrix(
  base: readonly [number, number, number],
  offset: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number },
  scale: number,
  out = new THREE.Matrix4(),
): THREE.Matrix4 {
  _pos.set(base[0] + offset.x, base[1] + offset.y, base[2] + offset.z);
  _euler.set(rotation.x, rotation.y, rotation.z);
  _quat.setFromEuler(_euler);
  _scale.set(scale, scale, scale);
  return out.compose(_pos, _quat, _scale);
}

// Clamp the returned uniform scale to the studio's prop-scale bounds — mirrors
// PROP_SCALE_MIN/MAX in studio/bustFit.ts (MAX 50 so a small ~0.5-unit Meshy
// model can auto-fit to PROP_TARGET_CM=24). drei's scaleLimits only clamp the
// per-gesture DRAG MULTIPLIER and its accumulator RESETS each gizmo mount, so
// an auto-fit base dragged once can compose to base×15 here — clamp at the
// source. (AssetGizmo scaleLimits / PropertiesDock slider still stop at 15 —
// they bound GESTURES, not the auto-fit base.)
const PROP_SCALE_MIN = 0.05;
const PROP_SCALE_MAX = 50;

/** Decompose an anchor-relative local matrix back into offset/rotation/scale. */
export function decomposeAnchorMatrix(
  base: readonly [number, number, number],
  m: THREE.Matrix4,
) {
  m.decompose(_pos, _quat, _scale);
  _euler.setFromQuaternion(_quat);
  // Uniform scale from the gizmo's per-axis scale spheres: a drag moves ONE
  // axis, so take the outlier (the axis that differs from the closest pair).
  // Averaging would dilute every single-axis drag to 1/3 of its motion —
  // stacked with drei's drag damping that read as a dead scale handle.
  const sx = _scale.x;
  const sy = _scale.y;
  const sz = _scale.z;
  const dxy = Math.abs(sx - sy);
  const dxz = Math.abs(sx - sz);
  const dyz = Math.abs(sy - sz);
  const uniform = dxy <= dxz && dxy <= dyz ? sz : dxz <= dyz ? sy : sx;
  const clamped = Math.min(PROP_SCALE_MAX, Math.max(PROP_SCALE_MIN, uniform));
  return {
    offset: {
      x: parseFloat((_pos.x - base[0]).toFixed(4)),
      y: parseFloat((_pos.y - base[1]).toFixed(4)),
      z: parseFloat((_pos.z - base[2]).toFixed(4)),
    },
    rotation: {
      x: parseFloat(_euler.x.toFixed(4)),
      y: parseFloat(_euler.y.toFixed(4)),
      z: parseFloat(_euler.z.toFixed(4)),
    },
    scale: parseFloat(clamped.toFixed(4)),
  };
}
