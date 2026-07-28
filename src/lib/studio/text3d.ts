/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procedural 3D name jewelry — the PURE half.
 *
 * Everything here is plain arithmetic over numbers: the catenary a necklace
 * chain hangs on, the per-link frames along it, the name-clamping rules, the
 * per-kind dimensions and the spec bounds. No `three` import, no DOM — so it
 * runs under vitest's node env like the rest of src/lib/studio. The THREE side
 * lives in ./text3dBuild.ts.
 *
 * UNITS: every length here is CENTIMETRES, matching MediaPipe head space (see
 * src/lib/faceRig.ts). A piece built in cm and dispatched with an explicit
 * scale of 1 lands life-size on the guest's face — no auto-fit pass involved.
 */
import type { HeadAnchor } from '../../types';

export type Text3DKind = 'necklace' | 'earrings' | 'nosering' | 'floating';
export type FontId = 'helvetiker' | 'helvetikerBold' | 'optimerBold';
export type MaterialPresetId = 'gold' | 'silver' | 'roseGold' | 'neon' | 'chrome';

/** Everything the host can change about one piece. Dimensions that the host
 *  does NOT choose (span, drop, ring diameter, max text width) are per-kind
 *  constants in KIND_DIMS — they are what makes the piece read as that kind. */
export interface Text3DSpec {
  kind: Text3DKind;
  text: string;
  fontId: FontId;
  material: MaterialPresetId;
  /** Cap height of the extruded text, cm. */
  textHeightCm: number;
  /** Extrusion depth, cm. NOTE: three-stdlib's TextGeometry calls this
   *  parameter `height` — passing `depth` is silently ignored and yields
   *  50-unit-thick text. See text3dBuild.ts. */
  depthCm: number;
  bevel: boolean;
  /** Links in the chain. Unused by 'nosering' / 'floating'. */
  chainLinks: number;
  /** How far the necklace chain dips below its endpoints, cm. Necklace only. */
  sagCm: number;
}

/* ── Materials ─────────────────────────────────────────────────────────────
 * Numeric colours so the THREE side can feed MeshStandardMaterial directly.
 * Only MeshStandardMaterial survives a GLTF round-trip (metalness/roughness/
 * emissive + emissiveIntensity through KHR_materials_emissive_strength), so
 * every preset stays inside that material's parameter set.
 *
 * The booth has NO environment map (booth/Overlay3D.tsx lights: ambient 1.2 +
 * one directional + one point), so metalness 1.0 has nothing to reflect and
 * renders near-black. 'chrome' is deliberately kept at 1.0 anyway — it is the
 * one preset that wants a mirror finish — and the preview uses the booth's
 * lights verbatim so the host sees that trade-off before they commit. */
export interface MaterialPreset {
  id: MaterialPresetId;
  label: string;
  color: number;
  metalness: number;
  roughness: number;
  emissive: number;
  emissiveIntensity: number;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'gold',     label: 'Gold',      color: 0xd4a017, metalness: 0.9,  roughness: 0.28, emissive: 0x3a2a05, emissiveIntensity: 0.35 },
  { id: 'silver',   label: 'Silver',    color: 0xc8ccd0, metalness: 0.9,  roughness: 0.22, emissive: 0x22262a, emissiveIntensity: 0.3 },
  { id: 'roseGold', label: 'Rose Gold', color: 0xd8927f, metalness: 0.85, roughness: 0.3,  emissive: 0x33201a, emissiveIntensity: 0.3 },
  { id: 'neon',     label: 'Neon',      color: 0x0d0d0d, metalness: 0.2,  roughness: 0.5,  emissive: 0x7df9ff, emissiveIntensity: 2.2 },
  { id: 'chrome',   label: 'Chrome',    color: 0xe8e8e8, metalness: 1.0,  roughness: 0.12, emissive: 0x2a2a2a, emissiveIntensity: 0.45 },
];

export const MATERIAL_MAP: Record<MaterialPresetId, MaterialPreset> = Object.fromEntries(
  MATERIAL_PRESETS.map((m) => [m.id, m]),
) as Record<MaterialPresetId, MaterialPreset>;

