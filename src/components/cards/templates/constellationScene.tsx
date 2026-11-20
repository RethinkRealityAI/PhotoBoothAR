/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Constellation's 3D scene — lazy-loaded by Constellation.tsx, so a
 * keepsake in any other style never downloads it.
 *
 * Every contribution is a floating glass tile on a latitude-limited sphere
 * (lib/cardTemplates.ts `constellationLayout`, seeded per contribution id),
 * joined to its nearest neighbours by faint threads of light that a slow
 * pulse runs along — a star map of the people in the card. A starfield and a
 * few large soft bokeh discs in the card's palette sit far behind.
 *
 * CHEAP ON PURPOSE: no post-processing. "Bloom" is an additive halo quad
 * behind each tile and at the centre; tiles are one shader (rounded corners,
 * cover-fit, a lit rim) and always face the camera; DPR is capped at 2.
 *
 * CAMERA: a damped orbit about a target. The index contract sets the GOAL —
 * overview (target at the centre, standing back far enough to fit the shell)
 * or focus (target on the tile, the camera outward along the tile's own
 * direction) — and the camera eases there; dragging turns the goal, a wheel
 * or pinch moves it in or out within limits. Reduced motion snaps instead of
 * flying and stops the drift.
 *
 * VIDEO: a video tile shows a poster frame; while focused it becomes a live
 * VideoTexture playing muted. The element is handed to the DOM layer
 * (`onVideo`) so its caption's button can turn the sound on — a gesture the
 * browser requires for audio.
 *
 * Disposal: canvas and video textures and the video element are released on
 * unmount; photo textures belong to the shared carousel cache (cardTexture)
 * and are left for it to evict.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { CardViewContribution } from '../../../lib/cards';
import {
  constellationLayout,
  constellationRadius,
  constellationThreads,
  focusCameraPosition,
  overviewDistance,
  polaroidSeed,
  type ConstellationNode,
} from '../../../lib/cardTemplates';
import { cardTexture } from '../../carousel/cardTexture';
import { drawNote, type NotePalette } from './noteCanvas';

const FOV = 50;
/** Tile size in world units (3:4 portrait, like a print). */
const TILE_H = 1.7;
const TILE_W = TILE_H * 0.75;

export interface ConstellationSceneProps {
  contributions: CardViewContribution[];
  /** Contribution index in focus, or null for the overview. */
  focus: number | null;
  palette: NotePalette;
  reducedMotion: boolean;
  /** Tap on a tile (contribution index). */
  onSelect: (i: number) => void;
  /** The focused video's element (or null), for the DOM sound control. */
  onVideo: (el: HTMLVideoElement | null) => void;
  /** WebGL died and did not come back. */
  onFail: () => void;
}

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

