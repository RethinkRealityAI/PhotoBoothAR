/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * REGION TINT — recolouring one PART of a fused, baked mesh.
 *
 * ## Why the obvious thing does not work
 *
 * Meshy (and every photogrammetry/gen-3D pipeline) hands back ONE watertight
 * mesh with ONE material whose albedo is a BAKED texture: the navy of the cap,
 * the tan of the brim, the panel seams, the ambient occlusion — all painted
 * into the same image. `material.color` cannot repaint that, because three
 * MULTIPLIES it into the sampled texel:
 *
 *     three/src/renderers/shaders/ShaderChunk/map_fragment.glsl.js:
 *         diffuseColor *= sampledDiffuseColor;
 *
 * Multiplication can only ever SUBTRACT light. Ask a navy cap for crimson and
 * you get near-black, because navy x crimson is a very dark red. That is the
 * muddy failure this module exists to avoid.
 *
 * ## The fix
 *
 * Treat the bake as a RELATIVE shading map instead of a colour. For each region
 * we record, once, at prep time, the mean LINEAR luminance of the texels that
 * region's UVs cover (`refLuminance`). At draw time we divide the sampled
 * luminance by that mean:
 *
 *     ratio  = sampledLuminance / refLuminance      // 1.0 at the region's average
 *     tinted = requestedColour * ratio
 *
 * The region's average pixel lands exactly on the requested swatch, while every
 * seam, weave fibre and AO gradient survives as the ratio's variation around 1.
 *
 * ## Everything in here is PURE
 *
 * No three.js import, no DOM, no canvas — the shader patches are produced as
 * plain strings and `applyRegionTintLinear` is the exact TypeScript twin of the
 * GLSL body, so the colour maths is asserted in the node test env rather than
 * eyeballed in a screenshot. The impure half (cloning materials, wiring
 * `onBeforeCompile`) lives in components/ar/FaceRig.tsx.
 */
import { FINISH_MAP, normalizeFinish, normalizeTint, type FinishId } from './finish';

/**
 * GLSL array bound for every per-region uniform.
 *
 * A GLSL uniform array length must be a compile-time constant, so this number
 * is baked into the shader source and is the hard ceiling on how many parts one
 * asset can expose. Eight covers every real garment we have seen (crown / brim
 * / button / eyelets / sweatband) with room to spare, and eight vec3 + five
 * float uniforms is nothing next to a PBR material's existing uniform block.
 */
export const MAX_REGIONS = 8;

/**
 * Ceiling on the luminance ratio.
 *
 * A specular highlight baked into the albedo can be many times the region mean;
 * left unclamped it multiplies the swatch into a blown-out band of pure white.
 * 3 keeps highlights reading as highlights without letting them detonate.
 */
export const MAX_TINT_RATIO = 3;

/**
 * Floor for a region's reference luminance.
 *
 * `refLuminance` is a DIVISOR. A region whose bake is genuinely black (or whose
 * prep pass never ran and left 0) would divide by zero and produce Infinity —
 * which in a fragment shader is a white screen, not an error message.
 */
export const MIN_REF_LUMINANCE = 1e-4;

/** Mid-grey. What an unprepared region assumes, matching a 18% grey card. */
export const DEFAULT_REF_LUMINANCE = 0.18;

/* ── colour space ─────────────────────────────────────────────────────────── */

/**
 * One sRGB channel byte (0-255) to linear light (0-1).
 *
 * The piecewise IEC 61966-2-1 transfer function, not the `pow(x, 2.2)`
 * approximation: the linear toe below 0.04045 is where fabric shadow detail
 * lives, and the approximation crushes exactly that range.
 */
