/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 8th Wall face sample -> the MediaPipe pose convention (see types.ts FaceSample).
 * PURE: no DOM, no three.js, no allocation on the hot paths that take an `out`.
 *
 * Everything below was MEASURED, not assumed (calibration spike: MediaPipe
 * FaceLandmarker and 8th Wall FaceController on the SAME video frames, 11 clips,
 * 7 different faces, roll/pan/zoom synthetic motion):
 *
 *  1. 8th Wall's model: world = p + R·(scale·v) for every face-local vertex v,
 *     projected by `intrinsics` (column-major GL projection, camera at the origin
 *     looking down −Z, +Y up, +X image-right when mirroredDisplay=false). This
 *     reproduces 8th Wall's own `uvsInCameraFrame` to 0.71 px (a constant
 *     half-pixel convention), so the model is exact.
 *  2. Its first 468 vertices ARE MediaPipe's landmark indices: mean 1.60 px from
 *     MediaPipe's landmarks on a neutral face vs 30.4 px for an index+1 control.
 *  3. The face-local frame is NOT MediaPipe's canonical frame: it is rotated
 *     ~180° about Y (the nose points local −Z), pitched ~3.9°, offset, and in
 *     different units. The fixed similarity L below maps canonical-model
 *     centimetres (src/assets/ar/canonical_face_model.obj) into 8th Wall
 *     face-local units (Umeyama fit over 11 clips x 80 frames x 468 vertices,
 *     mean residual 0.55 cm — that residual is face SHAPE, not pose).
 *  4. MediaPipe's matrix is exactly rigid (scale 1.0000 on every frame: face
 *     size is expressed as depth). 8th Wall's transform.scale is a constant
 *     0.139. So the output here is rigid too, and the unit conversion is
 *     chosen so the canonical head keeps canonical size: 1 cm = scale·L_SCALE
 *     8th Wall world units. With that, 8th Wall's depth agrees with MediaPipe's
 *     to −0.8 % on the neutral clips (per-face spread ≈ ±5 %).
 *  5. FOV. 8th Wall reports its own intrinsics (64.57° vertical on desktop
 *     Chromium; device-specific on phones), ours is 63° over the FULL frame.
 *     A projection is invariant to scaling a point's camera-space position, so
 *     the head CENTRE is reprojected exactly: keep its NDC under 8th Wall's
 *     camera, scale its depth by fy63/fy8 (keeps apparent size), solve x/y under
 *     our camera. Rotation is kept. Residual = the perspective difference across
 *     the head's own depth (sub-pixel at selfie distance; see xr8Pose.test.ts).
 *
 * The caller must give 8th Wall a canvas with the SAME aspect as the video, so
 * its intrinsics describe the full uncropped frame (xr8Engine does).
 */
import type { FaceKeypoints } from './types';

/** L rotation (canonical -> 8th Wall face-local), quaternion x,y,z,w. */
export const XR8_L_QUAT: readonly [number, number, number, number] = [
  0.0006696049726437296, 0.9994244321514987, -0.03374262853382442, -0.0034338123803126066,
];
/** L scale: 8th Wall face-local units per canonical centimetre. */
export const XR8_L_SCALE = 0.07501818291227066;
/** L translation: the canonical origin, in 8th Wall face-local units. */
export const XR8_L_T: readonly [number, number, number] = [
  0.00572846634283602, -0.17442763207944456, -0.19067841342337283,
];
/**
 * 8th Wall's vertex 10 sits higher on the hairline than MediaPipe's landmark 10:
 * measured as a fraction of the vertex10->vertex152 span, mean 0.0839 over 10
 * clips (range 0.061-0.099). Without it the temple gesture's face height reads
 * 9-12 % taller than MediaPipe's.
 */
export const XR8_FOREHEAD_ALPHA = 0.0839;

/** Our camera: 63° vertical fov over the full video frame (faceRig RIG_CAMERA). */
export const RIG_VERTICAL_FOV_DEG = 63;
const F63 = 1 / Math.tan((RIG_VERTICAL_FOV_DEG / 2) * (Math.PI / 180));

