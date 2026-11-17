/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The two pieces of 8th Wall plumbing xr8Engine needs, kept apart so they can be
 * read (and tested) without a browser:
 *
 *  1. loadXr8(): an idempotent loader for the self-hosted engine (public/xr8/,
 *     vendored by scripts/copy-xr8.mjs). It REJECTS — never hangs — on a missing
 *     file, a timeout, or a server that answers a missing file with index.html
 *     at 200 (vite preview AND Netlify both do that: the same trap faceTracking's
 *     resolveModelUrl guards against), and it forgets a failed attempt so a
 *     later call can retry.
 *  2. createXr8SessionManager(): a custom 8th Wall session manager that feeds
 *     the engine frames from a source WE own (the app's camera <video>, or a
 *     placeholder canvas until the first poll) instead of opening a second
 *     getUserMedia stream. Pipeline-module key `sessionManager`
 *     (engine camera-loop.ts:826-831 tries it before getusermedia).
 *
 * Engine internals this depends on (pre-release @8thwall/engine 0.1.0; any of
 * these can move in a later version — see the report in the PR):
 *  - session-manager methods and their call order (camera-loop.ts:841-909);
 *  - hasNewFrame() -> {repeatFrame, videoSize}, called in readCameraToTexture
 *    (camera-loop.ts:296-330); frameStartResult({repeatFrame, computeCtx,
 *    computeTexture}) must fill computeTexture itself when the attributes say
 *    fillsCameraTexture;
 *  - FaceController.onBeforeSessionInitialize requires fillsCameraTexture.
 */
import { createDetectGate, markDetected, shouldDetect } from '../faceDetectClock';

/** Where copy-xr8 puts the engine (served from public/). */
export const XR8_BASE_URL = '/xr8/';
/** Files the face pipeline cannot start without (checked before injecting anything). */
export const XR8_REQUIRED_FILES = [
  'xr.js',
  'xr-face.js',
  'resources/face-model.tflite',
  'resources/face-mesh-model.tflite',
] as const;
export const XR8_LOAD_TIMEOUT_MS = 10_000;

/** The subset of window.XR8 we call (pasted from engine 0.1.0 at the call sites). */
export interface Xr8Global {
  run(config: Record<string, unknown>): void;
  stop(): void;
  pause(): void;
  resume(): void;
  loadChunk(name: 'face'): Promise<unknown>;
  addCameraPipelineModule(module: Record<string, unknown>): void;
  addCameraPipelineModules(modules: Record<string, unknown>[]): void;
  clearCameraPipelineModules(): void;
  removeCameraPipelineModule?(name: string): void;
  runPreRender(timestamp: number): void;
  runRender(): void;
  runPostRender(): void;
  XrConfig: { device(): { ANY: string }; camera(): { FRONT: string } };
  FaceController: {
    configure(args: Record<string, unknown>): void;
    pipelineModule(): Record<string, unknown>;
    MeshGeometry: { FACE: string };
  };
}

/**
 * true when a HEAD/GET response is the real file, not a SPA fallback page.
 * Exported for the test; `kind` 'js' also accepts the legacy x-javascript types.
 */
export function isRealAsset(status: number, contentType: string | null, kind: 'js' | 'binary'): boolean {
  if (status < 200 || status >= 300) return false;
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/html')) return false;
  if (kind === 'js') return ct === '' || ct.includes('javascript') || ct.includes('ecmascript');
  return true;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`8th Wall ${what} timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function checkFile(base: string, path: string): Promise<void> {
  const kind = path.endsWith('.js') ? 'js' : 'binary';
  let res: Response;
  try {
    res = await fetch(base + path, { method: 'HEAD', cache: 'no-cache' });
  } catch (e) {
    throw new Error(`8th Wall file ${path} unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  // A server without HEAD support: let the real load decide.
  if (res.status === 405 || res.status === 501) return;
  if (!isRealAsset(res.status, res.headers.get('content-type'), kind)) {
    throw new Error(`8th Wall file ${path} missing (HTTP ${res.status}, ${res.headers.get('content-type') ?? 'no content-type'}) — run npm run copy:xr8`);
  }
}

type Xr8Window = Window & { XR8?: Xr8Global };

let loading: Promise<Xr8Global> | null = null;

/**
 * Load xr.js + the face chunk. Idempotent (one in-flight/settled promise);
 * a failure clears it so the next call retries from scratch.
 */
export function loadXr8(base: string = XR8_BASE_URL, timeoutMs: number = XR8_LOAD_TIMEOUT_MS): Promise<Xr8Global> {
  if (loading) return loading;
  const attempt = (async () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('8th Wall needs a browser');
    const w = window as Xr8Window;
    if (!w.XR8) {
      await withTimeout(Promise.all(XR8_REQUIRED_FILES.map((f) => checkFile(base, f))), timeoutMs, 'file check');
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>('script[data-beamwall-xr8]');
          const s = existing ?? document.createElement('script');
          const done = () => { window.removeEventListener('xrloaded', done); resolve(); };
          window.addEventListener('xrloaded', done);
          s.addEventListener('error', () => { window.removeEventListener('xrloaded', done); reject(new Error('8th Wall xr.js failed to load')); }, { once: true });
          // xr.js derives its resource base from its own src (engine resources.ts).
          if (!existing) {
            s.src = base + 'xr.js';
            s.async = true;
            s.dataset.beamwallXr8 = '1';
            document.head.appendChild(s);
          }
          if (w.XR8) done(); // already evaluated by an earlier, abandoned attempt
        }),
        timeoutMs,
        'xr.js load',
      );
    }
    const XR8 = w.XR8;
    if (!XR8 || typeof XR8.loadChunk !== 'function' || typeof XR8.run !== 'function') {
      throw new Error('8th Wall xr.js loaded but window.XR8 is incomplete');
    }
    // Idempotent in the engine (chunk-loader.ts: `if (g.FaceController) return`).
    await withTimeout(XR8.loadChunk('face'), timeoutMs, 'face chunk load');
    if (!XR8.FaceController || typeof XR8.FaceController.pipelineModule !== 'function') {
      throw new Error('8th Wall face chunk loaded but XR8.FaceController is missing');
    }
    return XR8;
  })();
  loading = attempt;
  attempt.catch(() => { if (loading === attempt) loading = null; });
  return attempt;
}