const TILE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TILE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform float uMapAspect;   // texture width / height
  uniform float uTileAspect;  // tile width / height
  uniform float uOpacity;
  uniform float uFocus;       // 0..1
  uniform vec3 uAccent;
  uniform vec3 uBase;
  varying vec2 vUv;

  float roundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    // Cover-fit the texture into the tile.
    vec2 uv = vUv;
    if (uMapAspect > uTileAspect) {
      float s = uTileAspect / uMapAspect;
      uv.x = (uv.x - 0.5) * s + 0.5;
    } else {
      float s = uMapAspect / uTileAspect;
      uv.y = (uv.y - 0.5) * s + 0.5;
    }
    vec3 col = uHasMap > 0.5 ? texture2D(uMap, uv).rgb : uBase;

    // Rounded corners with a soft edge, plus a lit rim inside it.
    vec2 p = (vUv - 0.5) * vec2(uTileAspect, 1.0);
    float d = roundedBox(p, vec2(uTileAspect * 0.5, 0.5), 0.07);
    float aa = fwidth(d) * 1.2;
    float alpha = 1.0 - smoothstep(-aa, aa, d);
    float rim = 1.0 - smoothstep(0.0, 0.018, abs(d + 0.006));
    // A sheen across the glass, stronger when focused.
    float sheen = smoothstep(0.35, 0.0, abs(vUv.x + vUv.y - 1.15)) * (0.06 + 0.06 * uFocus);
    col = mix(col, vec3(1.0), sheen);
    col = mix(col, mix(vec3(1.0), uAccent, 0.4), rim * (0.55 + 0.45 * uFocus));
    gl_FragColor = vec4(col, alpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

const HALO_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - r), 2.4) * uStrength;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`;

const THREAD_VERT = /* glsl */ `
  attribute float aT;
  attribute float aSeed;
  varying float vT;
  varying float vSeed;
  void main() {
    vT = aT;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const THREAD_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uDim;
  varying float vT;
  varying float vSeed;
  void main() {
    float head = fract(uTime * 0.16 + vSeed);
    float pulse = smoothstep(0.14, 0.0, abs(vT - head));
    float a = (0.16 + pulse * 0.8) * uDim;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`;

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vColor = aColor;
    vTwinkle = 0.65 + 0.35 * sin(uTime * (0.6 + aSeed) + aSeed * 40.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (70.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAG = /* glsl */ `
  uniform float uSoft; // 0 = star, 1 = bokeh disc
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = uSoft > 0.5 ? smoothstep(1.0, 0.75, r) * 0.08 : pow(max(0.0, 1.0 - r), 2.0) * vTwinkle;
    gl_FragColor = vec4(vColor * a, a);
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function color(css: string, fallback: string): THREE.Color {
  const c = new THREE.Color();
  try {
    c.setStyle(css);
  } catch {
    c.setStyle(fallback);
  }
  return c;
}

/** Seeded [0,1) from a string + salt — the stars are deterministic too. */
function seeded(key: string, salt: number): number {
  return (polaroidSeed(key, salt) >>> 8) / 0x1000000;
}

/** Distance at which a tile fills a comfortable share of the view. */
function focusDistance(aspect: number): number {
  const v = (FOV * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  const byHeight = TILE_H / (2 * Math.tan(v / 2) * 0.44);
  const byWidth = TILE_W / (2 * Math.tan(h / 2) * 0.6);
  return Math.max(byHeight, byWidth);
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

function CameraRig({
  nodes,
  focus,
  radius,
  reducedMotion,
}: {
  nodes: ConstellationNode[];
  focus: number | null;
  radius: number;
  reducedMotion: boolean;
}) {
  const { camera, size, gl } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  const target = useRef(new THREE.Vector3());
  const goalTarget = useRef(new THREE.Vector3());
  const sph = useRef({ az: 0.35, pol: 1.32, dist: overviewDistance(radius, aspect, FOV) * 1.6 });
  const goal = useRef({ az: 0.35, pol: 1.32, dist: overviewDistance(radius, aspect, FOV) });
  const lastInput = useRef(-10);
  const limits = useRef({ min: 2, max: 40 });

  // A new focus (or overview) sets a new goal.
  useEffect(() => {
    const overview = overviewDistance(radius, aspect, FOV);
    if (focus === null || nodes[focus] === undefined) {
      goalTarget.current.set(0, 0, 0);
      goal.current.dist = overview;
      goal.current.pol = 1.32;
      limits.current = { min: radius * 0.6, max: overview * 1.35 };
      return;
    }
    const p = nodes[focus].position;
    const d = focusDistance(aspect);
    const cam = focusCameraPosition(p, d);
    const dir = new THREE.Vector3(cam[0] - p[0], cam[1] - p[1], cam[2] - p[2]).normalize();
    // Aim a touch BELOW the tile so it sits above the caption on a phone.
    const drop = aspect < 0.9 ? TILE_H * 0.3 : TILE_H * 0.12;
    goalTarget.current.set(p[0], p[1] - drop, p[2]);
    const az = Math.atan2(dir.x, dir.z);
    // Shortest way round from where the goal is now.
    const cur = goal.current.az;
    const delta = Math.atan2(Math.sin(az - cur), Math.cos(az - cur));
    goal.current.az = cur + delta;
    goal.current.pol = Math.acos(Math.max(-1, Math.min(1, dir.y)));
    goal.current.dist = d;
    limits.current = { min: d * 0.6, max: overview * 1.35 };
  }, [focus, nodes, radius, aspect]);

  // Drag to orbit, wheel / pinch to zoom (within limits).
  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (prev === undefined) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastInput.current = performance.now() / 1000;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) {
          const g = goal.current;
          g.dist = THREE.MathUtils.clamp(g.dist * (pinch / dist), limits.current.min, limits.current.max);
        }
        pinch = dist;
        return;
      }
      const g = goal.current;
      g.az -= dx * 0.006;
      g.pol = THREE.MathUtils.clamp(g.pol - dy * 0.005, 0.45, Math.PI - 0.45);
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInput.current = performance.now() / 1000;
      const g = goal.current;
      g.dist = THREE.MathUtils.clamp(g.dist * Math.exp(e.deltaY * 0.0012), limits.current.min, limits.current.max);
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [gl]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const idle = t - lastInput.current > 2.5;
    // Slow drift round the overview, unless the reader is steering.
    if (focus === null && idle && !reducedMotion) goal.current.az += dt * 0.05;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 2.6);
    const s = sph.current;
    const g = goal.current;
    s.az += (g.az - s.az) * k;
    s.pol += (g.pol - s.pol) * k;
    s.dist += (g.dist - s.dist) * k;
    target.current.lerp(goalTarget.current, k);
    const sinP = Math.sin(s.pol);
    camera.position.set(
      target.current.x + s.dist * sinP * Math.sin(s.az),
      target.current.y + s.dist * Math.cos(s.pol),
      target.current.z + s.dist * sinP * Math.cos(s.az),
    );
    camera.lookAt(target.current);
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

function useTileTexture(
  c: CardViewContribution,
  palette: NotePalette,
  live: boolean,
  onVideo: (el: HTMLVideoElement | null) => void,
): THREE.Texture | null {
  const [still, setStill] = useState<THREE.Texture | null>(null);
  const [video, setVideo] = useState<THREE.VideoTexture | null>(null);

  // The still: photo / poster from the shared cache, or a painted note.
  useEffect(() => {
    let alive = true;
    let own: THREE.Texture | null = null;
    const paint = (kind: 'text' | 'video') => {
      const canvas = drawNote({ kind, message: c.message, name: c.contributorName }, palette, 540, 720);
      own = new THREE.CanvasTexture(canvas);
      own.colorSpace = THREE.SRGBColorSpace;
      own.anisotropy = 4;
      setStill(own);
    };
    if (c.mediaType === 'photo' && c.url) {
      void cardTexture(c.url, 'photo').then((t) => {
        if (!alive) return;
        if (t) setStill(t);
        else paint('text');
      });
    } else if (c.mediaType === 'video' && c.url) {
      void cardTexture(c.url, 'video').then((t) => {
        if (!alive) return;
        if (t) setStill(t);
        else paint('video');
      });
    } else {
      paint('text');
    }
    return () => {
      alive = false;
      own?.dispose();
    };
  }, [c, palette]);

  // The live clip, only while focused.
  useEffect(() => {
    if (!live || c.mediaType !== 'video' || !c.url) return;
    const el = document.createElement('video');
    el.crossOrigin = 'anonymous';
    el.muted = true;
    el.loop = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.src = c.url;
    const tex = new THREE.VideoTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    let shown = false;
    const onData = () => {
      if (shown) return;
      shown = true;
      setVideo(tex);
    };
    el.addEventListener('loadeddata', onData);
    void el.play().catch(() => {});
    onVideo(el);
    return () => {
      el.removeEventListener('loadeddata', onData);
      el.pause();
      el.removeAttribute('src');
      el.load();
      tex.dispose();
      setVideo(null);
      onVideo(null);
    };
  }, [live, c, onVideo]);

  return video ?? still;
}

function Tile({
  c,
  node,
  i,
  focus,
  palette,
  reducedMotion,
  onSelect,
  onVideo,
}: {
  c: CardViewContribution;
  node: ConstellationNode;
  i: number;
  focus: number | null;
  palette: NotePalette;
  reducedMotion: boolean;
  onSelect: (i: number) => void;
  onVideo: (el: HTMLVideoElement | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const ndc = useMemo(() => new THREE.Vector3(), []);
  const focused = focus === i;
  const texture = useTileTexture(c, palette, focused, onVideo);
  const [hover, setHover] = useState(false);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: null },
          uHasMap: { value: 0 },
          uMapAspect: { value: 0.75 },
          uTileAspect: { value: TILE_W / TILE_H },
          uOpacity: { value: 0 },
          uFocus: { value: 0 },
          uAccent: { value: color(palette.accent, '#D4D6FF') },
          uBase: { value: color(palette.bg, '#33318A') },
        },
        vertexShader: TILE_VERT,
        fragmentShader: TILE_FRAG,
        transparent: true,
        depthWrite: false,
      }),
    [palette],
  );
  const halo = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color(palette.accent, '#D4D6FF') }, uStrength: { value: 0.3 } },
        vertexShader: TILE_VERT,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [palette],
  );
  useEffect(
    () => () => {
      material.dispose();
      halo.dispose();
    },
    [material, halo],
  );

  useEffect(() => {
    const u = material.uniforms;
    u.uMap.value = texture;
    u.uHasMap.value = texture ? 1 : 0;
    const img = texture?.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
    const w = img?.videoWidth ?? img?.width ?? 3;
    const h = img?.videoHeight ?? img?.height ?? 4;
    u.uMapAspect.value = w > 0 && h > 0 ? w / h : 0.75;
  }, [texture, material]);

  useFrame((state, dt) => {
    const g = group.current;
    if (g === null) return;
    const t = state.clock.elapsedTime;
    const bob = reducedMotion ? 0 : Math.sin(t * 0.55 + node.phase) * 0.09;
    g.position.set(node.position[0], node.position[1] + bob, node.position[2]);
    g.quaternion.copy(state.camera.quaternion);
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
    const u = material.uniforms;
    // Overview: a tile that projects behind the floating title steps back,
    // so the title reads; focus: everything but the chosen tile dims.
    let wantOpacity = texture === null ? 0 : focus === null || focused ? 1 : 0.5;
    if (focus === null && texture !== null) {
      ndc.copy(g.position).project(state.camera);
      const r = Math.hypot(ndc.x * 1.2, ndc.y * 2.2);
      wantOpacity *= THREE.MathUtils.smoothstep(r, 0.25, 0.75) * 0.8 + 0.2;
    }
    u.uOpacity.value += (wantOpacity - u.uOpacity.value) * k;
    u.uFocus.value += ((focused || hover ? 1 : 0) - u.uFocus.value) * k;
    halo.uniforms.uStrength.value = (0.22 + u.uFocus.value * 0.5) * u.uOpacity.value;
    const s = node.scale * (1 + u.uFocus.value * 0.06);
    g.scale.setScalar(s);
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return; // a drag, not a tap
    e.stopPropagation();
    onSelect(i);
  };

  return (
    <group ref={group}>
      <mesh material={halo} position={[0, 0, -0.02]} renderOrder={0}>
        <planeGeometry args={[TILE_W * 2.3, TILE_H * 1.9]} />
      </mesh>
      <mesh
        material={material}
        renderOrder={1}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        <planeGeometry args={[TILE_W, TILE_H]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Threads, stars, the centre                                          */
/* ------------------------------------------------------------------ */

function Threads({ nodes, palette, dim }: { nodes: ConstellationNode[]; palette: NotePalette; dim: number }) {
  const { geometry, material } = useMemo(() => {
    const pairs = constellationThreads(
      nodes.map((n) => n.position),
      2,
    );
    const SEG = 24; // segments per thread, so the pulse has somewhere to travel
    const pos: number[] = [];
    const ts: number[] = [];
    const seeds: number[] = [];
    pairs.forEach(([a, b], k) => {
      const A = new THREE.Vector3(...nodes[a].position);
      const B = new THREE.Vector3(...nodes[b].position);
      // A gentle arc outward, like a line drawn on a celestial globe.
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const lift = mid.clone().normalize().multiplyScalar(A.distanceTo(B) * 0.08);
      const ctrl = mid.add(lift);
      const curve = new THREE.QuadraticBezierCurve3(A, ctrl, B);
      const pts = curve.getPoints(SEG);
      const seed = seeded(`${nodes[a].id}-${nodes[b].id}`, k);
      for (let i = 0; i < SEG; i++) {
        pos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        ts.push(i / SEG, (i + 1) / SEG);
        seeds.push(seed, seed);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
    geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color(palette.accent, '#D4D6FF') }, uTime: { value: 0 }, uDim: { value: 1 } },
      vertexShader: THREAD_VERT,
      fragmentShader: THREAD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry, material };
  }, [nodes, palette]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state, dt) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uDim.value += (dim - material.uniforms.uDim.value) * (1 - Math.exp(-dt * 3));
  });
  return <lineSegments geometry={geometry} material={material} renderOrder={-1} />;
}

function Stars({ palette, count, soft }: { palette: NotePalette; count: number; soft: boolean }) {
  const { gl } = useThree();
  const { geometry, material } = useMemo(() => {
    const fg = color(palette.fg, '#FFFFFF');
    const accent = color(palette.accent, '#D4D6FF');
    const warm = new THREE.Color('#FFC56B');
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const key = `${soft ? 'bokeh' : 'star'}-${i}`;
      const u = seeded(key, 1) * 2 - 1;
      const th = seeded(key, 2) * Math.PI * 2;
      const r = soft ? 14 + seeded(key, 3) * 16 : 22 + seeded(key, 3) * 40;
      const ring = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * ring * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = Math.sin(th) * ring * r;
      const pick = seeded(key, 4);
      const c = pick < 0.6 ? fg : pick < 0.93 ? accent : warm;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      size[i] = soft ? 26 + seeded(key, 5) * 40 : 0.6 + seeded(key, 5) * 1.8;
      seed[i] = seeded(key, 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uSoft: { value: soft ? 1 : 0 } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry, material };
  }, [palette, count, soft]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });
  return <points geometry={geometry} material={material} renderOrder={-2} />;
}

