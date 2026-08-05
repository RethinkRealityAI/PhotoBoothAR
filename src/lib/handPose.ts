/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Monocular 6DOF hand pose from MediaPipe HandLandmarker output — PURE maths,
 * no three.js, colocated tests. HandRig.tsx applies the result to an R3F group.
 *
 * Method (research-verified against the MediaPipe graph sources):
 *  - `worldLandmarks` are METRIC (metres), hand-centred, and already aligned
 *    to camera axes (only the crop's in-plane roll is undone upstream), so
 *    they carry orientation + true scale; only absolute DEPTH is missing.
 *  - Depth: least-squares weak perspective over the five rigid palm landmarks
 *    {0,5,9,13,17} — s = Σ(pᵢ·wᵢ)/Σ(wᵢ·wᵢ) (screen units per cm), Z = (f/H)/s.
 *    No anthropometric constant, and foreshortening cancels because wᵢ shrinks
 *    by the same cosine the projection does (the #1 artifact in naive
 *    span-ratio implementations).
 *  - Orientation: palm basis from the world landmarks — up = wrist→middleMCP,
 *    across = indexMCP→pinkyMCP, normal = across × up (negated for the left
 *    hand: the two hands are mirror images). Axes converted MediaPipe→three
 *    via 100·diag(1,−1,−1) — a PROPER rotation; the wrong sign silently flips
 *    chirality and renders a gauntlet inside-out.
 *
 * The camera is faceRig's RIG_CAMERA: origin, looking −Z, 63° vertical FOV,
 * world units centimetres — confirmed to be MediaPipe's own metric camera.
 */

import type { HandPoint } from './handGestures';
import { unprojectToDepth } from './studio/beam';

/** f/H for the 63° vertical FOV (≈ 0.815926). */
const FOCAL_OVER_HEIGHT = 0.5 / Math.tan((63 * Math.PI) / 360);

/** The five rigid palm landmarks — wrist + the four finger MCPs. */
const PALM = [0, 5, 9, 13, 17] as const;

export type Quat = [number, number, number, number];

export interface HandPose {
  /** Palm-centroid position, world cm, RAW (unmirrored) frame. */
  position: [number, number, number];
  /** Hand-frame orientation (+Y up the palm toward the fingers, +Z out of the
   *  palm), world frame, RAW. */
  quaternion: Quat;
  /** This hand's palm span in cm (wrist→middle MCP) — the per-user size. */
  palmSpanCm: number;
  /** Estimated depth (cm, positive) — exported for the occluder. */
  depthCm: number;
}

export interface HandAnchorDef {
  id: 'grip' | 'wristBack' | 'palm' | 'forearm';
  label: string;
  /** Worked examples, shown in the studio tooltip. The head anchors have
   *  carried these since the start (faceRig ANCHOR_PRESETS); the hand mounts
   *  shipped without them, and Wrist vs Palm differ by 0.3cm of offset and one
   *  landmark pair — a host genuinely cannot tell them apart by name. */
  hint: string;
  /** Which two landmarks midpoint the anchor sits at (screen space). */
  between: [number, number];
  /** Offset along the palm normal, cm (negative = into the palm/fist). */
  normalOffsetCm: number;
  /** Extra rotation (radians, XYZ intrinsic) applied in the hand frame — e.g.
   *  a wand shaft runs along the knuckle line, not up the palm. */
  rotation: [number, number, number];
  /**
   * Push the mount this far ELBOW-ward from the wrist, cm. Absent = 0, which is
   * every hand-worn anchor. Clamped to FOREARM_REACH_MAX_CM by `forearmReachCm`
   * — the forearm direction is inferred, not tracked, so a mount beyond that is
   * not on the arm any more.
   */
  alongForearmCm?: number;
}

/** Where hand-worn/held gear mounts. Research notes: a fist-held wand runs
 *  along the 5→17 knuckle line, ~2cm inside the fist; a gauntlet centres on
 *  the wrist with the forearm continuing along −(P9−P0). */
export const HAND_ANCHORS: readonly HandAnchorDef[] = [
  { id: 'grip', label: 'Grip (held in the fist)', hint: 'Runs through a closed fist — wands, swords, torches', between: [9, 13], normalOffsetCm: -2.2, rotation: [0, 0, Math.PI / 2] },
  { id: 'wristBack', label: 'Wrist (worn)', hint: 'Sits on the wrist itself — watches, bands, gauntlet cuffs', between: [0, 0], normalOffsetCm: 1.2, rotation: [0, 0, 0] },
  { id: 'palm', label: 'Palm (open hand)', hint: 'Floats off an open palm — orbs, energy, held-out props', between: [9, 13], normalOffsetCm: 1.5, rotation: [0, 0, 0] },
  // Sits at the wrist like wristBack, but its `alongForearmCm` pushes the mount
  // DOWN the arm so a sleeve, bracer or long cuff centres on the forearm rather
  // than on the hand. See FOREARM_REACH_MAX_CM for why it cannot go far.
  { id: 'forearm', label: 'Forearm (sleeve or bracer)', hint: 'Continues up the arm — sleeves, bracers, long gauntlets', between: [0, 0], normalOffsetCm: 0, rotation: [0, 0, 0], alongForearmCm: 5 },
];

export const HAND_ANCHOR_MAP: Record<string, HandAnchorDef> = Object.fromEntries(
  HAND_ANCHORS.map((a) => [a.id, a]),
);

export function isHandAnchorId(v: unknown): v is HandAnchorDef['id'] {
  return typeof v === 'string' && v in HAND_ANCHOR_MAP;
}

function quatFromBasis(
  r: [number, number, number],
  u: [number, number, number],
  n: [number, number, number],
): Quat {
  // Column-major rotation matrix [right, up, normal] → quaternion (Shepperd).
  const m00 = r[0], m01 = u[0], m02 = n[0];
  const m10 = r[1], m11 = u[1], m12 = n[1];
  const m20 = r[2], m21 = u[2], m22 = n[2];
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

const norm3 = (v: [number, number, number]): [number, number, number] | null => {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-9) || !isFinite(len)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
};
const cross3 = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** MediaPipe world metres (x right, y DOWN, z away) → three cm (y up, z toward
 *  viewer). diag(1,−1,−1)·100 — determinant +1, chirality preserved. */
function toThreeCm(p: HandPoint): [number, number, number] {
  return [p.x * 100, -p.y * 100, -p.z * 100];
}

/**
 * Solve the full pose, or null on a degenerate frame (edge-on palm, missing
 * landmarks, zero spans) — callers hold the last good pose instead.
 *
 * `landmarks` are normalized screen points (x by width, y by height), `world`
 * the metric world landmarks, `realHand` the label-swapped handedness,
 * `aspect` = frame width/height, `lockedSpanCm` an optional frozen palm span
 * (median over first confident frames — removes per-frame scale noise from
 * the depth channel; null = use this frame's own).
 */
export function solveHandPose(
  landmarks: readonly HandPoint[],
  world: readonly HandPoint[],
  realHand: 'Left' | 'Right',
  aspect: number,
  lockedSpanCm: number | null,
): HandPose | null {
  if (landmarks.length < 21 || world.length < 21) return null;
  for (const i of PALM) {
    if (!isFinite(landmarks[i].x) || !isFinite(landmarks[i].y) || !isFinite(world[i].x)) return null;
  }

  // Screen coords in HEIGHT units (x is width-normalized; × aspect converts),
  // centred on the palm centroid.
  let cu = 0, cv = 0, cwx = 0, cwy = 0;
  for (const i of PALM) {
    cu += landmarks[i].x * aspect;
    cv += landmarks[i].y;
    cwx += world[i].x * 100;
    cwy += world[i].y * 100;
  }
  cu /= PALM.length; cv /= PALM.length; cwx /= PALM.length; cwy /= PALM.length;

  // Least-squares weak-perspective scale: screen (height units) per cm.
  // World y is DOWN like screen y, so the image-plane components align.
  let num = 0, den = 0;
  for (const i of PALM) {
    const pu = landmarks[i].x * aspect - cu;
    const pv = landmarks[i].y - cv;
    const wx = world[i].x * 100 - cwx;
    const wy = world[i].y * 100 - cwy;
    num += pu * wx + pv * wy;
    den += wx * wx + wy * wy;
  }
  if (!(den > 1e-6) || !(num > 1e-9)) return null;
  let s = num / den;

  // Locked-size correction: replace this frame's world scale with the frozen
  // per-user span, so world-landmark scale noise leaves the depth channel.
  const frameSpanCm = Math.hypot(
    (world[9].x - world[0].x) * 100,
    (world[9].y - world[0].y) * 100,
    (world[9].z - world[0].z) * 100,
  );
  if (lockedSpanCm !== null && lockedSpanCm > 1 && frameSpanCm > 1) {
    s *= frameSpanCm / lockedSpanCm;
  }

  const depthCm = Math.min(400, Math.max(15, FOCAL_OVER_HEIGHT / s));

  // Position: palm centroid unprojected at that depth (centroid u is back in
  // width units for unprojectToDepth's contract).
  const position = unprojectToDepth(cu / aspect, cv, depthCm, 63, aspect);

  // Orientation from the world landmarks in three axes.
  const w0 = toThreeCm(world[0]);
  const w5 = toThreeCm(world[5]);
  const w9 = toThreeCm(world[9]);
  const w17 = toThreeCm(world[17]);
  const up = norm3([w9[0] - w0[0], w9[1] - w0[1], w9[2] - w0[2]]);
  if (up === null) return null;
  const across: [number, number, number] = [w5[0] - w17[0], w5[1] - w17[1], w5[2] - w17[2]];
  let normal = norm3(cross3(across, up));
  if (normal === null) return null;
  // Anatomy mirrors between hands: the same cross points out of the RIGHT
  // palm but out of the LEFT hand's back.
  if (realHand === 'Left') normal = [-normal[0], -normal[1], -normal[2]];
  const right = norm3(cross3(up, normal));
  if (right === null) return null;
  // Re-orthogonalize up (across is not exactly perpendicular to it).
  const trueUp = norm3(cross3(normal, right));
  if (trueUp === null) return null;

  return {
    position,
    quaternion: quatFromBasis(right, trueUp, normal),
    palmSpanCm: frameSpanCm,
    depthCm,
  };
}

/** Mirror a pose for the selfie preview — the SAME reflection faceRig applies:
 *  negate position.x; conjugate the quaternion by diag(−1,1,1). */
export function mirrorHandPose(pose: HandPose): HandPose {
  return {
    ...pose,
    position: [-pose.position[0], pose.position[1], pose.position[2]],
    quaternion: [pose.quaternion[0], -pose.quaternion[1], -pose.quaternion[2], pose.quaternion[3]],
  };
}

/* ── The forearm ───────────────────────────────────────────────────────────
 *
 * HandLandmarker has NO forearm. Landmark 0 (the wrist) is the most proximal
 * point that exists — verified in the shipped typings
 * (@mediapipe/tasks-vision vision.d.ts: the result is exactly `landmarks`,
 * `worldLandmarks`, `handedness`, `handednesses`). So the forearm here is
 * INFERRED, and the only honest inference is that it continues where the palm
 * came from: straight back along the hand frame's −Y.
 *
 * That is exact for a neutral wrist (the third metacarpal is collinear with the
 * forearm) and wrong by exactly the wrist's deviation otherwise. Measured on
 * real frames against a PoseLandmarker-derived elbow: 2.6° with the wrist
 * relaxed, 28.4° on a fist gripping a vertical wand. Functional wrist range for
 * daily tasks is ~40° flexion / 40° extension (Ryu et al., J Hand Surg 1991),
 * so ~30° is the working error and ~60° the anatomical ceiling.
 *
 * Lateral drift is reach × sin(error). A forearm is only ~5–6 cm in radius, so
 * at 10 cm reach a 28° error already puts the far end off the limb. That single
 * number is why FOREARM_REACH_MAX_CM exists and why it is small.
 *
 * WHY NOT TRACK IT PROPERLY: PoseLandmarker does expose the elbow, and it was
 * measured — +5.78 MB, +571 ms init, ~0.92× the hand landmarker's per-call cost
 * (a third blocking inference on a main thread already at ~58% duty), and on
 * this app's own portrait framing the elbow left the frame in 2 of 16 samples
 * with a median visibility of 0.67. It buys an unreliable elbow for a large,
 * permanent cost. Every commercial WebAR stack reaches the same conclusion:
 * 8th Wall's hand model "extends just past the palm to include the region where
 * a watch or bracelet would typically rest" and pairs it with a wrist occluder;
 * Snap ships Wrist Binding; WebAR.rocks masks the inside of a bracelet. None of
 * them tracks a forearm. The occluder — not the axis — is what sells the shot.
 */

/** How far past the wrist a mount may sit. Beyond this the inferred axis's own
 *  error exceeds the radius of the limb it is meant to be on. */
export const FOREARM_REACH_MAX_CM = 12;

/** Clamp an authored elbow-ward offset to what the inference can support. */
export function forearmReachCm(alongCm: number | undefined): number {
  if (alongCm === undefined || !isFinite(alongCm) || alongCm <= 0) return 0;
  return Math.min(FOREARM_REACH_MAX_CM, alongCm);
}

/**
 * Unit vector from the wrist toward the elbow, world cm, RAW — the hand frame's
 * −Y read straight off the pose quaternion (column 1 negated), so it cannot
 * drift from the frame `anchorPointFor` already uses.
 */
export function forearmAxis(pose: HandPose): [number, number, number] {
  const [x, y, z, w] = pose.quaternion;
  return [-(2 * (x * y - w * z)), -(1 - 2 * (x * x + z * z)), -(2 * (y * z + w * x))];
}

/**
 * Screen-space midpoint of an anchor's landmark pair, unprojected at the
 * pose's depth, plus the normal offset — where the gear mounts, world cm, RAW.
 *
 * An anchor with `alongForearmCm` is additionally pushed elbow-ward, clamped:
 * that is the only supported way to sit gear on the arm rather than the hand.
 */
export function anchorPointFor(
  def: HandAnchorDef,
  landmarks: readonly HandPoint[],
  pose: HandPose,
  aspect: number,
): [number, number, number] {
  const a = landmarks[def.between[0]];
  const b = landmarks[def.between[1]];
  const [x, y, z] = unprojectToDepth((a.x + b.x) / 2, (a.y + b.y) / 2, pose.depthCm, 63, aspect);
  // Palm normal = the hand frame's +Z axis.
  const [qx, qy, qz, qw] = pose.quaternion;
  const nx = 2 * (qx * qz + qw * qy);
  const ny = 2 * (qy * qz - qw * qx);
  const nz = 1 - 2 * (qx * qx + qy * qy);
  const reach = forearmReachCm(def.alongForearmCm);
  const f = reach > 0 ? forearmAxis(pose) : null;
  return [
    x + nx * def.normalOffsetCm + (f ? f[0] * reach : 0),
    y + ny * def.normalOffsetCm + (f ? f[1] * reach : 0),
    z + nz * def.normalOffsetCm + (f ? f[2] * reach : 0),
  ];
}
