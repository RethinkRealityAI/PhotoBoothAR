/**
 * Model mode canvas: R3F scene with a proportioned reference head, anchor dots,
 * the user's asset at the chosen anchor, and an ALL-IN-ONE PivotControls gizmo
 * (translate + rotate + scale at once) plus OrbitControls to inspect.
 *
 * The gizmo lives in AssetGizmo (shared with the live editor) so placement is
 * identical to what guests see. Drei auto-pauses OrbitControls while dragging.
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ANCHOR_MAP } from '../../../lib/faceRig';
import { Model } from '../../ar/FaceRig';
import AssetGizmo from '../../ar/AssetGizmo';
import { HeadPiece, isHeadPiece } from '../../ar/HeadPieces';
import { AnchorConfig, HeadAnchor } from '../../../types';
import ReferenceHead from './ReferenceHead';
import AnchorDots from './AnchorDots';

interface Props {
  assetUrl: string | null;
  proceduralId?: string | null;
  anchor: HeadAnchor;
  anchorConfig: Partial<AnchorConfig>;
  onAnchorSelect: (a: HeadAnchor) => void;
  onTransformChange: (patch: Partial<AnchorConfig>) => void;
}

export default function ModelCanvas({
  assetUrl,
  proceduralId,
  anchor,
  anchorConfig,
  onAnchorSelect,
  onTransformChange,
}: Props) {
  const base = ANCHOR_MAP[anchor]?.offset ?? ([0, 0, 0] as [number, number, number]);
  const hasAsset = !!assetUrl || isHeadPiece(proceduralId);

  return (
    <Canvas
      camera={{ position: [0, 1.5, 32], fov: 42, near: 0.1, far: 2000 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* canvas background */}
      <color attach="background" args={['#0D0D0D']} />
      <fog attach="fog" args={['#0D0D0D', 70, 160]} />

      {/* makeDefault lets Drei's PivotControls auto-pause OrbitControls */}
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} target={[0, -0.5, 2]} />

      {/* reference head + anchor selection dots */}
      <ReferenceHead />
      <AnchorDots activeAnchor={anchor} onSelect={onAnchorSelect} />

      {/* asset at anchor with all-in-one gizmo */}
      {hasAsset && (
        <AssetGizmo base={base} config={anchorConfig} enabled onChange={onTransformChange}>
          {isHeadPiece(proceduralId) ? (
            <HeadPiece id={proceduralId as string} />
          ) : assetUrl ? (
            <Model url={assetUrl} />
          ) : null}
        </AssetGizmo>
      )}
    </Canvas>
  );
}
