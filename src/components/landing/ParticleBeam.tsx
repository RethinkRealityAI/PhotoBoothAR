/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ParticleBeam — the WebGL heart of the landing showcase's beam ceremony. Where
 * InteractiveShowcase's BeamStrike flies the captured photo as a solid `<img>`
 * clone, this overlay DISSOLVES that image into ~13.7k GPU points: the photo
 * shatters at the phone viewfinder, streams along the beam path in a swelling,
 * arcing spectrum smear, then REASSEMBLES pixel-for-pixel into the live-wall
 * tile so the tile flare underneath reads as the photo materialising.
 *
 * It renders in an absolutely-positioned, pointer-events-none overlay whose
 * pixel space IS the scene's pixel space (the same frame the `from`/`to` Rects
 * were measured in). An orthographic camera is pinned so CSS pixel coords map
 * 1:1, y-down: world (0,0) = scene top-left, world (width,height) = bottom-right.
 *
 * Everything heavy — image decode, pixel sampling, attribute packing — happens
 * once in an effect and lives in a single BufferGeometry / ShaderMaterial pair
 * (one draw call, no per-frame allocation). `uProgress` is the only value that
 * changes per frame; the rest is baked into vertex attributes.
 *
 * StrictMode-safe: the build runs behind a `cancelled` flag, `onDone` fires
 * exactly once from the animation (never from cleanup), and geometry + material
 * are disposed on unmount. Failure paths (no WebGL, unreadable image, degenerate
 * rects) render null and hand control straight back via `onDone` so the caller's
 * WAAPI clone can carry the visual as a fallback.
 */
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { type Rect } from '../../lib/beamGeometry';
import { SPECTRUM } from './ShowcasePhone';

/* ── Tunables ──────────────────────────────────────────────────────────── */

/** Sampling grid over the cover-cropped shot — one particle per cell.
 *  88 × 156 ≈ the 9:16 viewfinder aspect and 13,728 points (under the 14k cap). */
const GRID_W = 88;
const GRID_H = 156;
const MAX_PARTICLES = 14000;

/** Perpendicular bulge (px) at mid-flight, and the small sin-noise shimmer (px). */
const ARC_PX = 64;
const WIGGLE_PX = 6;

/** Per-particle stagger: front-of-beam points leave first (STAGGER), softened by
 *  a hash jitter (JITTER). Max delay (0.36) + the shader's flight WINDOW (0.62)
 *  stays ≤ 1, so every particle is fully reassembled by uProgress = 1. */
const STAGGER = 0.3;
const JITTER = 0.06;

/* ── Pure helpers ──────────────────────────────────────────────────────── */

/** The overlay is pointer-events-none and purely decorative, so R3F's pointer
 *  event layer is disabled outright — its async `connect` would otherwise race
 *  a fast unmount (flight over before it attaches) and throw on a null parent. */
const noopEvents = () => ({ enabled: false, priority: 0 });

/** Feature-detect a WebGL context BEFORE mounting the Canvas: R3F has no error
 *  boundary here, so a failed context must be caught up front, not at render. */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return (probe.getContext('webgl2') ?? probe.getContext('webgl')) !== null;
  } catch {
    return false;
  }
}

interface ParticleData {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
}

/**
 * Sample the shot into GRID_W×GRID_H points and pack every per-particle
 * attribute. Returns null on any unreadable-image path (no 2D context, or a
 * tainted canvas from a cross-origin shot) so the caller can bail cleanly.
 */
