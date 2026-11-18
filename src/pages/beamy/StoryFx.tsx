/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StoryFx — the pinned story's per-step 3D effects, drawn on BeamyStage's one
 * canvas (orthographic, 1 world unit = 1 CSS px, origin at the viewport
 * centre). Each effect sits in the story's `[data-fx-spot]` box, which CSS
 * places beside Beamy's slot and never over copy; the page writes the box
 * and the blended effect weights into `fxRef` every frame.
 *
 *   qr        a thick glass phone showing a QR code, a scan line sweeping it,
 *             scan rings pulsing out behind it
 *   prop      a glass pedestal with a glow ring and orbiting light (the 3D
 *             prop itself is conjured by the stage's `reveal`)
 *   wall      a mini live wall: a glass slab of nine photo tiles; the tile a
 *             beam lands on (`pulse`) pops and flashes
 *   medal     an amber coin with a star that flips calmly, sparkles orbiting
 *   keepsake  three keepsake cards fanning open and closed, motes rising
 *
 * Every effect is authored in unit space (1 = the spot's short side), fades
 * in and out with damping (1 − exp(−k·dt)) and loops on its own calm timer.
 * Particles are a time-driven vertex shader (no per-particle JS). Phones get
 * fewer particles; reduced motion slows every loop rather than freezing it.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DT_MAX, K_SOFT, type Box } from '../../lib/beamyScroll';
import type { StoryFxId } from '../../lib/brandLanding';

export interface FxState {
  /** Target weight per effect, 0..1 (blended from the slot poses). */
  weights: Partial<Record<StoryFxId, number>>;
  /** Where the effects stand, viewport px (null = nowhere on screen). */
  spot: Box | null;
  /** performance.now() of the last beam landing on the mini wall. */
  pulse: number;
}

const IDS: StoryFxId[] = ['qr', 'prop', 'wall', 'medal', 'keepsake'];
const WHITE = new THREE.Color('#FFFFFF');
const PERI = new THREE.Color('#A5ABFF');
const AMBER = new THREE.Color('#FFC56B');

/** A rounded rectangle slab with a soft bevel, centred on the origin (unit space). */
function slab(w: number, h: number, r: number, depth: number, bevel: number): THREE.ExtrudeGeometry {
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
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function star(outer: number, inner: number, depth: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.4, bevelSegments: 2 });
}

