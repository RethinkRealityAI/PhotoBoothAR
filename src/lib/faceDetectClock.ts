/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * When to run face detection — pure, so the policy is unit-testable in node
 * without MediaPipe, a canvas or a video element.
 *
 * The shipped rule was a wall-clock throttle alone: "detect if 33ms have passed".
 * Nothing ever consulted the VIDEO's clock, and the two clocks are independent,
 * so the phase between them drifts. That produces both failure modes at once:
 *
 *   • DUPLICATE INFERENCE — the same video frame is analysed more than once
 *     because the 33ms timer elapsed while the camera had not yet produced a new
 *     frame. `detectForVideo` is synchronous and blocks the render thread, so
 *     that is pure waste, paid in dropped animation frames.
 *   • MISSED FRAMES — on a 60fps camera a fixed 33ms gate can only ever look at
 *     half the frames, and never the freshest one.
 *
 * Gating on `video.currentTime` fixes both: analyse a frame exactly once, as
 * soon as it exists. The watchdog exists because `currentTime` is not always
 * trustworthy — it can be stuck at 0 before playback settles, or frozen if a
 * browser stops advancing it in a background tab — and going permanently dark
 * would be far worse than an occasional duplicate.
 */

export interface DetectGate {
  /** performance.now() of the last detection that actually ran. */
  lastDetectMs: number;
  /** video.currentTime seen at that detection. */
  lastVideoTime: number;
}

/** Default minimum spacing — roughly camera rate (~30fps). */
export const DEFAULT_MIN_INTERVAL_MS = 33;
/**
 * If the video clock has not advanced for this long, detect anyway. Longer than
 * a couple of frames so it never competes with the frame gate in normal
 * playback, short enough that a stuck clock cannot freeze tracking.
 */
export const DEFAULT_STALL_WATCHDOG_MS = 250;

export function createDetectGate(): DetectGate {
  return { lastDetectMs: -Infinity, lastVideoTime: -1 };
}

export interface DetectGateOptions {
  minIntervalMs?: number;
  stallWatchdogMs?: number;
}

/**
 * Should detection run for this frame? Pure — reads the gate, never writes it;
 * the caller records the outcome with markDetected.
 *
 * `videoTime` may be non-finite (no element / not ready); it is then treated as
 * "no usable video clock" and only the watchdog can let a detection through.
 */
export function shouldDetect(
  gate: DetectGate,
  nowMs: number,
  videoTime: number,
  opts: DetectGateOptions = {},
): boolean {
  const minInterval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const watchdog = opts.stallWatchdogMs ?? DEFAULT_STALL_WATCHDOG_MS;
  const sinceDetect = nowMs - gate.lastDetectMs;

  // Rate limit first: never exceed the configured cadence, whatever the video
  // clock says. A 120fps camera must not drive 120 blocking inferences/sec.
  if (sinceDetect < minInterval) return false;

  // A genuinely new frame is the signal we want.
  if (Number.isFinite(videoTime) && videoTime !== gate.lastVideoTime) return true;

  // Video clock absent or stuck — do not go dark.
  return sinceDetect >= watchdog;
}

/** Record that a detection ran for `videoTime` at `nowMs`. */
export function markDetected(gate: DetectGate, nowMs: number, videoTime: number): void {
  gate.lastDetectMs = nowMs;
  gate.lastVideoTime = Number.isFinite(videoTime) ? videoTime : gate.lastVideoTime;
}
