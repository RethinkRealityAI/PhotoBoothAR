/**
 * R3F canvas overlay for 3D attachment experiences.
 * Uses FaceRig to parent a GLB model OR a built-in procedural head piece at the
 * selected head anchor. `mirror` must match the video feed (true for selfie).
 */
import { useRef, useEffect, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { FaceRig, Model } from '../ar/FaceRig';
import { HandOccluder, HandRig } from '../ar/HandRig';
import { HeadPiece, isHeadPiece } from '../ar/HeadPieces';
import BeamFX, { FxEmitterPoint, pieceEmitterOf } from '../ar/BeamFX';
import { RIG_CAMERA } from '../../lib/faceRig';
import { AnchorConfig, AssetCustomization, LayerAnimation } from '../../types';
import { animate3D, animatePulse3D, PULSE_3D_MS } from '../../lib/studio/animation';
import type { AnimatePreset } from '../../lib/studio/triggers';
import { revealScaleAt } from '../../lib/studio/reveal';
import SceneLighting from '../ar/SceneLighting';
import type { LightingPresetId } from '../../lib/studio/lighting';
import type { AssetTemplate } from '../../lib/studio/assetTemplate';

/** One piece of a multi-object 3D scene (studio `config.layers`). */
export interface Overlay3DPiece {
  assetUrl?: string | null;
  proceduralId?: string | null;
  anchor: AnchorConfig;
  animation?: LayerAnimation;
  /** Per-piece head-occlusion opt-in; only the FIRST piece with occlude===true
   *  actually renders the occluder (never duplicated across pieces). */
  occlude?: boolean;
  /** Material finish (lib/studio/finish.ts). Absent = the model's own material,
   *  untouched — every legacy and pre-Wave-6 scene renders identically. */
  finish?: string | null;
  tint?: string | null;
  tintStrength?: number | null;
  /**
   * Per-asset personalisation — recoloured template regions + the engraved
   * label, with `label.text` ALREADY RESOLVED to this guest's name
   * (draftMapping.layerToPiece / objectToPiece, the one mapper every surface
   * uses). Absent = nothing customized, which is every legacy scene.
   */
  customization?: AssetCustomization | null;
  /** The asset's configurator descriptor, already validated by the shared
   *  mapper (lib/studio/draftMapping). */
  template?: AssetTemplate | null;
  /**
   * Transient one-shot pulse from an `animate` trigger — `at` is the fire
   * performance.now(). Composes multiplicatively with `animation` and decays
   * to identity within PULSE_3D_MS, so absent/expired = today's render.
   */
  pulse?: { preset: AnimatePreset; at: number } | null;
  /** Hand anchor id (lib/handPose HAND_ANCHORS), already validated by the
   *  shared mapper. Present ⇒ this piece rides a HandRig, not a FaceRig. */
  handAnchor?: string;
  /** fx emitter-registry key (the layer/object id) — a beam whose spec names
   *  it erupts from this piece's authored emitter point. */
  fxKey?: string;
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
  /** Fires when face tracking acquires/loses the face (drives the booth hint).
   *  Only wired when the scene actually has head-anchored pieces. */
  onFaceVisible?: (visible: boolean) => void;
  /** Fires when hand tracking acquires/loses the hand — the hand-only-scene
   *  analogue of onFaceVisible (a wand scene should coach "show your hand",
   *  not "center your face"). Wired to the first hand piece's rig. */
  onHandVisible?: (visible: boolean) => void;
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
  /**
   * Device-pixel-ratio clamp for the R3F drawing buffer (@react-three/fiber
   * v9.6.1: `Dpr = number | [min, max]`).
   *
   * WAVE 4 CLAMPED THIS TO [1, 1.5] AND WAVE 6 PUT IT BACK. The clamp was
   * justified by "it is downsampled into the 720x1280 preview anyway", which is
   * only true of the PREVIEW. `StageCanvas.capturePhoto` composites the same
   * canvas into a 1080x1920 still (StageCanvas.tsx:116-117) with
   * `ctx.drawImage(threeEl, 0, 0, w, h)` (:528) — an UPSCALE. On a 390 CSS-px
   * phone, dpr 1.5 gives a 585px-wide buffer stretched 1.85x into the keepsake,
   * so the clamp bought preview frame-rate by softening the saved photo: the
   * one artefact the guest keeps, and the entire point of the AR layer.
   *
   * [1, 2] is @react-three/fiber's own default, and matches what the three
   * studio canvases already use (Studio3DView.tsx:160/217, DirectorCards.tsx,
   * Text3DBuilder.tsx:268). Honest note: at this value the prop buys no
   * performance anywhere — it exists as a tuning point, and as the hook a
   * future capture-time resolution boost would turn.
   */
  dpr?: number | [number, number];
  /**
   * Which shared lighting rig to use (lib/studio/lighting.ts).
   *
   * DEFAULTS TO 'legacy' — the exact ambient 1.2 / directional 1.8 / warm point
   * 0.8 rig this file hard-coded before Wave 6, with no environment map. Every
   * call site that does not pass this prop (the landing showcase, the demo
   * booth) therefore renders byte-identically to before, and a frozen coded
   * event's saved photos cannot change by accident. Booth passes the event's
   * chosen preset only for `source === 'db'` platform events.
   */
  lightingPreset?: LightingPresetId;
  /**
   * Fires with a piece's asset url the moment that GLB is downloaded, parsed
   * AND cloned into the scene graph — the exact "this is now on screen" signal
   * (see FaceRig's `Model.onReady`). The booth clears that url's pending state
   * on it, so the reveal animation celebrates real geometry.
   */
  onAssetReady?: (url: string) => void;
  /**
   * Fires with a piece's asset url + FaceRig's classified, human-readable
   * message (`describeGlbError`) when that GLB cannot load at all — the booth
   * surfaces it as a hint and clears the orb's pending ring, instead of the
   * selection silently rendering nothing forever. Omitting it is byte-identical
   * to before (Model.onError is optional).
   */
  onAssetError?: (url: string, message: string) => void;
  /**
   * Mount the power-FX layer (BeamFX — beams/blasts fired via fxBus). Off by
   * default: the landing showcase, demo booth and every legacy surface must
   * not pay for shader programs they can never fire. The booth turns it on
   * only when the scene's triggers carry a beam action.
   */
  powerFx?: boolean;
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
function AnimatedPiece({ animation, reveal, pulse, children }: { animation?: LayerAnimation; reveal?: boolean; pulse?: { preset: AnimatePreset; at: number } | null; children: ReactNode }) {
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
    const now = performance.now();
    const a = animate3D(animation ?? 'none', now / 1000);
    const start = revealStartRef.current;
    const revealMul = start === null ? 1 : revealScaleAt(now - start);
    // One-shot `animate` trigger pulse — identity when absent or expired, so
    // this line costs nothing on every scene without triggers.
    const p = pulse != null && now - pulse.at < PULSE_3D_MS ? animatePulse3D(pulse.preset, now - pulse.at) : null;
    const s = a.scaleMul * revealMul * (p !== null ? p.scaleMul : 1);
    g.position.set(
      a.position[0] + (p !== null ? p.position[0] : 0),
      a.position[1] + (p !== null ? p.position[1] : 0),
      a.position[2] + (p !== null ? p.position[2] : 0),
    );
    g.rotation.y = a.rotationY + (p !== null ? p.rotationY : 0);
    g.scale.set(s, s, s);
  });
  return <group ref={ref}>{children}</group>;
}

