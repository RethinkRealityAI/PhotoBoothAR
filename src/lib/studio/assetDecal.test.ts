/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the PURE half of assetDecal — the unit conversion whose space
 * mix-up rendered engravings as giant sheared fragments (see unitsPerCm's
 * docblock). Decal carving itself needs a real mesh + canvas and is exercised
 * in the browser; the conversion is exactly the part a node test can pin.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { unitsPerCm } from './assetDecal';

/** A mesh whose geometry spans the given size on x. */
function meshOfWidth(width: number): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([0, 0, 0, width, 0, 0, 0, width / 4, 0]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Mesh(geometry);
}

describe('unitsPerCm — MESH-LOCAL units per centimetre', () => {
  it('measures the geometry, not the template: 2 units across at 20cm is 0.1/cm', () => {
    expect(unitsPerCm(meshOfWidth(2), 20)).toBeCloseTo(0.1, 10);
  });

  it('IGNORES every transform above and on the mesh — the booth head-rig regression', () => {
    // In the booth the rig's world units are centimetres and ancestors scale the
    // piece to the guest's head. The old world-space measurement multiplied all
    // of that into the conversion, and an "8cm" line landed at several times the
    // size of the whole model. The decal is carved in the mesh's rest pose, so
    // the conversion must not move when the world does.
    const mesh = meshOfWidth(2);
    const rig = new THREE.Group();
    rig.scale.setScalar(13.8);
    rig.add(mesh);
    mesh.scale.setScalar(2);
    rig.updateMatrixWorld(true);
    expect(unitsPerCm(mesh, 20)).toBeCloseTo(0.1, 10);
  });

  it('matches the authored numbers of both shipped assets', () => {
    // reference-head.glb: 1.9106 units at 24cm -> "6cm is 0.48 units" (the
    // demo slot's own docblock); baseball-cap.glb: 1.8834 units at 26cm.
    expect(6 * unitsPerCm(meshOfWidth(1.9106), 24)).toBeCloseTo(0.478, 3);
    expect(8 * unitsPerCm(meshOfWidth(1.8834), 26)).toBeCloseTo(0.5795, 3);
  });

  it('falls back to 1 for a degenerate geometry or size rather than Infinity', () => {
    expect(unitsPerCm(meshOfWidth(0), 20)).toBe(1);
    expect(unitsPerCm(meshOfWidth(2), 0)).toBe(1);
    expect(unitsPerCm(new THREE.Mesh(), 20)).toBe(1);
  });
});
