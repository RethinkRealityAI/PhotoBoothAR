/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MATERIAL FINISHES for imported / AI-generated GLBs.
 *
 * Meshy (and most photogrammetry exporters) hand back a mesh whose material is
 * an untuned MeshStandardMaterial — metalness ~0, roughness ~1, a flat albedo.
 * Under any lighting that reads as grey plastic. The jewelry builder already
 * had the fix (`text3d.ts MATERIAL_PRESETS`) but it was locked inside that one
 * dialog and only ever applied to geometry the builder itself extruded.
 *
 * This module is the general form: a small set of finishes plus an optional
 * tint, resolved to plain numbers. PURE — no three.js, no React. FaceRig's
 * `Model` is the half that turns a resolved override into a cloned material.
 *
 * Bounds live in ./controlSpecs.ts (FINISH_TINT_STRENGTH), never here — that
 * file is the single source of every studio control's range.
 */
import { FINISH_TINT_STRENGTH, clampToSpec } from './controlSpecs';

export type FinishId = 'original' | 'chrome' | 'gold' | 'matte' | 'neon' | 'glass';

export interface FinishSpec {
  id: FinishId;
  label: string;
  hint: string;
  metalness: number;
  roughness: number;
  /** Base colour the finish forces, or null = keep the model's own albedo. */
  color: string | null;
  /** Emissive colour, or null = no glow (keeps the mesh's own emissive). */
  emissive: string | null;
  emissiveIntensity: number;
  /** > 0 needs MeshPhysicalMaterial (a transmission pass). */
  transmission: number;
  ior: number;
  thickness: number;
  opacity: number;
}

/**
 * `original` FIRST and default: a host who never opens this control must get
 * exactly the bytes the exporter produced. Every other entry is opt-in.
 */
export const FINISHES: readonly FinishSpec[] = [
  {
    id: 'original', label: 'Original', hint: 'Leave the model exactly as exported.',
    metalness: 0, roughness: 1, color: null, emissive: null, emissiveIntensity: 0,
    transmission: 0, ior: 1.5, thickness: 0, opacity: 1,
  },
  {
    id: 'chrome', label: 'Chrome', hint: 'Mirror metal — needs the environment to reflect.',
    metalness: 1, roughness: 0.08, color: '#E8E8E8', emissive: null, emissiveIntensity: 0,
    transmission: 0, ior: 1.5, thickness: 0, opacity: 1,
  },
  {
    id: 'gold', label: 'Gold', hint: 'Warm polished gold.',
    metalness: 1, roughness: 0.24, color: '#D4A017', emissive: null, emissiveIntensity: 0,
    transmission: 0, ior: 1.5, thickness: 0, opacity: 1,
  },
  {
    id: 'matte', label: 'Matte', hint: 'Flat, no shine — reads as fabric or stone.',
    metalness: 0, roughness: 0.92, color: null, emissive: null, emissiveIntensity: 0,
    transmission: 0, ior: 1.5, thickness: 0, opacity: 1,
  },
  {
    id: 'neon', label: 'Neon', hint: 'Self-lit glow — visible even in a dark room.',
    metalness: 0.2, roughness: 0.5, color: '#0D0D0D', emissive: '#7DF9FF', emissiveIntensity: 2.2,
    transmission: 0, ior: 1.5, thickness: 0, opacity: 1,
  },
  {
    id: 'glass', label: 'Glass', hint: 'See-through and refractive. Costs the most to draw.',
    metalness: 0, roughness: 0.05, color: '#FFFFFF', emissive: null, emissiveIntensity: 0,
    transmission: 0.92, ior: 1.5, thickness: 0.6, opacity: 1,
  },
];

export const FINISH_MAP: Record<FinishId, FinishSpec> = Object.fromEntries(
  FINISHES.map((f) => [f.id, f]),
) as Record<FinishId, FinishSpec>;

export const FINISH_IDS: readonly FinishId[] = FINISHES.map((f) => f.id);

export const DEFAULT_FINISH: FinishId = 'original';

export function normalizeFinish(raw: unknown): FinishId {
  return typeof raw === 'string' && (FINISH_IDS as readonly string[]).includes(raw)
    ? (raw as FinishId)
    : DEFAULT_FINISH;
}

const HEX6 = /^#[0-9a-f]{6}$/i;

