/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Seat hand-worn gear ON the hand — by construction, not by nudging.
 *
 * A glove GLB comes out of a generator in whatever orientation and size it
 * likes. The studio used to ship each one with a hand-tuned
 * `defaultNudgeCm`/`defaultRotationDeg`, and the power gauntlet's never matched
 * the hand model it was placed against: measured on the mesh, the "wrist" those
 * numbers were derived from sat half-way down the forearm cuff, and the glove
 * rendered ~20% small and tilted off the mannequin's fingers.
 *
 * The fix is to ask the asset where ITS hand is (`AssetTemplate.handFrame`:
 * wrist, middle knuckle, palm direction — in GLB space) and compute the one
 * placement that lands that frame on the tracked hand frame the mannequin, the
 * live rig and the occluder all share (+Y wrist → middle knuckle, +Z out of the
 * palm, origin at the wrist landmark, centimetres):
 *
 *   scale  = canonical palm length ÷ the glove's palm length (its knuckle row
 *            lands on the hand's knuckle row, whatever the GLB's units)
 *   rotate = the glove's [right, up, palm] onto the hand's [+X, +Y, +Z],
 *            expressed under the anchor's own rotation
 *   offset = whatever puts the glove's wrist on the wrist landmark
 *
 * The placement is authored in the MODELLED hand's frame, exactly like any
 * other hand piece, so the existing mirror machinery (handedness.ts) carries it
 * to the other hand. Pure — no three.js — so it is tested in node.
 */
import type { AssetHandFrame, Vec3 } from './assetTemplate';
import { anchorFrameRotation, authoredHand, type HandFit, type ModelledHand } from './handedness';
import { HAND_ANCHOR_MAP, type HandAnchorDef } from '../handPose';
import {
  CANONICAL_HAND_LANDMARKS,
  CANONICAL_PALM_LEN_CM,
  handRefAnchorPoint,
  mirrorHandLandmarks,
} from './handRefAnchors';

/** A 3×3 matrix, row-major: m[r][c]. */
export type Mat3 = [Vec3, Vec3, Vec3];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 | null => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 && Number.isFinite(l) ? [v[0] / l, v[1] / l, v[2] / l] : null;
};

export interface HandFrameBasis {
  /** +X of the hand frame in GLB space (up × palm). */
  right: Vec3;
  /** +Y: wrist → middle knuckle. */
  up: Vec3;
  /** +Z: out of the palm, orthogonalised against `up`. */
  palm: Vec3;
  /** |knuckle − wrist| in GLB units. */
  palmLen: number;
}

/** The glove's own orthonormal hand frame, or null when it is degenerate. */
export function handFrameBasis(f: AssetHandFrame): HandFrameBasis | null {
  const d: Vec3 = [f.knuckle[0] - f.wrist[0], f.knuckle[1] - f.wrist[1], f.knuckle[2] - f.wrist[2]];
  const palmLen = Math.hypot(d[0], d[1], d[2]);
  const up = unit(d);
  if (up === null) return null;
  const k = dot(f.palm, up);
  const palm = unit([f.palm[0] - k * up[0], f.palm[1] - k * up[1], f.palm[2] - k * up[2]]);
  if (palm === null) return null;
  const right = unit(cross(up, palm));
  if (right === null) return null;
  return { right, up, palm, palmLen };
}

/** Rotation matrix of an XYZ Euler (radians) — three.js's convention. */
export function matFromEulerXYZ(x: number, y: number, z: number): Mat3 {
  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ];
}

/** XYZ Euler (radians) of a rotation matrix — three.js's setFromRotationMatrix. */
export function eulerXYZFromMat(m: Mat3): Vec3 {
  const m13 = Math.max(-1, Math.min(1, m[0][2]));
  const y = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) {
    return [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])];
  }
  return [Math.atan2(m[2][1], m[1][1]), y, 0];
}

const transpose = (m: Mat3): Mat3 => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
];
const mul = (a: Mat3, b: Mat3): Mat3 => [0, 1, 2].map((r) => [0, 1, 2].map((c) =>
  a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c])) as Mat3;
const apply = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

export interface GearPlacement {
  /** Authored offset from the anchor's mount point, cm (anchorConfig.offset). */
  offset: { x: number; y: number; z: number };
  /** XYZ Euler, RADIANS (anchorConfig.rotation). */
  rotation: { x: number; y: number; z: number };
  /** cm per GLB unit (anchorConfig.scale). */
  scale: number;
}

const r4 = (v: number): number => {
  const n = parseFloat(v.toFixed(4));
  return n === 0 ? 0 : n; // no -0 in stored placements
};

/**
 * The placement that seats `frame` on the hand, for a piece mounted at `def`,
 * authored in the `hand` frame (the asset's modelled hand; the right hand for
 * an agnostic asset). `palmLenCm` is the hand it is fitted to — the canonical
 * hand the mannequin and the per-guest scale are both normalised to.
 */