/** Presets whose metalness leaves them near-black under the booth's envmap-less
 *  lighting — the builder surfaces this as a preview note, not an error. */
export function materialWarning(id: MaterialPresetId): string | null {
  const m = MATERIAL_MAP[id];
  if (!m) return null;
  return m.metalness >= 1
    ? 'Mirror finishes have nothing to reflect in the booth (no environment map) — expect it darker on camera than here.'
    : null;
}

/* ── Fonts ─────────────────────────────────────────────────────────────────
 * The three typeface JSONs shipped inside the installed `three` package. No
 * new dependency, no network font. Loading lives in text3dBuild.ts. */
export interface FontOption {
  id: FontId;
  label: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: 'helvetiker', label: 'Helvetiker' },
  { id: 'helvetikerBold', label: 'Helvetiker Bold' },
  { id: 'optimerBold', label: 'Optimer Bold' },
];

export const FONT_IDS: FontId[] = FONT_OPTIONS.map((f) => f.id);

/* ── Per-kind fixed dimensions ─────────────────────────────────────────────
 * These are NOT host-editable: they are what makes a necklace read as a
 * necklace. Fields a kind does not use are 0 and never read for that kind. */
export interface KindDims {
  /** Horizontal distance the necklace chain spans, cm (necklace only). */
  spanCm: number;
  /** Vertical distance the earring chain spans, cm (earrings only). */
  dropCm: number;
  /** Nose ring outer diameter and tube thickness, cm (nosering only). */
  ringDiameterCm: number;
  ringTubeCm: number;
  /** How much of the open ring is drawn, radians — the gap is what lets it
   *  read as jewelry rather than a washer (nosering only). */
  ringArcRad: number;
  /** Widest the text may be before fitScaleToWidth shrinks it, cm. */
  maxTextWidthCm: number;
}

export const KIND_DIMS: Record<Text3DKind, KindDims> = {
  necklace: { spanCm: 15, dropCm: 0,   ringDiameterCm: 0,   ringTubeCm: 0,    ringArcRad: 0,   maxTextWidthCm: 7 },
  earrings: { spanCm: 0,  dropCm: 2.4, ringDiameterCm: 0,   ringTubeCm: 0,    ringArcRad: 0,   maxTextWidthCm: 2.5 },
  nosering: { spanCm: 0,  dropCm: 0,   ringDiameterCm: 1.2, ringTubeCm: 0.08, ringArcRad: 5.5, maxTextWidthCm: 1.0 },
  floating: { spanCm: 0,  dropCm: 0,   ringDiameterCm: 0,   ringTubeCm: 0,    ringArcRad: 0,   maxTextWidthCm: 14 },
};

/** Which head anchor(s) a kind attaches to. Earrings return a PAIR — the same
 *  GLB is added twice (one per ear), which is why the earring geometry is built
 *  symmetric about its own vertical axis. */
export const KIND_ANCHOR: Record<Text3DKind, HeadAnchor | [HeadAnchor, HeadAnchor]> = {
  necklace: 'chin',
  earrings: ['leftEar', 'rightEar'],
  nosering: 'noseTip',
  floating: 'crown',
};

export const KIND_LABEL: Record<Text3DKind, string> = {
  necklace: 'Necklace',
  earrings: 'Earrings',
  nosering: 'Nose Ring',
  floating: 'Floating Text',
};

export const TEXT3D_KINDS: Text3DKind[] = ['necklace', 'earrings', 'nosering', 'floating'];

/** Kinds built around a chain — the only ones whose link/sag controls apply. */
export function kindHasChain(kind: Text3DKind): boolean {
  return kind === 'necklace' || kind === 'earrings';
}

/* ── Bounds ────────────────────────────────────────────────────────────────
 * Text height is bounded PER KIND: an earring charm is legitimately 1.2cm
 * where a necklace pendant is 2.5cm, so a single global floor would reject the
 * default earring. Depth and sag are global. */
export interface Range { min: number; max: number }

export const TEXT_CHARS: Range = { min: 1, max: 14 };
export const DEPTH_CM: Range = { min: 0.2, max: 0.8 };
export const SAG_CM: Range = { min: 1, max: 5 };