export function srgbByteToLinear(byte: number): number {
  if (!Number.isFinite(byte)) return 0;
  const v = Math.min(255, Math.max(0, byte)) / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Rec. 709 relative luminance of a LINEAR rgb triple. */
export function linearLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * `#rrggbb` (or `#rgb`) to LINEAR rgb, the space `diffuseColor` lives in at the
 * point the patch runs. Returns null for anything that is not a colour — the
 * caller then leaves the region alone instead of tinting it black.
 *
 * This is the TypeScript equal of three's `Color.setStyle().convertSRGBToLinear()`;
 * it is here rather than there so the conversion can be tested without a
 * WebGL-bound import.
 */
export function hexToLinearRgb(hex: unknown): [number, number, number] | null {
  const norm = normalizeTint(hex);
  if (!norm) return null;
  const n = Number.parseInt(norm.slice(1), 16);
  return [
    srgbByteToLinear((n >> 16) & 255),
    srgbByteToLinear((n >> 8) & 255),
    srgbByteToLinear(n & 255),
  ];
}

/* ── prep-time statistics ─────────────────────────────────────────────────── */

/**
 * Mean LINEAR luminance of a flat RGBA byte buffer — the number that becomes a
 * region's `refLuminance`.
 *
 * Fully transparent texels are SKIPPED: an atlas pads the space between islands
 * with transparent black, and letting that padding into the mean would drag the
 * reference far below what the region actually looks like, which in turn scales
 * every ratio up and blows the tint out.
 *
 * Returns `DEFAULT_REF_LUMINANCE` — never 0 and never NaN — when there is
 * nothing to average, because the result is used as a divisor.
 */
export function meanRegionLuminance(rgba: ArrayLike<number>): number {
  const n = Math.floor(rgba.length / 4);
  if (n <= 0) return DEFAULT_REF_LUMINANCE;
  let sum = 0;
  let counted = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    sum += linearLuminance(
      srgbByteToLinear(rgba[o]),
      srgbByteToLinear(rgba[o + 1]),
      srgbByteToLinear(rgba[o + 2]),
    );
    counted++;
  }
  if (counted === 0) return DEFAULT_REF_LUMINANCE;
  return Math.max(MIN_REF_LUMINANCE, sum / counted);
}

/**
 * Clamp an authored/loaded reference luminance into the usable divisor range.
 *
 * `null`, `undefined`, `''` and `[]` are rejected BEFORE the numeric coercion,
 * because `Number()` turns every one of them into 0 — a perfectly finite value
 * that would sail through the finiteness check. That is not a cosmetic default:
 * this number is a DIVISOR, 0 clamps to MIN_REF_LUMINANCE = 1e-4, and dividing
 * a sampled luminance by 1e-4 multiplies it by ten thousand, pegging the whole
 * region at MAX_TINT_RATIO — a blown-out white part rather than a missing tint.
 * (Same guard, same reason, as finish.ts `normalizeTintStrength`.)
 *
 * A 0 the prep pass genuinely measured IS honoured, floored at MIN: a black
 * region is data, not absence.
 */
export function normalizeRefLuminance(raw: unknown): number {
  if (typeof raw !== 'number' && typeof raw !== 'string') return DEFAULT_REF_LUMINANCE;
  if (typeof raw === 'string' && raw.trim() === '') return DEFAULT_REF_LUMINANCE;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_REF_LUMINANCE;
  return Math.min(1, Math.max(MIN_REF_LUMINANCE, n));
}

/* ── the tint maths (twin of the GLSL below) ──────────────────────────────── */

/** `sampledLuminance / refLuminance`, clamped. 1 means "this texel is average". */
export function tintRatio(sampledLuminance: number, refLuminance: number): number {
  if (!Number.isFinite(sampledLuminance) || sampledLuminance < 0) return 0;
  const ref = Math.max(MIN_REF_LUMINANCE, Number.isFinite(refLuminance) ? refLuminance : DEFAULT_REF_LUMINANCE);
  return Math.min(MAX_TINT_RATIO, Math.max(0, sampledLuminance / ref));
}

/**
 * EXACT TypeScript twin of the fragment-shader body. Given the baked LINEAR
 * texel, the requested LINEAR tint, the region reference and a blend amount,
 * returns the LINEAR colour the shader will produce.
 *
 * Kept in step with `regionTintFragmentPatch()` by the colocated test, which
 * asserts the generated GLSL contains the same expression. This is what makes
 * "does a navy cap actually reach crimson?" a unit test instead of a screenshot.
 */
export function applyRegionTintLinear(
  baked: readonly [number, number, number],
  tint: readonly [number, number, number],
  refLuminance: number,
  amount: number,
): [number, number, number] {
  const amt = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
  if (amt <= 0) return [baked[0], baked[1], baked[2]];
  const ratio = tintRatio(linearLuminance(baked[0], baked[1], baked[2]), refLuminance);
  return [
    baked[0] + (tint[0] * ratio - baked[0]) * amt,
    baked[1] + (tint[1] * ratio - baked[1]) * amt,
    baked[2] + (tint[2] * ratio - baked[2]) * amt,
  ];
}

/* ── per-vertex region ids ────────────────────────────────────────────────── */

