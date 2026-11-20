/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The three.js half of the 'airplane' reveal (shell: ./AirplaneReveal.tsx).
 *
 * A real folded dart (lib/cardFlight buildDart: the sheet cut along its crease
 * pattern into rigid facets) glides a lazy figure-of-eight across the dusk,
 * steering a little toward the finger, trailing a contrail of sparkles. Caught
 * (tap, Enter/Space, or a flick), it swoops at the viewer, loops once, settles
 * in front — light races along its creases — and unfolds fold by fold while
 * warm light blooms out of the opening creases; the sheet turns to face you
 * and the camera eases in until the printed card fills the frame.
 *
 * Paper: a pearlescent MeshPhysicalMaterial (sheen + iridescence + a little
 * clearcoat) with an embossed normal map drawn on a canvas (fibres, filigree
 * that lines up with the print, the creases as grooves), and a crease-glow
 * mask the fragment shader lights for the pulse and the bloom. The front
 * face carries the printed card; the back is plain stock. At the very end an
 * unlit copy of the print fades over the paper so the last frame is the card
 * in its true colours — the hand-off to the template is seamless.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import {
  airplaneTimeline,
  bloomAt,
  buildDart,
  catchPath,
  dartFrame,
  FOLDED,
  fillDistance,
  figureEight,
  flightAttitude,
  foldAmountsAt,
  kinematics,
  poseDart,
  viewHalfExtents,
  window01,
  easeInOutSine,
  type CardStage,
  type CatchPath,
  type FigureEight,
  type FoldAmounts,
  type V3,
} from '../../../lib/cardFlight';
import type { CardPalette } from '../../../lib/cardPresentation';
import { haloSprite, paperMaps, WARM_CORE } from './airplaneCardFace';

export const AIRPLANE_FOV = 40;
/** Lift "gravity" for the attitude: low, so a lazy turn still banks. */
const BANK_G = 1.6;

export interface AirplaneControl {
  catchRequested: boolean;
  /** Pointer in NDC (-1..1, y up) and whether it is over the stage. */
  pointer: { x: number; y: number; active: boolean };
  /** A flick's velocity in NDC per second, if the plane was flung. */
  flick: { x: number; y: number } | null;
}

interface SceneProps {
  control: MutableRefObject<AirplaneControl>;
  stage: CardStage;
  palette: CardPalette;
  reducedMotion: boolean;
  face: HTMLCanvasElement | null;
  onFinished: () => void;
}

const CONTRAIL = 170;
const MOTES = 90;
const STARS = 200;

const sparkVert = /* glsl */ `
  attribute float aBirth;
  attribute float aHue;
  uniform float uTime;
  uniform float uLife;
  uniform float uSize;
  uniform float uPixelRatio;
  varying float vA;
  varying float vH;
  void main() {
    float age = uTime - aBirth;
    float k = clamp(age / uLife, 0.0, 1.0);
    vA = (1.0 - k) * (1.0 - k) * step(0.0, age) * step(age, uLife);
    vH = aHue;
    vec3 p = position + vec3(0.0, -age * 0.12, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(uSize * uPixelRatio * (1.0 - 0.55 * k) * (0.55 + 0.9 * fract(aHue * 7.31)) / max(0.1, -mv.z), 0.0, 48.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const sparkFrag = /* glsl */ `
  uniform vec3 uAccent;
  uniform vec3 uWarm;
  uniform float uOpacity;
  varying float vA;
  varying float vH;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    vec3 c = mix(uAccent, uWarm, step(0.68, vH));
    c = mix(c, vec3(1.0), 0.4 + 0.4 * step(0.92, vH));
    float alpha = a * vA * uOpacity;
    gl_FragColor = vec4(c * alpha, alpha);
  }
