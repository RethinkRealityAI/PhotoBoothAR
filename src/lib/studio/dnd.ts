/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure drop math for the studio's pointer drag-and-drop.
 *  - 2D drops produce exactly the booth's Transform2D semantics: x/y are % of
 *    the frame offset from centre (StageCanvas draws at w/2 + x/100*w).
 *  - 3D drops project the head anchors through the tracked head matrix and the
 *    rig camera (origin, vertical fov) to find the nearest on-screen anchor.
 * Plain-array math, no three.js import, so vitest (node) covers it.
 */
import type { HeadAnchor, Transform2D } from '../../types';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Map a pointer position inside `rect` to a centre-relative Transform2D. */
export function pointToTransform2D(
  clientX: number,
  clientY: number,
  rect: Rect,
  base: Transform2D,
): Transform2D {
  if (rect.width <= 0 || rect.height <= 0) return { ...base };
  return {
    ...base,
    x: clamp(((clientX - rect.left) / rect.width - 0.5) * 100, -100, 100),
    y: clamp(((clientY - rect.top) / rect.height - 0.5) * 100, -100, 100),
  };
}

export interface AnchorPoint {
  id: HeadAnchor;
  /** anchor offset in head space, centimetres */
  offset: readonly [number, number, number];
}

export interface ProjectedAnchor {
  id: HeadAnchor;
  /** viewport px */
  x: number;
  y: number;
  /** false when the point is behind the camera (skip it) */
  inFront: boolean;
}

/**
 * Project head anchors to viewport pixels.
 * `matrix` is the tracked head group's world matrix, column-major 16 floats
 * (THREE.Matrix4.elements layout) — already mirrored for selfie preview.
 * The rig camera sits at the origin looking down −Z with `fovDeg` vertical FOV.
 */
export function projectAnchorsToScreen(
  anchors: readonly AnchorPoint[],
  matrix: ArrayLike<number>,
  viewport: { width: number; height: number },
  fovDeg: number,
): ProjectedAnchor[] {
  const m = matrix;
  const f = (viewport.height / 2) / Math.tan(((fovDeg / 2) * Math.PI) / 180);
  return anchors.map(({ id, offset: [ax, ay, az] }) => {
    // column-major: x' = m0*x + m4*y + m8*z + m12, etc.
    const x = m[0] * ax + m[4] * ay + m[8] * az + m[12];
    const y = m[1] * ax + m[5] * ay + m[9] * az + m[13];
    const z = m[2] * ax + m[6] * ay + m[10] * az + m[14];
    const inFront = z < 0;
    const depth = inFront ? -z : 1;
    return {
      id,
      x: viewport.width / 2 + (f * x) / depth,
      y: viewport.height / 2 - (f * y) / depth,
      inFront,
    };
  });
}

/** Nearest projected anchor within `maxRadius` px of the drop point, or null. */
export function nearestAnchor(
  points: readonly ProjectedAnchor[],
  px: number,
  py: number,
  maxRadius: number,
): HeadAnchor | null {
  let best: HeadAnchor | null = null;
  let bestD = maxRadius * maxRadius;
  for (const p of points) {
    if (!p.inFront) continue;
    const dx = p.x - px;
    const dy = p.y - py;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

export type AssetClass = 'model' | 'image' | 'unknown';

/** Classify a stored asset by filename and/or mimetype. */
export function classifyAsset(name: string, mimetype?: string): AssetClass {
  const mime = (mimetype ?? '').toLowerCase();
  if (mime.includes('gltf') || mime === 'model/gltf-binary') return 'model';
  if (mime.startsWith('image/')) return 'image';
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)(?:\?.*)?$/)?.[1] ?? '';
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif'].includes(ext)) return 'image';
  return 'unknown';
}
