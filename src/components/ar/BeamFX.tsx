/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamFX — the power-blast renderer. Mounted INSIDE Overlay3D's <Canvas>
 * (preserveDrawingBuffer:true), so every frame it draws lands in the captured
 * photo AND the recorded video through StageCanvas's existing composite — the
 * deliberate reason the full-frame flash is an in-canvas plane and not a DOM
 * overlay, and the screen "shake" is light-driven rather than CSS.
 *
 * All phase/colour/projection maths lives in src/lib/studio/beam.ts (pure,
 * node-tested); this file only owns three.js objects and per-frame uniform
 * writes. No React state changes per frame, no per-frame allocation.
 *
 * Visual language follows the PlayCanvas optic-blast reference: three nested
 * additive cylinders fading along their length, a camera-facing muzzle flare,
 * an eruption spark burst, and a flash spike at the moment the bolt erupts.
 *
 * Two emitters:
 *  - HEAD: parented to a FaceRig at the visor slit (noseBridge + [0,0.5,3.5]cm
 *    ≈ the reference's [0,3,9.5] canonical origin), firing along head +Z so
 *    the blast sweeps as the guest turns — parenting does all the work.
 *  - HAND: a world-space group repositioned per frame from the hand rig's
 *    anchor, unprojected at the monocular depth estimate; the flare sits at
 *    the EXACT screen point of the knuckles, so depth error never reads as a
 *    beam floating off the hand. A hand lost mid-blast freezes and fades.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FaceRig } from './FaceRig';
