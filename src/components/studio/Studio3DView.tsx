/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Studio 3D view — one component, two sub-views that share the studio's single
 * camera and the shared FaceRig/AssetGizmo (so placement is true WYSIWYG):
 *   • orbit — a reference head/bust + clickable anchor dots + an all-in-one
 *     gizmo, inspected with OrbitControls. No camera feed.
 *   • live  — the tracked face (reads the persistent <video id="studio-video">
 *     rendered behind this transparent canvas by StudioStage) with the same
 *     gizmo and the depth occluder enabled.
 *
 * Replaces the deleted creator3d ModelCanvas + LiveCanvas; the live sub-view no
 * longer opens its own getUserMedia — the shell owns the one stream.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type * as THREE from 'three';
import { initializeFaceLandmarker, isFaceLandmarkerReady } from '../../lib/faceTracking';
import { ANCHOR_MAP, RIG_CAMERA } from '../../lib/faceRig';
import { FaceRig, Model } from '../ar/FaceRig';
import AssetGizmo from '../ar/AssetGizmo';
import { HeadPiece, isHeadPiece } from '../ar/HeadPieces';
import FaceOccluder from '../ar/FaceOccluder';
import ReferenceBust, { type BustBounds } from '../ar/ReferenceBust';
import AnchorDots from '../admin/creator3d/AnchorDots';
import type { AnchorConfig, HeadAnchor } from '../../types';
import type { Object3D } from '../../lib/studio/state';

interface Props {
  view: 'live' | 'orbit';
  videoId: string;
  /** Every 3D object in the scene (ordered). */
  objects: Object3D[];
  selectedId: string | null;
  paused: boolean;
  headScale: number;
  /** Master occlusion gate (booth source === 'db'); per-object opt-in on top. */
  occlusionEnabled?: boolean;
  debugOcclusion?: boolean;
  matrixRef?: React.MutableRefObject<number[] | null>;
  onSelect: (id: string) => void;
  onAnchorSelect: (a: HeadAnchor) => void;
  onTransformChange: (patch: Partial<AnchorConfig>) => void;
  onFaceVisible?: (v: boolean) => void;
  onGizmoDragStart?: () => void;
  onGizmoDragEnd?: () => void;
}

/** Extra head space kept above the crown so tall pieces (top hats, halos,
 *  crowns) stay in frame. */
const CROWN_HEADROOM_CM = 9;
/** How much of the bust below the crown to keep in shot — a head plus a little
 *  neck. The vendored bust continues well past that into a plinth nobody is
 *  placing anything on. */
const HEAD_FRAME_CM = 22;
/** Breathing room around the framed extent. */
const FRAME_PADDING = 1.12;

/**
 * Frames the orbit camera on the bust that actually loaded. The camera used to
 * be a constant tuned for a bust rendered at 2x life size; now that the bust is
 * fitted to the anchor space, the right distance depends on the asset, so it is
 * derived instead of guessed.
 */
function FrameBust({ bounds }: { bounds: BustBounds | null }) {
  const camera = useThree((s) => s.camera);
  // R3F types `state.controls` as a bare EventDispatcher; OrbitControls
  // (makeDefault) is what actually lands there, so narrow by shape at runtime.
  const controls = useThree((s) => s.controls) as unknown as
    | { target?: THREE.Vector3; update?: () => void }
    | null;
  useEffect(() => {
    if (!bounds || !Number.isFinite(bounds.maxY) || !Number.isFinite(bounds.minY)) return;
    const top = bounds.maxY + CROWN_HEADROOM_CM;
    const bottom = Math.max(bounds.minY, bounds.maxY - HEAD_FRAME_CM);
    const height = Math.max(1, top - bottom);
    const centre = (top + bottom) / 2;
    const fov = ((camera as THREE.PerspectiveCamera).fov ?? 42) * (Math.PI / 180);
    const dist = (height / 2 / Math.tan(fov / 2)) * FRAME_PADDING;
    camera.position.set(0, centre + dist * 0.05, dist);
    camera.lookAt(0, centre, 0);
    camera.updateProjectionMatrix();
    if (controls?.target && controls.update) {
      controls.target.set(0, centre, 0);
      controls.update();
    }
  }, [bounds, camera, controls]);
  return null;
}

function ObjectContent({ object }: { object: Object3D }) {
  if (object.type === 'headpiece' && isHeadPiece(object.proceduralId)) return <HeadPiece id={object.proceduralId as string} />;
  if (object.assetUrl) return <Model url={object.assetUrl} />;
  return null;
}

