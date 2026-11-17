/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamyStage — the full-viewport WebGL layer Beamy lives in on /beamy.
 *
 * One transparent, pointer-events-none canvas covers the whole viewport and
 * sits ABOVE the page's cards, so Beamy can walk over to a card and tap it.
 * The camera is orthographic at zoom 1, so one world unit is one CSS pixel:
 * the page speaks in viewport pixels (getBoundingClientRect) and the stage
 * maps them with x = px − w/2, y = h/2 − py. Nothing here owns copy or flow;
 * the page scripts Beamy through the imperative `BeamyApi` (promise-based, so
 * a choreography reads top to bottom: walk, tap, beam, reveal).
 *
 * The rig (public/mascot/beamy.glb) is the mascot's custom rigid-body rig with
 * nine NLA clips. The model's own beam points along +z, straight at an
 * orthographic camera, so the visible beam is drawn here instead: a shader
 * quad stretched from the mouth to the target, fired inside BeamyBlast's
 * window (1.2 s to 2.7 s), and the GLB's beam meshes are hidden.
 *
 * Reduced motion: Beamy IS the content of this page (every move answers a
 * tap), so his moves play regardless, the same call the landing films make.
 * Only the ambient floor shimmer is decorative.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { gltfLoader, loadModel } from '../../lib/glbCache';
import { SPECTRUM } from '../../components/landing/ShowcasePhone';

export type BeamyClip = 'Idle' | 'Wave' | 'Hop' | 'BeamyBlast' | 'Sob' | 'SideEye' | 'Dance' | 'ShadesOn' | 'Waddle';

export interface Pt { x: number; y: number; }

/** Where Beamy rests and how tall he is there (viewport px, feet point). */
export interface StageLayout { home: Pt; heightPx: number; }

export interface BeamyApi {
  /** Walk until the feet stand on `to`; `size` scales Beamy on the way (1 = home size). */
  walkTo(to: Pt, size?: number): Promise<void>;
  goHome(): Promise<void>;
  /** Play a clip once, then settle back to Idle. */
  play(clip: BeamyClip): Promise<void>;
  /** Turn toward a viewport x (null = face the viewer). */
  face(x: number | null): void;
  /** BeamyBlast at `to`; `onFire` runs the moment the beam lights. Resolves when the clip ends. */
  beam(to: Pt, onFire?: () => void): Promise<void>;
  /** Particles stream from the mouth and a library prop materialises at `at`. */
  reveal(url: string, at: Pt, sizePx: number): Promise<void>;
  clearProp(): void;
  /** Mouth position in viewport px. */
  mouth(): Pt;
  /** Current feet position + live height, viewport px. */
  where(): Pt & { heightPx: number };
}

interface Props {
  apiRef: MutableRefObject<BeamyApi | null>;
  layoutRef: MutableRefObject<StageLayout>;
  /** Speech bubble, positioned over Beamy's head every frame. */
  bubbleRef: MutableRefObject<HTMLDivElement | null>;
  /** Invisible "poke Beamy" button kept over his body. */
  hitRef: MutableRefObject<HTMLButtonElement | null>;
  onReady: () => void;
  onError: () => void;
}

const MODEL_URL = '/mascot/beamy.glb';
/** Model height in metres (body bbox, feet at y≈0). */
const MODEL_H = 0.6;
const BEAM_FIRE_S = 1.2;
const BEAM_END_S = 2.65;

const noopEvents = () => ({ enabled: false, priority: 0 });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeOutBack = (t: number) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

/* ── Beam quad ─────────────────────────────────────────────────────────── */

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uAlpha;
void main() {
  float across = abs(vUv.y - 0.5) * 2.0;           // 0 centre → 1 edge
  float core = exp(-across * across * 18.0);
  float aura = exp(-across * across * 3.0);
  float flow = 0.75 + 0.25 * sin(vUv.x * 40.0 - uTime * 30.0);
  float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  vec3 a = vec3(0.36, 0.55, 1.0), b = vec3(0.91, 0.47, 0.98), c = vec3(0.13, 0.83, 0.93);
  vec3 hue = mix(mix(a, b, vUv.x), c, 0.5 + 0.5 * sin(vUv.x * 6.0 - uTime * 4.0));
  vec3 col = hue * aura * flow + vec3(1.0) * core;
  gl_FragColor = vec4(col, (aura * 0.85 + core) * ends * uAlpha);
}`;

/* ── Floor shadow ──────────────────────────────────────────────────────── */

const FLOOR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
void main() {
  float d = length((vUv - 0.5) * 2.0);
  float glow = smoothstep(1.0, 0.0, d);
  float ring = smoothstep(0.06, 0.0, abs(d - 0.72 - 0.05 * sin(uTime * 2.0))) * 0.5;
  vec3 col = mix(vec3(0.49, 0.42, 0.97), vec3(0.13, 0.83, 0.93), 0.5 + 0.5 * sin(uTime));
  gl_FragColor = vec4(col, glow * 0.38 + ring * glow);
}`;

