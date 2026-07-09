import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeBustFit, HEAD_HEIGHT_CM } from './bustFit';

/** Build a mesh like the vendored bust: a box with a tiny native size AND a
 *  90° X-axis node rotation (the case that broke the orbit view). */
function makeRotatedBust(): THREE.Object3D {
  const geo = new THREE.BoxGeometry(1.083, 1.526, 1.911); // raw GLB bbox size
  geo.translate(0.1, -0.2, 0.3); // off-centre, like real mesh origins
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  const group = new THREE.Group();
  group.quaternion.set(0.7071068, 0, 0, 0.7071068); // 90° about X
  group.add(mesh);
  return group;
}

/** Apply a fit to a fresh clone and return the resulting WORLD bbox. */
function worldBoxAfterFit(root: THREE.Object3D, fit: { scale: number; position: [number, number, number] }) {
  const outer = new THREE.Group();
  outer.scale.setScalar(fit.scale);
  outer.position.set(...fit.position);
  outer.add(root);
  outer.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(outer);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { size, center };
}

describe('computeBustFit', () => {
  it('centres a rotated, off-origin bust at the head-space origin', () => {
    const fit = computeBustFit(makeRotatedBust())!;
    const { center } = worldBoxAfterFit(makeRotatedBust(), fit);
    expect(center.x).toBeCloseTo(0, 3);
    expect(center.y).toBeCloseTo(0, 3);
    expect(center.z).toBeCloseTo(0, 3);
  });

  it('scales the bust to average head height (~17.7cm tall)', () => {
    const fit = computeBustFit(makeRotatedBust())!;
    const { size } = worldBoxAfterFit(makeRotatedBust(), fit);
    expect(size.y).toBeCloseTo(HEAD_HEIGHT_CM, 2);
  });

  it('produces a sane, camera-safe scale (never huge/NaN)', () => {
    const fit = computeBustFit(makeRotatedBust())!;
    expect(fit.scale).toBeGreaterThan(1);
    expect(fit.scale).toBeLessThan(100);
    expect(Number.isFinite(fit.scale)).toBe(true);
  });

  it('returns null for an empty object (→ procedural fallback)', () => {
    expect(computeBustFit(new THREE.Group())).toBeNull();
  });
});
