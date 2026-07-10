/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReferenceBust — the visual reference head shown in the studio's 3D orbit view
 * (a stand-in for the guest so anchors/props read in context). It renders the
 * realistic head-bust GLB (vendored to public/models/reference-head.glb via
 * scripts/remote-assets.json), normalized to the tracker's centimetre head
 * space by computeBustFit. GLB-ONLY by user decision (W8): while loading, and
 * if the GLB is missing or fails, it renders NOTHING — the old procedural head
 * used to flash before the GLB swapped in and must never show.
 *
 * The GLB is fetched by runtime URL (NOT a static import) so the build never
 * depends on the asset being present — the file is delivered by CI later.
 */
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
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
        () => resolve(null), // missing/failed → render nothing (never the procedural head)
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
  if (!fitted) return null;
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

  if (scene && !failed) return <GlbBust scene={scene} />;
  // Loading or failed: nothing. Anchor dots still give spatial context, and a
  // brief empty beat beats the wrong head appearing then swapping.
  return null;
}
