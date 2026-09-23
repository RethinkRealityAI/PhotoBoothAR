/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The frame the landmarkers actually look at.
 *
 * The booth asks the camera for 1080p (lib/camera.ts) because the KEEPSAKE is
 * composited from that feed, but MediaPipe never needs it: the face detector
 * runs at 128–192px and the landmark models on a ~256px crop of the face or a
 * ~224px crop of the hand. What a full-resolution `<video>` costs is the frame
 * TRANSFER — on the CPU (XNNPACK) delegate every inference uploads the frame
 * as a texture and reads the whole thing back to the wasm heap, and at
 * 1920×1080 that readback alone is several milliseconds of main-thread block
 * on a phone, paid twice a tick when the hand landmarker joins.
 *
 * So both landmarkers share ONE downscaled copy: a 2D canvas redrawn at most
 * once per NEW camera frame (keyed on `video.currentTime`, the same frame
 * identity faceDetectClock gates on), with the source's aspect preserved
 * EXACTLY — `facialTransformationMatrixes` derive their perspective from the
 * input's aspect, so a rounding drift here would tilt every head pose. A feed
 * already at or under the cap is passed through untouched (no copy, no cost).
 *
 * Browser-only (needs a canvas); nothing here is imported by tests.
 */

/** Longest side of the inference frame, px. 1280 keeps a hand at typical booth
 *  distance well above the hand model's 224px crop; 960 was measurably worse
 *  for hands and no better for faces. */
export const INFERENCE_MAX_SIDE_PX = 1280;

interface InferenceCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** video.currentTime of the frame currently drawn. */
  drawnTime: number;
  srcW: number;
  srcH: number;
}

const _byVideo = new WeakMap<HTMLVideoElement, InferenceCanvas>();

/** Downscaled size for a `w`×`h` source, or null when no downscale is needed.
 *  Pure, exported for the harness: the aspect must survive integer rounding as
 *  closely as integers allow (long side exact, short side rounded once). */
export function inferenceSize(w: number, h: number, maxSide = INFERENCE_MAX_SIDE_PX): [number, number] | null {
  if (!(w > 0) || !(h > 0)) return null;
  const long = Math.max(w, h);
  if (long <= maxSide) return null;
  const k = maxSide / long;
  return w >= h
    ? [maxSide, Math.max(1, Math.round(h * k))]
    : [Math.max(1, Math.round(w * k)), maxSide];
}

/**
 * The image to hand `detectForVideo`: the video itself when it is small
 * enough, else the shared downscaled canvas, redrawn only when the camera has
 * produced a new frame since the last caller. Any canvas failure (a context
 * the browser refuses, a tainted/blocked draw) falls back to the video — the
 * tracker must never go dark because of an optimisation.
 */
export function inferenceSource(video: HTMLVideoElement): HTMLVideoElement | HTMLCanvasElement {
  const size = inferenceSize(video.videoWidth, video.videoHeight);
  if (size === null) return video;
  const [w, h] = size;
  let entry = _byVideo.get(video);
  if (!entry || entry.srcW !== video.videoWidth || entry.srcH !== video.videoHeight) {
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D | null;
    try {
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      // No alpha: an opaque canvas skips the compositor's premultiply and the
      // frame has no transparency to keep. willReadFrequently is deliberately
      // NOT set — MediaPipe reads it as a texture, not via getImageData.
      ctx = canvas.getContext('2d', { alpha: false });
    } catch {
      ctx = null;
      canvas = null as unknown as HTMLCanvasElement;
    }
    if (ctx === null) return video;
    entry = { canvas, ctx, drawnTime: -1, srcW: video.videoWidth, srcH: video.videoHeight };
    _byVideo.set(video, entry);
  }
  const t = video.currentTime;
  if (t !== entry.drawnTime || !Number.isFinite(t)) {
    try {
      entry.ctx.drawImage(video, 0, 0, w, h);
      entry.drawnTime = t;
    } catch {
      return video; // a draw the browser refuses: use the raw frame this once
    }
  }
  return entry.canvas;
}

/** Test/diagnostic hook: the inference frame's current size for a video, or
 *  null when the video is passed through untouched. */
export function inferenceFrameSize(video: HTMLVideoElement): [number, number] | null {
  return inferenceSize(video.videoWidth, video.videoHeight);
}
