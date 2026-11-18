/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamySelfie — Beamy pops on his heart shades, holds up a phone, gives it a
 * cheeky look, snaps a selfie (flash), and beams the photo up above him.
 *
 * Self-contained and reusable anywhere: a small transparent R3F canvas sized
 * by its container, plus three DOM overlays (flash, light column, photo card)
 * driven every frame from the PURE timeline in lib/beamySelfie.ts, so a cue
 * can never drift from the authored `Selfie` clip in /mascot/beamy.glb.
 *
 * Trigger it with a changing `playKey`, the imperative `play()` on a ref, or a
 * tap (`playOnClick`, default on). The photo is `photoUrl`, or by default a
 * snapshot of this canvas taken at the snap frame (Beamy's own selfie).
 *
 * Pointer events: everything is `pointer-events: none` (the R3F wrapper sets
 * `auto`, so it is overridden on the Canvas style itself) except the optional
 * tap button, so the widget never blocks its neighbours.
 *
 * Reduced motion: the clip still plays (Beamy's moves ARE the content, the
 * same call BeamyStage makes), but the flash is a slow dim fade instead of a
 * strobe and the photo fades in beside him instead of flying up a beam.
 *
 * Lazy-load it: `const BeamySelfie = lazy(() => import('…/beamy/BeamySelfie'))`.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { gltfLoader } from '../../lib/glbCache';
import { SELFIE_CLIP, beamOpacity, flashOpacity, photoState, selfieTimeline, type SelfieTimeline } from '../../lib/beamySelfie';

const MODEL_URL = '/mascot/beamy.glb';
const PERIWINKLE = '142,150,255';
const AMBER = '255,197,107';
const CROSSFADE_S = 0.22;
/** World-space framing: Beamy stands at y=0, 0.6 tall; space above for the photo flight. */
const FRAME = { centerY: 0.62, halfH: 0.7, halfW: 0.52, fovDeg: 30 };

export interface BeamySelfieHandle {
  /** Play the selfie once (restarts it if already playing). */
  play(): void;
}

export interface BeamySelfieProps {
  /** Change this value to play the selfie (the initial value does not play). */
  playKey?: string | number;
  /** The photo that beams up. Default: a snapshot of this canvas at the snap. */
  photoUrl?: string;
  /** Tapping Beamy plays it. Default true. */
  playOnClick?: boolean;
  /** Accessible name of the tap button. */
  label?: string;
  /** Fires at the snap (flash) cue. */
  onSnap?: () => void;
  /** Fires when the photo has finished its flight. */
  onDone?: () => void;
  /** Model failed to load: the widget renders nothing. */
  onError?: () => void;
  className?: string;
  style?: CSSProperties;
}

interface Overlays {
  flash: HTMLDivElement | null;
  beam: HTMLDivElement | null;
  card: HTMLDivElement | null;
  img: HTMLImageElement | null;
}

interface Run {
  t: number;
  tl: SelfieTimeline;
  snapped: boolean;
  done: boolean;
  /** Reduced motion: where the card rests (fixed once it appears). */
  anchor: { x: number; y: number } | null;
}

const noopEvents = () => ({ enabled: false, priority: 0 });
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

interface SceneProps {
  playRef: MutableRefObject<(() => void) | null>;
  overlays: MutableRefObject<Overlays>;
  reducedRef: MutableRefObject<boolean>;
  photoUrlRef: MutableRefObject<string | undefined>;
  onSnapRef: MutableRefObject<(() => void) | undefined>;
  onDoneRef: MutableRefObject<(() => void) | undefined>;
  onError: () => void;
}

function Scene({ playRef, overlays, reducedRef, photoUrlRef, onSnapRef, onDoneRef, onError }: SceneProps) {
  const { camera, size, gl, scene } = useThree();
  const [model, setModel] = useState<{ scene: THREE.Group; clips: THREE.AnimationClip[] } | null>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const idle = useRef<THREE.AnimationAction | null>(null);
  const selfie = useRef<THREE.AnimationAction | null>(null);
  const phoneBone = useRef<THREE.Object3D | null>(null);
  const bodyBone = useRef<THREE.Object3D | null>(null);
  const screenLight = useRef<THREE.PointLight>(null);
  const run = useRef<Run | null>(null);
  const pending = useRef(false);
  const tmp = useRef(new THREE.Vector3());

  /* Frame Beamy + the flight space for any container aspect. */
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const halfH = Math.max(FRAME.halfH, FRAME.halfW / Math.max(aspect, 1e-3));
    const dist = halfH / Math.tan(THREE.MathUtils.degToRad(FRAME.fovDeg / 2));
    cam.fov = FRAME.fovDeg;
    cam.position.set(0, FRAME.centerY, dist);
    cam.lookAt(0, FRAME.centerY, 0);
    cam.near = 0.05;
    cam.far = dist + 5;
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  /* Load the rig. Each instance owns its parse (it animates the graph). */
  useEffect(() => {
    let cancelled = false;
    let owned: THREE.Group | null = null;
    gltfLoader().loadAsync(MODEL_URL).then(
      (g) => {
        if (cancelled) return;
        owned = g.scene;
        g.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) o.frustumCulled = false;
          // The rig's own beam points +z, at the camera; it is not part of this move.
          if (o.name === 'beam_core' || o.name === 'beam_outer') o.visible = false;
          // Two nodes are named `phone` (the bone and its skinned mesh); the bone is the hand.
          if ((o as THREE.Bone).isBone && o.name === 'phone') phoneBone.current = o;
          if ((o as THREE.Bone).isBone && o.name === 'body') bodyBone.current = o;
        });
        setModel({ scene: g.scene, clips: g.animations });
      },
      () => { if (!cancelled) onError(); },
    );
    return () => {
      cancelled = true;
      owned?.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
            m.dispose();
          }
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load exactly once
  }, []);

  const hideOverlays = useCallback(() => {
    const o = overlays.current;
    if (o.flash) o.flash.style.opacity = '0';
    if (o.beam) o.beam.style.opacity = '0';
    if (o.card) o.card.style.opacity = '0';
  }, [overlays]);

  const start = useCallback(() => {
    const m = mixer.current;
    const s = selfie.current;
    if (m === null) { pending.current = true; return; }
    if (s === null) { onDoneRef.current?.(); return; } // an old GLB without the clip
    const prev = idle.current;
    s.reset();
    s.setLoop(THREE.LoopOnce, 1);
    s.clampWhenFinished = true;
    s.enabled = true;
    s.setEffectiveWeight(1);
    if (prev && prev.isRunning()) s.crossFadeFrom(prev, CROSSFADE_S, false);
    s.play();
    hideOverlays();
    const img = overlays.current.img;
    if (img && photoUrlRef.current) img.src = photoUrlRef.current;
    run.current = { t: 0, tl: selfieTimeline(reducedRef.current), snapped: false, done: false, anchor: null };
  }, [hideOverlays, onDoneRef, overlays, photoUrlRef, reducedRef]);

  useEffect(() => { playRef.current = start; return () => { playRef.current = null; }; }, [playRef, start]);

  /* Mixer + actions once the model is in. */
  useEffect(() => {
    if (model === null) return;
    const m = new THREE.AnimationMixer(model.scene);
    mixer.current = m;
    const idleClip = model.clips.find((c) => c.name === 'Idle');
    const selfieClip = model.clips.find((c) => c.name === SELFIE_CLIP);
    idle.current = idleClip ? m.clipAction(idleClip) : null;
    selfie.current = selfieClip ? m.clipAction(selfieClip) : null;
    idle.current?.play();
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== selfie.current || idle.current === null) return;
      const i = idle.current;
      i.reset(); i.enabled = true; i.setEffectiveWeight(1); i.play();
      i.crossFadeFrom(e.action, CROSSFADE_S, false);
    };
    m.addEventListener('finished', onFinished);
    if (pending.current) { pending.current = false; start(); }
    return () => {
      m.removeEventListener('finished', onFinished);
      m.stopAllAction();
      m.uncacheRoot(model.scene);
      mixer.current = null;
    };
  }, [model, start]);

  /** Container-pixel position of a world point. */
  const toPx = (v: THREE.Vector3) => {
    const p = tmp.current.copy(v).project(camera);
    return { x: (p.x * 0.5 + 0.5) * size.width, y: (-p.y * 0.5 + 0.5) * size.height };
  };

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    mixer.current?.update(dt);
    const r = run.current;
    const o = overlays.current;
    const light = screenLight.current;
    if (r === null || r.done) { if (light) light.intensity = 0; return; }
    r.t += dt;
    const { tl, t } = r;

    // Where things are this frame, in container pixels.
    const phoneW = new THREE.Vector3();
    if (phoneBone.current) phoneBone.current.getWorldPosition(phoneW); else phoneW.set(-0.34, 0.45, 0.02);
    phoneW.y += 0.05; // the bone is the grip; the screen sits above it
    const phone = toPx(phoneW);
    const headW = new THREE.Vector3();
    if (bodyBone.current) bodyBone.current.getWorldPosition(headW); else headW.set(0, 0.12, 0);
    headW.y += 0.52;
    const head = toPx(headW);
    const H = size.height;

    // Screen glow on his face during the pose; spikes at the snap.
    if (light) {
      light.position.copy(phoneW);
      const pose = t >= tl.cues.phoneUp && t < tl.cues.beamStart - 0.4 ? 0.35 : 0;
      light.intensity = pose + flashOpacity(t, tl) * (tl.reducedMotion ? 1.5 : 6);
    }

    // The snap: default photo = this canvas, rendered right now.
    if (!r.snapped && t >= tl.cues.snap) {
      r.snapped = true;
      if (!photoUrlRef.current && o.img) {
        try {
          // Render now so the drawing buffer is valid for this task, then crop a
          // portrait around Beamy onto the card's backdrop: his own selfie.
          state.gl.render(scene, camera);
          o.img.src = snapshotPortrait(gl.domElement, head, H, size.width);
        } catch {
          o.img.removeAttribute('src'); // tainted/lost context: the card keeps its gradient face
        }
      }
      onSnapRef.current?.();
    }

    if (o.flash) {
      o.flash.style.opacity = flashOpacity(t, tl).toFixed(3);
      o.flash.style.background = flashGradient(phone.x, phone.y, tl.reducedMotion);
    }

    if (o.beam) {
      const a = beamOpacity(t, tl);
      o.beam.style.opacity = a.toFixed(3);
      if (a > 0) {
        const w = Math.max(28, H * 0.16);
        o.beam.style.width = `${w.toFixed(1)}px`;
        o.beam.style.height = `${Math.max(0, head.y).toFixed(1)}px`;
        o.beam.style.transform = `translate3d(${(head.x - w / 2).toFixed(1)}px, 0, 0)`;
      }
    }

    if (o.card) {
      const s = photoState(t, tl);
      o.card.style.opacity = s.opacity.toFixed(3);
      if (s.visible) {
        const cw = Math.max(40, H * 0.17);
        const ch = cw * 1.2;
        // pop: out of the phone to a hover point above it; rise: up the column above his head.
        const W = size.width;
        const clampX = (v: number) => Math.min(W - cw / 2 - 4, Math.max(cw / 2 + 4, v));
        let x: number;
        let y: number;
        if (tl.reducedMotion) {
          // Pinned where it first appears: nothing on screen travels.
          r.anchor ??= { x: clampX(phone.x), y: Math.max(ch / 2 + 4, phone.y - H * 0.1) };
          x = r.anchor.x;
          y = r.anchor.y;
        } else {
          const hoverY = phone.y - H * 0.16;
          const k = Math.min(1, s.rise * 2.2);
          x = clampX(lerp(phone.x, head.x, k));
          y = lerp(lerp(phone.y, hoverY, s.pop), -ch * 0.2, s.rise);
        }
        o.card.style.width = `${cw.toFixed(1)}px`;
        o.card.style.height = `${ch.toFixed(1)}px`;
        o.card.style.transform =
          `translate3d(${(x - cw / 2).toFixed(1)}px, ${(y - ch / 2).toFixed(1)}px, 0) rotate(${s.tiltDeg.toFixed(2)}deg) scale(${Math.max(0.001, s.scale).toFixed(3)})`;
      }
    }

    if (t >= tl.total) {
      r.done = true;
      hideOverlays();
      onDoneRef.current?.();
    }
  });

  return (
    <>
      <hemisphereLight args={['#dfe6ff', '#2a1d4a', 1.6]} />
      <directionalLight position={[0.3, 0.6, 0.9]} intensity={2.2} />
      <directionalLight position={[-0.6, 0.2, 0.4]} intensity={0.9} color="#a78bfa" />
      <pointLight ref={screenLight} color="#c9ceff" intensity={0} distance={0.6} decay={2} />
      {model !== null && <primitive object={model.scene} />}
    </>
  );
}