/** A frame source: the app's <video>, or the placeholder canvas used before the first poll. */
export type Xr8FrameSource = HTMLVideoElement | HTMLCanvasElement;

const sourceSize = (s: Xr8FrameSource): { width: number; height: number } =>
  s instanceof HTMLCanvasElement ? { width: s.width, height: s.height } : { width: s.videoWidth, height: s.videoHeight };

export interface Xr8SessionManager {
  /** The object handed to 8th Wall under the pipeline-module key `sessionManager`. */
  readonly manager: Record<string, unknown>;
  /** Point the engine at a new frame source (rebind; dimensions may change). */
  bind(source: Xr8FrameSource): void;
  readonly source: Xr8FrameSource;
  /** Size of the source as last reported to the engine. */
  readonly size: { width: number; height: number };
  /** Set when a frame was handed to the engine and not yet consumed (xr8Engine's inference clock). */
  stagedPending: boolean;
  /** false = report every frame as a repeat (hidden tab / idle). */
  enabled: boolean;
}

/**
 * The custom session manager. Frames are gated with the SAME DetectGate the
 * MediaPipe path uses (≤ 1 per `minIntervalMs`, only on a new video frame,
 * watchdog for a stalled currentTime), so 8th Wall never runs more inferences
 * than MediaPipe would.
 */
export function createXr8SessionManager(initial: Xr8FrameSource, minIntervalMs = 33): Xr8SessionManager {
  let source: Xr8FrameSource = initial;
  const size = { width: 0, height: 0 };
  const gate = createDetectGate();
  let lastStagedTime = -1;
  let placeholderTick = 0;
  let statusCb: ((s: Record<string, unknown>) => void) | null = null;

  const frameTime = (): number =>
    source instanceof HTMLCanvasElement ? placeholderTick : (source as HTMLVideoElement).currentTime;

  const self: Xr8SessionManager = {
    stagedPending: false,
    enabled: true,
    get source() { return source; },
    get size() { return size; },
    bind(next) {
      if (next === source) return;
      source = next;
      lastStagedTime = -1;
    },
    manager: {
      initialize: ({ runOnCameraStatusChange }: { runOnCameraStatusChange: (s: Record<string, unknown>) => void }) => {
        statusCb = runOnCameraStatusChange;
        return Promise.resolve();
      },
      obtainPermissions: () => Promise.resolve(),
      start: async () => {
        // The statuses getusermedia would report; nothing here opens a camera.
        statusCb?.({ status: 'requesting', cameraConfig: { direction: 'front' }, config: {}, rendersOpaque: false });
        statusCb?.({ status: 'hasStream', stream: null, rendersOpaque: false });
        statusCb?.({ status: 'hasVideo', video: source, rendersOpaque: false });
        return false; // not cancelled
      },
      stop: () => {},
      pause: () => {},
      resume: () => Promise.resolve(false),
      resumeIfAutoPaused: () => {},
      hasNewFrame: () => {
        const s = sourceSize(source);
        size.width = s.width;
        size.height = s.height;
        const now = performance.now();
        let fresh = self.enabled && s.width > 0 && s.height > 0;
        if (fresh && source instanceof HTMLVideoElement) {
          fresh = !source.paused && source.readyState >= 2;
        }
        if (fresh && source instanceof HTMLCanvasElement) placeholderTick = Math.floor(now / minIntervalMs);
        const t = frameTime();
        // The gate alone decides (it also lets a stalled video clock through on its watchdog).
        if (fresh) fresh = shouldDetect(gate, now, t, { minIntervalMs });
        return { repeatFrame: !fresh, videoSize: { width: size.width, height: size.height } };
      },
      frameStartResult: ({ repeatFrame, computeCtx, computeTexture }: {
        repeatFrame: boolean; computeCtx: WebGLRenderingContext; computeTexture: WebGLTexture;
      }) => {
        if (!repeatFrame) {
          computeCtx.bindTexture(computeCtx.TEXTURE_2D, computeTexture);
          computeCtx.texImage2D(computeCtx.TEXTURE_2D, 0, computeCtx.RGBA, computeCtx.RGBA, computeCtx.UNSIGNED_BYTE, source);
          lastStagedTime = frameTime();
          markDetected(gate, performance.now(), lastStagedTime);
          self.stagedPending = true;
        }
        return { textureWidth: size.width, textureHeight: size.height, videoTime: lastStagedTime };
      },
      providesRunLoop: () => false,
      getSessionAttributes: () => ({
        cameraLinkedToViewer: false,
        controlsCamera: false,
        fillsCameraTexture: true,
        providesRunLoop: false,
        supportsHtmlEmbedded: false,
        supportsHtmlOverlay: true,
        usesMediaDevices: true,
        usesWebXr: false,
      }),
    },
  };
  return self;
}
