/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Coloured Contacts — a lens on each tracked iris.
 *
 * HOW IT FITS THE RIG
 *  - Mounted by FacePaintLayer INSIDE its tracked group, so it shares that
 *    group's pose (the platform's one shared head pose), its "no fresh face
 *    mesh ⇒ hidden" rule and its lazy bundle. Vertices are head-local cm.
 *  - Geometry: per eye, a fan of triangles from the eyelid outline to its
 *    centre, rewritten in place every frame (lens.writeEyeFan). The lens can
 *    only ever draw inside the eye opening, so a blink, a squint or a lowered
 *    lid hides it the way it hides a real lens. The rim fades (aEdge), which
 *    reads as the lid's own shadow and forgives a landmark that is a pixel off.
 *  - The lens itself is a small texture painted ONCE per look by the pure
 *    lens.paintLensTexture (the studio builder previews with the same painter),
 *    placed by the tracked iris centre and radius.
 *  - It is a lens, not a sticker: each pixel is multiplied by the real eye's
 *    own brightness there (relative to that iris's typical brightness, read
 *    from a small crop of the camera frame the compositor draws underneath),
 *    and the catchlight is kept. So the gaze, the wet highlight and the lid
 *    shadow all survive.
 *  - Drawn in the opaque pass at renderOrder −3 like the paint (before the
 *    depth-only FaceOccluder), writing depth, so glasses and hats in front
 *    still cover it. Everything is in the 3D canvas, so photos and videos
 *    carry exactly these pixels.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getTrackedFaceMesh, getTrackedFrameSource } from '../../lib/faceEngine';
import { frameUvFromNdc } from '../../lib/facePaint/features';
import {
  CONTACT_STYLE_MAP, EYES, EYE_FAN_VERTS, LENS_SPAN, LENS_TEXTURE_PX,
  eyeFanIndices, hexToRgb, paintLensTexture, writeEyeFan, type IrisSample,
} from '../../lib/contacts/lens';
import { contactsKey, type ContactLensSpec } from '../../lib/contacts/spec';

/** The lens sits a touch past the iris edge, like a real one. */
const LENS_OVERSIZE = 1.08;
/** Camera crop the lens reads the real eye from (both eyes, side by side). */
const CROP_W = 192;
const CROP_H = 96;
const REF_EVERY_MS = 250;
/** Fraction of the fan (rim 0 → centre 1) over which the lens fades in at the lids. */
const LID_FEATHER = 0.2;
const FULL_EYE_FEATHER = 0.07;
/** Halo quad half-size, in lens radii (glow styles only). */
const HALO_RADII = 3.2;
/** Follow rate of the iris relative to its eye, per mesh sample (1 = raw). */
const IRIS_FOLLOW = 0.6;
const RADIUS_FOLLOW = 0.12;

