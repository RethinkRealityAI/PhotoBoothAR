/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReferenceBust — the visual reference head shown in the studio's 3D orbit view
 * (a stand-in for the guest so anchors/props read in context). It prefers a
 * realistic head-bust GLB (vendored to public/models/reference-head.glb via
 * scripts/remote-assets.json), normalized to the tracker's centimetre head
 * space by computeBustFit, and falls back to the procedural ReferenceHead
 * whenever the GLB is absent or fails to load (offline dev, pre-fetch).
 *
 * The GLB is fetched by runtime URL (NOT a static import) so the build never
 * depends on the asset being present — the file is delivered by CI later.
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import ReferenceHead from '../admin/creator3d/ReferenceHead';
import { computeBustFit } from '../../lib/studio/bustFit';

/** Served from public/; 404s (→ procedural fallback) until CI vendors it. */
const BUST_URL = `${import.meta.env.BASE_URL}models/reference-head.glb`;

/**
 * Scale + centre a raw bust mesh so its crown-to-chin height matches the head
 * space (crown y≈+8.3 to chin y≈−9.4 ⇒ ~17.7cm) and its face centre sits at the
 * origin, matching where anchors are defined.
 */
let _bustPromise: Promise<THREE.Group | null> | null = null;
function loadBust(): Promise<THREE.Group | null> {
  if (!_bustPromise) {
    _bustPromise = new Promise<THREE.Group | null>((resolve) => {
      new GLTFLoader().load(
        BUST_URL,
        (g) => resolve(g.scene),
        undefined,
        () => resolve(null), // missing/failed → procedural fallback
      );
    });
  }
  return _bustPromise;
}

function GlbBust({ scene }: { scene: THREE.Group }) {
  const fitted = useMemo(() => {
    const obj = scene.clone(true);
    const fit = computeBustFit(obj);
    return fit ? { object: obj, ...fit } : null;
  }, [scene]);
  if (!fitted) return <ReferenceHead />;
  return (
    <group scale={fitted.scale} position={fitted.position}>
      <primitive object={fitted.object} />
    </group>
  );
}

export default function ReferenceBust() {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadBust()
      .then((s) => { if (!alive) return; s ? setScene(s) : setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (scene && !failed) {
    return (
      <Suspense fallback={<ReferenceHead />}>
        <GlbBust scene={scene} />
      </Suspense>
    );
  }
  return <ReferenceHead />;
}
