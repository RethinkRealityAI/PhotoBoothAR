/**
 * R3F canvas overlay for 3D attachment experiences.
 * Uses FaceRig to parent a GLB model OR a built-in procedural head piece at the
 * selected head anchor. `mirror` must match the video feed (true for selfie).
 */
import { useRef, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { FaceRig, Model } from '../ar/FaceRig';
import { HeadPiece, isHeadPiece } from '../ar/HeadPieces';
import { RIG_CAMERA } from '../../lib/faceRig';
import { AnchorConfig, LayerAnimation } from '../../types';
import { animate3D } from '../../lib/studio/animation';

/** One piece of a multi-object 3D scene (studio `config.layers`). */
export interface Overlay3DPiece {
  assetUrl?: string | null;
  proceduralId?: string | null;
  anchor: AnchorConfig;
  animation?: LayerAnimation;
  /** Per-piece head-occlusion opt-in; only the FIRST piece with occlude===true
   *  actually renders the occluder (never duplicated across pieces). */
  occlude?: boolean;
}

interface Props {
  assetUrl?: string | null;
  proceduralId?: string | null;
  anchor: AnchorConfig;
  videoId?: string;
  mirror?: boolean;
  /** Hide props behind the real head via a depth-only occluder. */
  occlude?: boolean;
  /** Head-size calibration (event studio setting). */
  headScale?: number;
  /** Fires when face tracking acquires/loses the face (drives the booth hint). */
  onFaceVisible?: (visible: boolean) => void;
  /**
   * Multi-object 3D scene (studio `config.layers`). When provided (non-null),
   * renders one FaceRig per piece instead of the single assetUrl/proceduralId/
   * anchor above — the two are mutually exclusive. Undefined/null -> exactly
   * today's single-piece path.
   */
  pieces?: Overlay3DPiece[] | null;
}

/**
 * Wraps a piece's content in its own group and applies its animation preset
 * every frame — the offset composes on top of the parent FaceRig/AssetGizmo
 * group's static anchor transform, so it animates the asset around its own
 * pivot, never the tracked head group itself.
 */
function AnimatedPiece({ animation, children }: { animation?: LayerAnimation; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const a = animate3D(animation ?? 'none', performance.now() / 1000);
    g.position.set(a.position[0], a.position[1], a.position[2]);
    g.rotation.y = a.rotationY;
    g.scale.set(a.scaleMul, a.scaleMul, a.scaleMul);
  });
  return <group ref={ref}>{children}</group>;
}

export default function Overlay3D({ assetUrl, proceduralId, anchor, videoId = 'booth-video', mirror = true, occlude = false, headScale = 1, onFaceVisible, pieces }: Props) {
  // First piece whose occlude===true wins the (single, non-duplicated) occluder.
  const occluderIdx = pieces ? pieces.findIndex((p) => p.occlude === true) : -1;
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

        {pieces ? (
          pieces.map((p, i) => (
            <FaceRig
              key={i}
              videoId={videoId}
              anchor={p.anchor.anchor}
              config={p.anchor}
              mirror={mirror}
              occlude={i === occluderIdx}
              headScale={headScale}
              onVisibilityChange={i === 0 ? onFaceVisible : undefined}
            >
              <AnimatedPiece animation={p.animation}>
                {isHeadPiece(p.proceduralId) ? (
                  <HeadPiece id={p.proceduralId as string} />
                ) : p.assetUrl ? (
                  <Model url={p.assetUrl} />
                ) : null}
              </AnimatedPiece>
            </FaceRig>
          ))
        ) : (
          <FaceRig videoId={videoId} anchor={anchor.anchor} config={anchor} mirror={mirror} occlude={occlude} headScale={headScale} onVisibilityChange={onFaceVisible}>
            {isHeadPiece(proceduralId) ? (
              <HeadPiece id={proceduralId as string} />
            ) : assetUrl ? (
              <Model url={assetUrl} />
            ) : null}
          </FaceRig>
        )}
      </Canvas>
    </div>
  );
}
