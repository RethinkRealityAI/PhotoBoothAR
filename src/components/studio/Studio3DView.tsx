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
import { Suspense, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { initializeFaceLandmarker, isFaceLandmarkerReady } from '../../lib/faceTracking';
import { ANCHOR_MAP, RIG_CAMERA } from '../../lib/faceRig';
import { FaceRig, Model } from '../ar/FaceRig';
import AssetGizmo from '../ar/AssetGizmo';
import { HeadPiece, isHeadPiece } from '../ar/HeadPieces';
import FaceOccluder from '../ar/FaceOccluder';
import ReferenceBust from '../ar/ReferenceBust';
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
        {/* Target slightly below head centre → the head sits low in frame,
            leaving headroom above the crown for tall pieces + the pills. */}
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} target={[0, -3, 2]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 14, 12]} intensity={1.3} color="#EAF1FF" />
        <directionalLight position={[-9, 5, -7]} intensity={0.4} color="#5B8CFF" />

        <ReferenceBust />
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
