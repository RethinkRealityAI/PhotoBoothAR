/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * handRefAnchors — the orbit editor's hand mannequin, as MATHS.
 *
 * Two jobs, both of which used to be eyeballed constants in ReferenceHand.tsx:
 *
 * 1. WHERE gear mounts. HAND_ANCHORS (lib/handPose) already defines every mount
 *    point exactly — a landmark pair to sit between, a distance along the palm
 *    normal, and a rotation. Live obeys that definition (anchorPointFor); the
 *    orbit view used to carry three hand-typed vectors that encoded none of it,
 *    so the two views could drift silently. `handRefAnchorPoint` evaluates the
 *    SAME definition against whatever landmark set it is given, so orbit and
 *    live cannot disagree by construction.
 *
 * 2. HOW BIG the mannequin is. `measureHandMannequin` recovers a hand frame and
 *    a metric scale from an arbitrary hand mesh, so a re-vendored GLB is sized
 *    from its own geometry instead of a constant that rots. This is the hand
 *    analogue of bustFit.normalizeFitToCanonical, and it exists for the same
 *    reason: a mannequin that is 25% small makes every prop tuned against it
 *    25% too big the moment a real tracked hand replaces it.
 *
 * The HAND FRAME, throughout: +Y from the wrist toward the middle knuckle,
 * +Z out of the palm, +X = up x normal, origin at the wrist landmark (0),
 * centimetres. That is exactly the frame solveHandPose emits.
 */
import { HAND_ANCHORS, type HandAnchorDef } from '../handPose';

export type Vec3 = [number, number, number];

/**
 * The metric hand, in the hand frame, centimetres. These are the fixture in
 * src/lib/handPose.test.ts (`worldHand`) — the hand solveHandPose is tested to
 * invert — projected onto its own palm basis with the wrist at the origin:
 *   world m -> three cm (x*100, -y*100, -z*100), then
 *   [dot(p-L0, right), dot(p-L0, up), dot(p-L0, normal)]
 * with up = norm(L9-L0), normal = norm((L5-L17) x up), right = up x normal.
 * The two spans that fall out are asserted in the colocated test: they are the
 * repo's ONLY definition of how big a hand is.
 */
export const CANONICAL_HAND_LANDMARKS: Readonly<Record<number, Vec3>> = {
  0: [0, 0, 0],
  5: [2.070881, 9.258047, 0],
  9: [0.000002, 9.850888, 0],
  13: [-2.158179, 9.329108, 0],
  17: [-4.046334, 8.131247, 0],
};

/** Wrist -> middle-MCP, cm (|L9 - L0|). */
export const CANONICAL_PALM_LEN_CM = 9.851;
/** Index-MCP -> pinky-MCP, cm (|L5 - L17|). */
export const CANONICAL_KNUCKLE_CM = 6.22;

/**
 * Where `def` mounts on a hand described by `landmarks` (hand-frame cm):
 * the midpoint of its landmark pair, pushed `normalOffsetCm` along the palm
 * normal (the frame's +Z). Returns null when the pair is not in the set —
 * a caller with a partial measurement must fall back rather than mount at the
 * origin, which on a wand reads as "floating a palm-width away".
 */
export function handRefAnchorPoint(
  def: HandAnchorDef,
  landmarks: Readonly<Record<number, Vec3>> = CANONICAL_HAND_LANDMARKS,
): Vec3 | null {
  const a = landmarks[def.between[0]];
  const b = landmarks[def.between[1]];
  if (!a || !b) return null;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + def.normalOffsetCm];
}

/** Every HAND_ANCHORS mount point on one hand, keyed by anchor id. */
export function handRefAnchors(
  landmarks: Readonly<Record<number, Vec3>> = CANONICAL_HAND_LANDMARKS,
  defs: readonly HandAnchorDef[] = HAND_ANCHORS,
): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const def of defs) {
    const p = handRefAnchorPoint(def, landmarks);
    if (p !== null) out[def.id] = p;
  }
  return out;
}

/* ── Measuring a hand mesh ─────────────────────────────────────────────── */

