/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * STEADY head-pose filter for a frame-locked rig. PURE: no DOM, no three.js.
 *
 * WHY (measured on raw 8th Wall poses, the same clips with and without added
 * camera-sensor noise, 960px-tall frame, face ~47cm away): a frame-locked rig
 * that shows the RAW pose keeps a nose-level prop within 0.5px on a still face,
 * but a hat's crown wobbles 1.3px and a brim 1.9px. The noise is not uniform:
 *   - image-plane position of the FACE: ~0.01-0.06cm  (tiny — the tracker fits it)
 *   - DEPTH: ~0.33cm (0.7%), which moves every point radially from the image
 *     centre, i.e. the head "breathes"; the further a prop sits from the face
 *     the more pixels that is
 *   - pitch / yaw: ~0.25°, which swings a prop by its lever arm from the face
 * So masks and glasses look locked while hats shimmer. A uniform low-pass
 * ('light') halves the wobble but drags face-level props 1-3px behind their own
 * frame in motion.
 *
 * WHAT: split the pose about a PIVOT on the face (where the tracker is exact):
 *   1. the pivot's image position (x/z, y/z) is kept RAW — face-level props stay
 *      registered with the frame they were computed from;
 *   2. the pivot's DEPTH gets a heavy One-Euro (depth lag only shows as size lag);
 *   3. the ROTATION gets a moderate One-Euro about the pivot, so its lag is zero
 *      at the face and grows with the lever arm.
 * Result on the same clips (still, noisy): crown 1.31 -> 0.24px, brim 1.87 ->
 * 0.45px, nose 0.50 -> 0.31px. In motion (roll clip) the crown trails 2.5px
 * (light: 3.0, standard: 7.0) and the nose 0.26px (light: 0.96).
 */
import { OneEuroVec3, OneEuroQuat, type OneEuroConfig, type Quat, type Vec3 } from './smoothing';

/** Head-space pivot (canonical cm): between the eyes and the nose tip, on the face surface. */
export const STEADY_PIVOT: Readonly<Vec3> = [0, 1, 5];
/** Depth: cm and cm/s. Low cutoff at rest, opens as the guest moves toward/away. */
export const STEADY_DEPTH_FILTER: OneEuroConfig = { minCutoff: 0.5, beta: 0.15, dCutoff: 1.0 };
/** Rotation: rad/s. */
export const STEADY_ROT_FILTER: OneEuroConfig = { minCutoff: 1.0, beta: 3.0, dCutoff: 1.0 };

/** v rotated by the unit quaternion q, into out. */
function rotate(q: Quat, v: Readonly<Vec3>, out: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
  out[0] = v[0] + 2 * (w * cx + y * cz - z * cy);
  out[1] = v[1] + 2 * (w * cy + z * cx - x * cz);
  out[2] = v[2] + 2 * (w * cz + x * cy - y * cx);
  return out;
}

export class SteadyPoseFilter {
  private depth = new OneEuroVec3(STEADY_DEPTH_FILTER);
  private rot = new OneEuroQuat(STEADY_ROT_FILTER);
  private zIn: Vec3 = [0, 0, 0];
  private zOut: Vec3 = [0, 0, 0];
  private qOut: Quat = [0, 0, 0, 1];
  private a: Vec3 = [0, 0, 0];
  private b: Vec3 = [0, 0, 0];

  reset(): void {
    this.depth.reset();
    this.rot.reset();
  }

  /**
   * One NEW raw sample (head origin `pos` in camera-space cm, unit `quat`) ->
   * the steadied pose, written into outPos / outQuat. The first sample after a
   * reset passes through unchanged. A pivot at or behind the camera plane (never
   * a real face) also passes through, so a bad sample cannot divide by zero.
   */
  filter(pos: Readonly<Vec3>, quat: Readonly<Quat>, dtSec: number, outPos: Vec3, outQuat: Quat): void {
    const q = quat as Quat;
    // Pivot in camera space under the RAW pose.
    const pr = rotate(q, STEADY_PIVOT, this.a);
    const px = pos[0] + pr[0], py = pos[1] + pr[1], pz = pos[2] + pr[2];
    this.rot.filter(q, dtSec, this.qOut);
    const n = Math.hypot(this.qOut[0], this.qOut[1], this.qOut[2], this.qOut[3]) || 1;
    outQuat[0] = this.qOut[0] / n; outQuat[1] = this.qOut[1] / n; outQuat[2] = this.qOut[2] / n; outQuat[3] = this.qOut[3] / n;
    let fx = px, fy = py, fz = pz;
    if (pz < -1e-6) {
      this.zIn[0] = pz;
      const z = this.depth.filter(this.zIn, dtSec, this.zOut)[0];
      if (z < -1e-6) {
        const k = z / pz; // keeps the pivot's image position (x/z, y/z) raw
        fx = px * k; fy = py * k; fz = z;
      }
    }
    // Back to the head origin under the FILTERED rotation.
    const pf = rotate(outQuat, STEADY_PIVOT, this.b);
    outPos[0] = fx - pf[0]; outPos[1] = fy - pf[1]; outPos[2] = fz - pf[2];
  }
}