export default function Studio3DView({
  view,
  videoId,
  objects,
  selectedId,
  paused,
  headScale,
  occlusionEnabled = false,
  debugOcclusion = false,
  matrixRef,
  onSelect,
  onAnchorSelect,
  onTransformChange,
  onFaceVisible,
  onGizmoDragStart,
  onGizmoDragEnd,
}: Props) {
  const [bustBounds, setBustBounds] = useState<BustBounds | null>(null);
  // Stable identity: ReferenceBust reports its fit from an effect, so an inline
  // callback would re-run it on every render of this view.
  const handleBustFit = useCallback((b: BustBounds) => {
    setBustBounds((prev) => (prev && prev.minY === b.minY && prev.maxY === b.maxY ? prev : b));
  }, []);
  const selected = objects.find((o) => o.id === selectedId) ?? null;
  // AnchorDots highlight the SELECTED object's anchor (or crown when none).
  const activeAnchor: HeadAnchor = selected?.anchor ?? 'crown';
  // First object opting into occlusion wins the single (non-duplicated) occluder.
  const occluderIdx = occlusionEnabled ? objects.findIndex((o) => o.occlusion === true) : -1;

  // Clicking a non-selected piece's mesh selects it (PivotControls on the
  // selected piece may swallow its own events — acceptable; the layers panel is
  // always available as a fallback).
  const selectHandler = (o: Object3D) => (e: ThreeEvent<MouseEvent>) => {
    if (o.id === selectedId) return;
    e.stopPropagation();
    onSelect(o.id);
  };

  if (view === 'orbit') {
    return (
      <Canvas
        // Pulled back + aimed lower than a tight head-shot: crown-anchored
        // content (Royal Crown, halos) extends WELL above the bust, and the
        // floating mode pills occupy the stage's top band — this framing keeps
        // tall pieces fully visible below the chrome.
        camera={{ position: [0, 2.5, 46], fov: 42, near: 0.1, far: 2000 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        style={{ width: '100%', height: '100%' }}
      >
        {/* In-canvas Suspense: an async 3D child (font/asset fetch) must never
            suspend past the Canvas to the route boundary — that hides the app. */}
        <Suspense fallback={null}>
        <color attach="background" args={['#05060B']} />
        <fog attach="fog" args={['#05060B', 70, 170]} />
        {/* Target + distance are derived from the fitted bust by FrameBust. */}
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
        <FrameBust bounds={bustBounds} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 14, 12]} intensity={1.3} color="#EAF1FF" />
        <directionalLight position={[-9, 5, -7]} intensity={0.4} color="#5B8CFF" />

        <ReferenceBust onFit={handleBustFit} />
        {/* Occluder shown faintly in orbit only when debugging placement. */}
        {debugOcclusion && <FaceOccluder scale={headScale} debug />}
        <AnchorDots activeAnchor={activeAnchor} onSelect={onAnchorSelect} />

        {objects.map((o) => {
          const isSel = o.id === selectedId;
          const base = ANCHOR_MAP[o.anchor]?.offset ?? ([0, 0, 0] as [number, number, number]);
          return (
            <group key={o.id} onClick={selectHandler(o)}>
              <AssetGizmo
                base={base}
                config={o.anchorConfig}
                enabled={isSel}
                onChange={isSel ? onTransformChange : undefined}
                onDragStart={onGizmoDragStart}
                onDragEnd={onGizmoDragEnd}
              >
                <ObjectContent object={o} />
              </AssetGizmo>
            </group>
          );
        })}
        </Suspense>
      </Canvas>
    );
  }

  // live — transparent overlay on the shared video (rendered by StudioStage)
  return (
    <>
    <TrackerLoadingPill />
    <Canvas
      id="studio-3d-live"
      camera={{ position: RIG_CAMERA.position, fov: RIG_CAMERA.fov, near: RIG_CAMERA.near, far: RIG_CAMERA.far }}
      gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      {/* Same containment for the live view (see orbit note above). */}
      <Suspense fallback={null}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 8]} intensity={1.4} color="#EAF1FF" />
      <directionalLight position={[-4, 2, -4]} intensity={0.3} color="#5B8CFF" />

      {objects.length === 0 ? (
        // Empty 3D scene: a placeholder marker on the head so tracking feedback
        // (onFaceVisible) still fires and the head is visible to place onto.
        <FaceRig videoId={videoId} anchor="crown" config={{}} paused={paused} mirror headScale={headScale} matrixRef={matrixRef} onVisibilityChange={onFaceVisible}>
          <mesh>
            <sphereGeometry args={[0.8, 16, 14]} />
            <meshStandardMaterial color="#5B8CFF" emissive="#5B8CFF" emissiveIntensity={1.1} metalness={0.6} roughness={0.25} toneMapped={false} />
          </mesh>
        </FaceRig>
      ) : (
        objects.map((o, i) => {
          const isSel = o.id === selectedId;
          return (
            <group key={o.id} onClick={selectHandler(o)}>
              <FaceRig
                videoId={videoId}
                anchor={o.anchor}
                config={o.anchorConfig}
                paused={paused}
                mirror
                occlude={i === occluderIdx}
                headScale={headScale}
                debugOcclusion={debugOcclusion}
                matrixRef={i === 0 ? matrixRef : undefined}
                editable={isSel}
                onVisibilityChange={i === 0 ? onFaceVisible : undefined}
                onTransformChange={isSel ? onTransformChange : undefined}
                onGizmoDragStart={onGizmoDragStart}
                onGizmoDragEnd={onGizmoDragEnd}
              >
                <ObjectContent object={o} />
              </FaceRig>
            </group>
          );
        })
      )}
      </Suspense>
    </Canvas>
    </>
  );
}

/**
 * "Loading face tracker…" pill shown over the live view until the MediaPipe
 * landmarker finishes initializing (FaceRig kicks the init; this just reports
 * readiness so the host isn't staring at a feed that silently isn't tracking).
 */
function TrackerLoadingPill() {
  const [ready, setReady] = useState(isFaceLandmarkerReady());
  useEffect(() => {
    if (ready) return;
    let alive = true;
    initializeFaceLandmarker()
      .then(() => { if (alive) setReady(true); })
      .catch(() => { /* FaceRig already logged; keep the pill up as a signal */ });
    return () => { alive = false; };
  }, [ready]);
  if (ready) return null;
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
      <div className="liquid-glass rounded-full px-4 py-2 flex items-center gap-2">
        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-[color:var(--color-accent)] animate-spin" />
        <span className="font-label text-[9px] uppercase tracking-widest text-brand-muted">Loading face tracker…</span>
      </div>
    </div>
  );
}