export interface Xr8Vec3 { x: number; y: number; z: number }
export interface Xr8Quat { x: number; y: number; z: number; w: number }
export interface Xr8Transform { position: Xr8Vec3; rotation: Xr8Quat; scale: number }

const fin = (v: number): boolean => typeof v === 'number' && Number.isFinite(v);

/** q = a ⊗ b written into out (x,y,z,w). */
function quatMul(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
  out: number[],
): void {
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

const _q = [0, 0, 0, 1];

/**
 * Column-major rotation matrix of a unit quaternion into m[0..10] (3x3 block of
 * a 4x4). Normalizes defensively.
 */
function writeRotation(x: number, y: number, z: number, w: number, m: Float32Array | number[]): boolean {
  const n = Math.hypot(x, y, z, w);
  if (!(n > 1e-9)) return false;
  x /= n; y /= n; z /= n; w /= n;
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w); m[2] = 2 * (x * z - y * w); m[3] = 0;
  m[4] = 2 * (x * y - z * w); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + x * w); m[7] = 0;
  m[8] = 2 * (x * z + y * w); m[9] = 2 * (y * z - x * w); m[10] = 1 - 2 * (x * x + y * y); m[11] = 0;
  return true;
}

/**
 * The 8th Wall transform as a MediaPipe-convention facialTransformationMatrix:
 * column-major 4x4, centimetres, rigid, +X subject's left, +Y up, +Z toward the
 * camera, origin at the canonical face centre, for a 63° vertical-fov camera
 * over the full `videoWidth`x`videoHeight` frame. Raw and UNMIRRORED.
 *
 * Returns null (and leaves `out` partially written) for any non-finite input,
 * a non-positive scale or a face at/behind the camera plane.
 */
export function xr8ToFaceMatrix(
  t: Xr8Transform,
  intrinsics: ArrayLike<number>,
  videoWidth: number,
  videoHeight: number,
  out: Float32Array | number[] = new Float32Array(16),
): Float32Array | number[] | null {
  const p = t.position;
  const r = t.rotation;
  const s = t.scale;
  if (!fin(p.x) || !fin(p.y) || !fin(p.z) || !fin(r.x) || !fin(r.y) || !fin(r.z) || !fin(r.w)) return null;
  if (!fin(s) || s <= 0 || intrinsics.length < 16) return null;
  if (!fin(videoWidth) || !fin(videoHeight) || videoWidth <= 0 || videoHeight <= 0) return null;

  // R_ours = R8 · R_L, written into the rotation block.
  quatMul(r.x, r.y, r.z, r.w, XR8_L_QUAT[0], XR8_L_QUAT[1], XR8_L_QUAT[2], XR8_L_QUAT[3], _q);
  if (!writeRotation(_q[0], _q[1], _q[2], _q[3], out)) return null;

  // Canonical origin in camera space, in canonical cm:
  //   t_cm = p8 / (s8·L_S) + R8·(L_T / L_S)
  // R8·L_T via the R8 matrix (computed into the translation slots as scratch).
  const k = 1 / XR8_L_SCALE;
  const lx = XR8_L_T[0] * k, ly = XR8_L_T[1] * k, lz = XR8_L_T[2] * k;
  // Rotate (lx,ly,lz) by the unit quaternion r: v' = v + 2w(q×v) + 2q×(q×v).
  const n = Math.hypot(r.x, r.y, r.z, r.w);
  const qx = r.x / n, qy = r.y / n, qz = r.z / n, qw = r.w / n;
  const cx = qy * lz - qz * ly, cy = qz * lx - qx * lz, cz = qx * ly - qy * lx;
  const rx = lx + 2 * (qw * cx + qy * cz - qz * cy);
  const ry = ly + 2 * (qw * cy + qz * cx - qx * cz);
  const rz = lz + 2 * (qw * cz + qx * cy - qy * cx);
  const u = 1 / (s * XR8_L_SCALE);
  const x = p.x * u + rx;
  const y = p.y * u + ry;
  const z = p.z * u + rz;
  if (!(z < 0)) return null;

  // FOV reprojection of the centre (exact for this point).
  const K = intrinsics;
  const w = K[3] * x + K[7] * y + K[11] * z + K[15];
  const fy8 = K[5];
  if (!fin(w) || Math.abs(w) < 1e-9 || !fin(fy8) || fy8 <= 0) return null;
  const ndcX = (K[0] * x + K[4] * y + K[8] * z + K[12]) / w;
  const ndcY = (K[1] * x + K[5] * y + K[9] * z + K[13]) / w;
  const z2 = z * (F63 / fy8);
  const fx63 = (F63 * videoHeight) / videoWidth;
  out[12] = (ndcX * -z2) / fx63;
  out[13] = (ndcY * -z2) / F63;
  out[14] = z2;
  out[15] = 1;
  for (let i = 12; i < 15; i++) if (!fin(out[i])) return null;
  return out;
}