`;

const moteVert = /* glsl */ `
  attribute vec3 aVel;
  attribute float aHue;
  uniform float uAge;
  uniform float uSize;
  uniform float uPixelRatio;
  varying float vA;
  varying float vH;
  void main() {
    float age = max(0.0, uAge - aHue * 0.6);
    float life = 1.6 + aHue;
    float k = clamp(age / life, 0.0, 1.0);
    vA = sin(k * 3.14159) * step(0.001, age);
    vH = aHue;
    vec3 p = position + aVel * (1.0 - exp(-age * 1.4)) * 1.2 + vec3(0.0, age * 0.05, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(uSize * uPixelRatio * (0.6 + aHue) / max(0.1, -mv.z), 0.0, 40.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const starVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vA;
  void main() {
    vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 1.7) + aSeed * 40.0));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (1.2 + aSeed * 2.2) * uPixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const starFrag = /* glsl */ `
  uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vA * uOpacity;
    gl_FragColor = vec4(vec3(1.0) * a, a);
  }
`;

/** Patch the physical material: the crease mask (emissiveMap) drives the pulse + bloom. */
function creaseShader(material: THREE.MeshPhysicalMaterial, uniforms: Record<string, THREE.IUniform>): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uPulseFront;
        uniform float uPulseAmp;
        uniform float uBloom;
        uniform float uAspect;
        uniform vec3 uWarm;
        uniform vec3 uAccent;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#ifdef USE_EMISSIVEMAP
          vec4 creaseTex = texture2D( emissiveMap, vEmissiveMapUv );
          vec2 fromNose = ( vEmissiveMapUv - vec2( 0.5, 1.0 ) ) * vec2( uAspect, 1.0 );
          float dn = length( fromNose );
          float pulse = exp( -pow( ( dn - uPulseFront ) / 0.09, 2.0 ) ) * uPulseAmp;
          float line = creaseTex.r;
          float halo = creaseTex.g;
          // Warm core on the crease itself, falling off to the accent in the halo.
          vec3 bloomCol = mix( uAccent, uWarm, smoothstep( 0.15, 0.85, line + halo * 0.35 ) );
          totalEmissiveRadiance =
            uWarm * line * pulse * 2.2 +
            mix( uAccent, uWarm, 0.35 ) * halo * pulse * 0.8 +
            bloomCol * ( line * 1.1 + halo * 0.95 ) * uBloom;
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'beamwall-paper-crease';
}

function canvasTexture(c: HTMLCanvasElement, srgb: boolean, gl: THREE.WebGLRenderer): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  return t;
}

