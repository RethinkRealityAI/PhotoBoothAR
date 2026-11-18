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
 * Brand v2: the beam is the one expressive light on the page (white into
 * periwinkle with an amber-white core); sparks and motes use the same calm
 * palette, never the old seven-hue spectrum.
 *
 * Micro-interactions (all driven by the page through BeamyApi): `look` turns
 * his head/body toward the pointer (eyes are baked into the texture, so it is
 * a small turn plus a lid squint when the pointer is close); `drag*` spins him
 * around Y with inertia and a springy settle to front (spin physics are pure,
 * in lib/brandLanding); `sparkle`/`spin` escalate pokes; `drift` raises a hand
 * and sends light motes to a card; `arrive` drops a beam from the top of the
 * viewport and he appears where it lands.
 *
 * Liquid-glass scene: a deep-indigo contact shadow grounds him on the panel's
 * floor; a few frosted, faceted crystals (one flat-shaded physical material,
 * no transmission pass) sit around the glass panel the page reports through
 * `decorRef`, bob slowly and parallax with the pointer (nearer = more). The
 * `Selfie` clip plays HERE, on the one canvas: `selfie()` streams the phone
 * and head positions (and the snap-frame portrait) to the page's overlays.
 *
 * Reduced motion (`reducedMotion` prop): no particles, no beam drop, no
 * inertia, static crystals; every state change still happens (he still
 * appears, the card still changes, the prop still shows). His clips still
 * play: each answers a tap.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { gltfLoader, loadModel } from '../../lib/glbCache';
import { SPIN_PER_PX, nearestFront, spinSettled, spinStep, type Spin } from '../../lib/brandLanding';
import { SELFIE_CLIP, selfieTimeline, type SelfieTimeline } from '../../lib/beamySelfie';
import type { Rect } from '../../lib/beamGeometry';
import { snapshotPortrait } from '../../components/beamy/selfieFx';

export type BeamyClip = 'Idle' | 'Wave' | 'Hop' | 'BeamyBlast' | 'Sob' | 'SideEye' | 'Dance' | 'ShadesOn' | 'Waddle' | typeof SELFIE_CLIP;

export interface Pt { x: number; y: number; }

/** Where Beamy rests and how tall he is there (viewport px, feet point). */
export interface StageLayout { home: Pt; heightPx: number; }

/**
 * The scene's decor, set by the page: the glass panel's rect (crystals sit
 * around its corners) and whether this stop is the hero (which gets the full
 * set; the other stops keep only the crystals outside the panel).
 */
export interface StageDecor { panel: Rect | null; hero: boolean; phone: boolean; }

/** One frame of the Selfie clip on the stage, for the page's DOM overlays. */
export interface SelfieFrame {
  /** Clip seconds. */
  t: number;
  tl: SelfieTimeline;
  /** The phone's screen and the top of his head, viewport px. */
  phone: Pt;
  head: Pt;
  heightPx: number;
  /** Beamy's own portrait, on the snap frame only (null if the canvas could not be read). */
  photo?: string | null;
}

export interface BeamyApi {
  /** Walk until the feet stand on `to`; `size` scales Beamy on the way (1 = home size). */
  walkTo(to: Pt, size?: number): Promise<void>;
  goHome(): Promise<void>;
  /** Play a clip once, then settle back to Idle. */
  play(clip: BeamyClip): Promise<void>;
  /** Turn toward a viewport x (null = face the viewer). */
  face(x: number | null): void;
  /** Beam at `to`; `onFire` runs the moment the beam lights. Resolves when the clip ends.
   *  from 'mouth' = the BeamyBlast; 'hand' = a thinner beam from the raised (waving) hand. */
  beam(to: Pt, onFire?: () => void, from?: 'mouth' | 'hand'): Promise<void>;
  /** Particles stream from the mouth (or raised hand) and a library prop materialises at `at`. */
  reveal(url: string, at: Pt, sizePx: number, from?: 'mouth' | 'hand'): Promise<void>;
  clearProp(): void;
  /** Mouth position in viewport px. */
  mouth(): Pt;
  /** Tip of the waving hand in viewport px. */
  hand(): Pt;
  /** Current feet position + live height, viewport px. */
  where(): Pt & { heightPx: number };
  /** Raise a hand; light motes drift from it to `to`. Resolves as they land. */
  drift(to: Pt): Promise<void>;
  /** The entrance: a beam drops from the top of the viewport onto his home,
   *  a flash, and he appears there. Resolves when he is standing. */
  arrive(): Promise<void>;
  /** Poke feedback: a few sparkles, or a light burst. */
  sparkle(level: 'sparkle' | 'burst'): void;
  /** A celebratory spin (adds angular velocity). */
  spin(): void;
  /** Gaze target in viewport px (null = look at the viewer). */
  look(p: Pt | null): void;
  /** Drag-to-spin, fed by the page's hit area (px since the drag started). */
  dragStart(): void;
  dragMove(dxPx: number): void;
  dragEnd(velocity: number): void;
  /**
   * Play the Selfie clip here (no second canvas). `onFrame` runs every frame
   * of the clip so the page can draw the flash and the photo card; the snap
   * frame carries his portrait. Resolves true at the clip's end, false if
   * another clip (or `stopSelfie`) cut it short.
   */
  selfie(onFrame: (f: SelfieFrame) => void): Promise<boolean>;
  stopSelfie(): void;
  /** Finish an `arrive()` in flight at once (a click skips the intro). */
  skipArrival(): void;
  /** His portrait right now, no clip (reduced motion's selfie); null if the canvas cannot be read. */
  portrait(): string | null;
}