/**
 * Narrow a stored tint to `#rrggbb`, expanding the `#rgb` shorthand.
 * Anything else -> null (= no tint), never a thrown parse.
 */
export function normalizeTint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (HEX6.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return null;
}

/**
 * Tint strength, clamped through the shared control spec.
 *
 * ABSENT defaults to FULL, not to zero — a host who has just picked a colour
 * must see that colour. `null`/`undefined`/`''` are rejected BEFORE the numeric
 * coercion because `Number(null)` and `Number('')` are both 0, a perfectly
 * finite value: without this guard a missing strength would silently mean
 * "apply 0% of the tint", i.e. the tint would vanish with no error anywhere.
 * 0 typed by the host is still honoured — it is data, not absence.
 */
export function normalizeTintStrength(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return FINISH_TINT_STRENGTH.max;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return FINISH_TINT_STRENGTH.max;
  return clampToSpec(n, FINISH_TINT_STRENGTH);
}

/* ── colour maths ─────────────────────────────────────────────────────────── */

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Linear mix from `base` toward `tint`. `t` 0 -> base, 1 -> tint.
 *
 * Mixing in sRGB byte space (not linear light) on purpose: the host is picking
 * a swatch against a colour wheel, and this is the blend their eye predicts.
 * Invalid input returns `base` rather than throwing into a render loop.
 */
export function mixHex(base: string, tint: string, t: number): string {
  const a = normalizeTint(base);
  const b = normalizeTint(tint);
  if (!a) return typeof base === 'string' ? base : '#ffffff';
  if (!b) return a;
  const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 1;
  const [r1, g1, b1] = channels(a);
  const [r2, g2, b2] = channels(b);
  return toHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

/* ── resolution ───────────────────────────────────────────────────────────── */

export interface FinishOverride {
  /** Final base colour, or null = leave the mesh's own albedo untouched. */
  color: string | null;
  metalness: number;
  roughness: number;
  emissive: string | null;
  emissiveIntensity: number;
  transmission: number;
  ior: number;
  thickness: number;
  opacity: number;
  transparent: boolean;
  /** true when the result cannot be expressed by MeshStandardMaterial. */
  physical: boolean;
}

/**
 * Resolve a stored (finish, tint, strength) triple against ONE mesh's existing
 * base colour.
 *
 * Returns `null` when there is nothing to do — finish `original` with no tint.
 * That null is load-bearing: the caller must then leave the material completely
 * alone, so an object nobody styled renders byte-identically to before this
 * feature existed.
 *
 * `baseColorHex` is the mesh's own albedo, which is why this takes an argument
 * instead of being a constant table: a tint at strength 0.4 on a red mesh and
 * on a white mesh are different colours, and the host expects a WASH, not a
 * repaint.
 */
export function resolveFinish(
  finishRaw: unknown,
  tintRaw: unknown,
  strengthRaw: unknown,
  baseColorHex: string,
): FinishOverride | null {
  const finish = normalizeFinish(finishRaw);
  const tint = normalizeTint(tintRaw);
  if (finish === 'original' && tint === null) return null;

  const spec = FINISH_MAP[finish];
  const strength = normalizeTintStrength(strengthRaw);

  // The finish's own colour wins over the model's albedo; the tint then washes
  // over whichever of those is in play.
  const start = spec.color ?? normalizeTint(baseColorHex) ?? '#ffffff';
  const color = tint ? mixHex(start, tint, strength) : spec.color;

  // Neon takes its glow from the tint when one is set — a host picking hot pink
  // for a neon piece means the GLOW is pink, not the near-black body.
  const emissive = spec.emissive === null ? null : tint ? mixHex(spec.emissive, tint, strength) : spec.emissive;

  return {
    color,
    metalness: spec.metalness,
    roughness: spec.roughness,
    emissive,
    emissiveIntensity: spec.emissiveIntensity,
    transmission: spec.transmission,
    ior: spec.ior,
    thickness: spec.thickness,
    opacity: spec.opacity,
    transparent: spec.transmission > 0 || spec.opacity < 1,
    physical: spec.transmission > 0,
  };
}

/** True when a stored triple would change anything (drives the dock's badge). */
export function hasFinish(finishRaw: unknown, tintRaw: unknown): boolean {
  return normalizeFinish(finishRaw) !== 'original' || normalizeTint(tintRaw) !== null;
}
