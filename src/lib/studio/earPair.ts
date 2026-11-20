/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EARRING PAIRS. A library pair of earrings is ONE model anchored to one ear:
 * the near earring hangs at the model origin and its twin is baked ~15cm away
 * (twice the old canonical ear x). One rigid model cannot sit on two ears whose
 * spacing differs per guest — so at load the model is split into its two
 * earrings and the far one is carried to the OTHER ear.
 *
 * `findPairSplit` and `earAnchorPoints` are pure (tested); `splitScenePair`
 * does the three.js surgery on a CLONED scene and hands back how to undo it.
 */
import * as THREE from 'three';
import type { HeadAnchor } from '../../types';
import type { EarEstimate, EarVec } from '../faceEngine/earPoints';

/** The two clusters must be separated by at least this share of the model's x-span. */
const MIN_GAP_SHARE = 0.25;
/** …and each must hold at least this share of the triangles (a stray gem is not an earring). */
const MIN_SIDE_SHARE = 0.15;

/**
 * Given every triangle's centroid x (model-root space), find the x that splits
 * the model into two separated clusters — or null when it is one object.
 */
export function findPairSplit(centroidX: ArrayLike<number>): number | null {
  const n = centroidX.length;
  if (n < 8) return null;
  const xs = Float64Array.from(centroidX as ArrayLike<number>).sort();
  const span = xs[n - 1] - xs[0];
  if (!(span > 0) || !Number.isFinite(span)) return null;
  let best = 0, at = -1;
  for (let i = 1; i < n; i++) {
    const g = xs[i] - xs[i - 1];
    if (g > best) { best = g; at = i; }
  }
  if (at < 0 || best < span * MIN_GAP_SHARE) return null;
  if (at < n * MIN_SIDE_SHARE || n - at < n * MIN_SIDE_SHARE) return null;
  return (xs[at] + xs[at - 1]) / 2;
}

/**
 * The lobe this piece hangs from (`self`) and the opposite one (`other`), in the
 * RENDERED head group's frame. `leftEar` lives at +x of that frame. A mirrored
 * rig reflects the pose (faceRig), so the guest's real left ear lands at −x
 * there — exactly as FaceOccluder reflects the live mesh.
 */
export function earAnchorPoints(
  anchor: HeadAnchor,
  est: EarEstimate,
  mirror: boolean,
): { self: EarVec; other: EarVec; tracked: boolean } {
  const reflect = (v: EarVec): EarVec => [-v[0], v[1], v[2]];
  // In the rendered frame: the +x ear and the −x ear, and where each came from.
  const plus = mirror ? reflect(est.right) : est.left;
  const minus = mirror ? reflect(est.left) : est.right;
  const plusSrc = mirror ? est.rightSource : est.leftSource;
  const minusSrc = mirror ? est.leftSource : est.rightSource;
  const wantsPlus = anchor !== 'rightEar';
  return {
    self: wantsPlus ? plus : minus,
    other: wantsPlus ? minus : plus,
    tracked: (wantsPlus ? plusSrc : minusSrc) !== 'default',
  };
}

/**
 * Where the far earring must move, in the model's own (asset-local) frame:
 * the head-space step from this ear to the other one, taken back through the
 * piece's fine rotation and scale (AssetGizmo: head = base + offset + R·(s·p)).
 */
export function pairWantLocal(
  self: EarVec,
  other: EarVec,
  rotation: { x: number; y: number; z: number } | undefined,
  scale: number | undefined,
): EarVec {
  const d = new THREE.Vector3(other[0] - self[0], other[1] - self[1], other[2] - self[2]);
  if (rotation && (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0)) {
    d.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z)).invert());
  }
  const s = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
  return [d.x / s, d.y / s, d.z / s];
}

