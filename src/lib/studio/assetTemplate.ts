/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ASSET TEMPLATE — the descriptor that makes an opaque GLB configurable.
 *
 * A generated or purchased asset arrives as ONE watertight mesh with ONE baked
 * material. Nothing in those bytes says "this part is the crown and the host may
 * recolour it" or "a name goes HERE, facing this way, and must not bleed onto
 * the brim". Connected-component analysis does not rescue us either: Meshy's
 * remesher emits a single manifold, so the automatic pass over this repo's own
 * `public/models/reference-head.glb` finds exactly ONE component, not three.
 *
 * The template is that missing knowledge, authored once per library asset (by
 * the prep tool, then corrected by a human — hence `preparedBy`) and carried
 * beside the GLB. It is the ONLY thing standing between "a model you can look
 * at" and "a product a guest can configure".
 *
 * PURE. No three.js, no DOM. The render halves are ./regionTint.ts (colour
 * maths + shader patches) and ./assetDecal.ts (the engraved name).
 *
 * ── The legacy guarantee ──────────────────────────────────────────────────
 * `normalizeTemplate` returns NULL for anything it does not fully understand,
 * and every consumer treats null as "not configurable — draw the asset exactly
 * as the exporter produced it". A corrupt descriptor, a descriptor from a newer
 * writer, a descriptor someone hand-edited into nonsense: all degrade to the
 * behaviour that shipped before this feature existed. Nothing in this module
 * throws, because the caller is a render loop.
 */
import type { AssetCustomization, AssetLabelConfig } from '../../types';
import { normalizeModelledHand, type ModelledHand } from './handedness';
import type { GuestLetteringStyle } from '../letteringFit';
import { ASSET_CUSTOMIZATION } from './controlSpecs';
import { MAX_REGIONS, normalizeRefLuminance, unpackRegionIds } from './regionTint';
import { normalizeTint } from './finish';
// The shape validator lives in ./state.ts, which owns writing this object into
// the experience's jsonb. Importing it is deliberate: a second implementation
// here would be a MIRROR, and this repo has already paid for five of those
// (the entitlement tables). state.ts is pure — no React, no three, no Supabase
// — so it is safe to pull into a node-env test through this module.
import { normalizeCustomization as normalizeCustomizationShape } from './state';

/* ── geometry bounds ──────────────────────────────────────────────────────── */

/**
 * Bounds for the template's own geometry, kept here rather than in
 * ./controlSpecs.ts because these describe an AUTHORED ASSET, not a control a
 * host drags. Nothing in the studio renders a slider for them today; the moment
 * one does, they move to controlSpecs.ts, which that file's docblock claims as
 * the single source of every control's range.
 */
export const TEMPLATE_BOUNDS = {
  /** Real-world size of the asset along its fit axis, centimetres. 0.5cm is a
   *  charm; 200cm is a full-body prop. Outside that the author mis-typed. */
  fitCm: { min: 0.5, max: 200 },
  /** Widest an engraved label may be, centimetres. */
  maxWidthCm: { min: 0.2, max: 100 },
  /** Decal projector box depth — see AssetTextSlot.decalDepth. */
  decalDepth: { min: 0.001, max: 100 },
  /** Text slots kept per template (extras dropped deterministically). */
  maxTextSlots: 4,
  maxIdLength: 64,
  maxLabelLength: 80,
} as const;

function clampRange(raw: unknown, range: { min: number; max: number }, fallback: number): number {
  // Number(null) / Number('') / Number([]) are all 0 — finite, and therefore
  // invisible to a finiteness check. Absence is rejected before the coercion.
  if (typeof raw !== 'number' && typeof raw !== 'string') return fallback;
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range.max, Math.max(range.min, n));
}

// `max` is annotated because TEMPLATE_BOUNDS is `as const`: without it the
// default parameter narrows to the literal 64 and every longer bound is a type
// error rather than a longer bound.
function cleanId(raw: unknown, max: number = TEMPLATE_BOUNDS.maxIdLength): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

/* ── vectors ──────────────────────────────────────────────────────────────── */

export type Vec3 = [number, number, number];

/** Read a 3-tuple of finite numbers, or null. Tolerates a 4-long array (a
 *  quaternion pasted by mistake) by refusing it rather than silently dropping w. */