const LENS_VERT = `
attribute float aEdge;
attribute float aEye;
varying vec3 vPos;
varying float vEdge;
varying float vEye;
varying vec2 vNdc;
void main() {
  vPos = position;
  vEdge = aEdge;
  vEye = aEye;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vNdc = p.xy / p.w;
  gl_Position = p;
}`;
const LENS_FRAG = `
uniform sampler2D uLens;
uniform sampler2D uCam;
uniform vec4 uIris[2];
uniform vec4 uCrop;
uniform vec3 uFullColor;
uniform float uOpacity;
uniform float uFeather;
uniform float uShade;
uniform float uFull;
uniform float uGlow;
uniform float uTime;
uniform float uHasCam;
uniform float uRefLum;
uniform float uK;
uniform float uMirror;
varying vec3 vPos;
varying float vEdge;
varying float vEye;
varying vec2 vNdc;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec4 iris = vEye < 0.5 ? uIris[0] : uIris[1];
  vec2 q = (vPos.xy - iris.xy) / max(iris.w, 0.01);
  vec2 luv = vec2(0.5 + 0.5 * q.x / ${LENS_SPAN.toFixed(4)}, 0.5 - 0.5 * q.y / ${LENS_SPAN.toFixed(4)});
  vec4 lens = vec4(0.0);
  if (luv.x >= 0.0 && luv.x <= 1.0 && luv.y >= 0.0 && luv.y <= 1.0) lens = texture2D(uLens, luv);
  if (uFull > 0.5) lens = mix(vec4(uFullColor, 1.0), vec4(lens.rgb, 1.0), lens.a * (1.0 - smoothstep(0.98, 1.08, length(q))));
  float a = lens.a * uOpacity * smoothstep(0.0, uFeather, vEdge);
  if (a < 0.004) discard;
  vec3 rgb = lens.rgb;
  if (uHasCam > 0.5) {
    vec2 f = vec2(0.5 + 0.5 * vNdc.x * uK * uMirror, 0.5 + 0.5 * vNdc.y);
    float L = lum(texture2D(uCam, (f - uCrop.xy) * uCrop.zw).rgb);
    float rel = L / max(uRefLum, 0.1);
    rgb *= mix(1.0, clamp(rel, 0.45, 1.6), uShade);
    // The wet highlight: much brighter than the iris AND bright in absolute terms.
    rgb = mix(rgb, vec3(1.0), 0.85 * smoothstep(0.6, 0.88, L) * smoothstep(1.5, 2.3, rel));
  }
  if (uGlow > 0.5) rgb *= 1.18 + 0.16 * sin(uTime * 2.4);
  gl_FragColor = vec4(rgb, a);
}`;
const HALO_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const HALO_FRAG = `
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float g = exp(-d * d * 5.5) * (1.0 - smoothstep(0.75, 1.0, d));
  float a = g * uStrength * (0.85 + 0.15 * sin(uTime * 2.4));
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

interface IrisState { ox: number; oy: number; r: number; primed: boolean }

export default function ContactLensLayer({ spec, videoId, mirror = true }: { spec: ContactLensSpec; videoId: string; mirror?: boolean }) {
  const style = CONTACT_STYLE_MAP[spec.style];
  const size = useThree((st) => st.size);
  const camera = useThree((st) => st.camera);
  const meshRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);

  // ── Lens texture: repainted only when the look changes. ──
  const lensTexture = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(LENS_TEXTURE_PX * LENS_TEXTURE_PX * 4), LENS_TEXTURE_PX, LENS_TEXTURE_PX, THREE.RGBAFormat);
    // Sampled raw (sRGB in, sRGB out), like the face paint.
    t.colorSpace = THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    return t;
  }, []);
  useEffect(() => () => lensTexture.dispose(), [lensTexture]);
  const key = contactsKey(spec);
  useEffect(() => {
    paintLensTexture(lensTexture.image.data as Uint8Array, LENS_TEXTURE_PX, spec);
    lensTexture.needsUpdate = true;
    // `spec` is read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lensTexture]);

  // ── Geometry: two eye fans, positions rewritten in place each frame. ──
  const built = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(EYE_FAN_VERTS * 2 * 3), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    const edge = new Float32Array(EYE_FAN_VERTS * 2);
    const eye = new Float32Array(EYE_FAN_VERTS * 2);
    edge[0] = 1; edge[EYE_FAN_VERTS] = 1;
    for (let i = EYE_FAN_VERTS; i < EYE_FAN_VERTS * 2; i++) eye[i] = 1;
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    geometry.setAttribute('aEye', new THREE.BufferAttribute(eye, 1));
    geometry.setIndex([...eyeFanIndices(0), ...eyeFanIndices(EYE_FAN_VERTS)]);

    const halo = new THREE.BufferGeometry();
    const haloPos = new THREE.BufferAttribute(new Float32Array(8 * 3), 3);
    haloPos.setUsage(THREE.DynamicDrawUsage);
    halo.setAttribute('position', haloPos);
    halo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]), 2));
    halo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    return { geometry, position, halo, haloPos };
  }, []);
  useEffect(() => () => { built.geometry.dispose(); built.halo.dispose(); }, [built]);

  // ── Camera crop of the eyes (GPU texture + CPU-readable for the reference tone). ──
  const cam = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = CROP_W;
    c.height = CROP_H;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }), texture: t };
  }, []);
  useEffect(() => () => cam.texture.dispose(), [cam]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    uniforms: {
      uLens: { value: lensTexture },
      uCam: { value: cam.texture },
      uIris: { value: [new THREE.Vector4(0, 0, 0, 0.6), new THREE.Vector4(0, 0, 0, 0.6)] },
      uCrop: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFullColor: { value: new THREE.Vector3(0, 0, 0) },
      uOpacity: { value: 1 },
      uFeather: { value: LID_FEATHER },
      uShade: { value: 0.6 },
      uFull: { value: 0 },
      uGlow: { value: 0 },
      uTime: { value: 0 },
      uHasCam: { value: 0 },
      uRefLum: { value: 0.3 },
      uK: { value: 1 },
      uMirror: { value: -1 },
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
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  }), [lensTexture, cam]);
  useEffect(() => () => material.dispose(), [material]);

  const haloMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) }, uStrength: { value: 0.5 }, uTime: { value: 0 } },
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthTest: true,
    depthWrite: false,
  }), []);
  useEffect(() => () => haloMaterial.dispose(), [haloMaterial]);

  // Look → uniforms.
  useEffect(() => {
    const u = material.uniforms;
    u.uOpacity.value = spec.opacity;
    u.uShade.value = style?.shade ?? 0.6;
    u.uFull.value = style?.fullEye === true ? 1 : 0;
    // A full-eye look has to reach the corners; an iris lens fades softly under the lids.
    u.uFeather.value = style?.fullEye === true ? FULL_EYE_FEATHER : LID_FEATHER;
    u.uGlow.value = style?.glow === true ? 1 : 0;
    const c0 = hexToRgb(spec.colors[0]) ?? hexToRgb(style?.slots[0].default) ?? [0, 0, 0];
    (u.uFullColor.value as THREE.Vector3).set(c0[0], c0[1], c0[2]);
    (haloMaterial.uniforms.uColor.value as THREE.Vector3).set(c0[0], c0[1], c0[2]);
    haloMaterial.uniforms.uStrength.value = 0.55 * spec.opacity;
    // `spec`/`style` are read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, material, haloMaterial]);

  // Reduced motion: a glow holds steady, never pulses.
  const reducedMotion = useRef(false);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return; }
    const sync = () => { reducedMotion.current = mq?.matches === true; };
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq?.removeEventListener?.('change', sync);
  }, []);

  const irisState = useRef<[IrisState, IrisState]>([{ ox: 0, oy: 0, r: 0.6, primed: false }, { ox: 0, oy: 0, r: 0.6, primed: false }]);
  const lastMeshT = useRef(-1);
  const refState = useRef({ lum: -1, at: 0 });
  const _iris = useMemo<IrisSample>(() => ({ x: 0, y: 0, z: 0, r: 0.6 }), []);
  const _v = useMemo(() => new THREE.Vector3(), []);
  const _lums = useMemo(() => [] as number[], []);

  /** Crop the eyes out of the frame the compositor draws and refresh the iris reference tone. */
  const sampleCamera = (video: HTMLVideoElement | null, m: THREE.Mesh) => {
    const u = material.uniforms;
    const src: CanvasImageSource | null = getTrackedFrameSource() ?? (video && video.readyState >= 2 ? video : null);
    const sw = src === null ? 0 : src instanceof HTMLVideoElement ? src.videoWidth : (src as HTMLCanvasElement).width;
    const sh = src === null ? 0 : src instanceof HTMLVideoElement ? src.videoHeight : (src as HTMLCanvasElement).height;
    if (src === null || !(sw > 0) || !(sh > 0) || cam.ctx === null || !(size.height > 0)) { u.uHasCam.value = 0; return; }
    const canvasAspect = size.width / size.height;
    const frameAspect = sw / sh;
    const pos = built.position.array as Float32Array;
    // Frame-uv box around both eyes (fan centres + eye corners), padded.
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const i of [0, 1, 9, EYE_FAN_VERTS, EYE_FAN_VERTS + 1, EYE_FAN_VERTS + 9]) {
      _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(m.matrixWorld).project(camera);
      const f = frameUvFromNdc(_v.x, _v.y, canvasAspect, frameAspect, mirror);
      if (f.u < u0) u0 = f.u;
      if (f.u > u1) u1 = f.u;
      if (f.v < v0) v0 = f.v;
      if (f.v > v1) v1 = f.v;
    }
    if (!Number.isFinite(u0 + u1 + v0 + v1)) { u.uHasCam.value = 0; return; }
    const padU = 0.18 * (u1 - u0) + 0.004;
    // An eye is about a quarter as tall as the pair is wide (v is in frame HEIGHTS).
    const padV = 0.22 * (u1 - u0) * frameAspect + 0.004;
    u0 = Math.max(0, u0 - padU); u1 = Math.min(1, u1 + padU);
    v0 = Math.max(0, v0 - padV); v1 = Math.min(1, v1 + padV);
    const du = u1 - u0, dv = v1 - v0;
    if (!(du > 0.002) || !(dv > 0.002)) { u.uHasCam.value = 0; return; }
    try {
      cam.ctx.drawImage(src, u0 * sw, (1 - v1) * sh, du * sw, dv * sh, 0, 0, CROP_W, CROP_H);
    } catch {
      u.uHasCam.value = 0; // a frame source that cannot be drawn this tick: shade flat, never throw
      return;
    }
    cam.texture.needsUpdate = true;
    (u.uCrop.value as THREE.Vector4).set(u0, v0, 1 / du, 1 / dv);
    u.uK.value = canvasAspect / frameAspect;
    u.uMirror.value = mirror ? -1 : 1;

    const now = performance.now();
    const st = refState.current;
    if (now - st.at >= REF_EVERY_MS) {
      st.at = now;
      let px: Uint8ClampedArray | null = null;
      try { px = cam.ctx.getImageData(0, 0, CROP_W, CROP_H).data; } catch { px = null; }
      if (px) {
        const irises = u.uIris.value as THREE.Vector4[];
        _lums.length = 0;
        // Eight points at 0.7 of each iris radius: the iris itself, clear of pupil and lid.
        for (let e = 0; e < 2; e++) {
          const ir = irises[e];
          const z = pos[e * EYE_FAN_VERTS * 3 + 2];
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            _v.set(ir.x + Math.cos(a) * ir.w * 0.65, ir.y + Math.sin(a) * ir.w * 0.65, z).applyMatrix4(m.matrixWorld).project(camera);
            const f = frameUvFromNdc(_v.x, _v.y, canvasAspect, frameAspect, mirror);
            const x = Math.floor(((f.u - u0) / du) * CROP_W), y = Math.floor((1 - (f.v - v0) / dv) * CROP_H);
            if (x < 0 || y < 0 || x >= CROP_W || y >= CROP_H) continue;
            const o = (y * CROP_W + x) * 4;
            _lums.push((0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]) / 255);
          }
        }
        if (_lums.length >= 5) {
          _lums.sort((p, q) => p - q);
          const med = _lums[_lums.length >> 1];
          st.lum = st.lum < 0 ? med : st.lum + (med - st.lum) * 0.3;
        }
      }
    }
    if (st.lum > 0) { u.uRefLum.value = st.lum; u.uHasCam.value = 1; } else u.uHasCam.value = 0;
  };

  useFrame((st) => {
    const m = meshRef.current;
    if (!m) return;
    const t = reducedMotion.current ? 0 : st.clock.elapsedTime;
    material.uniforms.uTime.value = t;
    haloMaterial.uniforms.uTime.value = t;
    const mesh = style ? getTrackedFaceMesh() : null;
    const pos = built.position.array as Float32Array;
    const irises = material.uniforms.uIris.value as THREE.Vector4[];
    let ok = mesh !== null;
    if (mesh !== null) {
      const fresh = mesh.t !== lastMeshT.current;
      lastMeshT.current = mesh.t;
      const eyes = [EYES.right, EYES.left];
      for (let e = 0; e < 2 && ok; e++) {
        const off = e * EYE_FAN_VERTS * 3;
        ok = writeEyeFan(mesh.vertices, eyes[e], mirror, pos, off, _iris);
        if (!ok) break;
        // The iris is followed RELATIVE to its eye, so head motion stays raw
        // (locked to the frame) and only the gaze is lightly smoothed.
        const s = irisState.current[e];
        const ox = _iris.x - pos[off], oy = _iris.y - pos[off + 1];
        if (!s.primed) { s.ox = ox; s.oy = oy; s.r = _iris.r; s.primed = true; }
        else if (fresh) {
          s.ox += (ox - s.ox) * IRIS_FOLLOW;
          s.oy += (oy - s.oy) * IRIS_FOLLOW;
          s.r += (_iris.r - s.r) * RADIUS_FOLLOW;
        }
        irises[e].set(pos[off] + s.ox, pos[off + 1] + s.oy, pos[off + 2], s.r * spec.size * LENS_OVERSIZE);
      }
    }
    m.visible = ok;
    const halo = haloRef.current;
    const glow = style?.glow === true;
    if (halo) halo.visible = ok && glow;
    if (!ok) {
      irisState.current[0].primed = false;
      irisState.current[1].primed = false;
      return;
    }
    built.position.needsUpdate = true;
    if (glow) {
      const hp = built.haloPos.array as Float32Array;
      for (let e = 0; e < 2; e++) {
        const ir = irises[e];
        const h = ir.w * HALO_RADII;
        const z = ir.z + 0.5; // just proud of the lids, so it spills softly over them
        const o = e * 12;
        hp[o] = ir.x - h; hp[o + 1] = ir.y - h; hp[o + 2] = z;
        hp[o + 3] = ir.x + h; hp[o + 4] = ir.y - h; hp[o + 5] = z;
        hp[o + 6] = ir.x + h; hp[o + 7] = ir.y + h; hp[o + 8] = z;
        hp[o + 9] = ir.x - h; hp[o + 10] = ir.y + h; hp[o + 11] = z;
      }
      built.haloPos.needsUpdate = true;
    }
    sampleCamera(document.getElementById(videoId) as HTMLVideoElement | null, m);
  });

  return (
    <>
      <mesh ref={meshRef} geometry={built.geometry} material={material} renderOrder={-3} frustumCulled={false} visible={false} />
      <mesh ref={haloRef} geometry={built.halo} material={haloMaterial} renderOrder={-1} frustumCulled={false} visible={false} />
    </>
  );
}
