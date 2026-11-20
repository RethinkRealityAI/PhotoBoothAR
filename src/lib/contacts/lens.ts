/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Coloured Contacts — the style registry, the lens painter and the eye
 * geometry. PURE (no DOM, no three.js), so the node suite covers it and the
 * studio builder's preview is drawn by the SAME painter the booth runs.
 *
 * A lens is painted ONCE per look into a small square texture in "iris space":
 * x, y in −LENS_SPAN..+LENS_SPAN, where a distance of 1 is the edge of the
 * guest's iris and +y is up. ContactLensLayer then places that texture on each
 * tracked iris, inside a fan of triangles spanning the eye opening, so eyelids
 * hide it exactly as they hide a real lens.
 *
 * Reached only through the lazily-loaded ContactLensLayer and the studio
 * builder — never by a bundle that shows no contacts (the frozen legacy sites
 * included). spec.ts is the shape-only half every bundle carries.
 */
import type { ContactLensSpec } from './spec';

/** Half-width of the lens texture in iris radii (a margin past the iris edge for filtering). */
export const LENS_SPAN = 1.15;
/** Lens texture side in pixels. A phone iris is ~60px across in a 1080×1920 capture. */
export const LENS_TEXTURE_PX = 256;

export type PupilShape = 'open' | 'slit' | 'heart' | 'star';

export interface ContactStyle {
  id: string;
  name: string;
  blurb: string;
  /** Colour slots, in ContactLensSpec.colors order. */
  slots: readonly { label: string; default: string }[];
  /** 'open' leaves the guest's own pupil showing; the others cover it and draw a shaped one. */
  pupil: PupilShape;
  /** Fills the whole eye opening (the white of the eye too), not just the iris. */
  fullEye?: boolean;
  /** Glows: brighter than the room, with a soft halo that pulses gently. */
  glow?: boolean;
  /** How much of the real eye's own light and shadow carries through the lens, 0..1. */
  shade: number;
}

export const CONTACT_STYLES: readonly ContactStyle[] = [
  { id: 'natural', name: 'Natural', blurb: 'A soft tint with real iris detail, like everyday coloured contacts', slots: [{ label: 'Colour', default: '#3f7fd0' }], pupil: 'open', shade: 0.85 },
  { id: 'vivid', name: 'Vivid', blurb: 'A bold, solid colour with a dark outer ring', slots: [{ label: 'Colour', default: '#18b08a' }], pupil: 'open', shade: 0.6 },
  { id: 'starburst', name: 'Starburst', blurb: 'Two colours: one bursts out from the pupil into the other', slots: [{ label: 'Outer', default: '#2f6fe0' }, { label: 'Burst', default: '#f2b01e' }], pupil: 'open', shade: 0.6 },
  { id: 'cat', name: 'Cat Eye', blurb: 'A slit pupil, for cats, dragons and costume nights', slots: [{ label: 'Colour', default: '#d9a514' }], pupil: 'slit', shade: 0.5 },
  { id: 'heart', name: 'Heart Eyes', blurb: 'Heart-shaped pupils for weddings and date nights', slots: [{ label: 'Colour', default: '#e8336f' }], pupil: 'heart', shade: 0.5 },
  { id: 'star', name: 'Star Eyes', blurb: 'Star-shaped pupils for parties and launches', slots: [{ label: 'Colour', default: '#7c3aed' }], pupil: 'star', shade: 0.5 },
  { id: 'glow', name: 'Glow', blurb: 'Eyes that light up and pulse softly', slots: [{ label: 'Glow', default: '#18ffff' }, { label: 'Core', default: '#f4ffff' }], pupil: 'open', glow: true, shade: 0.15 },
  { id: 'full-eye', name: 'Full Eye', blurb: 'One colour over the whole eye: blackout, whiteout or anything between', slots: [{ label: 'Colour', default: '#060608' }], pupil: 'open', fullEye: true, shade: 0.35 },
];

export const CONTACT_STYLE_MAP: Readonly<Record<string, ContactStyle | undefined>> =
  Object.fromEntries(CONTACT_STYLES.map((s) => [s.id, s]));

/** The style's own default colours (a fresh array). Unknown style → []. */
export function defaultContactColors(styleId: string): string[] {
  return CONTACT_STYLE_MAP[styleId]?.slots.map((s) => s.default) ?? [];
}

