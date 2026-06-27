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
import { HeadAnchor } from '../types';
import { getFaceLandmarker } from './faceTracking';

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

interface SmoothState {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
  init: boolean;
}

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
  if (!fl || !video || video.readyState < 2) return false;

  const now = performance.now();
  detectIfDue(fl, video, now);

  // Never seen a face, or lost it for longer than the hold window → hide + reset
  // so the next acquisition snaps in cleanly rather than gliding from a stale pose.
  if (!_gHas || now - _gSeen > HOLD_MS) {
    const stale = group.userData._smooth as SmoothState | undefined;
    if (stale) stale.init = false;
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
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
    init: false,
  };
  group.userData._smooth = s;

  if (!s.init) {
    s.pos.copy(_tPos);
    s.quat.copy(_tQuat);
    s.scale.copy(_tScale);
    s.init = true;
  } else {
    // Smooth toward the target every render frame (even between detections) for
    // fluid, jitter-free motion.
    s.pos.lerp(_tPos, 0.45);
    s.quat.slerp(_tQuat, 0.5);
    s.scale.lerp(_tScale, 0.4);
  }

  group.position.copy(s.pos);
  group.quaternion.copy(s.quat);
  group.scale.copy(s.scale);
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
    scale: parseFloat(((_scale.x + _scale.y + _scale.z) / 3).toFixed(4)),
  };
}
