/**
 * Steady camera pose for world mode (8th Wall floor tracking). PURE: no DOM,
 * no three.js, so it is unit-tested in node.
 *
 * WHY: the engine hands over each picture with the camera pose it worked out
 * for it, and that pose was drawn raw. Its POSITION wobbles by millimetres from
 * picture to picture even when the phone is perfectly still (measured headless
 * on the real engine, still camera: 3.0 mm RMS between pictures, while the
 * rotation, which the engine fuses with the gyroscope, moved 0.04°). A sideways position error of
 * e shifts the standing frame on screen by f·e/d pixels, d being how far away
 * it stands: 2 mm is under 1 px from 3 m and 3 px from 70 cm. So the frame
 * looks planted from across the room and trembles once the guest walks up to
 * it. The engine has no smoothing option of its own (XrController.configure:
 * scale, lighting, world points, image targets; nothing for the pose).
 *
 * WHAT: a One-Euro filter on the camera POSITION only, stepped once per engine
 * sample. Slow when the phone is still (the wobble melts away), fast when the
 * phone really moves (the frame does not trail the room). The rotation stays
 * raw by default: a hand's real tremor is mostly rotation, the picture shows
 * it, and smoothing it away would make the frame swim against the room.
 *
 * Simulated at 30 samples/s with 1 mm noise per axis (frame-to-frame shake of
 * the error, raw → filtered): still phone 2.44 → 0.38 mm, a hand's slow sway
 * 2.44 → 0.66 mm. Walking at 0.5 m/s the filter trails by about 4 mm (7 at
 * worst). On the real engine, headless at only ~7 samples/s (a phone gives
 * ~30, where the filter is stronger): 2.95 → 1.02 mm between pictures.
 */
import { OneEuroQuat, OneEuroVec3, type OneEuroConfig, type Quat, type Vec3 } from '../smoothing';

/** Position: metres and m/s. */
export const WORLD_POS_FILTER: OneEuroConfig = { minCutoff: 0.8, beta: 40, dCutoff: 1 };
/** Rotation (only with `?wsteadyrot=<Hz>`): rad/s. */
export const WORLD_ROT_BETA = 6;
/** No sample for this long (a stall, a paused tab): start again from the next one. */
export const STEADY_GAP_RESET_MS = 250;
/** One sample this far from the last (the engine re-found the room, recenter): snap, do not glide. */
export const STEADY_JUMP_RESET_M = 0.25;

export interface WorldSteadyOptions {
  enabled: boolean;
  /** Position cutoff at rest (Hz). Lower = steadier, slower to follow. */
  posMinCutoff: number;
  /** Rotation cutoff at rest (Hz); 0 = rotation stays raw. */
  rotMinCutoff: number;
}

export const WORLD_STEADY_DEFAULT: Readonly<WorldSteadyOptions> = {
  enabled: true, posMinCutoff: WORLD_POS_FILTER.minCutoff, rotMinCutoff: 0,
};

/**
 * Tester knobs for a phone A/B: `?wsteady=0` (raw pose, as before),
 * `?wsteadyhz=<0.1-10>` (position cutoff at rest), `?wsteadyrot=<0.5-20>`
 * (also smooth the rotation). Anything else keeps the default.
 */
export function worldSteadyFrom(search: string): WorldSteadyOptions {
  const p = new URLSearchParams(search);
  const num = (k: string, lo: number, hi: number, d: number) => {
    if (!p.has(k)) return d;
    const v = Number(p.get(k));
    return Number.isFinite(v) && v >= lo && v <= hi ? v : d;
  };
  return {
    enabled: p.get('wsteady') !== '0',
    posMinCutoff: num('wsteadyhz', 0.1, 10, WORLD_STEADY_DEFAULT.posMinCutoff),
    rotMinCutoff: num('wsteadyrot', 0.5, 20, 0),
  };
}

export class WorldPoseSteady {
  private pos: OneEuroVec3;
  private rot: OneEuroQuat | null;
  private last: Vec3 | null = null;

  constructor(private readonly opts: Readonly<WorldSteadyOptions> = WORLD_STEADY_DEFAULT) {
    this.pos = new OneEuroVec3({ ...WORLD_POS_FILTER, minCutoff: opts.posMinCutoff });
    this.rot = opts.rotMinCutoff > 0
      ? new OneEuroQuat({ minCutoff: opts.rotMinCutoff, beta: WORLD_ROT_BETA, dCutoff: 1 })
      : null;
  }

  /** Forget history: the next sample is shown as it is. */
  reset(): void {
    this.pos.reset();
    this.rot?.reset();
    this.last = null;
  }

  /**
   * One NEW engine sample, `gapMs` after the previous one → the steadied pose,
   * written into outPos / outQuat. Off, the first sample, a long gap, a jump
   * and a non-finite sample all pass through unchanged.
   */
  step(pos: Readonly<Vec3>, quat: Readonly<Quat>, gapMs: number, outPos: Vec3, outQuat: Quat): void {
    const finite = Number.isFinite(pos[0] + pos[1] + pos[2] + quat[0] + quat[1] + quat[2] + quat[3]);
    if (!this.opts.enabled || !finite) {
      if (!finite) this.reset();
      outPos[0] = pos[0]; outPos[1] = pos[1]; outPos[2] = pos[2];
      outQuat[0] = quat[0]; outQuat[1] = quat[1]; outQuat[2] = quat[2]; outQuat[3] = quat[3];
      return;
    }
    const prev = this.last;
    if (
      prev === null || !(gapMs > 0) || gapMs > STEADY_GAP_RESET_MS
      || Math.hypot(pos[0] - prev[0], pos[1] - prev[1], pos[2] - prev[2]) > STEADY_JUMP_RESET_M
    ) {
      this.reset();
    }
    const dt = this.last === null ? 0 : gapMs / 1000;
    this.pos.filter(pos as Vec3, dt, outPos);
    if (this.rot) {
      this.rot.filter(quat as Quat, dt, outQuat);
    } else {
      outQuat[0] = quat[0]; outQuat[1] = quat[1]; outQuat[2] = quat[2]; outQuat[3] = quat[3];
    }
    this.last = this.last ?? [0, 0, 0];
    this.last[0] = outPos[0]; this.last[1] = outPos[1]; this.last[2] = outPos[2];
  }
}
