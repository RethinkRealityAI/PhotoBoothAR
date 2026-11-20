/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The three.js half of the 'curtain' (grand reveal) — rendered inside the
 * <Canvas> that CurtainReveal.tsx owns. Everything is driven from ONE clock
 * (`clock.start`, set on the tap) through the pure beats in lib/cardReveal.ts,
 * in ONE useFrame, so the choreography is deterministic and a replay matches.
 *
 *   • SATIN CURTAINS — a vertex shader hangs each panel in folds and, as the
 *     curtain draws, gathers it toward its side (fold spacing compresses and
 *     deepens, the hem lags the top). The fragment shader is satin: a broad
 *     and a tight highlight on the folds from a light that drifts (and
 *     follows the finger before the tap), a lit piping on the leading edge,
 *     and the warm light behind bleeding through the seam.
 *   • A BEAM of light slices down the seam (Beamwall's signature) and the
 *     curtains part on it; behind them a warm backlight, a tall volumetric
 *     beam and drifting motes.
 *   • THE CARD — a thin rounded slab with two faces drawn on canvases: the
 *     PHOTO side (a collage of up to four photos + the title) floats toward
 *     you and can be dragged a little (it springs back); the COVER side
 *     (glass + the title where the template's cover sets it) is what it turns
 *     to while the camera dollies in until it sits exactly on the cover's
 *     rectangle — so the hand-off to the template is a cross-fade of the same
 *     picture.
 *
 * Disposal: every geometry, material and texture made here is disposed on
 * unmount; R3F releases the renderer when the Canvas unmounts.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  beatProgress,
  collageRects,
  coverCrop,
  curtainBeats,
  curtainDollyStart,
  dollyTarget,
  dragTilt,
  easeInOutCubic,
  easeOutCubic,
  handoffCardRect,
  mixHex,
} from '../../../lib/cardReveal';
import type { RevealPalette } from './types';

export const CURTAIN_FOV = 35;
const CARD_H = 2.4;
const CURTAIN_Z = 3;
const CAMERA_Z0 = 10;

export interface CurtainClock {
  /** performance.now() of the tap, or null while waiting for it. */
  start: number | null;
  /** Seconds after the tap that "Read your card" was pressed, or null. */
  readAt: number | null;
  /** Pointer in NDC (-1..1), for the satin's light and the drag. */
  pointer: { x: number; y: number };
  /** Drag since the press, px (null = not dragging). */
  drag: { dx: number; dy: number } | null;
}

export interface CurtainSceneProps {
  clock: MutableRefObject<CurtainClock>;
  title: string;
  photos: string[];
  palette: RevealPalette;
  warmHex: string;
  reducedMotion: boolean;
  /** The DOM glass card that takes over at the end (opacity driven here). */
  overlayRef: MutableRefObject<HTMLDivElement | null>;
  onFinish: () => void;
}

// ── Shaders ─────────────────────────────────────────────────────────────────

const CURTAIN_VERT = /* glsl */ `
uniform float uOpen;
uniform float uTime;
uniform float uSide;
uniform float uHalfW;
uniform float uH;
uniform float uGap;
uniform float uSway;
uniform float uOut;
varying vec3 vN;
varying vec2 vUv;
varying float vU;
varying float vFold;
void main() {
  // u: 0 at the outer edge, 1 at the seam (the right panel is mirrored).
  float u = uSide < 0.0 ? uv.x : 1.0 - uv.x;
  float v = uv.y;
  float lag = (1.0 - v) * 0.14;
  float o = clamp((uOpen - lag) / 0.86, 0.0, 1.0);
  o = o * o * (3.0 - 2.0 * o);
  float gather = o * 0.72;
  float b = (uHalfW - uGap) * (1.0 - gather);
  // The outer edge barely moves: a drawn curtain stays, gathered, framing the stage.
  // uOut: the gathered drapes slide off as the camera dollies in.
  float x = uSide * (uHalfW * (1.0 + 0.5 * uOut) - u * b);
  // Folds: a main swag plus a smaller irregular one, so it hangs like cloth.
  // a warped, uneven fold rhythm so it never reads as stripes
  u = u + 0.035 * sin(u * 11.0 + 1.3) + 0.015 * sin(u * 29.0 + 0.4);
  float k1 = 4.5 * 6.2831853;
  float k2 = 10.3 * 6.2831853;
  float ph = 0.7 + v * 0.45;
  float ph2 = 2.1 - v * 0.8;
  float amp = uHalfW * (0.016 + 0.06 * gather) * (0.75 + 0.25 * sin(u * 7.0 + 2.0));
  float s = 0.82 * sin(k1 * u + ph) + 0.18 * sin(k2 * u + ph2);
  float z = amp * s;
  z += uSway * uHalfW * 0.02 * sin(uTime * 0.8 + v * 2.6 + u * 3.1) * (0.4 + 0.6 * u);
  float dzdu = amp * (0.82 * k1 * cos(k1 * u + ph) + 0.18 * k2 * cos(k2 * u + ph2));
  float dxdu = -uSide * max(b, 0.001);
  float slope = dzdu / dxdu;
  vN = normalize(vec3(-slope, 0.0, 1.0));
  vUv = uv;
  vU = u;
  vFold = s;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(x, (v - 0.5) * uH, z, 1.0);
}
`;

const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uSheen;
uniform vec3 uTrim;
uniform vec3 uWarm;
uniform float uTime;
uniform float uLight;
uniform float uLeak;
uniform float uBack;
varying vec3 vN;
varying vec2 vUv;
varying float vU;
varying float vFold;
void main() {
  vec3 n = normalize(vN);
  // A raking light, so only the crests turned toward it shine (drifts; follows the finger).
  vec3 L = normalize(vec3(0.5 + uLight * 0.45 + sin(uTime * 0.23) * 0.3, 0.35, 0.5));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float diff = max(dot(n, L), 0.0);
  float nh = max(dot(n, H), 0.0);
  // Satin: a soft, wide sheen with a gentle crest — never a hard metal line.
  float spec = pow(nh, 16.0);
  float broad = pow(nh, 5.0);
  float ao = 0.68 + 0.32 * (0.5 + 0.5 * vFold);
  vec3 col = uBase * (0.22 + 1.0 * diff) * ao;
  col += uSheen * (spec * 0.7 + broad * 0.12) * ao;
  // a soft shadow under the pelmet and toward the hem
  col *= mix(0.62, 1.0, smoothstep(1.0, 0.8, vUv.y));
  col *= mix(0.78, 1.0, smoothstep(0.0, 0.18, vUv.y));
  // the weave
  // piping down the leading edge
  float trim = smoothstep(0.986, 0.992, vU);
  col = mix(col, uTrim * (0.45 + 0.55 * diff) + uSheen * spec * 0.6, trim * 0.8);
  // light from behind: bleeding through the seam, and through the satin
  col += uWarm * uLeak * exp(-(1.0 - vU) * 70.0) * 1.1;
  col += uWarm * uBack * 0.1 * (0.6 + 0.4 * vFold);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Backlight: a warm core fading to the accent. */
const BACK_FRAG = /* glsl */ `
uniform vec3 uWarm;
uniform vec3 uAccent;
uniform float uI;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.0, 1.4);
  float r = length(p);
  vec3 col = mix(vec3(1.0, 0.98, 0.94), uWarm, smoothstep(0.0, 0.12, r));
  col = mix(col, uAccent, smoothstep(0.1, 0.4, r));
  float a = exp(-r * r * 9.0) * uI;
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

/** A vertical beam: gaussian across, `uCut` = how far down it has sliced. */
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uI;
uniform float uCut;
uniform float uWidth;
varying vec2 vUv;
void main() {
  float x = (vUv.x - 0.5) / uWidth;
  float core = exp(-x * x * 60.0);
  float halo = exp(-x * x * 4.0) * 0.35;
  float edge = smoothstep(1.0 - uCut - 0.05, 1.0 - uCut, vUv.y);
  float ends = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
  float a = (core + halo) * edge * ends * uI;
  vec3 col = mix(uColor, vec3(1.0), core * 0.8);
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

const MOTE_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform float uSpread;
uniform float uSize;
varying float vTw;
varying float vWarm;
void main() {
  vec3 base = (aSeed - 0.5) * vec3(7.0, 6.0, 4.0);
  base.y = mod(base.y + 3.0 + uTime * (0.12 + aSeed.x * 0.18), 6.0) - 3.0;
  base.x += sin(uTime * 0.5 + aSeed.z * 9.0) * 0.12;
  vec3 pos = mix(vec3(0.0, 0.0, -0.5), base, uSpread);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = uSize * (0.4 + aSeed.y) / max(0.5, -mv.z);
  vTw = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed.x * 3.0) + aSeed.y * 20.0);
  vWarm = step(0.45, aSeed.z);
  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uWarm;
uniform float uOpacity;
varying float vTw;
varying float vWarm;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = pow(smoothstep(0.5, 0.0, d), 1.6) * uOpacity * vTw;
  vec3 col = mix(vec3(1.0, 0.98, 0.95), uWarm, vWarm);
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

// ── Card faces (canvas) ─────────────────────────────────────────────────────

const DISPLAY_FONT = "'Bricolage Grotesque Variable', 'Bricolage Grotesque', system-ui, sans-serif";

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== '');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line === '' ? w : `${line} ${w}`;
    if (ctx.measureText(next).width <= maxW || line === '') line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line !== '') lines.push(line);
  return lines.slice(0, 4);
}

/** Paint the glass slab both faces share: tint, inner hairline, rim light. */
function paintGlass(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  r: number,
  palette: RevealPalette,
  alpha: number,
) {
  ctx.clearRect(0, 0, w, h);
  roundRectPath(ctx, 0, 0, w, h, r);
  ctx.fillStyle = mixHex(palette.bg, '#ffffff', 0.07);
  ctx.globalAlpha = alpha;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.save();
  roundRectPath(ctx, 0, 0, w, h, r);
  ctx.clip();
  // the light the glass catches, top-left (light, not a fill: it fades out)
  const g = ctx.createRadialGradient(w * 0.15, h * 0.05, 0, w * 0.15, h * 0.05, h * 0.7);
  g.addColorStop(0, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.strokeStyle = `rgba(${palette.accentRgb}, 0.32)`;
  roundRectPath(ctx, ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2, r - ctx.lineWidth);
  ctx.stroke();
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  w: number,
  centreY: number,
  size: number,
  maxW: number,
  color: string,
) {
  // The cover's title: the display face at 400 with the brand's tight tracking.
  ctx.font = `400 ${size}px ${DISPLAY_FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(-0.022 * size).toFixed(2)}px`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, title, maxW);
  const lh = size * 1.25;
  const top = centreY - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * lh));
}

function loadImage(url: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** ShapeGeometry with UVs normalised to the shape's box (0..1). */
function faceGeometry(w: number, h: number, r: number): THREE.ShapeGeometry {
  const g = new THREE.ShapeGeometry(roundedRectShape(w, h, r), 12);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  uv.needsUpdate = true;
  return g;
}

// ── The scene ───────────────────────────────────────────────────────────────

export default function CurtainScene({
  clock,
  title,
  photos,
  palette,
  warmHex,
  reducedMotion,
  overlayRef,
  onFinish,
}: CurtainSceneProps) {
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const rect = handoffCardRect(size.width, size.height);
  const aspect = rect.w / rect.h;
  const cardW = CARD_H * aspect;
  const cornerR = CARD_H * 0.039;
  const depth = 0.03;
  const B = curtainBeats(reducedMotion);

  const leftRef = useRef<THREE.Mesh>(null);
  const rightRef = useRef<THREE.Mesh>(null);
  const cardRef = useRef<THREE.Group>(null);
  const finished = useRef(false);
  const tilt = useRef({ yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 });

  // ── Materials & geometry (memoised; disposed on unmount) ───────────────
  const res = useMemo(() => {
    const satinBase = new THREE.Color(mixHex(palette.bg, '#120c34', 0.22));
    const sheen = new THREE.Color(mixHex(palette.accent, '#fff4ea', 0.55));
    const trim = new THREE.Color(mixHex(palette.accent, '#ffffff', 0.6));
    const warm = new THREE.Color(warmHex);
    const accent = new THREE.Color(palette.accent);
    const curtainUniforms = (side: number) => ({
      uOpen: { value: 0 },
      uTime: { value: 0 },
      uSide: { value: side },
      uHalfW: { value: 1 },
      uH: { value: 1 },
      uGap: { value: 0.004 },
      uSway: { value: reducedMotion ? 0.3 : 1 },
      uOut: { value: 0 },
      uBase: { value: satinBase },
      uSheen: { value: sheen },
      uTrim: { value: trim },
      uWarm: { value: warm },
      uLight: { value: -0.3 },
      uLeak: { value: 0.35 },
      uBack: { value: 0 },
    });
    const curtainMat = (side: number) =>
      new THREE.ShaderMaterial({
        uniforms: curtainUniforms(side),
        vertexShader: CURTAIN_VERT,
        fragmentShader: CURTAIN_FRAG,
        side: THREE.DoubleSide,
      });
    const additive = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: GLOW_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    const moteCount = reducedMotion ? 26 : 70;
    const seeds = new Float32Array(moteCount * 3);
    let a = 1234567;
    for (let i = 0; i < seeds.length; i++) {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      seeds[i] = a / 0x7fffffff;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(moteCount * 3), 3));
    moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    return {
      curtainGeo: new THREE.PlaneGeometry(1, 1, 160, 24),
      leftMat: curtainMat(-1),
      rightMat: curtainMat(1),
      planeGeo: new THREE.PlaneGeometry(1, 1),
      backMat: additive(BACK_FRAG, { uWarm: { value: warm }, uAccent: { value: accent }, uI: { value: 0 } }),
      sliceMat: additive(BEAM_FRAG, {
        uColor: { value: warm },
        uI: { value: 0 },
        uCut: { value: 0 },
        uWidth: { value: 1 },
      }),
      pillarMat: additive(BEAM_FRAG, {
        uColor: { value: accent },
        uI: { value: 0 },
        uCut: { value: 1 },
        uWidth: { value: 1 },
      }),
      moteGeo,
      moteMat: new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSpread: { value: 0 },
          uSize: { value: 60 },
          uWarm: { value: warm },
          uOpacity: { value: 0 },
        },
        vertexShader: MOTE_VERT,
        fragmentShader: MOTE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      bodyMat: new THREE.MeshStandardMaterial({
        color: new THREE.Color(mixHex(palette.bg, '#ffffff', 0.55)),
        roughness: 0.3,
        metalness: 0.35,
        transparent: true,
        opacity: 0,
      }),
      faceAMat: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false }),
      faceBMat: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false }),
    };
  }, [palette.bg, palette.accent, warmHex, reducedMotion]);

  const cardGeo = useMemo(() => {
    const body = new THREE.ExtrudeGeometry(roundedRectShape(cardW, CARD_H, cornerR), {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 3,
      curveSegments: 10,
    });
    body.translate(0, 0, -depth / 2);
    return { body, face: faceGeometry(cardW, CARD_H, cornerR) };
  }, [cardW, cornerR]);

  useEffect(
    () => () => {
      res.curtainGeo.dispose();
      res.leftMat.dispose();
      res.rightMat.dispose();
      res.planeGeo.dispose();
      res.backMat.dispose();
      res.sliceMat.dispose();
      res.pillarMat.dispose();
      res.moteGeo.dispose();
      res.moteMat.dispose();
      res.bodyMat.dispose();
      res.faceAMat.dispose();
      res.faceBMat.dispose();
    },
    [res],
  );
  useEffect(
    () => () => {
      cardGeo.body.dispose();
      cardGeo.face.dispose();
    },
    [cardGeo],
  );

  // Compile every program up front: a first-use compile of the card's lit
  // material stalled the frame loop for ~1s mid-opening on a slow GPU.
  useEffect(() => {
    gl.compile(scene, camera);
  }, [gl, scene, camera, res, cardGeo]);

  // ── Card faces: the cover side at once, the photo side when photos land ──
  useEffect(() => {
    let alive = true;
    const texH = 1600;
    // The cover's own type, scaled into the texture: a 36px title inside
    // 28px side padding on a card rect.w × rect.h px (Storybook cover).
    const titlePx = texH * (36 / rect.h);
    const titleMaxW = texH * aspect * (1 - 56 / rect.w);
    const texW = Math.round(texH * aspect);
    const r = texH * 0.039;
    const made: THREE.CanvasTexture[] = [];
    const toTexture = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      made.push(t);
      return t;
    };
    const draw = async () => {
      try {
        await document.fonts.load(`400 80px ${DISPLAY_FONT}`);
      } catch {
        /* the fallback face still draws */
      }
      if (!alive) return;
      // COVER side — the title where the template's cover sets it (~45%).
      const cb = document.createElement('canvas');
      cb.width = texW;
      cb.height = texH;
      const bx = cb.getContext('2d');
      if (bx) {
        paintGlass(bx, texW, texH, r, palette, 0.5);
        drawTitle(bx, title, texW, texH * 0.45, titlePx, titleMaxW, palette.fg);
        res.faceBMat.map = toTexture(cb);
        res.faceBMat.needsUpdate = true;
      }
      // PHOTO side — title-only until (and unless) photos load.
      const ca = document.createElement('canvas');
      ca.width = texW;
      ca.height = texH;
      const ax = ca.getContext('2d');
      if (!ax) return;
      paintGlass(ax, texW, texH, r, palette, 1);
      drawTitle(ax, title, texW, texH * 0.45, titlePx, titleMaxW, palette.fg);
      const texA = toTexture(ca);
      res.faceAMat.map = texA;
      res.faceAMat.needsUpdate = true;

      const imgs = (await Promise.all(photos.slice(0, 4).map((u) => loadImage(u)))).filter(
        (i): i is HTMLImageElement => i !== null,
      );
      if (!alive || imgs.length === 0) return;
      paintGlass(ax, texW, texH, r, palette, 1);
      const pad = texW * 0.07;
      const areaW = texW - pad * 2;
      const areaH = texH * 0.62;
      const gap = texW * 0.025;
      const rects = collageRects(imgs.length, areaW, areaH, gap);
      rects.forEach((rc, i) => {
        const img = imgs[i];
        const crop = coverCrop(img.naturalWidth, img.naturalHeight, rc.w, rc.h);
        ax.save();
        roundRectPath(ax, pad + rc.x, pad + rc.y, rc.w, rc.h, texW * 0.035);
        ax.clip();
        try {
          ax.drawImage(img, crop.x, crop.y, crop.w, crop.h, pad + rc.x, pad + rc.y, rc.w, rc.h);
        } catch {
          /* a tainted or broken image: leave the glass showing */
        }
        ax.restore();
      });
      drawTitle(ax, title, texW, pad + areaH + (texH - pad - areaH) * 0.47, titlePx * 0.86, titleMaxW, palette.fg);
      texA.needsUpdate = true;
    };
    void draw();
    return () => {
      alive = false;
      for (const t of made) t.dispose();
      res.faceAMat.map = null;
      res.faceBMat.map = null;
    };
  }, [aspect, rect.w, rect.h, title, photos, palette, res]);

  // ── The one clock ───────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const now = performance.now();
    const c = clock.current;
    const t = c.start === null ? -1 : (now - c.start) / 1000;
    const time = state.clock.elapsedTime;
    const cam = state.camera as THREE.PerspectiveCamera;

    // Curtains cover the frustum at their depth, wherever the camera is, so
    // the gathered drapes keep framing the stage as the camera moves in.
    const dist = Math.max(0.5, cam.position.z - CURTAIN_Z);
    const halfH = Math.tan((CURTAIN_FOV * Math.PI) / 360) * dist;
    const halfW = halfH * (size.width / Math.max(1, size.height));
    const blaze = t < 0 ? 0 : beatProgress(B.blaze, t);
    // Linear here: the vertex shader shapes it (smoothstep, hem lagging the top).
    const open = t < 0 ? 0 : beatProgress(B.doors, t);
    for (const m of [res.leftMat, res.rightMat]) {
      const u = m.uniforms;
      u.uTime.value = time;
      u.uHalfW.value = halfW * 1.04;
      u.uH.value = halfH * 2.1;
      u.uOpen.value = open;
      if (t < 0) u.uLight.value += (c.pointer.x - u.uLight.value) * Math.min(1, delta * 3);
      u.uLeak.value = t < 0 ? 0.32 + 0.12 * Math.sin(time * 1.6) : 0.4 + blaze * 1.6 * (1 - open * 0.7);
      u.uBack.value = Math.min(1, blaze + open);
    }
    const dollyNow = t < 0 ? 0 : easeInOutCubic(beatProgress({ at: curtainDollyStart(B, c.readAt), dur: B.dolly.dur }, t));
    res.leftMat.uniforms.uOut.value = dollyNow;
    res.rightMat.uniforms.uOut.value = dollyNow;

    // The beam slicing the seam.
    const s = res.sliceMat.uniforms;
    s.uCut.value = reducedMotion ? 1 : easeOutCubic(Math.min(1, blaze * 1.6));
    s.uI.value = t < 0 ? 0 : (reducedMotion ? blaze : 1) * (1 - easeOutCubic(beatProgress({ at: B.doors.at + 0.2, dur: 0.9 }, t))) * 2.2;
    s.uWidth.value = 0.12 + open * 0.6;

    // Light behind.
    const dollyAt = curtainDollyStart(B, c.readAt);
    const dolly = t < 0 ? 0 : easeInOutCubic(beatProgress({ at: dollyAt, dur: B.dolly.dur }, t));
    const backI = Math.min(1, blaze * 0.6 + open) * (1 - dolly * 0.85);
    res.backMat.uniforms.uI.value = backI * 1.15;
    res.pillarMat.uniforms.uI.value = open * (0.55 - dolly * 0.35);
    res.moteMat.uniforms.uTime.value = time;
    res.moteMat.uniforms.uSpread.value = easeOutCubic(open);
    res.moteMat.uniforms.uOpacity.value = open * (1 - dolly * 0.7);
    res.moteMat.uniforms.uSize.value = 60 * Math.min(2, state.viewport.dpr);

    // The card rises out of the light…
    const g = cardRef.current;
    if (g) {
      const appear = t < 0 ? 0 : easeOutCubic(beatProgress({ at: B.doors.at + B.doors.dur * 0.35, dur: 1.1 }, t));
      // Always in the scene (at opacity 0 until it appears): its shaders and
      // textures are compiled/uploaded before the tap, never mid-reveal.
      const bobAmp = reducedMotion ? 0.03 : 0.07;
      const floatW = 1 - dolly;
      g.position.set(0, Math.sin(time * 1.1) * bobAmp * floatW + (1 - appear) * -0.4, -1.6 * (1 - appear));
      g.scale.setScalar(0.55 + 0.45 * appear);

      // …and can be dragged a little; it springs back.
      const tl = tilt.current;
      const dragMax = reducedMotion ? 0.3 : 0.6;
      const target = c.drag !== null && dolly === 0 ? dragTilt(c.drag.dx, c.drag.dy, dragMax) : { yaw: 0, pitch: 0 };
      if (reducedMotion) {
        // critically damped: no overshoot, no inertia
        const k = 1 - Math.exp(-delta * 8);
        tl.yaw += (target.yaw - tl.yaw) * k;
        tl.pitch += (target.pitch - tl.pitch) * k;
      } else {
        // a soft spring
        const stiff = 60;
        const damp = 9;
        tl.vyaw += ((target.yaw - tl.yaw) * stiff - tl.vyaw * damp) * delta;
        tl.vpitch += ((target.pitch - tl.pitch) * stiff - tl.vpitch * damp) * delta;
        tl.yaw += tl.vyaw * delta;
        tl.pitch += tl.vpitch * delta;
      }
      const idleYaw = Math.sin(time * 0.6) * (reducedMotion ? 0.08 : 0.2);
      const idlePitch = Math.sin(time * 0.45 + 1) * (reducedMotion ? 0.03 : 0.07);
      // Dolly: turn over to the cover side and square up to the camera.
      g.rotation.y = (idleYaw + tl.yaw) * floatW + Math.PI * dolly;
      g.rotation.x = (idlePitch + tl.pitch) * floatW;
      g.rotation.z = Math.sin(time * 0.7) * 0.02 * floatW;
      // The slab thins to glass as it lands, like the cover it hands to.
      res.bodyMat.opacity = appear * (1 - dolly * 0.9);
      res.faceAMat.opacity = appear;
      res.faceBMat.opacity = appear;
    }

    // Camera: from the stalls to the card, landing on the cover's rect.
    const z0Target = dollyTarget(CARD_H, CURTAIN_FOV, { ...rect, h: size.height * 0.56, y: size.height * 0.22 }, size.height);
    const zf = dollyTarget(CARD_H, CURTAIN_FOV, rect, size.height);
    const settle = t < 0 ? 0 : easeInOutCubic(beatProgress({ at: B.doors.at, dur: B.doors.dur + 0.6 }, t));
    const zFloat = CAMERA_Z0 + (z0Target.z - CAMERA_Z0) * settle;
    cam.position.set(0, zf.y * dolly, zFloat + (zf.z - zFloat) * dolly);
    cam.lookAt(0, zf.y * dolly, -100);

    // Hand the picture to the DOM card for the last stretch.
    const ov = overlayRef.current;
    if (ov) {
      // only once the card is in place: crossing earlier shows two titles
      const f = t < 0 ? 0 : beatProgress({ at: dollyAt + B.dolly.dur * 0.94, dur: B.hold.dur * 0.85 }, t);
      ov.style.opacity = String(f);
    }

    if (!finished.current && t >= dollyAt + B.dolly.dur + B.hold.dur) {
      finished.current = true;
      onFinish();
    }
  });

  const halfH0 = Math.tan((CURTAIN_FOV * Math.PI) / 360) * (CAMERA_Z0 + 2);
  const backSize = halfH0 * 2.6;

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[0.6, 1.2, 4]} intensity={1.4} />
      <pointLight position={[-2.4, 1.2, -1.2]} intensity={14} distance={9} color={palette.accent} />
      <pointLight position={[2.4, -0.8, -1.2]} intensity={14} distance={9} color={warmHex} />

      <mesh geometry={res.planeGeo} material={res.backMat} position={[0, 0, -2]} scale={[backSize * 1.2, backSize, 1]} />
      <mesh geometry={res.planeGeo} material={res.pillarMat} position={[0, 0, -1.9]} scale={[2.2, halfH0 * 2.4, 1]} />
      <points geometry={res.moteGeo} material={res.moteMat} frustumCulled={false} />

      <group ref={cardRef}>
        <mesh geometry={cardGeo.body} material={res.bodyMat} />
        <mesh geometry={cardGeo.face} material={res.faceAMat} position={[0, 0, depth / 2 + 0.008]} />
        <mesh geometry={cardGeo.face} material={res.faceBMat} position={[0, 0, -depth / 2 - 0.008]} rotation={[0, Math.PI, 0]} />
      </group>

      <mesh ref={leftRef} geometry={res.curtainGeo} material={res.leftMat} position={[0, 0, CURTAIN_Z]} frustumCulled={false} />
      <mesh ref={rightRef} geometry={res.curtainGeo} material={res.rightMat} position={[0, 0, CURTAIN_Z]} frustumCulled={false} />
      <mesh
        geometry={res.planeGeo}
        material={res.sliceMat}
        position={[0, 0, CURTAIN_Z + 0.4]}
        scale={[0.9, halfH0 * 2, 1]}
        frustumCulled={false}
      />
    </>
  );
}