interface Props {
  apiRef: MutableRefObject<BeamyApi | null>;
  layoutRef: MutableRefObject<StageLayout>;
  /** Speech bubble, positioned over Beamy's head every frame. */
  bubbleRef: MutableRefObject<HTMLDivElement | null>;
  /** Invisible "poke Beamy" button kept over his body. */
  hitRef: MutableRefObject<HTMLButtonElement | null>;
  /** Crystals around the glass panel. */
  decorRef: MutableRefObject<StageDecor>;
  /** Hidden until `arrive()` (the intro's beam drop). */
  startHidden?: boolean;
  reducedMotion?: boolean;
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
  float hot = exp(-across * across * 60.0);
  float flow = 0.85 + 0.15 * sin(vUv.x * 40.0 - uTime * 30.0);
  float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  // Brand v2: periwinkle aura, white core, an amber-white hot centre line.
  vec3 beam = vec3(0.557, 0.588, 1.0);
  vec3 amber = vec3(1.0, 0.90, 0.72);
  vec3 col = beam * aura * flow + vec3(1.0) * core * 0.9 + amber * hot * 0.6;
  gl_FragColor = vec4(col, (aura * 0.7 + core) * ends * uAlpha);
}`;

/* ── Contact shadow: a soft deep-indigo ellipse that grounds him ───────── */

const FLOOR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uAlpha;
void main() {
  float d = length((vUv - 0.5) * 2.0);
  float core = exp(-d * d * 5.5);                  // dense right under the feet
  float soft = smoothstep(1.0, 0.0, d) * 0.35;      // a wide, faint penumbra
  gl_FragColor = vec4(vec3(0.102, 0.090, 0.251), (core * 0.5 + soft * 0.4) * uAlpha);
}`;

/* ── Crystals: faceted, frosted decor around the glass panel ───────────── */

type CrystalKind = 'ico' | 'oct' | 'cone';
interface CrystalSpec {
  kind: CrystalKind;
  /** Anchor as a fraction of the panel rect (may sit outside it), or beside Beamy's feet. */
  at: { panel: [number, number] } | { beamy: number };
  /** Size as a fraction of min(panel width, height) (beside Beamy: of his height). */
  size: number;
  /** 0 far … 1 near: how far it parallaxes with the pointer. */
  depth: number;
  phone: boolean;
  /** Only on the hero (the others may cover a stop's content). */
  heroOnly: boolean;
}
const CRYSTALS: CrystalSpec[] = [
  { kind: 'ico', at: { panel: [-0.012, -0.05] }, size: 0.15, depth: 0.25, phone: true, heroOnly: false },
  { kind: 'oct', at: { panel: [1.015, 1.05] }, size: 0.16, depth: 0.35, phone: true, heroOnly: false },
  // Beside his feet, below the wall's frame; off on phones, where the wall stands right next to him.
  { kind: 'cone', at: { beamy: 0.66 }, size: 0.2, depth: 0.9, phone: false, heroOnly: true },
  { kind: 'ico', at: { panel: [0.6, 0.16] }, size: 0.05, depth: 0.7, phone: false, heroOnly: true },
  { kind: 'oct', at: { panel: [0.33, 0.9] }, size: 0.035, depth: 0.55, phone: false, heroOnly: true },
];
const CRYSTAL_PARALLAX_PX = 22;

/* ── Impact / poke flash: a soft radial bloom ──────────────────────────── */

