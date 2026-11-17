/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The 8th Wall face engine (types.ts FaceEngine). Loaded ONLY through
 * index.ts's dynamic import, so no session that never asks for 8th Wall ever
 * downloads it.
 *
 * How it runs:
 *  - init() loads the self-hosted engine (xr8Session.loadXr8), starts XR8 with
 *    OUR session manager (no second getUserMedia) on a small black placeholder
 *    canvas, and resolves on `facecontroller.facescanning` — the point where
 *    wasm, both tflite models and the GL pipeline have all come up. So a phone
 *    that cannot run 8th Wall rejects HERE (index.ts then falls back to
 *    MediaPipe), not silently later. The app's video only arrives with the
 *    first poll(), which swaps it in as the frame source.
 *  - Its own requestAnimationFrame loop drives XR8 manually
 *    (ownRunLoop:false → runPreRender / runRender / runPostRender). Frames are
 *    gated by the same DetectGate as MediaPipe (≤ ~30/s, new frames only). The
 *    loop idles when nobody has polled for XR8_IDLE_AFTER_MS and restarts on
 *    the next poll.
 *  - Results lag the staged frame by one loop tick (processGpu stages a frame
 *    in runPostRender; processCpu infers it in the NEXT runPreRender).
 *  - poll() hands over the newest unseen sample; it never throws.
 *
 * The canvas 8th Wall draws into is never attached to the DOM and is kept at
 * the source's exact size, so 8th Wall's intrinsics describe the FULL frame —
 * the precondition of xr8Pose.xr8ToFaceMatrix.
 *
 * XR8 is a page-wide singleton: at most one engine may be alive (index.ts
 * guarantees it; this file enforces it).
 */
import type { FaceEngine, FaceSample } from './types';
import { createXr8SessionManager, loadXr8, type Xr8Global, type Xr8SessionManager } from './xr8Session';
import { xr8Keypoints, xr8LocalToHeadCm, xr8ToFaceMatrix, type Xr8Transform, type Xr8Uv, type Xr8Vec3 } from './xr8Pose';
import { createXr8ExpressionState, resetXr8ExpressionState, xr8Expressions } from './xr8Expressions';

/** From XR8.run to facescanning (models + GL up). index.ts's outer 12 s race still applies. */
export const XR8_SCAN_TIMEOUT_MS = 10_000;
/** No poll for this long → the loop stops (no inference for a surface that left). */
export const XR8_IDLE_AFTER_MS = 1_000;
/** DetectGate spacing — the same ~30/s as MediaPipe's DETECT_INTERVAL_MS. */
export const XR8_DETECT_INTERVAL_MS = 33;

/** The tracked mesh in the contract head frame (canonical cm), overwritten in place every frame. */
export interface Xr8FaceMesh {
  /** pointsPerDetection·3 floats, x,y,z per vertex. Same buffer every call — copy to keep. */
  vertices: Float32Array;
  /** performance.now() of the sample the vertices belong to. */
  t: number;
}
/** The mesh topology 8th Wall reports once per session (facescanning), for the FACE geometry. */
export interface Xr8FaceTopology {
  pointsPerDetection: number;
  /** Triangles, 3 indices each. */
  indices: Uint32Array;
  /** 8th Wall's STANDARD uvs (uvType default), u,v per vertex. */
  uvs: Float32Array;
}

export interface Xr8FaceEngine extends FaceEngine {
  readonly id: 'xr8';
  /** Latest tracked mesh, or null when no face is tracked. Allocation-free. */
  getLatestFaceMesh(): Xr8FaceMesh | null;
  /** Static topology; null until init() has resolved. */
  getFaceMeshTopology(): Xr8FaceTopology | null;
}

interface FaceDetail {
  transform: Xr8Transform;
  vertices: Xr8Vec3[];
  uvsInCameraFrame: Xr8Uv[];
}
interface ScanDetail {
  pointsPerDetection: number;
  indices: { a: number; b: number; c: number }[];
  uvs: { u: number; v: number }[];
}

let alive: object | null = null;

const PLACEHOLDER_W = 90;
const PLACEHOLDER_H = 160;

