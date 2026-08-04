/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MIRROR — one asset, both hands.
 *
 * A generated gauntlet (or glove, or watch) models exactly one hand. Shipping a
 * second GLB for the other hand doubles a 12 MB download for geometry we
 * already have, and doubles every downstream artefact: descriptor, region ids,
 * measured refLuminance, emitter point, thumbnail.
 *
 * ## Why not `scale.x = -1`
 *
 * A negative scale is the obvious trick and it is wrong in a specific,
 * hard-to-debug way: it reverses triangle winding, so every face becomes a
 * back-face. three's renderer culls back-faces by default, so the asset turns
 * inside-out — you see its interior. Forcing `side: DoubleSide` hides that but
 * then lights the mesh from the wrong side of its own surface, and it silently
 * breaks the region-tint patch's assumptions about which face is front.
 *
 * So we mirror the GEOMETRY: negate x on positions and normals, flip the
 * tangent handedness, and reverse the winding to compensate. The result is a
 * genuine right-handed mesh that renders through the identical material,
 * shader patch and lighting path as the original.
 *
 * ## Vertex ORDER is preserved, deliberately
 *
 * The per-vertex region ids (regionTint's packed bytes) are positional: byte i
 * belongs to vertex i. Mirroring must therefore never reorder vertices. The
 * indexed path touches only the index buffer, so order is untouched; the
 * non-indexed path swaps whole vertices (every attribute together), so each
 * vertex keeps its own id. Both keep `aRegion` valid — which is what lets a
 * mirrored gauntlet still recolour its energy core.
 *
 * The source geometry is SHARED with the glbCache master (Object3D.clone(true)
 * shares geometry), so this never mutates its input. Results are cached per
 * source geometry, so N mirrored instances of one asset cost one extra copy.
 */
import * as THREE from 'three';

/** Mirrored variants, keyed by the source geometry (weak: freed with the cache). */
const mirrorCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function negateComponent(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, component: 'x' | 'w') {
  const set = component === 'x' ? attr.setX.bind(attr) : attr.setW.bind(attr);
  const get = component === 'x' ? attr.getX.bind(attr) : attr.getW.bind(attr);
  for (let i = 0; i < attr.count; i++) set(i, -get(i));
  attr.needsUpdate = true;
}

/**
 * A NEW geometry mirrored through the YZ plane (x → −x), with winding reversed
 * so faces stay front-facing. Never mutates `src`. Repeat calls for the same
 * source return the same cached result.
 */
export function mirrorGeometryX(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = mirrorCache.get(src);
  if (cached) return cached;

  const g = src.clone();

  const position = g.getAttribute('position');
  if (position) negateComponent(position, 'x');
  const normal = g.getAttribute('normal');
  if (normal) negateComponent(normal, 'x');
  // Tangents are vec4 (xyz + handedness in w). Mirroring flips BOTH the x
  // component and the handedness sign; getting only one of them wrong inverts
  // normal-mapped detail rather than mirroring it.
  const tangent = g.getAttribute('tangent');
  if (tangent && tangent.itemSize === 4) {
    negateComponent(tangent, 'x');
    negateComponent(tangent, 'w');
  }

  const index = g.getIndex();
  if (index) {
    // Indexed: reversing each triangle's last two indices restores the winding
    // and leaves the vertex buffers (and therefore the region ids) untouched.
    for (let i = 0; i + 2 < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
  } else {
    // Non-indexed: swap the 2nd and 3rd vertex of every triangle across EVERY
    // attribute at once, so a vertex carries all of its own data with it.
    for (const name of Object.keys(g.attributes)) {
      const attr = g.getAttribute(name);
      const size = attr.itemSize;
      for (let tri = 0; tri + 2 < attr.count; tri += 3) {
        for (let c = 0; c < size; c++) {
          const a = attr.getComponent(tri + 1, c);
          attr.setComponent(tri + 1, c, attr.getComponent(tri + 2, c));
          attr.setComponent(tri + 2, c, a);
        }
      }
      attr.needsUpdate = true;
    }
  }

  g.computeBoundingBox();
  g.computeBoundingSphere();
  mirrorCache.set(src, g);
  return g;
}

/**
 * Mirror every mesh under `root` IN PLACE, swapping each mesh's geometry for
 * its mirrored variant. `root` must already be a per-instance clone (FaceRig's
 * `Model` clones before it styles), never the cache master.
 */
export function mirrorObjectX(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry) {
      obj.geometry = mirrorGeometryX(obj.geometry);
    }
  });
}

/** A GLB-local point mirrored with the mesh (used for beam emitters). */
export function mirrorPoint(p: readonly [number, number, number]): [number, number, number] {
  return [-p[0], p[1], p[2]];
}

/** Test hygiene only — the WeakMap otherwise lives as long as its geometries. */
export function _clearMirrorCache(g: THREE.BufferGeometry): void {
  mirrorCache.delete(g);
}