export default function AirplaneScene({ control, stage, palette, reducedMotion, face, onFinished }: SceneProps) {
  const { gl, size, clock } = useThree();
  const viewAspect = size.width / Math.max(1, size.height);
  const tl = useMemo(() => airplaneTimeline(reducedMotion), [reducedMotion]);

  /* ── Geometry: the dart ─────────────────────────────────────────────── */
  const model = useMemo(() => buildDart(stage.aspect, 1), [stage.aspect]);
  const frame = useMemo(() => dartFrame(model), [model]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(model.flat.length), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos);
    g.setAttribute('uv', new THREE.BufferAttribute(model.uv, 2));
    poseDart(model, FOLDED, pos.array as Float32Array);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [model]);
  // Wing tips (for the contrail): the most extreme points sideways when folded.
  const tips = useMemo(() => {
    const p = geometry.getAttribute('position');
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) < p.getZ(lo)) lo = i;
      if (p.getZ(i) > p.getZ(hi)) hi = i;
    }
    return [lo, hi];
  }, [geometry]);

  /* ── Paper maps + materials ─────────────────────────────────────────── */
  const maps = useMemo(() => {
    const W = 768;
    const H = Math.round(W / stage.aspect);
    const m = paperMaps(W, H, model);
    return { normal: canvasTexture(m.normal, false, gl), glow: canvasTexture(m.glow, false, gl) };
  }, [model, stage.aspect, gl]);

  const uniforms = useMemo(
    () => ({
      uPulseFront: { value: 0 },
      uPulseAmp: { value: 0 },
      uBloom: { value: 0 },
      uAspect: { value: stage.aspect },
      uWarm: { value: new THREE.Color(WARM_CORE) },
      uAccent: { value: new THREE.Color(palette.accent) },
    }),
    [stage.aspect, palette.accent],
  );

  const materials = useMemo(() => {
    const base = {
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.46,
      metalness: 0,
      sheen: 0.7,
      sheenRoughness: 0.42,
      sheenColor: new THREE.Color(palette.accent),
      iridescence: 0.55,
      iridescenceIOR: 1.32,
      iridescenceThicknessRange: [180, 520] as [number, number],
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
      emissive: new THREE.Color('#ffffff'),
      emissiveMap: maps.glow,
    };
    const front = new THREE.MeshPhysicalMaterial({ ...base, color: '#ffffff', side: THREE.FrontSide });
    const back = new THREE.MeshPhysicalMaterial({ ...base, color: '#f2f0fb', side: THREE.BackSide });
    creaseShader(front, uniforms);
    creaseShader(back, uniforms);
    return { front, back };
  }, [maps, uniforms, palette.accent]);

  const faceTex = useMemo(() => (face ? canvasTexture(face, true, gl) : null), [face, gl]);
  useEffect(() => {
    materials.front.map = faceTex;
    // Before the print is ready the front is the same pearl stock as the back.
    materials.front.color.set(faceTex ? '#ffffff' : '#f2f0fb');
    materials.front.needsUpdate = true;
  }, [faceTex, materials]);

  const print = useMemo(
    () =>
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
    [],
  );
  useEffect(() => {
    print.map = faceTex;
    print.needsUpdate = true;
  }, [faceTex, print]);
  const printGeo = useMemo(() => new THREE.PlaneGeometry(2 * model.w, 2 * model.h), [model]);

  const haloTex = useMemo(() => canvasTexture(haloSprite(palette.accent), true, gl), [palette.accent, gl]);
  const halo = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: haloTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [haloTex],
  );
  const haloGeo = useMemo(() => new THREE.PlaneGeometry(2 * model.w * 2.6, 2 * model.h * 1.9), [model]);

  /* ── Sparkles: contrail (world), motes (sheet-local), stars ─────────── */
  const pixelRatio = gl.getPixelRatio();
  const sparkUniforms = useMemo(
    () => ({
      uAccent: { value: new THREE.Color(palette.accent) },
      uWarm: { value: new THREE.Color(WARM_CORE) },
    }),
    [palette.accent],
  );
  const contrail = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(CONTRAIL * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    const birth = new THREE.BufferAttribute(new Float32Array(CONTRAIL).fill(-1e4), 1);
    birth.setUsage(THREE.DynamicDrawUsage);
    const hue = new Float32Array(CONTRAIL);
    for (let i = 0; i < CONTRAIL; i++) hue[i] = Math.random();
    g.setAttribute('position', pos);
    g.setAttribute('aBirth', birth);
    g.setAttribute('aHue', new THREE.BufferAttribute(hue, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const m = new THREE.ShaderMaterial({
      vertexShader: sparkVert,
      fragmentShader: sparkFrag,
      uniforms: {
        ...sparkUniforms,
        uTime: { value: 0 },
        uLife: { value: reducedMotion ? 1.0 : 1.5 },
        uSize: { value: 70 },
        uPixelRatio: { value: pixelRatio },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // The shaders output premultiplied colour: add it 1:1.
      premultipliedAlpha: true,
    });
    return { g, m, head: 0 };
  }, [sparkUniforms, reducedMotion, pixelRatio]);

  const motes = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(MOTES * 3);
    const vel = new Float32Array(MOTES * 3);
    const hue = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) {
      const [p, q] = model.creases[Math.floor(Math.random() * model.creases.length)];
      const t = Math.random();
      pos[i * 3] = p[0] + (q[0] - p[0]) * t;
      pos[i * 3 + 1] = p[1] + (q[1] - p[1]) * t;
      pos[i * 3 + 2] = 0.02;
      const a = Math.random() * Math.PI * 2;
      const s = 0.15 + Math.random() * 0.45;
      vel[i * 3] = Math.cos(a) * s;
      vel[i * 3 + 1] = Math.sin(a) * s;
      vel[i * 3 + 2] = 0.3 + Math.random() * 0.9;
      hue[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    g.setAttribute('aHue', new THREE.BufferAttribute(hue, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    const m = new THREE.ShaderMaterial({
      vertexShader: moteVert,
      fragmentShader: sparkFrag,
      uniforms: {
        ...sparkUniforms,
        uAge: { value: 0 },
        uSize: { value: 30 },
        uPixelRatio: { value: pixelRatio },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // The shaders output premultiplied colour: add it 1:1.
      premultipliedAlpha: true,
    });
    return { g, m };
  }, [model, sparkUniforms, pixelRatio]);

  const stars = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(STARS * 3);
    const seed = new Float32Array(STARS);
    for (let i = 0; i < STARS; i++) {
      const z = -40 - Math.random() * 30;
      const { hw, hh } = viewHalfExtents(-z, Math.max(viewAspect, 0.5), AIRPLANE_FOV);
      pos[i * 3] = (Math.random() * 2 - 1) * hw * 1.1;
      pos[i * 3 + 1] = (Math.random() * 1.6 - 0.45) * hh;
      pos[i * 3 + 2] = z;
      seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uOpacity: { value: 0.8 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // The shaders output premultiplied colour: add it 1:1.
      premultipliedAlpha: true,
    });
    return { g, m };
  }, [pixelRatio, viewAspect]);

  // Release everything this scene created (R3F does not own `new`-ed resources).
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => { maps.normal.dispose(); maps.glow.dispose(); }, [maps]);
  useEffect(() => () => { materials.front.dispose(); materials.back.dispose(); }, [materials]);
  useEffect(() => () => faceTex?.dispose(), [faceTex]);
  useEffect(() => () => { print.dispose(); printGeo.dispose(); }, [print, printGeo]);
  useEffect(() => () => { halo.dispose(); haloGeo.dispose(); haloTex.dispose(); }, [halo, haloGeo, haloTex]);
  useEffect(() => () => { contrail.g.dispose(); contrail.m.dispose(); }, [contrail]);
  useEffect(() => () => { motes.g.dispose(); motes.m.dispose(); }, [motes]);
  useEffect(() => () => { stars.g.dispose(); stars.m.dispose(); }, [stars]);

  /* ── Stage distances ────────────────────────────────────────────────── */
  const dist = useMemo(() => {
    const dFill = fillDistance(2 * model.w, 2 * model.h, viewAspect, AIRPLANE_FOV, stage.fillHeight, stage.fullBleed);
    const t = Math.tan(((AIRPLANE_FOV * Math.PI) / 180) / 2);
    // The folded plane (2 units long, seen ~3/4 on) at ~85% of the view width.
    const dPlane = (2 * 0.72) / (0.85 * 2 * t * viewAspect);
    const dSettle = Math.max(dFill * 1.35, dPlane, 3);
    return { dFill, dSettle, dIdle: dSettle * 2.6 };
  }, [model, viewAspect, stage]);

  const eight = useMemo<FigureEight>(() => {
    const { hw, hh } = viewHalfExtents(dist.dIdle, viewAspect, AIRPLANE_FOV);
    const k = reducedMotion ? 0.7 : 1;
    return {
      center: [0, hh * 0.14, -dist.dIdle],
      ax: hw * 0.55 * k,
      ay: hh * 0.32 * k,
      az: dist.dIdle * 0.16 * k,
      period: reducedMotion ? 16 : 11,
    };
  }, [dist, viewAspect, reducedMotion]);

  /* ── Per-frame state ────────────────────────────────────────────────── */
  const root = useRef<THREE.Group>(null);
  const live = useRef({
    tapAt: null as number | null,
    path: null as CatchPath | null,
    steer: new THREE.Vector2(),
    q: new THREE.Quaternion(),
    qHeld: new THREE.Quaternion(),
    qInit: false,
    finished: false,
    lastEmit: 0,
    amounts: { ...FOLDED } as FoldAmounts,
  });
  const scratch = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      localT: new THREE.Matrix4()
        .makeBasis(
          new THREE.Vector3(...frame.up),
          new THREE.Vector3(...frame.forward),
          new THREE.Vector3(...frame.side),
        )
        .transpose(),
      U: new THREE.Vector3(),
      F: new THREE.Vector3(),
      S: new THREE.Vector3(),
      qT: new THREE.Quaternion(),
      ident: new THREE.Quaternion(),
      v: new THREE.Vector3(),
    }),
    [frame],
  );

  const attitudeQuat = (vel: V3, acc: V3, out: THREE.Quaternion): boolean => {
    const att = flightAttitude(vel, acc, BANK_G);
    if (att === null) return false;
    scratch.U.set(...att.up);
    scratch.F.set(...att.forward);
    scratch.S.crossVectors(scratch.U, scratch.F);
    scratch.m.makeBasis(scratch.U, scratch.F, scratch.S);
    // world basis · local basisᵀ
    scratch.m.multiply(scratch.localT);
    out.setFromRotationMatrix(scratch.m);
    return true;
  };

  const idlePath = (t: number): V3 => {
    const p = figureEight(eight, t);
    const s = live.current.steer;
    return [p[0] + s.x, p[1] + s.y, p[2]];
  };

  useFrame((_, delta) => {
    const g = root.current;
    if (!g) return;
    const L = live.current;
    const now = clock.elapsedTime;
    const dt = Math.min(0.05, delta);
    const ctl = control.current;
    const { hw: hwSettle, hh: hhSettle } = viewHalfExtents(dist.dSettle, viewAspect, AIRPLANE_FOV);
    const { hw: hwIdle, hh: hhIdle } = viewHalfExtents(dist.dIdle, viewAspect, AIRPLANE_FOV);

    // Catch!
    if (ctl.catchRequested && L.tapAt === null) {
      const k = kinematics(idlePath, now);
      let vel = k.vel;
      if (ctl.flick) {
        vel = [vel[0] + ctl.flick.x * hwIdle * 0.5, vel[1] + ctl.flick.y * hhIdle * 0.5, vel[2] - 2];
      }
      L.tapAt = now;
      L.path = catchPath({
        start: k.pos,
        startVel: vel,
        settle: [0, 0, -dist.dSettle],
        hw: hwSettle,
        hh: hhSettle,
        duration: tl.flight,
        loop: !reducedMotion,
      });
    }

    let pos: V3;
    let pulseFront = 0;
    let pulseAmp = 0;
    let bloom = 0;
    let faceBlend = 0;
    let dolly = 0;
    let printOp = 0;
    let emit = true;
    let moteAge = -1;
    const amounts = L.amounts;

    if (L.tapAt === null || L.path === null) {
      // Idle: steer gently toward the finger.
      const target = ctl.pointer.active
        ? { x: ctl.pointer.x * hwIdle * 0.32, y: ctl.pointer.y * hhIdle * 0.28 }
        : { x: 0, y: 0 };
      const ks = 1 - Math.exp(-dt * 1.4);
      L.steer.x += (target.x - L.steer.x) * ks;
      L.steer.y += (target.y - L.steer.y) * ks;
      const k = kinematics(idlePath, now);
      pos = k.pos;
      if (attitudeQuat(k.vel, k.acc, scratch.qT)) {
        if (!L.qInit) {
          L.q.copy(scratch.qT);
          L.qInit = true;
        } else L.q.slerp(scratch.qT, 1 - Math.exp(-dt * 6));
      }
      amounts.corners = 1;
      amounts.edges = 1;
      amounts.keel = 1;
      amounts.wings = 1 + 0.04 * Math.sin(now * 5.1) * (reducedMotion ? 0.4 : 1);
      // A faint shimmer runs along the creases every few seconds.
      const cyc = (now % 4.6) / 1.8;
      if (cyc < 1) {
        pulseFront = cyc * 1.25;
        pulseAmp = 0.35 * Math.sin(cyc * Math.PI);
      }
    } else {
      const t = now - L.tapAt;
      const path = L.path;
      if (t < path.duration) {
        const k = kinematics(path.at, t, 1 / 240);
        pos = k.pos;
        if (attitudeQuat(k.vel, k.acc, scratch.qT)) {
          L.q.slerp(scratch.qT, 1 - Math.exp(-dt * (reducedMotion ? 8 : 14)));
          L.qHeld.copy(L.q);
        }
      } else {
        pos = path.at(path.duration);
      }
      Object.assign(amounts, foldAmountsAt(tl, t));
      const pw = window01(t, tl.pulse.start, tl.pulse.end, easeInOutSine);
      if (t >= tl.pulse.start && t <= tl.pulse.end + 0.2) {
        pulseFront = pw * 1.35;
        pulseAmp = Math.sin(Math.min(1, pw * 1.05) * Math.PI) * 1.1;
      }
      bloom = bloomAt(tl, t);
      faceBlend = window01(t, tl.face.start, tl.face.end);
      dolly = window01(t, tl.dolly.start, tl.dolly.end);
      printOp = window01(t, tl.print.start, tl.print.end);
      emit = t < tl.pulse.start;
      moteAge = t - tl.unfold.edges.start;
      if (t >= tl.done && !L.finished) {
        L.finished = true;
        onFinished();
      }
      if (t >= path.duration) L.q.copy(L.qHeld);
    }

    // Pose the paper.
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    poseDart(model, amounts, posAttr.array as Float32Array);
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();

    // Place the sheet: flight → settle → eased toward the camera until it fills the frame.
    const fillZ = -dist.dFill;
    g.position.set(pos[0], pos[1], pos[2] + (fillZ - pos[2]) * dolly);
    g.quaternion.copy(L.q).slerp(scratch.ident, faceBlend);

    uniforms.uPulseFront.value = pulseFront;
    uniforms.uPulseAmp.value = pulseAmp;
    uniforms.uBloom.value = bloom;
    print.opacity = printOp;
    halo.opacity = Math.min(1, bloom * 0.95 + pulseAmp * 0.12) * (1 - printOp * 0.85);
    motes.m.uniforms.uAge.value = Math.max(0, moteAge);
    motes.m.uniforms.uOpacity.value = moteAge > 0 ? 1 - printOp : 0;

    // Contrail from the wing tips.
    contrail.m.uniforms.uTime.value = now;
    stars.m.uniforms.uTime.value = now;
    if (emit && now - L.lastEmit > (reducedMotion ? 1 / 20 : 1 / 45)) {
      L.lastEmit = now;
      g.updateMatrixWorld();
      const cp = contrail.g.getAttribute('position') as THREE.BufferAttribute;
      const cb = contrail.g.getAttribute('aBirth') as THREE.BufferAttribute;
      for (const vi of tips) {
        scratch.v.fromBufferAttribute(posAttr, vi).applyMatrix4(g.matrixWorld);
        const i = contrail.head;
        contrail.head = (contrail.head + 1) % CONTRAIL;
        cp.setXYZ(i, scratch.v.x + (Math.random() - 0.5) * 0.08, scratch.v.y + (Math.random() - 0.5) * 0.08, scratch.v.z);
        cb.setX(i, now);
      }
      cp.needsUpdate = true;
      cb.needsUpdate = true;
    }
  });

  const accent = palette.accent;
  return (
    <>
      <hemisphereLight args={[accent, '#2a2240', 0.75]} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} color="#ffffff" />
      <directionalLight position={[-4, 2, -6]} intensity={2.6} color={accent} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 5, 2]} scale={[10, 3, 1]} />
        <Lightformer form="ring" intensity={3} color={accent} position={[-5, 0, -4]} scale={4} />
        <Lightformer form="rect" intensity={1.6} color={WARM_CORE} position={[5, -1, 3]} scale={[3, 6, 1]} />
        <Lightformer form="rect" intensity={1.2} color={accent} position={[0, -5, 0]} scale={[10, 2, 1]} />
      </Environment>
      <points geometry={stars.g} material={stars.m} frustumCulled={false} />
      <points geometry={contrail.g} material={contrail.m} frustumCulled={false} />
      <group ref={root}>
        <mesh geometry={haloGeo} material={halo} position={[0, 0, -0.06]} renderOrder={-1} />
        <mesh geometry={geometry} material={materials.back} />
        <mesh geometry={geometry} material={materials.front} />
        <mesh geometry={printGeo} material={print} position={[0, 0, 0.004]} renderOrder={2} />
        <points geometry={motes.g} material={motes.m} frustumCulled={false} />
      </group>
    </>
  );
}
