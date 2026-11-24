/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * How old is the picture the booth is drawing? The pure maths, plus one small
 * module-level clock the compositor feeds and the recorder reads.
 *
 * Why it exists: a booth clip is `captureStream()` of the composite canvas plus
 * the microphone. The microphone is live. The picture is not: the camera hands
 * the page a frame some tens of ms after it was taken, and on 3D looks the
 * composite draws the frame the face tracker last finished (frame-lock), which
 * is older still. Every ms of that age lands in the file as "lips move after
 * the words". Nothing measured it, so nothing could correct it.
 *
 * The age has two parts:
 *   1. camera delay: capture -> the frame reaching the <video>. Measured per
 *      frame from requestVideoFrameCallback's `captureTime` where the browser
 *      reports it; a constant otherwise. Plus half a camera frame: a draw (or
 *      the tracker's upload) reads whatever frame is newest at that moment,
 *      which on average arrived half a frame interval earlier.
 *   2. hold (frame-lock only): how long ago the tracker took the frame it is
 *      still showing.
 *
 * MEASURED, not assumed (flash + click clips recorded in headless Chromium and
 * compared with a raw camera recording of the same source): a first version
 * also counted, for the LIVE camera, the time since the last per-frame
 * callback. On a slow page that callback fires once per (long) rendering
 * frame while the <video> keeps receiving frames, and drawImage reads the
 * newest one, so the estimate read ~150 ms where the clip was ~45 ms late.
 *
 * lib/audioSync.ts delays the recorded sound by the smoothed age, so the file
 * lines up whatever the phone's speed. Times are performance.now() ms.
 */

/** Camera delay assumed until (or unless) the browser reports capture times. */
export const CAMERA_DELAY_FALLBACK_MS = 70;
/** A capture-time reading outside this range is a clock mismatch, not a delay. */
const CAMERA_DELAY_MAX_MS = 1000;
/** Smoothing of the per-frame camera delay (per sample). */
const CAMERA_DELAY_ALPHA = 0.1;
/** Time constant of the picture-age average the sound delay follows. */
export const PICTURE_AGE_TAU_MS = 700;
/** Half a 30 fps camera frame: the average age of "the newest frame" when something reads it. */
export const HALF_CAMERA_FRAME_MS = 16;
/** A gap this long between composites restarts the average (tab hidden, look switch). */
const AGE_RESTART_GAP_MS = 2000;

export interface PictureClock {
  /** Smoothed capture -> page delay, NaN until the first valid reading. */
  cameraDelayMs: number;
  /** Valid capture-time readings so far (0 = the browser doesn't report them). */
  cameraSamples: number;
  /** Smoothed age of the drawn picture; NaN before the first composite. */
  ageMs: number;
  /** Age of the picture in the most recent composite. */
  lastAgeMs: number;
  /** That composite drew the tracker's frame (frame-lock) rather than the live camera. */
  locked: boolean;
  /** When the most recent composite was noted. */
  notedMs: number;
}

export function createPictureClock(): PictureClock {
  return {
    cameraDelayMs: Number.NaN, cameraSamples: 0,
    ageMs: Number.NaN, lastAgeMs: Number.NaN, locked: false, notedMs: Number.NaN,
  };
}

/**
 * A camera frame reached the <video> at `arrivedMs`. `captureTime` is the
 * browser's own capture timestamp for it (same clock), when it reports one.
 */
export function noteCameraFrame(c: PictureClock, arrivedMs: number, captureTime?: number | null): void {
  if (captureTime === null || captureTime === undefined || !Number.isFinite(captureTime)) return;
  const d = arrivedMs - captureTime;
  if (!(d >= 0 && d <= CAMERA_DELAY_MAX_MS)) return;
  c.cameraSamples++;
  c.cameraDelayMs = Number.isFinite(c.cameraDelayMs) ? c.cameraDelayMs + (d - c.cameraDelayMs) * CAMERA_DELAY_ALPHA : d;
}

/** Capture -> page delay: measured, else the fallback constant. */
export function cameraDelayMs(c: PictureClock): number {
  return Number.isFinite(c.cameraDelayMs) ? c.cameraDelayMs : CAMERA_DELAY_FALLBACK_MS;
}

/** Age of the LIVE camera picture when it is drawn: the newest frame the <video> holds. */
export function liveAgeMs(c: PictureClock): number {
  return cameraDelayMs(c) + HALF_CAMERA_FRAME_MS;
}

/** Age of a frame-LOCKED picture drawn at `now`: the tracker took the then-newest frame at `frameMs`. */
export function lockedAgeMs(c: PictureClock, now: number, frameMs: number): number {
  if (!Number.isFinite(frameMs)) return liveAgeMs(c);
  return liveAgeMs(c) + Math.max(0, now - frameMs);
}

/** The compositor drew a picture of age `ageMs` at `now`. Feeds the average. */
export function notePictureAge(c: PictureClock, now: number, ageMs: number, locked: boolean): void {
  if (!Number.isFinite(ageMs) || ageMs < 0) return;
  const dt = now - c.notedMs;
  if (!Number.isFinite(c.ageMs) || !(dt >= 0) || dt > AGE_RESTART_GAP_MS) c.ageMs = ageMs;
  else c.ageMs += (ageMs - c.ageMs) * (1 - Math.exp(-dt / PICTURE_AGE_TAU_MS));
  c.lastAgeMs = ageMs;
  c.locked = locked;
  c.notedMs = now;
}

/** The smoothed picture age, or null when nothing has been composited lately. */
export function smoothedPictureAgeMs(c: PictureClock, now: number): number | null {
  if (!Number.isFinite(c.ageMs) || !(now - c.notedMs <= AGE_RESTART_GAP_MS)) return null;
  return c.ageMs;
}

/* ------------------------------------------------------------------ */
/* The booth's one clock + its camera-frame watcher (browser only)     */
/* ------------------------------------------------------------------ */

/** One booth composites at a time; the readout and the recorder read this. */
export const boothPictureClock = createPictureClock();

type FrameMeta = { captureTime?: number; presentationTime?: number };
type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

let watched: RvfcVideo | null = null;
let watchHandle = 0;

function onCameraFrame(now: number, meta: FrameMeta): void {
  const v = watched;
  if (v === null) return;
  // presentationTime = when the browser got the frame ready to show; the
  // callback itself can run a whole (slow) rendering frame later.
  const arrived = typeof meta?.presentationTime === 'number' && meta.presentationTime <= now ? meta.presentationTime : now;
  noteCameraFrame(boothPictureClock, arrived, meta?.captureTime);
  try {
    watchHandle = v.requestVideoFrameCallback!(onCameraFrame);
  } catch {
    watched = null; // element went away; the next watchCameraFrames call re-arms
  }
}

/**
 * Count the camera's frames as they reach `video` (idempotent; call per
 * composite). A browser without requestVideoFrameCallback is left on the
 * fallback constants. Never throws.
 */
export function watchCameraFrames(video: HTMLVideoElement | null): void {
  if (video === watched) return;
  stopWatchingCameraFrames();
  const v = video as RvfcVideo | null;
  if (v === null || typeof v.requestVideoFrameCallback !== 'function') return;
  try {
    watched = v;
    watchHandle = v.requestVideoFrameCallback(onCameraFrame);
  } catch {
    watched = null;
  }
}

export function stopWatchingCameraFrames(): void {
  const v = watched;
  watched = null;
  if (v === null) return;
  try { v.cancelVideoFrameCallback?.(watchHandle); } catch { /* already gone */ }
  // A new camera has its own delay: forget the old one's.
  boothPictureClock.cameraDelayMs = Number.NaN;
  boothPictureClock.cameraSamples = 0;
}