export interface Xr8Uv { u: number; v: number }

/**
 * The temple-gesture keypoints (same vertices as faceRig's MediaPipe stash:
 * forehead 10, chin 152, ear midpoints 127/234 and 356/454), normalized to the
 * FULL video frame, x right / y down, raw and UNMIRRORED. 8th Wall's
 * `uvsInCameraFrame` are already in exactly that space when its canvas matches
 * the video (measured: within ~1-2 px of MediaPipe's landmarks), except the
 * forehead, corrected by XR8_FOREHEAD_ALPHA. Null when the mesh is too short or
 * any value is non-finite.
 */
export function xr8Keypoints(uvs: ArrayLike<Xr8Uv>): FaceKeypoints | null {
  if (uvs.length < 455) return null;
  const f = uvs[10], c = uvs[152], a = uvs[127], b = uvs[234], d = uvs[356], e = uvs[454];
  for (const q of [f, c, a, b, d, e]) if (!q || !fin(q.u) || !fin(q.v)) return null;
  return {
    forehead: { x: f.u + XR8_FOREHEAD_ALPHA * (c.u - f.u), y: f.v + XR8_FOREHEAD_ALPHA * (c.v - f.v) },
    chin: { x: c.u, y: c.v },
    leftEar: { x: (a.u + b.u) / 2, y: (a.v + b.v) / 2 },
    rightEar: { x: (d.u + e.u) / 2, y: (d.v + e.v) / 2 },
  };
}

/**
 * Face-local 8th Wall vertices -> the contract's head frame in canonical cm
 * (the inverse of L), written into `out` (length >= count*3). A mesh with these
 * positions parented to a group carrying xr8ToFaceMatrix lands on the face
 * (same rigid frame; only the fov residual of xr8ToFaceMatrix applies).
 * Writes min(vertices.length, out.length/3) vertices; returns that count.
 */
export function xr8LocalToHeadCm(vertices: ArrayLike<Xr8Vec3>, out: Float32Array): number {
  // Inverse rotation = conjugate of L.
  const qx = -XR8_L_QUAT[0], qy = -XR8_L_QUAT[1], qz = -XR8_L_QUAT[2], qw = XR8_L_QUAT[3];
  const k = 1 / XR8_L_SCALE;
  const count = Math.min(vertices.length, Math.floor(out.length / 3));
  for (let i = 0; i < count; i++) {
    const v = vertices[i];
    const lx = (v.x - XR8_L_T[0]) * k, ly = (v.y - XR8_L_T[1]) * k, lz = (v.z - XR8_L_T[2]) * k;
    const cx = qy * lz - qz * ly, cy = qz * lx - qx * lz, cz = qx * ly - qy * lx;
    out[i * 3] = lx + 2 * (qw * cx + qy * cz - qz * cy);
    out[i * 3 + 1] = ly + 2 * (qw * cy + qz * cx - qx * cz);
    out[i * 3 + 2] = lz + 2 * (qw * cz + qx * cy - qy * cx);
  }
  return count;
}