export interface ScenePair {
  /** Holds the far earring; set its position to (want − authoredDelta). */
  farGroup: THREE.Group;
  /** far hook − near hook as authored (≈ (−15, 0, 0) for a left-ear pair). */
  authoredDelta: EarVec;
  /** Put the scene back exactly as it was and free what the split created. */
  restore(): void;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * Split a loaded (cloned) model into its two earrings. Returns null — and
 * touches nothing — unless the WHOLE model separates cleanly into two clusters
 * along x and every mesh is a plain, non-skinned triangle mesh.
 */
export function splitScenePair(scene: THREE.Object3D): ScenePair | null {
  scene.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const meshes: { mesh: THREE.Mesh; toRoot: THREE.Matrix4; cx: Float32Array; tri: number }[] = [];
  let total = 0, bad = false;
  scene.traverse((o) => {
    if (bad || !(o instanceof THREE.Mesh)) return;
    const g = o.geometry as THREE.BufferGeometry | undefined;
    const pos = g?.getAttribute('position');
    if (!g || !pos || (o as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(o.material) || g.groups.length > 1) { bad = true; return; }
    const idx = g.getIndex();
    const tri = Math.floor((idx ? idx.count : pos.count) / 3);
    const toRoot = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    const cx = new Float32Array(tri);
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      _a.fromBufferAttribute(pos, i0).applyMatrix4(toRoot);
      _b.fromBufferAttribute(pos, i1).applyMatrix4(toRoot);
      _c.fromBufferAttribute(pos, i2).applyMatrix4(toRoot);
      cx[t] = (_a.x + _b.x + _c.x) / 3;
    }
    meshes.push({ mesh: o, toRoot, cx, tri });
    total += tri;
  });
  if (bad || meshes.length === 0 || total < 8) return null;
  const all = new Float32Array(total);
  let w = 0;
  for (const m of meshes) { all.set(m.cx, w); w += m.tri; }
  const splitX = findPairSplit(all);
  if (splitX === null) return null;

  // Which side holds the model origin (the anchored ear)? That one stays put.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < total; i++) { if (all[i] < lo) lo = all[i]; if (all[i] > hi) hi = all[i]; }
  const nearIsHigh = Math.abs((hi + splitX) / 2) <= Math.abs((lo + splitX) / 2);

  const farGroup = new THREE.Group();
  farGroup.name = 'ear-pair-far';
  const nearBox = new THREE.Box3(), farBox = new THREE.Box3();
  const undo: (() => void)[] = [];
  const made: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    const g = m.mesh.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const near: number[] = [], far: number[] = [];
    for (let t = 0; t < m.tri; t++) {
      const isNear = (m.cx[t] > splitX) === nearIsHigh;
      const dst = isNear ? near : far;
      const box = isNear ? nearBox : farBox;
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        dst.push(vi);
        box.expandByPoint(_a.fromBufferAttribute(pos, vi).applyMatrix4(m.toRoot));
      }
    }
    // Same vertex buffers (so per-vertex region ids, uvs and normals stay aligned), new index.
    const sub = (ids: number[]): THREE.BufferGeometry => {
      const out = new THREE.BufferGeometry();
      for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.getAttribute(name));
      out.setIndex(ids);
      out.userData = { ...g.userData };
      made.push(out);
      return out;
    };
    const original = g;
    m.mesh.geometry = sub(near);
    undo.push(() => { m.mesh.geometry = original; });
    if (far.length > 0) {
      const twin = new THREE.Mesh(sub(far), m.mesh.material);
      twin.name = `${m.mesh.name || 'mesh'}-far`;
      twin.renderOrder = m.mesh.renderOrder;
      twin.frustumCulled = m.mesh.frustumCulled;
      m.toRoot.decompose(twin.position, twin.quaternion, twin.scale);
      farGroup.add(twin);
    }
  }
  // Two EARRINGS do not overlap: their bounding boxes must be apart along x by a
  // real share of the model's width. Centroids alone also "separate" one
  // symmetric object made of big triangles.
  const xGap = Math.max(nearBox.min.x - farBox.max.x, farBox.min.x - nearBox.max.x);
  const xSpan = Math.max(nearBox.max.x, farBox.max.x) - Math.min(nearBox.min.x, farBox.min.x);
  if (nearBox.isEmpty() || farBox.isEmpty() || !(xGap >= xSpan * MIN_GAP_SHARE)) {
    for (const u of undo) u();
    for (const g of made) g.setIndex(null);
    return null;
  }
  scene.add(farGroup);
  // An earring hangs from its top-centre: compare the two hooks.
  const hook = (b: THREE.Box3): EarVec => [(b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2];
  const n = hook(nearBox), f = hook(farBox);
  return {
    farGroup,
    authoredDelta: [f[0] - n[0], f[1] - n[1], f[2] - n[2]],
    restore() {
      scene.remove(farGroup);
      for (const u of undo) u();
      // Only the index is ours; the vertex buffers belong to the shared model cache.
      for (const g of made) g.setIndex(null);
    },
  };
}
