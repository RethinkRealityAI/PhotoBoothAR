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
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ANCHOR_MAP, RIG_CAMERA } from '../../lib/faceRig';
import { FaceRig, Model } from '../ar/FaceRig';
import AssetGizmo from '../ar/AssetGizmo';
import { HeadPiece, isHeadPiece } from '../ar/HeadPieces';
import FaceOccluder from '../ar/FaceOccluder';
import ReferenceBust from '../ar/ReferenceBust';
import AnchorDots from '../admin/creator3d/AnchorDots';
import type { AnchorConfig, HeadAnchor } from '../../types';

interface Props {
  view: 'live' | 'orbit';
  videoId: string;
  assetUrl: string | null;
  proceduralId: string | null;
  anchor: HeadAnchor;
  anchorConfig: Partial<AnchorConfig>;
  paused: boolean;
  headScale: number;
  debugOcclusion?: boolean;
  onAnchorSelect: (a: HeadAnchor) => void;
  onTransformChange: (patch: Partial<AnchorConfig>) => void;
  onFaceVisible?: (v: boolean) => void;
  onGizmoDragStart?: () => void;
  onGizmoDragEnd?: () => void;
}

function AssetContent({ assetUrl, proceduralId }: { assetUrl: string | null; proceduralId: string | null }) {
  if (isHeadPiece(proceduralId)) return <HeadPiece id={proceduralId as string} />;
  if (assetUrl) return <Model url={assetUrl} />;
  return null;
}

export default function Studio3DView({
  view,
  videoId,
  assetUrl,
  proceduralId,
  anchor,
  anchorConfig,
  paused,
  headScale,
  debugOcclusion = false,
  onAnchorSelect,
  onTransformChange,
  onFaceVisible,
  onGizmoDragStart,
  onGizmoDragEnd,
}: Props) {
  const hasAsset = !!assetUrl || isHeadPiece(proceduralId);
  const base = ANCHOR_MAP[anchor]?.offset ?? ([0, 0, 0] as [number, number, number]);

  if (view === 'orbit') {
    return (
      <Canvas
        camera={{ position: [0, 1.5, 32], fov: 42, near: 0.1, far: 2000 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#05060B']} />
        <fog attach="fog" args={['#05060B', 70, 170]} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} target={[0, -0.5, 2]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 14, 12]} intensity={1.3} color="#EAF1FF" />
        <directionalLight position={[-9, 5, -7]} intensity={0.4} color="#5B8CFF" />

        <ReferenceBust />
        {/* Occluder shown faintly in orbit only when debugging placement. */}
        {debugOcclusion && <FaceOccluder scale={headScale} debug />}
        <AnchorDots activeAnchor={anchor} onSelect={onAnchorSelect} />

        {hasAsset && (
          <AssetGizmo base={base} config={anchorConfig} enabled onChange={onTransformChange}>
            <AssetContent assetUrl={assetUrl} proceduralId={proceduralId} />
          </AssetGizmo>
        )}
      </Canvas>
    );
  }

  // live — transparent overlay on the shared video (rendered by StudioStage)
  return (
    <Canvas
      id="studio-3d-live"
      camera={{ position: RIG_CAMERA.position, fov: RIG_CAMERA.fov, near: RIG_CAMERA.near, far: RIG_CAMERA.far }}
      gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 8]} intensity={1.4} color="#EAF1FF" />
      <directionalLight position={[-4, 2, -4]} intensity={0.3} color="#5B8CFF" />

      <FaceRig
        videoId={videoId}
        anchor={anchor}
        config={anchorConfig}
        paused={paused}
        mirror
        occlude={hasAsset}
        headScale={headScale}
        debugOcclusion={debugOcclusion}
        editable={hasAsset}
        onVisibilityChange={onFaceVisible}
        onTransformChange={onTransformChange}
        onGizmoDragStart={onGizmoDragStart}
        onGizmoDragEnd={onGizmoDragEnd}
      >
        {hasAsset ? (
          <AssetContent assetUrl={assetUrl} proceduralId={proceduralId} />
        ) : (
          <mesh>
            <sphereGeometry args={[0.8, 16, 14]} />
            <meshStandardMaterial color="#5B8CFF" emissive="#5B8CFF" emissiveIntensity={1.1} metalness={0.6} roughness={0.25} toneMapped={false} />
          </mesh>
        )}
      </FaceRig>
    </Canvas>
  );
}
