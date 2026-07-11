/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure per-object animation math for booth layers/pieces. Deterministic (the
 * caller passes `tSec`, typically `performance.now() / 1000`), so this file
 * has zero three/react imports and is unit-testable in plain node/vitest.
 * Rendered identically in the studio live preview and the guest booth.
 */
import type { Transform2D, LayerAnimation } from '../../types';

/** 2D animation applied on top of a layer's static Transform2D. 'none' is a no-op. */
export function animateTransform2D(base: Transform2D, preset: LayerAnimation, tSec: number): Transform2D {
  switch (preset) {
    case 'float': {
      // Gentle vertical bob: ~1.2% of frame height amplitude, ~0.5Hz.
      const bob = 1.2 * Math.sin(2 * Math.PI * 0.5 * tSec);
      return { ...base, y: base.y + bob };
    }
    case 'pulse': {
      // Breathing scale: ±4% at 0.8Hz.
      const mul = 1 + 0.04 * Math.sin(2 * Math.PI * 0.8 * tSec);
      return { ...base, scale: base.scale * mul };
    }
    case 'spin': {
      // Continuous rotation at 20°/s, wrapped into [-180, 180].
      const deg = wrapDeg(base.rotation + 20 * tSec);
      return { ...base, rotation: deg };
    }
    case 'none':
    default:
      return base;
  }
}

/** Wrap a degree value into [-180, 180]. */
function wrapDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  // Normalize -180 to 180 for a stable, symmetric range.
  if (d === -180) d = 180;
  return d;
}

export interface Animate3DResult {
  /** Local-space offset added on top of the piece's static anchor transform, in centimetres. */
  position: [number, number, number];
  /** Additional Y-axis rotation, in radians. */
  rotationY: number;
  /** Multiplier applied on top of the piece's static scale. */
  scaleMul: number;
}

const IDENTITY_3D: Animate3DResult = { position: [0, 0, 0], rotationY: 0, scaleMul: 1 };

/** 3D animation applied on top of a piece's static AnchorConfig-derived transform. */
export function animate3D(preset: LayerAnimation, tSec: number): Animate3DResult {
  switch (preset) {
    case 'float': {
      // Vertical bob: ±0.6cm at 0.5Hz.
      const y = 0.6 * Math.sin(2 * Math.PI * 0.5 * tSec);
      return { position: [0, y, 0], rotationY: 0, scaleMul: 1 };
    }
    case 'pulse': {
      // Breathing scale: ±4% at 0.8Hz.
      const scaleMul = 1 + 0.04 * Math.sin(2 * Math.PI * 0.8 * tSec);
      return { position: [0, 0, 0], rotationY: 0, scaleMul };
    }
    case 'spin': {
      // Continuous Y rotation at 0.6 rad/s.
      return { position: [0, 0, 0], rotationY: 0.6 * tSec, scaleMul: 1 };
    }
    case 'none':
    default:
      return IDENTITY_3D;
  }
}
