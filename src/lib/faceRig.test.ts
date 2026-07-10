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
import { composeAnchorMatrix, decomposeAnchorMatrix } from './faceRig';

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
