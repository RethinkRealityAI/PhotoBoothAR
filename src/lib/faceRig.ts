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

/** Monotonic timestamp guard — MediaPipe requires strictly increasing ts. */
let _lastTs = 0;

interface SmoothState {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
  init: boolean;
}

/**
 * Update `group` to the tracked head pose for the current video frame.
 * Returns true when a face is present.
 *
 * `mirror` MUST be true whenever the camera preview is shown mirrored (selfie /
 * front camera). We then reflect the pose so the asset tracks the *mirrored*
 * face: position.x is negated and the rotation's Y/Z components are flipped
 * (equivalent to conjugating the matrix by diag(-1,1,1) — determinant stays +1
 * so child geometry is not turned inside-out).
 *
 * Pose is smoothed (lerp position/scale, slerp rotation) to kill jitter.
 */
export function updateHeadPose(
  group: THREE.Object3D,
  video: HTMLVideoElement,
  mirror: boolean,
): boolean {
  const fl = getFaceLandmarker();
  if (!fl || !video || video.readyState < 2) return false;

  let results;
  try {
    const ts = Math.max(performance.now(), _lastTs + 1);
    _lastTs = ts;
    results = fl.detectForVideo(video, ts);
  } catch {
    return false;
  }

  const mats = results?.facialTransformationMatrixes;
  if (!mats || mats.length === 0) return false;

  _mat.fromArray(mats[0].data);
  _mat.decompose(_pos, _quat, _scale);

  if (mirror) {
    _pos.x = -_pos.x;
    _quat.y = -_quat.y;
    _quat.z = -_quat.z;
  }

  // smoothing state lives on the object so multiple rigs don't interfere
  const s = (group.userData._smooth as SmoothState | undefined) ?? {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
    init: false,
  };
  group.userData._smooth = s;

  if (!s.init) {
    s.pos.copy(_pos);
    s.quat.copy(_quat);
    s.scale.copy(_scale);
    s.init = true;
  } else {
    // frame-rate-independent-ish smoothing; low lag, low jitter at ~30fps
    s.pos.lerp(_pos, 0.45);
    s.quat.slerp(_quat, 0.5);
    s.scale.lerp(_scale, 0.4);
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
