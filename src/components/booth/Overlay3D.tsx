/**
 * R3F canvas overlay for 3D attachment experiences.
 * Uses FaceRig to parent a GLB model OR a built-in procedural head piece at the
 * selected head anchor. `mirror` must match the video feed (true for selfie).
 */
import { useRef, useEffect, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { FaceRig, Model } from '../ar/FaceRig';
import { HeadPiece, isHeadPiece } from '../ar/HeadPieces';
import { RIG_CAMERA } from '../../lib/faceRig';
import { AnchorConfig, LayerAnimation } from '../../types';
import { animate3D } from '../../lib/studio/animation';
import { revealScaleAt } from '../../lib/studio/reveal';

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
  /**
   * Booth's transient "reveal" flag: true for a short window right after the
   * guest applies a NEW db-sourced experience selection. On the RISING EDGE
   * (false->true, or already true on first mount of this piece), every piece
   * plays a one-shot 0.6->1 scale-in spring that composes multiplicatively
   * with its own animate3D preset and settles to EXACTLY 1 — capture parity
   * is unaffected once it settles. Default false -> byte-identical to today
   * for every call site that doesn't pass it.
   */
  reveal?: boolean;
}

/**
 * Wraps a piece's content in its own group and applies its animation preset
 * every frame — the offset composes on top of the parent FaceRig/AssetGizmo
 * group's static anchor transform, so it animates the asset around its own
 * pivot, never the tracked head group itself.
 *
 * When `reveal` is true, ALSO plays a one-shot 0.6->1 scale-in spring on top
 * (multiplicative with the animation preset's own scaleMul). The spring is
 * edge-triggered: it starts once, on the first frame `reveal` is true, and
 * then runs to completion from its own captured start time regardless of
 * whether the `reveal` prop later flips back to false — it self-terminates
 * at scale 1 (see revealScaleAt), it never needs to be told to stop. `reveal`
 * undefined/false forever -> revealStartRef never set -> revealMul is always
 * exactly 1 -> byte-identical to the pre-reveal behavior.
 */
function AnimatedPiece({ animation, reveal, children }: { animation?: LayerAnimation; reveal?: boolean; children: ReactNode }) {
  const ref = useRef<Group>(null);
  const revealStartRef = useRef<number | null>(null);
  const wasRevealRef = useRef(false);

  useEffect(() => {
    if (reveal && !wasRevealRef.current) revealStartRef.current = performance.now();
    wasRevealRef.current = !!reveal;
  }, [reveal]);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const a = animate3D(animation ?? 'none', performance.now() / 1000);
    const start = revealStartRef.current;
    const revealMul = start === null ? 1 : revealScaleAt(performance.now() - start);
    const s = a.scaleMul * revealMul;
    g.position.set(a.position[0], a.position[1], a.position[2]);
    g.rotation.y = a.rotationY;
    g.scale.set(s, s, s);
  });
  return <group ref={ref}>{children}</group>;
}

export default function Overlay3D({ assetUrl, proceduralId, anchor, videoId = 'booth-video', mirror = true, occlude = false, headScale = 1, onFaceVisible, pieces, reveal = false }: Props) {
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
              <AnimatedPiece animation={p.animation} reveal={reveal}>
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
            {/* No `animation` prop on the single-piece path (that field only
                exists on studio `config.layers` pieces above) — this wrapper
                exists solely to carry the reveal scale-in; with reveal=false
                (or undefined) it is the identity transform, so this is
                byte-identical to rendering the children unwrapped. */}
            <AnimatedPiece reveal={reveal}>
              {isHeadPiece(proceduralId) ? (
                <HeadPiece id={proceduralId as string} />
              ) : assetUrl ? (
                <Model url={assetUrl} />
              ) : null}
            </AnimatedPiece>
          </FaceRig>
        )}
      </Canvas>
    </div>
  );
}