export function fitGearToHand(
  frame: AssetHandFrame,
  def: HandAnchorDef,
  hand: ModelledHand,
  palmLenCm: number = CANONICAL_PALM_LEN_CM,
): GearPlacement | null {
  const basis = handFrameBasis(frame);
  if (basis === null || !(palmLenCm > 0)) return null;
  const scale = palmLenCm / basis.palmLen;
  // GLB → hand frame: the glove's axes become the hand's.
  const toHand: Mat3 = [basis.right, basis.up, basis.palm];
  // The mount's own rotation (the anchor's, in this hand's frame) sits
  // between the hand frame and the placement: hand = Ra · placement.
  const ar = anchorFrameRotation(def.rotation, hand);
  const ra = matFromEulerXYZ(ar[0], ar[1], ar[2]);
  const raT = transpose(ra);
  const rp = mul(raT, toHand);
  // Mount point on the canonical hand of this chirality (wrist at the origin).
  const landmarks = hand === 'left' ? mirrorHandLandmarks(CANONICAL_HAND_LANDMARKS) : CANONICAL_HAND_LANDMARKS;
  const mount = handRefAnchorPoint(def, landmarks);
  if (mount === null) return null;
  // Wrist landmark − mount, in the mount's frame, minus where the scaled,
  // rotated glove wrist would otherwise land.
  const toWrist = apply(raT, [-mount[0], -mount[1], -mount[2]]);
  const w = apply(rp, [frame.wrist[0] * scale, frame.wrist[1] * scale, frame.wrist[2] * scale]);
  const e = eulerXYZFromMat(rp);
  return {
    offset: { x: r4(toWrist[0] - w[0]), y: r4(toWrist[1] - w[1]), z: r4(toWrist[2] - w[2]) },
    rotation: { x: r4(e[0]), y: r4(e[1]), z: r4(e[2]) },
    scale: r4(scale),
  };
}

/**
 * Where a GLB-space point lands in the hand frame (wrist origin, cm) under a
 * placement — the inverse check the tests and the studio's fit readout use.
 */
export function placeOnHand(
  p: Vec3,
  placement: GearPlacement,
  def: HandAnchorDef,
  hand: ModelledHand,
): Vec3 {
  const ar = anchorFrameRotation(def.rotation, hand);
  const ra = matFromEulerXYZ(ar[0], ar[1], ar[2]);
  const rp = matFromEulerXYZ(placement.rotation.x, placement.rotation.y, placement.rotation.z);
  const landmarks = hand === 'left' ? mirrorHandLandmarks(CANONICAL_HAND_LANDMARKS) : CANONICAL_HAND_LANDMARKS;
  const mount = handRefAnchorPoint(def, landmarks) ?? [0, 0, 0];
  const s = placement.scale;
  const local = apply(rp, [p[0] * s, p[1] * s, p[2] * s]);
  const inMount: Vec3 = [local[0] + placement.offset.x, local[1] + placement.offset.y, local[2] + placement.offset.z];
  const r = apply(ra, inMount);
  return [r[0] + mount[0], r[1] + mount[1], r[2] + mount[2]];
}

/** Degrees for the SET_MODEL_ASSET action (which takes the authoring unit). */
export function placementDegrees(p: GearPlacement): { x: number; y: number; z: number } {
  const d = (r: number) => r4((r * 180) / Math.PI);
  return { x: d(p.rotation.x), y: d(p.rotation.y), z: d(p.rotation.z) };
}

/**
 * The placement a LIBRARY asset arrives with when a host adds it: fitted to the
 * hand when its template declares a hand frame and it mounts on a hand, else
 * the entry's authored defaults at the legacy fit scale — every non-glove path
 * is byte-identical to before. Degrees out, because SET_MODEL_ASSET takes the
 * authoring unit.
 */
export function libraryAddPlacement(
  asset: {
    handAnchor?: string;
    defaultNudgeCm?: { x: number; y: number; z: number };
    defaultRotationDeg?: { x: number; y: number; z: number };
  },
  template: { handFrame?: AssetHandFrame; modelledHand?: ModelledHand } | null,
  legacyScale: number | undefined,
): { scale?: number; offsetCm?: { x: number; y: number; z: number }; rotationDeg?: { x: number; y: number; z: number } } {
  const def = asset.handAnchor !== undefined ? HAND_ANCHOR_MAP[asset.handAnchor] : undefined;
  if (template?.handFrame !== undefined && def !== undefined) {
    const fit = fitGearToHand(template.handFrame, def, authoredHand(template.modelledHand, 'auto'));
    if (fit !== null) return { scale: fit.scale, offsetCm: fit.offset, rotationDeg: placementDegrees(fit) };
  }
  return { scale: legacyScale, offsetCm: asset.defaultNudgeCm, rotationDeg: asset.defaultRotationDeg };
}

type FitSource = { handFrame?: AssetHandFrame; modelledHand?: ModelledHand } | null;

/**
 * The seated placement for a hand piece ALREADY in a scene — the studio's
 * "Fit to hand". A piece stores a frozen copy of its template taken when it was
 * added, so a glove added before its library entry learned its hand frame has
 * none; the library's current descriptor (same id) is the fallback. Authored in
 * the hand the host places against (`authoredHand`), exactly as an add is.
 * Null = nothing to seat against: a head piece, or no hand frame anywhere.
 */
export function fitPlacementFor(
  stored: FitSource,
  library: FitSource,
  handAnchor: string | undefined,
  fit: HandFit | undefined,
): GearPlacement | null {
  const def = handAnchor !== undefined ? HAND_ANCHOR_MAP[handAnchor] : undefined;
  const frame = stored?.handFrame ?? library?.handFrame;
  if (def === undefined || frame === undefined) return null;
  return fitGearToHand(frame, def, authoredHand(stored?.modelledHand ?? library?.modelledHand, fit));
}