export const TEXT_HEIGHT_CM: Record<Text3DKind, Range> = {
  necklace: { min: 1.5, max: 3 },
  earrings: { min: 0.6, max: 2 },
  nosering: { min: 0.4, max: 1.2 },
  floating: { min: 1.5, max: 4 },
};

/** Link-count bounds for the chained kinds. Kinds without a chain are absent. */
export const CHAIN_LINKS: Partial<Record<Text3DKind, Range>> = {
  necklace: { min: 16, max: 48 },
  earrings: { min: 3, max: 8 },
};

export function defaultSpecFor(kind: Text3DKind): Text3DSpec {
  const base = { kind, text: 'Name', fontId: 'helvetiker' as FontId, material: 'gold' as MaterialPresetId };
  switch (kind) {
    case 'necklace':
      return { ...base, textHeightCm: 2.5, depthCm: 0.4, bevel: true, chainLinks: 28, sagCm: 3 };
    case 'earrings':
      return { ...base, textHeightCm: 1.2, depthCm: 0.3, bevel: true, chainLinks: 5, sagCm: 0 };
    case 'nosering':
      return { ...base, textHeightCm: 0.6, depthCm: 0.2, bevel: false, chainLinks: 0, sagCm: 0 };
    case 'floating':
      return { ...base, textHeightCm: 3, depthCm: 0.5, bevel: true, chainLinks: 0, sagCm: 0 };
  }
}

/* ── Name handling ─────────────────────────────────────────────────────────*/

/**
 * The host's typed name reduced to something TextGeometry can actually extrude:
 * trimmed, stripped of every character the chosen typeface has no glyph for
 * (a missing glyph throws inside three's shape generation), then clamped to
 * TEXT_CHARS.max. Stripping happens BEFORE the length clamp so unsupported
 * characters cannot eat the character budget.
 *
 * `glyphs` is the typeface JSON's own glyph map (font.data.glyphs). Membership
 * is tested with hasOwnProperty, never truthiness — a glyph entry is an object
 * but inherited names like 'constructor' must not count as supported.
 *
 * Returns '' only when nothing supported survives; callers treat that as
 * "nothing to build", not as an error.
 */
export function clampName(text: string, glyphs: Record<string, unknown>): string {
  if (typeof text !== 'string') return '';
  // Array.from splits by code point, so an emoji is one unit and is dropped
  // whole rather than leaving half a surrogate pair behind.
  const kept: string[] = [];
  for (const ch of Array.from(text.trim())) {
    if (Object.prototype.hasOwnProperty.call(glyphs, ch)) kept.push(ch);
    if (kept.length >= TEXT_CHARS.max) break;
  }
  return kept.join('');
}

/** Characters dropped by clampName, for the "we removed these" hint. */
export function strippedChars(text: string, glyphs: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of Array.from(text.trim())) {
    if (Object.prototype.hasOwnProperty.call(glyphs, ch)) continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}

/**
 * Uniform scale that fits `measured` into `max` — and NEVER upscales, so a
 * short name keeps the host's chosen text height instead of being stretched
 * across the whole pendant. Non-finite / non-positive input returns 1 (leave
 * the geometry alone rather than collapse it).
 */
export function fitScaleToWidth(measured: number, max: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return 1;
  if (!Number.isFinite(max) || max <= 0) return 1;
  return Math.min(1, max / measured);
}

/* ── Catenary ──────────────────────────────────────────────────────────────*/

export interface CatPoint { x: number; y: number }

/** Solve a·(cosh(w/2a) − 1) = sag for a. The left side decreases monotonically
 *  in a (a→0 ⇒ ∞, a→∞ ⇒ 0), so plain bisection is exact enough and cannot get
 *  stuck; 200 halvings of [1e-6, 1e6] is far past double precision. */