export function readVec3(raw: unknown): Vec3 | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return [out[0], out[1], out[2]];
}

/** Unit-length copy, or null when the vector has no direction to give. */
export function unitVec3(v: Vec3 | null): Vec3 | null {
  if (!v) return null;
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(len) || len < 1e-8) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Gram-Schmidt `up` against `normal`, returning a unit vector perpendicular to
 * `normal`.
 *
 * A decal's orientation is built from a normal and an up; if the author writes
 * an `up` parallel to the normal (very easy on a slot pointing straight up —
 * the top button of a cap) the cross products collapse and the projector matrix
 * becomes singular, which produces a decal of zero triangles and no error
 * anywhere. Falling back to whichever world axis is least parallel guarantees a
 * usable basis instead.
 */
export function orthogonalUp(up: Vec3 | null, normal: Vec3): Vec3 {
  const candidates: Vec3[] = [];
  if (up) candidates.push(up);
  candidates.push([0, 1, 0], [0, 0, 1], [1, 0, 0]);
  for (const c of candidates) {
    const unit = unitVec3(c);
    if (!unit) continue;
    const dot = unit[0] * normal[0] + unit[1] * normal[1] + unit[2] * normal[2];
    if (Math.abs(dot) > 0.999) continue; // parallel — the basis would collapse
    const projected: Vec3 = [
      unit[0] - normal[0] * dot,
      unit[1] - normal[1] * dot,
      unit[2] - normal[2] * dot,
    ];
    const orth = unitVec3(projected);
    if (orth) return orth;
  }
  // Unreachable for a unit normal (three mutually perpendicular axes cannot all
  // be parallel to it), but a render loop gets a defined answer, not a throw.
  return [0, 1, 0];
}

/* ── the descriptor ───────────────────────────────────────────────────────── */

/** One recolourable (or deliberately locked) part of the fused mesh. */
export interface AssetRegion {
  id: string;
  label: string;
  /** false = the author locked this part. A stored override naming it is
   *  IGNORED, not honoured — a licensed badge is not the host's to repaint. */
  recolourable: boolean;
  defaultHex: string;
  /** Mean LINEAR luminance of the baked albedo over this region — the divisor
   *  that turns the bake into a relative shading map (see regionTint.ts). */
  refLuminance: number;
  /** The GUEST may recolour this region in the booth (host opt-in — drives the
   *  booth's swatch row + beam colour). Absent/false = host-only, which is
   *  every descriptor authored before Power-Ups. */
  guestPick?: boolean;
}

/** Where a name may be engraved, and how deep the projector may cut. */
export interface AssetTextSlot {
  id: string;
  label: string;
  /** In the GLB's OWN local space, as it ships — NOT centimetres. */
  position: Vec3;
  /** Outward surface normal at `position`, unit length. */
  normal: Vec3;
  /** Text "up" on the surface, unit length and perpendicular to `normal`. */
  up: Vec3;
  /** Widest the engraved line may be, in real-world centimetres. The decal
   *  builder converts through the model's own bounding box and `fitCm`. */
  maxWidthCm: number;
  /** Region this slot sits on, when known — used to keep the projector from
   *  claiming a neighbouring part's triangles. */
  regionId?: string;
  /**
   * Depth of the decal projector box, in the GLB's LOCAL units (the same space
   * as `position`, deliberately NOT centimetres — it is clipping geometry, and
   * it is tuned by looking at the mesh).
   *
   * This single number is the ONLY thing stopping a name from bleeding onto an
   * adjacent part: DecalGeometry clips by BOX alone and has no notion of "the
   * same surface", so a box deep enough to reach the brim engraves the brim too
   * (panel C of the research render). Per-slot, because the right depth on a
   * flat front panel is wrong on a curved crown.
   */
  decalDepth: number;
  /**
   * How the lettering is made. Absent = 'stitch' (matte thread, the cap's
   * embroidery). 'gilt' = polished metal leaf, for a mask's crest plate: the
   * same artwork rendered metallic so it picks up the environment like the
   * gold trim around it.
   */
  finish?: 'gilt';
  /**
   * Present = MONOGRAM fit: the lettering is scaled up (or down) to the largest
   * size inside maxWidthCm x maxHeightCm, for two or three initials on a crest.
   * Absent = the name-line rule: a fixed cap height that only ever shrinks.
   */
  maxHeightCm?: number;
}

