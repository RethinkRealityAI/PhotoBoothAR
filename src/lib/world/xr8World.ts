/**
 * World mode on 8th Wall's floor tracking (SLAM).
 *
 * World tracking: @8thwall/engine-binary 1.0.0, (c) Niantic Spatial, XR Engine
 * License: https://github.com/8thwall/engine/blob/main/LICENSE
 * Loaded UNMODIFIED from jsDelivr at a pinned version, as the licence requires
 * (never vendored or patched). Credited on /licences, linked from the booth's
 * menu. Dapo chose this engine for the 3D standing frames on 2026-11-24.
 *
 * The binary and the open-source face engine both define window.XR8, so they
 * can never share a page. The booth therefore runs world mode as its own page
 * load (`/e/<slug>/booth?ar=<frameId>`): the face engine never starts there,
 * and leaving world mode is a full page load back to the normal booth.
 *
 * How it plugs into the booth (the guide's boot sequence, adapted):
 *  - XR8 owns the back camera (getUserMedia + motion sensors). Its MediaStream
 *    ('hasStream') is handed to the booth as the camera stream, so photos,
 *    clips and the microphone work exactly as before.
 *  - XR8 draws the camera picture it tracked (GlTextureRenderer) into our own
 *    canvas, created with preserveDrawingBuffer so the booth's compositor can
 *    read it at any time. The pose of THAT picture is kept beside it, so the
 *    standing frame and the room are always drawn from the same moment: no
 *    swimming against the picture.
 *  - World frame: floor at y = 0, camera starts at CAM_H, responsive scale
 *    (1 unit ≈ 1 m on a floor).
 */
import { createSettleGate, settleRestart, settleStep, isSettled, type SettleGate } from './arSession';

export const XR8_BINARY_VERSION = '1.0.0';
export const XR8_BINARY_URL = `https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@${XR8_BINARY_VERSION}/dist/xr.js`;
export const XR8_LICENCE_URL = 'https://github.com/8thwall/engine/blob/main/LICENSE';
const LOAD_TIMEOUT_MS = 25_000;
/** iOS sometimes never reports 'failed' (the guide's 15 s camera timeout). */
const CAMERA_TIMEOUT_MS = 15_000;

/** The subset of the binary's window.XR8 used here (read from dist/xr.js 1.0.0). */
interface Xr8Binary {
  run(config: Record<string, unknown>): void;
  stop(): void;
  addCameraPipelineModules(modules: Record<string, unknown>[]): void;
  clearCameraPipelineModules(): void;
  XrConfig: { device(): { ANY: string; MOBILE_AND_HEADSETS: string }; camera(): { BACK: string } };
  XrController: {
    configure(args: Record<string, unknown>): void;
    pipelineModule(): Record<string, unknown>;
    updateCameraProjectionMatrix(args: Record<string, unknown>): void;
    recenter(): void;
  };
  GlTextureRenderer: { pipelineModule(args?: Record<string, unknown>): Record<string, unknown> };
}
type Xr8Window = Window & { XR8?: Xr8Binary };

interface Vec3 { x: number; y: number; z: number }
interface Quat { x: number; y: number; z: number; w: number }
export interface WorldPose {
  position: Vec3;
  rotation: Quat;
  /** Column-major projection matrix for the run canvas. */
  intrinsics: Float32Array;
}

/** Is this a phone or tablet? By user agent, never touch (the guide, section 2). */
export function isPhoneUa(ua: string, platform: string, maxTouchPoints: number): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

let loading: Promise<Xr8Binary> | null = null;

/** Load the engine once. Rejects (never hangs) on a network error or a timeout. */
export function loadWorldEngine(): Promise<Xr8Binary> {
  if (loading) return loading;
  const attempt = new Promise<Xr8Binary>((resolve, reject) => {
    const w = window as Xr8Window;
    if (w.XR8) { resolve(w.XR8); return; }
    const timer = window.setTimeout(() => fail(new Error('8th Wall world engine took too long to load')), LOAD_TIMEOUT_MS);
    const done = () => {
      window.clearTimeout(timer);
      window.removeEventListener('xrloaded', done);
      if (w.XR8) resolve(w.XR8); else reject(new Error('8th Wall world engine loaded without XR8'));
    };
    const fail = (e: Error) => { window.clearTimeout(timer); window.removeEventListener('xrloaded', done); reject(e); };
    window.addEventListener('xrloaded', done);
    const s = document.createElement('script');
    s.src = XR8_BINARY_URL;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.dataset.preloadChunks = 'slam';
    s.dataset.beamwallWorld = '1';
    s.addEventListener('error', () => fail(new Error('8th Wall world engine failed to load')), { once: true });
    document.head.appendChild(s);
  });
  loading = attempt;
  attempt.catch(() => { if (loading === attempt) loading = null; });
  return attempt;
}