function catenaryParam(widthCm: number, sagCm: number): number {
  let lo = 1e-6;
  let hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const s = mid * (Math.cosh(widthCm / (2 * mid)) - 1);
    if (s > sagCm) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * `n` points along the catenary a chain of the given span hangs on: endpoints
 * at (±width/2, 0), lowest point at (0, −sag), and — crucially — spaced evenly
 * by ARC LENGTH, not by x. Even-x spacing bunches links at the bottom, which
 * is exactly where a chain looks wrong.
 *
 * sag ≤ 0 degenerates to a straight horizontal line (still evenly spaced).
 */
export function catenaryPoints(n: number, widthCm: number, sagCm: number): CatPoint[] {
  const count = Math.max(2, Math.floor(n));
  const w = Math.max(widthCm, 0);
  if (w <= 0) return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
  if (!(sagCm > 0)) {
    return Array.from({ length: count }, (_, i) => ({ x: -w / 2 + (w * i) / (count - 1), y: 0 }));
  }

  const a = catenaryParam(w, sagCm);
  const yAt = (x: number) => a * Math.cosh(x / a) - a * Math.cosh(w / (2 * a));

  // Dense sampling → cumulative chord length → resample at equal fractions.
  // 512 segments over a ≤15cm span keeps the chord/arc error far below the
  // sub-millimetre scale anything here is drawn at.
  const DENSE = 512;
  const xs = new Float64Array(DENSE + 1);
  const ys = new Float64Array(DENSE + 1);
  const cum = new Float64Array(DENSE + 1);
  for (let i = 0; i <= DENSE; i++) {
    const x = -w / 2 + (w * i) / DENSE;
    xs[i] = x;
    ys[i] = yAt(x);
    if (i > 0) {
      const dx = xs[i] - xs[i - 1];
      const dy = ys[i] - ys[i - 1];
      cum[i] = cum[i - 1] + Math.hypot(dx, dy);
    }
  }
  const total = cum[DENSE];

  const out: CatPoint[] = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1);
    while (seg < DENSE && cum[seg + 1] < target) seg++;
    const spanLen = cum[seg + 1] - cum[seg];
    const t = spanLen > 0 ? (target - cum[seg]) / spanLen : 0;
    out.push({
      x: xs[seg] + (xs[seg + 1] - xs[seg]) * t,
      y: ys[seg] + (ys[seg + 1] - ys[seg]) * t,
    });
  }
  // Pin the ends exactly — 512-segment interpolation is accurate but the
  // endpoints are the two values a caller will assert on.
  out[0] = { x: -w / 2, y: 0 };
  out[count - 1] = { x: w / 2, y: 0 };
  return out;
}

/* ── Chain links ───────────────────────────────────────────────────────────*/

export interface LinkFrame {
  /** Link centre in the piece's local plane, cm. */
  x: number;
  y: number;
  /** Rotation about Z that turns +X into the chain's local tangent, radians. */
  angle: number;
  /** Rotation about the tangent, alternating 0 / π/2 so neighbouring links sit
   *  in perpendicular planes and read as interlocked rather than as a stack. */
  roll: number;
  /** The link's own extent along the tangent, cm (echoed from linkLen). */
  len: number;
}

/**
 * One frame per point: position, the tangent direction the link's plane must
 * contain, and the alternating roll.
 *
 * The tangent is measured across a window of `linkLen` of polyline centred on
 * the point, not between immediate neighbours — a link physically spans that
 * much chain, and on a dense point set the neighbour difference is dominated by
 * sampling noise rather than by the curve the link actually sits on.
 */
export function linkFrames(points: CatPoint[], linkLen: number): LinkFrame[] {
  const len = Number.isFinite(linkLen) && linkLen > 0 ? linkLen : 0;
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: points[0].x, y: points[0].y, angle: 0, roll: 0, len }];

  const half = len / 2;
  // Cumulative arc length so the window walk is an index lookup, not a scan.
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }

  /** Point at arc distance `s` along the polyline, clamped to its ends. */
  const at = (s: number): CatPoint => {
    if (s <= 0) return points[0];
    if (s >= cum[n - 1]) return points[n - 1];
    let seg = 0;
    while (seg < n - 2 && cum[seg + 1] < s) seg++;
    const spanLen = cum[seg + 1] - cum[seg];
    const t = spanLen > 0 ? (s - cum[seg]) / spanLen : 0;
    return {
      x: points[seg].x + (points[seg + 1].x - points[seg].x) * t,
      y: points[seg].y + (points[seg + 1].y - points[seg].y) * t,
    };
  };

  return points.map((p, i) => {
    const s = cum[i];
    // A zero-length window (or an end point whose window collapses on one side)
    // degrades to the neighbour difference rather than producing atan2(0,0)=0.
    let a = at(s - half);
    let b = at(s + half);
    if (a.x === b.x && a.y === b.y) {
      a = points[Math.max(0, i - 1)];
      b = points[Math.min(n - 1, i + 1)];
    }
    return {
      x: p.x,
      y: p.y,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      roll: i % 2 === 0 ? 0 : Math.PI / 2,
      len,
    };
  });
}