/**
 * Where a beam/blast erupts from, in the GLB's OWN local space (the same space
 * as AssetTextSlot.position — NOT centimetres). `direction` is the local axis
 * the bolt extends along (unit length). Authored per asset: the visor's lens
 * front, the wand's crystal tip, the gauntlet's palm.
 */
export interface AssetEmitter {
  position: Vec3;
  direction: Vec3;
}

export interface AssetTemplate {
  id: string;
  name: string;
  glbUrl: string;
  /** Real-world size the asset is scaled to. Library assets ship authored. */
  fitCm: number;
  regions: AssetRegion[];
  /**
   * Per-vertex region ids: either base64-packed bytes (see regionTint
   * packRegionIds) or a URL to a sidecar file. Absent = the mesh carries no
   * region attribute and only whole-asset styling is possible.
   */
  regionIds?: string;
  /** Beam origin on this asset. Absent (every pre-Power-Ups descriptor) means
   *  beams fall back to the per-rig default origin. */
  emitter?: AssetEmitter;
  /**
   * The hand this GLB was modelled for — a gauntlet, glove or watch fits one
   * hand and reads wrong on the other.
   *
   * ABSENT means hand-AGNOSTIC (a wand, a torch, anything symmetric enough that
   * flipping it changes nothing), and the render path then never mirrors the
   * mesh. That is every descriptor written before this field existed, so old
   * assets are unaffected. See lib/studio/handedness.ts for the decision and
   * mirrorGeometry.ts for the flip itself.
   */
  modelledHand?: ModelledHand;
  /**
   * A purpose-built GLB for the OTHER hand, when one exists.
   *
   * Mirroring the mesh is exact for geometry, so this is not needed for
   * correctness — but a real sculpt can differ in ways a reflection cannot
   * express: asymmetric decals, baked text, a thumb plate shaped for one hand.
   * When this is present the renderer loads it instead of mirroring; when it is
   * absent the mirror carries on doing the job. That is the whole contract, and
   * it means a handed pair can be dropped in later without touching any
   * render code.
   *
   * Ignored entirely unless `modelledHand` says which hand `glbUrl` itself is.
   */
  mirroredGlbUrl?: string;
  /**
   * A texture-space region map: a PNG on the SAME UVs as the base colour map,
   * whose RED byte at each texel is that texel's region index (0, 1, 2 …).
   *
   * Per-vertex `regionIds` put a region border on mesh edges, which is fine for
   * a cap's crown/brim but tears across fine painted detail — gold filigree on
   * a mask is narrower than the triangles under it. With a map the border
   * follows the PAINT, texel for texel. When present it wins over `regionIds`
   * for the tint; `regionIds` may still ship for tools that read vertices.
   */
  regionMapUrl?: string;
  /**
   * Named colours the GUEST picks from in the booth for every `guestPick`
   * region at once (a masquerade mask's "Emerald / Ruby / Onyx"). Absent = the
   * shared Power-Ups palette, which is what every visor/wand/gauntlet uses.
   */
  guestSwatches?: GuestSwatch[];
  textSlots: AssetTextSlot[];
  /**
   * 'auto' = derived by the prep pass alone. 'human' = a person checked it.
   *
   * Kept because the automatic pass is known to be WRONG on real assets: it
   * finds one component on a Meshy manifold, so an 'auto' template's regions
   * are a starting point for painting, not a finished answer. A surface that
   * offers 'auto' regions as if they were authored is lying to the host.
   */
  preparedBy: 'auto' | 'human';
}

/** One named booth swatch (see AssetTemplate.guestSwatches). */
export interface GuestSwatch {
  /** `#rrggbb`, lowercase. The swatch's KEY (unique per template) and the
   *  colour every guest-pickable region takes unless `parts` says otherwise. */
  hex: string;
  /** Short and generic: "Emerald", "Ruby". Read aloud as the button label. */
  name: string;
  /**
   * A COLOURWAY rather than one colour: per-region hex for this swatch (a
   * Jamaica mask is a green base with black feathers). Regions not named here
   * take `hex`. Only recolourable regions survive normalizeTemplate.
   */
  parts?: Record<string, string>;
  /**
   * A baked variant of the SAME mesh (same UVs, so any region map still lines
   * up) to draw instead of the layer's model: a flag-print pair of shades that
   * a tint could never produce from a floral bake.
   */
  glbUrl?: string;
  /** 2-3 stripe colours for the booth button (a flag) instead of a flat dot. */
  dot?: string[];
}

