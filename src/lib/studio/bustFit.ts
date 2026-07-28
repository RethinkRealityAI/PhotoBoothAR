/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure fit math for the 3D reference bust. A GLB commonly carries a node
 * rotation and a tiny native scale (our Higgsfield bust has a 90° X-axis
 * rotation and a ~1.9-unit bbox); measuring its bounding box WITHOUT first
 * updating the world matrix ignores those transforms, so the bust ends up
 * mis-centred and the orbit camera looks at empty space (black) or lands
 * inside the mesh. This computes the fit from the true, transformed world
 * bbox so the bust is always ~17.7cm tall and centred at the head-space origin.
 */
import * as THREE from 'three';

/** Average adult crown-to-chin height, in the tracker's centimetre space. */
export const HEAD_HEIGHT_CM = 17.7;

export interface BustFit {
  scale: number;
  position: [number, number, number];
}

/**
 * Target size for an auto-fitted user prop (crown / hat / trophy class):
 * largest world dimension lands at ~24cm — deliberately LARGER than head
 * width (~14cm) because user testing found head-width props read far too
 * small next to a real face — always adjustable afterwards.
 */
export const PROP_TARGET_CM = 24;
/** Clamp bounds mirrored by the booth's decompose clamp (faceRig.ts
 *  PROP_SCALE_MIN/MAX). MAX must let a small ~0.5-unit Meshy model reach
 *  PROP_TARGET_CM (24/0.5 = 48), hence 50. */
const PROP_SCALE_MIN = 0.05;
export const PROP_SCALE_MAX = 50;

/**
 * Auto-fit scale for a placed 3D prop. Meshy/uploaded GLBs are commonly ~1
 * unit tall, which renders ~1cm in head space — invisible. Returns the scale
 * that puts the largest dimension at PROP_TARGET_CM, clamped to the prop-scale
 * bounds above, or null when the object has no measurable extent.
 */
export function computePropFitScale(root: THREE.Object3D): number | null {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return null;
  return Math.min(PROP_SCALE_MAX, Math.max(PROP_SCALE_MIN, PROP_TARGET_CM / maxDim));
}

/* ── Anchor-aligned bust fit ───────────────────────────────────────────────
 * computeBustFit (below) fits the WHOLE GLB bbox to head height. That is wrong
 * for a bust: the vendored reference head is a head+neck+plinth, so only ~72%
 * of its bbox is actual head, and fitting the whole thing renders the head at
 * ~12.7cm instead of 17.7cm. A blunt 2x magnifier used to paper over that — and
 * because the magnifier scaled ONLY the bust while AnchorDots and the orbit
 * gizmo stayed in raw centimetres, it buried all 12 attachment points 2.9-8.8cm
 * INSIDE the mesh (measured).
 *
 * The honest fix is to align the mesh to the anchor cloud itself: the anchors
 * ARE the calibration (they were measured against MediaPipe's canonical face),
 * so a fit that puts every anchor just outside the surface is a fit that makes
 * the reference head agree with what the tracker will do to a real guest.
 *
 * Self-calibrating rather than hard-coded on purpose: scripts/remote-assets.json
 * re-fetches this GLB in CI, so measured constants would silently go wrong the
 * day the asset is re-vendored.
 */

/** Gap (cm) we aim for between an anchor dot and the head surface — just proud
 *  of the skin, so a dot reads as sitting ON the head rather than floating. */
export const ANCHOR_CLEARANCE_CM = 0.35;

/** Cone half-angle used to sample the surface along an anchor direction. */
const CONE_MIN_COS = 0.9;
/** Vertices sampled by the SEARCH. The final answer is always re-checked against
 *  every vertex (see computeAnchorAlignedFit), so this trades search precision
 *  for solve time, not correctness. */
const FIT_MAX_SAMPLES = 600;

export interface AnchorAlignedFit extends BustFit {
  /** Signed clearance per anchor, cm; positive = the dot sits outside the mesh. */
  clearances: number[];
  /** Smallest clearance across every anchor. Negative = something is buried. */
  worstClearance: number;
}

/**
 * Farthest sampled point lying within a cone around `dir`, measured from the
 * head-space origin — i.e. how far away the head's surface is in that
 * direction. `points` are xyz triples ALREADY in head space. Returns null when
 * the cone catches nothing (caller decides what that means).
 *
 * Pure and allocation-free; exported for tests.
 */
export function surfaceRadiusAlong(
  points: ArrayLike<number>,
  dir: readonly [number, number, number],
  minCos: number = CONE_MIN_COS,
): number | null {
  const dl = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(dl > 0)) return null;
  const dx = dir[0] / dl, dy = dir[1] / dl, dz = dir[2] / dl;
  let best = -1;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    const r = Math.hypot(x, y, z);
    if (!(r > 1e-6)) continue;
    if ((x * dx + y * dy + z * dz) / r >= minCos && r > best) best = r;
  }
  return best < 0 ? null : best;
}

