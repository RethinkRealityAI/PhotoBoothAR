/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure fit math for the 3D reference bust. A GLB commonly carries a node
 * rotation and a tiny native scale (our Higgsfield bust has a 90° X-axis
 * rotation and a ~1.9-unit bbox); measuring its bounding box WITHOUT first
 * updating the world matrix ignores those transforms, so the bust ends up
 * mis-centred and the orbit camera looks at empty space (black) or lands
 * inside the mesh. This computes the fit from the true, transformed world
 * bbox so the bust is always ~17.7cm tall and centred at the head-space origin.
 */
import * as THREE from 'three';

/** Average adult crown-to-chin height, in the tracker's centimetre space. */
export const HEAD_HEIGHT_CM = 17.7;

export interface BustFit {
  scale: number;
  position: [number, number, number];
}

/**
 * Target size for an auto-fitted user prop (crown / hat / trophy class):
 * largest world dimension lands at ~24cm — deliberately LARGER than head
 * width (~14cm) because user testing found head-width props read far too
 * small next to a real face — always adjustable afterwards.
 */
export const PROP_TARGET_CM = 24;
/** Clamp bounds mirrored by the booth's decompose clamp (faceRig.ts
 *  PROP_SCALE_MIN/MAX). MAX must let a small ~0.5-unit Meshy model reach
 *  PROP_TARGET_CM (24/0.5 = 48), hence 50. */
const PROP_SCALE_MIN = 0.05;
const PROP_SCALE_MAX = 50;

/**
 * Auto-fit scale for a placed 3D prop. Meshy/uploaded GLBs are commonly ~1
 * unit tall, which renders ~1cm in head space — invisible. Returns the scale
 * that puts the largest dimension at PROP_TARGET_CM, clamped to the prop-scale
 * bounds above, or null when the object has no measurable extent.
 */
export function computePropFitScale(root: THREE.Object3D): number | null {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return null;
  return Math.min(PROP_SCALE_MAX, Math.max(PROP_SCALE_MIN, PROP_TARGET_CM / maxDim));
}

/** Fit any loaded object (with arbitrary node transforms) to head space. */
export function computeBustFit(root: THREE.Object3D): BustFit | null {
  // Critical: fold every node's local transform into world matrices first.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  if (!Number.isFinite(size.y) || size.y <= 0) return null;
  const scale = HEAD_HEIGHT_CM / size.y;
  return { scale, position: [-center.x * scale, -center.y * scale, -center.z * scale] };
}