/** Most swatches a template may offer — one scrolling row on a phone. */
export const MAX_GUEST_SWATCHES = 10;

function normalizeGuestSwatches(raw: unknown): GuestSwatch[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: GuestSwatch[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_GUEST_SWATCHES) break;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const o = entry as Record<string, unknown>;
    const hex = normalizeTint(o.hex);
    const name = cleanId(o.name, 24);
    if (!hex || !name || out.some((s) => s.hex === hex)) continue;
    const swatch: GuestSwatch = { hex, name };
    if (o.parts !== null && typeof o.parts === 'object' && !Array.isArray(o.parts)) {
      const parts: Record<string, string> = {};
      for (const [id, v] of Object.entries(o.parts as Record<string, unknown>)) {
        const h = normalizeTint(v);
        if (h && cleanId(id)) parts[cleanId(id)] = h;
      }
      if (Object.keys(parts).length > 0) swatch.parts = parts;
    }
    // Same-origin path or https only: this URL becomes a model fetch.
    const glbUrl = typeof o.glbUrl === 'string' ? o.glbUrl.trim() : '';
    if (/^(\/[^/]|https:\/\/)/.test(glbUrl)) swatch.glbUrl = glbUrl;
    if (Array.isArray(o.dot)) {
      const dot = o.dot.map((d) => normalizeTint(d)).filter((d): d is string => !!d).slice(0, 3);
      if (dot.length >= 2) swatch.dot = dot;
    }
    out.push(swatch);
  }
  return out.length > 0 ? out : undefined;
}

const PREPARED_BY: ReadonlySet<string> = new Set(['auto', 'human']);

function normalizeRegion(raw: unknown): AssetRegion | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = cleanId(o.id);
  if (!id) return null;
  return {
    id,
    label: cleanId(o.label, TEMPLATE_BOUNDS.maxLabelLength) || id,
    // Only an explicit `false` locks a region: an absent flag means the author
    // did not think about it, and the useful default for a colour library is
    // "the host may recolour this".
    recolourable: o.recolourable !== false,
    defaultHex: normalizeTint(o.defaultHex) ?? '#ffffff',
    refLuminance: normalizeRefLuminance(o.refLuminance),
    // Explicit === true (a truthy string must not open a region to guests);
    // emitted only when set, so pre-Power-Ups descriptors round-trip untouched.
    ...(o.guestPick === true ? { guestPick: true } : {}),
  };
}

function normalizeTextSlot(raw: unknown, regionIds: ReadonlySet<string>): AssetTextSlot | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = cleanId(o.id, ASSET_CUSTOMIZATION.maxSlotIdLength);
  if (!id) return null;

  const position = readVec3(o.position);
  if (!position) return null;
  // A slot with no usable normal is DROPPED, not defaulted: projecting a decal
  // along a guessed direction engraves the name somewhere the author never
  // looked, and a missing name is a better failure than a name on the back.
  const normal = unitVec3(readVec3(o.normal));
  if (!normal) return null;

  const regionId = cleanId(o.regionId);
  return {
    id,
    label: cleanId(o.label, TEMPLATE_BOUNDS.maxLabelLength) || id,
    position,
    normal,
    up: orthogonalUp(readVec3(o.up), normal),
    maxWidthCm: clampRange(o.maxWidthCm, TEMPLATE_BOUNDS.maxWidthCm, 6),
    ...(regionId && regionIds.has(regionId) ? { regionId } : {}),
    decalDepth: clampRange(o.decalDepth, TEMPLATE_BOUNDS.decalDepth, 0.5),
    ...(o.finish === 'gilt' ? { finish: 'gilt' as const } : {}),
    ...(o.maxHeightCm !== undefined && o.maxHeightCm !== null
      ? { maxHeightCm: clampRange(o.maxHeightCm, TEMPLATE_BOUNDS.maxWidthCm, 2) }
      : {}),
  };
}

