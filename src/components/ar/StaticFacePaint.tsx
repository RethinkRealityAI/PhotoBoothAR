/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StaticFacePaint — Living Face Paint on the 3D reference head (the studio's
 * orbit view and the host wizard's "camera off" preview), where there is no
 * tracked face to paint.
 *
 * It paints the SAME texture the booth paints (paintFacePaint, through the
 * same faceFrameFromUvs feature frame), onto the MediaPipe canonical face
 * shell — the metric-centimetre head space faceRig anchors and FaceOccluder
 * already live in, and the space the reference bust is fitted to. Vertices
 * 0-467 of that shell are MediaPipe landmark indices, the same indices the
 * standard topology's uvs and triangles use, so the paint lands on the same
 * features it does on a guest.
 *
 * The shell is an average face, not the bust's own surface: wider at the
 * temples and jaw, deeper or shallower elsewhere. So once the bust has loaded,
 * every shell vertex is SNAPPED onto the bust along its normal (one raycast
 * each, cached per scale) and lifted a hair off it; a triangle with a vertex
 * that misses the bust is dropped, so nothing floats past the head's outline.
 * Until then (or with no bust at all) the shell is drawn lifted a few
 * millimetres along its normals.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import objText from '../../assets/ar/canonical_face_model.obj?raw';
import { parseObj } from '../../lib/studio/occluder';
import { faceFrameFromUvs } from '../../lib/facePaint/features';
import { paintFacePaint } from '../../lib/facePaint/painter';
import { STANDARD_FACE_INDICES, STANDARD_FACE_UVS } from '../../lib/facePaint/faceTopology';
import { facePaintKey, type FacePaintSpec } from '../../lib/facePaint/spec';
import { REFERENCE_BUST_NAME } from './ReferenceBust';

const TEXTURE_PX = 1024;
/** How far (cm) the shell is lifted off the average face before it snaps. */
const LIFT_CM = 0.35;
/** How far (cm) a snapped vertex sits off the bust's skin. */
const SKIN_GAP_CM = 0.08;
/** A snap farther than this from the average face is a wrong hit (an ear, the neck). */
const MAX_SNAP_CM = 2.5;

let _geo: THREE.BufferGeometry | null = null;
function paintGeometry(): THREE.BufferGeometry {
  if (_geo) return _geo;
  const { positions } = parseObj(objText);
  const n = positions.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(STANDARD_FACE_UVS.slice(0, n * 2)), 2));
  geo.setIndex(STANDARD_FACE_INDICES.filter((_, i, all) => {
    // Keep only whole triangles that stay inside the shell (468 points).
    const t = i - (i % 3);
    return all[t] < n && all[t + 1] < n && all[t + 2] < n;
  }) as number[]);
  geo.computeVertexNormals();
  // Lift along the normals. Winding decides which way they point, so orient
  // them all outward: on average a face normal points away from the centroid.
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i++) c.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  c.divideScalar(n);
  let dot = 0;
  for (let i = 0; i < n; i++) {
    dot += (pos.getX(i) - c.x) * nor.getX(i) + (pos.getY(i) - c.y) * nor.getY(i) + (pos.getZ(i) - c.z) * nor.getZ(i);
  }
  const s = dot < 0 ? -LIFT_CM : LIFT_CM;
  geo.userData.outward = dot < 0 ? -1 : 1;
  geo.userData.base = Float32Array.from(pos.array as Float32Array);
  for (let i = 0; i < n; i++) {
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * s, pos.getY(i) + nor.getY(i) * s, pos.getZ(i) + nor.getZ(i) * s);
  }
  pos.needsUpdate = true;
  _geo = geo;
  return geo;
}

/** Snapped copies, one per bust object + scale (the bust is cached for the session). */
const snapCache = new Map<string, THREE.BufferGeometry>();

/** Face-edge landmarks (MediaPipe 234 = subject's right cheek edge, 454 = left). */
const EDGE_R = 234;
const EDGE_L = 454;

/**
 * How much narrower the bust's face is than the average face, measured at the
 * cheek edges: a ray from each side, at the edge landmark's height and depth,
 * finds where the bust's skin really is. Projection alone keeps x, so without
 * this a cheek design lands out by the ears on a narrower head. Clamped, and
 * 1 when either side misses.
 */