export type WorldTracking = 'NORMAL' | 'LIMITED' | 'UNKNOWN';

export interface WorldFrame {
  source: HTMLCanvasElement;
  width: number;
  height: number;
  /** Changes whenever the picture (and its pose) changes. */
  key: number;
  /** When that picture was drawn (performance.now() ms). */
  frameMs: number;
}

/**
 * One world-tracking run. `start()` MUST be called synchronously inside the
 * tap that starts placing (iOS asks for camera and motion access only from a
 * gesture). It resolves with the camera stream.
 */
export class WorldSession {
  private XR8: Xr8Binary | null = null;
  private host: HTMLElement | null = null;
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  private streamPromise: Promise<MediaStream> | null = null;
  private running = false;
  private seq = 0;
  private hasVideo = false;
  private latest: WorldPose | null = null;
  /** The pose of the picture currently in `canvas`. */
  private drawn: WorldPose | null = null;
  private lastFrameMs = 0;
  private drawnMs = Number.NaN;
  private gate: SettleGate = createSettleGate();
  tracking: WorldTracking = 'UNKNOWN';
  /** Bumped on any change the DOM shows (status, settled). */
  onChange: (() => void) | null = null;
  error: string | null = null;

  constructor(private readonly camHeight: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 720;
    this.canvas.height = 1280;
  }

  /** Engine loaded and ready to start (Start placing enabled). */
  get loaded(): boolean { return this.XR8 !== null; }
  get started(): boolean { return this.streamPromise !== null; }
  get live(): boolean { return this.hasVideo; }

  async load(): Promise<void> {
    this.XR8 = await loadWorldEngine();
    this.onChange?.();
  }