function CoreGlow({ palette, strength }: { palette: NotePalette; strength: number }) {
  const ref = useRef<THREE.Group>(null);
  const [accentMat, warmMat] = useMemo(() => {
    const make = (c: THREE.Color, s: number) =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: c }, uStrength: { value: s } },
        vertexShader: TILE_VERT,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    return [make(color(palette.accent, '#D4D6FF'), 0.55), make(new THREE.Color('#FFC56B'), 0.4)];
  }, [palette]);
  useEffect(
    () => () => {
      accentMat.dispose();
      warmMat.dispose();
    },
    [accentMat, warmMat],
  );
  useFrame((state, dt) => {
    ref.current?.quaternion.copy(state.camera.quaternion);
    const k = 1 - Math.exp(-dt * 3);
    accentMat.uniforms.uStrength.value += (0.55 * strength - accentMat.uniforms.uStrength.value) * k;
    warmMat.uniforms.uStrength.value += (0.4 * strength - warmMat.uniforms.uStrength.value) * k;
  });
  return (
    <group ref={ref}>
      <mesh material={accentMat} renderOrder={-1}>
        <planeGeometry args={[9, 9]} />
      </mesh>
      <mesh material={warmMat} renderOrder={-1}>
        <planeGeometry args={[2.6, 2.6]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export default function ConstellationScene({
  contributions,
  focus,
  palette,
  reducedMotion,
  onSelect,
  onVideo,
  onFail,
}: ConstellationSceneProps) {
  const ids = useMemo(() => contributions.map((c) => c.id), [contributions]);
  const nodes = useMemo(() => constellationLayout(ids), [ids]);
  const radius = constellationRadius(ids.length);
  const alive = useRef(true);
  const restoreTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(restoreTimer.current);
      document.body.style.cursor = '';
    };
  }, []);

  // Same policy as PhotoCarousel: a lost context may come back; only give up
  // if it does not.
  const onCreated = ({ gl }: { gl: THREE.WebGLRenderer }) => {
    const el = gl.domElement;
    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (!alive.current) return;
      window.clearTimeout(restoreTimer.current);
      restoreTimer.current = window.setTimeout(() => {
        if (alive.current) onFail();
      }, 4000);
    });
    el.addEventListener('webglcontextrestored', () => window.clearTimeout(restoreTimer.current));
  };

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 2, 18], fov: FOV, near: 0.1, far: 200 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={onCreated}
      style={{ width: '100%', height: '100%', touchAction: 'none' }}
    >
      <CameraRig nodes={nodes} focus={focus} radius={radius} reducedMotion={reducedMotion} />
      <Stars palette={palette} count={900} soft={false} />
      <Stars palette={palette} count={16} soft />
      <CoreGlow palette={palette} strength={focus === null ? 1 : 0.35} />
      <Threads nodes={nodes} palette={palette} dim={focus === null ? 1 : 0.55} />
      {contributions.map((c, i) => (
        <Tile
          key={c.id}
          c={c}
          node={nodes[i]}
          i={i}
          focus={focus}
          palette={palette}
          reducedMotion={reducedMotion}
          onSelect={onSelect}
          onVideo={onVideo}
        />
      ))}
    </Canvas>
  );
}