/** Largest |component| a GLB-local emitter position may carry. Meshy assets
 *  live in a roughly unit box; anything past this is a mis-pasted value that
 *  would put the muzzle nowhere near the mesh. */
const EMITTER_POSITION_LIMIT = 1000;

function normalizeEmitter(raw: unknown): AssetEmitter | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const position = readVec3(o.position);
  // Both halves or neither: a position with a guessed direction fires the bolt
  // through the asset; a missing emitter falls back to the per-rig default,
  // which is the better failure.
  const direction = unitVec3(readVec3(o.direction));
  if (!position || !direction) return null;
  if (position.some((v) => Math.abs(v) > EMITTER_POSITION_LIMIT)) return null;
  return { position, direction };
}

/**
 * Validate an untrusted descriptor. Returns null — never throws, never a
 * half-built template — for anything unusable, which the caller reads as "this
 * asset is not configurable".
 *
 * `id` and `glbUrl` are the only hard requirements: without them there is
 * nothing to key state on and nothing to draw. Everything else degrades.
 */
export function normalizeTemplate(raw: unknown): AssetTemplate | null {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const id = cleanId(o.id);
  if (!id) return null;
  const glbUrl = typeof o.glbUrl === 'string' ? o.glbUrl.trim() : '';
  if (!glbUrl) return null;

  const regions: AssetRegion[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.regions)) {
    for (const entry of o.regions) {
      if (regions.length >= MAX_REGIONS) break; // the GLSL array bound
      const region = normalizeRegion(entry);
      // First definition wins: a duplicate id would give two slots in the
      // uniform arrays and the second would silently shadow the first.
      if (!region || seen.has(region.id)) continue;
      seen.add(region.id);
      regions.push(region);
    }
  }

  const textSlots: AssetTextSlot[] = [];
  const slotIds = new Set<string>();
  if (Array.isArray(o.textSlots)) {
    for (const entry of o.textSlots) {
      if (textSlots.length >= TEMPLATE_BOUNDS.maxTextSlots) break;
      const slot = normalizeTextSlot(entry, seen);
      if (!slot || slotIds.has(slot.id)) continue;
      slotIds.add(slot.id);
      textSlots.push(slot);
    }
  }

  // `frontAxis` was DELETED from this contract (2026-07-29): nothing in the
  // render path ever read it — the decal orients from each slot's own
  // normal/up, and auto-orienting a placed asset from a single vector is
  // under-determined (no authored up axis) — so it was data that could be
  // wrong without anything noticing. Descriptors that still carry the key are
  // accepted and the key ignored, like any unknown field.
  const regionIds = typeof o.regionIds === 'string' && o.regionIds.trim() ? o.regionIds.trim() : undefined;
  const emitter = normalizeEmitter(o.emitter);
  const modelledHand = normalizeModelledHand(o.modelledHand);
  // Only meaningful beside `modelledHand`: without knowing which hand `glbUrl`
  // is, "the other one" names nothing. Dropped rather than kept as dead data
  // that would come alive the day someone added the missing field.
  const mirroredRaw = typeof o.mirroredGlbUrl === 'string' ? o.mirroredGlbUrl.trim() : '';
  const mirroredGlbUrl = modelledHand && mirroredRaw ? mirroredRaw : undefined;
  const regionMapUrl = typeof o.regionMapUrl === 'string' && o.regionMapUrl.trim() ? o.regionMapUrl.trim() : undefined;
  // A colourway may only paint regions the template lets anyone paint.
  const guestSwatches = normalizeGuestSwatches(o.guestSwatches)?.map((sw) => {
    if (!sw.parts) return sw;
    const parts = Object.fromEntries(
      Object.entries(sw.parts).filter(([id]) => regions.some((r) => r.id === id && r.recolourable)),
    );
    const { parts: _drop, ...rest } = sw;
    return Object.keys(parts).length > 0 ? { ...rest, parts } : rest;
  });

  return {
    id,
    name: cleanId(o.name, TEMPLATE_BOUNDS.maxLabelLength) || id,
    glbUrl,
    fitCm: clampRange(o.fitCm, TEMPLATE_BOUNDS.fitCm, 20),
    regions,
    ...(regionIds ? { regionIds } : {}),
    ...(emitter ? { emitter } : {}),
    ...(modelledHand ? { modelledHand } : {}),
    ...(mirroredGlbUrl ? { mirroredGlbUrl } : {}),
    ...(regionMapUrl ? { regionMapUrl } : {}),
    ...(guestSwatches ? { guestSwatches } : {}),
    textSlots,
    preparedBy: typeof o.preparedBy === 'string' && PREPARED_BY.has(o.preparedBy)
      ? (o.preparedBy as 'auto' | 'human')
      : 'auto',
  };
}