export default function Overlay3D({ assetUrl, proceduralId, anchor, videoId = 'booth-video', mirror = true, occlude = false, headScale = 1, onFaceVisible, onHandVisible, pieces, reveal = false, dpr = [1, 2], lightingPreset = 'legacy', onAssetReady, onAssetError, powerFx = false }: Props) {
  // Hand-anchored gear renders in a HandRig; everything else keeps the FaceRig
  // path byte-identically (index split preserves keys within each family).
  const headPieces = pieces ? pieces.filter((p) => p.handAnchor === undefined) : null;
  const handPieces = pieces ? pieces.filter((p) => p.handAnchor !== undefined) : null;
  // First piece whose occlude===true wins the (single, non-duplicated) occluder.
  const occluderIdx = headPieces ? headPieces.findIndex((p) => p.occlude === true) : -1;
  return (
    <div id="booth-3d-layer" className="absolute inset-0 pointer-events-none z-20">
      <Canvas
        camera={{ position: RIG_CAMERA.position, fov: RIG_CAMERA.fov, near: RIG_CAMERA.near, far: RIG_CAMERA.far }}
        dpr={dpr}
        gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
      >
        {/* Lights: the shared definition, never values typed here. No contact
            shadow — this canvas is composited over the guest's camera feed,
            where a shadow catcher has no floor and would smear a grey ellipse
            across their face. */}
        <SceneLighting preset={lightingPreset} />

        {powerFx && <BeamFX mirror={mirror} videoId={videoId} />}

        {/* Hand-anchored gear: one HandRig per piece + ONE depth-only hand
            occluder so real fingers wrap in front of a held grip. */}
        {handPieces && handPieces.length > 0 && (
          <>
            <HandOccluder videoId={videoId} mirror={mirror} />
            {handPieces.map((p, i) => {
              const emitter = p.fxKey !== undefined ? pieceEmitterOf(p) : null;
              return (
              <HandRig key={`hand-${i}`} anchor={p.handAnchor as string} videoId={videoId} mirror={mirror} onVisibilityChange={i === 0 ? onHandVisible : undefined}>
                <AnimatedPiece animation={p.animation} reveal={reveal} pulse={p.pulse}>
                  <group scale={p.anchor.scale} rotation={[p.anchor.rotation.x, p.anchor.rotation.y, p.anchor.rotation.z]} position={[p.anchor.offset.x, p.anchor.offset.y, p.anchor.offset.z]}>
                    {isHeadPiece(p.proceduralId) ? (
                      <HeadPiece id={p.proceduralId as string} />
                    ) : p.assetUrl ? (
                      <Model
                        url={p.assetUrl}
                        finish={p.finish}
                        tint={p.tint}
                        tintStrength={p.tintStrength}
                        template={p.template}
                        customization={p.customization}
                        onReady={onAssetReady ? () => onAssetReady(p.assetUrl as string) : undefined}
                        onError={onAssetError ? (m) => onAssetError(p.assetUrl as string, m) : undefined}
                      />
                    ) : null}
                    {emitter !== null && <FxEmitterPoint fxKey={p.fxKey as string} emitter={emitter} />}
                  </group>
                </AnimatedPiece>
              </HandRig>
              );
            })}
          </>
        )}

        {headPieces ? (
          headPieces.map((p, i) => {
            const emitter = p.fxKey !== undefined ? pieceEmitterOf(p) : null;
            return (
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
              <AnimatedPiece animation={p.animation} reveal={reveal} pulse={p.pulse}>
                {isHeadPiece(p.proceduralId) ? (
                  <HeadPiece id={p.proceduralId as string} />
                ) : p.assetUrl ? (
                  <Model
                    url={p.assetUrl}
                    finish={p.finish}
                    tint={p.tint}
                    tintStrength={p.tintStrength}
                    template={p.template}
                    customization={p.customization}
                    onReady={onAssetReady ? () => onAssetReady(p.assetUrl as string) : undefined}
                    onError={onAssetError ? (m) => onAssetError(p.assetUrl as string, m) : undefined}
                  />
                ) : null}
                {emitter !== null && <FxEmitterPoint fxKey={p.fxKey as string} emitter={emitter} />}
              </AnimatedPiece>
            </FaceRig>
            );
          })
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
                <Model
                  url={assetUrl}
                  onReady={onAssetReady ? () => onAssetReady(assetUrl) : undefined}
                  onError={onAssetError ? (m) => onAssetError(assetUrl, m) : undefined}
                />
              ) : null}
            </AnimatedPiece>
          </FaceRig>
        )}
      </Canvas>
    </div>
  );
}
