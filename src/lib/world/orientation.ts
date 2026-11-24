/**
 * World mode, part 1: the phone's ORIENTATION as a camera rotation.
 *
 * World mode stands an event frame up in the room behind the phone (back
 * camera). It tracks with the phone's motion sensors (3 degrees of freedom:
 * the frame stays put while the phone turns and tilts; it does not follow the
 * phone if the holder walks). See docs/STATE.md for why this is not the 8th
 * Wall SLAM binary (its licence).
 *
 * Pure: no DOM listeners here, so the maths is unit-tested in node.
 */
import { Euler, Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;
/** The camera looks out of the BACK of the phone, not out of its top edge. */
const BACK_OF_DEVICE = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const Z_AXIS = new Vector3(0, 0, 1);

/**
 * W3C deviceorientation angles (degrees) + screen rotation (degrees) → the
 * three.js camera quaternion in a world where +Y is up (gravity) and the yaw
 * origin is wherever the sensor started. Same maths as three's old
 * DeviceOrientationControls (removed from three in r134).
 */
export function orientationToQuaternion(
  alpha: number, beta: number, gamma: number, screenAngle: number,
  out: Quaternion = new Quaternion(),
): Quaternion {
  const euler = new Euler(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ');
  out.setFromEuler(euler);
  out.multiply(BACK_OF_DEVICE);
  out.multiply(new Quaternion().setFromAxisAngle(Z_AXIS, -screenAngle * DEG));
  return out;
}

export interface OrientationSample { t: number; q: Quaternion }

/**
 * A short history of orientations, so the 3D can be drawn with the rotation the
 * phone had WHEN THE CAMERA FRAME WAS TAKEN. The camera picture on screen is
 * 50-120 ms old; a rotation applied instantly makes the frame "swim" ahead of
 * the room every time the phone turns.
 */
export class OrientationHistory {
  private samples: OrientationSample[] = [];
  constructor(private readonly keepMs = 600) {}

  push(t: number, q: Quaternion): void {
    const last = this.samples[this.samples.length - 1];
    if (last !== undefined && t < last.t) this.samples.length = 0; // clock went backwards: start over
    this.samples.push({ t, q: q.clone() });
    const cutoff = t - this.keepMs;
    let drop = 0;
    while (drop < this.samples.length - 2 && this.samples[drop + 1].t < cutoff) drop++;
    if (drop > 0) this.samples.splice(0, drop);
  }

  get size(): number { return this.samples.length; }

  /** The rotation at time t (slerped between the two samples around it).
   *  Before the first sample → the first; after the last → the last. Null when empty. */
  at(t: number, out: Quaternion = new Quaternion()): Quaternion | null {
    const s = this.samples;
    if (s.length === 0) return null;
    if (t <= s[0].t) return out.copy(s[0].q);
    const last = s[s.length - 1];
    if (t >= last.t) return out.copy(last.q);
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1], b = s[i];
      if (t >= a.t) {
        const span = b.t - a.t;
        const k = span > 0 ? (t - a.t) / span : 1;
        return out.copy(a.q).slerp(b.q, k);
      }
    }
    return out.copy(last.q);
  }

  clear(): void { this.samples.length = 0; }
}

/**
 * Vertical field of view (degrees) of the STAGE, given the camera's field of
 * view across the LONG side of its picture and how the picture is cover-fit
 * into the stage. A cover fit crops one axis, which narrows its view.
 */
export function stageVerticalFov(
  longSideFovDeg: number, videoW: number, videoH: number, stageW: number, stageH: number,
): number {
  if (!(videoW > 0 && videoH > 0 && stageW > 0 && stageH > 0)) return longSideFovDeg;
  const long = Math.max(videoW, videoH);
  // Focal length in video pixels (pinhole), from the long side's view.
  const f = (long / 2) / Math.tan((longSideFovDeg * DEG) / 2);
  const srcA = videoW / videoH;
  const dstA = stageW / stageH;
  // Visible video height after the cover crop (same rule as StageCanvas coverFit).
  const visibleH = srcA > dstA ? videoH : videoW / dstA;
  return (2 * Math.atan((visibleH / 2) / f)) / DEG;
}
