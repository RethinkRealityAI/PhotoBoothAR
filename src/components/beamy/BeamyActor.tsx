/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamyActor — Beamy standing in a small transparent canvas, idling, and
 * playing one clip each time `beat` changes (then easing back to Idle).
 *
 * Built for the sign-in/sign-up greeter (pages/auth/AuthShell.tsx), which
 * owns the timing and the speech bubble; this file only animates the rig.
 * Same loading pattern as BeamySelfie (each instance owns its parse, since it
 * animates the graph; the GLB itself is fetched once via glbCache).
 *
 * `lookAtPointer` turns him a few degrees towards the mouse. That is decor,
 * so the caller switches it off under reduced motion.
 *
 * Lazy-load it: `lazy(() => import('…/beamy/BeamyActor'))`.
 */
import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { gltfLoader } from '../../lib/glbCache';
import type { GreeterClip } from '../../lib/authBeamy';

const MODEL_URL = '/mascot/beamy.glb';
const CROSSFADE_S = 0.3;
/** Beamy stands at y=0 and is 0.6 tall; headroom for a hop. */
const FRAME = { centerY: 0.36, halfH: 0.5, halfW: 0.48, fovDeg: 28 };
const MAX_TURN = 0.32; // radians towards the pointer

const noopEvents = () => ({ enabled: false, priority: 0 });

export interface BeamyActorProps {
  clip: GreeterClip;
  /** Change it to play `clip` once. The first value plays nothing. */
  beat: number;
  lookAtPointer?: boolean;
  onReady?: () => void;
  onError?: () => void;
  className?: string;
}

interface SceneProps {
  clip: GreeterClip;
  beat: number;
  lookAtPointer: boolean;
  onReady: () => void;
  onError: () => void;
}

function Scene({ clip, beat, lookAtPointer, onReady, onError }: SceneProps) {
  const { camera, size } = useThree();
  const [model, setModel] = useState<{ scene: THREE.Group; clips: THREE.AnimationClip[] } | null>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const idle = useRef<THREE.AnimationAction | null>(null);
  const current = useRef<THREE.AnimationAction | null>(null);
  const pointerX = useRef(0);
  const firstBeat = useRef(beat);

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

  /* Load the rig once. */
  useEffect(() => {
    let cancelled = false;
    let owned: THREE.Group | null = null;
    gltfLoader().loadAsync(MODEL_URL).then(
      (g) => {
        if (cancelled) return;
        owned = g.scene;
        g.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) o.frustumCulled = false;
          // The rig's own beam and selfie phone are not part of the greeting.
          if (o.name === 'beam_core' || o.name === 'beam_outer') o.visible = false;
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

  /* Mixer + Idle once the model is in; any one-shot eases back to Idle. */
  useEffect(() => {
    if (model === null) return;
    const m = new THREE.AnimationMixer(model.scene);
    mixer.current = m;
    const idleClip = model.clips.find((c) => c.name === 'Idle');
    idle.current = idleClip ? m.clipAction(idleClip) : null;
    idle.current?.play();
    current.current = idle.current;
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      const i = idle.current;
      if (i === null || e.action === i) return;
      i.reset(); i.enabled = true; i.setEffectiveWeight(1); i.play();
      i.crossFadeFrom(e.action, CROSSFADE_S, false);
      current.current = i;
    };
    m.addEventListener('finished', onFinished);
    onReady();
    return () => {
      m.removeEventListener('finished', onFinished);
      m.stopAllAction();
      m.uncacheRoot(model.scene);
      mixer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onReady is a stable ref wrapper
  }, [model]);

  /* Play the beat's clip. */
  useEffect(() => {
    if (beat === firstBeat.current) return;
    const m = mixer.current;
    if (m === null || model === null || clip === 'Idle') return;
    const c = model.clips.find((x) => x.name === clip);
    if (!c) return;
    const a = m.clipAction(c);
    const prev = current.current;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (prev && prev !== a) a.crossFadeFrom(prev, CROSSFADE_S, false);
    current.current = a;
  }, [beat, clip, model]);

  /* Pointer, in −1…1 across the window (decor only). */
  useEffect(() => {
    if (!lookAtPointer) { pointerX.current = 0; return; }
    const on = (e: PointerEvent) => { pointerX.current = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1; };
    window.addEventListener('pointermove', on, { passive: true });
    return () => window.removeEventListener('pointermove', on);
  }, [lookAtPointer]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    mixer.current?.update(dt);
    if (model !== null) {
      const target = pointerX.current * MAX_TURN;
      model.scene.rotation.y += (target - model.scene.rotation.y) * Math.min(1, dt * 3);
    }
  });

  return (
    <>
      <hemisphereLight args={['#dfe6ff', '#2a1d4a', 1.6]} />
      <directionalLight position={[0.3, 0.6, 0.9]} intensity={2.2} />
      <directionalLight position={[-0.6, 0.2, 0.4]} intensity={0.9} color="#a78bfa" />
      <pointLight position={[0.5, 0.1, 0.6]} intensity={0.6} color="#ffc56b" distance={2} decay={2} />
      {model !== null && <primitive object={model.scene} />}
    </>
  );
}

export default function BeamyActor({ clip, beat, lookAtPointer = false, onReady, onError, className }: BeamyActorProps) {
  const [failed, setFailed] = useState(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  if (failed) return null;
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden>
      <Canvas
        events={noopEvents}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        camera={{ fov: FRAME.fovDeg, position: [0, FRAME.centerY, 3] }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
      >
        <Scene
          clip={clip}
          beat={beat}
          lookAtPointer={lookAtPointer}
          onReady={() => readyRef.current?.()}
          onError={() => { setFailed(true); errorRef.current?.(); }}
        />
      </Canvas>
    </div>
  );
}