/**
 * Fit `points` (xyz triples in the model's own units, already world-transformed)
 * to the head space defined by `anchors`, by searching a uniform scale plus a
 * y/z translation. X is centred on the mesh, since heads are symmetric and every
 * anchor pair is mirrored.
 *
 * Cost per anchor: burial is penalised ~6x harder than floating, and any
 * clearance up to `clearanceCm` is free — we want dots to sit just off the
 * surface, not to hover.
 *
 * Returns null when there is nothing measurable to fit.
 */
export function computeAnchorAlignedFit(
  points: ArrayLike<number>,
  anchors: readonly (readonly [number, number, number])[],
  opts: { clearanceCm?: number } = {},
): AnchorAlignedFit | null {
  const target = opts.clearanceCm ?? ANCHOR_CLEARANCE_CM;
  const n = Math.floor(points.length / 3);
  if (n === 0 || anchors.length === 0) return null;

  // Subsample to bound the search, and measure the raw bbox for the seed.
  const stride = Math.max(1, Math.ceil(n / FIT_MAX_SAMPLES));
  const src: number[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i += stride) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    src.push(x, y, z);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (src.length === 0 || !(maxY > minY)) return null;

  const dirs = anchors
    .map((a) => ({ r: Math.hypot(a[0], a[1], a[2]), d: a }))
    .filter((a) => a.r > 1e-6);
  if (dirs.length === 0) return null;

  const cx = (minX + maxX) / 2;
  // ONE sample resolution for every candidate, deliberately. A coarse-to-fine
  // variant (cheap seed selection, fine refinement) measured faster but picked a
  // WORSE basin: surfaceRadiusAlong takes a MAX over samples, and a max over a
  // subsample is biased low, so a coarse cost systematically favours a smaller
  // head and is not comparable to a fine one. Costs are only ever compared at
  // equal resolution.
  const scratch = new Float64Array(src.length);

  /** Map a sample cloud into head space for a candidate fit. */
  const project = (cloud: number[], s: number, ty: number, tz: number) => {
    const out = scratch.subarray(0, cloud.length);
    for (let i = 0; i < cloud.length; i += 3) {
      out[i] = (cloud[i] - cx) * s;
      out[i + 1] = cloud[i + 1] * s + ty;
      out[i + 2] = cloud[i + 2] * s + tz;
    }
    return out;
  };

  const clearancesFor = (cloud: number[], s: number, ty: number, tz: number): number[] => {
    const hs = project(cloud, s, ty, tz);
    return dirs.map((a) => {
      const sr = surfaceRadiusAlong(hs, a.d);
      return sr == null ? Number.POSITIVE_INFINITY : a.r - sr;
    });
  };

  const costOn = (cloud: number[]) => (s: number, ty: number, tz: number): number => {
    let c = 0;
    for (const clear of clearancesFor(cloud, s, ty, tz)) {
      if (!Number.isFinite(clear)) { c += 100; continue; }
      // Anchors should HUG the skin: squared distance from the surface, with
      // burial weighted heavier so ties break outward.
      //
      // An earlier version instead treated burial as catastrophic and any
      // clearance up to a target as free. That made the search shrink the head
      // until nothing could possibly be buried — 10.7cm wide against a 15.4cm
      // ear span, leaving the earring dots hovering 2.3cm out in space. Burial
      // was only ever catastrophic because it made a dot INVISIBLE, and
      // AnchorDots now draws every dot over the bust regardless. So the thing
      // worth optimising is how convincingly the dots sit on the head.
      const d = clear - target;
      c += clear < 0 ? d * d * 3 : d * d;
    }
    return c;
  };

  // Coordinate descent on (scale, ty, tz) with shrinking steps, MULTI-START.
  //
  // The seed is derived from the ANCHORS, never from a global constant: measure
  // the model's own surface radius along each anchor direction at scale 1, then
  // pick the scale that lands the median surface one clearance inside the median
  // anchor. Seeding from HEAD_HEIGHT_CM instead looked fine on the real bust but
  // was only ever calibrated for one anchor scale — a synthetic case an order of
  // magnitude away got stuck in a lopsided local minimum (scale 5.8, two anchors
  // 2cm+ buried) because every seed started far too large to walk back from.
  //
  // Steps are relative to the seed for the same reason, so the search behaves
  // identically whatever units the caller works in.
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const cy = (minY + maxY) / 2;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 2; i < src.length; i += 3) { if (src[i] < minZ) minZ = src[i]; if (src[i] > maxZ) maxZ = src[i]; }
  const cz = (minZ + maxZ) / 2;
  // Model centred on its own bbox, at scale 1 — the frame the seed is measured in.
  const centred = src.map((v, i) => v - (i % 3 === 0 ? cx : i % 3 === 1 ? cy : cz));
  const nativeRadii = dirs
    .map((a) => surfaceRadiusAlong(centred, a.d))
    .filter((r): r is number => r != null && r > 1e-9);
  const anchorRadii = dirs.map((a) => a.r);
  const medAnchor = median(anchorRadii);
  const seedScale = nativeRadii.length
    ? Math.max(1e-6, (medAnchor - target) / median(nativeRadii))
    : HEAD_HEIGHT_CM / (maxY - minY);
  const scaleStep = seedScale * 0.25;
  const moveStep = medAnchor * 0.15;

  const descend = (cloud: number[], s0: number, ty0: number, tz0: number) => {
    const cost = costOn(cloud);
    let s = s0, ty = ty0, tz = tz0, c = cost(s, ty, tz);
    for (const shrink of [1, 0.5, 0.25, 0.12, 0.06, 0.025]) {
      const ds0 = scaleStep * shrink;
      const dm0 = moveStep * shrink;
      for (let guard = 0; guard < 200; guard++) {
        let improved = false;
        const moves: [number, number, number][] = [
          [ds0, 0, 0], [-ds0, 0, 0],
          [0, dm0, 0], [0, -dm0, 0],
          [0, 0, dm0], [0, 0, -dm0],
        ];
        for (const [ds, dy, dz] of moves) {
          const ns = s + ds;
          if (!(ns > 0)) continue;
          const nc = cost(ns, ty + dy, tz + dz);
          if (nc < c - 1e-9) { s = ns; ty += dy; tz += dz; c = nc; improved = true; }
        }
        if (!improved) break;
      }
    }
    return { s, ty, tz, c };
  };

  // Start at the anchor-derived seed with the model centred, then either side of
  // it — a bust whose head is a small fraction of the mesh needs a larger scale
  // than the median-radius estimate suggests.
  let best = descend(src, seedScale, -cy * seedScale, -cz * seedScale);
  for (const mult of [0.7, 1.35, 1.8]) {
    const s0 = seedScale * mult;
    const cand = descend(src, s0, -cy * s0, -cz * s0);
    if (cand.c < best.c) best = cand;
  }
  let { s: bs } = best;
  const { ty: bty, tz: btz } = best;

  // FINAL CHECK AGAINST THE FULL CLOUD. The search runs on a subsample, and
  // surfaceRadiusAlong takes a max, so a subsample can miss the one vertex that
  // pokes furthest along an anchor's direction — measured 0.2mm of residual
  // burial that the search believed it had cleared. Re-measure against every
  // vertex and shrink slightly until nothing is buried. Bounded and cheap: one
  // pass per step, at most 12 steps, and it only ever makes the head smaller.
  const full: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) full.push(x, y, z);
  }
  const fullScratch = new Float64Array(full.length);
  const fullClearances = (s: number): number[] => {
    for (let i = 0; i < full.length; i += 3) {
      fullScratch[i] = (full[i] - cx) * s;
      fullScratch[i + 1] = full[i + 1] * s + bty;
      fullScratch[i + 2] = full[i + 2] * s + btz;
    }
    return dirs.map((a) => {
      const sr = surfaceRadiusAlong(fullScratch, a.d);
      return sr == null ? Number.POSITIVE_INFINITY : a.r - sr;
    });
  };
  // Only GROSS burial is corrected here — a dot a fraction of a millimetre
  // under the skin is invisible as an error and the dots draw over the bust
  // anyway; shrinking the whole head to chase it costs more than it buys.
  const MAX_BURIAL_CM = 0.3;
  let clearances = fullClearances(bs);
  for (let i = 0; i < 12 && Math.min(...clearances) < -MAX_BURIAL_CM; i++) {
    bs *= 0.99;
    clearances = fullClearances(bs);
  }

  return {
    scale: bs,
    position: [-cx * bs, bty, btz],
    clearances,
    worstClearance: clearances.reduce((m, c) => Math.min(m, c), Infinity),
  };
}

