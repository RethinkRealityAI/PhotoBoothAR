/**
 * R3F canvas overlay for 3D attachment experiences.
 * Uses FaceRig to parent a GLB model OR a built-in procedural head piece at the
 * selected head anchor. `mirror` must match the video feed (true for selfie).
 */
import { Canvas } from '@react-three/fiber';
import { FaceRig, Model } from '../ar/FaceRig';
import { HeadPiece, isHeadPiece } from '../ar/HeadPieces';
import { RIG_CAMERA } from '../../lib/faceRig';
import { AnchorConfig } from '../../types';

interface Props {
  assetUrl?: string | null;
  proceduralId?: string | null;
  anchor: AnchorConfig;
  videoId?: string;
  mirror?: boolean;
  /** Fires when face tracking acquires/loses the face (drives the booth hint). */
  onFaceVisible?: (visible: boolean) => void;
}

export default function Overlay3D({ assetUrl, proceduralId, anchor, videoId = 'booth-video', mirror = true, onFaceVisible }: Props) {
  return (
    <div id="booth-3d-layer" className="absolute inset-0 pointer-events-none z-20">
      <Canvas
        camera={{ position: RIG_CAMERA.position, fov: RIG_CAMERA.fov, near: RIG_CAMERA.near, far: RIG_CAMERA.far }}
        gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
      >
        {/* Lights */}
        <ambientLight intensity={1.2} />
        <directionalLight position={[2, 4, 3]} intensity={1.8} />
        <pointLight position={[-2, 2, 2]} intensity={0.8} color="#E8C766" />

        <FaceRig videoId={videoId} anchor={anchor.anchor} config={anchor} mirror={mirror} onVisibilityChange={onFaceVisible}>
          {isHeadPiece(proceduralId) ? (
            <HeadPiece id={proceduralId as string} />
          ) : assetUrl ? (
            <Model url={assetUrl} />
          ) : null}
        </FaceRig>
      </Canvas>
    </div>
  );
}