/**
 * Pack per-vertex region indices into base64 so a template can carry them as
 * one JSON string instead of an array of 30 000 numbers.
 *
 * One BYTE per vertex, which is why MAX_REGIONS can never exceed 256. Values
 * outside 0..255 (and NaN, from a corrupt prep pass) clamp to 0 — region 0
 * always exists, so a corrupt id paints the wrong part rather than crashing the
 * draw.
 */
export function packRegionIds(ids: ArrayLike<number>): string {
  const bytes = new Uint8Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    const v = Math.round(Number(ids[i]));
    bytes[i] = Number.isFinite(v) ? Math.min(255, Math.max(0, v)) : 0;
  }
  // Chunked so a 200k-vertex mesh cannot blow the argument limit of `apply`.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Inverse of `packRegionIds`. Returns null — never throws, never a partial
 * array — for anything that is not clean base64, so a corrupted template
 * degrades to "not region-tintable" instead of taking the booth down.
 */
export function unpackRegionIds(raw: unknown): Uint8Array | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.length % 4 !== 0 || !BASE64_RE.test(raw)) return null;
  try {
    const binary = atob(raw);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 255;
    return out;
  } catch {
    return null;
  }
}

/* ── uniform assembly ─────────────────────────────────────────────────────── */

/** The shape a region contributes to the uniform arrays. */
export interface TintableRegion {
  id: string;
  recolourable: boolean;
  refLuminance: number;
}

/** What the host asked for on one region. Both fields optional. */
export interface RegionOverride {
  hex?: string;
  finish?: string;
}

/**
 * The CPU-side mirror of the shader's uniform block. Flat typed arrays because
 * that is what `THREE.Uniform.value` wants for `uniform float x[N]`, and
 * because a Float32Array can be written in place each frame without allocating.
 */
export interface RegionUniforms {
  /** MAX_REGIONS * 3 LINEAR rgb floats. */
  tint: Float32Array;
  /** Per region blend, 0 = untouched. */
  amount: Float32Array;
  /** Per region baked mean luminance (the divisor). */
  ref: Float32Array;
  /** Per region roughness/metalness, applied only where matAmount is 1. */
  roughness: Float32Array;
  metalness: Float32Array;
  matAmount: Float32Array;
  /** Region id -> its slot in the arrays. */
  indexOf: Record<string, number>;
  /** False when nothing is overridden — the caller must then skip the patch
   *  entirely so an unconfigured asset renders byte-identically to before. */
  active: boolean;
}

function emptyUniforms(): RegionUniforms {
  const u: RegionUniforms = {
    tint: new Float32Array(MAX_REGIONS * 3),
    amount: new Float32Array(MAX_REGIONS),
    ref: new Float32Array(MAX_REGIONS),
    roughness: new Float32Array(MAX_REGIONS),
    metalness: new Float32Array(MAX_REGIONS),
    matAmount: new Float32Array(MAX_REGIONS),
    indexOf: {},
    active: false,
  };
  u.ref.fill(DEFAULT_REF_LUMINANCE);
  u.tint.fill(1);
  return u;
}

/**
 * Resolve `(regions, overrides)` into the uniform arrays the patch reads.
 *
 * `active: false` is the load-bearing result: no overrides, or none that name a
 * real recolourable region, means the caller leaves `onBeforeCompile` unset and
 * the material renders exactly as the exporter produced it. That is the legacy
 * guarantee — an asset with no `parts` is not merely visually similar to today,
 * it runs the identical stock shader program.
 *
 * A region marked `recolourable: false` is ignored even when the stored config
 * names it: the template author decided that part is not the host's to repaint
 * (a logo patch, a licensed badge), and stale saved state must not override it.
 */