  /**
   * Size the run canvas to the stage: XR8's intrinsics describe exactly this
   * canvas, and the booth cover-fits it to the stage, so its aspect must match.
   */
  sizeTo(cssW: number, cssH: number): void {
    if (!(cssW > 0) || !(cssH > 0)) return;
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    let w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    const long = Math.max(w, h);
    if (long > 1920) { const k = 1920 / long; w = Math.round(w * k); h = Math.round(h * k); }
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  /** Synchronous part runs inside the tap. Resolves with XR8's camera stream. */
  start(host: HTMLElement): Promise<MediaStream> {
    if (this.streamPromise) return this.streamPromise;
    const XR8 = this.XR8;
    if (!XR8) return Promise.reject(new Error('8th Wall world engine not loaded'));
    this.host = host;
    // XR8 appends its own (1 px) video beside the canvas, so the canvas lives in
    // the DOM, out of sight. Its drawing buffer is what the booth shows.
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:1px!important;height:1px!important;opacity:0;pointer-events:none';
    host.appendChild(this.canvas);
    // Our context first: XR8's getContext gets this one, with a drawing buffer
    // the compositor can read between frames.
    this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false, antialias: false })
      ?? this.canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: false });

    this.streamPromise = new Promise<MediaStream>((resolve, reject) => {
      let settled = false;
      const ok = (s: MediaStream) => { if (!settled) { settled = true; window.clearTimeout(t); resolve(s); } };
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(t);
        this.error = e.message;
        this.stop();
        reject(e);
      };
      const t = window.setTimeout(() => fail(new Error('the camera did not start')), CAMERA_TIMEOUT_MS);
      const module = {
        name: 'beamwall-world',
        onStart: () => {
          XR8.XrController.updateCameraProjectionMatrix({
            origin: { x: 0, y: this.camHeight, z: 0 },
            facing: { x: 0, y: 0, z: 0, w: 1 },
          });
        },
        onCameraStatusChange: ({ status, stream, video, reason }: { status: string; stream?: MediaStream; video?: HTMLVideoElement; reason?: string }) => {
          if (status === 'hasStream' && stream) ok(stream);
          if (status === 'hasVideo') {
            // The booth may add the microphone to this stream: never play it aloud.
            if (video) { video.muted = true; video.setAttribute('muted', ''); }
            if (!this.hasVideo) { this.hasVideo = true; this.gate = settleRestart(this.gate, performance.now()); this.onChange?.(); }
          }
          if (status === 'failed') fail(new Error(`the camera could not start (${reason ?? 'UNSPECIFIED'})`));
        },
        onException: (e: unknown) => {
          const o = e as { message?: string; type?: string } | null;
          const msg = String(o?.message ?? JSON.stringify(e));
          console.warn('[xr8World]', msg);
          if (!this.hasVideo) fail(new Error(o?.type === 'permission' ? 'motion access was refused' : msg));
        },
        onUpdate: ({ processCpuResult }: { processCpuResult?: { reality?: {
          position?: Vec3; rotation?: Quat; intrinsics?: ArrayLike<number>; trackingStatus?: string;
        } } }) => {
          const r = processCpuResult?.reality;
          const now = performance.now();
          const gap = this.lastFrameMs > 0 ? now - this.lastFrameMs : 0;
          this.lastFrameMs = now;
          if (r?.trackingStatus === 'NORMAL' || r?.trackingStatus === 'LIMITED') this.tracking = r.trackingStatus;
          const wasSettled = isSettled(this.gate);
          this.gate = settleStep(this.gate, now, this.tracking === 'NORMAL', gap);
          if (isSettled(this.gate) !== wasSettled) this.onChange?.();
          if (!r?.position || !r.rotation || !r.intrinsics || r.intrinsics.length < 16) return;
          const p = this.latest ?? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, intrinsics: new Float32Array(16) };
          p.position.x = r.position.x; p.position.y = r.position.y; p.position.z = r.position.z;
          p.rotation.x = r.rotation.x; p.rotation.y = r.rotation.y; p.rotation.z = r.rotation.z; p.rotation.w = r.rotation.w;
          for (let i = 0; i < 16; i++) p.intrinsics[i] = r.intrinsics[i];
          this.latest = p;
        },
        // After GlTextureRenderer (added before this module) drew this tick's
        // picture: that picture and this pose now belong together.
        onRender: () => {
          if (!this.latest) return;
          const d = this.drawn ?? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, intrinsics: new Float32Array(16) };
          d.position = { ...this.latest.position };
          d.rotation = { ...this.latest.rotation };
          d.intrinsics.set(this.latest.intrinsics);
          this.drawn = d;
          this.drawnMs = performance.now();
          this.seq++;
        },
        listeners: [{
          event: 'reality.trackingstatus',
          process: ({ detail }: { detail?: { status?: string } }) => {
            if (detail?.status === 'NORMAL' || detail?.status === 'LIMITED') this.tracking = detail.status;
          },
        }],
      };
      try {
        XR8.clearCameraPipelineModules();
        XR8.XrController.configure({ disableWorldTracking: false, scale: 'responsive' });
        XR8.addCameraPipelineModules([
          XR8.GlTextureRenderer.pipelineModule(), // the tracked camera picture, into our canvas
          XR8.XrController.pipelineModule(),      // SLAM
          module,
        ]);
        XR8.run({
          canvas: this.canvas,
          webgl2: this.gl instanceof WebGL2RenderingContext,
          allowedDevices: XR8.XrConfig.device().MOBILE_AND_HEADSETS,
          cameraConfig: { direction: XR8.XrConfig.camera().BACK },
        });
        this.running = true;
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });
    return this.streamPromise;
  }

  /** The tracked picture, for the compositor. null until the first frame. */
  frame(): WorldFrame | null {
    if (!this.hasVideo || this.seq === 0) return null;
    return { source: this.canvas, width: this.canvas.width, height: this.canvas.height, key: this.seq, frameMs: this.drawnMs };
  }

  /** The pose of the picture in `frame()`. */
  pose(): WorldPose | null { return this.drawn; }

  /** SLAM settled since this run started (the guide's settle gate). */
  settled(): boolean { return isSettled(this.gate); }

  /** Re-anchor after real drift; re-arms the settle gate. */
  recenter(): void {
    try { this.XR8?.XrController.recenter(); } catch { /* not running */ }
    this.gate = settleRestart(this.gate, performance.now());
    this.onChange?.();
  }

  stop(): void {
    if (this.running) {
      this.running = false;
      try { this.XR8?.stop(); } catch { /* already stopped */ }
      try { this.XR8?.clearCameraPipelineModules(); } catch { /* engine gone */ }
    }
    this.streamPromise = null;
    this.hasVideo = false;
    this.seq = 0;
    this.latest = this.drawn = null;
    this.tracking = 'UNKNOWN';
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    void this.host;
  }
}