function buildParticles(img: HTMLImageElement, from: Rect, to: Rect): ParticleData | null {
  const count = GRID_W * GRID_H;
  if (count > MAX_PARTICLES) return null; // guard the cap if the grid is ever retuned

  const canvas = document.createElement('canvas');
  canvas.width = GRID_W;
  canvas.height = GRID_H;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  // Cover-crop the source to the from-rect's aspect, then downsample to the grid.
  const targetAspect = from.width / from.height;
  const imgAspect = img.width / img.height;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (imgAspect > targetAspect) {
    sw = img.height * targetAspect;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / targetAspect;
    sy = (img.height - sh) / 2;
  }

  let pixels: Uint8ClampedArray;
  try {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, GRID_W, GRID_H);
    pixels = ctx.getImageData(0, 0, GRID_W, GRID_H).data;
  } catch {
    return null; // tainted canvas (cross-origin shot) — cannot read pixels
  }

  const positions = new Float32Array(count * 3); // 'position' attribute = start, spread over `from`
  const targets = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const projs = new Float32Array(count);

  // Beam axis (from-centre → to-centre) — particles are staggered by their
  // projection onto it, so the dissolve wipes along the beam.
  const aCx = from.left + from.width / 2;
  const aCy = from.top + from.height / 2;
  const bCx = to.left + to.width / 2;
  const bCy = to.top + to.height / 2;
  const blen = Math.hypot(bCx - aCx, bCy - aCy) || 1;
  const bux = (bCx - aCx) / blen;
  const buy = (bCy - aCy) / blen;

  let minProj = Infinity;
  let maxProj = -Infinity;
  for (let row = 0; row < GRID_H; row += 1) {
    for (let col = 0; col < GRID_W; col += 1) {
      const i = row * GRID_W + col;
      const u = (col + 0.5) / GRID_W;
      const v = (row + 0.5) / GRID_H;
      const startX = from.left + u * from.width;
      const startY = from.top + v * from.height;

      positions[i * 3] = startX;
      positions[i * 3 + 1] = startY;
      positions[i * 3 + 2] = 0;
      // Same normalised uv, spread over the landing tile.
      targets[i * 3] = to.left + u * to.width;
      targets[i * 3 + 1] = to.top + v * to.height;
      targets[i * 3 + 2] = 0;

      const p = i * 4; // RGBA source stride (canvas row 0 = image top = v 0, so colours align with positions)
      colors[i * 3] = pixels[p] / 255;
      colors[i * 3 + 1] = pixels[p + 1] / 255;
      colors[i * 3 + 2] = pixels[p + 2] / 255;

      // Deterministic per-particle hash in [0, 1) — drives sign, size, jitter, phase.
      const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const seed = h - Math.floor(h);
      seeds[i] = seed;
      sizes[i] = 1.7 + seed * 2.0; // base point size in CSS px (1.7 – 3.7)

      const proj = (startX - aCx) * bux + (startY - aCy) * buy;
      projs[i] = proj;
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }
  }

  const span = maxProj - minProj || 1;
  for (let i = 0; i < count; i += 1) {
    const norm = (projs[i] - minProj) / span; // 0 = beam-start edge, 1 = far edge
    delays[i] = norm * STAGGER + seeds[i] * JITTER;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTarget', new THREE.BufferAttribute(targets, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  // White-hot core carries a faint beam-blue so the flare stays on-brand.
  const hot = new THREE.Color('#ffffff').lerp(new THREE.Color(SPECTRUM[0]), 0.14);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uPixelRatio: { value: 1 },
      uArc: { value: ARC_PX },
      uHot: { value: hot },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  return { geometry, material };
}

/* ── GLSL (ShaderMaterial injects precision, `position`, and the matrices) ─ */

