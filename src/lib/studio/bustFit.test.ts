import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeBustFit, computePropFitScale, HEAD_HEIGHT_CM, PROP_TARGET_CM } from './bustFit';

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

/** A bare box mesh of the given dimensions (world axis-aligned). */
function makeBox(w: number, h: number, d: number): THREE.Object3D {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
}

describe('computePropFitScale', () => {
  it('fits a raw ~1-unit Meshy model so its largest dimension is PROP_TARGET_CM', () => {
    const scale = computePropFitScale(makeBox(0.6, 1.0, 0.4))!;
    expect(scale).toBeCloseTo(PROP_TARGET_CM / 1.0, 4);
  });

  it('uses the LARGEST dimension regardless of axis', () => {
    const scale = computePropFitScale(makeBox(2.0, 0.5, 0.5))!;
    expect(scale).toBeCloseTo(PROP_TARGET_CM / 2.0, 4);
  });

  it('leaves an already-cm-sized model near scale 1', () => {
    const scale = computePropFitScale(makeBox(10, PROP_TARGET_CM, 6))!;
    expect(scale).toBeCloseTo(1, 4);
  });

  it('honours node transforms when measuring (rotated tiny bust case)', () => {
    const scale = computePropFitScale(makeRotatedBust())!;
    // Rotated 90° about X: raw depth 1.911 becomes world height; still the max.
    expect(scale).toBeCloseTo(PROP_TARGET_CM / 1.911, 3);
  });

  it('clamps to the prop-scale bounds (0.05–50, mirrored in faceRig.ts)', () => {
    expect(computePropFitScale(makeBox(0.01, 0.01, 0.01))).toBe(50);
    expect(computePropFitScale(makeBox(5000, 5000, 5000))).toBe(0.05);
  });

  it('lets a small ~0.5-unit Meshy model reach the full PROP_TARGET_CM', () => {
    const scale = computePropFitScale(makeBox(0.5, 0.3, 0.2))!;
    expect(scale).toBeCloseTo(PROP_TARGET_CM / 0.5, 4); // 48 — must NOT be clamped
  });

  it('returns null for an empty object (caller keeps legacy scale 1)', () => {
    expect(computePropFitScale(new THREE.Group())).toBeNull();
  });
});
