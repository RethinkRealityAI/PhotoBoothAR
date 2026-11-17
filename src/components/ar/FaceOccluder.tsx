/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FaceOccluder — an invisible head that writes DEPTH only, so 3D props behind
 * the real head (a crown's back band, glasses arms, a halo's far arc) are
 * hidden by the depth test and the camera feed shows through them. It is the
 * MediaPipe canonical face shell (metric centimetres — the exact space
 * faceRig.ts anchors live in) plus a procedural cranium ellipsoid closing the
 * back/top of the skull that the face model omits.
 *
 * LIVE SHELL (`live`): while an 8th Wall engine is the active pose engine the
 * face part is the guest's OWN tracked mesh (478 points, already head-local
 * centimetres — the buffer Living Face Paint draws on), rewritten in place each
 * frame, so the silhouette follows this face's jaw, cheeks and open mouth
 * instead of an average face. It is NOT multiplied by `scale`: the mesh is
 * already this guest's size. The canonical shell stays mounted and takes over
 * the same frame the mesh is missing or stale (MediaPipe mode, a fallback, the
 * first frames) — never a hole in the head. Cranium and hair dome are unchanged.
 *
 * Both meshes: meshBasicMaterial colorWrite={false} (writes depth, no colour),
 * renderOrder={-2} so they populate the depth buffer before any prop draws,
 * and raycast disabled so the studio's PivotControls gizmo stays grabbable.
 *
 * Mount it as a direct child of FaceRig's tracked head group (a sibling of the
 * asset), NOT inside the asset gizmo, so head-scale/placement is independent of
 * the prop's transform.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTrackedFaceMesh, getTrackedFaceMeshTopology } from '../../lib/faceEngine';
import objText from '../../assets/ar/canonical_face_model.obj?raw';
import { parseObj, CRANIUM, HAIR_DOME } from '../../lib/studio/occluder';

const noRaycast = () => null;
/** A mesh sample older than this is a lost face: fall back to the canonical shell. */
const STALE_MESH_MS = 300;

/** Build the canonical face BufferGeometry once (module-level cache). */
let _faceGeo: THREE.BufferGeometry | null = null;
function faceGeometry(): THREE.BufferGeometry {
  if (_faceGeo) return _faceGeo;
  const { positions, indices } = parseObj(objText);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  // No normals: meshBasicMaterial (colour or wireframe) never lights the mesh.
  _faceGeo = geo;
  return geo;
}

export default function FaceOccluder({
  scale = 1,
  debug = false,
  live = false,
  mirror = false,
}: {
  /** Head-size calibration multiplier (studio settings headScale). */
  scale?: number;
  /** Render the occluder faintly visible for tuning (studio ?debug=occluder). */
  debug?: boolean;
  /** Use the live 8th Wall face mesh for the face shell when one is tracked.
   *  Only a TRACKED head group may set this (FaceRig) — never the studio's
   *  orbit mannequin, whose head is not where the camera's face is. */
  live?: boolean;
  /** The head group renders the mirrored pose (faceRig reflects it), so the
   *  live vertices are reflected in x to land on the guest's real face. */
  mirror?: boolean;
}) {
  const geo = useMemo(faceGeometry, []);
  const canonicalRef = useRef<THREE.Mesh>(null);
  const liveRef = useRef<THREE.Mesh>(null);
  const [topology, setTopology] = useState<{ points: number; indices: Uint32Array } | null>(null);
  const liveGeo = useMemo(() => {
    if (!topology) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(topology.points * 3), 3));
    g.setIndex(new THREE.BufferAttribute(topology.indices, 1));
    return g;
  }, [topology]);
  useEffect(() => () => liveGeo?.dispose(), [liveGeo]);

  useFrame(() => {
    if (!live) return;
    if (!topology) {
      const t = getTrackedFaceMeshTopology();
      if (t) setTopology({ points: t.pointsPerDetection, indices: t.indices });
    }
    const mesh = liveGeo ? getTrackedFaceMesh() : null;
    const fresh = mesh !== null && performance.now() - mesh.t <= STALE_MESH_MS;
    if (fresh && liveGeo) {
      const attr = liveGeo.getAttribute('position') as THREE.BufferAttribute;
      const out = attr.array as Float32Array;
      const v = mesh.vertices;
      const n = Math.min(out.length, v.length);
      if (mirror) {
        for (let i = 0; i < n; i += 3) {
          out[i] = -v[i];
          out[i + 1] = v[i + 1];
          out[i + 2] = v[i + 2];
        }
      } else {
        for (let i = 0; i < n; i++) out[i] = v[i];
      }
      attr.needsUpdate = true;
    }
    if (liveRef.current) liveRef.current.visible = fresh;
    if (canonicalRef.current) canonicalRef.current.visible = !fresh;
  });
  const material = useMemo(
    () =>
      debug
        ? new THREE.MeshBasicMaterial({ color: '#5B8CFF', wireframe: true, transparent: true, opacity: 0.35 })
        : new THREE.MeshBasicMaterial({
            colorWrite: false,
            // Bias the occluder's depth AWAY from the camera by a hair. A prop
            // that RESTS on the head (a cap's inner crown against the skull)
            // has surfaces almost coplanar with this shell, and coplanar depth
            // is decided by rounding — which shows up as a speckled, jagged
            // edge eating into the prop rather than a clean silhouette. A
            // positive offset means ties resolve in the PROP's favour, so the
            // failure mode is "occludes a fraction of a millimetre too little"
            // instead of "chews a hole in the brim".
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }),
    [debug],
  );
  // The mirrored live mesh has its winding flipped by the x reflection, so the
  // live shell writes depth from both sides.
  const liveMaterial = useMemo(() => {
    const m = material.clone();
    m.side = THREE.DoubleSide;
    return m;
  }, [material]);

  return (
    <group>
      {live && liveGeo && (
        <mesh
          ref={liveRef}
          geometry={liveGeo}
          material={liveMaterial}
          renderOrder={-2}
          raycast={noRaycast}
          frustumCulled={false}
          visible={false}
        />
      )}
    <group scale={scale}>
      {/* Canonical face shell — covers the front of the head 1:1 with tracking. */}
      <mesh ref={canonicalRef} geometry={geo} material={material} renderOrder={-2} raycast={noRaycast} />
      {/* Cranium — closes the back/top the face model doesn't include. */}
      <mesh
        position={CRANIUM.center}
        scale={CRANIUM.radii}
        material={material}
        renderOrder={-2}
        raycast={noRaycast}
      >
        <sphereGeometry args={[1, 24, 20]} />
      </mesh>
      {/* Hair dome — the cranium is a bald skull capped at ear width; a cap sits
          on HAIR, further out. This second shell is wide up high and inside the
          ear bound at ear level, which one ellipsoid cannot be (occluder.ts). */}
      <mesh
        position={HAIR_DOME.center}
        scale={HAIR_DOME.radii}
        material={material}
        renderOrder={-2}
        raycast={noRaycast}
      >
        <sphereGeometry args={[1, 24, 20]} />
      </mesh>
    </group>
    </group>
  );
}