import { getHeadDepthCm } from '../../lib/faceRig';
import { getLatestHandFrame } from '../../lib/handRig';
import { subscribeFx } from '../../lib/studio/fxBus';
import {
  beamPhaseAt,
  estimateHandDepthCm,
  unprojectToDepth,
  type BeamSpec,
} from '../../lib/studio/beam';
import type { AnchorConfig } from '../../types';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Visor-slit origin in head space (see file docblock). */
const HEAD_BEAM_ANCHOR: AnchorConfig = {
  anchor: 'noseBridge',
  offset: { x: 0, y: 0.5, z: 3.5 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1,
};

const MAX_LEN_CM = 160;
const BURST_COUNT = 64;
const BURST_LIFE_MS = 500;

/** Nested layers: [radius cm, base alpha, useCore] — core is white-hot. */
const LAYERS: [number, number, boolean][] = [
  [1.6, 0.95, true],
  [3.6, 0.5, false],
  [6.5, 0.24, false],
];

const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Length fade + scroll noise + flicker. v=0 at the muzzle, 1 at the tip. */
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uScroll;
  uniform float uJitter;
  varying vec2 vUv;
  void main() {
    float v = vUv.y;
    float lengthFade = pow(1.0 - v, 1.35);
    float scroll = 0.85 + 0.15 * sin(v * 42.0 - uTime * uScroll);
    float flicker = 0.9 + 0.1 * sin(uTime * 82.0) + uJitter * (fract(sin(uTime * 913.7 + v * 57.0) * 43758.5) - 0.5);
    float a = uAlpha * uIntensity * lengthFade * scroll * flicker;
    gl_FragColor = vec4(uColor * (0.6 + 0.9 * uIntensity), a);
  }
`;

const FLARE_VERT = BEAM_VERT;
const FLARE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float d = distance(vUv, vec2(0.5));
    float core = smoothstep(0.18, 0.0, d);
    float halo = smoothstep(0.5, 0.05, d);
    vec3 c = mix(uColor, vec3(1.0), core * 0.85);
    gl_FragColor = vec4(c * (0.5 + uIntensity), (core + halo * 0.55) * uIntensity);
  }
`;

const BURST_VERT = /* glsl */ `
  attribute vec3 aDir;
  attribute float aSpeed;
  attribute float aSize;
  uniform float uProgress;
  varying float vFade;
  void main() {
    float eased = 1.0 - pow(1.0 - uProgress, 3.0);
    vec3 p = position + aDir * aSpeed * eased;
    vFade = 1.0 - uProgress;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (140.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const BURST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.05, d) * vFade;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35 * vFade), a);
  }
`;

interface BoltHandles {
  group: THREE.Group;
  beamMats: THREE.ShaderMaterial[];
  beamPivot: THREE.Group;
  flareMat: THREE.ShaderMaterial;
  flare: THREE.Mesh;
  burstMat: THREE.ShaderMaterial;
  burst: THREE.Points;
}

/** Build one bolt's object tree imperatively (mounted once, updated per frame). */
function buildBolt(): BoltHandles {
  const group = new THREE.Group();
  group.visible = false;

  const beamPivot = new THREE.Group();
  // Cylinder axis is +Y; rotate so the bolt extends along LOCAL +Z.
  beamPivot.rotation.x = Math.PI / 2;
  group.add(beamPivot);

  const beamMats: THREE.ShaderMaterial[] = [];
  for (const [radius, alpha, core] of LAYERS) {
    const geo = new THREE.CylinderGeometry(radius * 0.55, radius, 1, 14, 1, true);
    // Shift so the base sits at the pivot (y 0..1 → scaled to length).
    geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color('#ff2b4a') },
        uAlpha: { value: alpha },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        uScroll: { value: 26 },
        uJitter: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    // uColor is swapped to the core colour for the innermost layer at fire time.
    (mat as unknown as { __core: boolean }).__core = core;
    beamMats.push(mat);
    beamPivot.add(new THREE.Mesh(geo, mat));
  }

  const flareMat = new THREE.ShaderMaterial({
    vertexShader: FLARE_VERT,
    fragmentShader: FLARE_FRAG,
    uniforms: { uColor: { value: new THREE.Color('#ff2b4a') }, uIntensity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const flare = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), flareMat);
  group.add(flare);

  const positions = new Float32Array(BURST_COUNT * 3);
  const dirs = new Float32Array(BURST_COUNT * 3);
  const speeds = new Float32Array(BURST_COUNT);
  const sizes = new Float32Array(BURST_COUNT);
  for (let i = 0; i < BURST_COUNT; i++) {
    const a = (i / BURST_COUNT) * Math.PI * 2;
    // Radial in the camera plane with slight depth jitter — the reference's
    // eruption burst. Deterministic by index (no Math.random in render path).
    const r = 0.85 + 0.3 * Math.sin(i * 12.9898);
    dirs[i * 3] = Math.cos(a) * r;
    dirs[i * 3 + 1] = Math.sin(a) * r;
    dirs[i * 3 + 2] = 0.3 * Math.sin(i * 78.233);
    speeds[i] = 30 + 26 * Math.abs(Math.sin(i * 3.7));
    sizes[i] = 2 + 2.4 * Math.abs(Math.sin(i * 1.3));
  }
  const burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  burstGeo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
  burstGeo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  burstGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const burstMat = new THREE.ShaderMaterial({
    vertexShader: BURST_VERT,
    fragmentShader: BURST_FRAG,
    uniforms: { uColor: { value: new THREE.Color('#ff2b4a') }, uProgress: { value: 1 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const burst = new THREE.Points(burstGeo, burstMat);
  burst.visible = false;
  group.add(burst);

  return { group, beamMats, beamPivot, flareMat, flare, burstMat, burst };
}

interface ActiveBeam {
  spec: BeamSpec;
  /** Frozen hand origin/direction (world cm) once tracking is lost mid-blast. */
  frozen: boolean;
}

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quatTarget = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);

/** Per-frame drive of one bolt from its active spec. Returns false when done. */
function driveBolt(bolt: BoltHandles, active: ActiveBeam | null, now: number, reduced: boolean): boolean {
  if (active === null) {
    bolt.group.visible = false;
    return false;
  }
  const { spec } = active;
  const phase = beamPhaseAt(spec, now);
  if (phase.phase === 'done') {
    bolt.group.visible = false;
    return false;
  }
  bolt.group.visible = true;
  const intensity = reduced ? Math.min(0.6, phase.intensity) : phase.intensity;
  const len = phase.length01 * (spec.style === 'sparkle' ? MAX_LEN_CM * 0.7 : MAX_LEN_CM);
  const t = (now - spec.startedAt) / 1000;
  const styleScroll = spec.style === 'sparkle' ? 60 : spec.style === 'lightning' ? 14 : 26;
  const jitter = !reduced && spec.style === 'lightning' ? 0.5 : 0;
  const radiusScale = spec.style === 'sparkle' ? 0.55 : spec.style === 'lightning' ? 0.7 : 1;

  bolt.beamPivot.scale.set(radiusScale, len > 0.001 ? len : 0.001, radiusScale);
  bolt.beamPivot.visible = phase.length01 > 0.001;
  for (const mat of bolt.beamMats) {
    const isCore = (mat as unknown as { __core: boolean }).__core;
    (mat.uniforms.uColor.value as THREE.Color).set(isCore ? spec.coreHex : spec.colorHex);
    mat.uniforms.uIntensity.value = intensity;
    mat.uniforms.uTime.value = t;
    mat.uniforms.uScroll.value = styleScroll;
    mat.uniforms.uJitter.value = jitter;
  }
  (bolt.flareMat.uniforms.uColor.value as THREE.Color).set(spec.colorHex);
  bolt.flareMat.uniforms.uIntensity.value = intensity * (phase.phase === 'charge' ? 0.8 : 1);
  // Muzzle tremble during fire — the reference's ±0.35cm positional shake.
  if (!reduced && (phase.phase === 'fire' || phase.phase === 'hold')) {
    bolt.flare.position.set(
      Math.sin(now * 0.09) * 0.3,
      Math.cos(now * 0.117) * 0.3,
      0,
    );
  } else {
    bolt.flare.position.set(0, 0, 0);
  }

  // Eruption burst runs for BURST_LIFE_MS from the fire boundary.
  const sinceFire = now - (spec.startedAt + spec.chargeMs);
  if (sinceFire >= 0 && sinceFire < BURST_LIFE_MS && !reduced) {
    bolt.burst.visible = true;
    (bolt.burstMat.uniforms.uColor.value as THREE.Color).set(spec.colorHex);
    bolt.burstMat.uniforms.uProgress.value = sinceFire / BURST_LIFE_MS;
  } else {
    bolt.burst.visible = false;
  }
  return true;
}

export interface BeamFXProps {
  mirror: boolean;
  videoId: string;
  /**
   * Preview surfaces with no tracked face (the Power-Ups builder's bust): head
   * beams render from a fixed head-ish origin instead of a FaceRig. The booth
   * never sets this.
   */
  staticHead?: boolean;
}

export default function BeamFX({ mirror, videoId, staticHead = false }: BeamFXProps) {
  const headBolt = useMemo(buildBolt, []);
  const handBolt = useMemo(buildBolt, []);
  const flashMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ff2b4a',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const reduced = useMemo(prefersReducedMotion, []);

  const headActive = useRef<ActiveBeam | null>(null);
  const handActive = useRef<ActiveBeam | null>(null);
  const handAspect = useRef(9 / 16);

  useEffect(() => {
    return subscribeFx((e) => {
      if (e.kind !== 'beam') return;
      const slot = e.spec.origin === 'hand' ? handActive : headActive;
      slot.current = { spec: e.spec, frozen: false };
    });
  }, []);

  useFrame(() => {
    const now = performance.now();
    driveBolt(headBolt, headActive.current, now, reduced);
    if (headActive.current !== null && beamPhaseAt(headActive.current.spec, now).phase === 'done') {
      headActive.current = null;
    }

    // Hand bolt: reposition from the live hand anchor while tracked.
    const active = handActive.current;
    if (active !== null) {
      const frame = getLatestHandFrame();
      const anchor = frame?.anchor ?? null;
      if (anchor !== null && !active.frozen) {
        const video = document.getElementById(videoId) as HTMLVideoElement | null;
        if (video && video.videoWidth > 0 && video.videoHeight > 0) {
          handAspect.current = video.videoWidth / video.videoHeight;
        }
        const nx = mirror ? 1 - anchor.originX : anchor.originX;
        const depth = estimateHandDepthCm(anchor.spanNorm, getHeadDepthCm());
        const [x, y, z] = unprojectToDepth(nx, anchor.originY, depth, 63, handAspect.current);
        _origin.set(x, y, z);
        // Palm normal: MediaPipe world axes (x right, y down, z away) → three
        // camera axes via (x, −y, −z); mirrored preview also flips x.
        _dir.set(
          mirror ? -anchor.normal[0] : anchor.normal[0],
          -anchor.normal[1],
          -anchor.normal[2],
        );
        // Blend toward the camera so the blast reads on screen even edge-on.
        _dir.multiplyScalar(0.65).addScaledVector(_origin.clone().negate().normalize(), 0.35);
        if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
        _dir.normalize();
        handBolt.group.position.copy(_origin);
        _quatTarget.setFromUnitVectors(_zAxis, _dir);
        handBolt.group.quaternion.slerp(_quatTarget, 0.35);
      } else if (anchor === null) {
        // Hand gone mid-blast: freeze in place and let the envelope fade it.
        active.frozen = true;
      }
    }
    driveBolt(handBolt, active, now, reduced);
    if (active !== null && beamPhaseAt(active.spec, now).phase === 'done') {
      handActive.current = null;
    }

    // Full-frame flash: max across both emitters, zero under reduced motion.
    let flash = 0;
    let flashHex = '#ff2b4a';
    for (const a of [headActive.current, handActive.current]) {
      if (a === null) continue;
      const p = beamPhaseAt(a.spec, now);
      if (p.flash > flash) {
        flash = p.flash;
        flashHex = a.spec.colorHex;
      }
    }
    flashMat.opacity = reduced ? 0 : flash * 0.42;
    if (flash > 0) flashMat.color.set(flashHex);
  });

  // Keep flare + flash facing the camera (camera is fixed at the origin).
  useEffect(() => {
    headBolt.flare.lookAt(0, 0, 0);
    handBolt.flare.lookAt(0, 0, 0);
  }, [headBolt, handBolt]);

  return (
    <>
      {staticHead ? (
        <group position={[0, 3, -42]}>
          <primitive object={headBolt.group} />
        </group>
      ) : (
        <FaceRig videoId={videoId} anchor="noseBridge" config={HEAD_BEAM_ANCHOR} mirror={mirror}>
          <primitive object={headBolt.group} />
        </FaceRig>
      )}
      <primitive object={handBolt.group} />
      {/* Full-frame eruption flash, parented to the (fixed) camera frustum:
          a 1.2cm-away plane large enough to cover any aspect. */}
      <mesh position={[0, 0, -1.2]} material={flashMat}>
        <planeGeometry args={[4, 3]} />
      </mesh>
    </>
  );
}
