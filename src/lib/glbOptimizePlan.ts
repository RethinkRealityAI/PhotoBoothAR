/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-browser 3D model optimizer — the PURE half (presets, decision rules,
 * stats phrasing). The glTF-Transform pipeline that applies them is
 * lib/glbOptimize.ts, which is browser-only and always loaded with a dynamic
 * import so it never enters the guest or host bundles. No DOM, no three.js,
 * no glTF-Transform import here — vitest runs it in node.
 */
import { IMPORT_MAX_BYTES, IMPORT_WARN_TRIANGLES, formatBytes } from './libraryImport';

export type OptimizePreset = 'balanced' | 'small';

export interface OptimizeOptions {
  preset: OptimizePreset;
  /** Longest texture edge after resizing (px). Smaller textures are left at their size. */
  maxTextureEdge: number;
  /** Canvas WebP quality, 0..1. */
  webpQuality: number;
  /** Simplify only a model ABOVE this many triangles, down to about this many. */
  triangleBudget: number;
  /** meshoptimizer error limit as a fraction of mesh radius — the simplifier
   *  stops early rather than visibly melt the silhouette. */
  simplifyError: number;
  /** glTF-Transform meshopt() level: 'high' adds the normal/rotation filters. */
  meshoptLevel: 'medium' | 'high';
}

export const OPTIMIZE_PRESETS: Readonly<Record<OptimizePreset, OptimizeOptions>> = {
  balanced: {
    preset: 'balanced',
    maxTextureEdge: 2048,
    webpQuality: 0.9,
    triangleBudget: IMPORT_WARN_TRIANGLES,
    simplifyError: 0.001,
    meshoptLevel: 'medium',
  },
  small: {
    preset: 'small',
    maxTextureEdge: 1024,
    webpQuality: 0.8,
    triangleBudget: 60_000,
    simplifyError: 0.01,
    meshoptLevel: 'high',
  },
};

export const OPTIMIZE_PRESET_LABEL: Readonly<Record<OptimizePreset, string>> = {
  balanced: 'Balanced',
  small: 'Smallest',
};

/** Below this saving the optimized copy is not worth a lossy re-encode. */
export const MIN_SAVINGS_RATIO = 0.05;
/** With "Optimize on upload" on, a file up to this size may be dropped: only
 *  the RESULT has to fit the bucket's IMPORT_MAX_BYTES. */
export const OPTIMIZE_INPUT_MAX_BYTES = 150 * 1024 * 1024;
/** The simplifier never goes below this share of the original triangles. */
const MIN_SIMPLIFY_RATIO = 0.05;

/**
 * Target ratio for meshoptimizer, or null when the model is already within
 * budget (simplifying a light model only costs detail). glTF-Transform's
 * `ratio` is a share of what to KEEP.
 */
export function simplifyRatio(triangles: number, budget: number): number | null {
  if (!(Number.isFinite(triangles) && triangles > 0 && Number.isFinite(budget) && budget > 0)) return null;
  if (triangles <= budget) return null;
  return Math.max(MIN_SIMPLIFY_RATIO, budget / triangles);
}

/** [w, h] fitted inside maxEdge (aspect kept, at least 1px), or null when it already fits. */
export function fitTextureSize(width: number, height: number, maxEdge: number): [number, number] | null {
  if (!(width > 0 && height > 0 && maxEdge > 0)) return null;
  const edge = Math.max(width, height);
  if (edge <= maxEdge) return null;
  const k = maxEdge / edge;
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

/** Image types the canvas path can decode. KTX2/Basis is passed through untouched (never emitted). */
const DECODABLE = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type TexturePlan =
  | { action: 'skip'; size?: undefined }
  | { action: 'encode'; size: [number, number] };

/**
 * What to do with one texture: re-encode PNG/JPEG to WebP (resized when it is
 * over the edge limit), resize an oversize WebP, leave everything else alone.
 */
export function planTexture(mimeType: string, width: number, height: number, maxEdge: number): TexturePlan {
  if (!DECODABLE.has(mimeType) || !(width > 0 && height > 0)) return { action: 'skip' };
  const fitted = fitTextureSize(width, height, maxEdge);
  if (mimeType === 'image/webp' && fitted === null) return { action: 'skip' };
  return { action: 'encode', size: fitted ?? [width, height] };
}

/**
 * Keep a re-encoded texture? Always when it was resized (that is the point,
 * even if a smooth PNG grew); otherwise only when the bytes actually shrank.
 */
export function keepEncodedTexture(srcBytes: number, dstBytes: number, resized: boolean): boolean {
  if (!(dstBytes > 0)) return false;
  return resized || dstBytes < srcBytes;
}

export interface OptimizeStats {
  bytesBefore: number;
  bytesAfter: number;
  trianglesBefore: number;
  trianglesAfter: number;
  /** Longest texture edge in the file (px), 0 when it has no textures. */
  textureMaxEdgeBefore: number;
  textureMaxEdgeAfter: number;
  /** Seconds spent, for the operator's patience. */
  seconds: number;
}

/** Whole-percent saving, 0 when nothing was saved (never negative, never NaN). */
export function savingsPercent(before: number, after: number): number {
  if (!(before > 0) || !(after >= 0) || after >= before) return 0;
  return Math.round((1 - after / before) * 100);
}

/** True when the optimized copy is worth using: meaningfully smaller and within the bucket cap. */
export function worthKeeping(stats: Pick<OptimizeStats, 'bytesBefore' | 'bytesAfter'>): boolean {
  return stats.bytesAfter > 0
    && stats.bytesAfter <= IMPORT_MAX_BYTES
    && stats.bytesAfter <= stats.bytesBefore * (1 - MIN_SAVINGS_RATIO);
}

/** "38 MB → 4.1 MB (−89%)" */
export function formatSaving(before: number, after: number): string {
  const pct = savingsPercent(before, after);
  return `${formatBytes(before)} → ${formatBytes(after)}${pct > 0 ? ` (−${pct}%)` : ''}`;
}

export function formatTriangles(n: number): string {
  if (!(n > 0)) return '0 triangles';
  return n >= 1000 ? `${Math.round(n / 1000)}k triangles` : `${n} triangles`;
}

export function formatTextureEdge(px: number): string {
  return px > 0 ? `${px}px textures` : 'No textures';
}

/**
 * The GLB's `extensionsUsed`, read from its JSON chunk without parsing the
 * rest — enough to know whether the Draco decoder must be loaded before the
 * file can be opened. Total: anything malformed returns [].
 */
export function glbExtensionsUsed(bytes: Uint8Array): string[] {
  if (bytes.length < 20) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return []; // "glTF"
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4e4f534a || 20 + chunkLength > bytes.length) return []; // "JSON"
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength))) as { extensionsUsed?: unknown };
    return Array.isArray(json.extensionsUsed) ? json.extensionsUsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}