export function createXr8Engine(): Xr8FaceEngine {
  const token = {};
  let XR8: Xr8Global | null = null;
  let sm: Xr8SessionManager | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let placeholder: HTMLCanvasElement | null = null;
  let initPromise: Promise<void> | null = null;
  let ready = false;
  let disposed = false;
  let running = false;
  let contextLost = false;
  let raf = 0;
  let lastPollMs = -Infinity;
  let lastInference = -Infinity;

  let pendingFace: FaceDetail | null = null;
  let pendingLost = false;
  let latest: FaceSample | null = null;
  let fresh = false;

  let topology: Xr8FaceTopology | null = null;
  let meshBuf = new Float32Array(0);
  const mesh: Xr8FaceMesh = { vertices: meshBuf, t: 0 };
  let meshValid = false;
  const expr = createXr8ExpressionState();

  let scanResolve: (() => void) | null = null;
  let scanReject: ((e: Error) => void) | null = null;

  const fail = (e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    scanReject?.(err);
    scanResolve = scanReject = null;
  };

  const lostSample = (now: number): FaceSample => ({ t: now, matrix: null, blendshapes: {}, keypoints: null });

  function captureTopology(d: ScanDetail | undefined): void {
    if (topology || !d || !Array.isArray(d.indices) || !Array.isArray(d.uvs)) return;
    const indices = new Uint32Array(d.indices.length * 3);
    d.indices.forEach((t, i) => { indices[i * 3] = t.a; indices[i * 3 + 1] = t.b; indices[i * 3 + 2] = t.c; });
    const uvs = new Float32Array(d.uvs.length * 2);
    d.uvs.forEach((p, i) => { uvs[i * 2] = p.u; uvs[i * 2 + 1] = p.v; });
    const n = Number.isFinite(d.pointsPerDetection) && d.pointsPerDetection > 0 ? d.pointsPerDetection : d.uvs.length;
    topology = { pointsPerDetection: n, indices, uvs };
    meshBuf = new Float32Array(n * 3);
    mesh.vertices = meshBuf;
  }

  function onFace(d: FaceDetail, intrinsics: ArrayLike<number> | undefined): void {
    if (!sm || !intrinsics || !(sm.source instanceof HTMLVideoElement)) return; // placeholder frames carry no face
    const now = performance.now();
    const matrix = xr8ToFaceMatrix(d.transform, intrinsics, sm.size.width, sm.size.height, new Float32Array(16));
    if (matrix === null) return;
    const verts = d.vertices;
    if (verts && verts.length * 3 > meshBuf.length) {
      meshBuf = new Float32Array(verts.length * 3); // only if 8th Wall ever reports more points than announced
      mesh.vertices = meshBuf;
    }
    const n = verts ? xr8LocalToHeadCm(verts, meshBuf) : 0;
    meshValid = n > 0;
    mesh.t = now;
    // A fresh object per sample (≤ ~30/s): consumers may hold on to a sample's map.
    const blendshapes = meshValid ? xr8Expressions(meshBuf, now, expr, {}) : null;
    latest = { t: now, matrix, blendshapes, keypoints: d.uvsInCameraFrame ? xr8Keypoints(d.uvsInCameraFrame) : null };
    fresh = true;
  }

  function onLost(): void {
    meshValid = false;
    resetXr8ExpressionState(expr);
    latest = lostSample(performance.now());
    fresh = true;
  }

  const module = {
    name: 'beamwall-face-engine',
    sessionManager: () => sm?.manager,
    listeners: [
      {
        event: 'facecontroller.facescanning',
        process: ({ detail }: { detail: ScanDetail }) => {
          captureTopology(detail);
          scanResolve?.();
          scanResolve = scanReject = null;
        },
      },
      { event: 'facecontroller.facefound', process: ({ detail }: { detail: FaceDetail }) => { pendingFace = detail; } },
      { event: 'facecontroller.faceupdated', process: ({ detail }: { detail: FaceDetail }) => { pendingFace = detail; } },
      { event: 'facecontroller.facelost', process: () => { pendingLost = true; } },
    ],
    // Listener events are dispatched before onUpdate on the same tick. The face
    // module RE-DISPATCHES the previous face on a repeat frame, so only a
    // non-repeat frame produces a sample.
    onUpdate: ({ processCpuResult, frameStartResult }: {
      processCpuResult?: { facecontroller?: { intrinsics?: ArrayLike<number> } };
      frameStartResult?: { repeatFrame?: boolean };
    }) => {
      try {
        const face = pendingFace;
        pendingFace = null;
        if (pendingLost) {
          pendingLost = false;
          onLost();
        }
        if (!face || !frameStartResult || frameStartResult.repeatFrame === true) return;
        onFace(face, processCpuResult?.facecontroller?.intrinsics);
      } catch (e) {
        console.warn('[xr8Engine] face update failed', e);
      }
    },
    onException: (e: unknown) => {
      if (!ready) fail(e);
      else console.warn('[xr8Engine] 8th Wall exception', e);
    },
  };

  function syncCanvasSize(): void {
    if (!sm || !canvas) return;
    const s = sm.source;
    const w = s instanceof HTMLVideoElement ? s.videoWidth : s.width;
    const h = s instanceof HTMLVideoElement ? s.videoHeight : s.height;
    // Same size as the source: 8th Wall's intrinsics then describe the full frame.
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function tick(ts: number): void {
    raf = 0;
    if (disposed || !XR8 || !sm || !running) return;
    const now = performance.now();
    if (ready && now - lastPollMs > XR8_IDLE_AFTER_MS) return; // idle until the next poll
    raf = requestAnimationFrame(tick);
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    sm.enabled = !hidden && !contextLost;
    if (contextLost || hidden) return;
    syncCanvasSize();
    const consumed = sm.stagedPending; // the frame processCpu will infer in this runPreRender
    sm.stagedPending = false;
    try {
      XR8.runPreRender(ts);
      XR8.runRender();
      XR8.runPostRender();
    } catch (e) {
      if (!ready) fail(e);
    }
    // The blocking main-thread work (inference, then staging) just ran: handRig's lockout reads this.
    if (consumed || sm.stagedPending) lastInference = performance.now();
  }

  function ensureLoop(): void {
    if (raf === 0 && running && !disposed && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
  }

  function startXr8(): void {
    if (!XR8 || !canvas) return;
    XR8.run({
      canvas,
      ownRunLoop: false,
      allowedDevices: XR8.XrConfig.device().ANY,
      webgl2: true,
      cameraConfig: { direction: XR8.XrConfig.camera().FRONT },
    });
    running = true;
    ensureLoop();
  }

  function stopXr8(): void {
    running = false;
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
    try { XR8?.stop(); } catch { /* already stopped */ }
  }

  const onContextLost = (ev: Event) => {
    ev.preventDefault(); // allow restoration
    contextLost = true;
    if (ready) onLost();
  };
  const onContextRestored = () => {
    contextLost = false;
    if (disposed || !ready) return;
    // XR8 re-creates its GL state on run (camera-loop createContext); restart the pipeline.
    stopXr8();
    try {
      startXr8();
    } catch (e) {
      console.warn('[xr8Engine] restart after context loss failed', e);
    }
  };

  function cleanup(): void {
    stopXr8();
    try { XR8?.clearCameraPipelineModules(); } catch { /* engine gone */ }
    if (canvas) {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      canvas.width = 0;
      canvas.height = 0;
    }
    canvas = null;
    placeholder = null;
    sm = null;
    ready = false;
    latest = null;
    fresh = false;
    meshValid = false;
    if (alive === token) alive = null;
  }

  const engine: Xr8FaceEngine = {
    id: 'xr8',
    init() {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        if (disposed) throw new Error('8th Wall engine was disposed');
        if (alive !== null && alive !== token) throw new Error('another 8th Wall engine is already running');
        alive = token;
        XR8 = await loadXr8();
        if (disposed) throw new Error('8th Wall engine was disposed');

        placeholder = document.createElement('canvas');
        placeholder.width = PLACEHOLDER_W;
        placeholder.height = PLACEHOLDER_H;
        const g = placeholder.getContext('2d');
        if (g) { g.fillStyle = '#000'; g.fillRect(0, 0, PLACEHOLDER_W, PLACEHOLDER_H); }
        canvas = document.createElement('canvas');
        canvas.width = PLACEHOLDER_W;
        canvas.height = PLACEHOLDER_H;
        canvas.addEventListener('webglcontextlost', onContextLost);
        canvas.addEventListener('webglcontextrestored', onContextRestored);
        sm = createXr8SessionManager(placeholder, XR8_DETECT_INTERVAL_MS);

        let timer: ReturnType<typeof setTimeout> | undefined;
        const scanned = new Promise<void>((resolve, reject) => {
          scanResolve = resolve;
          scanReject = reject;
          timer = setTimeout(() => fail(new Error(`8th Wall face models did not start within ${XR8_SCAN_TIMEOUT_MS / 1000}s`)), XR8_SCAN_TIMEOUT_MS);
        });
        try {
          XR8.FaceController.configure({
            meshGeometry: [XR8.FaceController.MeshGeometry.FACE],
            coordinates: { mirroredDisplay: false, axes: 'RIGHT_HANDED' },
            maxDetections: 1,
          });
          XR8.clearCameraPipelineModules();
          XR8.addCameraPipelineModules([XR8.FaceController.pipelineModule(), module]);
          startXr8();
          await scanned;
        } finally {
          clearTimeout(timer);
        }
        if (disposed) throw new Error('8th Wall engine was disposed');
        ready = true;
        lastPollMs = performance.now();
      })();
      initPromise.catch(() => cleanup());
      return initPromise;
    },
    isReady() {
      return ready && !disposed;
    },
    poll(video, now) {
      void now;
      try {
        lastPollMs = performance.now();
        if (!ready || disposed || !sm) return null;
        if (video && sm.source !== video) {
          // Rebind (first poll, or the surface swapped its <video>). Its size is
          // picked up by syncCanvasSize + 8th Wall's own per-frame size check.
          sm.bind(video);
          pendingFace = null;
        }
        ensureLoop();
        if (!fresh) return null;
        fresh = false;
        return latest;
      } catch {
        return null;
      }
    },
    lastInferenceMs() {
      return lastInference;
    },
    getLatestFaceMesh() {
      return meshValid && ready ? mesh : null;
    },
    getFaceMeshTopology() {
      return topology;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      fail(new Error('8th Wall engine was disposed'));
      cleanup();
    },
  };
  return engine;
}
