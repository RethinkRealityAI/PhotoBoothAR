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
 *  - The engine's camera position wobbles by millimetres between pictures,
 *    which shows as a trembling frame from close up; it has no smoothing of
 *    its own, so the position is steadied here (lib/world/poseSteady.ts).
 *  - Room light (lib/world/lightEstimate.ts): 8th Wall's exposure estimate plus
 *    our own colour sample of the picture, so the standing Frame is as bright
 *    and as warm as the room it stands in.
 *  - Sky effects (lib/world/skyFx.ts): when the page opens with one, 8th Wall's
 *    sky layer runs beside SLAM and our own pass repaints the sky in the run
 *    canvas, after the camera picture and before the booth reads it. The layer
 *    can only be added before the run starts (added later it never produces a
 *    mask: tested on the real engine), which is why picking the first sky
 *    effect on a page that started without one reloads the page.
 *  - World frame: floor at y = 0, camera starts at CAM_H, responsive scale
 *    (1 unit ≈ 1 m on a floor).
 */
import { createSettleGate, settleRestart, settleStep, isSettled, type SettleGate } from './arSession';
import { WorldPoseSteady, worldSteadyFrom, type WorldSteadyOptions } from './poseSteady';
import { boardLight, meanOfRow, worldLightFrom, type Rgb } from './lightEstimate';
import {
  domeRotation, easeSkyline, headingOf, skylineElevation, SKY_MIN_SHARE, type SkyEffectId,
} from './skyFx';
import { SkyPass, skyTextCanvas } from './skyShader';

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
  LayersController?: {
    configure(args: Record<string, unknown>): void;
    pipelineModule(): Record<string, unknown>;
  };
}

/** One sky effect, ready to draw: its id, the event's two colours, and the words (or none). */
export interface SkySpec {
  id: SkyEffectId;
  a: Rgb;
  b: Rgb;
  text: string | null;
}