/**
 * Flatten every mesh vertex of `root` into world-space xyz triples, sampling at
 * most `maxSamples` of them. Used to feed computeAnchorAlignedFit from a loaded
 * GLTF scene without the caller touching geometry internals.
 */
export function collectWorldPositions(root: THREE.Object3D, maxSamples = 4000): Float32Array {
  root.updateMatrixWorld(true);
  const chunks: { pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; mat: THREE.Matrix4 }[] = [];
  let total = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? (mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined;
    if (!pos) return;
    chunks.push({ pos, mat: mesh.matrixWorld });
    total += pos.count;
  });
  if (total === 0) return new Float32Array(0);
  const stride = Math.max(1, Math.ceil(total / maxSamples));
  const out: number[] = [];
  const v = new THREE.Vector3();
  for (const { pos, mat } of chunks) {
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mat);
      out.push(v.x, v.y, v.z);
    }
  }
  return Float32Array.from(out);
}

/** Fit any loaded object (with arbitrary node transforms) to head space. */
export function computeBustFit(root: THREE.Object3D): BustFit | null {
  // Critical: fold every node's local transform into world matrices first.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  if (!Number.isFinite(size.y) || size.y <= 0) return null;
  const scale = HEAD_HEIGHT_CM / size.y;
  return { scale, position: [-center.x * scale, -center.y * scale, -center.z * scale] };
}