/* ── Particles for the prop reveal ─────────────────────────────────────── */

const N_SPARKS = 520;

interface Reveal {
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Per-spark scatter offset + delay. */
  seeds: Float32Array;
  resolve: () => void;
  done: boolean;
}

/* ── The scene ─────────────────────────────────────────────────────────── */

function Scene({ apiRef, layoutRef, bubbleRef, hitRef, onReady, onError }: Props) {
  const { size } = useThree();
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const rig = useRef<THREE.Group>(null);
  const floor = useRef<THREE.Mesh>(null);
  const beamMesh = useRef<THREE.Mesh>(null);
  const propGroup = useRef<THREE.Group>(null);
  const sparks = useRef<THREE.Points>(null);

  const [model, setModel] = useState<{ scene: THREE.Group; clips: THREE.AnimationClip[] } | null>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const actions = useRef<Partial<Record<BeamyClip, THREE.AnimationAction>>>({});
  const current = useRef<THREE.AnimationAction | null>(null);
  const mouthNode = useRef<THREE.Object3D | null>(null);

  // Live motion state (never React state: it changes every frame).
  const pos = useRef<Pt>({ ...layoutRef.current.home });
  const scale = useRef(1);
  const yaw = useRef(0);
  const yawTarget = useRef(0);
  const walk = useRef<{ to: Pt; size: number; resolve: () => void } | null>(null);
  const beamState = useRef<{ to: Pt; t: number; fired: boolean; onFire?: () => void } | null>(null);
  const reveal = useRef<Reveal | null>(null);
  const propSpin = useRef(0);

  /* Load the rig once. The page owns the instance, so it is disposed here. */
  useEffect(() => {
    let cancelled = false;
    let owned: THREE.Group | null = null;
    gltfLoader().loadAsync(MODEL_URL).then(
      (g) => {
        if (cancelled) return;
        owned = g.scene;
        g.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) { o.frustumCulled = false; o.renderOrder = 2; }
          // The rig's beam runs along +z: at an orthographic camera it is a
          // flat white wedge once Beamy turns. The stage draws its own beam.
          if (o.name === 'beam_core' || o.name === 'beam_outer') o.visible = false;
        });
        mouthNode.current = g.scene.getObjectByName('beam') ?? null;
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

  /* Mixer + actions once the model is in. */
  useEffect(() => {
    if (model === null) return;
    const m = new THREE.AnimationMixer(model.scene);
    mixer.current = m;
    const acts: Partial<Record<BeamyClip, THREE.AnimationAction>> = {};
    for (const c of model.clips) acts[c.name as BeamyClip] = m.clipAction(c);
    actions.current = acts;
    const idle = acts.Idle;
    if (idle) { idle.play(); current.current = idle; }
    onReady();
    return () => { m.stopAllAction(); m.uncacheRoot(model.scene); mixer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per model
  }, [model]);

  const fadeTo = (name: BeamyClip, once: boolean): THREE.AnimationAction | null => {
    const next = actions.current[name];
    if (!next) return null;
    const prev = current.current;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (prev && prev !== next) next.crossFadeFrom(prev, 0.22, false);
    next.play();
    current.current = next;
    return next;
  };

  const toWorld = (p: Pt) => ({ x: p.x - sizeRef.current.width / 2, y: sizeRef.current.height / 2 - p.y });
  const toScreen = (v: THREE.Vector3): Pt => ({ x: v.x + sizeRef.current.width / 2, y: sizeRef.current.height / 2 - v.y });

  /* The imperative API the page scripts against. */
  useEffect(() => {
    const playOnce = (clip: BeamyClip) => new Promise<void>((resolve) => {
      const m = mixer.current;
      const a = fadeTo(clip, true);
      if (m === null || a === null) { resolve(); return; }
      const onFinish = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== a) return;
        m.removeEventListener('finished', onFinish);
        if (current.current === a) fadeTo(walk.current ? 'Waddle' : 'Idle', false);
        resolve();
      };
      m.addEventListener('finished', onFinish);
    });

    const api: BeamyApi = {
      walkTo(to, sizeFactor = 1) {
        walk.current?.resolve();
        return new Promise<void>((resolve) => {
          walk.current = { to: { ...to }, size: sizeFactor, resolve };
          fadeTo('Waddle', false);
        });
      },
      goHome() {
        return api.walkTo(layoutRef.current.home, 1);
      },
      play: playOnce,
      face(x) {
        if (x === null) { yawTarget.current = 0; return; }
        yawTarget.current = clamp((x - pos.current.x) / 260, -1, 1) * 1.05;
      },
      beam(to, onFire) {
        beamState.current = { to: { ...to }, t: 0, fired: false, onFire };
        api.face(to.x);
        return playOnce('BeamyBlast').then(() => { beamState.current = null; yawTarget.current = 0; });
      },
      reveal(url, at, sizePx) {
        api.clearProp();
        const g = propGroup.current;
        if (g === null) return Promise.resolve();
        return loadModel(url).then((master) => new Promise<void>((resolve) => {
          const obj = master.clone(true);
          const box = new THREE.Box3().setFromObject(obj);
          const dims = box.getSize(new THREE.Vector3());
          const centre = box.getCenter(new THREE.Vector3());
          const k = sizePx / Math.max(dims.x, dims.y, dims.z, 1e-6);
          obj.position.sub(centre);
          const holder = new THREE.Group();
          holder.add(obj);
          holder.scale.setScalar(k);
          g.clear();
          g.add(holder);
          const w = toWorld(at);
          g.position.set(w.x, w.y, 120);
          g.scale.setScalar(0.0001);
          g.visible = true;
          propSpin.current = 0;
          const seeds = new Float32Array(N_SPARKS * 4);
          for (let i = 0; i < N_SPARKS; i++) {
            const th = Math.random() * Math.PI * 2;
            const ph = Math.acos(2 * Math.random() - 1);
            const r = sizePx * (0.55 + Math.random() * 0.45);
            seeds[i * 4] = Math.sin(ph) * Math.cos(th) * r;
            seeds[i * 4 + 1] = Math.sin(ph) * Math.sin(th) * r;
            seeds[i * 4 + 2] = Math.cos(ph) * r * 0.4;
            seeds[i * 4 + 3] = Math.random() * 0.35;
          }
          const m = api.mouth();
          const mw = toWorld(m);
          reveal.current = {
            t: 0,
            from: new THREE.Vector3(mw.x, mw.y, 130),
            to: new THREE.Vector3(w.x, w.y, 130),
            seeds,
            resolve,
            done: false,
          };
          api.face(at.x);
          void playOnce('Hop');
        }), () => undefined);
      },
      clearProp() {
        reveal.current?.resolve();
        reveal.current = null;
        if (propGroup.current) { propGroup.current.visible = false; propGroup.current.clear(); }
        if (sparks.current) sparks.current.visible = false;
      },
      mouth() {
        const n = mouthNode.current;
        if (n === null) {
          const h = layoutRef.current.heightPx * scale.current;
          return { x: pos.current.x, y: pos.current.y - h * 0.48 };
        }
        const v = new THREE.Vector3();
        n.getWorldPosition(v);
        return toScreen(v);
      },
      where() {
        return { ...pos.current, heightPx: layoutRef.current.heightPx * scale.current };
      },
    };
    apiRef.current = api;
    return () => { apiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs only
  }, []);

  const beamMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);
  const floorMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: FLOOR_FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
  }), []);
  const sparkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_SPARKS * 3), 3));
    const col = new Float32Array(N_SPARKS * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N_SPARKS; i++) {
      c.set(SPECTRUM[i % SPECTRUM.length]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  /** Soft round sprite so sparks read as light, not square pixels. */
  const sparkTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g !== null) {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.35, 'rgba(255,255,255,0.8)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }
    return new THREE.CanvasTexture(c);
  }, []);
  const sparkMat = useMemo(() => new THREE.PointsMaterial({
    size: 7, vertexColors: true, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: false, map: sparkTex,
  }), [sparkTex]);
  useEffect(() => () => { beamMat.dispose(); floorMat.dispose(); sparkGeo.dispose(); sparkMat.dispose(); sparkTex.dispose(); }, [beamMat, floorMat, sparkGeo, sparkMat, sparkTex]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    const t = state.clock.elapsedTime;
    const layout = layoutRef.current;
    const W = sizeRef.current.width;

    /* Walk */
    const w = walk.current;
    if (w !== null) {
      const dx = w.to.x - pos.current.x;
      const dy = w.to.y - pos.current.y;
      const dist = Math.hypot(dx, dy);
      const speed = Math.max(220, layout.heightPx * 2.6);
      const step = speed * dt;
      scale.current += (w.size - scale.current) * Math.min(1, dt * 3.5);
      if (dist <= step + 0.5) {
        pos.current = { ...w.to };
        walk.current = null;
        yawTarget.current = 0;
        if (current.current === actions.current.Waddle) fadeTo('Idle', false);
        w.resolve();
      } else {
        pos.current = { x: pos.current.x + (dx / dist) * step, y: pos.current.y + (dy / dist) * step };
        if (Math.abs(dx) > 4) yawTarget.current = Math.sign(dx) * 1.0;
      }
    } else if (reveal.current === null && beamState.current === null) {
      // Idle at home: follow layout changes (resize, rotation).
      const atHomeScale = Math.abs(scale.current - 1) < 0.02;
      if (atHomeScale) {
        const h = layout.home;
        pos.current = { x: pos.current.x + (h.x - pos.current.x) * Math.min(1, dt * 4), y: pos.current.y + (h.y - pos.current.y) * Math.min(1, dt * 4) };
      }
    }
    yaw.current += (yawTarget.current - yaw.current) * Math.min(1, dt * 7);

    const heightPx = layout.heightPx * scale.current;
    const s = heightPx / MODEL_H;
    const g = rig.current;
    if (g) {
      const wp = toWorld(pos.current);
      g.position.set(wp.x, wp.y, 0);
      g.scale.setScalar(s);
      g.rotation.y = yaw.current;
    }
    if (floor.current) {
      const wp = toWorld(pos.current);
      floor.current.position.set(wp.x, wp.y + heightPx * 0.02, -200);
      floor.current.scale.set(heightPx * 1.25, heightPx * 0.3, 1);
    }
    (floorMat.uniforms.uTime as { value: number }).value = t;
    mixer.current?.update(dt);

    /* Beam quad */
    const b = beamState.current;
    const bm = beamMesh.current;
    if (bm) {
      let alpha = 0;
      if (b !== null) {
        b.t += dt;
        if (!b.fired && b.t >= BEAM_FIRE_S) { b.fired = true; b.onFire?.(); }
        if (b.t >= BEAM_FIRE_S && b.t <= BEAM_END_S + 0.2) {
          const k = b.t - BEAM_FIRE_S;
          alpha = Math.min(1, k / 0.12) * Math.min(1, (BEAM_END_S + 0.2 - b.t) / 0.25);
          const m = toWorld(apiRef.current?.mouth() ?? pos.current);
          const to = toWorld(b.to);
          const len = Math.hypot(to.x - m.x, to.y - m.y);
          bm.position.set((m.x + to.x) / 2, (m.y + to.y) / 2, 300);
          bm.rotation.z = Math.atan2(to.y - m.y, to.x - m.x);
          const width = Math.max(26, heightPx * 0.22) * (1 + 0.08 * Math.sin(t * 40));
          bm.scale.set(Math.max(1, len), width, 1);
        }
      }
      bm.visible = alpha > 0.001;
      (beamMat.uniforms.uAlpha as { value: number }).value = alpha;
      (beamMat.uniforms.uTime as { value: number }).value = t;
    }

    /* Prop reveal: sparks out of the mouth, swirl, collapse into the prop. */
    const r = reveal.current;
    const pg = propGroup.current;
    const sp = sparks.current;
    if (pg && pg.visible) {
      propSpin.current += dt * 0.9;
      pg.rotation.y = propSpin.current;
      pg.rotation.x = Math.sin(t * 1.3) * 0.12;
    }
    if (r !== null && sp && pg) {
      r.t += dt;
      const TOTAL = 2.1;
      const p = r.t / TOTAL;
      const arr = (sp.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const mouthNow = toWorld(apiRef.current?.mouth() ?? pos.current);
      r.from.set(mouthNow.x, mouthNow.y, 130);
      for (let i = 0; i < N_SPARKS; i++) {
        const delay = r.seeds[i * 4 + 3];
        const k = clamp((p - delay) / 0.55, 0, 1);         // outbound
        const c = clamp((p - 0.62) / 0.3, 0, 1);            // collapse
        const ox = r.seeds[i * 4], oy = r.seeds[i * 4 + 1], oz = r.seeds[i * 4 + 2];
        const swirl = k * 2.2 + t * 1.5;
        const cs = Math.cos(swirl), sn = Math.sin(swirl);
        const sx = r.to.x + (ox * cs - oz * sn) * (1 - c);
        const sy = r.to.y + oy * (1 - c);
        const e = 1 - (1 - k) ** 3;
        // Arc: lift the midpoint so the stream bows upward.
        const lift = Math.sin(Math.PI * e) * layout.heightPx * 0.35;
        const x = r.from.x + (sx - r.from.x) * e;
        const y = r.from.y + (sy - r.from.y) * e + lift * (1 - c);
        arr[i * 3] = k <= 0 ? r.from.x : x;
        arr[i * 3 + 1] = k <= 0 ? r.from.y : y;
        arr[i * 3 + 2] = 130;
      }
      sp.geometry.getAttribute('position').needsUpdate = true;
      sp.visible = p < 1.05;
      sparkMat.opacity = p < 0.9 ? 1 : clamp((1.05 - p) / 0.15, 0, 1);
      sparkMat.size = Math.max(9, layout.heightPx * 0.05);
      const grow = clamp((p - 0.7) / 0.3, 0, 1);
      pg.scale.setScalar(Math.max(0.0001, easeOutBack(grow)));
      if (p >= 1.05 && !r.done) { r.done = true; reveal.current = null; r.resolve(); }
    }

    /* DOM followers: speech bubble over the head, poke button over the body. */
    const top = pos.current.y - heightPx * 1.02;
    const bubble = bubbleRef.current;
    if (bubble) {
      const bw = bubble.offsetWidth;
      const bh = bubble.offsetHeight;
      const left = clamp(pos.current.x - bw / 2, 12, Math.max(12, W - bw - 12));
      const y = Math.max(64, top - bh - 6);
      bubble.style.transform = `translate3d(${left.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      bubble.style.setProperty('--tail-x', `${clamp(pos.current.x - left, 22, bw - 22).toFixed(1)}px`);
    }
    const hit = hitRef.current;
    if (hit) {
      const hw = heightPx * 0.8;
      hit.style.width = `${hw}px`;
      hit.style.height = `${heightPx}px`;
      hit.style.transform = `translate3d(${(pos.current.x - hw / 2).toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
    }
  });

  return (
    <>
      <hemisphereLight args={['#dfe6ff', '#2a1d4a', 1.6]} />
      <directionalLight position={[300, 600, 900]} intensity={2.2} />
      <directionalLight position={[-600, 200, 400]} intensity={0.9} color="#a78bfa" />
      <mesh ref={floor} material={floorMat} renderOrder={0}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      {model !== null && (
        <group ref={rig}>
          <primitive object={model.scene} />
        </group>
      )}
      <mesh ref={beamMesh} material={beamMat} visible={false} renderOrder={5}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <group ref={propGroup} visible={false} />
      <points ref={sparks} geometry={sparkGeo} material={sparkMat} visible={false} frustumCulled={false} renderOrder={6} />
    </>
  );
}

export default function BeamyStage(props: Props) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-hidden>
      <Canvas
        orthographic
        dpr={[1, 2]}
        events={noopEvents}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0, 1000], near: 1, far: 3000, zoom: 1 }}
        // R3F's wrapper sets pointer-events:auto; Beamy walks OVER the cards,
        // so every tap must fall through to them.
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