const VERTEX_SHADER = /* glsl */ `
  uniform float uProgress;
  uniform float uPixelRatio;
  uniform float uArc;

  attribute vec3 aTarget;
  attribute vec3 aColor;
  attribute float aDelay;
  attribute float aSize;
  attribute float aSeed;

  varying vec3 vColor;
  varying float vT;

  const float PI = 3.141592653589793;
  const float WINDOW = 0.62; // each particle's flight span within [0, 1]

  float easeInOut(float x) {
    return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) * 0.5;
  }

  void main() {
    // Staggered per-particle window, smoothed to a 0→1 local time.
    float local = clamp((uProgress - aDelay) / WINDOW, 0.0, 1.0);
    float t = smoothstep(0.0, 1.0, local);
    vT = t;
    vColor = aColor;

    vec3 origin = position;  // spread over the from-rect
    vec3 dest = aTarget;     // same uv, spread over the to-rect
    vec3 pos = mix(origin, dest, easeInOut(t));

    // Bulge perpendicular to each particle's own path, hash-signed, peaking mid-flight.
    vec2 flat2 = dest.xy - origin.xy;
    float len = max(length(flat2), 1e-4);
    vec2 perp = vec2(-flat2.y, flat2.x) / len;
    float dirSign = aSeed < 0.5 ? -1.0 : 1.0;
    float wave = sin(t * PI);
    pos.xy += perp * (wave * uArc * dirSign);

    // A little sin-noise shimmer, gated by wave so it settles to zero on arrival.
    float phase = aSeed * 6.2831853;
    pos.xy += perp * (sin(t * PI * 3.0 + phase) * ${WIGGLE_PX.toFixed(1)} * wave);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    // Points swell mid-flight, settle small at both ends.
    gl_PointSize = aSize * uPixelRatio * (0.75 + 1.1 * wave);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uHot;

  varying vec3 vColor;
  varying float vT;

  const float PI = 3.141592653589793;

  void main() {
    // Soft round sprite from the point's local coordinate.
    float d = distance(gl_PointCoord, vec2(0.5));
    float sprite = smoothstep(0.5, 0.08, d);
    if (sprite <= 0.0) discard;

    float wave = sin(vT * PI);
    vec3 col = mix(vColor, uHot, 0.55 * wave);          // white-hot through the flight
    float fadeIn = smoothstep(0.0, 0.08, vT);            // dissolve-in over the first 8%
    float alpha = sprite * fadeIn * (0.9 + 0.35 * wave); // ~0.9 settled, brighter mid-flight
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/* ── In-Canvas pieces ──────────────────────────────────────────────────── */

/**
 * Pins the (manual) orthographic camera to CSS-pixel space, y-down: left 0,
 * right = width, top 0, bottom = height. `top < bottom` flips the y axis so
 * scene (x, y) coords land where the DOM would draw them.
 */
function PixelCamera(): null {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();
  }, [camera, width, height]);
  return null;
}

/** The single points draw call. Drives `uProgress` from wall-clock time and
 *  fires `onComplete` once, on the first frame it reaches 1. */
function Field({
  data, durationMs, onComplete,
}: {
  data: ParticleData;
  durationMs: number;
  onComplete: () => void;
}): JSX.Element {
  const gl = useThree((s) => s.gl);
  const startRef = useRef<number | null>(null);

  // gl_PointSize is in framebuffer pixels; scale by the drawing-buffer ratio so
  // dots keep a consistent visual size across the dpr={[1, 1.5]} range.
  useLayoutEffect(() => {
    data.material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  }, [gl, data]);

  useFrame((state) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const seconds = Math.max(durationMs, 1) / 1000;
    const progress = Math.min((state.clock.elapsedTime - startRef.current) / seconds, 1);
    data.material.uniforms.uProgress.value = progress;
    if (progress >= 1) onComplete(); // guarded caller — safe to call every settled frame
  });

  return (
    <points geometry={data.geometry} material={data.material} frustumCulled={false} dispose={null} />
  );
}

/* ── Component ─────────────────────────────────────────────────────────── */

export interface ParticleBeamProps {
  /** Scene-space rects: the photo's start (phone viewfinder) and landing tile. */
  from: Rect;
  to: Rect;
  /** Captured photo as a data URL — sampled for particle colors. */
  shot: string;
  /** Total flight duration in ms (image dissolve → reassembly complete). */
  durationMs: number;
  /** Called once when the flight completes (NOT on unmount/cleanup). */
  onDone?: () => void;
}

type Status = 'init' | 'ready' | 'failed';

export default function ParticleBeam({
  from, to, shot, durationMs, onDone,
}: ParticleBeamProps): JSX.Element | null {
  const [status, setStatus] = useState<Status>('init');
  const dataRef = useRef<ParticleData | null>(null);

  // onDone fires exactly once, from success OR a failure path — never twice,
  // never from cleanup. The ref guard survives StrictMode's double-invoke.
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const fireDone = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current?.();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const zeroArea = from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0;
    const finite = Number.isFinite(from.left) && Number.isFinite(from.top)
      && Number.isFinite(to.left) && Number.isFinite(to.top);
    if (!webglAvailable() || zeroArea || !finite) {
      // No GPU path (or nothing to draw): bail immediately, let the caller's clone carry it.
      fireDone();
      setStatus('failed');
      return;
    }

    const img = new Image();
    img.decoding = 'async';
    const fail = () => {
      if (cancelled) return;
      fireDone();
      setStatus('failed');
    };
    img.onerror = fail;
    img.onload = () => {
      if (cancelled) return;
      const built = buildParticles(img, from, to);
      if (built === null) {
        fail();
        return;
      }
      dataRef.current = built;
      setStatus('ready');
    };
    img.src = shot;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      if (dataRef.current !== null) {
        dataRef.current.geometry.dispose();
        dataRef.current.material.dispose();
        dataRef.current = null;
      }
      setStatus('init'); // force a fresh mount on rebuild (StrictMode / prop change)
    };
  }, [
    shot,
    from.left, from.top, from.width, from.height,
    to.left, to.top, to.width, to.height,
    fireDone,
  ]);

  const data = dataRef.current;
  if (status !== 'ready' || data === null) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <Canvas
        flat
        orthographic
        frameloop="always"
        dpr={[1, 1.5]}
        events={noopEvents}
        gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
        camera={{ manual: true, position: [0, 0, 10], near: 0.1, far: 1000 }}
        style={{ width: '100%', height: '100%' }}
      >
        <PixelCamera />
        <Field data={data} durationMs={durationMs} onComplete={fireDone} />
      </Canvas>
    </div>
  );
}
