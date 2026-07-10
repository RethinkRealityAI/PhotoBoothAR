/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Named head attachment points + the shared head-pose math used by BOTH the
 * booth and the 3D studio editor, so "what you place is what guests see".
 *
 * Tracking engine: MediaPipe FaceLandmarker `facialTransformationMatrixes`
 * (full 4x4 head pose). The matrix is METRIC (centimetres), right-handed,
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
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { HeadAnchor } from '../types';
import { getFaceLandmarker } from './faceTracking';
import { OneEuroVec3, OneEuroQuat, type OneEuroConfig, type Vec3, type Quat } from './smoothing';

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

/** Monotonic timestamp guard — MediaPipe requires strictly increasing ts. */
let _lastTs = 0;

/**
 * Detection is shared across every rig and throttled to ~camera rate. R3F can
 * call useFrame at 60-120fps, but the camera only yields ~30 new frames/sec;
 * running the landmarker on every render wastes GPU and (worse) returns more
 * empty results, which used to blink the asset. We detect on an interval and
 * cache the latest RAW pose so every rig in the frame reuses one detection.
 */
const DETECT_INTERVAL_MS = 33;   // ~30 detections/sec
/** Keep showing the last good pose through brief detection misses (fast motion,
 *  a blink, a hand passing by) instead of hard-hiding it every dropped frame. */
const HOLD_MS = 500;

const _gPos = new THREE.Vector3();
const _gQuat = new THREE.Quaternion();
const _gScale = new THREE.Vector3(1, 1, 1);
let _gSeen = 0;          // performance.now() of the last successful detection
let _gHas = false;       // a face has been detected at least once
let _lastDetectTs = 0;   // throttle clock for detectForVideo

/**
 * Latest face blendshape scores (categoryName → score) + timestamp, consumed by
 * the face-triggered-effects engine (src/lib/studio/triggers.ts). Written on
 * DETECTION frames only (~30/s); rebuilt fresh (even to {} when no face) so a
 * lost face can't leave a stale high score latched. `null` until first detect.
 */
let _blendScores: Record<string, number> = {};
let _blendT = 0;
let _hasBlend = false;

function stashBlendshapes(results: FaceLandmarkerResult | undefined, now: number): void {
  const cats = results?.faceBlendshapes?.[0]?.categories;
  const next: Record<string, number> = {};
  if (cats) for (const c of cats) if (c.categoryName) next[c.categoryName] = c.score;
  _blendScores = next;
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

/**
 * Drive the shared, throttled detection from a surface with NO FaceRig mounted
 * (e.g. the booth trigger loop for a scene that has triggers but no 3D piece).
 * When a FaceRig IS present its useFrame already runs this path via
 * updateHeadPose; the DETECT_INTERVAL_MS throttle + monotonic-ts guard are
 * module-level, so calling from both places still detects at most once per
 * interval. No-op until the landmarker is ready and the video has data.
 */
export function detectFaceNow(video: HTMLVideoElement): void {
  const fl = getFaceLandmarker();
  if (!fl || !video || video.readyState < 2) return;
  detectIfDue(fl, video, performance.now());
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
}

/* Scratch tuples shared across calls (one rig filters at a time). */
const _fpIn: Vec3 = [0, 0, 0];
const _fpOut: Vec3 = [0, 0, 0];
const _fqIn: Quat = [0, 0, 0, 1];
const _fqOut: Quat = [0, 0, 0, 1];
const _fsIn: Vec3 = [1, 1, 1];
const _fsOut: Vec3 = [1, 1, 1];

/** Run the landmarker at most once per DETECT_INTERVAL_MS; cache the raw pose. */
function detectIfDue(fl: ReturnType<typeof getFaceLandmarker>, video: HTMLVideoElement, now: number) {
  if (!fl) return;
  if (now - _lastDetectTs < DETECT_INTERVAL_MS) return;
  _lastDetectTs = now;
  let results;
  try {
    const ts = Math.max(now, _lastTs + 1);
    _lastTs = ts;
    results = fl.detectForVideo(video, ts);
  } catch {
    return;
  }
  // Refresh the trigger-engine blendshape stash on every detection frame (even
  // an empty/no-face result, so signals decay). Additive: pose consumers below
  // are untouched, so legacy events stay byte-identical.
  stashBlendshapes(results, now);
  const mats = results?.facialTransformationMatrixes;
  if (!mats || mats.length === 0) return;
  _mat.fromArray(mats[0].data);
  _mat.decompose(_gPos, _gQuat, _gScale); // raw, un-mirrored
  _gSeen = now;
  _gHas = true;
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
  const fl = getFaceLandmarker();
  const now = performance.now();

  // Only run detection on a ready frame, but DON'T hard-hide when the frame is
  // briefly unavailable (e.g. the video stalls for a moment on resume) — the
  // hold window below decides visibility so the asset doesn't blink.
  if (fl && video && video.readyState >= 2) {
    detectIfDue(fl, video, now);
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
  };
  group.userData._smooth = s;

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
    scale: parseFloat(uniform.toFixed(4)),
  };
}
