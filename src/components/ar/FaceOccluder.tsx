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
 * Both meshes: meshBasicMaterial colorWrite={false} (writes depth, no colour),
 * renderOrder={-2} so they populate the depth buffer before any prop draws,
 * and raycast disabled so the studio's PivotControls gizmo stays grabbable.
 *
 * Mount it as a direct child of FaceRig's tracked head group (a sibling of the
 * asset), NOT inside the asset gizmo, so head-scale/placement is independent of
 * the prop's transform.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import objText from '../../assets/ar/canonical_face_model.obj?raw';
import { parseObj, CRANIUM } from '../../lib/studio/occluder';

const noRaycast = () => null;

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
}: {
  /** Head-size calibration multiplier (studio settings headScale). */
  scale?: number;
  /** Render the occluder faintly visible for tuning (studio ?debug=occluder). */
  debug?: boolean;
}) {
  const geo = useMemo(faceGeometry, []);
  const material = useMemo(
    () =>
      debug
        ? new THREE.MeshBasicMaterial({ color: '#5B8CFF', wireframe: true, transparent: true, opacity: 0.35 })
        : new THREE.MeshBasicMaterial({ colorWrite: false }),
    [debug],
  );

  return (
    <group scale={scale}>
      {/* Canonical face shell — covers the front of the head 1:1 with tracking. */}
      <mesh geometry={geo} material={material} renderOrder={-2} raycast={noRaycast} />
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
    </group>
  );
}
