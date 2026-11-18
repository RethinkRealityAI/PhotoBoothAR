/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StoryFx — the light around each "How it works" scene, drawn on BeamyStage's
 * one canvas (orthographic, 1 world unit = 1 CSS px, origin at the viewport
 * centre), behind the page. The scenes themselves are DOM (StoryScenes); the
 * page writes the active step's main piece into `fxRef.spot` and the blended
 * step weights every frame, and this layer gathers that step's light round it:
 *
 *   qr        motes rising, scan rings pulsing out behind the phone
 *   prop      a ring of light orbiting the looks
 *   wall      motes drifting up past the wall
 *   medal     amber light orbiting the challenge
 *   keepsake  warm motes rising past the album
 *
 * Every effect fades with damping (1 − exp(−k·dt)) so it is fully gone before
 * the next step's scene beams in. Particles are a time-driven vertex shader
 * (no per-particle JS). Phones get fewer; reduced motion slows every loop.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DT_MAX, K_SOFT, type Box } from '../../lib/beamyScroll';
import type { StoryFxId } from '../../lib/brandLanding';

export interface FxState {
  /** Target weight per effect, 0..1 (blended from the slot poses). */
  weights: Partial<Record<StoryFxId, number>>;
  /** The active scene's main piece, viewport px (null = nowhere on screen). */
  spot: Box | null;
}

const IDS: StoryFxId[] = ['qr', 'prop', 'wall', 'medal', 'keepsake'];
const WHITE = new THREE.Color('#FFFFFF');
const PERI = new THREE.Color('#A5ABFF');
const AMBER = new THREE.Color('#FFC56B');

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

export default function StoryFx({ fxRef, lite, reduced }: {
  fxRef: MutableRefObject<FxState>;
  lite: boolean;
  reduced: boolean;
}) {
  const { gl, scene, camera, size } = useThree();
  const roots = useRef<Partial<Record<StoryFxId, THREE.Group | null>>>({});
  const cur = useRef<Record<StoryFxId, number>>({ qr: 0, prop: 0, wall: 0, medal: 0, keepsake: 0 });
  const clock = useRef(0);
  const rings = useRef<(THREE.Mesh | null)[]>([]);

  const r = useMemo(() => {
    const n = lite ? 0.5 : 1;
    const ringMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: PERI, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const ring = new THREE.RingGeometry(0.97, 1, 72);
    const sp: Record<StoryFxId, ReturnType<typeof sparkles>> = {
      qr: sparkles(Math.round(30 * n), 0.62, 5, 1, PERI, WHITE),
      prop: sparkles(Math.round(70 * n), 0.62, 6, 0, WHITE, AMBER),
      wall: sparkles(Math.round(30 * n), 0.62, 4, 1, WHITE, PERI),
      medal: sparkles(Math.round(70 * n), 0.66, 6, 0, AMBER, WHITE),
      keepsake: sparkles(Math.round(46 * n), 0.62, 5, 1, WHITE, AMBER),
    };
    return { ringMats, ring, sp };
  }, [lite]);

  // One-time disposal of everything this layer owns.
  useEffect(() => () => {
    r.ring.dispose();
    for (const m of r.ringMats) m.dispose();
    for (const v of Object.values(r.sp)) { v.geo.dispose(); v.mat.dispose(); }
  }, [r]);

  // Shader warm-up: compile every material once while hidden, so the first
  // step never stutters on a new program.
  useEffect(() => {
    const groups = IDS.map((id) => roots.current[id]).filter((g): g is THREE.Group => g != null);
    for (const g of groups) g.visible = true;
    try { gl.compile(scene, camera); } catch { /* a failed compile shows up on first draw instead */ }
    for (const g of groups) g.visible = false;
  }, [gl, scene, camera]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, DT_MAX);
    const fx = fxRef.current;
    clock.current += dt * (reduced ? 0.4 : 1);
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
      // Behind the page in depth: the light gathers round the piece's edges.
      g.position.set(spot.left + spot.width / 2 - W / 2, H / 2 - (spot.top + spot.height / 2), -Math.min(900, s * 2));
      g.scale.setScalar(s);
      const p = r.sp[id].mat.uniforms;
      p.uTime.value = t;
      p.uPx.value = px;
      p.uOpacity.value = e;
    }

    /* qr: rings pulse out from behind the phone. */
    if (roots.current.qr?.visible) {
      const e = ease(cur.current.qr);
      rings.current.forEach((ring, i) => {
        if (!ring) return;
        const u = ((t / 3.2) + i / 3) % 1;
        ring.scale.setScalar(0.5 + u * 0.4);
        r.ringMats[i].opacity = (1 - u) * 0.5 * e;
      });
    }
  });

  const { sp } = r;
  const set = (id: StoryFxId) => (el: THREE.Group | null) => { roots.current[id] = el; };
  return (
    <>
      {IDS.map((id) => (
        <group key={id} ref={set(id)} visible={false}>
          {id === 'qr' && [0, 1, 2].map((i) => (
            <mesh key={i} ref={(el) => { rings.current[i] = el; }} geometry={r.ring} material={r.ringMats[i]} position={[0, 0, -0.08]} renderOrder={1} />
          ))}
          <points geometry={sp[id].geo} material={sp[id].mat} frustumCulled={false} />
        </group>
      ))}
    </>
  );
}
