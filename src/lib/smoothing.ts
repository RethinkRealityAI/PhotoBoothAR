/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-Euro filtering for the AR head pose (Casiez, Roustan & Vogel, CHI 2012).
 *
 * Why not a fixed lerp: a constant blend factor is frame-rate dependent (a
 * 120 Hz display smooths twice as fast as 60 Hz) and locks one jitter-vs-lag
 * tradeoff for every motion. The One-Euro filter adapts its cutoff to speed —
 * near-still faces get a low cutoff (jitter melts away), fast head turns get a
 * high cutoff (the asset stays glued to the face instead of trailing it).
 *
 * Pure math on plain numbers/tuples — no three.js or MediaPipe imports — so it
 * runs under the vitest node environment.
 */

export interface OneEuroConfig {
  /** Cutoff (Hz) at zero speed — lower = steadier when still. */
  minCutoff: number;
  /** Cutoff gain per unit of speed — higher = snappier under motion. */
  beta: number;
  /** Cutoff (Hz) for the speed estimate itself. */
  dCutoff: number;
}

/** Exponential-smoothing factor for a first-order low-pass at `cutoffHz`,
 *  sampled `dtSec` apart. Always in [0, 1); 0 when dtSec <= 0. */
export function lowpassAlpha(cutoffHz: number, dtSec: number): number {
  if (dtSec <= 0 || cutoffHz <= 0) return 0;
  const r = 2 * Math.PI * cutoffHz * dtSec;
  return r / (r + 1);
}

export type Vec3 = [number, number, number];

/** One-Euro filter over a 3-vector (position or scale). */
export class OneEuroVec3 {
  private x: Vec3 = [0, 0, 0];
  private dx: Vec3 = [0, 0, 0];
  private hasSample = false;

  constructor(private cfg: OneEuroConfig) {}

  /** Forget history — the next sample snaps instead of gliding in. */
  reset(): void {
    this.hasSample = false;
  }

  /** Feed the raw `target` observed `dtSec` after the previous sample; writes
   *  the filtered value into `out` (also returned). */
  filter(target: Vec3, dtSec: number, out: Vec3 = [0, 0, 0]): Vec3 {
    if (!this.hasSample || dtSec <= 0) {
      this.x = [target[0], target[1], target[2]];
      this.dx = [0, 0, 0];
      this.hasSample = true;
      out[0] = target[0]; out[1] = target[1]; out[2] = target[2];
      return out;
    }
    const aD = lowpassAlpha(this.cfg.dCutoff, dtSec);
    let speedSq = 0;
    for (let i = 0; i < 3; i++) {
      const rawVel = (target[i] - this.x[i]) / dtSec; // units per second
      this.dx[i] += aD * (rawVel - this.dx[i]);
      speedSq += this.dx[i] * this.dx[i];
    }
    const cutoff = this.cfg.minCutoff + this.cfg.beta * Math.sqrt(speedSq);
    const a = lowpassAlpha(cutoff, dtSec);
    for (let i = 0; i < 3; i++) {
      this.x[i] += a * (target[i] - this.x[i]);
      out[i] = this.x[i];
    }
    return out;
  }
}

export type Quat = [number, number, number, number]; // x, y, z, w

/** One-Euro filter over a unit quaternion (head rotation). Slerp-based with a
 *  speed estimate from the angle between successive samples. */
export class OneEuroQuat {
  private q: Quat = [0, 0, 0, 1];
  private speed = 0; // filtered angular speed, rad/s
  private hasSample = false;

  constructor(private cfg: OneEuroConfig) {}

  reset(): void {
    this.hasSample = false;
  }

  filter(target: Quat, dtSec: number, out: Quat = [0, 0, 0, 1]): Quat {
    if (!this.hasSample || dtSec <= 0) {
      this.q = [target[0], target[1], target[2], target[3]];
      this.speed = 0;
      this.hasSample = true;
      out[0] = target[0]; out[1] = target[1]; out[2] = target[2]; out[3] = target[3];
      return out;
    }
    // Angle between current estimate and the new sample → raw angular speed.
    const dot = Math.min(1, Math.abs(
      this.q[0] * target[0] + this.q[1] * target[1] + this.q[2] * target[2] + this.q[3] * target[3],
    ));
    const rawSpeed = (2 * Math.acos(dot)) / dtSec; // rad/s
    this.speed += lowpassAlpha(this.cfg.dCutoff, dtSec) * (rawSpeed - this.speed);
    const cutoff = this.cfg.minCutoff + this.cfg.beta * this.speed;
    slerp(this.q, target, lowpassAlpha(cutoff, dtSec), this.q);
    out[0] = this.q[0]; out[1] = this.q[1]; out[2] = this.q[2]; out[3] = this.q[3];
    return out;
  }
}

/** Spherical interpolation `a → b` by `t`, shortest path; writes into `out`. */
export function slerp(a: Quat, b: Quat, t: number, out: Quat = [0, 0, 0, 1]): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  // Take the short way around: flip one side when the arcs oppose.
  let sign = 1;
  if (cos < 0) { cos = -cos; sign = -1; }
  let w0: number;
  let w1: number;
  if (cos > 0.9995) {
    // Nearly parallel — lerp (then normalize) avoids division by sin(θ)≈0.
    w0 = 1 - t;
    w1 = t;
  } else {
    const theta = Math.acos(cos);
    const sinTheta = Math.sin(theta);
    w0 = Math.sin((1 - t) * theta) / sinTheta;
    w1 = Math.sin(t * theta) / sinTheta;
  }
  w1 *= sign;
  let x = w0 * a[0] + w1 * b[0];
  let y = w0 * a[1] + w1 * b[1];
  let z = w0 * a[2] + w1 * b[2];
  let w = w0 * a[3] + w1 * b[3];
  const len = Math.hypot(x, y, z, w);
  if (len > 0) { x /= len; y /= len; z /= len; w /= len; }
  out[0] = x; out[1] = y; out[2] = z; out[3] = w;
  return out;
}