export function buildRegionUniforms(
  regions: readonly TintableRegion[],
  overrides: Readonly<Record<string, RegionOverride>> | null | undefined,
): RegionUniforms {
  const u = emptyUniforms();
  const list = regions.slice(0, MAX_REGIONS);
  // Index and reference luminance are filled for EVERY region before any
  // override is read, so the arrays describe the template even when nothing is
  // overridden. Filling them inside the override loop would leave a region the
  // host has not touched holding the placeholder reference — invisible today
  // (an inactive patch is never bound) and a blown-out part the moment a
  // sibling region is tinted.
  for (let i = 0; i < list.length; i++) {
    u.indexOf[list[i].id] = i;
    u.ref[i] = normalizeRefLuminance(list[i].refLuminance);
  }
  if (!overrides) return u;

  for (let i = 0; i < list.length; i++) {
    const region = list[i];
    const ov = Object.prototype.hasOwnProperty.call(overrides, region.id) ? overrides[region.id] : undefined;
    if (!ov || !region.recolourable) continue;

    const resolved = resolveRegionOverride(ov.hex, ov.finish);
    if (!resolved) continue;

    if (resolved.hex) {
      const lin = hexToLinearRgb(resolved.hex);
      if (lin) {
        u.tint[i * 3] = lin[0];
        u.tint[i * 3 + 1] = lin[1];
        u.tint[i * 3 + 2] = lin[2];
        u.amount[i] = 1;
        u.active = true;
      }
    }
    if (resolved.metalness !== null && resolved.roughness !== null) {
      u.metalness[i] = resolved.metalness;
      u.roughness[i] = resolved.roughness;
      u.matAmount[i] = 1;
      u.active = true;
    }
  }
  return u;
}

/** What one region's stored override resolves to. Null = leave it alone. */
export interface ResolvedRegionOverride {
  /** Final swatch, or null to keep the baked albedo's own hue. */
  hex: string | null;
  /** null when the finish is `original` — do not touch the exporter's values. */
  metalness: number | null;
  roughness: number | null;
}

/**
 * One region's `(hex, finish)` pair resolved against `finish.ts`'s finish table.
 *
 * Mirrors `resolveFinish`'s contract deliberately: null means "there is nothing
 * to do here", and the caller must leave the material untouched rather than
 * writing defaults over it. The finish's own colour is used as the swatch when
 * the host picked a finish but no explicit hex — asking for `gold` and getting
 * a grey part would read as a bug.
 *
 * Uses `FINISHES` (finish.ts), NOT `MATERIAL_PRESETS` (text3d.ts). See the note
 * in this module's test: the two tables have drifted and disagree about gold.
 */
export function resolveRegionOverride(hexRaw: unknown, finishRaw: unknown): ResolvedRegionOverride | null {
  const hex = normalizeTint(hexRaw);
  // An ABSENT finish must not be coerced to 'original' and then silently treated
  // as a request: normalizeFinish maps every unknown value to 'original', so the
  // absence has to be detected before it, not after.
  const hasFinish = typeof finishRaw === 'string' && finishRaw.trim().length > 0;
  const finish: FinishId | null = hasFinish ? normalizeFinish(finishRaw) : null;
  if (!hex && (finish === null || finish === 'original')) return null;

  const spec = finish && finish !== 'original' ? FINISH_MAP[finish] : null;
  return {
    hex: hex ?? spec?.color ?? null,
    metalness: spec ? spec.metalness : null,
    roughness: spec ? spec.roughness : null,
  };
}

/* ── the shader patches ───────────────────────────────────────────────────── */

/**
 * `customProgramCacheKey()` must return this.
 *
 * Without it three hashes only the material's own properties, decides two
 * region-tinted materials are the same program, and — worse — recompiles from
 * scratch every time `onBeforeCompile` is reassigned. The version suffix must
 * change whenever the GLSL below changes, or a page that already compiled the
 * old program keeps using it.
 */
export const REGION_TINT_CACHE_KEY = `beamwall-regionTint-v1-${MAX_REGIONS}`;

/** Name of the per-vertex attribute the patch reads. */
export const REGION_ATTRIBUTE = 'aRegion';

/** A patch result. `patched:false` means an anchor was missing. */
export interface ShaderPatch {
  source: string;
  patched: boolean;
}

function replaceOnce(src: string, anchor: string, replacement: string): ShaderPatch {
  if (!src.includes(anchor)) return { source: src, patched: false };
  return { source: src.replace(anchor, replacement), patched: true };
}

/**
 * Declare the region attribute and forward it to the fragment stage.
 *
 * Plain (smooth) interpolation, not `flat`: three's WebGL2 path rewrites
 * `varying` through a macro and a `flat varying` does not survive it. Across a
 * triangle whose corners belong to different regions the value is interpolated
 * and `int(v + 0.5)` rounds to the nearest — which puts the seam mid-triangle
 * instead of exactly on the edge. On a welded 30k mesh that is a sub-millimetre
 * error and invisible; on a 300-tri proxy it would be a visible ragged border.
 */
