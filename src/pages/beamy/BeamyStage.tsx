/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamyStage — the full-viewport WebGL layer Beamy lives in on /beamy.
 *
 * One transparent, pointer-events-none canvas covers the whole viewport and
 * sits BEHIND the page (brand.css .bw-stage): Beamy glides between the
 * sections' slots and passes behind the content; while he stands inside the
 * hero's glass box the layer steps in front of it (`data-layer`).
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
 * Micro-interactions (all driven by the page through BeamyApi): his gaze and
 * turn come from the page and the scene only (never the pointer); `sparkle`/
 * `spin` escalate taps (the party spin settles to front with the pure physics
 * in lib/brandLanding); `drift` raises a hand
 * and sends light motes to a card; `arrive` drops a beam from the top of the
 * viewport and he appears where it lands.
 *
 * Scroll page: the page's slot/pose glide (lib/beamyScroll) writes his target
 * into `layoutRef` every frame; here he follows it with damping and a clamped
 * velocity, waddles and leans into the direction of travel while moving, and
 * settles into Idle on arrival. `presence` lets him dissolve and re-form
 * (phones, hero ↔ dock). `project()` keeps a soft projector cone on a film
 * frame the page names through a rect getter (it scrolls with the page).
 *
 * Liquid-glass scene: a deep-indigo contact shadow grounds him; a few small
 * real library props (crown, halo, tiara: the platform's own assets)
 * sit around the hero's glass panel and his hero stand, reported through
 * `decorRef`; they bob slowly and parallax with the scroll as the hero
 * leaves (nearer = more). The
 * `Selfie` clip plays HERE, on the one canvas: `selfie()` streams the phone
 * and head positions (and the snap-frame portrait) to the page's overlays.
 *
 * Reduced motion (`reducedMotion` prop): no particles, no falling beam or
 * impact flash (the entrance column fades in and out softly instead), no
 * inertia, static crystals, no parallax; every state change and the page's
 * CONTENT still happens (he still arrives, takes his selfie, the card still
 * changes, the prop still shows). His clips still play: each answers a tap.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { gltfLoader, loadModel } from '../../lib/glbCache';
import { spinSettled, spinStep, type Spin } from '../../lib/brandLanding';
import { SELFIE_CLIP, SELFIE_SPEED, selfieTimeline, type SelfieTimeline } from '../../lib/beamySelfie';
import type { Rect } from '../../lib/beamGeometry';
import { DT_MAX, K_POS, K_SOFT, dampAngle, glideStep, governDpr, type GlidePt } from '../../lib/beamyScroll';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { snapshotPortrait, snapshotRect } from '../../components/beamy/selfieFx';
import { HOME_ASSET_DEFAULTS } from '../../lib/beamyAssets';
import { fitPair, fitProp, type BeamyLook, type PropFit } from '../../lib/beamyLooks';
import { splitScenePair } from '../../lib/studio/earPair';

export type BeamyClip = 'Idle' | 'Wave' | 'Hop' | 'BeamyBlast' | 'Sob' | 'SideEye' | 'Dance' | 'ShadesOn' | 'Waddle' | typeof SELFIE_CLIP;

export interface Pt { x: number; y: number; }

/**
 * Where Beamy should be this frame (viewport px, feet point) and how tall,
 * written by the page's scroll director. He follows it smoothly.
 */
export interface StageLayout {
  home: Pt;
  heightPx: number;
  /** Settled body turn (radians) while following. */
  yaw?: number;
  /** 0..1: dissolved … all there (scales him, hides the bubble and hit area). */
  presence?: number;
  /** Standing on the hero's glossy floor: draw his reflection when he is home. */
  floor?: boolean;
  /** Lowest y (viewport px) the speech bubble's top may reach (under the sticky header). */
  bubbleMinY?: number;
  /** Put the bubble beside his head instead of above it (the phone dock). */
  bubbleSide?: boolean;
  /** Highest y (viewport px) the speech bubble's bottom may reach. */
  bubbleMaxY?: number;
  /** The bubble steps aside (he is crossing the page; it would trail over copy). */
  bubbleAway?: boolean;
  /** His tap target steps aside (mid-glide). Separate from the bubble: phones never show the bubble, but always take a tap. */
  hitAway?: boolean;
  /** Where a worn frame stands (viewport px: its top-left and height, 9:16), placed by the page
   *  (lib/beamyAssets frameOnBeamy). Absent = the frame's own geometry behind him. */
  frameAt?: { left: number; top: number; h: number } | null;
  /** How long the page's last slot read took (ms), for the ?debug readout. */
  tickMs?: number;
}

/**
 * The scene's decor, set by the page: the hero's glass panel (crystals sit
 * around its corners; null once it has scrolled away), his stand in the hero
 * (crystals around his feet), and how far the hero has scrolled (scroll
 * parallax), all viewport px.
 */
export interface StageDecor {
  panel: Rect | null;
  stand: { feet: Pt; heightPx: number } | null;
  phone: boolean;
  scroll: number;
  /** The AR props carousel's floating stops (viewport px: centre and size). The
   *  stage draws each one's real GLB there; the page's peek is a see-through
   *  button over it. Absent or empty = none. */
  peeks?: { url: string; x: number; y: number; size: number }[];
  /** The AR step, settled (absent = not on it): the stage steps in front of the
   *  page so what he wears draws OVER the frame. The page's frame images (live
   *  rect and opacity, viewport px) and its round arrows still cover HIM, as
   *  they did when the stage was behind: his body is masked where they are
   *  (see AR_MASK), never his props. */
  arOver?: {
    frames: { url: string; left: number; top: number; width: number; height: number; a: number }[];
    holes: { x: number; y: number; r: number }[];
  };
}

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
  /** He is wearing a placed frame: the photo is the whole frame (9:16), him inside its window. */
  framed: boolean;
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
  /** A short beam (no clip) from the mouth or raised hand to `to`; resolves as it fades. */
  zap(to: Pt, from?: 'mouth' | 'hand', ms?: number): Promise<void>;
  /** Particles stream from the mouth (or raised hand) and a library prop materialises at `at`
   *  (a getter keeps it on its spot while the page scrolls). `instant` = already there, no particles. */
  reveal(url: string, at: Pt | (() => Pt), sizePx: number, from?: 'mouth' | 'hand', instant?: boolean): Promise<void>;
  /** A soft projector cone from him onto the rect `target()` returns (viewport px, read every
   *  frame). `grow` = the cone reaches out over ~0.6s; resolves when it lands. */
  project(target: () => Rect | null, from: 'mouth' | 'hand', grow: boolean): Promise<void>;
  stopProject(): void;
  /** End a beam or zap in flight at once (its onFire / done still run). */
  stopBeam(): void;
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
  /**
   * Play the Selfie clip here (no second canvas). `onFrame` runs every frame
   * of the clip so the page can draw the flash and the photo card; the snap
   * frame carries his portrait. Resolves true at the clip's end, false if
   * another clip (or `stopSelfie`) cut it short. `shades: false` keeps the
   * clip's heart shades off (a selfie in a worn look shows only that look).
   */
  selfie(onFrame: (f: SelfieFrame) => void, opts?: { shades?: boolean }): Promise<boolean>;
  stopSelfie(): void;
  /** Finish an `arrive()` in flight at once (a click skips the intro). */
  skipArrival(): void;
  /** His portrait right now, no clip (reduced motion's selfie); null if the canvas cannot be read. */
  portrait(): string | null;
  /** Try on a look: a library prop fitted to his head (it rides every clip and the drag-spin) or
   *  a 2D frame standing behind him; null / 'none' takes it off. Resolves once it is on (or failed). */
  wear(look: BeamyLook | null): Promise<void>;
  /** How far above his tip what he wears reaches now, in his heights (0 = nothing). */
  wornLift(): number;
  /** How far above his tip the worn prop would reach at scale `k` (1 = as fitted, 0 = its anchor), fully on. */
  wornLiftAt(k: number): number;
  /** Shrink the worn prop about its anchor (1 = as fitted; a frame's window may need it smaller). */
  wornScale(k: number): void;
  /** A colour filter over his body (a lens look): a CSS colour, 'prismatic' (a slow hue
   *  cycle), or null to take it off. Fades in and out. */
  tint(color: string | null): void;
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
  /** Extra scene content drawn on the same canvas (the story's per-step effects). */
  children?: ReactNode;
  /** Run first in every stage frame (the page reads its slots here, so he and the page agree on the frame). */
  frameRef?: MutableRefObject<(() => void) | null>;
}

/** `?debug` on the URL: a small readout of fps, frame time, resolution and how far he trails his target. */
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

/** Resolution cap: 2 on desktop, 1.5 on phones and touch (a full-viewport transparent canvas is the cost there). */
function dprCap(): number {
  const coarse = window.innerWidth <= 860 || window.matchMedia?.('(pointer: coarse)').matches === true;
  return Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
}

const MODEL_URL = '/mascot/beamy.glb';

/** The far earring's group, as lib/studio/earPair names it. */
const EAR_FAR = 'ear-pair-far';
const pairCache = new WeakMap<THREE.Object3D, { model: THREE.Object3D; delta: [number, number, number] } | null>();
/** A loaded earring pair split into its two earrings, once per model (null: not a pair). */
function splitPair(master: THREE.Object3D): { model: THREE.Object3D; delta: [number, number, number] } | null {
  const hit = pairCache.get(master);
  if (hit !== undefined) return hit;
  const model = master.clone(true);
  const p = splitScenePair(model);
  const out = p === null ? null : { model, delta: p.authoredDelta };
  pairCache.set(master, out);
  return out;
}

/** Model height in metres (body bbox, feet at y≈0). */
const MODEL_H = 0.6;
const BEAM_FIRE_S = 1.2;
const BEAM_END_S = 2.65;

const noopEvents = () => ({ enabled: false, priority: 0 });