/** A QR-like code on a white card: three finder squares and seeded modules. */
function qrTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d');
  if (g !== null) {
    const bg = g.createLinearGradient(0, 0, 0, 512);
    bg.addColorStop(0, '#3B36A8');
    bg.addColorStop(1, '#1A1740');
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.roundRect(38, 150, 180, 180, 18);
    g.fill();
    const n = 21;
    const m = 160 / n;
    const ox = 48;
    const oy = 160;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#1A1740';
    for (let yy = 0; yy < n; yy++) {
      for (let xx = 0; xx < n; xx++) {
        const finder = (xx < 7 && yy < 7) || (xx >= n - 7 && yy < 7) || (xx < 7 && yy >= n - 7);
        if (finder) continue;
        if (rnd() > 0.52) g.fillRect(ox + xx * m, oy + yy * m, m + 0.4, m + 0.4);
      }
    }
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      g.fillRect(ox + fx * m, oy + fy * m, 7 * m, 7 * m);
      g.fillStyle = '#FFFFFF';
      g.fillRect(ox + (fx + 1) * m, oy + (fy + 1) * m, 5 * m, 5 * m);
      g.fillStyle = '#1A1740';
      g.fillRect(ox + (fx + 2) * m, oy + (fy + 2) * m, 3 * m, 3 * m);
    }
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = '600 22px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Scan to join', 128, 380);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SPARK_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uSize;
uniform float uRadius;
uniform float uMode;
uniform float uPx;
varying float vA;
varying float vSeed;
void main() {
  float s = aSeed;
  vec3 p;
  if (uMode < 0.5) {
    // Orbit: a tilted ring of light around the centre.
    float a = s * 43.98 + uTime * (0.35 + fract(s * 13.1) * 0.45);
    float r = uRadius * (0.62 + fract(s * 7.3) * 0.5);
    p = vec3(cos(a) * r, sin(a) * r * 0.32 + (fract(s * 5.7) - 0.5) * uRadius * 0.25, sin(a) * r * 0.5);
    vA = 0.55 + 0.45 * sin(uTime * 2.6 + s * 40.0);
  } else {
    // Rise: motes drifting up through the spot.
    float k = fract(s * 3.3 + uTime * (0.06 + fract(s * 5.1) * 0.08));
    p = vec3((fract(s * 9.1) - 0.5) * uRadius * 2.0 + sin(uTime * 0.7 + s * 20.0) * 0.03, (k - 0.5) * uRadius * 2.2, 0.2);
    vA = sin(3.14159 * k) * (0.6 + 0.4 * sin(uTime * 3.0 + s * 30.0));
  }
  vSeed = s;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * uPx * (0.55 + fract(s * 11.0) * 0.9);
}`;
const SPARK_FRAG = /* glsl */ `
uniform vec3 uC1;
uniform vec3 uC2;
uniform float uOpacity;
varying float vA;
varying float vSeed;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = pow(smoothstep(0.5, 0.0, d), 1.6) * vA * uOpacity;
  vec3 c = mix(uC1, uC2, step(0.7, fract(vSeed * 17.0)));
  gl_FragColor = vec4(c * a, a);
}`;

function sparkles(count: number, radius: number, size: number, mode: 0 | 1, c1: THREE.Color, c2: THREE.Color): { geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial } {
  const geo = new THREE.BufferGeometry();
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = (i + 0.5) / count + Math.sin(i * 12.9898) * 0.001;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uSize: { value: size }, uRadius: { value: radius }, uMode: { value: mode },
      uPx: { value: 1 }, uC1: { value: c1 }, uC2: { value: c2 }, uOpacity: { value: 0 },
    },
  });
  return { geo, mat };
}

const ease = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));

export default function StoryFx({ fxRef, photos, lite, reduced }: {
  fxRef: MutableRefObject<FxState>;
  /** Photo URLs for the mini wall and the keepsake cards (same-origin assets). */
  photos: string[];
  lite: boolean;
  reduced: boolean;
}) {
  const { gl, scene, camera, size } = useThree();
  const roots = useRef<Partial<Record<StoryFxId, THREE.Group | null>>>({});
  const cur = useRef<Record<StoryFxId, number>>({ qr: 0, prop: 0, wall: 0, medal: 0, keepsake: 0 });
  const clock = useRef(0);
  const qrPhone = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const wallG = useRef<THREE.Group>(null);
  const tiles = useRef<(THREE.Mesh | null)[]>([]);
  const tileFlash = useRef<THREE.Mesh>(null);
  const coin = useRef<THREE.Group>(null);
  const cards = useRef<(THREE.Group | null)[]>([]);
  const pedestal = useRef<THREE.Group>(null);

  const r = useMemo(() => {
    const glass = (color: string, opacity: number) => new THREE.MeshPhysicalMaterial({
      color, metalness: 0.1, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity,
    });
    const loader = new THREE.TextureLoader();
    const tex = photos.slice(0, 9).map((u) => { const t = loader.load(u); t.colorSpace = THREE.SRGBColorSpace; return t; });
    const n = lite ? 0.5 : 1;
    const m = {
      phoneBody: new THREE.MeshPhysicalMaterial({ color: '#211D5C', metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, transparent: true }),
      phoneScreen: new THREE.MeshBasicMaterial({ map: qrTexture(), transparent: true, toneMapped: false }),
      scan: new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      rings: [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: PERI, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })),
      pedestal: glass('#B9B6FF', 0.62),
      glow: new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      wallGlass: glass('#3A35A0', 0.72),
      tiles: tex.map((t) => new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false })),
      flash: new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      coin: new THREE.MeshPhysicalMaterial({ color: '#FFC56B', metalness: 0.85, roughness: 0.28, clearcoat: 0.6, transparent: true }),
      coinStar: new THREE.MeshPhysicalMaterial({ color: '#FFF1D2', metalness: 0.6, roughness: 0.22, clearcoat: 1, transparent: true }),
      card: new THREE.MeshPhysicalMaterial({ color: '#FBFAFF', metalness: 0, roughness: 0.55, clearcoat: 0.4, transparent: true }),
      cardPhotos: [3, 5, 7].map((i) => new THREE.MeshBasicMaterial({ map: tex[i % Math.max(1, tex.length)] ?? null, transparent: true, toneMapped: false })),
    };
    const g = {
      phone: slab(0.4, 0.8, 0.07, 0.05, 0.014),
      screen: new THREE.PlaneGeometry(0.35, 0.74),
      scan: new THREE.PlaneGeometry(0.3, 0.01),
      ring: new THREE.RingGeometry(0.96, 1, 72),
      pedestalTop: new THREE.CylinderGeometry(0.34, 0.38, 0.06, 56),
      glow: new THREE.RingGeometry(0.33, 0.36, 72),
      wall: slab(0.98, 0.76, 0.06, 0.04, 0.012),
      tile: new THREE.PlaneGeometry(0.28, 0.205),
      coin: new THREE.CylinderGeometry(0.28, 0.28, 0.06, 72),
      star: star(0.15, 0.065, 0.012),
      card: (() => { const c = slab(0.4, 0.52, 0.035, 0.012, 0.006); c.translate(0, 0.26, 0); return c; })(),
      cardPhoto: (() => { const p = new THREE.PlaneGeometry(0.34, 0.36); p.translate(0, 0.3, 0.014); return p; })(),
    };
    const sp = {
      qr: sparkles(Math.round(28 * n), 0.5, 5, 1, PERI, WHITE),
      prop: sparkles(Math.round(70 * n), 0.42, 6, 0, WHITE, AMBER),
      wall: sparkles(Math.round(24 * n), 0.55, 4, 1, WHITE, PERI),
      medal: sparkles(Math.round(80 * n), 0.4, 6, 0, AMBER, WHITE),
      keepsake: sparkles(Math.round(46 * n), 0.5, 5, 1, WHITE, AMBER),
    };
    return { m, g, sp, tex };
  }, [photos, lite]);

  // One-time disposal of everything this effect layer owns.
  useEffect(() => () => {
    for (const v of Object.values(r.g)) v.dispose();
    for (const v of Object.values(r.m)) (Array.isArray(v) ? v : [v]).forEach((x) => { x.map?.dispose(); x.dispose(); });
    for (const v of Object.values(r.sp)) { v.geo.dispose(); v.mat.dispose(); }
    for (const t of r.tex) t.dispose();
  }, [r]);

  // Shader warm-up: compile every material once while hidden, so the first
  // step never stutters on a new program.
  useEffect(() => {
    const groups = IDS.map((id) => roots.current[id]).filter((g): g is THREE.Group => g != null);
    for (const g of groups) g.visible = true;
    try { gl.compile(scene, camera); } catch { /* a failed compile shows up on first draw instead */ }
    for (const g of groups) g.visible = false;
  }, [gl, scene, camera]);

  /** Materials per effect, faded together (base opacity × weight). */
  const fades = useMemo(() => {
    const { m, sp } = r;
    const list: Record<StoryFxId, [THREE.Material, number][]> = {
      qr: [[m.phoneBody, 1], [m.phoneScreen, 1]],
      prop: [[m.pedestal, 0.62]],
      wall: [[m.wallGlass, 0.72], ...m.tiles.map((x): [THREE.Material, number] => [x, 1])],
      medal: [[m.coin, 1], [m.coinStar, 1]],
      keepsake: [[m.card, 1], ...m.cardPhotos.map((x): [THREE.Material, number] => [x, 1])],
    };
    return { list, sp };
  }, [r]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, DT_MAX);
    const fx = fxRef.current;
    const speed = reduced ? 0.4 : 1;
    clock.current += dt * speed;
    const t = clock.current;
    const W = size.width;
    const H = size.height;
    const spot = fx.spot;
    const px = state.gl.getPixelRatio();
    const k = 1 - Math.exp(-K_SOFT * dt);
    for (const id of IDS) {
      const target = spot !== null ? fx.weights[id] ?? 0 : 0;
      const w = (cur.current[id] += (target - cur.current[id]) * k);
      const g = roots.current[id];
      if (!g) continue;
      const on = w > 0.01 && spot !== null;
      g.visible = on;
      if (!on || spot === null) continue;
      const s = Math.min(spot.width, spot.height);
      const e = ease(w);
      g.position.set(spot.left + spot.width / 2 - W / 2, H / 2 - (spot.top + spot.height / 2) - (1 - e) * s * 0.06, 0);
      g.scale.setScalar(s * (0.88 + 0.12 * e));
      for (const [mat, base] of fades.list[id]) mat.opacity = base * e;
      const p = fades.sp[id].mat.uniforms;
      p.uTime.value = t;
      p.uPx.value = px;
      p.uOpacity.value = e;
    }

    /* qr: the phone turns gently; the scan line sweeps the code; rings pulse out. */
    if (roots.current.qr?.visible) {
      const ph = qrPhone.current;
      if (ph) { ph.rotation.y = -0.32 + Math.sin(t * 0.55) * 0.22; ph.rotation.x = Math.sin(t * 0.4) * 0.05; ph.position.y = Math.sin(t * 0.9) * 0.015; }
      const sc = scan.current;
      if (sc) { const u = (t % 2.4) / 2.4; sc.position.y = 0.155 - Math.sin(u * Math.PI) * 0.33; r.m.scan.opacity = 0.9 * ease(cur.current.qr); }
      const e = ease(cur.current.qr);
      rings.current.forEach((ring, i) => {
        if (!ring) return;
        const u = ((t / 3.2) + i / 3) % 1;
        ring.scale.setScalar(0.25 + u * 0.6);
        r.m.rings[i].opacity = (1 - u) * 0.55 * e;
      });
    }

    /* prop: the pedestal turns slowly under the conjured prop; its glow breathes. */
    if (roots.current.prop?.visible) {
      const p = pedestal.current;
      if (p) p.rotation.y = t * 0.3;
      r.m.glow.opacity = (0.35 + 0.25 * Math.sin(t * 1.8)) * ease(cur.current.prop);
    }

    /* wall: a calm sway; the tile the last beam landed on pops and flashes. */
    if (roots.current.wall?.visible) {
      const wg = wallG.current;
      if (wg) { wg.rotation.y = -0.34 + Math.sin(t * 0.45) * 0.08; wg.rotation.x = Math.sin(t * 0.33) * 0.04; }
      const since = (performance.now() - fx.pulse) / 1000;
      const pop = since >= 0 && since < 1.2 ? Math.sin(Math.min(1, since / 1.2) * Math.PI) * (1 - since / 1.2) : 0;
      const hit = tiles.current[4];
      if (hit) hit.scale.setScalar(1 + pop * 0.22);
      r.m.flash.opacity = pop * 0.8 * ease(cur.current.wall);
      const fl = tileFlash.current;
      if (fl) fl.scale.setScalar(1 + pop * 0.22);
    }

    /* medal: rests, then a calm full flip; a slow bob. */
    if (roots.current.medal?.visible) {
      const c = coin.current;
      if (c) {
        const u = (t % 4.2) / 4.2;
        c.rotation.y = Math.PI * 2 * ease((u - 0.55) / 0.4) + Math.sin(t * 0.8) * 0.12;
        c.position.y = Math.sin(t * 1.1) * 0.025;
      }
    }

    /* keepsake: three cards fan open and close again, pivoting at their base. */
    if (roots.current.keepsake?.visible) {
      const open = 0.08 + 0.26 * (0.5 - 0.5 * Math.cos(t * 0.9));
      cards.current.forEach((c, i) => {
        if (!c) return;
        c.rotation.z = (1 - i) * open;
        c.position.x = (i - 1) * open * 0.18;
        c.rotation.y = Math.sin(t * 0.5 + i) * 0.08;
      });
    }
  });

  const { m, g, sp } = r;
  const set = (id: StoryFxId) => (el: THREE.Group | null) => { roots.current[id] = el; };
  return (
    <>
      <group ref={set('qr')} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} ref={(el) => { rings.current[i] = el; }} geometry={g.ring} material={m.rings[i]} position={[0, 0, -0.08]} renderOrder={1} />
        ))}
        <group ref={qrPhone}>
          <mesh geometry={g.phone} material={m.phoneBody} />
          <mesh geometry={g.screen} material={m.phoneScreen} position={[0, 0, 0.04]} />
          <mesh ref={scan} geometry={g.scan} material={m.scan} position={[0, 0, 0.042]} />
        </group>
        <points geometry={sp.qr.geo} material={sp.qr.mat} frustumCulled={false} />
      </group>

      <group ref={set('prop')} visible={false}>
        <group ref={pedestal} position={[0, -0.36, 0]} rotation={[0.32, 0, 0]}>
          <mesh geometry={g.pedestalTop} material={m.pedestal} />
          <mesh geometry={g.glow} material={m.glow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]} />
        </group>
        <points geometry={sp.prop.geo} material={sp.prop.mat} frustumCulled={false} />
      </group>

      <group ref={set('wall')} visible={false}>
        <group ref={wallG}>
          <mesh geometry={g.wall} material={m.wallGlass} />
          {m.tiles.map((mat, i) => (
            <mesh
              key={i}
              ref={(el) => { tiles.current[i] = el; }}
              geometry={g.tile}
              material={mat}
              position={[((i % 3) - 1) * 0.3, (1 - Math.floor(i / 3)) * 0.225, 0.045 + (i === 4 ? 0.01 : 0)]}
            />
          ))}
          <mesh ref={tileFlash} geometry={g.tile} material={m.flash} position={[0, 0, 0.06]} />
        </group>
        <points geometry={sp.wall.geo} material={sp.wall.mat} frustumCulled={false} />
      </group>

      <group ref={set('medal')} visible={false}>
        <group ref={coin}>
          <mesh geometry={g.coin} material={m.coin} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={g.star} material={m.coinStar} position={[0, 0, 0.03]} />
          <mesh geometry={g.star} material={m.coinStar} position={[0, 0, -0.03]} rotation={[0, Math.PI, 0]} />
        </group>
        <points geometry={sp.medal.geo} material={sp.medal.mat} frustumCulled={false} />
      </group>

      <group ref={set('keepsake')} visible={false}>
        <group position={[0, -0.3, 0]}>
          {[0, 1, 2].map((i) => (
            <group key={i} ref={(el) => { cards.current[i] = el; }} position={[0, 0, (i - 1) * 0.02 + (i === 1 ? 0.03 : 0)]}>
              <mesh geometry={g.card} material={m.card} />
              <mesh geometry={g.cardPhoto} material={m.cardPhotos[i]} />
            </group>
          ))}
        </group>
        <points geometry={sp.keepsake.geo} material={sp.keepsake.mat} frustumCulled={false} />
      </group>
    </>
  );
}
