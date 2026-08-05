/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReferenceHand — the orbit editor's hand mannequin, the analogue of
 * ReferenceBust for hand-anchored gear. It renders a vendored hand GLB
 * (public/models/reference-hand-{open,fist}.glb), fetched by RUNTIME URL like
 * the bust so the build never depends on the asset being present, in the bust's
 * neutral matte so the two mannequins read as one set.
 *
 * TWO POSES, because a grip is not a placement: a wand runs THROUGH a closed
 * fist and reads as floating beside a flat palm, while a gauntlet or a palm
 * emitter only reads on the open hand. `pose` picks; the mount points and the
 * size come from the mesh either way.
 *
 * SIZE IS MEASURED, NOT AUTHORED (lib/studio/handRefAnchors): the mannequin is
 * scaled so its own wrist->middle-knuckle and index->pinky knuckle spans match
 * the metric hand the tracker actually solves for. The old primitive hand was
 * ~0.75x that, which is the same defect the reference HEAD had — a prop tuned
 * against a small mannequin arrives on a real hand a third too big. A constant
 * would rot the next time CI re-vendors these files; a measurement does not.
 *
 * GLB-ONLY, by the bust's rule (W8): while loading, and if the asset is missing,
 * fails, or cannot be measured, this renders NOTHING. A hand at the wrong size
 * or facing the wrong way is worse feedback than no hand.
 */
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { collectWorldPositions } from '../../lib/studio/bustFit';
import { mirrorGeometryX } from '../../lib/studio/mirrorGeometry';
import type { ModelledHand } from '../../lib/studio/handedness';
import {
  handRefAnchors,
  measureHandMannequin,
  mirrorHandLandmarks,
  type Vec3,
} from '../../lib/studio/handRefAnchors';

/** Matches ReferenceBust's neutral matte so the two mannequins read as a set.
 *  The vendored hands ship with no glTF material at all, so without this they
 *  would render in three's default white and upstage the gear. */
const SKIN = new THREE.MeshStandardMaterial({ color: '#8a8f9d', metalness: 0.05, roughness: 0.85 });

export type HandRefPose = 'open' | 'fist';

/** Served from public/; both are runtime URLs, never static imports. */
const HAND_URLS: Record<HandRefPose, string> = {
  open: `${import.meta.env.BASE_URL}models/reference-hand-open.glb`,
  fist: `${import.meta.env.BASE_URL}models/reference-hand-fist.glb`,
};

/** What the orbit view needs back: how to frame this hand, and where gear
 *  mounts on it (hand-frame cm, i.e. the group's own coordinates). */
export interface HandRefFit {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  anchors: Record<string, Vec3>;
}

const scenes: Partial<Record<HandRefPose, Promise<THREE.Group | null>>> = {};
function loadHand(pose: HandRefPose): Promise<THREE.Group | null> {
  const cached = scenes[pose];
  if (cached) return cached;
  const p = new Promise<THREE.Group | null>((resolve) => {
    new GLTFLoader().load(
      HAND_URLS[pose],
      (g) => resolve(g.scene),
      undefined,
      () => {
        // Same policy as the bust: drop the cached promise so the NEXT mount
        // retries (CI can vendor the GLB mid-session), and resolve null rather
        // than throwing — a missing mannequin must not blank the orbit view.
        scenes[pose] = undefined;
        resolve(null);
      },
    );
  });
  scenes[pose] = p;
  return p;
}