export interface HandMannequinFit {
  /** Mesh units -> centimetres (uniform). */
  scale: number;
  /** Hand-frame axes expressed in MESH space (unit vectors). */
  right: Vec3;
  up: Vec3;
  normal: Vec3;
  /** The wrist landmark in MESH space — the fit's origin. */
  origin: Vec3;
  /** The recovered palm landmarks in HAND-FRAME cm (wrist at the origin). */
  landmarks: Record<number, Vec3>;
  /** Recovered spans after scaling — these match the canonical pair by construction. */
  palmLenCm: number;
  knuckleCm: number;
  /** The same spans in raw mesh units, i.e. what `scale` was derived FROM. */
  rawPalmLen: number;
  rawKnuckle: number;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Cluster {
  /** Mean coordinate along the lateral axis. */
  r: number;
  /** Mean coordinate along the palm-normal axis. */
  n: number;
  count: number;
}

/**
 * Split a slab of the mesh into lobes along `rAxis`. Four lobes = four fingers;
 * two = palm + thumb. `gap` is the empty run that separates lobes.
 */
function clusterSlab(
  points: ArrayLike<number>,
  upAxis: number,
  rAxis: number,
  nAxis: number,
  lo: number,
  hi: number,
  gap: number,
): Cluster[] {
  const rows: { r: number; n: number }[] = [];
  for (let i = 0; i < points.length; i += 3) {
    const u = points[i + upAxis];
    if (u < lo || u >= hi) continue;
    rows.push({ r: points[i + rAxis], n: points[i + nAxis] });
  }
  if (rows.length === 0) return [];
  rows.sort((a, b) => a.r - b.r);
  const out: Cluster[] = [];
  let sumR = rows[0].r;
  let sumN = rows[0].n;
  let count = 1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].r - rows[i - 1].r > gap) {
      out.push({ r: sumR / count, n: sumN / count, count });
      sumR = 0;
      sumN = 0;
      count = 0;
    }
    sumR += rows[i].r;
    sumN += rows[i].n;
    count++;
  }
  out.push({ r: sumR / count, n: sumN / count, count });
  // Drop slivers (a stray UV-seam vertex is not a finger).
  const total = rows.length;
  return out.filter((c) => c.count >= Math.max(3, total * 0.02));
}

/** Geometric mean of the two lateral spans in a slab — "how thick is it here". */
function crossSize(
  points: ArrayLike<number>,
  upAxis: number,
  rAxis: number,
  nAxis: number,
  lo: number,
  hi: number,
): { size: number; rMid: number; nMid: number } | null {
  let r0 = Infinity, r1 = -Infinity, n0 = Infinity, n1 = -Infinity, count = 0;
  for (let i = 0; i < points.length; i += 3) {
    const u = points[i + upAxis];
    if (u < lo || u >= hi) continue;
    const r = points[i + rAxis];
    const n = points[i + nAxis];
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (n < n0) n0 = n;
    if (n > n1) n1 = n;
    count++;
  }
  if (count < 8) return null;
  return { size: Math.sqrt(Math.max(0, (r1 - r0) * (n1 - n0))), rMid: (r0 + r1) / 2, nMid: (n0 + n1) / 2 };
}

/**
 * Recover a hand frame + metric scale from a hand mesh (flattened world xyz).
 *
 * The mesh is read, never annotated — every step is a measurement:
 *  - long axis = the longest bounding box axis; the WRIST end is the narrower
 *    one (a forearm stub is always thinner than a spread hand).
 *  - palm normal AXIS = the thinner of the two lateral axes (a hand is a slab).
 *  - palm normal SIGN = whichever side the THUMB lobe sits on. The thumb is on
 *    the palm side of the hand plane; without this the mannequin can render
 *    back-to-front, which puts a wand out of the wrong face of the fist.
 *  - knuckle line = the LOWEST station whose cross-section splits into four
 *    lobes. Fingers separate exactly at the MCP row, so this is the anatomical
 *    landmark, not a proportion guess.
 *  - wrist landmark = where the stub first flares into the palm.
 *
 * Returns null rather than a guess whenever any of those cannot be read: an
 * unmeasurable mesh must render nothing (ReferenceBust's rule), because a hand
 * at the wrong size or facing is worse feedback than no hand at all.
 */