/**
 * A 4:5 portrait cropped from the WebGL canvas around his head (`head` in CSS
 * px), over a periwinkle-to-amber backdrop. Throws if the canvas cannot be
 * read; the caller keeps the card's gradient face then.
 */
function snapshotPortrait(src: HTMLCanvasElement, head: { x: number; y: number }, cssH: number, cssW: number): string {
  const k = src.width / Math.max(1, cssW); // device px per CSS px
  const sw = cssH * 0.62 * k;
  const sh = sw * 1.25;
  const sx = head.x * k - sw / 2;
  const sy = head.y * k - sh * 0.18; // the top of his head near the top of the frame
  const out = document.createElement('canvas');
  out.width = 320;
  out.height = 400;
  const g = out.getContext('2d');
  if (g === null) throw new Error('no 2d context');
  const bg = g.createRadialGradient(160, 150, 10, 160, 200, 300);
  bg.addColorStop(0, `rgb(${AMBER})`);
  bg.addColorStop(0.45, `rgb(${PERIWINKLE})`);
  bg.addColorStop(1, '#2b2f6b');
  g.fillStyle = bg;
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.85);
}

function flashGradient(x: number, y: number, reduced: boolean): string {
  const at = `${x.toFixed(0)}px ${y.toFixed(0)}px`;
  return reduced
    ? `radial-gradient(circle at ${at}, rgba(255,250,240,0.9) 0%, rgba(${PERIWINKLE},0.5) 45%, rgba(${PERIWINKLE},0) 90%)`
    : `radial-gradient(circle at ${at}, rgba(255,252,246,1) 0%, rgba(${AMBER},0.95) 8%, rgba(255,255,255,0.85) 22%, rgba(${PERIWINKLE},0.55) 55%, rgba(${PERIWINKLE},0.18) 85%, rgba(${PERIWINKLE},0) 100%)`;
}