export function regionTintVertexPatch(source: string): ShaderPatch {
  const declared = replaceOnce(
    source,
    '#include <common>',
    `#include <common>
attribute float ${REGION_ATTRIBUTE};
varying float vRegion;`,
  );
  const forwarded = replaceOnce(
    declared.source,
    '#include <begin_vertex>',
    `#include <begin_vertex>
vRegion = ${REGION_ATTRIBUTE};`,
  );
  // BOTH anchors or neither. A vertex stage that declares `varying float vRegion`
  // but never writes it still links, so a half-patch would silently tint every
  // fragment as region 0 — worse than not tinting at all, because it looks
  // deliberate. The caller checks `patched` and skips the whole patch.
  const patched = declared.patched && forwarded.patched;
  return { source: patched ? forwarded.source : source, patched };
}

/**
 * The tint itself, injected immediately AFTER `<map_fragment>` — i.e. after
 * `diffuseColor *= sampledDiffuseColor` has run, so `diffuseColor` holds the
 * baked albedo in LINEAR space and the ratio has something to measure.
 *
 * Roughness and metalness are patched at their own chunks rather than here,
 * because `roughnessFactor` / `metalnessFactor` do not exist yet at this point
 * in the generated program.
 */
export function regionTintFragmentPatch(source: string): ShaderPatch {
  const declarations = `#include <common>
varying float vRegion;
uniform vec3 uRegionTint[${MAX_REGIONS}];
uniform float uRegionAmount[${MAX_REGIONS}];
uniform float uRegionRef[${MAX_REGIONS}];
uniform float uRegionRough[${MAX_REGIONS}];
uniform float uRegionMetal[${MAX_REGIONS}];
uniform float uRegionMatAmount[${MAX_REGIONS}];
int beamwallRegionIndex() {
  int ri = int(vRegion + 0.5);
  return clamp(ri, 0, ${MAX_REGIONS - 1});
}`;

  const tint = `#include <map_fragment>
{
  int ri = beamwallRegionIndex();
  float amt = uRegionAmount[ri];
  if (amt > 0.0) {
    float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float ratio = clamp(lum / max(uRegionRef[ri], ${MIN_REF_LUMINANCE.toExponential()}), 0.0, ${MAX_TINT_RATIO.toFixed(1)});
    diffuseColor.rgb = mix(diffuseColor.rgb, uRegionTint[ri] * ratio, amt);
  }
}`;

  const rough = `#include <roughnessmap_fragment>
{
  int ri = beamwallRegionIndex();
  float m = uRegionMatAmount[ri];
  roughnessFactor = mix(roughnessFactor, uRegionRough[ri], m);
}`;

  const metal = `#include <metalnessmap_fragment>
{
  int ri = beamwallRegionIndex();
  float m = uRegionMatAmount[ri];
  metalnessFactor = mix(metalnessFactor, uRegionMetal[ri], m);
}`;

  const a = replaceOnce(source, '#include <common>', declarations);
  const b = replaceOnce(a.source, '#include <map_fragment>', tint);
  const c = replaceOnce(b.source, '#include <roughnessmap_fragment>', rough);
  const d = replaceOnce(c.source, '#include <metalnessmap_fragment>', metal);
  // The colour patch is the point of the exercise; the two material chunks are
  // a bonus that a MeshBasicMaterial legitimately does not have.
  return { source: d.source, patched: a.patched && b.patched };
}

/**
 * Stable string for a set of region overrides, for use in a React dependency
 * array.
 *
 * `Model`'s load effect keys on primitives only. Handing it an object literal
 * would give a new identity on every parent render, and the effect re-downloads
 * and re-clones the whole model — on a phone, a 12 MB Meshy parse per keystroke.
 * Keys are sorted so `{a,b}` and `{b,a}` produce one key, and undefined fields
 * are omitted so `{hex:'#fff'}` and `{hex:'#fff',finish:undefined}` agree.
 */
export function regionOverridesKey(overrides: Readonly<Record<string, RegionOverride>> | null | undefined): string {
  if (!overrides) return '';
  const ids = Object.keys(overrides).sort();
  const parts: string[] = [];
  for (const id of ids) {
    const ov = overrides[id];
    if (!ov) continue;
    const hex = typeof ov.hex === 'string' ? ov.hex : '';
    const finish = typeof ov.finish === 'string' ? ov.finish : '';
    if (!hex && !finish) continue;
    parts.push(`${id}:${hex}:${finish}`);
  }
  return parts.join('|');
}