export interface WorldSessionOptions {
  /** Run 8th Wall's sky layer in this session (decided before it starts). */
  skyLayer?: boolean;
  /** Estimate the room's light for the standing Frame. */
  light?: boolean;
}
const SKY_FADE_MS = 700;
const SKY_PROBE_EVERY_MS = 450;
const LIGHT_EVERY_MS = 350;
/** Rows of the canvas sampled for the room's colour, as a share of its height from the bottom. */
const LIGHT_ROWS = [0.2, 0.34, 0.48];
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
  private steady: WorldPoseSteady;
  private rawPos: [number, number, number] = [0, 0, 0];
  private rawQuat: [number, number, number, number] = [0, 0, 0, 1];
  private steadyPos: [number, number, number] = [0, 0, 0];
  private steadyQuat: [number, number, number, number] = [0, 0, 0, 1];
  private readonly skyLayer: boolean;
  private readonly lightOn: boolean;
  private skyPass: SkyPass | null = null;
  private skySpec: SkySpec | null = null;
  private skyDirty = false;
  private skyText: HTMLCanvasElement | null = null;
  private skyOnMs = Number.NaN;
  private skyHeading: [number, number] | null = null;
  private skyBase: number | null = null;
  private skyProbeMs = 0;
  private skyMask: WebGLTexture | null = null;
  private skyCam: WebGLTexture | null = null;
  private skyVp: { offsetX: number; offsetY: number; width: number; height: number } | null = null;
  private readonly skyRot = new Float32Array(9);
  /** When sky was last in view (performance.now() ms); NaN = never yet. */
  private skySeenMs = Number.NaN;
  private exposure: number | null = null;
  private sceneRgb: Rgb | null = null;
  private lightMs = 0;
  private lightRow = 0;
  private lightPx: Uint8Array | null = null;
  tracking: WorldTracking = 'UNKNOWN';
  /** Bumped on any change the DOM shows (status, settled). */
  onChange: (() => void) | null = null;
  error: string | null = null;

  constructor(
    private readonly camHeight: number,
    steady: WorldSteadyOptions = worldSteadyFrom(typeof location !== 'undefined' ? location.search : ''),
    opts: WorldSessionOptions = {},
  ) {
    this.steady = new WorldPoseSteady(steady);
    this.skyLayer = opts.skyLayer === true;
    this.lightOn = opts.light ?? worldLightFrom(typeof location !== 'undefined' ? location.search : '');
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
        onUpdate: ({ processCpuResult, processGpuResult }: {
          processCpuResult?: {
            reality?: {
              position?: Vec3; rotation?: Quat; intrinsics?: ArrayLike<number>; trackingStatus?: string;
              lighting?: { exposure?: number };
            };
            layerscontroller?: {
              cameraFeedTexture?: WebGLTexture;
              layers?: { sky?: { texture?: WebGLTexture; percentage?: number } };
            };
          };
          processGpuResult?: { gltexturerenderer?: { viewport?: { offsetX: number; offsetY: number; width: number; height: number } } };
        }) => {
          const r = processCpuResult?.reality;
          const now = performance.now();
          const ex = r?.lighting?.exposure;
          if (typeof ex === 'number' && Number.isFinite(ex)) this.exposure = ex;
          const vp = processGpuResult?.gltexturerenderer?.viewport;
          if (vp && vp.width > 0 && vp.height > 0) this.skyVp = vp;
          const layer = processCpuResult?.layerscontroller;
          const sky = layer?.layers?.sky;
          this.skyMask = sky?.texture ?? null;
          this.skyCam = layer?.cameraFeedTexture ?? null;
          if (typeof sky?.percentage === 'number' && sky.percentage >= SKY_MIN_SHARE) this.skySeenMs = now;
          const gap = this.lastFrameMs > 0 ? now - this.lastFrameMs : 0;
          this.lastFrameMs = now;
          if (r?.trackingStatus === 'NORMAL' || r?.trackingStatus === 'LIMITED') this.tracking = r.trackingStatus;
          const wasSettled = isSettled(this.gate);
          this.gate = settleStep(this.gate, now, this.tracking === 'NORMAL', gap);
          if (isSettled(this.gate) !== wasSettled) this.onChange?.();
          if (!r?.position || !r.rotation || !r.intrinsics || r.intrinsics.length < 16) return;
          const p = this.latest ?? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, intrinsics: new Float32Array(16) };
          // Steadied (poseSteady.ts): the raw position trembles from close up.
          const rp = this.rawPos, rq = this.rawQuat, sp = this.steadyPos, sq = this.steadyQuat;
          rp[0] = r.position.x; rp[1] = r.position.y; rp[2] = r.position.z;
          rq[0] = r.rotation.x; rq[1] = r.rotation.y; rq[2] = r.rotation.z; rq[3] = r.rotation.w;
          this.steady.step(rp, rq, gap, sp, sq);
          p.position.x = sp[0]; p.position.y = sp[1]; p.position.z = sp[2];
          p.rotation.x = sq[0]; p.rotation.y = sq[1]; p.rotation.z = sq[2]; p.rotation.w = sq[3];
          for (let i = 0; i < 16; i++) p.intrinsics[i] = r.intrinsics[i];
          this.latest = p;
        },
        // After GlTextureRenderer (added before this module) drew this tick's
        // picture: that picture and this pose now belong together.
        onRender: () => {
          const now = performance.now();
          this.drawSky(now);
          this.sampleLight(now);
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
        XR8.XrController.configure({ disableWorldTracking: false, scale: 'responsive', enableLighting: this.lightOn });
        const modules = [
          XR8.GlTextureRenderer.pipelineModule(), // the tracked camera picture, into our canvas
          XR8.XrController.pipelineModule(),      // SLAM
        ];
        if (this.skyLayer && XR8.LayersController) {
          // edgeSmoothness 0: the crispest mask (0.5 blurs rooftops into the sky).
          XR8.LayersController.configure({ layers: { sky: { invertLayerMask: false, edgeSmoothness: 0 } } });
          modules.push(XR8.LayersController.pipelineModule());
        }
        modules.push(module);
        XR8.addCameraPipelineModules(modules);
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

  /* ---------------------------- sky effects ---------------------------- */

  /** This run can paint the sky (its sky layer was started with it). */
  get skyCapable(): boolean { return this.skyLayer; }

  /** The sky effect to paint, or null for the plain camera picture. */
  setSky(spec: SkySpec | null): void {
    const was = this.skySpec;
    this.skySpec = spec;
    this.skyDirty = true;
    if (spec === null || was?.id !== spec.id) { this.skyOnMs = Number.NaN; this.skyHeading = null; }
    this.skyText = null;
    if (spec?.id === 'names' && spec.text) {
      const text = spec.text;
      const build = () => { if (this.skySpec === spec) { this.skyText = skyTextCanvas(text); this.skyDirty = true; } };
      build();
      // Again once the event's serif is in (the first draw may have used a fallback face).
      try { void document.fonts.load('italic 500 150px "Cormorant Garamond"', text).then(build, () => {}); } catch { /* no font loading API */ }
    }
  }

  /** Milliseconds since sky was last in view; Infinity before any was seen. */
  sinceSky(now: number): number {
    return Number.isFinite(this.skySeenMs) ? now - this.skySeenMs : (this.hasVideo ? Number.POSITIVE_INFINITY : 0);
  }

  private drawSky(now: number): void {
    const spec = this.skySpec, gl = this.gl, pose = this.latest;
    if (!spec || !gl || !pose || !this.skyMask || !this.skyCam || !this.skyVp) return;
    try {
      const pass = this.skyPass ?? (this.skyPass = new SkyPass(gl));
      if (!pass.supported) return;
      if (this.skyDirty) {
        this.skyDirty = false;
        pass.use(spec.id, spec.a, spec.b);
        pass.setText(spec.id === 'names' ? this.skyText : null);
      }
      if (!Number.isFinite(this.skyOnMs)) this.skyOnMs = now;
      // The effect is laid out in front of where the guest was looking when it came on.
      const heading = this.skyHeading ?? (this.skyHeading = headingOf(pose.rotation));
      const view = {
        vp: this.skyVp, canvasW: this.canvas.width, canvasH: this.canvas.height,
        proj: pose.intrinsics, rot: domeRotation(pose.rotation, heading, this.skyRot),
      };
      if (now - this.skyProbeMs >= SKY_PROBE_EVERY_MS) {
        this.skyProbeMs = now;
        const probe = pass.probe(this.skyMask);
        const reading = probe ? skylineElevation(probe, view) : null;
        if (reading !== null) this.skyBase = easeSkyline(this.skyBase, reading);
      }
      pass.draw({
        mask: this.skyMask, cam: this.skyCam, ...view,
        time: (now - this.skyOnMs) / 1000,
        fade: Math.min(1, (now - this.skyOnMs) / SKY_FADE_MS),
        base: this.skyBase ?? 0,
      });
    } catch (e) {
      console.warn('[xr8World] sky effect failed', e);
      this.skySpec = null;
    }
  }

  /* ----------------------------- room light ---------------------------- */

  /** The colour to multiply the standing Frame by (lib/world/lightEstimate). */
  light(): Rgb {
    return this.lightOn ? boardLight(this.exposure, this.sceneRgb) : [1, 1, 1];
  }

  /** One row of the finished picture every LIGHT_EVERY_MS: the room's colour, with any sky grade in it. */
  private sampleLight(now: number): void {
    const gl = this.gl;
    if (!this.lightOn || !gl || !this.hasVideo || now - this.lightMs < LIGHT_EVERY_MS) return;
    this.lightMs = now;
    const w = this.canvas.width, h = this.canvas.height;
    if (!this.lightPx || this.lightPx.length !== w * 4) this.lightPx = new Uint8Array(w * 4);
    try {
      const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const y = Math.round(h * LIGHT_ROWS[this.lightRow = (this.lightRow + 1) % LIGHT_ROWS.length]);
      gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.lightPx);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      const m = meanOfRow(this.lightPx);
      if (m) {
        // Three rows take turns: average them as they come in.
        const s = this.sceneRgb;
        this.sceneRgb = s ? [s[0] + (m[0] - s[0]) / 3, s[1] + (m[1] - s[1]) / 3, s[2] + (m[2] - s[2]) / 3] : m;
      }
    } catch { /* context lost: keep the last reading */ }
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
    this.steady.reset();
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
    this.steady.reset();
    this.tracking = 'UNKNOWN';
    try { this.skyPass?.dispose(); } catch { /* context gone */ }
    this.skyPass = null;
    this.skyDirty = true;
    this.skyMask = this.skyCam = null;
    this.skyVp = null;
    this.skyOnMs = this.skySeenMs = Number.NaN;
    this.skyHeading = null;
    this.skyBase = null;
    this.exposure = null;
    this.sceneRgb = null;
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    void this.host;
  }
}