/**
 * Torus radii for a chain whose links sit `spacingCm` apart, centre to centre.
 *
 * The ratios are pinned to the necklace reference (28 links across a 15cm span
 * at 3cm sag ⇒ spacing 0.61092cm, torus R 0.35 / tube 0.09). Deriving them from
 * spacing rather than fixing them is what makes the "chain links" slider work:
 * at a fixed radius, 16 links leave visible gaps between tori and 48 fuse into
 * a solid rod. Here fewer links simply read as a chunkier chain.
 *
 * 2·(radius + tube) = 1.44·spacing, so consecutive links always overlap — the
 * property that makes the row read as a chain rather than as loose rings.
 */
const RADIUS_PER_SPACING = 0.5729;
const TUBE_PER_RADIUS = 0.2571;

export function linkRadii(spacingCm: number): { radius: number; tube: number } {
  const s = Number.isFinite(spacingCm) && spacingCm > 0 ? spacingCm : 1e-4;
  const radius = s * RADIUS_PER_SPACING;
  return { radius, tube: radius * TUBE_PER_RADIUS };
}

/* ── Validation ────────────────────────────────────────────────────────────*/

export interface SpecValidation {
  ok: boolean;
  errors: string[];
}

function inRange(v: number, r: Range): boolean {
  return Number.isFinite(v) && v >= r.min && v <= r.max;
}

/**
 * Every bound the builder relies on, checked in one place. Controls in the UI
 * already clamp to these ranges — this is the gate for a spec that arrives from
 * anywhere else (a restored draft, a future agent tool) before geometry is
 * built from it.
 */
export function validateSpec(spec: Text3DSpec): SpecValidation {
  const errors: string[] = [];
  if (!TEXT3D_KINDS.includes(spec.kind)) {
    return { ok: false, errors: [`Unknown kind "${spec.kind}".`] };
  }
  const chars = Array.from(spec.text ?? '').length;
  if (chars < TEXT_CHARS.min || chars > TEXT_CHARS.max) {
    errors.push(`Name must be ${TEXT_CHARS.min}–${TEXT_CHARS.max} characters.`);
  }
  if (!FONT_IDS.includes(spec.fontId)) errors.push(`Unknown font "${spec.fontId}".`);
  if (!MATERIAL_MAP[spec.material]) errors.push(`Unknown material "${spec.material}".`);

  const th = TEXT_HEIGHT_CM[spec.kind];
  if (!inRange(spec.textHeightCm, th)) {
    errors.push(`Text height must be ${th.min}–${th.max}cm for a ${KIND_LABEL[spec.kind].toLowerCase()}.`);
  }
  if (!inRange(spec.depthCm, DEPTH_CM)) {
    errors.push(`Thickness must be ${DEPTH_CM.min}–${DEPTH_CM.max}cm.`);
  }

  const links = CHAIN_LINKS[spec.kind];
  if (links && !inRange(spec.chainLinks, links)) {
    errors.push(`Chain links must be ${links.min}–${links.max}.`);
  }
  // Sag describes the curve a necklace hangs on; no other kind has one, so the
  // field is ignored (and left at 0 by defaultSpecFor) rather than bounded.
  if (spec.kind === 'necklace' && !inRange(spec.sagCm, SAG_CM)) {
    errors.push(`Chain drop must be ${SAG_CM.min}–${SAG_CM.max}cm.`);
  }

  return { ok: errors.length === 0, errors };
}