/** True when a template offers the host anything to change. */
export function isConfigurable(template: AssetTemplate | null): boolean {
  if (!template) return false;
  return template.regions.some((r) => r.recolourable) || template.textSlots.length > 0;
}

/* ── per-vertex region ids ────────────────────────────────────────────────── */

export type RegionIdsSource =
  | { kind: 'packed'; bytes: Uint8Array }
  | { kind: 'url'; url: string };

/**
 * Resolve `template.regionIds` into either decoded bytes or a URL to fetch.
 *
 * The URL test runs FIRST and is deliberately narrow (an absolute http(s) URL,
 * or a site-root path): `/` is a valid base64 character, so a lazy check would
 * happily "decode" a sidecar path into a few dozen nonsense region ids and
 * paint the model in stripes with no error anywhere.
 */
export function regionIdsSource(raw: unknown): RegionIdsSource | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return { kind: 'url', url: s };
  const bytes = unpackRegionIds(s);
  return bytes ? { kind: 'packed', bytes } : null;
}

/* ── customization ────────────────────────────────────────────────────────── */

/**
 * Validate an untrusted customization AND scope it to a template.
 *
 * NAMED FOR WHAT IT ADDS (Stage C). It was `normalizeCustomization`, which is
 * also the name of the SHAPE validator in ./state.ts that this function calls —
 * two exported functions, one name, one delegating to the other, and a reader
 * landing on an import had no way to tell which contract they had. The shape
 * half stays where storage owns it; this one is the SCOPING half.
 *
 * The scoping is the part state.ts structurally cannot do, because it has no
 * template: dropping overrides that name a region the asset does not have or
 * that the author LOCKED, and dropping a label whose slot does not exist.
 * Without it a stale saved config (the host swapped the asset, the template was
 * re-authored) would index into uniform slots that mean something else entirely
 * and repaint the wrong part.
 *
 * Returns NULL for "nothing to render", where state.ts returns `undefined` for
 * "omit the key from storage". The distinction is real and worth the friction:
 * this is the render side, and null is what the rest of the render code
 * (finish.ts `resolveFinish`, letteringFit `normalizeGuestLettering`) already
 * uses to mean "leave it alone".
 *
 * `template` omitted = shape validation only, for a surface editing a
 * customization before its asset is known.
 */
export function scopeCustomizationToTemplate(
  raw: unknown,
  template?: AssetTemplate | null,
): AssetCustomization | null {
  const shaped = normalizeCustomizationShape(raw);
  if (!shaped) return null;
  if (!template) return shaped;

  const out: AssetCustomization = {};

  if (shaped.parts) {
    const allowed = new Map(template.regions.map((r) => [r.id, r]));
    const parts: Record<string, NonNullable<AssetCustomization['parts']>[string]> = {};
    let kept = 0;
    for (const id of Object.keys(shaped.parts)) {
      const region = allowed.get(id);
      if (!region || !region.recolourable) continue;
      parts[id] = shaped.parts[id];
      kept += 1;
    }
    if (kept > 0) out.parts = parts;
  }

  if (shaped.label && template.textSlots.some((s) => s.id === shaped.label!.slotId)) {
    out.label = shaped.label;
  }

  return out.parts || out.label ? out : null;
}

/* ── label text ───────────────────────────────────────────────────────────── */

/** Longest set of initials a crest takes ("DW", "A&B", "JMK"). */
export const MAX_INITIALS = 3;

/**
 * Clean what a guest typed into the initials box: letters, digits and '&'
 * only, upper-cased, at most MAX_INITIALS. "d.w." -> "DW", "a & b" -> "A&B".
 * Unicode letters are kept (an "É" is somebody's initial).
 */
