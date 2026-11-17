/** Which tracker produces the head pose. 'hybrid' = 8th Wall pose + MediaPipe blendshapes (low rate). */
export type FaceTrackingMode = 'mediapipe' | 'xr8' | 'hybrid';

/** Six normalized image-space points (raw, UNMIRRORED, x/y in 0..1 of the full video frame). */
export interface FaceKeypoints {
  forehead: { x: number; y: number };
  chin: { x: number; y: number };
  leftEar: { x: number; y: number };
  rightEar: { x: number; y: number };
}

/**
 * One tracker output. `matrix` is ALWAYS in the MediaPipe facialTransformationMatrix convention,
 * whatever engine produced it: column-major 4x4, CENTIMETRES, right-handed, +X = subject's left,
 * +Y up, +Z toward the camera, origin at the canonical face centre, as seen by a camera at the
 * origin looking down -Z with a 63 degree VERTICAL fov over the FULL (uncropped) video frame.
 * Raw and UNMIRRORED. null = no face in this sample.
 */
export interface FaceSample {
  /** performance.now() when the sample was produced. */
  t: number;
  matrix: ArrayLike<number> | null;
  /** MediaPipe/ARKit category name -> score 0..1. {} when no face. null = this engine has no
   *  expression output for this sample (caller keeps its previous stash). */
  blendshapes: Record<string, number> | null;
  keypoints: FaceKeypoints | null;
}

export interface FaceEngine {
  readonly id: 'mediapipe' | 'xr8';
  /** Idempotent. Rejects if the engine cannot start (caller falls back to MediaPipe). */
  init(): Promise<void>;
  isReady(): boolean;
  /**
   * Called every render frame with the app's own camera <video>. Returns a NEW sample when one
   * exists since the last call, else null. Must never throw. MediaPipe runs its (blocking)
   * inference inside poll under the existing DetectGate; xr8 runs its own loop and poll just
   * hands over the latest unseen sample (and (re)binds to `video` if it changed).
   */
  poll(video: HTMLVideoElement, now: number): FaceSample | null;
  /** performance.now() of the last blocking inference on the main thread, or -Infinity. */
  lastInferenceMs(): number;
  /** OPTIONAL. A canvas holding EXACTLY the camera frame the most recent sample was computed from
   *  (full video frame, unmirrored, video pixel size). When present, the compositor draws this
   *  instead of the live <video>, so the AR layer and the camera image are the same instant
   *  (frame-locked) and tracker latency is invisible. null until the first sample. */
  getAnalysedFrame?(): HTMLCanvasElement | OffscreenCanvas | null;
  /** Stop loops / release GL + wasm where possible. Safe to call twice. */
  dispose(): void;
}
