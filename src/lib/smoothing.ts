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

/* ── Latency compensation ─────────────────────────────────────────────────
 * A tracked pose is always OLD by the time it is drawn: the camera frame it
 * came from was captured, decoded, inferred on (a blocking call), then
 * filtered — on a phone that is 60–120ms behind the video the guest sees drawn
 * right beside it, and the trail during a head turn is that lag times the
 * speed. The filters above trade lag for steadiness; they cannot remove the
 * pipeline lag itself. Dead reckoning can: every DETECTION carries a velocity
 * estimate, and each render frame extrapolates the filtered pose forward by how
 * stale the sample is (a real, measured age) plus a small fixed bias for the
 * inference block. At rest the velocity is ~0 and the prediction IS the
 * filtered pose — no jitter is added; under motion it closes most of the
 * trail. Both steps and angles are capped so a stalled detector cannot fling a
 * prop off the face.
 *
 * Feed the estimators ONLY on new detections: stepping them per render frame
 * reads zero motion between samples and the prediction collapses to nothing.
 */

/** Velocity (units per second) of a sampled 3-vector, low-passed at `cutoffHz`. */
export class VelocityVec3 {
  private prev: Vec3 = [0, 0, 0];
  private hasPrev = false;
  /** Current estimate, units/s. Read-only by convention; reused, never reallocated. */
  readonly v: Vec3 = [0, 0, 0];

  constructor(private cutoffHz: number) {}

  reset(): void {
    this.hasPrev = false;
    this.v[0] = 0; this.v[1] = 0; this.v[2] = 0;
  }

  /** A NEW sample observed `dtSec` after the previous one (seconds). The first
   *  sample only seeds; a non-positive dt (duplicate timestamp) is ignored. */
  push(sample: Vec3, dtSec: number): void {
    if (!this.hasPrev) {
      this.prev = [sample[0], sample[1], sample[2]];
      this.hasPrev = true;
      this.v[0] = 0; this.v[1] = 0; this.v[2] = 0;
      return;
    }
    if (dtSec <= 0) return;
    const a = lowpassAlpha(this.cutoffHz, dtSec);
    for (let i = 0; i < 3; i++) {
      const raw = (sample[i] - this.prev[i]) / dtSec; // units per second
      this.v[i] += a * (raw - this.v[i]);
      this.prev[i] = sample[i];
    }
  }

  /** `from` carried along the current velocity for `leadSec`, each axis's
   *  displacement capped at ±`maxStep` (same units as the vector). */
  predict(from: Vec3, leadSec: number, maxStep: number, out: Vec3): Vec3 {
    for (let i = 0; i < 3; i++) {
      const d = this.v[i] * leadSec;
      out[i] = from[i] + Math.max(-maxStep, Math.min(maxStep, d));
    }
    return out;
  }
}

/** Hamilton product a ⊗ b, written into `out` (x, y, z, w). */
function quatMul(a: Quat, b: Quat, out: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Angular velocity (a world-frame axis × rate vector, rad/s) of a sampled
 *  unit quaternion, low-passed at `cutoffHz`. */
export class VelocityQuat {
  private prev: Quat = [0, 0, 0, 1];
  private hasPrev = false;
  /** Current estimate, rad/s about each world axis. Reused, never reallocated. */
  readonly w: Vec3 = [0, 0, 0];
  private readonly _conj: Quat = [0, 0, 0, 1];
  private readonly _delta: Quat = [0, 0, 0, 1];

  constructor(private cutoffHz: number) {}

  reset(): void {
    this.hasPrev = false;
    this.w[0] = 0; this.w[1] = 0; this.w[2] = 0;
  }

  push(q: Quat, dtSec: number): void {
    if (!this.hasPrev) {
      this.prev[0] = q[0]; this.prev[1] = q[1]; this.prev[2] = q[2]; this.prev[3] = q[3];
      this.hasPrev = true;
      this.w[0] = 0; this.w[1] = 0; this.w[2] = 0;
      return;
    }
    if (dtSec <= 0) return;
    // World-frame rotation taking prev to q: delta = q ⊗ conj(prev).
    this._conj[0] = -this.prev[0]; this._conj[1] = -this.prev[1]; this._conj[2] = -this.prev[2]; this._conj[3] = this.prev[3];
    const d = quatMul(q, this._conj, this._delta);
    // Short way round: a negated quaternion is the same rotation.
    if (d[3] < 0) { d[0] = -d[0]; d[1] = -d[1]; d[2] = -d[2]; d[3] = -d[3]; }
    const sinHalf = Math.hypot(d[0], d[1], d[2]);
    const angle = 2 * Math.atan2(sinHalf, Math.min(1, d[3])); // radians
    const a = lowpassAlpha(this.cutoffHz, dtSec);
    for (let i = 0; i < 3; i++) {
      const raw = sinHalf > 1e-12 ? (d[i] / sinHalf) * (angle / dtSec) : 0; // rad/s
      this.w[i] += a * (raw - this.w[i]);
    }
    this.prev[0] = q[0]; this.prev[1] = q[1]; this.prev[2] = q[2]; this.prev[3] = q[3];
  }

  /** `from` rotated along the current angular velocity for `leadSec`, the
   *  extrapolated turn capped at `maxAngle` radians. Writes a unit quaternion. */
  predict(from: Quat, leadSec: number, maxAngle: number, out: Quat): Quat {
    const wx = this.w[0] * leadSec;
    const wy = this.w[1] * leadSec;
    const wz = this.w[2] * leadSec;
    const angle = Math.hypot(wx, wy, wz);
    if (!(angle > 1e-9)) {
      out[0] = from[0]; out[1] = from[1]; out[2] = from[2]; out[3] = from[3];
      return out;
    }
    const half = Math.min(angle, maxAngle) / 2;
    const s = Math.sin(half) / angle;
    this._delta[0] = wx * s; this._delta[1] = wy * s; this._delta[2] = wz * s; this._delta[3] = Math.cos(half);
    quatMul(this._delta, from, out); // world-frame pre-multiply, matching push()
    const len = Math.hypot(out[0], out[1], out[2], out[3]);
    if (len > 0) { out[0] /= len; out[1] /= len; out[2] /= len; out[3] /= len; }
    return out;
  }
}

/**
 * Prediction horizon, seconds: how stale the sample is (`ageMs`, measured from
 * the detection's own timestamp) plus a fixed `biasMs` for the inference block
 * and display pipeline, capped at `maxMs` so a stalled detector cannot keep
 * running a pose further and further ahead. Non-finite or negative age → 0.
 */
export function predictionLeadSec(ageMs: number, biasMs: number, maxMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  return Math.min(maxMs, ageMs + biasMs) / 1000; // ms → s
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
