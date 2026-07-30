/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Head-occluder geometry helpers. The occluder is MediaPipe's canonical face
 * model (vendored OBJ at src/assets/ar/canonical_face_model.obj — the SAME
 * metric-centimetre space faceRig.ts anchors are calibrated against: ears
 * x≈±7.7, chin y≈−9.4, crown y≈+8.3, nose tip z≈+7.6) plus a procedural
 * cranium ellipsoid closing the back of the head. Both render with
 * colorWrite:false so they only write DEPTH: props behind the real head fail
 * the depth test and the camera feed shows through.
 *
 * Pure parsing/params here (node-tested); the R3F meshes live in
 * components/ar/FaceOccluder.tsx.
 *
 * Also the home of `StudioSettings` — the whole `app_settings` 'studio' key,
 * not just the occluder's slice of it.
 */
import { DEFAULT_LIGHTING, normalizeLightingPreset, type LightingPresetId } from './lighting';

export interface ParsedObj {
  /** flat xyz triples */
  positions: Float32Array;
  /** triangle indices into positions */
  indices: Uint32Array;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

/**
 * Minimal OBJ parser for the canonical face model: `v x y z` vertices and
 * `f a/at b/bt c/ct …` faces (1-based, texture index ignored; polygons are
 * fan-triangulated). Anything else (vt/vn/comments) is skipped.
 */
export function parseObj(text: string): ParsedObj {
  const positions: number[] = [];
  const indices: number[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const parts = line.trim().split(/\s+/);
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      positions.push(x, y, z);
      const v = [x, y, z];
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    } else if (line.startsWith('f ')) {
      const verts = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((tok) => parseInt(tok.split('/')[0], 10) - 1)
        .filter((i) => Number.isInteger(i) && i >= 0);
      for (let i = 1; i + 1 < verts.length; i++) {
        indices.push(verts[0], verts[i], verts[i + 1]);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    bbox: { min, max },
  };
}

/**
 * Cranium ellipsoid closing the back/top of the head behind the face shell.
 * Radii/centre are centimetres in head space.
 *
 * TWO OPPOSING REQUIREMENTS, and the numbers below are where they meet:
 *   · Big enough that a prop which WRAPS the head (a cap's shell, a helmet) is
 *     depth-culled where it passes behind the skull. The first draft was sized
 *     "just inside an average head" at ±7.2 — NARROWER than the canonical face
 *     model this same occluder is built from (that OBJ measures ±7.74 at the
 *     ears), and with no allowance for hair. Nothing exposed it while the only
 *     3D pieces were crowns and halos, which sit ABOVE the head and have no
 *     back to hide; the baseball cap is the first prop with an interior, and
 *     its shell measures 8.61cm half-width at its shipped 26cm fit, so a band
 *     of cap lining projected outside the occluder silhouette and stayed
 *     visible. That is the "occlusion isn't working" report.
 *   · Small enough that every ANCHOR_PRESET in faceRig.ts stays OUTSIDE the
 *     shell, or the occluder swallows the prop mounted there. The binding
 *     constraint is the ear anchors (±7.7, 1.5, −1.5) — earrings — which is
 *     why the sides stop at 7.6 rather than growing to match the cap.
 *     occluder.test.ts asserts every preset clears it; that test, not this
 *     comment, is what keeps a later resize honest.
 *
 * Reaches: front z +5.0 (unchanged — it must stay behind the noseBridge anchor
 * at z 5.8 and the forehead anchor at 5.4), sides ±7.6, top +10.3 (was +9.5 —
 * now clears a hairline rather than a bare skull), back −11.6 (was −10.5).
 */
export interface CraniumParams {
  center: [number, number, number];
  radii: [number, number, number];
}

export const CRANIUM: CraniumParams = {
  center: [0, 0.5, -3.3],
  radii: [7.6, 9.8, 8.3],
};

/**
 * HAIR DOME — a second ellipsoid the cranium alone cannot be.
 *
 * The cranium is a bald skull, and it is CAPPED at ±7.6 by the ear anchors: an
 * earring mounted at (±7.7, 1.5) must not be swallowed, so the shell cannot
 * widen at ear level no matter how big the wearer's head is. But a cap does not
 * sit on the skull — it sits on HAIR, several centimetres further out, and the
 * gap between bald shell and hair-riding cap is exactly where the cap's back
 * lining stayed visible ("occlusion isn't working", reported on a live head).
 *
 * A single ellipsoid cannot be both wide at the hair and narrow at the ears.
 * Two can: this dome is CENTRED HIGH AND WELL BACK (+5.0, −7.0), so its widest
 * cross-section sits up in the hair volume — sides 8.6 (the cap shell is 8.61:
 * hugged from just inside), top +13.8, back −15 — while its FRONT reach stops
 * at +1.0cm. The front bound is a lesson from a live head: a first draft
 * reaching +3.4 at brow height swallowed the cap brim's ROOT and cut a
 * scalloped hole across its underside. The dome's whole job is hiding what
 * passes BEHIND the head; the face shell + cranium already own the front.
 * Every anchor clears it (binding: ear at 1.197 normalized radius);
 * occluder.test.ts asserts clearance against BOTH shells.
 */
export const HAIR_DOME: CraniumParams = {
  center: [0, 5.0, -7.0],
  radii: [8.6, 8.8, 8.0],
};

/**
 * Where `point` (head-space centimetres) sits relative to the cranium shell, as
 * the ellipsoid's own normalized radius: 1 = exactly on the surface, >1 outside
 * (safe — a prop anchored there is not swallowed), <1 inside.
 *
 * Pure, so the anchor-clearance invariant above can be a test rather than a
 * claim. Returns Infinity for a degenerate radius instead of dividing by zero.
 */
export function craniumNormalizedRadius(
  point: readonly [number, number, number],
  cranium: CraniumParams = CRANIUM,
): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const r = cranium.radii[i];
    if (!(r > 0)) return Infinity;
    const d = (point[i] - cranium.center[i]) / r;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Head-size calibration bounds — ±30% covers adult head-size variance. */
export const HEAD_SCALE_MIN = 0.85;
export const HEAD_SCALE_MAX = 1.3;

export function clampHeadScale(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(HEAD_SCALE_MAX, Math.max(HEAD_SCALE_MIN, n));
}

/**
 * Auto-fit baseline bounds. Wider than headScale (0.85–1.3) because this stores
 * the RAW tracker-fit factor captured at the host's "Apply", not a hand-tuned
 * calibration. `null` when unset or junk → no baseline → the booth's per-guest
 * transfer stays off (today's behaviour).
 */
export const BASELINE_FIT_MIN = 0.7;
export const BASELINE_FIT_MAX = 1.5;

export function clampBaselineFit(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(BASELINE_FIT_MAX, Math.max(BASELINE_FIT_MIN, n));
}

/** Per-event studio settings (app_settings key 'studio'). */
export interface StudioSettings {
  /** Multiplier on the tracked head size for the occluder + reference head. */
  headScale: number;
  /** Master occlusion switch for the event's booth. */
  occlusion: boolean;
  /**
   * Host's Apply-time tracker-fit factor (median detected head fit at
   * calibration). Present ONLY once the host used the calibration "Apply" chip;
   * absent = no auto-fit baseline, so the booth behaves exactly as before.
   */
  baselineFit?: number;
  /**
   * When a baseline exists, whether the booth transfers per-guest fit. Defaults
   * true when `baselineFit` is present; meaningless (and omitted) otherwise.
   */
  autoHeadScale?: boolean;
  /**
   * The event's shared 3D lighting rig (lib/studio/lighting.ts). Applies to the
   * booth's 3D layer, the studio's live + orbit views, the preview and the
   * jewelry builder — one value, so those five surfaces cannot disagree about
   * what a gold crown looks like.
   *
   * ALWAYS PRESENT after normalization, defaulting to 'studio'. That default is
   * safe for legacy events because the BOOTH does not read this key for them:
   * `boothLightingFor` forces 'legacy' whenever the event's source is not 'db'.
   */
  lighting: LightingPresetId;
}

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  headScale: 1,
  occlusion: true,
  lighting: DEFAULT_LIGHTING,
};

export function normalizeStudioSettings(raw: unknown): StudioSettings {
  const r = (raw ?? {}) as Partial<Record<keyof StudioSettings, unknown>>;
  const out: StudioSettings = {
    headScale: clampHeadScale(r.headScale ?? 1),
    occlusion: r.occlusion !== false,
    lighting: normalizeLightingPreset(r.lighting),
  };
  // Additive: the two auto-fit keys only appear once a baseline has been set, so
  // rows written before this feature (and legacy events) normalize IDENTICALLY
  // to before — no baselineFit, no autoHeadScale.
  const baseline = clampBaselineFit(r.baselineFit);
  if (baseline !== null) {
    out.baselineFit = baseline;
    out.autoHeadScale = r.autoHeadScale !== false; // default ON when a baseline exists
  }
  return out;
}
