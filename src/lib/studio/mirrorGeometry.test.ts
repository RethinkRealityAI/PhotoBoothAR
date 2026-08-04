/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { _clearMirrorCache, mirrorGeometryX, mirrorObjectX, mirrorPoint } from './mirrorGeometry';

/** Signed volume of a triangle soup — its SIGN is the winding, so it is the
 *  one number that proves faces did not end up inside-out. */
function signedVolume(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const count = idx ? idx.count : pos.count;
  const at = (i: number) => {
    const v = idx ? idx.getX(i) : i;
    return [pos.getX(v), pos.getY(v), pos.getZ(v)] as const;
  };
  let vol = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const [ax, ay, az] = at(i);
    const [bx, by, bz] = at(i + 1);
    const [cx, cy, cz] = at(i + 2);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

function indexedBox(): THREE.BufferGeometry {
  // Off-centre so mirroring is observable in the bounding box.
  const g = new THREE.BoxGeometry(2, 1, 1).toNonIndexed();
  const indexed = new THREE.BoxGeometry(2, 1, 1);
  indexed.translate(3, 0, 0);
  g.dispose();
  return indexed;
}

describe('mirrorGeometryX', () => {
  it('mirrors positions through the YZ plane without touching the source', () => {
    const src = indexedBox();
    const srcBoxBefore = src.boundingBox ?? (src.computeBoundingBox(), src.boundingBox!);
    const minXBefore = srcBoxBefore.min.x;
    const out = mirrorGeometryX(src);
    expect(out).not.toBe(src);
    expect(out.boundingBox!.min.x).toBeCloseTo(-srcBoxBefore.max.x, 6);
    expect(out.boundingBox!.max.x).toBeCloseTo(-minXBefore, 6);
    // The source is shared with the glbCache master: mutating it would restyle
    // every other copy of the model in the app.
    src.computeBoundingBox();
    expect(src.boundingBox!.min.x).toBeCloseTo(minXBefore, 6);
    _clearMirrorCache(src);
  });

  it('reverses winding so faces stay front-facing (signed volume keeps its sign)', () => {
    const src = indexedBox();
    const before = signedVolume(src);
    const after = signedVolume(mirrorGeometryX(src));
    expect(Math.abs(after)).toBeCloseTo(Math.abs(before), 5);
    // Without the winding reversal this sign would flip — the "inside-out
    // asset" bug that `scale.x = -1` produces.
    expect(Math.sign(after)).toBe(Math.sign(before));
    _clearMirrorCache(src);
  });

  it('negates normal x and flips tangent handedness', () => {
    const src = new THREE.BufferGeometry();
    src.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    src.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0.6, 0.8, 0, 0.6, 0.8, 0, 0.6, 0.8, 0]), 3));
    src.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]), 4));
    const out = mirrorGeometryX(src);
    expect(out.getAttribute('normal').getX(0)).toBeCloseTo(-0.6, 6);
    expect(out.getAttribute('normal').getY(0)).toBeCloseTo(0.8, 6);
    expect(out.getAttribute('tangent').getX(0)).toBeCloseTo(-1, 6);
    expect(out.getAttribute('tangent').getW(0)).toBeCloseTo(-1, 6);
    _clearMirrorCache(src);
  });

  it('PRESERVES vertex order so packed region ids stay aligned (indexed)', () => {
    // regionTint's bytes are positional — byte i belongs to vertex i. A mirror
    // that reordered vertices would repaint the gauntlet's core onto its cuff.
    const src = new THREE.BufferGeometry();
    src.setAttribute('position', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]), 3));
    src.setAttribute('aRegion', new THREE.BufferAttribute(new Float32Array([0, 1, 2, 3]), 1));
    src.setIndex([0, 1, 2, 1, 2, 3]);
    const out = mirrorGeometryX(src);
    const region = out.getAttribute('aRegion');
    expect([region.getX(0), region.getX(1), region.getX(2), region.getX(3)]).toEqual([0, 1, 2, 3]);
    const pos = out.getAttribute('position');
    expect([pos.getX(0), pos.getX(1), pos.getX(2), pos.getX(3)]).toEqual([-1, -2, -3, -4]);
    // Winding reversed in the index buffer only.
    expect(Array.from(out.getIndex()!.array)).toEqual([0, 2, 1, 1, 3, 2]);
    _clearMirrorCache(src);
  });

  it('non-indexed: a vertex carries ALL of its own attributes when swapped', () => {
    const src = new THREE.BufferGeometry();
    src.setAttribute('position', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 2, 0, 0, 3, 0, 0]), 3));
    src.setAttribute('aRegion', new THREE.BufferAttribute(new Float32Array([7, 8, 9]), 1));
    const out = mirrorGeometryX(src);
    const pos = out.getAttribute('position');
    const region = out.getAttribute('aRegion');
    // Vertices 1 and 2 swapped places; each kept its own region id.
    expect([pos.getX(0), pos.getX(1), pos.getX(2)]).toEqual([-1, -3, -2]);
    expect([region.getX(0), region.getX(1), region.getX(2)]).toEqual([7, 9, 8]);
    _clearMirrorCache(src);
  });

  it('caches per source geometry so N instances cost one copy', () => {
    const src = indexedBox();
    expect(mirrorGeometryX(src)).toBe(mirrorGeometryX(src));
    _clearMirrorCache(src);
  });
});

describe('mirrorObjectX', () => {
  it('swaps geometry on every mesh in the tree', () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(indexedBox());
    const b = new THREE.Mesh(indexedBox());
    root.add(a);
    a.add(b);
    const [ga, gb] = [a.geometry, b.geometry];
    mirrorObjectX(root);
    expect(a.geometry).not.toBe(ga);
    expect(b.geometry).not.toBe(gb);
    a.geometry.computeBoundingBox();
    expect(a.geometry.boundingBox!.max.x).toBeLessThan(0); // was entirely at +x
    _clearMirrorCache(ga);
    _clearMirrorCache(gb);
  });
});

describe('mirrorPoint', () => {
  it('mirrors an emitter point with the mesh', () => {
    // The gauntlet's palm emitter must follow the geometry, or a mirrored
    // right-hand gauntlet would blast out of the back of the hand.
    expect(mirrorPoint([0.026, -0.22, 0.366])).toEqual([-0.026, -0.22, 0.366]);
  });
});