export function measureHandMannequin(points: ArrayLike<number>): HandMannequinFit | null {
  const n = Math.floor(points.length / 3);
  if (n < 300) return null;

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = points[i + k];
      if (!Number.isFinite(v)) return null;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

  // 1. Long axis, and which end is the wrist.
  let upAxis = 0;
  for (let k = 1; k < 3; k++) if (size[k] > size[upAxis]) upAxis = k;
  const L = size[upAxis];
  if (!(L > 0)) return null;
  const rest = [0, 1, 2].filter((k) => k !== upAxis);
  const nAxis = size[rest[0]] <= size[rest[1]] ? rest[0] : rest[1];
  const rAxis = nAxis === rest[0] ? rest[1] : rest[0];

  const step = 0.02 * L;
  const half = 0.02 * L;
  const gap = 0.02 * L;

  // Which end is the wrist: the FINGER end is the one that splits into lobes.
  // Thickness alone is not the discriminator — a fingertip cross-section is
  // thinner than a wrist, so "narrow end = wrist" reads the open-hand mannequin
  // exactly backwards (measured on reference-hand-open.glb: tips 0.31 vs wrist
  // 0.37 in mesh units).
  const lobesNear = (fromMin: boolean): number => {
    let best = 0;
    for (let f = 0.06; f <= 0.3; f += 0.02) {
      const c = fromMin ? min[upAxis] + f * L : max[upAxis] - f * L;
      const cs = clusterSlab(points, upAxis, rAxis, nAxis, c - half, c + half, gap);
      if (cs.length > best) best = cs.length;
    }
    return best;
  };
  const lobesLow = lobesNear(true);
  const lobesHigh = lobesNear(false);
  let upSign: 1 | -1;
  if (lobesLow !== lobesHigh) {
    upSign = lobesLow < lobesHigh ? 1 : -1;
  } else {
    // A fist has no split at either end; fall back to thickness.
    const lowEnd = crossSize(points, upAxis, rAxis, nAxis, min[upAxis], min[upAxis] + 0.12 * L);
    const highEnd = crossSize(points, upAxis, rAxis, nAxis, max[upAxis] - 0.12 * L, max[upAxis]);
    if (lowEnd === null || highEnd === null) return null;
    upSign = lowEnd.size <= highEnd.size ? 1 : -1;
  }
  // Signed station coordinate: u = 0 at the wrist end, u = L at the fingertips.
  const uBase = upSign === 1 ? min[upAxis] : max[upAxis];
  const rawU = (u: number) => uBase + upSign * u;
  const slab = (u: number, halfW: number): [number, number] => {
    const a = rawU(u - halfW);
    const b = rawU(u + halfW);
    return a <= b ? [a, b] : [b, a];
  };

  const clustersAt = (u: number) => {
    const [a, b] = slab(u, half);
    return clusterSlab(points, upAxis, rAxis, nAxis, a, b, gap);
  };
  const sizeAt = (u: number) => {
    const [a, b] = slab(u, half);
    return crossSize(points, upAxis, rAxis, nAxis, a, b);
  };

  // 2. Wrist: the first station that flares past the stub's own thickness.
  const stubSizes: number[] = [];
  for (let u = 0.02 * L; u < 0.12 * L; u += step) {
    const s = sizeAt(u);
    if (s !== null) stubSizes.push(s.size);
  }
  if (stubSizes.length === 0) return null;
  const stub = medianOf(stubSizes);
  let uWrist = 0.1 * L;
  for (let u = 0.06 * L; u < 0.5 * L; u += step) {
    const s = sizeAt(u);
    if (s !== null && s.size > stub * 1.15) { uWrist = u; break; }
  }
  const wristSlab = sizeAt(uWrist);
  if (wristSlab === null) return null;

  // 3. Knuckle line: the LOWEST station whose cross-section reads four lobes.
  //    Each station is a slab, so the first four-lobe reading sits `half` above
  //    the joints themselves (the slab still catches palm below them) — backing
  //    that smear off is worth ~13% of palm length on the vendored mannequin.
  let uSplit: number | null = null;
  for (let u = L * 0.45; u < L * 0.98; u += step) {
    if (clustersAt(u).length >= 4) { uSplit = u; break; }
  }
  if (uSplit === null) return null;
  const uKnuckle = Math.max(uWrist + step, uSplit - half);

  // 4. Palm-normal sign: the thumb lobe's side of the hand plane. Vote over the
  //    stations between wrist and knuckles that split cleanly into palm+thumb.
  let vote = 0;
  for (let u = uWrist + 0.25 * (uKnuckle - uWrist); u < uKnuckle; u += step) {
    const cs = clustersAt(u);
    if (cs.length !== 2) continue;
    const [a, b] = cs;
    const thumb = a.count <= b.count ? a : b;
    const palm = a.count <= b.count ? b : a;
    if (thumb.count > palm.count * 0.6) continue; // not a lobe, a split palm
    vote += Math.sign(thumb.n - palm.n);
  }
  if (vote === 0) return null;
  const nSign = vote > 0 ? 1 : -1;

  // 5. The frame. right = up x normal reproduces solveHandPose's basis exactly
  //    (verified against the canonical hand in the colocated test).
  const up: Vec3 = [0, 0, 0];
  up[upAxis] = upSign;
  const normal: Vec3 = [0, 0, 0];
  normal[nAxis] = nSign;
  const right = cross3(up, normal);

  const meshPoint = (u: number, r: number, nn: number): Vec3 => {
    const p: Vec3 = [0, 0, 0];
    p[upAxis] = rawU(u);
    p[rAxis] = r;
    p[nAxis] = nn;
    return p;
  };

  // 6. The four MCPs, read just above the split where the fingers are
  //    unambiguously separate, but placed AT the knuckle line (the joint, not
  //    the phalanx).
  const fingers = clustersAt(uSplit + 0.04 * L);
  if (fingers.length !== 4) return null;
  const origin = meshPoint(uWrist, wristSlab.rMid, wristSlab.nMid);
  const mcp = fingers
    .map((c) => meshPoint(uKnuckle, c.r, c.n))
    .sort((a, b) => dot3(sub3(b, origin), right) - dot3(sub3(a, origin), right));
  // Highest `right` coordinate is the index side — the canonical hand's L5.
  const ids = [5, 9, 13, 17];

  const rawPalmLen = len3(sub3(mcp[1], origin));
  const rawKnuckle = len3(sub3(mcp[0], mcp[3]));
  if (!(rawPalmLen > 1e-6) || !(rawKnuckle > 1e-6)) return null;
  const byPalm = CANONICAL_PALM_LEN_CM / rawPalmLen;
  const byKnuckle = CANONICAL_KNUCKLE_CM / rawKnuckle;
  // The two independent estimates must agree, or the mesh is not hand-shaped
  // and any scale we pick would be a coin flip.
  const spread = Math.max(byPalm, byKnuckle) / Math.min(byPalm, byKnuckle);
  if (!Number.isFinite(spread) || spread > 1.6) return null;
  const scale = (byPalm + byKnuckle) / 2;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const toHand = (p: Vec3): Vec3 => {
    const d = sub3(p, origin);
    return [dot3(d, right) * scale, dot3(d, up) * scale, dot3(d, normal) * scale];
  };
  const landmarks: Record<number, Vec3> = { 0: [0, 0, 0] };
  for (let i = 0; i < 4; i++) landmarks[ids[i]] = toHand(mcp[i]);

  return {
    scale,
    right,
    up,
    normal,
    origin,
    landmarks,
    palmLenCm: rawPalmLen * scale,
    knuckleCm: rawKnuckle * scale,
    rawPalmLen,
    rawKnuckle,
  };
}