/** Frame PNGs for his try-on, loaded once per url (a failed load is retried next time). */
const frameTextures = new Map<string, Promise<THREE.Texture>>();
function loadFrameTexture(url: string): Promise<THREE.Texture> {
  let hit = frameTextures.get(url);
  if (hit === undefined) {
    hit = new THREE.TextureLoader().loadAsync(url).then((t) => { t.colorSpace = THREE.SRGBColorSpace; return t; });
    void hit.catch(() => { if (frameTextures.get(url) === hit) frameTextures.delete(url); });
    frameTextures.set(url, hit);
  }
  return hit;
}

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
  float core = exp(-d * d * 6.0);                  // dense right under the feet
  float soft = smoothstep(1.0, 0.0, d);             // a wide, soft penumbra
  gl_FragColor = vec4(vec3(0.086, 0.071, 0.306), (core * 0.62 + soft * 0.16) * uAlpha);
}`;

/* ── Decor: small library props around the hero (the "crystals" slots) ─── */

interface CrystalSpec {
  /** A small real library prop (the platform's own assets, not abstract shapes). */
  prop: string;
  /** Anchor as a fraction of the hero's glass panel (may sit outside it), or
   *  on the floor around his hero stand ([dx, dy] × his height from his feet;
   *  dy < 0 = further back; lift = raised by × his height). */
  at: { panel: [number, number] } | { stand: [number, number]; lift?: number };
  /** Size as a fraction of min(panel width, height) (beside Beamy: of his height). */
  size: number;
  /** 0 far … 1 near: how far it parallaxes with the scroll. */
  depth: number;
  phone: boolean;
  /** Sits low enough to cast a faint contact shadow on the floor below it. */
  shadow?: boolean;
  /** Depth look: 'back' = smaller and hazier behind Beamy, 'front' = larger,
   *  softer, in front of him. */
  layer?: 'back' | 'front';
}
const PROP_DIR = '/models/props/';
/** How many carousel stops the stage can draw at once (the props rail: the worn one and two each side). */
const PEEK_SLOTS = 5;

/**
 * The AR step's mask on his body (decor.arOver): with the stage in front of
 * the page, a fragment of his body is dropped wherever one of the page's
 * frame images is opaque (its alpha over 0.5, times its live opacity) or one
 * of its round arrows sits, so the frame's border and its decorations (the
 * "2027" balloons) still cover him and he stays inside its window, while his
 * props, which never get this mask, draw over it. Three frame slots (the
 * worn one and the two beside it, or the two of a glide), two circles.
 * Positions are CSS px from the viewport's top left.
 */
const AR_MASK_DECL = `uniform sampler2D uArM0;
uniform sampler2D uArM1;
uniform sampler2D uArM2;
uniform vec4 uArR0;
uniform vec4 uArR1;
uniform vec4 uArR2;
uniform vec3 uArA;
uniform vec3 uArH0;
uniform vec3 uArH1;
uniform vec2 uArView;
float arCover(sampler2D t, vec4 r, float a, vec2 p) {
  if (a <= 0.0) return 0.0;
  vec2 uv = (p - r.xy) / r.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(t, vec2(uv.x, 1.0 - uv.y)).a * a;
}
`;
const AR_MASK_TEST = `{
  vec2 arP = vec2(gl_FragCoord.x / uArView.x, uArView.y - gl_FragCoord.y / uArView.x);
  float arC = max(arCover(uArM0, uArR0, uArA.x, arP), max(arCover(uArM1, uArR1, uArA.y, arP), arCover(uArM2, uArR2, uArA.z, arP)));
  if (arC > 0.5 || (uArH0.z > 0.0 && distance(arP, uArH0.xy) < uArH0.z) || (uArH1.z > 0.0 && distance(arP, uArH1.xy) < uArH1.z)) discard;
}`;
/** A transparent 1x1 for an empty mask slot. */
const AR_BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
AR_BLANK.needsUpdate = true;

/** A clone of a cached library model, fitted into a unit box about its centre (masters are never disposed). */
function unitClone(master: THREE.Object3D): THREE.Object3D {
  const obj = master.clone(true);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const dim = box.getSize(new THREE.Vector3());
  const k = 1 / Math.max(1e-6, dim.x, dim.y, dim.z);
  const mid = box.getCenter(new THREE.Vector3());
  obj.scale.multiplyScalar(k);
  obj.position.set(-mid.x * k, -mid.y * k, -mid.z * k);
  obj.traverse((o) => { if (o instanceof THREE.Mesh) { o.frustumCulled = false; o.renderOrder = 1; } });
  return obj;
}
const CRYSTALS: CrystalSpec[] = [
  { prop: 'royal-crown', at: { panel: [-0.012, -0.05] }, size: 0.15, depth: 0.25, phone: true },
  { prop: 'halo-ring', at: { panel: [1.015, 1.02] }, size: 0.16, depth: 0.35, phone: true },
  // Around his stand: one in front of him (front-right, large), two behind (small).
  { prop: 'queens-tiara', at: { stand: [0.66, 0.03] }, size: 0.2, depth: 1, phone: true, shadow: true, layer: 'front' },
  { prop: 'royal-crown', at: { stand: [-0.78, -0.05] }, size: 0.12, depth: 0.15, phone: false, shadow: true, layer: 'back' },
  { prop: 'halo-ring', at: { stand: [0.74, -0.04], lift: 0.62 }, size: 0.09, depth: 0.25, phone: false, layer: 'back' },
  { prop: 'queens-tiara', at: { panel: [0.6, 0.16] }, size: 0.05, depth: 0.7, phone: false },
  { prop: 'royal-crown', at: { panel: [0.33, 0.9] }, size: 0.035, depth: 0.55, phone: false, shadow: true },
];

/* ── Projector light: origin → the near edge of a story card ──────────────
   Not a hard wedge: a feathered volume of light, brightest at his mouth,
   fading out across its width (never reaching its own edges) and along its
   length (gone before it reaches the card), with a few dust motes drifting
   through it. The card gets a soft bloom where the light lands (CONE_GLOW).
   BEAM_STYLE 'stream' instead drops the volume for a glow at his mouth and a
   few soft particles travelling to the card. Under reduced motion
   (uFlicker 0) only the still, soft light remains. */

/** 'volume' = soft projector light with drifting motes; 'stream' = particles only. */
const BEAM_STYLE: 'volume' | 'stream' = 'volume';

const CONE_VERT = /* glsl */ `
attribute vec2 aCone;
varying vec2 vCone;
void main() { vCone = aCone; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CONE_FRAG = /* glsl */ `
varying vec2 vCone;   // x: 0 at Beamy → 1 at the card; y: −x..x across
uniform float uAlpha;
uniform float uTime;
uniform float uFlicker;
uniform float uLen;   // px, mouth → card
uniform float uHalf;  // px, half the card edge's width
uniform float uMode;  // 0 volume, 1 stream
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float x = vCone.x;
  float across = abs(vCone.y) / max(x, 0.001);
  // Feathered on every side: zero well inside the triangle's edges.
  float side = exp(-across * across * 3.5) * (1.0 - smoothstep(0.6, 0.95, across));
  // It fades in where the cone is already wide (never a sharp apex) and is
  // gone before the card.
  float along = smoothstep(0.04, 0.22, x) * (1.0 - smoothstep(0.4, 0.92, x));
  vec2 px = vec2(x * uLen, vCone.y * uHalf); // roughly isotropic px
  vec3 warm = vec3(1.0, 0.95, 0.86);
  vec3 cool = vec3(0.70, 0.72, 1.0);
  vec3 col = mix(warm, cool, smoothstep(0.0, 0.7, x));
  float a = 0.0;
  if (uMode < 0.5) {
    // (Its source, a round glow at his mouth or hand, is its own mesh: the
    // triangle would clip it to a point.)
    float body = side * along * (0.2 + 0.35 * exp(-x * 4.0));
    vec2 g = px / 16.0 + vec2(-uTime * 0.9, uTime * 0.12);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.5;
    float h = hash(id);
    float mote = step(0.82, h) * smoothstep(0.16, 0.0, length(f)) * (0.55 + 0.45 * sin(uTime * 1.7 + h * 40.0));
    a = body + mote * side * along * 0.55 * uFlicker;
  } else {
    float glow = exp(-length(px) / 26.0) * 0.55;
    float dots = 0.0;
    for (int k = 0; k < 7; k++) {
      float fk = float(k);
      float p = fract(uTime * 0.28 + fk / 7.0);
      vec2 c = vec2(p * uLen, (hash(vec2(fk, 1.0)) - 0.5) * 0.8 * p * uHalf);
      float d = length(px - c);
      dots += exp(-d * d / 18.0) * smoothstep(0.0, 0.12, p) * (1.0 - smoothstep(0.75, 1.0, p));
    }
    a = glow + dots * 0.8 * mix(1.0, 0.0, 1.0 - uFlicker) + (1.0 - uFlicker) * side * along * 0.2;
  }
  gl_FragColor = vec4(col, a * uAlpha);
}`;
/** The soft bloom on the card where the light lands. */
const CONE_GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAlpha;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float d = dot(q, q);
  gl_FragColor = vec4(vec3(0.78, 0.80, 1.0), exp(-d * 3.0) * smoothstep(1.0, 0.7, d) * uAlpha);
}`;

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

const DROP_S = 0.7;
/** After the drop the column fades out over this while the selfie starts. */
const LINGER_S = 0.35;
/** Reduced-motion arrival: the column fades in over this, he grows in, then it fades out. */
const REDUCED_DROP_S = 0.7;
const REDUCED_LINGER_S = 0.6;
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

function Scene({ apiRef, layoutRef, bubbleRef, hitRef, decorRef, startHidden = false, reducedMotion = false, onReady, onError, frameRef, debugRef }: Props & { debugRef?: MutableRefObject<HTMLDivElement | null> }) {
  const { size, gl, scene, camera, setDpr } = useThree();
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
  /** Studio reflections for the prop materials that ask for them (glTF
   *  extras `beamyEnv` = env-map intensity, e.g. the silver crown): this
   *  stage has no environment, and a real metal with nothing to reflect
   *  renders black. Built on first use for this renderer; every other prop
   *  is left exactly as it was. */
  const propEnv = useRef<THREE.Texture | null>(null);
  const litProps = (master: THREE.Object3D) => {
    master.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const k: unknown = (m as THREE.Material).userData.beamyEnv;
        if (typeof k !== 'number' || !(m instanceof THREE.MeshStandardMaterial)) continue;
        if (propEnv.current === null) {
          const pm = new THREE.PMREMGenerator(gl);
          propEnv.current = pm.fromScene(new RoomEnvironment(), 0.04).texture;
          pm.dispose();
        }
        if (m.envMap !== propEnv.current) { m.envMap = propEnv.current; m.envMapIntensity = k; m.needsUpdate = true; }
      }
    });
  };
  useEffect(() => () => { propEnv.current?.dispose(); propEnv.current = null; }, []);
  const shown = useRef(!startHidden);
  const appear = useRef(startHidden ? 0 : 1);
  const arrival = useRef<{ t: number; landed: boolean; resolve: () => void } | null>(null);
  const flash = useRef<{ t: number; at: Pt; sizePx: number } | null>(null);
  const motes = useRef<Mote[]>(Array.from({ length: N_MOTES }, () => ({ t: 0, life: 1, x0: 0, y0: 0, x1: 0, y1: 0, bow: 0, active: false })));
  /** The filter look: his light-coloured materials (with their own emissive), the target, the fade. */
  const tintS = useRef<{ mats: { m: THREE.MeshStandardMaterial; e: THREE.Color; c: THREE.Color; i: number }[]; target: string | null; mix: number; col: THREE.Color }>({ mats: [], target: null, mix: 0, col: new THREE.Color() });
  const spinS = useRef<Spin>({ angle: 0, vel: 0 });

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
  const beamState = useRef<{ to: Pt; t: number; fired: boolean; onFire?: () => void; from: 'mouth' | 'hand'; fireS: number; endS: number; done?: () => void } | null>(null);
  const reveal = useRef<Reveal | null>(null);
  /** Where the revealed prop stays (a getter follows the page's scroll). */
  const propAt = useRef<(() => Pt) | null>(null);
  /** The projector cone: target getter, origin, age, grow-in, fade-out. */
  const cone = useRef<{ target: () => Rect | null; from: 'mouth' | 'hand'; t: number; grow: boolean; alpha: number; off: boolean; landed: boolean; resolve: () => void } | null>(null);
  const coneMesh = useRef<THREE.Mesh>(null);
  const coneGlow = useRef<THREE.Mesh>(null);
  const coneSrc = useRef<THREE.Mesh>(null);
  /** Smoothed height (the director's height changes between stops). */
  const shownH = useRef(layoutRef.current.heightPx);
  const lean = useRef(0);
  const moving = useRef(0);
  const lastPos = useRef<Pt>({ ...layoutRef.current.home });
  /** Last frame's target (the glide feeds its change straight through). */
  const glideT = useRef<GlidePt | null>(null);
  /** Frame-time bookkeeping: the resolution governor and the ?debug readout. */
  const perf = useRef({ acc: 0, n: 0, worst: 0, calm: 0, fps: 60, ms: 16.7, worstMs: 0, dpr: 1, gap: 0, shown: 0 });
  const propSpin = useRef(0);
  const bodyBone = useRef<THREE.Object3D | null>(null);
  const phoneBone = useRef<THREE.Object3D | null>(null);
  /** The heart shades' bone (the Selfie and ShadesOn clips scale it up). */
  const shadesBone = useRef<THREE.Object3D | null>(null);
  const selfieRun = useRef<{ t: number; tl: SelfieTimeline; snapped: boolean; noShades: boolean; action: THREE.AnimationAction; onFrame: (f: SelfieFrame) => void; resolve: (done: boolean) => void } | null>(null);
  const crystalRefs = useRef<(THREE.Group | null)[]>([]);
  const crystalShadowRefs = useRef<(THREE.Mesh | null)[]>([]);
  /** The AR props carousel's stops, and the GLB each holder is showing. */
  const peekRefs = useRef<(THREE.Group | null)[]>([]);
  const peekUrls = useRef<(string | null)[]>(Array.from({ length: PEEK_SLOTS }, () => null));
  /** The mirrored copy of his rig on the hero's glossy floor (desktop only). */
  const reflRig = useRef<THREE.Group>(null);
  const reflect = useRef<{ root: THREE.Object3D; pairs: [THREE.Object3D, THREE.Object3D][]; floorY: { value: number }; fade: { value: number } } | null>(null);
  const [reflectObj, setReflectObj] = useState<THREE.Object3D | null>(null);
  const wrapEl = useRef<HTMLElement | null>(null);
  /** The AR mask's uniforms (AR_MASK), shared by every material of his body and his reflection. */
  const arU = useMemo(() => ({
    uArM0: { value: AR_BLANK as THREE.Texture }, uArM1: { value: AR_BLANK as THREE.Texture }, uArM2: { value: AR_BLANK as THREE.Texture },
    uArR0: { value: new THREE.Vector4(0, 0, 1, 1) }, uArR1: { value: new THREE.Vector4(0, 0, 1, 1) }, uArR2: { value: new THREE.Vector4(0, 0, 1, 1) },
    uArA: { value: new THREE.Vector3() },
    uArH0: { value: new THREE.Vector3() }, uArH1: { value: new THREE.Vector3() },
    uArView: { value: new THREE.Vector2(1, 1) },
  }), []);
  const arMask = (sh: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }) => {
    Object.assign(sh.uniforms, arU);
    sh.fragmentShader = AR_MASK_DECL + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${AR_MASK_TEST}`);
  };
  /** The page's frame images as textures (for the mask's alpha), loaded once each. */
  const arTex = useRef(new Map<string, THREE.Texture | null>());
  useEffect(() => () => { for (const t of arTex.current.values()) t?.dispose(); arTex.current.clear(); }, []);
  /** What he is wearing: a fitted prop on his body bone (popping in over `t`), a frame behind him. */
  /** The worn prop: its pop-in `t`, its crown `top` and seat `anchor` in his heights, and its scale `k`. */
  const worn = useRef<{ holder: THREE.Group; t: number; top: number; anchor: number; k: number } | null>(null);
  /** Props he just took off: each shrinks away over ~0.26s instead of vanishing (never a pop). */
  const leaving = useRef<{ holder: THREE.Group; t: number; s0: number }[]>([]);
  const wornTopAt = (wn: { top: number; anchor: number }, k: number) => wn.anchor + (wn.top - wn.anchor) * k;
  const wearToken = useRef(0);
  const frameMesh = useRef<THREE.Mesh>(null);
  /** The frame's window backdrop (the "photo" behind him): its fractions of the frame. */
  const frameBack = useRef<THREE.Mesh>(null);
  const frameOpening = useRef<{ top: number; bottom: number; left: number; right: number } | null>(null);
  const frameOn = useRef({ on: false, alpha: 0 });
  /** Where the page last placed the frame (it fades out there, never jumping to his own fit). */
  const lastFrameAt = useRef<{ left: number; top: number; h: number } | null>(null);
  /** The frame's height and centre in his heights: smaller on phones, where he is small beside the wall. */
  const frameFit = useRef<{ h: number; c: number } | null>(null);
  const frameGeo = () => frameFit.current ?? (decorRef.current.phone ? { h: 1.45, c: 0.62 } : { h: 1.7, c: 0.75 });
  const wornLiftNow = () => {
    const wn = worn.current;
    const prop = wn === null ? 0 : Math.max(0, wornTopAt(wn, wn.k) - 1) * Math.min(1, wn.t);
    const at = layoutRef.current.frameAt;
    const hp = Math.max(1, layoutRef.current.heightPx * scale.current);
    const g = frameGeo();
    const top = at != null ? (pos.current.y - at.top) / hp : g.c + g.h / 2;
    const frame = Math.max(0, top - 1) * frameOn.current.alpha;
    return Math.max(prop, frame);
  };
  /** The placed frame's rect while it is on (viewport px), else null. */
  const framedRect = (): Rect | null => {
    const at = layoutRef.current.frameAt;
    return at != null && frameOn.current.on && frameOn.current.alpha > 0.5 ? { left: at.left, top: at.top, width: (at.h * 9) / 16, height: at.h } : null;
  };

  /* Load the rig once. The page owns the instance, so it is disposed here. */
  useEffect(() => {
    let cancelled = false;
    let owned: THREE.Group | null = null;
    gltfLoader().loadAsync(MODEL_URL).then(
      (g) => {
        if (cancelled) return;
        owned = g.scene;
        g.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.frustumCulled = false;
            o.renderOrder = 2;
            // The filter look tints his light body only (never the dark eyes).
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              m.onBeforeCompile = arMask;
              m.customProgramCacheKey = () => 'beamy-ar-mask';
              if (!(m instanceof THREE.MeshStandardMaterial)) continue;
              const c = m.color;
              if (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.3) tintS.current.mats.push({ m, e: m.emissive.clone(), c: c.clone(), i: m.emissiveIntensity });
            }
          }
          // The rig's beam runs along +z: at an orthographic camera it is a
          // flat white wedge once Beamy turns. The stage draws its own beam.
          if (o.name === 'beam_core' || o.name === 'beam_outer') o.visible = false;
          // Two nodes are named `phone` (the bone and its skinned mesh); the
          // bone is the hand. Every clip keys its scale (0 except in Selfie),
          // but the loaded REST pose is scale 1: zero it so the phone can
          // never flash on before the first mixer update.
          if ((o as THREE.Bone).isBone && o.name === 'phone') { phoneBone.current = o; o.scale.setScalar(0); }
          if ((o as THREE.Bone).isBone && o.name === 'body') bodyBone.current = o;
          if ((o as THREE.Bone).isBone && o.name === 'shades') shadesBone.current = o;
        });
        mouthNode.current = g.scene.getObjectByName('beam') ?? null;
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

  /* His reflection: a skinned clone whose every node copies the real rig each
     frame (so every clip, the selfie phone and the hidden beam meshes match),
     drawn mirrored under his feet, faint, fading out with depth below the floor. */
  useEffect(() => {
    if (model === null) return;
    const root = cloneSkinned(model.scene);
    const src: THREE.Object3D[] = [];
    const dst: THREE.Object3D[] = [];
    model.scene.traverse((o) => { src.push(o); });
    root.traverse((o) => { dst.push(o); });
    if (src.length !== dst.length) return;
    const floorY = { value: 0 };
    const fade = { value: 100 };
    const mats: THREE.Material[] = [];
    const mirrorMat = (m: THREE.Material): THREE.Material => {
      const c = m.clone();
      c.transparent = true;
      c.opacity = 0.16 * m.opacity;
      c.depthWrite = false;
      c.side = THREE.DoubleSide; // a negative scale flips the winding
      c.onBeforeCompile = (sh) => {
        arMask(sh);
        sh.uniforms.uReflFloor = floorY;
        sh.uniforms.uReflFade = fade;
        sh.vertexShader = `varying float vReflY;\n${sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vReflY = (modelMatrix * vec4(transformed, 1.0)).y;')}`;
        sh.fragmentShader = `uniform float uReflFloor;\nuniform float uReflFade;\nvarying float vReflY;\n${sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= smoothstep(uReflFloor - uReflFade, uReflFloor, vReflY);')}`;
      };
      c.customProgramCacheKey = () => 'beamy-reflection';
      mats.push(c);
      return c;
    };
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = Array.isArray(o.material) ? o.material.map(mirrorMat) : mirrorMat(o.material);
      o.renderOrder = 1;
      o.frustumCulled = false;
    });
    reflect.current = { root, pairs: src.map((o, i) => [o, dst[i]]), floorY, fade };
    setReflectObj(root);
    return () => {
      for (const m of mats) m.dispose();
      reflect.current = null;
      setReflectObj(null);
    };
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
        beamState.current = { to: { ...to }, t: 0, fired: false, onFire, from, fireS: from === 'hand' ? 0.45 : BEAM_FIRE_S, endS: from === 'hand' ? 1.15 : BEAM_END_S };
        api.face(to.x);
        return playOnce(from === 'hand' ? 'Wave' : 'BeamyBlast').then(() => {
          // A clip shorter than the window still owes its onFire.
          const b = beamState.current;
          if (b !== null && !b.fired) { b.fired = true; b.onFire?.(); }
          beamState.current = null; yawTarget.current = 0;
        });
      },
      zap(to, from = 'hand', ms = 420) {
        // A short beam on the open clip (the page raises the hand first).
        beamState.current?.done?.();
        return new Promise<void>((resolve) => {
          beamState.current = { to: { ...to }, t: 0, fired: false, from, fireS: 0.05, endS: Math.max(0.15, ms / 1000), done: resolve };
          api.face(to.x);
        });
      },
      stopBeam() {
        const b = beamState.current;
        if (b === null) return;
        beamState.current = null;
        if (!b.fired) { b.fired = true; b.onFire?.(); }
        b.done?.();
        yawTarget.current = 0;
      },
      project(target, from, grow) {
        cone.current?.resolve();
        return new Promise<void>((resolve) => {
          cone.current = { target, from, t: 0, grow, alpha: grow ? 0 : 1, off: false, landed: !grow, resolve };
          if (!grow) resolve();
        });
      },
      stopProject() {
        const c = cone.current;
        if (c === null) return;
        c.off = true;
        if (!c.landed) { c.landed = true; c.resolve(); }
      },
      reveal(url, atIn, sizePx, from = 'mouth', instant = false) {
        api.clearProp();
        const g = propGroup.current;
        if (g === null) return Promise.resolve();
        const atGet = typeof atIn === 'function' ? atIn : () => atIn;
        propAt.current = atGet;
        const at = atGet();
        return loadModel(url).then((master) => new Promise<void>((resolve) => {
          litProps(master);
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
          if (instant) { g.scale.setScalar(1); resolve(); return; }
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
        // Reduced motion still arrives (it is the page's content), gently:
        // the column fades in whole, he grows in softly, no flash.
        if (shown.current) {
          shown.current = true;
          appear.current = 1;
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => { arrival.current = { t: 0, landed: false, resolve }; });
      },
      sparkle(level) {
        // A sparkle is feedback, and the AR step's "Sparkle burst" is a look
        // the visitor picked: reduced motion softens it (fewer motes, a
        // shorter reach, no flash) and never drops it.
        const soft = reducedRef.current;
        const h = layoutRef.current.heightPx * scale.current;
        const cx = pos.current.x;
        const cy = pos.current.y - h * 0.55;
        const burst = level === 'burst';
        const n = burst ? (soft ? 22 : 40) : (soft ? 6 : 12);
        const reach = soft ? 0.7 : 1;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = h * reach * (burst ? 0.55 + Math.random() * 0.5 : 0.35 + Math.random() * 0.25);
          emitMote(cx + Math.cos(a) * h * 0.15, cy + Math.sin(a) * h * 0.15, cx + Math.cos(a) * r, cy + Math.sin(a) * r,
            0.55 + Math.random() * 0.35, -Math.random() * 0.08, 0);
        }
        if (!burst) return;
        // A second, wider ring a beat later: the burst reads as a burst.
        for (let i = 0; i < (soft ? 0 : 24); i++) {
          const a = (i / 24) * Math.PI * 2 + Math.random() * 0.2;
          const r = h * (1.0 + Math.random() * 0.25);
          emitMote(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.7 + Math.random() * 0.2, -0.16, 0);
        }
        if (!soft) flash.current = { t: 0, at: { x: cx, y: cy }, sizePx: h * 1.8 };
      },
      spin() {
        if (reducedRef.current) return;
        spinS.current.vel += 22;
      },
      clearProp() {
        reveal.current?.resolve();
        reveal.current = null;
        propAt.current = null;
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
      selfie(onFrame, opts) {
        api.stopSelfie();
        if (actions.current[SELFIE_CLIP] === undefined) return Promise.resolve(false); // an old GLB
        yawTarget.current = 0;
        void playOnce(SELFIE_CLIP);
        const action = current.current;
        if (action === null) return Promise.resolve(false);
        action.timeScale = SELFIE_SPEED;
        return new Promise<boolean>((resolve) => {
          selfieRun.current = { t: 0, tl: selfieTimeline(reducedRef.current), snapped: false, noShades: opts?.shades === false, action, onFrame, resolve };
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
      wornLift: () => wornLiftNow(),
      wornLiftAt(k) {
        const wn = worn.current;
        return wn === null ? 0 : Math.max(0, wornTopAt(wn, k) - 1);
      },
      wornScale(k) {
        const wn = worn.current;
        if (wn !== null) wn.k = Math.min(1, Math.max(0.05, k));
      },
      tint(color) {
        tintS.current.target = color;
      },
      wear(look) {
        const tok = ++wearToken.current;
        const old = worn.current;
        if (old !== null) { leaving.current.push({ holder: old.holder, t: 0, s0: old.holder.scale.x }); worn.current = null; }
        frameOn.current.on = false;
        if (look === null || look.kind === 'none' || look.url === undefined) return Promise.resolve();
        const url = look.url;
        if (look.kind === 'frame') {
          // A frame may bring a prop with it (the Christmas look: Holiday cover + antlers).
          const prop = look.prop !== undefined ? wearProp(look.prop.url, look.prop.fit, tok) : Promise.resolve();
          const frame = loadFrameTexture(url).then((tex) => {
            if (tok !== wearToken.current) return;
            frameFit.current = look.frame ?? null;
            frameOpening.current = look.opening ?? null;
            frameMat.map = tex;
            frameMat.needsUpdate = true;
            frameOn.current.on = true;
          }, () => undefined);
          return Promise.all([frame, prop]).then(() => undefined);
        }
        const fit = look.fit;
        if (fit === undefined) return Promise.resolve();
        return wearProp(url, fit, tok);
      },
    };
    /** Load a library prop and fit it onto his body bone (it pops in over `worn.t`). */
    const wearProp = (url: string, fit: PropFit, tok: number): Promise<void> =>
      loadModel(url).then((master) => {
        if (tok !== wearToken.current) return;
        litProps(master);
        // The body bone carries every clip (hop, dance, the party spin).
        const bone = bodyBone.current;
        if (bone === null) return;
        // A pair of earrings is split once per model (its halves share the
        // cached vertex buffers) and cloned from then on, so a tour that
        // comes round to it again allocates nothing new.
        const pair = fit.pair !== undefined ? splitPair(master) : null;
        const obj = (pair?.model ?? master).clone(true);
        obj.updateMatrixWorld(true);
        // Measured on the whole model: the halves keep the pair's full vertex buffers.
        master.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(master);
        const lo = box.min.toArray() as [number, number, number], hi = box.max.toArray() as [number, number, number];
        const laid = pair !== null ? fitPair(lo, hi, pair.delta, fit) : null;
        const far = laid !== null ? obj.getObjectByName(EAR_FAR) : undefined;
        if (laid !== null && far !== undefined) far.position.set(...laid.farShift);
        const f = laid !== null && far !== undefined ? laid : fitProp(lo, hi, fit);
        obj.traverse((o) => { if (o instanceof THREE.Mesh) { o.frustumCulled = false; o.renderOrder = 3; } });
        obj.scale.multiplyScalar(f.scale);
        // Tilt about the anchor itself: the holder sits ON the anchor.
        obj.position.set(f.offset[0] - fit.at[0], f.offset[1] - fit.at[1], f.offset[2] - fit.at[2]);
        const holder = new THREE.Group();
        holder.add(obj);
        holder.position.set(fit.at[0], fit.at[1], fit.at[2]);
        holder.rotation.x = fit.tilt ?? 0;
        holder.scale.setScalar(0.0001);
        bone.add(holder);
        // Its crown in his height units (body bone 0.12 above the feet, 0.6 tall)
        // so the bubble can clear it.
        const top = (0.12 + f.offset[1] + box.max.y * f.scale) / 0.6;
        const anchor = (0.12 + fit.at[1]) / 0.6;
        worn.current = { holder, t: 0, top: Number.isFinite(top) ? top : 1, anchor: Number.isFinite(anchor) ? anchor : 1, k: 1 };
      }, () => undefined);
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
  /** The try-on frame: a transparent 9:16 PNG on a plane standing behind him. */
  const frameMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0, toneMapped: false }), []);
  /** Behind him, filling the frame's window: a soft studio backdrop (amber glow into
   *  periwinkle, as in his selfies), so the window reads as the photo and never shows
   *  the wall or the copy through it. */
  const frameBackMat = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 192;
    const g = c.getContext('2d');
    if (g !== null) {
      const bg = g.createRadialGradient(64, 120, 6, 64, 110, 150);
      bg.addColorStop(0, 'rgb(255,214,160)');
      bg.addColorStop(0.42, 'rgb(150,156,255)');
      bg.addColorStop(1, 'rgb(46,50,112)');
      g.fillStyle = bg;
      g.fillRect(0, 0, 128, 192);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
  }, []);
  useEffect(() => () => { frameMat.dispose(); frameBackMat.map?.dispose(); frameBackMat.dispose(); }, [frameMat, frameBackMat]);
  const floorMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: FLOOR_FRAG,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
    transparent: true,
    depthWrite: false,
  }), []);
  /** The crystals' contact shadows: the same soft ellipse, fainter. */
  const crystalShadowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: FLOOR_FRAG,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0.55 } },
    transparent: true,
    depthWrite: false,
  }), []);
  const coneMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: CONE_VERT, fragmentShader: CONE_FRAG,
    uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 }, uFlicker: { value: 1 }, uLen: { value: 1 }, uHalf: { value: 1 }, uMode: { value: BEAM_STYLE === 'stream' ? 1 : 0 } },
    // Both faces: the triangle's winding flips with the side he projects from.
    side: THREE.DoubleSide,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);
  const coneGlowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: CONE_GLOW_FRAG,
    uniforms: { uAlpha: { value: 0 } },
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);
  /** The same soft radial bloom at the light's source (his mouth or hand). */
  const coneSrcMat = useMemo(() => coneGlowMat.clone(), [coneGlowMat]);
  const coneGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('aCone', new THREE.BufferAttribute(new Float32Array([0, 0, 1, -1, 1, 1]), 2));
    return g;
  }, []);
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
    // RGBA: a spent mote fades its ALPHA too. The canvas is transparent and
    // additive blending adds alpha, so an RGB-only fade left black discs.
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N_MOTES * 4), 4));
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
  useEffect(() => () => {
    beamMat.dispose(); floorMat.dispose(); flashMat.dispose(); sparkGeo.dispose(); sparkMat.dispose();
    sparkTex.dispose(); moteGeo.dispose(); moteMat.dispose(); crystalShadowMat.dispose();
    coneMat.dispose(); coneGeo.dispose(); coneGlowMat.dispose(); coneSrcMat.dispose();
  }, [beamMat, floorMat, flashMat, sparkGeo, sparkMat, sparkTex, moteGeo, moteMat, crystalShadowMat, coneMat, coneGeo, coneGlowMat, coneSrcMat]);
  /* The decor props: real library assets, each fitted into a unit box and
     dropped into its holder once Beamy himself is on screen (they share the
     glb cache with the hero try-on; masters are cloned, never disposed). */
  useEffect(() => {
    let live = true;
    const id = window.setTimeout(() => {
      CRYSTALS.forEach((c, i) => {
        void loadModel(HOME_ASSET_DEFAULTS.sceneProps[i] ?? `${PROP_DIR}${c.prop}.glb`).then((master) => {
          const holder = crystalRefs.current[i];
          if (!live || holder === null || holder.children.length > 0) return;
          holder.add(unitClone(master));
        }, () => undefined);
      });
    }, 1200);
    return () => { live = false; window.clearTimeout(id); };
  }, []);

  /* The page reads its slots first, every frame, so the target he follows is
     this frame's (a separate loop could run after the render: a frame late). */
  useFrame(() => { frameRef?.current?.(); }, -1);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, DT_MAX);
    /* Pixel budget: a slow second lowers the resolution, calm ones restore it. */
    const pf = perf.current;
    if (dtRaw < 0.25) { pf.acc += dtRaw; pf.n++; pf.worst = Math.max(pf.worst, dtRaw); }
    if (pf.acc >= 1) {
      pf.fps = pf.n / pf.acc;
      pf.ms = (pf.acc * 1000) / pf.n;
      pf.worstMs = pf.worst * 1000;
      pf.acc = 0; pf.n = 0; pf.worst = 0;
      const cur = state.viewport.dpr;
      const g = governDpr(cur, pf.fps, dprCap(), pf.calm);
      pf.calm = g.calm;
      if (g.dpr !== cur) setDpr(g.dpr);
      pf.dpr = g.dpr;
    }
    const t = state.clock.elapsedTime;
    const layout = layoutRef.current;
    const W = sizeRef.current.width;

    const target: GlidePt = { x: layout.home.x, y: layout.home.y, h: layout.heightPx };
    const prevT = glideT.current;
    let glided = false;

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
    } else {
      // Follow the scroll director: a smooth approach with a velocity cap, so
      // a fling of the page is a quick glide, never a jump. During a beam or a
      // reveal he still follows (the page scrolls under him), only slower.
      scale.current += (1 - scale.current) * Math.min(1, dt * 3.5);
      const busy = reveal.current !== null || beamState.current !== null || selfieRun.current !== null;
      if (arrival.current !== null) pos.current = { ...layout.home };
      else {
        // Feed-forward glide (lib/beamyScroll glideStep): exactly with the
        // scroll, eased only over what is left; dissolved, he just lands.
        const g = glideStep({ x: pos.current.x, y: pos.current.y, h: shownH.current }, glideT.current, target, dtRaw, sizeRef.current.height, busy ? K_SOFT : K_POS, (layout.presence ?? 1) < 0.02);
        pos.current = { x: g.x, y: g.y };
        shownH.current = g.h;
        glided = true;
      }
      if (!busy && cone.current === null) yawTarget.current = layout.yaw ?? 0;
    }
    glideT.current = target;
    const c0 = cone.current;
    if (c0 !== null && !c0.off && w === null) {
      const r0 = c0.target();
      if (r0 !== null) yawTarget.current = clamp((r0.left + r0.width / 2 - pos.current.x) / 260, -1, 1) * 0.5;
    }
    if (!glided) shownH.current += (layout.heightPx - shownH.current) * (1 - Math.exp(-K_POS * dt));

    /* Travel: waddle while gliding, lean into the direction of travel, a
       little hop in the step; Idle again on arrival. Riding a scrolling (or
       pinned) slot is standing still: sideways motion is always travel (the
       page scrolls up and down), up-and-down only what his target did not. */
    const vx = (pos.current.x - lastPos.current.x) / Math.max(dt, 1e-3);
    const vy = (pos.current.y - lastPos.current.y - (prevT !== null ? target.y - prevT.y : 0)) / Math.max(dt, 1e-3);
    lastPos.current = { ...pos.current };
    const dbg = debugRef?.current;
    if (dbg) {
      pf.gap = Math.hypot(target.x - pos.current.x, target.y - pos.current.y);
      pf.shown += dtRaw;
      if (pf.shown > 0.25) {
        pf.shown = 0;
        dbg.textContent = `${pf.fps.toFixed(0)} fps · ${pf.ms.toFixed(1)} ms (worst ${pf.worstMs.toFixed(0)}) · dpr ${state.viewport.dpr.toFixed(2)} · tick ${(layout.tickMs ?? 0).toFixed(2)} ms · gap ${pf.gap.toFixed(1)} px · presence ${(layout.presence ?? 1).toFixed(2)}`;
      }
    }
    const speed = Math.hypot(vx, vy);
    moving.current += ((speed > 60 ? 1 : 0) - moving.current) * Math.min(1, dt * (speed > 60 ? 8 : 3));
    if (w === null && shown.current && selfieRun.current === null) {
      const cur = current.current;
      const idle = actions.current.Idle;
      const waddle = actions.current.Waddle;
      if (moving.current > 0.6 && cur === idle && waddle) fadeTo('Waddle', false);
      else if (moving.current < 0.2 && cur === waddle && idle) fadeTo('Idle', false);
      if (moving.current > 0.6 && Math.abs(vx) > 40 && beamState.current === null && reveal.current === null) yawTarget.current = Math.sign(vx) * 0.7;
    }
    lean.current += (clamp(-vx / 2400, -0.14, 0.14) * (reducedRef.current ? 0.4 : 1) - lean.current) * Math.min(1, dt * 6);
    yaw.current = dampAngle(yaw.current, yawTarget.current, K_SOFT, dt);

    const presence = clamp(layout.presence ?? 1, 0, 1);
    const heightPx = shownH.current * scale.current;
    const reduced = reducedRef.current;

    /* Entrance: the beam drops, a flash, he grows in where it landed. */
    const ar = arrival.current;
    const dropS = reduced ? REDUCED_DROP_S : DROP_S;
    if (ar !== null) {
      ar.t += dt;
      if (!ar.landed && ar.t >= dropS) {
        ar.landed = true;
        shown.current = true;
        // Reduced motion: no impact bloom; the soft column is the light.
        if (!reduced) flash.current = { t: 0, at: { x: pos.current.x, y: pos.current.y - heightPx * 0.42 }, sizePx: heightPx * 2.2 };
      }
      if (ar.t >= dropS + (reduced ? REDUCED_LINGER_S : LINGER_S)) { arrival.current = null; ar.resolve(); }
    }
    if (shown.current && appear.current < 1) appear.current = Math.min(1, appear.current + dt / (reduced ? 0.9 : 0.5));

    const spinNow = spinS.current;
    /* The filter look: fade his body's glow toward the lens colour and back. */
    const tn = tintS.current;
    const tnWant = tn.target !== null ? 1 : 0;
    if (tn.mix !== tnWant || tnWant === 1) {
      tn.mix += (tnWant - tn.mix) * Math.min(1, dt * 4);
      if (Math.abs(tn.mix - tnWant) < 0.002) tn.mix = tnWant;
      if (tn.target === 'prismatic') tn.col.setHSL(((reduced ? 0.6 : t * 0.12) % 1 + 1) % 1, 0.85, 0.6);
      else if (tn.target !== null) tn.col.set(tn.target);
      // His body's glow is masked by its emissive map, so the lens colour
      // also washes his albedo (colour multiplies the base map).
      for (const x of tn.mats) {
        x.m.color.copy(x.c).lerp(tn.col, tn.mix * 0.75);
        x.m.emissive.copy(x.e).lerp(tn.col, tn.mix * 0.88);
        x.m.emissiveIntensity = Math.max(x.i, tn.mix);
      }
    }

    /* The party spin: inertia, then a springy settle to front (pure physics). */
    if (spinSettled(spinNow)) { spinNow.angle = 0; spinNow.vel = 0; }
    else { const n = spinStep(spinNow, dt); spinNow.angle = n.angle; spinNow.vel = n.vel; }

    const s = heightPx / MODEL_H;
    const g = rig.current;
    if (g) {
      const wp = toWorld(pos.current);
      // A little hop in each waddle step while gliding (decorative: off when reduced).
      const hop = reduced ? 0 : Math.abs(Math.sin(t * 11)) * heightPx * 0.035 * moving.current;
      g.position.set(wp.x, wp.y + hop, 0);
      const grow = s * presence * Math.max(0.0001, reduced ? appear.current : easeOutBack(appear.current));
      // Landing squash: wide-and-short for a beat, then springs upright.
      const k = appear.current;
      const sq = reduced || k >= 1 ? 0 : Math.sin(Math.PI * k) * (1 - k) * 0.55;
      g.scale.set(grow * (1 + sq * 0.35), grow * (1 - sq * 0.35), grow * (1 + sq * 0.35));
      g.rotation.y = yaw.current + spinNow.angle;
      g.rotation.x = 0;
      g.rotation.z = lean.current;
      g.visible = shown.current && presence > 0.01;
    }
    if (floor.current) {
      const wp = toWorld(pos.current);
      floor.current.position.set(wp.x, wp.y + heightPx * 0.012, -200);
      floor.current.scale.set(heightPx * 1.0 * presence, heightPx * 0.17 * presence, 1);
    }
    (floorMat.uniforms.uTime as { value: number }).value = t;
    (floorMat.uniforms.uAlpha as { value: number }).value = appear.current * presence;
    mixer.current?.update(dt);
    // A selfie in a worn look: the clip's heart shades stay off.
    if (selfieRun.current?.noShades === true) shadesBone.current?.scale.setScalar(0);

    /* The try-on: a prop pops onto his head (overshoot; a plain grow when
       reduced); a frame fades in behind him, sized to him, never turning. */
    const wn = worn.current;
    if (wn !== null) {
      if (wn.t < 1) wn.t = Math.min(1, wn.t + dt / 0.42);
      const pop = wn.t >= 1 ? 1 : reduced ? wn.t : easeOutBack(wn.t);
      const sc = Math.max(0.0001, pop * wn.k);
      if (wn.holder.scale.x !== sc) wn.holder.scale.setScalar(sc);
    }
    const lv = leaving.current;
    for (let i = lv.length - 1; i >= 0; i--) {
      const o = lv[i];
      o.t = Math.min(1, o.t + dt / 0.26);
      o.holder.scale.setScalar(Math.max(0.0001, o.s0 * (1 - o.t) * (1 - o.t)));
      if (o.t >= 1) { o.holder.removeFromParent(); lv.splice(i, 1); }
    }
    const fo = frameOn.current;
    fo.alpha = fo.on ? fo.alpha + (1 - fo.alpha) * Math.min(1, dt * 5) : Math.max(0, fo.alpha - dt * 4);
    const fmesh = frameMesh.current;
    if (fmesh !== null) {
      const a = fo.alpha * presence * appear.current;
      fmesh.visible = a > 0.01 && shown.current;
      if (fmesh.visible) {
        const pop = reduced ? 1 : 0.92 + 0.08 * fo.alpha;
        // Fading out after the page let go of it: it fades where it stood.
        if (layout.frameAt != null) lastFrameAt.current = layout.frameAt;
        else if (fo.on) lastFrameAt.current = null;
        const at = layout.frameAt ?? (fo.on ? null : lastFrameAt.current);
        if (at != null) {
          // Placed by the page (frameOnBeamy): his face in its window.
          const c = toWorld({ x: at.left + (at.h * 9) / 32, y: at.top + at.h / 2 });
          fmesh.position.set(c.x, c.y, -160);
          fmesh.scale.set(at.h * 0.5625 * pop, at.h * pop, 1);
        } else {
          const wp = toWorld(pos.current);
          // Feet just inside its lower edge; its masthead clears the bubble.
          const g = frameGeo();
          const fh = heightPx * g.h;
          fmesh.position.set(wp.x, wp.y + heightPx * g.c, -160);
          fmesh.scale.set(fh * 0.5625 * pop, fh * pop, 1);
        }
        frameMat.opacity = a;
      }
      // The window's backdrop rides the frame (a child: same transform, behind it).
      const fb = frameBack.current;
      const o = frameOpening.current;
      if (fb !== null) {
        fb.visible = fmesh.visible && o !== null;
        if (fb.visible && o !== null) {
          fb.position.set((o.left + o.right) / 2 - 0.5, 0.5 - (o.top + o.bottom) / 2, -20);
          fb.scale.set(Math.max(0.01, o.right - o.left), Math.max(0.01, o.bottom - o.top), 1);
          frameBackMat.opacity = a;
        }
      }
    }

    /* The Selfie clip on this stage: hand the page this frame's phone/head
       (and, on the snap frame, his portrait) for its flash + photo card. */
    const run = selfieRun.current;
    if (run !== null) {
      if (current.current !== run.action) {
        selfieRun.current = null;
        run.resolve(false);
      } else {
        run.t += dt * SELFIE_SPEED;
        const pw = new THREE.Vector3();
        if (phoneBone.current) phoneBone.current.getWorldPosition(pw); else pw.set(toWorld(pos.current).x - heightPx * 0.55, toWorld(pos.current).y + heightPx * 0.75, 0);
        pw.y += 0.05 * s; // the bone is the grip; the screen sits above it
        const hw = new THREE.Vector3();
        if (bodyBone.current) { bodyBone.current.getWorldPosition(hw); hw.y += 0.52 * s; } else hw.set(toWorld(pos.current).x, toWorld(pos.current).y + heightPx * 1.07, 0);
        const fr = framedRect();
        const frame: SelfieFrame = { t: run.t, tl: run.tl, phone: toScreen(pw), head: toScreen(hw), heightPx, framed: fr !== null };
        if (!run.snapped && run.t >= run.tl.cues.snap) {
          run.snapped = true;
          try {
            // Render now so the drawing buffer is valid for this task: his own selfie
            // (in a frame: the whole frame, him and what he wears in its window).
            state.gl.render(state.scene, state.camera);
            frame.photo = fr !== null ? snapshotRect(state.gl.domElement, fr, W) : snapshotPortrait(state.gl.domElement, frame.head, heightPx * 1.45, W);
          } catch {
            frame.photo = null;
          }
        }
        run.onFrame(frame);
        if (run.t >= run.tl.cues.end) { selfieRun.current = null; run.resolve(true); }
      }
    }

    const dec = decorRef.current;
    const H = sizeRef.current.height;

    /* His reflection on the glossy floor (desktop): copy every node of the
       real rig, then mirror the whole thing about his feet. */
    const rf = reflect.current;
    const rr = reflRig.current;
    if (rf !== null && rr !== null) {
      // Only while he stands at home on the hero's glossy floor, settled.
      const atHome = Math.hypot(pos.current.x - layout.home.x, pos.current.y - layout.home.y) < 6;
      const on = g !== null && g.visible && !dec.phone && layout.floor === true && atHome && presence > 0.99;
      rr.visible = on;
      if (on && g !== null) {
        for (const [a, b] of rf.pairs) { b.position.copy(a.position); b.quaternion.copy(a.quaternion); b.scale.copy(a.scale); b.visible = a.visible; }
        rr.position.copy(g.position);
        rr.rotation.set(-g.rotation.x, g.rotation.y, 0);
        rr.scale.set(g.scale.x, -g.scale.y, g.scale.z);
        rf.floorY.value = g.position.y;
        rf.fade.value = Math.max(6, heightPx * 0.32);
      }
    }

    /* Crystals: around the hero's panel, and around his hero stand at clearly
       different depths (behind him: small and hazy; in front: large and soft).
       They bob slowly; nearer ones parallax more with the scroll as the hero
       leaves. Static if reduced. */
    const scrollPar = reduced ? 0 : dec.scroll;
    for (let i = 0; i < CRYSTALS.length; i++) {
      const m = crystalRefs.current[i];
      if (!m) continue;
      const c = CRYSTALS[i];
      const panel = dec.panel;
      const stand = dec.stand;
      const on = panel !== null && (!dec.phone || c.phone) && ('panel' in c.at || (shown.current && stand !== null));
      m.visible = on;
      const sh = crystalShadowRefs.current[i];
      if (sh) sh.visible = on && c.shadow === true;
      if (!on || panel === null) continue;
      let x: number;
      let y: number;
      let size: number;
      let floorY: number | null = null;
      if ('panel' in c.at) {
        size = Math.min(panel.width, panel.height) * c.size * (dec.phone ? 0.75 : 1);
        x = panel.left + panel.width * c.at.panel[0];
        y = panel.top + panel.height * c.at.panel[1];
      } else {
        if (stand === null) continue;
        // On the floor around his stand: behind him smaller (perspective), in
        // front larger.
        const back = c.at.stand[1] < 0;
        const k = back ? 0.82 : 1.06;
        size = stand.heightPx * c.size * k;
        floorY = stand.feet.y + c.at.stand[1] * stand.heightPx;
        x = stand.feet.x + c.at.stand[0] * stand.heightPx;
        y = floorY - size * 0.32 - (c.at.lift ?? 0) * stand.heightPx * k;
      }
      // Scroll depth: nearer crystals leave faster than the page, far ones slower.
      const sy = -scrollPar * (c.depth - 0.4) * 0.35;
      y += sy;
      if (floorY !== null) floorY += sy;
      const bob = reduced ? 0 : Math.sin(t * 0.7 + i * 1.9) * 5 * (0.4 + c.depth);
      if (sh && c.shadow === true) {
        // On the floor under it, not bobbing; it tightens a little as the crystal floats up.
        const fy = floorY ?? y + size * 0.62;
        const lift = 1 - (bob / Math.max(1, size)) * 0.6;
        const sw = toWorld({ x, y: fy });
        sh.position.set(sw.x, sw.y, c.layer === 'front' ? 120 : -380);
        sh.scale.set(size * 1.15 * lift, size * 0.22 * lift, 1);
      }
      y += bob;
      // Never over the sticky header (its wordmark and links sit up there).
      if (y - size * 0.6 < (layout.bubbleMinY ?? 0)) {
        m.visible = false;
        if (sh) sh.visible = false;
        continue;
      }
      const cw = toWorld({ x, y });
      m.position.set(cw.x, cw.y, c.layer === 'back' ? -330 : c.layer === 'front' ? 300 : -120 + c.depth * 60);
      m.scale.setScalar(Math.max(1, size));
      // Upright, a slow turn on the spot, a gentle nod toward the viewer.
      if (!reduced) {
        m.rotation.y += dt * (0.16 + (i % 3) * 0.06);
        m.rotation.x = 0.22 + Math.sin(t * 0.45 + i) * 0.1;
      } else {
        m.rotation.set(0.22, 0.6 + i, 0);
      }
    }

    /* The AR props carousel: each stop's real GLB floats in its peek, small
       and swaying slowly (it bobs with the peek, which the page reads). Still
       when reduced. */
    const pk = dec.peeks ?? [];
    // Each slot keeps its model while its stop stays on the rail (a step
    // moves the stops, it must not reload them): a peek takes the slot that
    // already holds its URL, else a slot no current peek wants.
    const want = new Set(pk.map((q) => q.url));
    const slotPeek: (number | undefined)[] = Array.from({ length: PEEK_SLOTS }, () => undefined);
    const later: number[] = [];
    pk.forEach((q, j) => {
      const s = peekUrls.current.findIndex((u, k) => u === q.url && slotPeek[k] === undefined);
      if (s >= 0) slotPeek[s] = j; else later.push(j);
    });
    for (const j of later) {
      const s = slotPeek.findIndex((v, k) => v === undefined && !want.has(peekUrls.current[k] ?? ''));
      const f = s >= 0 ? s : slotPeek.findIndex((v) => v === undefined);
      if (f >= 0) slotPeek[f] = j;
    }
    for (let i = 0; i < PEEK_SLOTS; i++) {
      const holder = peekRefs.current[i];
      if (!holder) continue;
      const pj = slotPeek[i];
      const p = pj !== undefined ? pk[pj] : undefined;
      if (p === undefined || p.url === '') { holder.visible = false; continue; }
      if (peekUrls.current[i] !== p.url) {
        const url = p.url;
        peekUrls.current[i] = url;
        holder.clear();
        void loadModel(url).then((master) => {
          if (peekUrls.current[i] === url && holder.children.length === 0) { litProps(master); holder.add(unitClone(master)); }
        }, () => undefined);
      }
      holder.visible = holder.children.length > 0;
      const wp = toWorld({ x: p.x, y: p.y });
      holder.position.set(wp.x, wp.y, 260);
      holder.scale.setScalar(Math.max(1, p.size * 0.86));
      if (!reduced) {
        // A sway about the front, never a full turn: glasses, masks, face
        // paint and earrings are flat and front-facing, so a spin left their
        // stop empty for the half-turn they spent edge-on or back-facing.
        holder.rotation.y = 0.5 * Math.sin(state.clock.elapsedTime * 0.7 + i * 1.3);
        holder.rotation.x = 0.2;
      } else {
        holder.rotation.set(0.2, 0.5, 0);
      }
    }

    /* Beam quad: Beamy's own beam, or the entrance drop from the top. */
    const b = beamState.current;
    const bm = beamMesh.current;
    if (bm) {
      let alpha = 0;
      if (b !== null) {
        const hand = b.from === 'hand';
        const { fireS, endS } = b;
        b.t += dt;
        if (!b.fired && b.t >= fireS) { b.fired = true; b.onFire?.(); }
        if (b.t >= fireS && b.t <= endS + 0.2) {
          const k = b.t - fireS;
          // Reduced motion: the same beam, softer and steady (no wobble).
          alpha = Math.min(1, k / 0.12) * Math.min(1, (endS + 0.2 - b.t) / 0.25) * (reduced ? 0.6 : 1);
          const origin = hand ? apiRef.current?.hand() : apiRef.current?.mouth();
          const m = toWorld(origin ?? pos.current);
          const to = toWorld(b.to);
          const len = Math.hypot(to.x - m.x, to.y - m.y);
          bm.position.set((m.x + to.x) / 2, (m.y + to.y) / 2, 300);
          bm.rotation.z = Math.atan2(to.y - m.y, to.x - m.x);
          const width = (hand ? Math.max(14, heightPx * 0.1) : Math.max(26, heightPx * 0.22)) * (reduced ? 1 : 1 + 0.06 * Math.sin(t * 40));
          bm.scale.set(Math.max(1, len), width, 1);
        }
      } else if (ar !== null) {
        // Head of the column falls from above the viewport to his feet (ease-in),
        // then the full column lingers and fades as he appears. Reduced
        // motion: the whole column fades in softly where it stands, then out.
        const topY = -60;
        let headY: number;
        if (reduced) {
          headY = pos.current.y;
          const k = clamp(ar.t / REDUCED_DROP_S, 0, 1);
          const out = ar.landed ? clamp(1 - (ar.t - REDUCED_DROP_S) / REDUCED_LINGER_S, 0, 1) : 1;
          alpha = 0.55 * k * k * (3 - 2 * k) * out * out * (3 - 2 * out);
        } else {
          const fall = clamp(ar.t / DROP_S, 0, 1);
          headY = topY + (pos.current.y - topY) * fall * fall;
          const fade = ar.landed ? clamp(1 - (ar.t - DROP_S) / LINGER_S, 0, 1) : 1;
          alpha = Math.min(1, ar.t / 0.12) * fade;
        }
        const a = toWorld({ x: pos.current.x, y: topY });
        const z = toWorld({ x: pos.current.x, y: headY });
        const len = Math.max(1, a.y - z.y);
        bm.position.set(a.x, (a.y + z.y) / 2, 300);
        bm.rotation.z = -Math.PI / 2;
        bm.scale.set(len, Math.max(22, layout.heightPx * 0.16) * (ar.landed && !reduced ? 1 + (ar.t - DROP_S) * 1.2 : 1), 1);
      }
      bm.visible = alpha > 0.001;
      (beamMat.uniforms.uAlpha as { value: number }).value = alpha;
      (beamMat.uniforms.uTime as { value: number }).value = t;
    }
    // A zap owns no clip: it ends on its own clock.
    if (b !== null && b.done !== undefined && b.t > b.endS + 0.2) { beamState.current = null; b.done(); }

    /* Projector cone: from his mouth (or raised hand, handing over to the
       mouth once the wave is done) to the near edge of the film frame. */
    const cn = cone.current;
    const cm = coneMesh.current;
    if (cm) {
      let ca = 0;
      let landAt: { x: number; y: number; w: number; ang: number } | null = null;
      let srcAt: Pt | null = null;
      if (cn !== null) {
        cn.t += dt;
        const growS = reduced ? 0.9 : 0.6;
        const g2 = cn.grow ? clamp(cn.t / growS, 0, 1) : 1;
        if (!cn.landed && g2 >= 1) { cn.landed = true; cn.resolve(); }
        cn.alpha = cn.off ? Math.max(0, cn.alpha - dt / 0.3) : Math.min(1, cn.alpha + dt / (reduced ? 0.5 : 0.25));
        const r = cn.target();
        if (cn.off && cn.alpha <= 0) cone.current = null;
        else if (r !== null && presence > 0.5) {
          const api = apiRef.current;
          const mouthP = api?.mouth() ?? pos.current;
          let o = mouthP;
          if (cn.from === 'hand' && api) {
            const hp = api.hand();
            const k = clamp((cn.t - 0.9) / 0.5, 0, 1);
            o = { x: hp.x + (mouthP.x - hp.x) * k, y: hp.y + (mouthP.y - hp.y) * k };
          }
          // The edge facing him: below → bottom edge, left of it → left edge, else right.
          let e1: Pt; let e2: Pt;
          if (o.y > r.top + r.height) { e1 = { x: r.left, y: r.top + r.height }; e2 = { x: r.left + r.width, y: r.top + r.height }; }
          else if (o.x < r.left) { e1 = { x: r.left, y: r.top }; e2 = { x: r.left, y: r.top + r.height }; }
          else { e1 = { x: r.left + r.width, y: r.top + r.height }; e2 = { x: r.left + r.width, y: r.top }; }
          const ease = 1 - (1 - g2) ** 3;
          // A little wider than the card edge: the feathering eats its sides.
          const mx = (e1.x + e2.x) / 2;
          const my = (e1.y + e2.y) / 2;
          e1 = { x: mx + (e1.x - mx) * 1.25, y: my + (e1.y - my) * 1.25 };
          e2 = { x: mx + (e2.x - mx) * 1.25, y: my + (e2.y - my) * 1.25 };
          const pts = [o, { x: o.x + (e1.x - o.x) * ease, y: o.y + (e1.y - o.y) * ease }, { x: o.x + (e2.x - o.x) * ease, y: o.y + (e2.y - o.y) * ease }];
          (coneMat.uniforms.uLen as { value: number }).value = Math.max(1, Math.hypot(mx - o.x, my - o.y) * ease);
          (coneMat.uniforms.uHalf as { value: number }).value = Math.max(1, (Math.hypot(e2.x - e1.x, e2.y - e1.y) / 2) * ease);
          landAt = { x: mx, y: my, w: Math.hypot(e2.x - e1.x, e2.y - e1.y), ang: -Math.atan2(e2.y - e1.y, e2.x - e1.x) };
          srcAt = o;
          const arr = (cm.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
          pts.forEach((p2, i2) => { const wv = toWorld(p2); arr[i2 * 3] = wv.x; arr[i2 * 3 + 1] = wv.y; arr[i2 * 3 + 2] = 280; });
          cm.geometry.getAttribute('position').needsUpdate = true;
          // Once landed it settles to a quieter, steady projection (still clearly there).
          const settle = cn.landed ? 1 - 0.3 * clamp((cn.t - growS - 0.6) / 0.8, 0, 1) : 1;
          ca = cn.alpha * settle * (reduced ? 0.75 : 1) * presence;
        }
      }
      cm.visible = ca > 0.001;
      (coneMat.uniforms.uAlpha as { value: number }).value = ca;
      // The card's soft bloom where the light lands (once it has reached it).
      const cg = coneGlow.current;
      if (cg) {
        const ga = landAt !== null && cn !== null ? ca * clamp((cn.t - 0.35) / 0.6, 0, 1) * 0.42 : 0;
        cg.visible = ga > 0.001 && landAt !== null;
        if (cg.visible && landAt !== null) {
          const wv = toWorld(landAt);
          cg.position.set(wv.x, wv.y, 270);
          cg.rotation.z = landAt.ang;
          cg.scale.set(landAt.w * 0.9, landAt.w * 0.5, 1);
          (coneGlowMat.uniforms.uAlpha as { value: number }).value = ga;
        }
      }
      // Its source: a round soft glow, the brightest part of the light.
      const cs = coneSrc.current;
      if (cs) {
        const sa = srcAt !== null ? ca * 0.42 : 0;
        cs.visible = sa > 0.001 && srcAt !== null;
        if (cs.visible && srcAt !== null) {
          const wv = toWorld(srcAt);
          const d = Math.max(36, layout.heightPx * 0.32);
          cs.position.set(wv.x, wv.y, 275);
          cs.scale.set(d, d, 1);
          (coneSrcMat.uniforms.uAlpha as { value: number }).value = sa;
        }
      }
      (coneMat.uniforms.uTime as { value: number }).value = t;
      (coneMat.uniforms.uFlicker as { value: number }).value = reduced ? 0 : 1;
    }

    /* A revealed prop stays on its spot as the page scrolls. */
    const pa = propAt.current;
    if (pa !== null && propGroup.current !== null && propGroup.current.visible) {
      const pw = toWorld(pa());
      propGroup.current.position.x = pw.x;
      propGroup.current.position.y = pw.y;
      if (reveal.current !== null) reveal.current.to.set(pw.x, pw.y, 130);
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
        carr[i * 4] = moteBase[i * 3] * a;
        carr[i * 4 + 1] = moteBase[i * 3 + 1] * a;
        carr[i * 4 + 2] = moteBase[i * 3 + 2] * a;
        carr[i * 4 + 3] = a;
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

    /* Layering: the canvas lives BEHIND the page, so he passes behind the
       content as he glides. The hero's frosted glass box is the one place he
       must stand in front (he is inside it), so while his body overlaps it
       the layer steps in front of the page. */
    const wrap = wrapEl.current ?? (wrapEl.current = gl.domElement.closest<HTMLElement>('[data-beamy-stage]'));
    if (wrap !== null) {
      const pn = dec.panel;
      const half = heightPx * 0.6;
      const over = pn !== null && g !== null && g.visible
        && pos.current.x + half > pn.left && pos.current.x - half < pn.left + pn.width
        && pos.current.y > pn.top && pos.current.y - heightPx < pn.top + pn.height;
      // The AR step: in front, so a hat or an earring draws over the frame.
      const z = over || dec.arOver !== undefined ? 'front' : 'back';
      if (wrap.dataset.layer !== z) wrap.dataset.layer = z;
    }
    // ...while the frame (and its arrows) still cover his body.
    const ao = dec.arOver;
    const mSlots = [arU.uArM0, arU.uArM1, arU.uArM2], rSlots = [arU.uArR0, arU.uArR1, arU.uArR2];
    for (let i = 0; i < 3; i++) {
      const f = ao?.frames[i];
      let tex: THREE.Texture | null = null;
      if (f !== undefined) {
        if (!arTex.current.has(f.url)) {
          arTex.current.set(f.url, null);
          new THREE.TextureLoader().load(f.url, (t) => { arTex.current.set(f.url, t); }, undefined, () => undefined);
        }
        tex = arTex.current.get(f.url) ?? null;
      }
      mSlots[i].value = tex ?? AR_BLANK;
      if (f !== undefined) rSlots[i].value.set(f.left, f.top, Math.max(1, f.width), Math.max(1, f.height));
      arU.uArA.value.setComponent(i, tex !== null && f !== undefined ? f.a : 0);
    }
    const h0 = ao?.holes[0], h1 = ao?.holes[1];
    arU.uArH0.value.set(h0?.x ?? 0, h0?.y ?? 0, h0?.r ?? 0);
    arU.uArH1.value.set(h1?.x ?? 0, h1?.y ?? 0, h1?.r ?? 0);
    arU.uArView.value.set(gl.getPixelRatio(), sizeRef.current.height);

    /* DOM followers: speech bubble over (or beside) the head, poke button over the body. */
    const top = pos.current.y - heightPx * 1.02;
    // A worn prop rises above his tip: the bubble rides above it, not on it.
    const wn2 = worn.current;
    const lift = wn2 === null ? 0 : Math.max(0, wornTopAt(wn2, wn2.k) - 1) * Math.min(1, wn2.t);
    const bubbleTop = top - heightPx * lift;
    const bubble = bubbleRef.current;
    if (bubble) {
      const bw = bubble.offsetWidth;
      const bh = bubble.offsetHeight;
      // The page may fence the bubble between two things it must never cover
      // (data-min-x / data-max-x, viewport px); otherwise the viewport edges.
      const lo = Math.max(12, Number(bubble.dataset.minX ?? 12));
      const hi = Math.min(W - 12, Number(bubble.dataset.maxX ?? W - 12));
      const minY = layout.bubbleMinY ?? 64;
      const aboveY = bubbleTop - bh - 6;
      let left: number;
      let y: number;
      let tail: 'down' | 'up' | 'left' | 'right';
      // Where it may go, in order: above his head; beside it (inside the
      // fences); under his feet (his own column, when he is held at the top
      // of the screen); otherwise it steps away rather than cover anything.
      let fits = true;
      const half = heightPx * 0.42;
      const roomR = hi - (pos.current.x + half + 10);
      const roomL = pos.current.x - half - 10 - lo;
      const belowY = pos.current.y + 12;
      const maxY = layout.bubbleMaxY ?? H - 12;
      if (layout.bubbleSide !== true && aboveY >= minY) {
        left = clamp(pos.current.x - bw / 2, lo, Math.max(lo, hi - bw));
        y = aboveY;
        tail = 'down';
      } else if (roomR >= bw || roomL >= bw || layout.bubbleSide === true) {
        // Beside his head on the roomier side, never over his face.
        const right = roomR >= bw ? true : roomL >= bw ? false : roomR >= roomL;
        left = right ? pos.current.x + half + 10 : pos.current.x - half - 10 - bw;
        left = clamp(left, lo, Math.max(lo, hi - bw));
        y = clamp(pos.current.y - heightPx * 0.72 - bh / 2, minY, Math.max(minY, pos.current.y - bh));
        tail = right ? 'left' : 'right';
        fits = roomR >= bw || roomL >= bw;
      } else {
        left = clamp(pos.current.x - bw / 2, lo, Math.max(lo, hi - bw));
        y = belowY;
        tail = 'up';
        fits = belowY + bh <= maxY;
      }
      bubble.style.transform = `translate3d(${left.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      bubble.style.setProperty('--tail-x', `${clamp(pos.current.x - left, 22, bw - 22).toFixed(1)}px`);
      if (bubble.dataset.tail !== tail) bubble.dataset.tail = tail;
      const hide = presence < 0.6 || !shown.current || layout.bubbleAway === true || !fits;
      if ((bubble.dataset.away === 'true') !== hide) bubble.dataset.away = hide ? 'true' : 'false';
    }
    const hit = hitRef.current;
    if (hit) {
      const hw = heightPx * 0.8;
      hit.style.width = `${hw}px`;
      hit.style.height = `${heightPx}px`;
      hit.style.transform = `translate3d(${(pos.current.x - hw / 2).toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
      // The page hit-tests taps against this box (it takes no pointer events itself).
      const away = presence < 0.6 || layout.hitAway === true ? 'true' : 'false';
      if (hit.dataset.away !== away) hit.dataset.away = away;
    }
  });

  return (
    <>
      <hemisphereLight args={['#dfe6ff', '#2a1d4a', 1.5]} />
      {/* Key from the top-left (where the panel's rim and sheen are brightest), a
          cool fill from the right, and a soft rim from behind that edges him. */}
      <directionalLight position={[-520, 640, 820]} intensity={2.2} />
      <directionalLight position={[600, 120, 500]} intensity={0.7} color="#a78bfa" />
      <directionalLight position={[260, 380, -900]} intensity={1.5} color="#dcd8ff" />
      <mesh ref={floor} material={floorMat} renderOrder={0}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      {CRYSTALS.map((c, i) => c.shadow === true && (
        <mesh
          key={`s${i}`}
          ref={(m) => { crystalShadowRefs.current[i] = m; }}
          material={crystalShadowMat}
          visible={false}
          frustumCulled={false}
          renderOrder={0}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
      {CRYSTALS.map((c, i) => (
        <group key={`${c.prop}${i}`} ref={(m) => { crystalRefs.current[i] = m; }} visible={false} />
      ))}
      {Array.from({ length: PEEK_SLOTS }, (_, i) => (
        <group key={`peek${i}`} ref={(m) => { peekRefs.current[i] = m; }} visible={false} />
      ))}
      <group ref={reflRig} visible={false}>
        {reflectObj !== null && <primitive object={reflectObj} />}
      </group>
      <mesh ref={frameMesh} material={frameMat} visible={false} frustumCulled={false} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
        <mesh ref={frameBack} material={frameBackMat} visible={false} frustumCulled={false} renderOrder={0.5}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      </mesh>
      {model !== null && (
        <group ref={rig}>
          <primitive object={model.scene} />
        </group>
      )}
      <mesh ref={coneMesh} geometry={coneGeo} material={coneMat} visible={false} frustumCulled={false} renderOrder={4} />
      <mesh ref={coneGlow} material={coneGlowMat} visible={false} renderOrder={4}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={coneSrc} material={coneSrcMat} visible={false} renderOrder={4}>
        <planeGeometry args={[1, 1]} />
      </mesh>
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
  // DPR cap (dprCap): 2 on desktop, 1.5 on phones and touch; the scene's
  // governor steps below it when frames run slow.
  const [maxDpr] = useState(dprCap);
  const debugRef = useRef<HTMLDivElement | null>(null);
  // A hidden tab renders nothing.
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return (
    <div data-beamy-stage data-layer="back" className="bw-stage pointer-events-none fixed inset-0" aria-hidden>
      <Canvas
        orthographic
        dpr={[1, maxDpr]}
        frameloop={hidden ? 'never' : 'always'}
        events={noopEvents}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0, 1000], near: 1, far: 3000, zoom: 1 }}
        // R3F's wrapper sets pointer-events:auto; the canvas is decoration,
        // so every tap must fall through to the page.
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
      >
        <Scene {...props} debugRef={debugRef} />
        {props.children}
      </Canvas>
      {DEBUG && createPortal(
        <div
          ref={debugRef}
          aria-hidden
          style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 9999, pointerEvents: 'none', padding: '4px 8px', borderRadius: 8, background: 'rgba(8,8,24,0.78)', color: '#E8ECFF', font: '11px/1.35 ui-monospace, monospace', whiteSpace: 'pre-wrap', maxWidth: 'calc(100vw - 16px)' }}
        />,
        document.body,
      )}
    </div>
  );
}