/** `#rrggbb` → [r,g,b] in 0..1; anything else → null. */
export function hexToRgb(hex: string | undefined): [number, number, number] | null {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const PUPIL_RGB: readonly [number, number, number] = [0.02, 0.02, 0.03];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lum = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** 1 inside the shaped pupil, 0 outside, soft across the edge. */
export function pupilMask(shape: PupilShape, x: number, y: number): number {
  if (shape === 'slit') return 1 - smooth(0.85, 1.1, Math.hypot(x / 0.15, y / 0.8));
  if (shape === 'heart') {
    const hx = x / 0.36, hy = y / 0.36 + 0.12;
    const q = hx * hx + hy * hy - 1;
    return 1 - smooth(-0.04, 0.04, q * q * q - hx * hx * hy * hy * hy);
  }
  if (shape === 'star') {
    const step = Math.PI / 5;
    const a = Math.atan2(x, y); // 0 at the top point
    const m = Math.abs((((a % (2 * step)) + 2 * step) % (2 * step)) - step); // 0 in a valley … step at a tip
    const ro = 0.52, ri = 0.23;
    const edge = (ro * ri * Math.sin(step)) / (ro * Math.sin(step - m) + ri * Math.sin(m));
    return 1 - smooth(-0.02, 0.02, Math.hypot(x, y) - edge);
  }
  return 0;
}

/**
 * One lens texel: straight-alpha RGBA in 0..1 at iris-space (x, y), +y up.
 * Total: an unknown style or a missing colour falls back to the style defaults
 * or to transparent, never throws.
 */
export function lensTexel(styleId: string, colors: readonly string[], x: number, y: number, out: [number, number, number, number] = [0, 0, 0, 0]): [number, number, number, number] {
  const style = CONTACT_STYLE_MAP[styleId];
  if (!style) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
  const c0 = hexToRgb(colors[0]) ?? hexToRgb(style.slots[0].default)!;
  const c1 = hexToRgb(colors[1]) ?? hexToRgb(style.slots[1]?.default) ?? c0;
  const d = Math.hypot(x, y);
  const ang = Math.atan2(y, x);

  if (style.fullEye) {
    // Flat over the whole texture (the layer fills the rest of the eye opening
    // with the same colour); a faint ring keeps it reading as an eye, and a
    // light colour gets a small pupil so a whiteout still has a gaze.
    const ring = 0.1 * Math.exp(-(((d - 0.92) / 0.07) ** 2));
    const dot = lum(c0) > 0.45 ? 1 - smooth(0.1, 0.16, d) : 0;
    for (let k = 0; k < 3; k++) out[k] = clamp01((c0[k] + ring) * (1 - dot) + PUPIL_RGB[k] * dot);
    out[3] = 1;
    return out;
  }

  // Iris fibres: two interleaved streak families, strongest mid-iris.
  const fibre = 0.6 * (0.5 + 0.5 * Math.sin(ang * 37 + 3 * Math.sin(ang * 11))) + 0.4 * (0.5 + 0.5 * Math.sin(ang * 71 + 1.7));
  const collarette = Math.exp(-(((d - 0.45) / 0.09) ** 2));
  const limbal = smooth(0.74, 0.98, d);
  const edge = 1 - smooth(0.93, 1.0, d);
  let r: number, g: number, b: number, a: number;

  if (style.glow) {
    const t = smooth(0.0, 0.8, d);
    r = c1[0] + (c0[0] - c1[0]) * t;
    g = c1[1] + (c0[1] - c1[1]) * t;
    b = c1[2] + (c0[2] - c1[2]) * t;
    a = 1 - smooth(0.8, 1.04, d);
  } else if (style.id === 'starburst') {
    const spikes = 0.5 * Math.sin(ang * 14) + 0.5 * Math.sin(ang * 23 + 1);
    const t = smooth(0.34 + 0.13 * spikes, 0.74 + 0.13 * spikes, d);
    const k = (0.82 + 0.3 * fibre) * (1 - 0.5 * limbal);
    r = (c1[0] + (c0[0] - c1[0]) * t) * k;
    g = (c1[1] + (c0[1] - c1[1]) * t) * k;
    b = (c1[2] + (c0[2] - c1[2]) * t) * k;
    a = edge;
  } else {
    const natural = style.id === 'natural';
    const k = ((natural ? 0.74 : 0.86) + (natural ? 0.46 : 0.26) * fibre + 0.2 * collarette) * (1 - (natural ? 0.45 : 0.62) * limbal);
    r = c0[0] * k + 0.06 * collarette;
    g = c0[1] * k + 0.06 * collarette;
    b = c0[2] * k + 0.06 * collarette;
    a = edge * (natural ? 0.82 : 1);
  }

  if (style.pupil === 'open') {
    // The guest's own pupil shows through a soft hole.
    if (!style.glow) a *= smooth(0.3, 0.47, d);
  } else {
    const p = pupilMask(style.pupil, x, y);
    r += (PUPIL_RGB[0] - r) * p;
    g += (PUPIL_RGB[1] - g) * p;
    b += (PUPIL_RGB[2] - b) * p;
  }
  out[0] = clamp01(r); out[1] = clamp01(g); out[2] = clamp01(b); out[3] = clamp01(a);
  return out;
}

/** Paint the whole lens texture: RGBA bytes, row 0 = top, straight alpha. */
export function paintLensTexture(data: Uint8ClampedArray | Uint8Array, size: number, spec: Pick<ContactLensSpec, 'style' | 'colors'>): void {
  const px: [number, number, number, number] = [0, 0, 0, 0];
  for (let j = 0; j < size; j++) {
    const y = (1 - (2 * (j + 0.5)) / size) * LENS_SPAN;
    for (let i = 0; i < size; i++) {
      const x = ((2 * (i + 0.5)) / size - 1) * LENS_SPAN;
      lensTexel(spec.style, spec.colors, x, y, px);
      const o = (j * size + i) * 4;
      data[o] = Math.round(px[0] * 255);
      data[o + 1] = Math.round(px[1] * 255);
      data[o + 2] = Math.round(px[2] * 255);
      data[o + 3] = Math.round(px[3] * 255);
    }
  }
}

// ── Eye geometry ─────────────────────────────────────────────────────────────

export interface EyeLandmarks {
  /** The eyelid edge, as one closed loop of mesh vertex indices. */
  contour: readonly number[];
  /** Iris centre vertex. */
  iris: number;
  /** Four vertices on the iris edge. */
  ring: readonly number[];
}

/**
 * Mesh vertex indices per eye (MediaPipe/8th Wall numbering; points 468-477 are
 * the iris points no face triangle uses). `right` = the subject's right eye.
 */
export const EYES: { readonly right: EyeLandmarks; readonly left: EyeLandmarks } = {
  right: { contour: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], iris: 468, ring: [469, 470, 471, 472] },
  left: { contour: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249], iris: 473, ring: [474, 475, 476, 477] },
};

