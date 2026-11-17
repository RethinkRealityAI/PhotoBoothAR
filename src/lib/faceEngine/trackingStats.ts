/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure numbers behind the phone-comparison readout (?faceEngine= / ?trackdebug):
 * detections per second, and RAW pose jitter over the last ~2s — the spread of
 * the UNSMOOTHED tracker output (before One-Euro), so engines are compared on
 * what they emit, not on what our filter hides.
 *
 *   position jitter  = RMS distance of each sample from the window mean, in cm
 *                      (the pose matrix is metric centimetres for every engine)
 *   rotation jitter  = RMS angle of each sample from the window-mean
 *                      orientation, in degrees
 *
 * Fixed-size rings, no per-push allocation. A still head on a tripod reads the
 * tracker's own noise floor; a moving head reads motion, so compare engines
 * holding still.
 */

export const STATS_WINDOW_MS = 2000;
const CAP = 256; // > 2s at 120 samples/s

export interface TrackingStats {
  /** Engine samples per second over the window (face or no face). */
  detectionsPerSec: number;
  /** Face poses in the window backing the jitter numbers. */
  poseSamples: number;
  /** null until ≥ 2 face poses are in the window. */
  posJitterCm: number | null;
  rotJitterDeg: number | null;
}

export class TrackingStatsRing {
  private readonly detT = new Float64Array(CAP);
  private detN = 0;
  private detW = 0;
  private readonly poseT = new Float64Array(CAP);
  private readonly pose = new Float64Array(CAP * 7);
  private poseN = 0;
  private poseW = 0;
  private firstT = Infinity;

  constructor(private readonly windowMs = STATS_WINDOW_MS) {}

  /** One engine sample was produced at `t` (face or not). */
  markDetection(t: number): void {
    if (!Number.isFinite(t)) return;
    if (t < this.firstT) this.firstT = t;
    this.detT[this.detW] = t;
    this.detW = (this.detW + 1) % CAP;
    if (this.detN < CAP) this.detN++;
  }

  /** A RAW face pose at `t`: position (cm) + unit quaternion (x,y,z,w). */
  pushPose(t: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): void {
    if (![t, px, py, pz, qx, qy, qz, qw].every(Number.isFinite)) return;
    const i = this.poseW;
    this.poseT[i] = t;
    const o = i * 7;
    this.pose[o] = px; this.pose[o + 1] = py; this.pose[o + 2] = pz;
    this.pose[o + 3] = qx; this.pose[o + 4] = qy; this.pose[o + 5] = qz; this.pose[o + 6] = qw;
    this.poseW = (i + 1) % CAP;
    if (this.poseN < CAP) this.poseN++;
  }

  reset(): void {
    this.detN = this.detW = this.poseN = this.poseW = 0;
    this.firstT = Infinity;
  }

  stats(now: number): TrackingStats {
    const from = now - this.windowMs;
    let dets = 0;
    // Half-open window (from, now]: a closed one counts a boundary sample twice
    // across consecutive reads and reads 30.5/s on an exact 30/s grid.
    for (let k = 0; k < this.detN; k++) if (this.detT[k] > from && this.detT[k] <= now) dets++;
    // Before a full window of history exists, divide by the time actually seen.
    const spanMs = Math.min(this.windowMs, Math.max(now - this.firstT, 1));
    const detectionsPerSec = this.detN === 0 ? 0 : (dets * 1000) / spanMs;

    // Window means (quaternions sign-aligned to the first sample — q and −q are
    // the same rotation, and a naive sum of the two cancels to nothing).
    let n = 0, mx = 0, my = 0, mz = 0, ax = 0, ay = 0, az = 0, aw = 0;
    let rx = 0, ry = 0, rz = 0, rw = 0, haveRef = false;
    for (let k = 0; k < this.poseN; k++) {
      const t = this.poseT[k];
      if (t <= from || t > now) continue;
      const o = k * 7;
      const qx = this.pose[o + 3], qy = this.pose[o + 4], qz = this.pose[o + 5], qw = this.pose[o + 6];
      if (!haveRef) { rx = qx; ry = qy; rz = qz; rw = qw; haveRef = true; }
      const s = qx * rx + qy * ry + qz * rz + qw * rw < 0 ? -1 : 1;
      mx += this.pose[o]; my += this.pose[o + 1]; mz += this.pose[o + 2];
      ax += s * qx; ay += s * qy; az += s * qz; aw += s * qw;
      n++;
    }
    if (n < 2) return { detectionsPerSec, poseSamples: n, posJitterCm: null, rotJitterDeg: null };
    mx /= n; my /= n; mz /= n;
    const al = Math.hypot(ax, ay, az, aw) || 1;
    ax /= al; ay /= al; az /= al; aw /= al;

    let pos2 = 0, rot2 = 0;
    for (let k = 0; k < this.poseN; k++) {
      const t = this.poseT[k];
      if (t <= from || t > now) continue;
      const o = k * 7;
      const dx = this.pose[o] - mx, dy = this.pose[o + 1] - my, dz = this.pose[o + 2] - mz;
      pos2 += dx * dx + dy * dy + dz * dz;
      const qx = this.pose[o + 3], qy = this.pose[o + 4], qz = this.pose[o + 5], qw = this.pose[o + 6];
      const ql = Math.hypot(qx, qy, qz, qw) || 1;
      const dot = Math.min(1, Math.abs((qx * ax + qy * ay + qz * az + qw * aw) / ql));
      const ang = 2 * Math.acos(dot) * (180 / Math.PI);
      rot2 += ang * ang;
    }
    return {
      detectionsPerSec,
      poseSamples: n,
      posJitterCm: Math.sqrt(pos2 / n),
      rotJitterDeg: Math.sqrt(rot2 / n),
    };
  }
}
