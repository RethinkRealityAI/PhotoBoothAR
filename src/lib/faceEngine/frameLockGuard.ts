/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * When frame-lock should give up the tracked frame and show the live camera.
 * Pure, so it is tested in node.
 *
 * Frame-lock draws the camera frame the current pose was computed from, so
 * props stay glued to the face. The cost: the picture can only change when the
 * tracker hands over a NEW sample. On a fast move the tracker can stall (no
 * new sample, no "face lost" yet either), and the screen holds the last frame
 * it tracked. That is the "freeze for a frame when I move the camera".
 *
 * This guard watches the age of the newest sample. Older than STALE_MS means
 * the tracker has fallen behind: draw the live camera (props hold their last
 * pose for that moment, like an unlocked booth). Lock again only after
 * RESUME_SAMPLES fresh samples in a row, so one lucky sample during a stall
 * does not flick the picture back and forth.
 *
 * Times are performance.now() ms; a sample key is the sample's `t`.
 */

/** Older than this, the tracked frame is a freeze, not a frame. About 3 missed samples at 8th Wall's ~23/s. */
export const FRAME_LOCK_STALE_MS = 150;
/**
 * Samples can keep ARRIVING while each one comes from an ever older camera frame: a tracker
 * that slows to ~5 samples/s under load (recording, a hot phone) still hands one over every
 * 200 ms, but the frame under it is ~2 samples old, so the locked picture trails the live
 * camera by ~0.4-0.5 s (the "my mouth keeps moving after I stop talking" lag). Past this age
 * the live camera is the better picture. A healthy 8th Wall booth trails by ~2 samples at
 * ~23/s, about 90-130 ms, comfortably under it.
 */
export const FRAME_LOCK_MAX_LAG_MS = 250;
/** Re-lock only once the lag is back under this, well below the fall-back limit: a tracker
 *  hovering around 250 ms would otherwise flip the picture between a 250 ms-old frame and the
 *  live one every few samples, which reads as stutter. */
export const FRAME_LOCK_RESUME_LAG_MS = 180;
/** Fresh samples in a row before the picture locks again after a fallback. */
export const FRAME_LOCK_RESUME_SAMPLES = 2;

export interface FrameLockGuard {
  /** Drawing the live camera instead of the tracked frame. */
  live: boolean;
  /** Fresh samples seen since the fallback began. */
  freshRun: number;
  /** Key of the last sample counted toward freshRun. */
  lastKey: number;
  /** How many times the picture fell back to live (tester readout). */
  fallbacks: number;
}

export function createFrameLockGuard(): FrameLockGuard {
  return { live: false, freshRun: 0, lastKey: Number.NaN, fallbacks: 0 };
}

/**
 * Called once per compositor draw. `key` = t of the newest sample (NaN: none
 * yet); `frameMs` = when that sample's camera frame was taken (defaults to
 * `key` for engines that don't report it). Returns true when the live camera
 * should be drawn.
 */
export function frameLockShouldUseLive(g: FrameLockGuard, now: number, key: number, frameMs: number = key): boolean {
  const age = now - key;
  const lag = now - (Number.isFinite(frameMs) ? frameMs : key);
  // NaN key (no sample yet) compares false here, so it lands in the stale branch.
  if (!(age <= FRAME_LOCK_STALE_MS) || !(lag <= FRAME_LOCK_MAX_LAG_MS)) {
    if (!g.live && Number.isFinite(key)) g.fallbacks++;
    g.live = true;
    g.freshRun = 0;
    g.lastKey = key;
    return true;
  }
  if (!g.live) return false;
  if (key !== g.lastKey) {
    g.lastKey = key;
    // A sample still trailing more than the resume limit keeps the picture live.
    if (lag <= FRAME_LOCK_RESUME_LAG_MS) g.freshRun++;
    else g.freshRun = 0;
  }
  if (g.freshRun >= FRAME_LOCK_RESUME_SAMPLES) {
    g.live = false;
    g.freshRun = 0;
    return false;
  }
  return true;
}

/** Engine switch, camera change or lock toggled: forget the history (the counter is kept). */
export function resetFrameLockGuard(g: FrameLockGuard): void {
  g.live = false;
  g.freshRun = 0;
  g.lastKey = Number.NaN;
}