export function normalizeInitials(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return Array.from(raw.toUpperCase().replace(/[^\p{L}\p{N}&]/gu, '')).slice(0, MAX_INITIALS).join('');
}

/**
 * Initials derived from a name: the first letter of up to MAX_INITIALS words.
 * "Dapo Wuyi" -> "DW", "alex" -> "A", "" -> "". Used when the guest gave a
 * name but never typed initials, so a crest is never blank for a named guest.
 */
export function initialsFrom(name: unknown): string {
  if (typeof name !== 'string') return '';
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.map((w) => Array.from(w.replace(/[^\p{L}\p{N}]/gu, ''))[0] ?? '').join('');
  return normalizeInitials(letters);
}

/**
 * UNIFIED (Stage C): this used to be a knowing copy of the module-private
 * `LETTERING_FONT` table in components/booth/StageCanvas.tsx. Both now read the
 * one definition in lib/letteringFit.ts, beside the `CHAR_WIDTH_RATIO` keyed by
 * the same style union — so the name printed on the frame and the name engraved
 * into the asset are the same typeface by construction, not by agreement.
 *
 * Re-exported under the old name because ./assetDecal.ts and this module's test
 * both import it, and the alias costs nothing.
 */
export { LETTERING_FONT_CSS as LABEL_FONT_CSS } from '../letteringFit';

/**
 * Resolve a label's token to the string to engrave.
 *
 * Mirrors components/booth/StageCanvas.tsx `drawGuestLettering` exactly:
 *   - 'fixed'     -> the stored text (absent text is '')
 *   - 'guestName' -> the guest's own name
 *   - 'guestInitials' -> the initials the guest typed, else initialsFrom(name)
 *   - whitespace-only, either way, DRAWS NOTHING (returns '')
 *   - 'label' style is upper-cased BEFORE fitting, because uppercase is wider
 *     and fitting the lowercase form would overflow the band
 *
 * The one deliberate difference: the result is hard-capped at
 * ASSET_CUSTOMIZATION.maxLabelLength rather than ellipsised. The 2D path can
 * shrink type to a legibility floor and then truncate; a decal is GEOMETRY, its
 * cost is O(mesh triangles) per rebuild, and an engraved "…" reads as a defect
 * rather than as an abbreviation. The builder additionally shrinks-to-fit the
 * slot's maxWidthCm, so a short cap plus a scale fit beats a truncation mark.
 */
export function resolveLabelText(
  label: AssetLabelConfig | null | undefined,
  guestName: string,
  guestInitials = '',
): string {
  if (!label) return '';
  const raw = label.token === 'fixed'
    ? (label.text ?? '')
    : label.token === 'guestInitials'
      ? (normalizeInitials(guestInitials) || initialsFrom(guestName))
      : guestName;
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const capped = trimmed.slice(0, ASSET_CUSTOMIZATION.maxLabelLength);
  return label.style === 'label' ? capped.toUpperCase() : capped;
}

/**
 * Stable dependency key for a (template, customization) pair.
 *
 * `Model`'s load effect keys on primitives only — see regionTint
 * `regionOverridesKey` for why handing it an object re-downloads and re-clones
 * the entire GLB on every parent render. This is the whole-configuration
 * version of that key, and it deliberately includes the RESOLVED label text, so
 * that typing a name rebuilds the decal (which depends on it) without also
 * rebuilding the region tint (which does not).
 */
export function configuratorKey(
  template: AssetTemplate | null | undefined,
  customization: AssetCustomization | null | undefined,
  guestName = '',
): string {
  if (!template || !customization) return '';
  const parts = customization.parts ?? {};
  const partKey = Object.keys(parts)
    .sort()
    .map((id) => `${id}:${parts[id]?.hex ?? ''}:${parts[id]?.finish ?? ''}`)
    .filter((s) => !s.endsWith('::'))
    .join('|');
  const label = customization.label;
  const labelKey = label
    ? `${label.slotId}:${label.style}:${label.hex}:${resolveLabelText(label, guestName)}`
    : '';
  return `${template.id}#${partKey}#${labelKey}`;
}
