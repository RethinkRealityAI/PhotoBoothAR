/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * decomposeAnchorMatrix — the gizmo's drag→state math. The scale channel is
 * driven by drei's per-axis scale spheres (ONE axis moves per drag), so the
 * uniform scale must follow the OUTLIER axis; the old 3-axis average diluted
 * every drag to 1/3 and, stacked with drei's world-space drag damping, made
 * the scale handles read as dead (W7 bug).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { composeAnchorMatrix, decomposeAnchorMatrix, medianOf } from './faceRig';

const ZERO: [number, number, number] = [0, 0, 0];

/** Matrix with uniform base scale s0 and one axis dragged to s1. */
function draggedMatrix(axis: 'x' | 'y' | 'z', s0: number, s1: number): THREE.Matrix4 {
  const scale = new THREE.Vector3(s0, s0, s0);
  scale[axis] = s1;
  return new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion(), scale);
}

describe('decomposeAnchorMatrix scale (gizmo drag)', () => {
  it('a single-axis GROW drag maps 1:1 onto the uniform scale (not ÷3)', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(decomposeAnchorMatrix(ZERO, draggedMatrix(axis, 1, 2)).scale).toBeCloseTo(2, 3);
    }
  });

  it('a single-axis SHRINK drag from an enlarged base follows the dragged axis', () => {
    // Base uniform 3, one axis dragged down to 2.4 — the outlier is the
    // dragged axis, NOT the two untouched ones (a deviation-from-1 heuristic
    // would wrongly keep 3 here and the handle would be dead when shrinking).
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(decomposeAnchorMatrix(ZERO, draggedMatrix(axis, 3, 2.4)).scale).toBeCloseTo(2.4, 3);
    }
  });

  it('an untouched uniform matrix round-trips its scale exactly', () => {
    const m = composeAnchorMatrix(ZERO, { x: 1, y: -2, z: 0.5 }, { x: 0.1, y: 0.2, z: 0.3 }, 5.5);
    const out = decomposeAnchorMatrix(ZERO, m);
    expect(out.scale).toBeCloseTo(5.5, 3);
    expect(out.offset.x).toBeCloseTo(1, 3);
    expect(out.rotation.z).toBeCloseTo(0.3, 3);
  });
});

describe('decomposeAnchorMatrix scale clamp (studio bounds)', () => {
  // drei's scaleLimits clamp the per-drag MULTIPLIER, not the absolute scale,
  // and its accumulator resets each gizmo mount — so an auto-fit base (~14)
  // dragged once composes to base×15 ≈ 210. Clamp to [0.05, 15] at the source.
  it('clamps a runaway dragged scale down to the studio max (15)', () => {
    expect(decomposeAnchorMatrix(ZERO, draggedMatrix('y', 14, 210)).scale).toBeCloseTo(15, 3);
  });
  it('clamps a collapsed dragged scale up to the studio min (0.05)', () => {
    expect(decomposeAnchorMatrix(ZERO, draggedMatrix('x', 1, 0.001)).scale).toBeCloseTo(0.05, 3);
  });
  it('leaves an in-range dragged scale untouched', () => {
    expect(decomposeAnchorMatrix(ZERO, draggedMatrix('z', 1, 7)).scale).toBeCloseTo(7, 3);
  });
});

describe('medianOf (head-fit estimator)', () => {
  const scratch = () => new Float32Array(45);

  it('odd count returns the middle of the sorted values (input unsorted)', () => {
    expect(medianOf([3, 1, 2], 3, scratch())).toBeCloseTo(2, 6);
    expect(medianOf([1.2, 0.9, 1.0, 1.1, 0.95], 5, scratch())).toBeCloseTo(1.0, 6);
  });

  it('even count averages the two middle sorted values', () => {
    expect(medianOf([4, 1, 3, 2], 4, scratch())).toBeCloseTo(2.5, 6);
  });

  it('only considers the first n entries — stale ring tail is ignored', () => {
    // Ring physically holds [1,1,1, 9,9], but n=3 so the 9s (unwritten/stale) don't count.
    expect(medianOf([1, 1, 1, 9, 9], 3, scratch())).toBeCloseTo(1, 6);
  });

  it('clamps n to the buffers and returns 0 for a non-positive count', () => {
    expect(medianOf([5, 6], 99, scratch())).toBeCloseTo(5.5, 6); // n over-length → uses both
    expect(medianOf([5, 6], 0, scratch())).toBe(0);
    expect(medianOf([], 0, scratch())).toBe(0);
  });

  it('does not mutate the source buffer', () => {
    const src = new Float32Array([3, 1, 2]);
    medianOf(src, 3, scratch());
    expect(Array.from(src)).toEqual([3, 1, 2]);
  });

  it('a single sample is its own median', () => {
    expect(medianOf([1.07], 1, scratch())).toBeCloseTo(1.07, 6);
  });
});
