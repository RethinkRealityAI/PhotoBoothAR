/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Living Face Paint — a procedural texture on the tracked 8th Wall face MESH, so
 * it stretches when the guest smiles, stays put when they turn, and sits under
 * every head prop in depth.
 *
 * HOW IT FITS THE RIG
 *  - Its own tracked group, posed by the SAME `updateHeadPose` every FaceRig
 *    uses (the platform's ONE shared filtered pose), but WITHOUT an anchor
 *    offset: the mesh vertices already are head-local centimetres.
 *  - Geometry is built ONCE from the live topology; every frame the position
 *    attribute is rewritten IN PLACE from getTrackedFaceMesh() — no allocation
 *    on the frame path. Normals are recomputed in place (the material is lit, so
 *    paint shades with the face like real pigment does).
 *  - Mirrored preview: the head group renders M·P·M (faceRig reflects the
 *    POSE), so vertex i is fed the reflected position of its uv-mirror partner
 *    (features.mirrorPairs). The paint then lands on the guest's real skin and
 *    — because every vertex keeps its own uv — a logo or lettering reads the
 *    right way round on screen and in the saved photo, mirror on or off.
 *  - Depth: drawn in the OPAQUE pass at renderOrder −3 (CustomBlending keeps
 *    alpha without moving it to the transparent pass, which would sort it after
 *    the depth-only FaceOccluder at −2 and let the occluder swallow it). It
 *    writes depth at the skin, so props in front cover it and the occluder still
 *    hides props behind the head.
 *  - No mesh (MediaPipe mode, a fallback, no face, or a stale sample) ⇒ the
 *    group is hidden. Never a frozen or misplaced face.
 *
 * Lazily loaded (React.lazy) by every mount, so neither this file nor the
 * painter can enter a bundle that never shows face paint — including the
 * frozen legacy sites.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { updateHeadPose } from '../../lib/faceRig';
import { getTrackedFaceMesh, getTrackedFaceMeshTopology, getTrackedFrameSource } from '../../lib/faceEngine';
import { FACE_LANDMARKS, faceFrameFromUvs, frameUvFromNdc, mirrorPairs, outerRingDistance } from '../../lib/facePaint/features';
import { FACE_PAINT_DESIGN_MAP } from '../../lib/facePaint/designs';
import { paintFacePaint, type LogoImage } from '../../lib/facePaint/painter';
import { facePaintKey, hasFacePaintPigment, isSafeLogoUrl, type FacePaintSpec } from '../../lib/facePaint/spec';
import ContactLensLayer from './ContactLensLayer';

/** Texture side. 1024 keeps strokes crisp at a 1080×1920 capture (the face is ~600px wide there). */
export const FACE_PAINT_TEXTURE_PX = 1024;
/** A mesh sample older than this is a lost face, not a slow one: hide. */
const STALE_MESH_MS = 300;
/** Short side of the downscaled camera copy the paint samples skin from. */
const SKIN_PX = 240;
/** Short side of the tiny copy read back to measure the face's mean skin tone. */
const REF_PX = 48;
/** How often the reference skin tone is re-measured (it drifts slowly). */
const REF_EVERY_MS = 250;
/** Rings of mesh over which the outer silhouette fades (outerRingDistance). */
const FEATHER_RINGS = 2.5;
const MAX_RINGS = 4;
/** Skin landmarks the reference tone is measured on (median of these). */
const REF_LANDMARKS = [
  FACE_LANDMARKS.cheekL, FACE_LANDMARKS.cheekR, FACE_LANDMARKS.foreheadMid, FACE_LANDMARKS.browMid,
  FACE_LANDMARKS.cheekboneL, FACE_LANDMARKS.cheekboneR, FACE_LANDMARKS.underEyeL, FACE_LANDMARKS.underEyeR,
  FACE_LANDMARKS.noseBridge,
];

/*
 * Pigment, not a rubber mask. Each paint pixel is multiplied by the guest's
 * OWN skin luminance at that pixel relative to their mean skin tone (sampled
 * from the very camera frame the compositor draws underneath), so cheekbone
 * highlights, under-eye shadow and skin texture carry through the paint. The
 * ratio is taken on gamma-encoded values, which equals the linear-light ratio
 * raised to 1/2.2 — the same multiply a real pigment layer applies. The outer
 * silhouette fades over FEATHER_RINGS mesh rings, so a full-face look melts
 * into the hairline and jaw. Everything here is drawn INTO the 3D canvas, so
 * the StageCanvas composite (photo and video) carries exactly these pixels.
 */
const PAINT_VERT = `
attribute float aEdge;
varying vec2 vUv;
varying float vEdge;
varying vec3 vNormalV;
varying vec2 vNdc;
void main() {
  vUv = uv;
  vEdge = aEdge;
  vNormalV = normalize(normalMatrix * normal);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vNdc = p.xy / p.w;
  gl_Position = p;
}`;
const PAINT_FRAG = `
uniform sampler2D uPaint;
uniform sampler2D uSkin;
uniform float uOpacity;
uniform float uShade;
uniform float uHasSkin;
uniform float uRefLum;
uniform float uK;
uniform float uMirror;
uniform float uFeather;
uniform float uShimmer;
uniform float uTime;
varying vec2 vUv;
varying float vEdge;
varying vec3 vNormalV;
varying vec2 vNdc;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec4 p = texture2D(uPaint, vUv);
  float a = p.a * uOpacity * smoothstep(0.0, uFeather, vEdge);
  // Living twinkle (opt-in per DESIGN — designs.ts \`shimmer\`): ~1 in 6 cells of
  // a fixed uv grid holds a glint that pulses on its own phase and speed, only
  // where there is paint. uShimmer 0 takes the original path untouched.
  float glintA = 0.0;
  if (uShimmer > 0.5 && p.a > 0.04) {
    vec2 g = vUv * 120.0;
    vec2 cell = floor(g);
    if (hash(cell) > 0.83) {
      float tw = pow(max(0.0, sin(uTime * (1.2 + 2.0 * hash(cell + 3.1)) + 6.2832 * hash(cell + 7.3))), 10.0);
      float spot = smoothstep(0.45, 0.0, length(fract(g) - 0.5));
      glintA = tw * spot * smoothstep(0.04, 0.3, p.a) * smoothstep(0.0, uFeather, vEdge);
    }
  }
  if (a < 0.004 && glintA < 0.004) discard;
  float shade;
  if (uHasSkin > 0.5) {
    vec2 f = vec2(0.5 + 0.5 * vNdc.x * uK * uMirror, 0.5 + 0.5 * vNdc.y);
    shade = clamp(lum(texture2D(uSkin, f).rgb) / max(uRefLum, 0.03), 0.3, 1.4);
  } else {
    // No camera pixels yet: a soft key light so it is never flat.
    shade = 0.6 + 0.45 * max(dot(normalize(vNormalV), normalize(vec3(0.25, 0.35, 1.0))), 0.0);
  }
  if (uShimmer > 0.5) {
    gl_FragColor = vec4(mix(p.rgb * mix(1.0, shade, uShade), vec3(1.0), glintA), max(a, glintA * 0.9));
  } else {
    gl_FragColor = vec4(p.rgb * mix(1.0, shade, uShade), a);
  }
}`;

interface Topology {
  points: number;
  indices: ArrayLike<number>;
  uvs: ArrayLike<number>;
}

/** Decoded logos, shared across mounts (studio preview + live + booth). */
const logoCache = new Map<string, Promise<LogoImage | null>>();

export function loadFacePaintLogo(url: string): Promise<LogoImage | null> {
  if (!isSafeLogoUrl(url)) return Promise.resolve(null);
  let p = logoCache.get(url);
  if (!p) {
    p = new Promise<LogoImage | null>((resolve) => {
      const img = new Image();
      // Without CORS the texture upload would be refused (a tainted canvas).
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => {
        console.warn('[FacePaint] logo failed to load', url);
        logoCache.delete(url); // let a later mount retry
        resolve(null);
      };
      img.src = url;
    });
    logoCache.set(url, p);
  }
  return p;
}

export default function FacePaintLayer({
  spec,
  videoId,
  mirror = true,
  onVisibilityChange,
}: {
  spec: FacePaintSpec;
  videoId: string;
  mirror?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const visibleRef = useRef<boolean | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [logo, setLogo] = useState<LogoImage | null>(null);

  // The paint canvas + its texture live as long as the layer.
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = FACE_PAINT_TEXTURE_PX;
    return c;
  }, []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    // Sampled raw by the shader (sRGB in, sRGB out — no decode/encode pair).
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);

  const logoUrl = spec.logo?.url ?? null;
  useEffect(() => {
    let alive = true;
    setLogo(null);
    if (logoUrl) void loadFacePaintLogo(logoUrl).then((l) => { if (alive) setLogo(l); });
    return () => { alive = false; };
  }, [logoUrl]);

  // Geometry from the LIVE topology (8th Wall reports it once per session).
  const built = useMemo(() => {
    if (!topology) return null;
    const n = topology.points;
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(topology.uvs), 2));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(topology.indices), 1));
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(outerRingDistance(topology.indices, n, MAX_RINGS), 1));
    return {
      geometry,
      position,
      pairs: mirrorPairs(topology.uvs, topology.indices, n),
      frame: faceFrameFromUvs(topology.uvs, FACE_PAINT_TEXTURE_PX),
    };
  }, [topology]);
  useEffect(() => () => built?.geometry.dispose(), [built]);

  // Repaint only when the LOOK changes (serialized key), never per frame.
  const key = facePaintKey(spec);
  useEffect(() => {
    if (!built) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintFacePaint(ctx, built.frame, spec, { logo });
    texture.needsUpdate = true;
    // `spec` is read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, logo, built, canvas, texture]);

  // Downscaled camera copy the shader reads skin tone from, plus a tiny
  // CPU-readable copy for the reference tone. Both live as long as the layer.
  const skin = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    const r = document.createElement('canvas');
    r.width = r.height = 2;
    return { canvas: c, ctx: c.getContext('2d'), texture: t, ref: r, refCtx: r.getContext('2d', { willReadFrequently: true }) };
  }, []);
  useEffect(() => () => skin.texture.dispose(), [skin]);
  const refState = useRef({ lum: -1, at: 0 });
  const size = useThree((st) => st.size);
  const camera = useThree((st) => st.camera);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: PAINT_VERT,
    fragmentShader: PAINT_FRAG,
    uniforms: {
      uPaint: { value: texture },
      uSkin: { value: skin.texture },
      uOpacity: { value: 1 },
      uShade: { value: 0.6 },
      uHasSkin: { value: 0 },
      uRefLum: { value: 0.5 },
      uK: { value: 1 },
      uMirror: { value: -1 },
      uFeather: { value: FEATHER_RINGS },
      uShimmer: { value: 0 },
      uTime: { value: 0 },
    },
    side: THREE.DoubleSide,
    transparent: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthTest: true,
    depthWrite: true,
    // Rides the skin: wins a tie with the occluder's surface instead of z-fighting it.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  }), [texture, skin]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => { material.uniforms.uOpacity.value = spec.opacity; }, [material, spec.opacity]);
  // Full-face looks take the skin's shading fully; accents keep a lighter touch.
  const fullFace = FACE_PAINT_DESIGN_MAP[spec.design]?.fullFace === true;
  useEffect(() => { material.uniforms.uShade.value = fullFace ? 1 : 0.6; }, [material, fullFace]);
  // Twinkle is a DESIGN property (never a stored-spec field), so every scene
  // saved before it existed keeps uShimmer 0 and the untouched shader path.
  const shimmer = FACE_PAINT_DESIGN_MAP[spec.design]?.shimmer === true;
  useEffect(() => { material.uniforms.uShimmer.value = shimmer ? 1 : 0; }, [material, shimmer]);
  // Reduced motion: the glints hold still (a fixed time), never pulse.
  const reducedMotion = useRef(false);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return; }
    const sync = () => { reducedMotion.current = mq?.matches === true; };
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq?.removeEventListener?.('change', sync);
  }, []);
  const meshRef = useRef<THREE.Mesh>(null);
  const _v = useMemo(() => new THREE.Vector3(), []);
  const _lums = useMemo(() => [] as number[], []);

  /** Copy the frame the compositor draws (tracked frame, else live video) and refresh the tone reference. */
  const sampleSkin = (video: HTMLVideoElement | null) => {
    const u = material.uniforms;
    const src: CanvasImageSource | null = getTrackedFrameSource() ?? (video && video.readyState >= 2 ? video : null);
    const sw = src === null ? 0 : src instanceof HTMLVideoElement ? src.videoWidth : (src as HTMLCanvasElement).width;
    const sh = src === null ? 0 : src instanceof HTMLVideoElement ? src.videoHeight : (src as HTMLCanvasElement).height;
    if (src === null || !(sw > 0) || !(sh > 0) || skin.ctx === null) { u.uHasSkin.value = 0; return; }
    const scale = SKIN_PX / Math.min(sw, sh);
    const w = Math.max(2, Math.round(sw * scale));
    const h = Math.max(2, Math.round(sh * scale));
    if (skin.canvas.width !== w || skin.canvas.height !== h) {
      skin.canvas.width = w;
      skin.canvas.height = h;
      skin.texture.dispose(); // new size → new GPU allocation
    }
    skin.ctx.drawImage(src, 0, 0, w, h);
    skin.texture.needsUpdate = true;
    u.uK.value = size.height > 0 ? (size.width / size.height) / (sw / sh) : 1;
    u.uMirror.value = mirror ? -1 : 1;

    const now = performance.now();
    const st = refState.current;
    const m = meshRef.current;
    if (m !== null && built !== null && skin.refCtx !== null && now - st.at >= REF_EVERY_MS) {
      st.at = now;
      const rs = REF_PX / Math.min(w, h);
      const rw = Math.max(2, Math.round(w * rs)), rh = Math.max(2, Math.round(h * rs));
      if (skin.ref.width !== rw || skin.ref.height !== rh) { skin.ref.width = rw; skin.ref.height = rh; }
      skin.refCtx.drawImage(skin.canvas, 0, 0, rw, rh);
      const px = skin.refCtx.getImageData(0, 0, rw, rh).data;
      const pos = built.position.array as Float32Array;
      _lums.length = 0;
      for (const i of REF_LANDMARKS) {
        if (i * 3 + 2 >= pos.length) continue;
        _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(m.matrixWorld).project(camera);
        const f = frameUvFromNdc(_v.x, _v.y, size.width / size.height, sw / sh, mirror);
        const x = Math.floor(f.u * rw), y = Math.floor((1 - f.v) * rh);
        if (x < 0 || y < 0 || x >= rw || y >= rh) continue;
        const o = (y * rw + x) * 4;
        _lums.push((0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]) / 255);
      }
      if (_lums.length >= 3) {
        _lums.sort((x, y) => x - y);
        const med = _lums[_lums.length >> 1];
        st.lum = st.lum < 0 ? med : st.lum + (med - st.lum) * 0.3;
      }
    }
    if (st.lum > 0) { u.uRefLum.value = st.lum; u.uHasSkin.value = 1; } else u.uHasSkin.value = 0;
  };

  useFrame((st) => {
    const g = group.current;
    if (!g) return;
    if (shimmer) material.uniforms.uTime.value = reducedMotion.current ? 0 : st.clock.elapsedTime;
    if (!topology) {
      const t = getTrackedFaceMeshTopology();
      if (t) setTopology({ points: t.pointsPerDetection, indices: t.indices, uvs: t.uvs });
    }
    const video = document.getElementById(videoId) as HTMLVideoElement | null;
    const posed = video ? updateHeadPose(g, video, mirror) : false;
    const mesh = posed && built ? getTrackedFaceMesh() : null;
    const fresh = mesh !== null && performance.now() - mesh.t <= STALE_MESH_MS;
    if (fresh && built) {
      const v = mesh.vertices;
      const out = built.position.array as Float32Array;
      const n = Math.min(out.length, v.length) / 3;
      if (mirror) {
        const pairs = built.pairs;
        for (let i = 0; i < n; i++) {
          const p = pairs[i] * 3;
          out[i * 3] = -v[p];
          out[i * 3 + 1] = v[p + 1];
          out[i * 3 + 2] = v[p + 2];
        }
      } else {
        for (let i = 0; i < n * 3; i++) out[i] = v[i];
      }
      built.position.needsUpdate = true;
      built.geometry.computeVertexNormals();
    }
    if (fresh && built) sampleSkin(video);
    g.visible = fresh;
    // Reports the FACE (head pose), not the paint: after a fallback to
    // MediaPipe there is no mesh, but the guest's face is still found and the
    // booth must not coach "center your face" at someone already centred.
    if (posed !== visibleRef.current) {
      visibleRef.current = posed;
      onVisibilityChange?.(posed);
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* A contacts-only look has no pigment: skip the (empty) paint mesh. */}
      {built && hasFacePaintPigment(spec) && (
        <mesh ref={meshRef} geometry={built.geometry} material={material} renderOrder={-3} frustumCulled={false} />
      )}
      {/* Coloured Contacts ride this tracked group (same pose, same "fresh mesh or hidden" rule). */}
      {built && spec.eyes && <ContactLensLayer spec={spec.eyes} videoId={videoId} mirror={mirror} />}
    </group>
  );
}
