/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReferenceBust — the visual reference head shown in the studio's 3D orbit view
 * (a stand-in for the guest so anchors/props read in context). It renders the
 * realistic head-bust GLB (vendored to public/models/reference-head.glb via
 * scripts/remote-assets.json), aligned to the tracker's centimetre head space by
 * computeAnchorAlignedFit so every attachment point stays clear of the mesh
 * (computeBustFit stays as the fallback). GLB-ONLY by user decision (W8): while loading, and
 * if the GLB is missing or fails, it renders NOTHING — the old procedural head
 * used to flash before the GLB swapped in and must never show.
 *
 * The GLB is fetched by runtime URL (NOT a static import) so the build never
 * depends on the asset being present — the file is delivered by CI later.
 */
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { computeBustFit, computeAnchorAlignedFit, collectWorldPositions } from '../../lib/studio/bustFit';
import { ANCHOR_PRESETS } from '../../lib/faceRig';

/** Served from public/; 404s (→ procedural fallback) until CI vendors it. */
const BUST_URL = `${import.meta.env.BASE_URL}models/reference-head.glb`;

/** Anchor offsets the bust is aligned against (cm) — the calibration target. */
const ANCHOR_OFFSETS = ANCHOR_PRESETS.map((a) => a.offset);

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
        () => {
          // Missing/failed → render nothing (never the procedural head). Drop
          // the cached promise so the NEXT mount retries — a transient miss
          // (CI vendors the GLB mid-session) must not blank the head until a
          // full page reload (audit M-A13). Successful loads stay cached.
          _bustPromise = null;
          resolve(null);
        },
      );
    });
  }
  return _bustPromise;
}

function GlbBust({ scene, onFit }: { scene: THREE.Group; onFit?: (b: BustBounds) => void }) {
  const fitted = useMemo(() => {
    const obj = scene.clone(true);
    // Align the mesh to the ANCHOR CLOUD rather than stretching its bounding box
    // to head height. The anchors are the calibration (they were measured
    // against MediaPipe's canonical face), so a fit that keeps every anchor just
    // clear of the surface is a reference head that agrees with what the tracker
    // will do to a real guest — and, crucially, one whose attachment points are
    // not swallowed. Measured on the vendored bust: the old whole-bbox fit x2
    // buried all 12 anchors 2.9–8.8cm deep; this puts 12 of 12 outside.
    const points = collectWorldPositions(obj);
    const aligned = computeAnchorAlignedFit(points, ANCHOR_OFFSETS);
    // Degrade, never fail: an unmeasurable mesh keeps the legacy bbox fit.
    const fit = aligned ?? computeBustFit(obj);
    if (!fit) return null;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < points.length; i += 3) {
      const y = points[i] * fit.scale + fit.position[1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { object: obj, ...fit, minY, maxY };
  }, [scene]);

  useEffect(() => {
    if (fitted && Number.isFinite(fitted.minY)) onFit?.({ minY: fitted.minY, maxY: fitted.maxY });
  }, [fitted, onFit]);

  if (!fitted) return null;
  return (
    <group scale={fitted.scale} position={fitted.position}>
      <primitive object={fitted.object} />
    </group>
  );
}

/** Vertical extent of the fitted bust in head space (cm) — lets the orbit view
 *  frame whatever bust is actually vendored instead of a hard-coded guess. */
export interface BustBounds {
  minY: number;
  maxY: number;
}

export default function ReferenceBust({ onFit }: { onFit?: (b: BustBounds) => void } = {}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadBust()
      .then((s) => { if (!alive) return; s ? setScene(s) : setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (scene && !failed) return <GlbBust scene={scene} onFit={onFit} />;
  // Loading or failed: nothing. Anchor dots still give spatial context, and a
  // brief empty beat beats the wrong head appearing then swapping.
  return null;
}