function FittedHand({ scene, hand, onFit }: {
  scene: THREE.Group;
  hand: ModelledHand;
  onFit?: (f: HandRefFit) => void;
}) {
  // Geometries this memo allocated, freed when it re-runs or the view unmounts.
  // Only the mirrored path creates any; the right-handed path renders the
  // cache's own geometry and must never dispose it.
  const owned = useMemo<THREE.BufferGeometry[]>(() => [], [scene, hand]);
  useEffect(() => () => { for (const g of owned) g.dispose(); }, [owned]);

  const fitted = useMemo(() => {
    const object = scene.clone(true);
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = SKIN;
    });
    // All of it: the measurement reads cross-sections a few percent of the mesh
    // deep, so a decimated sample thins the very slabs it clusters.
    const points = collectWorldPositions(object, 40000);
    const fit = measureHandMannequin(points);
    if (fit === null) return null;

    // mesh -> hand frame: rows are (right, up, normal). makeBasis builds the
    // COLUMNS, i.e. hand -> mesh, so invert. right = up x normal makes that a
    // proper rotation (det +1) — a mirrored basis would flip the mesh winding.
    const m = new THREE.Matrix4()
      .makeBasis(
        new THREE.Vector3(...fit.right),
        new THREE.Vector3(...fit.up),
        new THREE.Vector3(...fit.normal),
      )
      .invert();
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
    // three applies T * R * S, so the offset that lands the wrist on the origin
    // is -scale * (R . origin).
    const o = new THREE.Vector3(...fit.origin).applyMatrix4(m).multiplyScalar(-fit.scale);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i + 2 < points.length; i += 3) {
      v.set(points[i], points[i + 1], points[i + 2]).applyMatrix4(m).multiplyScalar(fit.scale).add(o);
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }

    // OTHER HAND: both vendored mannequins are RIGHT hands, and a left-handed
    // asset fitted against a right hand is the mismatch this exists to remove.
    // A human left hand IS the mirrored right hand, so this is exact.
    //
    // The measurement above runs on the UNMIRRORED mesh deliberately. The fit
    // derives the palm normal's sign from which side the thumb lobe sits on and
    // then takes right = up × normal — a cross product, which under a reflection
    // NEGATES rather than mirrors. Measuring a mirrored mesh would therefore
    // hand back a frame whose across-axis points the wrong way, and the finger
    // ordering (index side vs pinky side) would silently invert. Measuring the
    // known-good right hand and mirroring afterwards cannot hit that.
    if (hand === 'left') {
      // Bake the fit transform into the geometry so the mesh's own local space
      // IS the hand frame — only then is a YZ-plane mirror the same thing as a
      // mirror across the hand's across-axis.
      const bake = new THREE.Matrix4().compose(o, quaternion, new THREE.Vector3(fit.scale, fit.scale, fit.scale));
      object.updateMatrixWorld(true);
      const baked = new THREE.Matrix4();
      object.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        baked.copy(bake).multiply(mesh.matrixWorld);
        // clone(): the loader's geometry is shared with the module cache and
        // with the right-handed instance — baking into it would corrupt both.
        //
        // Both of these are OURS to free. mirrorGeometryX caches on its source,
        // and the source here is a fresh clone every run, so the cache can never
        // hit and each evaluation allocates two geometries — which is fine only
        // because the effect below disposes them. Left un-freed, every click of
        // the Fits chip leaked two copies of the mannequin's VRAM.
        const transient = mesh.geometry.clone().applyMatrix4(baked);
        const mirrored = mirrorGeometryX(transient);
        transient.dispose();
        owned.push(mirrored);
        mesh.geometry = mirrored;
      });
      // The transform now lives in the vertices, so the node transforms must go.
      object.traverse((n) => {
        n.position.set(0, 0, 0);
        n.quaternion.identity();
        n.scale.set(1, 1, 1);
      });
      return {
        object,
        quaternion: new THREE.Quaternion(),
        position: [0, 0, 0] as Vec3,
        scale: 1,
        bounds: {
          // x mirrors with the mesh; y is untouched by a YZ reflection.
          minX: -maxX, maxX: -minX, minY, maxY,
          anchors: handRefAnchors(mirrorHandLandmarks(fit.landmarks)),
        } satisfies HandRefFit,
      };
    }

    return {
      object,
      quaternion,
      position: [o.x, o.y, o.z] as Vec3,
      scale: fit.scale,
      bounds: { minX, maxX, minY, maxY, anchors: handRefAnchors(fit.landmarks) } satisfies HandRefFit,
    };
  }, [scene, hand]);

  useEffect(() => {
    if (fitted && Number.isFinite(fitted.bounds.minY)) onFit?.(fitted.bounds);
  }, [fitted, onFit]);

  if (!fitted) return null;
  return (
    <group position={fitted.position} quaternion={fitted.quaternion} scale={fitted.scale}>
      <primitive object={fitted.object} />
    </group>
  );
}

export default function ReferenceHand({
  pose = 'open',
  hand = 'right',
  onFit,
}: {
  pose?: HandRefPose;
  /** Which hand to show. Both vendored GLBs are RIGHT hands; 'left' mirrors
   *  them, which is exact — the two hands are mirror images of each other. */
  hand?: ModelledHand;
  onFit?: (f: HandRefFit) => void;
} = {}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let alive = true;
    setScene(null);
    loadHand(pose)
      .then((s) => { if (alive) setScene(s); })
      .catch(() => { if (alive) setScene(null); });
    return () => { alive = false; };
  }, [pose]);

  if (scene === null) return null;
  return <FittedHand scene={scene} hand={hand} onFit={onFit} />;
}