const FLASH_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAlpha;
void main() {
  float d = length((vUv - 0.5) * 2.0);
  float core = exp(-d * d * 9.0);
  float ring = exp(-pow((d - 0.62) * 9.0, 2.0)) * 0.45;
  vec3 col = mix(vec3(0.557, 0.588, 1.0), vec3(1.0, 0.95, 0.86), core);
  gl_FragColor = vec4(col, (core + ring) * smoothstep(1.0, 0.8, d) * uAlpha);
}`;

/** Spark / mote palette: beam, white, beam-hover, one amber. */
const LIGHT_PALETTE = ['#8E96FF', '#FFFFFF', '#A5ABFF', '#FFC56B', '#FFFFFF', '#8E96FF'];

/* ── Particles for the prop reveal ─────────────────────────────────────── */

const N_SPARKS = 520;

/* ── Motes: a small pool for hand drift + poke sparkles/bursts ─────────── */

const N_MOTES = 96;

interface Mote {
  /** <0 = waiting (delay), 0..1 = alive. */
  t: number;
  life: number;
  x0: number; y0: number; x1: number; y1: number;
  /** Arc bow (perpendicular px at mid-flight). */
  bow: number;
  active: boolean;
}

const DROP_S = 0.9;
const FLASH_S = 0.45;

interface Reveal {
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Per-spark scatter offset + delay. */
  seeds: Float32Array;
  resolve: () => void;
  done: boolean;
  /** Stream from the raised hand instead of the mouth. */
  hand: boolean;
}

/* ── The scene ─────────────────────────────────────────────────────────── */

function Scene({ apiRef, layoutRef, bubbleRef, hitRef, decorRef, startHidden = false, reducedMotion = false, onReady, onError }: Props) {
  const { size, gl, scene, camera } = useThree();
  const glRef = useRef({ gl, scene, camera });
  glRef.current = { gl, scene, camera };
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const flashMesh = useRef<THREE.Mesh>(null);
  const motesRef = useRef<THREE.Points>(null);
  const handBone = useRef<THREE.Object3D | null>(null);
  const handLocal = useRef(new THREE.Vector3(0, -0.12, 0));
  const lids = useRef<THREE.Object3D[]>([]);
  const shown = useRef(!startHidden);
  const appear = useRef(startHidden ? 0 : 1);
  const arrival = useRef<{ t: number; landed: boolean; resolve: () => void } | null>(null);
  const flash = useRef<{ t: number; at: Pt; sizePx: number } | null>(null);
  const motes = useRef<Mote[]>(Array.from({ length: N_MOTES }, () => ({ t: 0, life: 1, x0: 0, y0: 0, x1: 0, y1: 0, bow: 0, active: false })));
  const gazeTarget = useRef<Pt | null>(null);
  const gaze = useRef({ yaw: 0, pitch: 0, near: 0 });
  const spinS = useRef<Spin & { dragging: boolean; base: number }>({ angle: 0, vel: 0, dragging: false, base: 0 });

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
  const beamState = useRef<{ to: Pt; t: number; fired: boolean; onFire?: () => void; from: 'mouth' | 'hand' } | null>(null);
  const reveal = useRef<Reveal | null>(null);
  const propSpin = useRef(0);
  const bodyBone = useRef<THREE.Object3D | null>(null);
  const phoneBone = useRef<THREE.Object3D | null>(null);
  const selfieRun = useRef<{ t: number; tl: SelfieTimeline; snapped: boolean; action: THREE.AnimationAction; onFrame: (f: SelfieFrame) => void; resolve: (done: boolean) => void } | null>(null);
  const crystalRefs = useRef<(THREE.Mesh | null)[]>([]);
  /** Pointer parallax, lerped (−1..1 on each axis). */
  const parallax = useRef({ x: 0, y: 0 });

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
          // Two nodes are named `phone` (the bone and its skinned mesh); the
          // bone is the hand. Every clip keys its scale (0 except in Selfie),
          // but the loaded REST pose is scale 1: zero it so the phone can
          // never flash on before the first mixer update.
          if ((o as THREE.Bone).isBone && o.name === 'phone') { phoneBone.current = o; o.scale.setScalar(0); }
          if ((o as THREE.Bone).isBone && o.name === 'body') bodyBone.current = o;
        });
        mouthNode.current = g.scene.getObjectByName('beam') ?? null;
        // Lids are bones animated by every clip (scale.y 0.02 = open, 1 =
        // shut); the frame loop nudges them after the mixer for the squint.
        lids.current = ['lid.L', 'lid.R'].map((n) => g.scene.getObjectByName(n)).filter((o): o is THREE.Object3D => o !== undefined && !(o instanceof THREE.Mesh));
        // The waving hand: arm.R (Wave raises it). Its tip is the bound vertex
        // farthest from the shoulder, measured once in the bind pose.
        const arm = g.scene.getObjectByName('arm.R') ?? null;
        handBone.current = arm;
        if (arm !== null) {
          g.scene.updateMatrixWorld(true);
          g.scene.traverse((o) => {
            if (!(o instanceof THREE.SkinnedMesh)) return;
            const bi = o.skeleton.bones.indexOf(arm as THREE.Bone);
            if (bi < 0) return;
            const pos = o.geometry.getAttribute('position');
            const si = o.geometry.getAttribute('skinIndex');
            const sw = o.geometry.getAttribute('skinWeight');
            if (!pos || !si || !sw) return;
            const inv = new THREE.Matrix4().copy(arm.matrixWorld).invert();
            const v = new THREE.Vector3();
            let best = -1;
            for (let i = 0; i < pos.count; i++) {
              let w = 0;
              for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
              if (w < 0.6) continue;
              // Loaded pose = bind pose, so skinning is identity: world = matrixWorld · v.
              v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
              const d = v.lengthSq();
              if (d > best) { best = d; handLocal.current.copy(v); }
            }
          });
        }
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

  /** Launch one mote (viewport px). `delay` ≤ 0 seconds; a full pool drops the extra. */
  const emitMote = (x0: number, y0: number, x1: number, y1: number, life: number, delay: number, bow: number) => {
    const m = motes.current.find((q) => !q.active);
    if (m === undefined) return;
    Object.assign(m, { x0, y0, x1, y1, life, t: delay / life, bow, active: true });
  };

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
        yawTarget.current = clamp((x - pos.current.x) / 260, -1, 1) * 0.6;
      },
      beam(to, onFire, from = 'mouth') {
        beamState.current = { to: { ...to }, t: 0, fired: false, onFire, from };
        api.face(to.x);
        return playOnce(from === 'hand' ? 'Wave' : 'BeamyBlast').then(() => {
          // A clip shorter than the window still owes its onFire.
          const b = beamState.current;
          if (b !== null && !b.fired) { b.fired = true; b.onFire?.(); }
          beamState.current = null; yawTarget.current = 0;
        });
      },
      reveal(url, at, sizePx, from = 'mouth') {
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
          const m = from === 'hand' ? api.hand() : api.mouth();
          const mw = toWorld(m);
          api.face(at.x);
          if (reducedRef.current) {
            // No particles: the prop simply appears, full size.
            g.scale.setScalar(1);
            void playOnce('Hop').then(resolve);
            return;
          }
          reveal.current = {
            t: 0,
            from: new THREE.Vector3(mw.x, mw.y, 130),
            to: new THREE.Vector3(w.x, w.y, 130),
            seeds,
            resolve,
            done: false,
            hand: from === 'hand',
          };
          void playOnce(from === 'hand' ? 'Wave' : 'Hop');
        }), () => undefined);
      },
      hand() {
        const b = handBone.current;
        if (b === null) {
          const h = layoutRef.current.heightPx * scale.current;
          return { x: pos.current.x - h * 0.4, y: pos.current.y - h * 0.7 };
        }
        const v = b.localToWorld(handLocal.current.clone());
        return toScreen(v);
      },
      drift(to) {
        api.face(to.x);
        if (reducedRef.current) return playOnce('Wave');
        return new Promise<void>((resolve) => {
          void playOnce('Wave');
          // Emit once the hand is up (Wave raises it over ~0.35s).
          window.setTimeout(() => {
            const h = api.hand();
            const n = 26;
            let fired = false;
            for (let i = 0; i < n; i++) {
              const life = 0.85 + Math.random() * 0.35;
              emitMote(h.x + (Math.random() - 0.5) * 10, h.y + (Math.random() - 0.5) * 10,
                to.x + (Math.random() - 0.5) * 60, to.y + (Math.random() - 0.5) * 30,
                life, -Math.random() * 0.3, (Math.random() - 0.3) * 120);
            }
            window.setTimeout(() => { if (!fired) { fired = true; resolve(); } }, 900);
          }, 350);
        });
      },
      arrive() {
        if (reducedRef.current || shown.current) {
          shown.current = true;
          appear.current = 1;
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => { arrival.current = { t: 0, landed: false, resolve }; });
      },
      sparkle(level) {
        if (reducedRef.current) return;
        const h = layoutRef.current.heightPx * scale.current;
        const cx = pos.current.x;
        const cy = pos.current.y - h * 0.55;
        const n = level === 'burst' ? 44 : 12;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = h * (level === 'burst' ? 0.55 + Math.random() * 0.45 : 0.35 + Math.random() * 0.25);
          emitMote(cx + Math.cos(a) * h * 0.15, cy + Math.sin(a) * h * 0.15, cx + Math.cos(a) * r, cy + Math.sin(a) * r,
            0.5 + Math.random() * 0.35, -Math.random() * 0.08, 0);
        }
        if (level === 'burst') flash.current = { t: 0, at: { x: cx, y: cy }, sizePx: h * 1.6 };
      },
      spin() {
        if (reducedRef.current) return;
        spinS.current.vel += 22;
      },
      look(p) {
        gazeTarget.current = p === null ? null : { ...p };
      },
      dragStart() {
        const s = spinS.current;
        s.dragging = true;
        s.vel = 0;
        s.base = s.angle;
      },
      dragMove(dxPx) {
        const s = spinS.current;
        if (!s.dragging) return;
        s.angle = s.base + dxPx * SPIN_PER_PX;
      },
      dragEnd(velocity) {
        const s = spinS.current;
        s.dragging = false;
        if (reducedRef.current) { s.angle = nearestFront(s.angle); s.vel = 0; return; }
        s.vel = velocity;
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
      selfie(onFrame) {
        api.stopSelfie();
        if (actions.current[SELFIE_CLIP] === undefined) return Promise.resolve(false); // an old GLB
        yawTarget.current = 0;
        void playOnce(SELFIE_CLIP);
        const action = current.current;
        if (action === null) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
          selfieRun.current = { t: 0, tl: selfieTimeline(reducedRef.current), snapped: false, action, onFrame, resolve };
        });
      },
      stopSelfie() {
        const run = selfieRun.current;
        if (run === null) return;
        selfieRun.current = null;
        if (current.current === run.action) fadeTo('Idle', false);
        run.resolve(false);
      },
      portrait() {
        const h = layoutRef.current.heightPx * scale.current;
        try {
          const r = glRef.current;
          r.gl.render(r.scene, r.camera);
          return snapshotPortrait(r.gl.domElement, { x: pos.current.x, y: pos.current.y - h * 1.07 }, h * 1.45, sizeRef.current.width);
        } catch {
          return null;
        }
      },
      skipArrival() {
        const ar = arrival.current;
        shown.current = true;
        appear.current = 1;
        if (ar === null) return;
        arrival.current = null;
        ar.resolve();
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
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
    transparent: true,
    depthWrite: false,
  }), []);
  const flashMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: FLASH_FRAG,
    uniforms: { uAlpha: { value: 0 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);
  const sparkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_SPARKS * 3), 3));
    const col = new Float32Array(N_SPARKS * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N_SPARKS; i++) {
      c.set(LIGHT_PALETTE[i % LIGHT_PALETTE.length]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  /** Mote colours are rewritten per frame (base colour × fade, additive). */
  const moteBase = useMemo(() => {
    const c = new THREE.Color();
    const out = new Float32Array(N_MOTES * 3);
    for (let i = 0; i < N_MOTES; i++) { c.set(LIGHT_PALETTE[i % LIGHT_PALETTE.length]); out.set([c.r, c.g, c.b], i * 3); }
    return out;
  }, []);
  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_MOTES * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N_MOTES * 3), 3));
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
  const moteMat = useMemo(() => new THREE.PointsMaterial({
    size: 9, vertexColors: true, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: false, map: sparkTex,
  }), [sparkTex]);
  /** Frosted, faceted, a hint of iridescence. No transmission pass (phones). */
  const crystalMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#E4E9FF', roughness: 0.24, metalness: 0, flatShading: true,
    clearcoat: 0.6, clearcoatRoughness: 0.25,
    iridescence: 0.7, iridescenceIOR: 1.35, iridescenceThicknessRange: [160, 520],
    emissive: '#4F4BC0', emissiveIntensity: 0.28,
  }), []);
  const crystalGeos = useMemo<Record<CrystalKind, THREE.BufferGeometry>>(() => ({
    ico: new THREE.IcosahedronGeometry(0.5, 1),
    oct: new THREE.OctahedronGeometry(0.5, 0),
    cone: new THREE.ConeGeometry(0.3, 0.9, 6),
  }), []);
  useEffect(() => () => {
    beamMat.dispose(); floorMat.dispose(); flashMat.dispose(); sparkGeo.dispose(); sparkMat.dispose();
    sparkTex.dispose(); moteGeo.dispose(); moteMat.dispose(); crystalMat.dispose();
    for (const g of Object.values(crystalGeos)) g.dispose();
  }, [beamMat, floorMat, flashMat, sparkGeo, sparkMat, sparkTex, moteGeo, moteMat, crystalMat, crystalGeos]);

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
    } else if (!shown.current) {
      // Not arrived yet: stand exactly where the beam will land.
      pos.current = { ...layout.home };
    } else if (reveal.current === null && beamState.current === null) {
      // Idle at home: follow layout changes (resize, rotation, section moves).
      const atHomeScale = Math.abs(scale.current - 1) < 0.02;
      if (atHomeScale) {
        const h = layout.home;
        pos.current = { x: pos.current.x + (h.x - pos.current.x) * Math.min(1, dt * 4), y: pos.current.y + (h.y - pos.current.y) * Math.min(1, dt * 4) };
      }
    }
    yaw.current += (yawTarget.current - yaw.current) * Math.min(1, dt * 7);

    const heightPx = layout.heightPx * scale.current;
    const reduced = reducedRef.current;

    /* Entrance: the beam drops, a flash, he grows in where it landed. */
    const ar = arrival.current;
    if (ar !== null) {
      ar.t += dt;
      if (!ar.landed && ar.t >= DROP_S) {
        ar.landed = true;
        shown.current = true;
        flash.current = { t: 0, at: { x: pos.current.x, y: pos.current.y - heightPx * 0.42 }, sizePx: heightPx * 2.2 };
      }
      if (ar.t >= DROP_S + 0.6) { arrival.current = null; ar.resolve(); }
    }
    if (shown.current && appear.current < 1) appear.current = reduced ? 1 : Math.min(1, appear.current + dt / 0.5);

    /* Gaze: a small head/body turn toward the pointer (off under reduced motion). */
    const gt = gazeTarget.current;
    const spinNow = spinS.current;
    let gy = 0, gp = 0, near = 0;
    if (gt !== null && !reduced && w === null && beamState.current === null && selfieRun.current === null && !spinNow.dragging) {
      const dx = gt.x - pos.current.x;
      const dy = gt.y - (pos.current.y - heightPx * 0.62);
      gy = clamp(dx / 700, -1, 1) * 0.42;
      gp = clamp(dy / 600, -1, 1) * 0.16;
      near = clamp(1 - (Math.hypot(dx, dy) - heightPx * 0.35) / (heightPx * 0.6), 0, 1);
    }
    const gz = gaze.current;
    gz.yaw += (gy - gz.yaw) * Math.min(1, dt * 5);
    gz.pitch += (gp - gz.pitch) * Math.min(1, dt * 5);
    gz.near += (near - gz.near) * Math.min(1, dt * 6);

    /* Drag spin: inertia, then a springy settle to front (pure physics). */
    if (!spinNow.dragging) {
      if (spinSettled(spinNow)) { spinNow.angle = 0; spinNow.vel = 0; }
      else { const n = spinStep(spinNow, dt); spinNow.angle = n.angle; spinNow.vel = n.vel; }
    }

    const s = heightPx / MODEL_H;
    const g = rig.current;
    if (g) {
      const wp = toWorld(pos.current);
      g.position.set(wp.x, wp.y, 0);
      const grow = s * Math.max(0.0001, reduced ? appear.current : easeOutBack(appear.current));
      // Landing squash: wide-and-short for a beat, then springs upright.
      const k = appear.current;
      const sq = reduced || k >= 1 ? 0 : Math.sin(Math.PI * k) * (1 - k) * 0.55;
      g.scale.set(grow * (1 + sq * 0.35), grow * (1 - sq * 0.35), grow * (1 + sq * 0.35));
      g.rotation.y = yaw.current + gz.yaw + spinNow.angle;
      g.rotation.x = gz.pitch;
      g.visible = shown.current;
    }
    if (floor.current) {
      const wp = toWorld(pos.current);
      floor.current.position.set(wp.x, wp.y + heightPx * 0.012, -200);
      floor.current.scale.set(heightPx * 0.92, heightPx * 0.15, 1);
    }
    (floorMat.uniforms.uTime as { value: number }).value = t;
    (floorMat.uniforms.uAlpha as { value: number }).value = appear.current;
    mixer.current?.update(dt);

    /* The Selfie clip on this stage: hand the page this frame's phone/head
       (and, on the snap frame, his portrait) for its flash + photo card. */
    const run = selfieRun.current;
    if (run !== null) {
      if (current.current !== run.action) {
        selfieRun.current = null;
        run.resolve(false);
      } else {
        run.t += dt;
        const pw = new THREE.Vector3();
        if (phoneBone.current) phoneBone.current.getWorldPosition(pw); else pw.set(toWorld(pos.current).x - heightPx * 0.55, toWorld(pos.current).y + heightPx * 0.75, 0);
        pw.y += 0.05 * s; // the bone is the grip; the screen sits above it
        const hw = new THREE.Vector3();
        if (bodyBone.current) { bodyBone.current.getWorldPosition(hw); hw.y += 0.52 * s; } else hw.set(toWorld(pos.current).x, toWorld(pos.current).y + heightPx * 1.07, 0);
        const frame: SelfieFrame = { t: run.t, tl: run.tl, phone: toScreen(pw), head: toScreen(hw), heightPx };
        if (!run.snapped && run.t >= run.tl.cues.snap) {
          run.snapped = true;
          try {
            // Render now so the drawing buffer is valid for this task: his own selfie.
            state.gl.render(state.scene, state.camera);
            frame.photo = snapshotPortrait(state.gl.domElement, frame.head, heightPx * 1.45, W);
          } catch {
            frame.photo = null;
          }
        }
        run.onFrame(frame);
        if (run.t >= run.tl.cues.end) { selfieRun.current = null; run.resolve(true); }
      }
    }

    /* Crystals: anchored around the panel (and one on Beamy's floor), bobbing
       slowly; nearer ones parallax more with the pointer. Static if reduced. */
    const dec = decorRef.current;
    const par = parallax.current;
    const H = sizeRef.current.height;
    const ptr = gazeTarget.current;
    const tx = ptr !== null && !reduced ? clamp((ptr.x / Math.max(1, W)) * 2 - 1, -1, 1) : 0;
    const ty = ptr !== null && !reduced ? clamp((ptr.y / Math.max(1, H)) * 2 - 1, -1, 1) : 0;
    par.x += (tx - par.x) * Math.min(1, dt * 2.2);
    par.y += (ty - par.y) * Math.min(1, dt * 2.2);
    for (let i = 0; i < CRYSTALS.length; i++) {
      const m = crystalRefs.current[i];
      if (!m) continue;
      const c = CRYSTALS[i];
      const panel = dec.panel;
      const on = panel !== null && (dec.hero || !c.heroOnly) && (!dec.phone || c.phone) && ('panel' in c.at || shown.current);
      m.visible = on;
      if (!on || panel === null) continue;
      let x: number;
      let y: number;
      let size: number;
      if ('panel' in c.at) {
        size = Math.min(panel.width, panel.height) * c.size * (dec.phone ? 0.75 : 1);
        x = panel.left + panel.width * c.at.panel[0];
        y = panel.top + panel.height * c.at.panel[1];
      } else {
        size = layout.heightPx * c.size;
        x = layout.home.x + layout.heightPx * c.at.beamy;
        y = layout.home.y - size * 0.3;
      }
      const bob = reduced ? 0 : Math.sin(t * 0.7 + i * 1.9) * 5 * (0.4 + c.depth);
      x += par.x * CRYSTAL_PARALLAX_PX * c.depth;
      y += par.y * CRYSTAL_PARALLAX_PX * c.depth * 0.6 + bob;
      const cw = toWorld({ x, y });
      m.position.set(cw.x, cw.y, -120 + c.depth * 60);
      m.scale.setScalar(Math.max(1, size));
      if (!reduced) {
        m.rotation.y += dt * (0.16 + (i % 3) * 0.06);
        m.rotation.x = (c.kind === 'cone' ? 2.6 : 0.4) + Math.sin(t * 0.45 + i) * 0.12;
      } else {
        m.rotation.set(c.kind === 'cone' ? 2.6 : 0.4, 0.6 + i, c.kind === 'cone' ? 0.5 : 0);
      }
      if (c.kind === 'cone') m.rotation.z = 0.5;
    }

    /* Lids (after the mixer): squint when the pointer is close, wide open while dragged. */
    for (const lid of lids.current) {
      if (spinNow.dragging) lid.scale.y = 0.02;
      else if (gz.near > 0.01) lid.scale.y = Math.max(lid.scale.y, 0.02 + gz.near * 0.42);
    }

    /* Beam quad: Beamy's own beam, or the entrance drop from the top. */
    const b = beamState.current;
    const bm = beamMesh.current;
    if (bm) {
      let alpha = 0;
      if (b !== null) {
        const hand = b.from === 'hand';
        const fireS = hand ? 0.45 : BEAM_FIRE_S;
        const endS = hand ? 1.15 : BEAM_END_S;
        b.t += dt;
        if (!b.fired && b.t >= fireS) { b.fired = true; b.onFire?.(); }
        if (b.t >= fireS && b.t <= endS + 0.2) {
          const k = b.t - fireS;
          alpha = Math.min(1, k / 0.12) * Math.min(1, (endS + 0.2 - b.t) / 0.25);
          const origin = hand ? apiRef.current?.hand() : apiRef.current?.mouth();
          const m = toWorld(origin ?? pos.current);
          const to = toWorld(b.to);
          const len = Math.hypot(to.x - m.x, to.y - m.y);
          bm.position.set((m.x + to.x) / 2, (m.y + to.y) / 2, 300);
          bm.rotation.z = Math.atan2(to.y - m.y, to.x - m.x);
          const width = (hand ? Math.max(14, heightPx * 0.1) : Math.max(26, heightPx * 0.22)) * (1 + 0.06 * Math.sin(t * 40));
          bm.scale.set(Math.max(1, len), width, 1);
        }
      } else if (ar !== null) {
        // Head of the column falls from above the viewport to his feet (ease-in),
        // then the full column lingers and fades as he appears.
        const fall = clamp(ar.t / DROP_S, 0, 1);
        const topY = -60;
        const headY = topY + (pos.current.y - topY) * fall * fall;
        const fade = ar.landed ? clamp(1 - (ar.t - DROP_S) / 0.5, 0, 1) : 1;
        alpha = Math.min(1, ar.t / 0.12) * fade;
        const a = toWorld({ x: pos.current.x, y: topY });
        const z = toWorld({ x: pos.current.x, y: headY });
        const len = Math.max(1, a.y - z.y);
        bm.position.set(a.x, (a.y + z.y) / 2, 300);
        bm.rotation.z = -Math.PI / 2;
        bm.scale.set(len, Math.max(22, layout.heightPx * 0.16) * (ar.landed ? 1 + (ar.t - DROP_S) * 1.2 : 1), 1);
      }
      bm.visible = alpha > 0.001;
      (beamMat.uniforms.uAlpha as { value: number }).value = alpha;
      (beamMat.uniforms.uTime as { value: number }).value = t;
    }

    /* Flash: impact bloom / poke burst. */
    const fl = flash.current;
    const fm = flashMesh.current;
    if (fm) {
      let fa = 0;
      if (fl !== null) {
        fl.t += dt / FLASH_S;
        const k = clamp(fl.t, 0, 1);
        fa = (1 - k) * (1 - k);
        const wp = toWorld(fl.at);
        fm.position.set(wp.x, wp.y, 320);
        const sz = fl.sizePx * (0.55 + 0.55 * (1 - (1 - k) ** 3));
        fm.scale.set(sz, sz, 1);
        if (fl.t >= 1) flash.current = null;
      }
      fm.visible = fa > 0.001;
      (flashMat.uniforms.uAlpha as { value: number }).value = fa;
    }

    /* Motes: hand drift + poke sparkles. */
    const mp = motesRef.current;
    if (mp) {
      const parr = (mp.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const carr = (mp.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
      let any = false;
      const list = motes.current;
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        let a = 0;
        if (m.active) {
          m.t += dt / m.life;
          if (m.t >= 1) m.active = false;
          else {
            any = true;
            const k = clamp(m.t, 0, 1);
            const e = 1 - (1 - k) ** 3;
            const dx = m.x1 - m.x0, dy = m.y1 - m.y0;
            const len = Math.hypot(dx, dy) || 1;
            const bow = Math.sin(Math.PI * e) * m.bow;
            const p = toWorld({ x: m.x0 + dx * e - (dy / len) * bow, y: m.y0 + dy * e + (dx / len) * bow });
            parr[i * 3] = p.x; parr[i * 3 + 1] = p.y; parr[i * 3 + 2] = 330;
            a = m.t <= 0 ? 0 : Math.sin(Math.PI * k) ** 0.6;
          }
        }
        carr[i * 3] = moteBase[i * 3] * a;
        carr[i * 3 + 1] = moteBase[i * 3 + 1] * a;
        carr[i * 3 + 2] = moteBase[i * 3 + 2] * a;
      }
      mp.visible = any;
      if (any) {
        mp.geometry.getAttribute('position').needsUpdate = true;
        mp.geometry.getAttribute('color').needsUpdate = true;
        moteMat.size = Math.max(8, layout.heightPx * 0.045);
      }
    }

    /* Prop reveal: sparks out of the mouth (or hand), swirl, collapse into the prop. */
    const r = reveal.current;
    const pg = propGroup.current;
    const sp = sparks.current;
    if (pg && pg.visible && !reduced) {
      propSpin.current += dt * 0.9;
      pg.rotation.y = propSpin.current;
      pg.rotation.x = Math.sin(t * 1.3) * 0.12;
    }
    if (r !== null && sp && pg) {
      r.t += dt;
      const TOTAL = 2.1;
      const p = r.t / TOTAL;
      const arr = (sp.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const mouthNow = toWorld((r.hand ? apiRef.current?.hand() : apiRef.current?.mouth()) ?? pos.current);
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
      {CRYSTALS.map((c, i) => (
        <mesh
          key={i}
          ref={(m) => { crystalRefs.current[i] = m; }}
          geometry={crystalGeos[c.kind]}
          material={crystalMat}
          visible={false}
          frustumCulled={false}
          renderOrder={1}
        />
      ))}
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
      <points ref={motesRef} geometry={moteGeo} material={moteMat} visible={false} frustumCulled={false} renderOrder={7} />
      <mesh ref={flashMesh} material={flashMat} visible={false} renderOrder={8}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </>
  );
}

export default function BeamyStage(props: Props) {
  // DPR cap: 2 on desktop, 1.5 on phones (a full-viewport transparent canvas
  // at dpr 3 is the cost that hurts there).
  const [maxDpr] = useState(() => (Math.min(window.innerWidth, window.innerHeight) < 600 ? 1.5 : 2));
  // A hidden tab renders nothing.
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-hidden>
      <Canvas
        orthographic
        dpr={[1, maxDpr]}
        frameloop={hidden ? 'never' : 'always'}
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
