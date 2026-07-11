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
 */

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
 * Radii/centre are centimetres in head space, sized to stay just INSIDE an
 * average head so surface-mounted props (crowns at y≈8.3, glasses at z≈5.8)
 * are never swallowed: front z reaches +5.0 (behind the face shell's +7.6),
 * sides ±7.2 (inside the ears at ±7.7), top +9.5, back −10.5.
 */
export interface CraniumParams {
  center: [number, number, number];
  radii: [number, number, number];
}

export const CRANIUM: CraniumParams = {
  center: [0, 0.5, -2.75],
  radii: [7.2, 9.0, 7.75],
};

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
}

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  headScale: 1,
  occlusion: true,
};

export function normalizeStudioSettings(raw: unknown): StudioSettings {
  const r = (raw ?? {}) as Partial<Record<keyof StudioSettings, unknown>>;
  const out: StudioSettings = {
    headScale: clampHeadScale(r.headScale ?? 1),
    occlusion: r.occlusion !== false,
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