function bustWidthRatio(src: Float32Array, bust: THREE.Object3D, toWorld: THREE.Matrix4, ray: THREE.Raycaster, worldScale: number): number {
  const toLocal = toWorld.clone().invert();
  const half: number[] = [];
  for (const i of [EDGE_R, EDGE_L]) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    const out = Math.sign(x) || 1;
    const from = new THREE.Vector3(x + out * 15, y, z).applyMatrix4(toWorld);
    const dir = new THREE.Vector3(-out, 0, 0).transformDirection(toWorld);
    ray.set(from, dir);
    ray.far = 30 * worldScale;
    const h = ray.intersectObject(bust, true)[0];
    if (!h) return 1;
    const local = h.point.clone().applyMatrix4(toLocal);
    half.push(Math.abs(local.x) / Math.abs(x));
  }
  const k = (half[0] + half[1]) / 2;
  return Number.isFinite(k) ? Math.min(1.1, Math.max(0.7, k)) : 1;
}

/**
 * The shell projected onto `bust`: each vertex is cast inward along its normal
 * from just outside the average face. Works in WORLD space, so the caller's
 * transforms (head scale) are honoured, then writes mesh-local positions.
 */
function snapToBust(base: THREE.BufferGeometry, mesh: THREE.Mesh, bust: THREE.Object3D): THREE.BufferGeometry {
  const geo = base.clone();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const src = base.userData.base as Float32Array;
  const sign = (base.userData.outward as number) ?? 1;
  const n = pos.count;
  const hit = new Uint8Array(n);
  const ray = new THREE.Raycaster();
  const toWorld = mesh.matrixWorld;
  const toLocal = toWorld.clone().invert();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toWorld);
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  const worldScale = new THREE.Vector3().setFromMatrixScale(toWorld).x || 1;
  const k = bustWidthRatio(src, bust, toWorld, ray, worldScale);
  for (let i = 0; i < n; i++) {
    p.set(src[i * 3] * k, src[i * 3 + 1], src[i * 3 + 2]).applyMatrix4(toWorld);
    d.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(normalMatrix).normalize().multiplyScalar(sign);
    // Start outside the head, look back in along the normal.
    ray.set(p.clone().addScaledVector(d, 6 * worldScale), d.clone().negate());
    ray.far = 12 * worldScale;
    const hits = ray.intersectObject(bust, true);
    const h = hits.find((x) => x.distance > 0);
    if (h && h.point.distanceTo(p) <= MAX_SNAP_CM * worldScale) {
      const q = h.point.clone().addScaledVector(d, SKIN_GAP_CM * worldScale).applyMatrix4(toLocal);
      pos.setXYZ(i, q.x, q.y, q.z);
      hit[i] = 1;
    }
  }
  pos.needsUpdate = true;
  // Drop any triangle that is not fully on the head.
  const idx = base.getIndex()!;
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (hit[a] && hit[b] && hit[c]) keep.push(a, b, c);
  }
  geo.setIndex(keep);
  geo.computeBoundingSphere();
  return geo;
}

export default function StaticFacePaint({ spec, scale = 1 }: { spec: FacePaintSpec; scale?: number }) {
  const lifted = useMemo(() => paintGeometry(), []);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry>(lifted);
  const meshRef = useRef<THREE.Mesh>(null);
  const snapped = useRef(false);
  // The bust loads asynchronously: look for it each frame until it is there.
  useFrame(({ scene }) => {
    if (snapped.current || !meshRef.current) return;
    const bust = scene.getObjectByName(REFERENCE_BUST_NAME);
    if (!bust) return;
    snapped.current = true;
    meshRef.current.updateWorldMatrix(true, false);
    bust.updateWorldMatrix(true, true);
    const key = `${bust.uuid}:${scale}`;
    let g = snapCache.get(key);
    if (!g) {
      g = snapToBust(lifted, meshRef.current, bust);
      snapCache.set(key, g);
    }
    setGeometry(g);
  });
  useEffect(() => { snapped.current = false; }, [scale]);

  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = TEXTURE_PX;
    return c;
  }, []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);

  const key = facePaintKey(spec);
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintFacePaint(ctx, faceFrameFromUvs(STANDARD_FACE_UVS, TEXTURE_PX), spec, { logo: null });
    texture.needsUpdate = true;
    // `spec` is read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, canvas, texture]);

  return (
    <mesh ref={meshRef} geometry={geometry} scale={scale} raycast={() => null} renderOrder={1}>
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={spec.opacity}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-4}
      />
    </mesh>
  );
}
