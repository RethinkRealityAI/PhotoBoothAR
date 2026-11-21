/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The three.js half of the 'stardust' reveal (shell: ./StardustReveal.tsx).
 *
 * One draw call of thousands of soft additive points. Idle, they are a slow
 * spiral galaxy (warm core #FFC56B, accent arms) drifting on a divergence-free
 * curl flow, with the card title glowing faintly at its heart; the swirl bends
 * round the finger. On the tap the galaxy spins up into a vortex and every
 * point flies — on a spiral, after its own delay, centre first — to a target
 * sampled from the rendered card face (lib/cardStardust sampleCardTargets),
 * taking on that texel's colour as it lands, so the cloud BECOMES the card. As
 * it locks in: a flash, a pulse of light racing round the card's edge and the
 * photo's arch, the solid card cross-fades in over the dust and glows.
 *
 * All motion is in the vertex shader; the CPU only advances a handful of
 * uniforms (the spin angle is integrated here so spin-up never jumps).
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { fillDistance, viewHalfExtents, type CardStage } from '../../../lib/cardFlight';
import {
  cardFaceLayout,
  galaxy,
  gatherDelay,
  mulberry32,
  perimeterPoint,
  sampleCardTargets,
  stardustAt,
  stardustTimeline,
} from '../../../lib/cardStardust';
import type { CardPalette } from '../../../lib/cardPresentation';
import { drawTitleGlow, haloSprite, hexToRgb, WARM_CORE } from './airplaneCardFace';

export const STARDUST_FOV = 40;

export interface StardustControl {
  openRequested: boolean;
  pointer: { x: number; y: number; active: boolean };
}

interface SceneProps {
  control: MutableRefObject<StardustControl>;
  stage: CardStage;
  palette: CardPalette;
  title: string;
  reducedMotion: boolean;
  count: number;
  face: HTMLCanvasElement | null;
  /** Face canvas size (for the arch seam), px. */
  faceSize: { w: number; h: number };
  flashEl: MutableRefObject<HTMLDivElement | null>;
  onFinished: () => void;
}

/** sRGB hex → 0..1 vec3 for shaders that write straight to the sRGB framebuffer. */
function srgb(hex: string): THREE.Vector3 {
  const [r, g, b] = hexToRgb(hex);
  return new THREE.Vector3(r / 255, g / 255, b / 255);
}

const dustVert = /* glsl */ `
  attribute vec3 aGalaxy;
  attribute vec2 aTarget;
  attribute vec3 aColor;
  attribute vec3 aTargetColor;
  attribute float aDelay;
  attribute float aScale;
  attribute float aSeed;
  attribute float aEdge;

  uniform float uTime;
  uniform float uSpinAngle;
  uniform float uVortex;
  uniform float uGather;
  uniform float uOpacity;
  uniform float uFlash;
  uniform float uEdgePos;
  uniform float uEdgeAmp;
  uniform float uRadius;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec2 uCard;
  uniform mat3 uDisk;
  uniform vec3 uCenter;
  uniform vec3 uPointer;
  uniform float uPointerAmt;
  uniform vec3 uWarm;

  varying vec3 vColor;
  varying float vAlpha;

  // Curl of the sum of two trig vector potentials — analytic, divergence-free, cheap.
  vec3 curl(vec3 p, float t) {
    return vec3(
      -2.3 * cos(2.3 * p.z + 1.3 * t) + 1.9 * cos(1.9 * p.y + 0.6 * t),
      -1.3 * cos(1.3 * p.x + 0.7 * t) + 2.1 * cos(2.1 * p.z + 0.9 * t),
      -1.7 * cos(1.7 * p.y + t) + 1.5 * cos(1.5 * p.x + 1.1 * t)
    ) * 0.25;
  }

  float easeInOutCubic(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
  }

  void main() {
    // Galaxy: differential rotation (inner stars faster), drawn in as a vortex.
    vec3 d = aGalaxy;
    float r = length(d.xz);
    float ang = uSpinAngle * (0.35 + 0.65 / (0.3 + r * 1.6));
    float ca = cos(ang), sa = sin(ang);
    vec3 p = vec3(d.x * ca - d.z * sa, d.y, d.x * sa + d.z * ca);
    p.xz *= 1.0 - uVortex * 0.42 * (1.0 - 0.35 * r);
    p.y *= 1.0 - uVortex * 0.6;
    p *= uRadius;
    p += curl(p / uRadius * 1.6, uTime * 0.12 + aSeed * 6.28) * uRadius * 0.035 * (1.0 - uVortex * 0.6);
    vec3 world = uDisk * p + uCenter;

    // Swirl round the finger.
    vec2 dp = world.xy - uPointer.xy;
    float infl = uPointerAmt * exp(-dot(dp, dp) / (uRadius * uRadius * 0.12));
    float sw = infl * 1.4;
    world.xy = uPointer.xy + mat2(cos(sw), sin(sw), -sin(sw), cos(sw)) * dp;

    // Condense onto the card: own delay, spiral approach, a little lift toward the viewer.
    float g = clamp((uGather - aDelay) / 0.62, 0.0, 1.0);
    float e = easeInOutCubic(g);
    vec3 target = vec3((aTarget - 0.5) * uCard, 0.0);
    vec3 m = mix(world, target, e);
    float twist = (1.0 - e) * e * (2.2 + aSeed * 2.0) * (aSeed > 0.5 ? 1.0 : -1.0);
    vec2 rel = m.xy - target.xy * e;
    m.xy = target.xy * e + mat2(cos(twist), sin(twist), -sin(twist), cos(twist)) * rel;
    m.z += sin(e * 3.14159) * (0.15 + aSeed * 0.35) * uRadius;

    // Edge light: particles on the outline flare as the pulse passes.
    float glow = 0.0;
    if (aEdge >= 0.0) {
      float behind = fract(uEdgePos - aEdge);
      glow = (exp(-behind / 0.08) + exp(-pow((1.0 - behind) / 0.01, 2.0))) * uEdgeAmp;
    }

    float twinkle = 0.75 + 0.25 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 50.0);
    float landed = smoothstep(0.55, 1.0, e);
    vColor = mix(aColor * twinkle, aTargetColor, landed);
    vColor += uWarm * glow * 1.6 + vec3(uFlash * 0.3);
    vAlpha = uOpacity * mix(0.8, 0.9, landed);

    vec4 mv = modelViewMatrix * vec4(m, 1.0);
    // Fine dust while it is a galaxy; full-size grains once landed, so the card reads solid.
    float size = uSize * aScale * mix(0.62, 1.0, smoothstep(0.2, 1.0, e)) * (1.0 + glow * 1.6 + uFlash * 0.4);
    gl_PointSize = clamp(size * uPixelRatio / max(0.1, -mv.z), 1.0, 64.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const dustFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    float a = core * core * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

const ribbonVert = /* glsl */ `
  attribute float aS;
  attribute float aSide;
  varying float vS;
  varying float vSide;
  void main() {
    vS = aS;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ribbonFrag = /* glsl */ `
  uniform float uPos;
  uniform float uAmp;
  uniform float uHeads;
  uniform vec3 uWarm;
  uniform vec3 uAccent;
  varying float vS;
  varying float vSide;
  void main() {
    // Distance behind each head (0 at the head, growing back along the trail).
    float best = 0.0;
    for (int i = 0; i < 2; i++) {
      if (float(i) >= uHeads) break;
      float head = fract(uPos + float(i) * 0.5);
      float behind = fract(head - vS);
      float ahead = 1.0 - behind;
      float k = exp(-behind / 0.11) + exp(-pow(ahead / 0.012, 2.0));
      best = max(best, k);
    }
    float across = 1.0 - smoothstep(0.0, 1.0, abs(vSide));
    float coreLine = 1.0 - smoothstep(0.0, 0.35, abs(vSide));
    vec3 col = mix(uAccent, uWarm, best) + vec3(1.0) * coreLine * best * 0.6;
    float a = best * across * uAmp;
    gl_FragColor = vec4(col * a, a);
  }
`;

/** A closed ribbon of width `w` along a polyline (card units), with arc-length param aS. */
function ribbon(points: [number, number][], w: number): THREE.BufferGeometry {
  const n = points.length;
  const lens = [0];
  for (let i = 1; i <= n; i++) {
    const a = points[i - 1];
    const b = points[i % n];
    lens.push(lens[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lens[n] || 1;
  const pos: number[] = [];
  const s: number[] = [];
  const side: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = points[i % n];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;
    for (const sd of [-1, 1]) {
      pos.push(p[0] + nx * w * 0.5 * sd, p[1] + ny * w * 0.5 * sd, 0.01);
      s.push(lens[i] / total);
      side.push(sd);
    }
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(s, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

export default function StardustScene({
  control,
  stage,
  palette,
  title,
  reducedMotion,
  count,
  face,
  faceSize,
  flashEl,
  onFinished,
}: SceneProps) {
  const { gl, size, clock, camera } = useThree();
  const viewAspect = size.width / Math.max(1, size.height);
  const tl = useMemo(() => stardustTimeline(reducedMotion), [reducedMotion]);
  const cardW = 2 * stage.aspect;
  const cardH = 2;

  const D = useMemo(
    () => fillDistance(cardW, cardH, viewAspect, STARDUST_FOV, stage.fillHeight, stage.fullBleed),
    [cardW, viewAspect, stage],
  );
  useEffect(() => {
    camera.position.set(0, 0, D);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, D]);

  const ext = useMemo(() => viewHalfExtents(D, viewAspect, STARDUST_FOV), [D, viewAspect]);
  const radius = useMemo(
    () => (stage.fullBleed ? ext.hw * 1.08 : Math.min(ext.hw * 0.8, ext.hh * 1.55)),
    [ext, stage.fullBleed],
  );

  /* ── Particles ──────────────────────────────────────────────────────── */
  const pixelRatio = gl.getPixelRatio();
  const dust = useMemo(() => {
    const rng = mulberry32(0x5eed + count);
    const gal = galaxy(count, rng);
    const color = new Float32Array(count * 3);
    const warm = hexToRgb(WARM_CORE).map((v) => v / 255);
    const acc = hexToRgb(palette.accent).map((v) => v / 255);
    for (let i = 0; i < count; i++) {
      const h = gal.heat[i];
      const white = gal.scale[i] > 1.35 ? 0.75 : 0.06;
      for (let c = 0; c < 3; c++) {
        const base = warm[c] + (acc[c] - warm[c]) * Math.min(1, h * 1.2);
        color[i * 3 + c] = (base + (1 - base) * white) * (0.55 + 0.35 * (1 - h * 0.6));
      }
    }
    // Placeholder targets (an even card) until the face is sampled.
    const target = new Float32Array(count * 2);
    const tcol = new Float32Array(count * 3);
    const delay = new Float32Array(count);
    const edge = new Float32Array(count).fill(-1);
    const bg = hexToRgb(palette.bg).map((v) => v / 255);
    for (let i = 0; i < count; i++) {
      const u = rng();
      const v = rng();
      target[i * 2] = u;
      target[i * 2 + 1] = v;
      tcol.set(bg, i * 3);
      delay[i] = gatherDelay(u, v, stage.aspect, rng());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aGalaxy', new THREE.BufferAttribute(gal.positions, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aScale', new THREE.BufferAttribute(gal.scale, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(gal.seed, 1));
    g.setAttribute('aTarget', new THREE.BufferAttribute(target, 2));
    g.setAttribute('aTargetColor', new THREE.BufferAttribute(tcol, 3));
    g.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
    g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e3);
    return g;
  }, [count, palette.accent, palette.bg, stage.aspect]);

  // Particle size: just enough that the gathered dust covers the card.
  const cardPx = (stage.fullBleed ? size.width * size.height : (size.height * stage.fillHeight) ** 2 * stage.aspect);
  const sizeCss = Math.sqrt(cardPx / count) * 1.35;

  const tilt = useMemo(() => {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.92, 0, -0.26, 'ZXY'));
    return new THREE.Matrix3().setFromMatrix4(m);
  }, []);

  const dustMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        uniforms: {
          uTime: { value: 0 },
          uSpinAngle: { value: 0 },
          uVortex: { value: 0 },
          uGather: { value: 0 },
          uOpacity: { value: 0 },
          uFlash: { value: 0 },
          uEdgePos: { value: 0 },
          uEdgeAmp: { value: 0 },
          uRadius: { value: 1 },
          uSize: { value: 1 },
          uPixelRatio: { value: pixelRatio },
          uCard: { value: new THREE.Vector2(cardW, cardH) },
          uDisk: { value: tilt },
          uCenter: { value: new THREE.Vector3() },
          uPointer: { value: new THREE.Vector3(0, 0, 0) },
          uPointerAmt: { value: 0 },
          uWarm: { value: srgb(WARM_CORE) },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
      }),
    [pixelRatio, cardW, tilt],
  );

  // Sample the face once it is painted (and again if the photo version lands
  // before the gather starts — never mid-flight).
  const gatherStarted = useRef(false);
  useEffect(() => {
    if (!face || gatherStarted.current) return;
    const sw = 200;
    const sh = Math.round(sw / stage.aspect);
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return;
    let img: ImageData;
    try {
      ctx.drawImage(face, 0, 0, sw, sh);
      img = ctx.getImageData(0, 0, sw, sh);
    } catch {
      return; // tainted or unavailable: keep the even placeholder card
    }
    const rng = mulberry32(0xca7d);
    const t = sampleCardTargets(img, count, rng, 0.1);
    const delay = new Float32Array(count);
    for (let i = 0; i < count; i++) delay[i] = gatherDelay(t.uv[i * 2], t.uv[i * 2 + 1], stage.aspect, rng());
    (dust.getAttribute('aTarget') as THREE.BufferAttribute).copyArray(t.uv).needsUpdate = true;
    (dust.getAttribute('aTargetColor') as THREE.BufferAttribute).copyArray(t.rgb).needsUpdate = true;
    (dust.getAttribute('aEdge') as THREE.BufferAttribute).copyArray(t.edge).needsUpdate = true;
    (dust.getAttribute('aDelay') as THREE.BufferAttribute).copyArray(delay).needsUpdate = true;
  }, [face, dust, count, stage.aspect]);

  /* ── Card, halo, title glow, seams ──────────────────────────────────── */
  const faceTex = useMemo(() => {
    if (!face) return null;
    const t = new THREE.CanvasTexture(face);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return t;
  }, [face, gl]);
  const cardGeo = useMemo(() => new THREE.PlaneGeometry(cardW, cardH), [cardW]);
  const cardMat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
    [],
  );
  useEffect(() => {
    cardMat.map = faceTex;
    cardMat.color.set(faceTex ? '#ffffff' : palette.bg);
    cardMat.needsUpdate = true;
  }, [faceTex, cardMat, palette.bg]);

  const haloTex = useMemo(() => {
    const t = new THREE.CanvasTexture(haloSprite(palette.accent));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [palette.accent]);
  const haloMat = useMemo(
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
  const haloGeo = useMemo(() => new THREE.PlaneGeometry(cardW * 2.4, cardH * 1.7), [cardW]);

  const titleTex = useMemo(() => {
    try {
      const t = new THREE.CanvasTexture(drawTitleGlow(title, 1024));
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    } catch {
      return null;
    }
  }, [title]);
  const titleMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: titleTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [titleTex],
  );
  const titleGeo = useMemo(() => new THREE.PlaneGeometry(radius * 1.25, radius * 0.625), [radius]);

  const seams = useMemo(() => {
    const toCard = (u: number, v: number): [number, number] => [(u - 0.5) * cardW, (v - 0.5) * cardH];
    // The light races along the printed frame (the card's seam) — on a
    // full-bleed phone the outer edge IS the screen edge, so it would be lost.
    const l = cardFaceLayout(faceSize.w, faceSize.h);
    const px = (x: number, y: number) => toCard(x / faceSize.w, 1 - y / faceSize.h);
    const outline: [number, number][] = [];
    const fr = l.frame;
    for (let i = 0; i < 320; i++) {
      const [u, v] = perimeterPoint(i / 320, fr.w / fr.h);
      outline.push(px(fr.x + u * fr.w, fr.y + (1 - v) * fr.h));
    }
    // The photo arch, from the face layout (px → UV, v up).
    const { x, y, w, h } = l.photo;
    const rad = w / 2;
    const arch: [number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const a = Math.PI + (i / 48) * Math.PI;
      arch.push(px(x + rad + Math.cos(a) * rad, y + rad + Math.sin(a) * rad));
    }
    arch.push(px(x + w, y + h), px(x, y + h));
    const make = () =>
      new THREE.ShaderMaterial({
        vertexShader: ribbonVert,
        fragmentShader: ribbonFrag,
        uniforms: {
          uPos: { value: 0 },
          uAmp: { value: 0 },
          uHeads: { value: 2 },
          uWarm: { value: srgb(WARM_CORE) },
          uAccent: { value: srgb(palette.accent) },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        // The outline runs clockwise, so its strip faces away: draw both sides.
        side: THREE.DoubleSide,
      });
    return {
      edgeGeo: ribbon(outline, cardH * 0.022),
      edgeMat: make(),
      archGeo: ribbon(arch, cardH * 0.02),
      archMat: make(),
    };
  }, [cardW, stage.aspect, faceSize.w, faceSize.h, palette.accent]);

  useEffect(() => () => dust.dispose(), [dust]);
  useEffect(() => () => dustMat.dispose(), [dustMat]);
  useEffect(() => () => faceTex?.dispose(), [faceTex]);
  useEffect(() => () => { cardGeo.dispose(); cardMat.dispose(); }, [cardGeo, cardMat]);
  useEffect(() => () => { haloTex.dispose(); haloMat.dispose(); haloGeo.dispose(); }, [haloTex, haloMat, haloGeo]);
  useEffect(() => () => { titleTex?.dispose(); titleMat.dispose(); titleGeo.dispose(); }, [titleTex, titleMat, titleGeo]);
  useEffect(
    () => () => {
      seams.edgeGeo.dispose();
      seams.edgeMat.dispose();
      seams.archGeo.dispose();
      seams.archMat.dispose();
    },
    [seams],
  );

  /* ── Per frame ──────────────────────────────────────────────────────── */
  const live = useRef({
    openAt: null as number | null,
    spin: 0,
    fadeIn: 0,
    center: new THREE.Vector3(),
    pointer: new THREE.Vector3(),
    pointerAmt: 0,
    finished: false,
  });

  useFrame((_, delta) => {
    const L = live.current;
    const now = clock.elapsedTime;
    const dt = Math.min(0.05, delta);
    const ctl = control.current;
    if (ctl.openRequested && L.openAt === null) {
      L.openAt = now;
      gatherStarted.current = true;
    }
    const t = L.openAt === null ? -1 : now - L.openAt;
    const s = stardustAt(tl, t);
    L.spin += s.spin * dt * (reducedMotion ? 0.16 : 0.24);
    L.fadeIn = Math.min(1, L.fadeIn + dt / 1.2);

    // Finger: the swirl bends round it, and the galaxy leans toward it (idle only).
    const idle = L.openAt === null;
    const want = idle && ctl.pointer.active ? 1 : 0;
    L.pointerAmt += (want - L.pointerAmt) * (1 - Math.exp(-dt * 3));
    if (ctl.pointer.active) {
      L.pointer.set(ctl.pointer.x * ext.hw, ctl.pointer.y * ext.hh, 0);
    }
    const lean = idle && ctl.pointer.active ? 0.14 : 0;
    const tx = L.pointer.x * lean;
    const ty = L.pointer.y * lean;
    const k = 1 - Math.exp(-dt * 1.6);
    L.center.x += (tx - L.center.x) * k;
    L.center.y += (ty - L.center.y) * k;

    const u = dustMat.uniforms;
    u.uTime.value = now;
    u.uSpinAngle.value = L.spin;
    u.uVortex.value = s.vortex;
    u.uGather.value = s.gather;
    u.uOpacity.value = s.particles * L.fadeIn;
    u.uFlash.value = s.flash;
    u.uEdgePos.value = s.edgePos;
    u.uEdgeAmp.value = s.edgeAmp;
    u.uRadius.value = radius;
    u.uSize.value = sizeCss * D;
    (u.uCenter.value as THREE.Vector3).copy(L.center).multiplyScalar(1 - s.vortex);
    (u.uPointer.value as THREE.Vector3).copy(L.pointer);
    u.uPointerAmt.value = L.pointerAmt * (reducedMotion ? 0.5 : 1);

    cardMat.opacity = s.card;
    haloMat.opacity = s.glow * 0.9 + s.flash * 0.3;
    titleMat.opacity = s.title * L.fadeIn * (0.5 + 0.12 * Math.sin(now * 1.3));
    seams.edgeMat.uniforms.uPos.value = s.edgePos;
    seams.edgeMat.uniforms.uAmp.value = s.edgeAmp;
    seams.archMat.uniforms.uPos.value = s.edgePos + 0.25;
    seams.archMat.uniforms.uAmp.value = s.edgeAmp * 0.8;
    if (flashEl.current) flashEl.current.style.opacity = String(Math.min(1, s.flash * 0.55));

    if (s.done && !L.finished) {
      L.finished = true;
      onFinished();
    }
  });

  return (
    <>
      <mesh geometry={haloGeo} material={haloMat} position={[0, 0, -0.2]} renderOrder={0} />
      <mesh geometry={titleGeo} material={titleMat} position={[0, 0, 0.05]} renderOrder={1} />
      <points geometry={dust} material={dustMat} frustumCulled={false} renderOrder={2} />
      <mesh geometry={cardGeo} material={cardMat} renderOrder={3} />
      <mesh geometry={seams.archGeo} material={seams.archMat} renderOrder={4} />
      <mesh geometry={seams.edgeGeo} material={seams.edgeMat} renderOrder={5} />
    </>
  );
}