const overlayBase: CSSProperties = { position: 'absolute', pointerEvents: 'none', opacity: 0, willChange: 'opacity, transform' };

const BeamySelfie = forwardRef<BeamySelfieHandle, BeamySelfieProps>(function BeamySelfie(
  { playKey, photoUrl, playOnClick = true, label = 'Make Beamy take a selfie', onSnap, onDone, onError, className, style },
  ref,
) {
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);
  const playRef = useRef<(() => void) | null>(null);
  const overlays = useRef<Overlays>({ flash: null, beam: null, card: null, img: null });
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const photoUrlRef = useRef(photoUrl);
  photoUrlRef.current = photoUrl;
  const onSnapRef = useRef(onSnap);
  onSnapRef.current = onSnap;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const play = useCallback(() => { playRef.current?.(); }, []);
  useImperativeHandle(ref, () => ({ play }), [play]);

  // A changed playKey plays; the first value does not.
  const firstKey = useRef(playKey);
  useEffect(() => {
    if (playKey === firstKey.current) return;
    firstKey.current = playKey;
    play();
  }, [playKey, play]);

  const handleError = useCallback(() => { setFailed(true); onErrorRef.current?.(); }, []);

  if (failed) return null;

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', ...style }}
    >
      <Canvas
        dpr={[1, 2]}
        events={noopEvents}
        gl={{ alpha: true, antialias: true }}
        camera={{ fov: FRAME.fovDeg, position: [0, FRAME.centerY, 3] }}
        // R3F's wrapper sets pointer-events:auto; this widget must never block its neighbours.
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
        aria-hidden
      >
        <Scene
          playRef={playRef}
          overlays={overlays}
          reducedRef={reducedRef}
          photoUrlRef={photoUrlRef}
          onSnapRef={onSnapRef}
          onDoneRef={onDoneRef}
          onError={handleError}
        />
      </Canvas>
      <div
        aria-hidden
        ref={(el) => { overlays.current.beam = el; }}
        style={{
          ...overlayBase,
          left: 0,
          top: 0,
          mixBlendMode: 'screen',
          background: `linear-gradient(90deg, rgba(${PERIWINKLE},0) 0%, rgba(${PERIWINKLE},0.32) 22%, rgba(255,255,255,0.8) 44%, rgba(${AMBER},0.95) 50%, rgba(255,255,255,0.8) 56%, rgba(${PERIWINKLE},0.32) 78%, rgba(${PERIWINKLE},0) 100%)`,
          WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 100%)',
          maskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 100%)',
          filter: 'blur(2px)',
        }}
      />
      <div
        aria-hidden
        ref={(el) => { overlays.current.card = el; }}
        style={{
          ...overlayBase,
          left: 0,
          top: 0,
          borderRadius: 6,
          background: '#FFF8EC',
          boxShadow: `0 0 18px rgba(${PERIWINKLE},0.55), 0 0 4px rgba(${AMBER},0.6)`,
          transformOrigin: '50% 50%',
        }}
      >
        <div
          style={{
            // Insets, not padding: % padding resolves against the CONTAINER's width.
            position: 'absolute',
            left: '7%',
            right: '7%',
            top: '6%',
            bottom: '20%',
            borderRadius: 3,
            overflow: 'hidden',
            background: `radial-gradient(circle at 50% 40%, rgba(${AMBER},0.55), rgba(${PERIWINKLE},0.85) 60%, #2b2f6b 100%)`,
          }}
        >
          <img
            alt=""
            ref={(el) => { overlays.current.img = el; }}
            src={photoUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      </div>
      <div aria-hidden ref={(el) => { overlays.current.flash = el; }} style={{ ...overlayBase, inset: 0 }} />
      {playOnClick && (
        <button
          type="button"
          aria-label={label}
          onClick={play}
          style={{
            position: 'absolute',
            left: '25%',
            right: '25%',
            bottom: 0,
            height: '55%',
            minWidth: 44,
            minHeight: 44,
            background: 'transparent',
            border: 0,
            padding: 0,
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        />
      )}
    </div>
  );
});

export { BeamySelfie };
export default BeamySelfie;