/** Vertices in one eye fan: the centre, then the contour. */
export const EYE_FAN_VERTS = 17;
/** Mesh points a lens needs (the iris points are the last ten of 478). */
export const CONTACT_MIN_POINTS = 478;
/** A real iris is ~1.2cm across; a tracked radius outside this band is noise. */
export const IRIS_RADIUS_CM = { min: 0.45, max: 0.72 } as const;
/** How far the fan's rim is pulled toward its centre, so the lens never spills onto the eyelid skin. */
export const EYE_FAN_SHRINK = 0.1;

/** Triangle indices of one fan (centre 0, rim 1..16), offset by `base`. */
export function eyeFanIndices(base = 0): number[] {
  const n = EYE_FAN_VERTS - 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(base, base + 1 + i, base + 1 + ((i + 1) % n));
  return out;
}

export interface IrisSample { x: number; y: number; z: number; r: number }

/**
 * Write one eye's fan into `out` (EYE_FAN_VERTS·3 floats at `offset`) from the
 * head-space mesh, and its iris centre + radius into `iris`. `mirror` reflects
 * x (the mirrored preview renders the reflected head). False — and nothing
 * usable written — when the mesh has no iris points or a needed value is not
 * finite.
 */
export function writeEyeFan(
  vertices: ArrayLike<number>,
  eye: EyeLandmarks,
  mirror: boolean,
  out: Float32Array,
  offset: number,
  iris: IrisSample,
): boolean {
  if (vertices.length < CONTACT_MIN_POINTS * 3) return false;
  const sx = mirror ? -1 : 1;
  let cx = 0, cy = 0, cz = 0;
  for (const i of eye.contour) {
    const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    cx += x; cy += y; cz += z;
  }
  const n = eye.contour.length;
  cx /= n; cy /= n; cz /= n;
  out[offset] = sx * cx; out[offset + 1] = cy; out[offset + 2] = cz;
  for (let k = 0; k < n; k++) {
    const i = eye.contour[k];
    const o = offset + (k + 1) * 3;
    out[o] = sx * (vertices[i * 3] + (cx - vertices[i * 3]) * EYE_FAN_SHRINK);
    out[o + 1] = vertices[i * 3 + 1] + (cy - vertices[i * 3 + 1]) * EYE_FAN_SHRINK;
    out[o + 2] = vertices[i * 3 + 2] + (cz - vertices[i * 3 + 2]) * EYE_FAN_SHRINK;
  }
  const ix = vertices[eye.iris * 3], iy = vertices[eye.iris * 3 + 1], iz = vertices[eye.iris * 3 + 2];
  if (!Number.isFinite(ix) || !Number.isFinite(iy) || !Number.isFinite(iz)) return false;
  let r = 0;
  for (const i of eye.ring) {
    const d = Math.hypot(vertices[i * 3] - ix, vertices[i * 3 + 1] - iy, vertices[i * 3 + 2] - iz);
    if (!Number.isFinite(d)) return false;
    r += d;
  }
  r /= eye.ring.length;
  iris.x = sx * ix; iris.y = iy; iris.z = iz;
  iris.r = Math.min(IRIS_RADIUS_CM.max, Math.max(IRIS_RADIUS_CM.min, r));
  return true;
}
