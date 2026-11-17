/**
 * Face-engine comparison: MediaPipe vs 8th Wall, through the REAL engine
 * modules (src/lib/faceEngine/mediapipeEngine.ts and xr8Engine.ts, bundled
 * with esbuild), on a fake camera fed from a .y4m clip, in headless Chromium.
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ SOFTWARE-GL NUMBERS ARE NOT PHONE NUMBERS. This runs on SwiftShader   │
 *   │ (CPU-emulated WebGL) on a server CPU. Absolute timings (init, rate,   │
 *   │ blocking ms) say nothing about a phone; use them only to compare the  │
 *   │ two engines against EACH OTHER on the same machine. Jitter and lag    │
 *   │ are better behaved, but a real camera adds sensor noise a still clip │
 *   │ does not have.                                                        │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Per engine it prints: init time, time-to-first-pose, pose rate, mean
 * main-thread blocking per inference, static jitter RAW and after faceRig's
 * own One-Euro filters (POS_FILTER/ROT_FILTER are READ from src/lib/faceRig.ts,
 * so this cannot drift from them), and the lag on a motion clip.
 *
 * FRAME-LOCKED REGISTRATION (motion clip with a burned-in frame index, below):
 * every render frame, four head-anchored points are projected with the pose the
 * app holds (raw, and through faceRig's One-Euro) and compared with where those
 * points TRULY are (the clip is a rotated still, so truth is an exact image
 * rotation) in (i) the NEWEST video frame — what the user sees when the AR
 * layer is drawn over the live <video> — and (ii) the ANALYSED frame the pose
 * was computed from — what they see when the compositor draws
 * engine.getAnalysedFrame() instead (MediaPipe has none: its row says what it
 * WOULD be). It also prints the 8th Wall lag breakdown (frame arrival → upload
 * → result → poll), the engine-internal smoothing lag fitted in frames, a
 * pixel comparison of the analysed canvas against the <video> (normal, flipped,
 * mirrored), and what frame lock costs per frame.
 *
 * Usage:
 *   npm run copy:vendor          # public/xr8, public/mediapipe must exist
 *   node scripts/check-face-engines.mjs --static <still.y4m> [--motion <rollbar.y4m>] [--secs 12]
 *        [--xr8-drive poll|raf] [--same-tick 0|1] [--lifecycle]
 *
 * Clips (ffmpeg; 540x960, a face filling ~1/3 of the frame):
 *   still:   ffmpeg -loop 1 -i face.jpg -t 6 -r 30 -vf scale=540:960 -pix_fmt yuv420p still.y4m
 *   rollbar: ffmpeg -loop 1 -framerate 30 -i face.jpg -t 6 -vf "scale=540:960,rotate=0.3491*sin(2*PI*t/3):fillcolor=black,format=gray,
 *              geq=lum='if(lt(Y,24)*lt(X,288), 255*mod(floor(N/pow(2,floor(X/24))),2), lum(X,Y))'" -pix_fmt yuv420p rollbar.y4m
 *            (a ±20° roll, 3 s period, frame index N burned LSB-first into 12 24-px cells, top-left).
 * The motion phase rows use the roll's sine fit; both engines run one after the
 * other in ONE page on the same stream, so the DIFFERENCE between the columns is
 * the extra lag; absolutes mean nothing. The registration rows need no such
 * caveat: they are measured against each frame's own index.
 *
 * --lifecycle (static clip only): init → dispose ×6, WEBGL_lose_context
 * lose/restore, and a mid-run <video> swap to another resolution, counting GL
 * contexts, pending rAF callbacks and net event listeners.
 *
 * Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium), PORT (default 5192).
 */
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);
const STATIC = arg('static');
const MOTION = arg('motion');
const SECS = Number(arg('secs', '12'));
const LIFECYCLE = flag('lifecycle');
const COMPAT = flag('compat');
const XR8_OPTS = {};
if (arg('xr8-drive') !== undefined) XR8_OPTS.drive = arg('xr8-drive');
if (arg('same-tick') !== undefined) XR8_OPTS.sameTickInference = arg('same-tick') === '1';
const PORT = Number(process.env.PORT ?? 5192);
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
if (!STATIC || !existsSync(STATIC)) {
  console.error('usage: node scripts/check-face-engines.mjs --static <still.y4m> [--motion <rollbar.y4m>] [--secs 12] [--xr8-drive poll|raf] [--same-tick 0|1] [--lifecycle]');
  process.exit(2);
}
for (const f of ['public/xr8/xr.js', 'public/mediapipe/wasm/vision_wasm_internal.wasm', 'public/models/face_landmarker.task']) {
  if (!existsSync(join(root, f))) {
    console.error(`[check-face-engines] missing ${f} — run npm run copy:vendor`);
    process.exit(2);
  }
}

// faceRig's filter configs, read from the source so this script follows them.
const rigSrc = readFileSync(join(root, 'src/lib/faceRig.ts'), 'utf8');
const readCfg = (name) => {
  const m = rigSrc.match(new RegExp(`const ${name}: OneEuroConfig = (\\{[^}]*\\})`));
  if (!m) throw new Error(`could not read ${name} from faceRig.ts`);
  return JSON.parse(m[1].replace(/(\w+):/g, '"$1":'));
};
const POS_FILTER = readCfg('POS_FILTER');
const ROT_FILTER = readCfg('ROT_FILTER');

/** Head-frame points (cm) whose image positions are compared: nose, forehead, both cheeks. */
const ANCHORS = [[0, -1, 7], [0, 7, 4], [6, -2, 3], [-6, -2, 3]];

// ---- bundle the real engines --------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'face-engines-'));
const entry = join(work, 'entry.ts');
writeFileSync(entry, `
import { createXr8Engine } from ${JSON.stringify(join(root, 'src/lib/faceEngine/xr8Engine.ts'))};
import { createMediapipeEngine } from ${JSON.stringify(join(root, 'src/lib/faceEngine/mediapipeEngine.ts'))};
import { OneEuroVec3, OneEuroQuat } from ${JSON.stringify(join(root, 'src/lib/smoothing.ts'))};

const ANCHORS: number[][] = ${JSON.stringify(ANCHORS)};
const F63 = 1 / Math.tan((63 / 2) * Math.PI / 180);

function quatOf(m: ArrayLike<number>): [number, number, number, number] {
  const n = (c: number) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]) || 1;
  const sx = n(0), sy = n(1), sz = n(2);
  const m00 = m[0] / sx, m10 = m[1] / sx, m20 = m[2] / sx, m01 = m[4] / sy, m11 = m[5] / sy, m21 = m[6] / sy;
  const m02 = m[8] / sz, m12 = m[9] / sz, m22 = m[10] / sz;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  return [x, y, z, w];
}
/** Column-major matrix from position, unit quaternion and per-axis scale. */
function compose(p: number[], q: number[], s: number[]): number[] {
  const [x, y, z, w] = q;
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
  return [r[0] * s[0], r[1] * s[0], r[2] * s[0], 0, r[3] * s[1], r[4] * s[1], r[5] * s[1], 0, r[6] * s[2], r[7] * s[2], r[8] * s[2], 0, p[0], p[1], p[2], 1];
}
/** Image px of a head-frame point under the contract camera (63° vertical fov over the full frame, unmirrored). */
function project(m: ArrayLike<number>, a: number[], W: number, H: number): [number, number] {
  const X = m[0] * a[0] + m[4] * a[1] + m[8] * a[2] + m[12];
  const Y = m[1] * a[0] + m[5] * a[1] + m[9] * a[2] + m[13];
  const Z = m[2] * a[0] + m[6] * a[1] + m[10] * a[2] + m[14];
  return [((X * F63) / ((W / H) * -Z) + 1) / 2 * W, (1 - (Y * F63) / -Z) / 2 * H];
}
const projAll = (m: ArrayLike<number>, W: number, H: number) => ANCHORS.map((a) => project(m, a, W, H));

// ---- burned-in frame index (12 cells of 24 px, LSB first, top-left) -----------
const BAR_W = 288, BAR_H = 24;
const barCanvas = document.createElement('canvas');
barCanvas.width = BAR_W; barCanvas.height = BAR_H;
const barCtx = barCanvas.getContext('2d', { willReadFrequently: true })!;
/** Frame index shown by a video/canvas, or -1 when the cells are not clean black/white (not upright, mirrored, or no bar). */
function readBar(src: CanvasImageSource | null): number {
  if (!src) return -1;
  try {
    barCtx.clearRect(0, 0, BAR_W, BAR_H);
    barCtx.drawImage(src, 0, 0, BAR_W, BAR_H, 0, 0, BAR_W, BAR_H);
    const d = barCtx.getImageData(0, 0, BAR_W, BAR_H).data;
    let n = 0;
    for (let b = 0; b < 12; b++) {
      const i = (12 * BAR_W + b * 24 + 12) * 4;
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (Math.abs(l - 127.5) < 100) return -1;
      if (l > 127.5) n |= 1 << b;
    }
    return n;
  } catch { return -1; }
}

let shared: HTMLVideoElement | null = null;
/** Every presentation of each frame index: [index, time] (the clip loops, so an index recurs every 6 s). */
const arrivals: [number, number][] = [];
async function openVideo(constraints: MediaTrackConstraints): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  // In the DOM (invisible) so requestVideoFrameCallback reports every presented frame.
  video.style.cssText = 'position:fixed;left:0;top:0;width:54px;height:96px;opacity:0.01;pointer-events:none';
  document.body.appendChild(video);
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: constraints });
  await video.play();
  while (video.videoWidth === 0) await new Promise((r) => setTimeout(r, 20));
  return video;
}
async function camera(): Promise<HTMLVideoElement> {
  if (shared) return shared;
  const video = await openVideo({ width: 540, height: 960 });
  const v = video as any;
  if (typeof v.requestVideoFrameCallback === 'function') {
    const onFrame = (_now: number, meta: any) => {
      const n = readBar(video);
      if (n >= 0) arrivals.push([n, meta.presentationTime ?? performance.now()]);
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  }
  return (shared = video);
}

/** Pixel comparison of the analysed canvas against the <video> frame (as is, flipped vertically, mirrored). */
function compareFrames(video: HTMLVideoElement, frame: CanvasImageSource, W: number, H: number) {
  const grab = (src: CanvasImageSource, flipY: boolean, mirror: boolean) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.setTransform(mirror ? -1 : 1, 0, 0, flipY ? -1 : 1, mirror ? W : 0, flipY ? H : 0);
    g.drawImage(src, 0, 0, W, H);
    return g.getImageData(0, 0, W, H).data;
  };
  const f = grab(frame, false, false);
  const out: any = {};
  for (const [k, fy, mi] of [['asIs', false, false], ['flippedY', true, false], ['mirrored', false, true]] as const) {
    const v = grab(video, fy, mi);
    let max = 0, sum = 0;
    for (let i = 0; i < f.length; i += 4) {
      const e = Math.max(Math.abs(f[i] - v[i]), Math.abs(f[i + 1] - v[i + 1]), Math.abs(f[i + 2] - v[i + 2]));
      if (e > max) max = e;
      sum += e;
    }
    out[k] = { max, mean: sum / (f.length / 4) };
  }
  return out;
}

// Both engines run one after the other on the SAME stream in one page, so the
// fake camera's phase offset is shared and their lags are comparable.
(window as any).__check = async (id: 'mediapipe' | 'xr8', secs: number, posCfg: any, rotCfg: any, opts: { bar: boolean; orient: boolean; xr8: any }) => {
  const video = await camera();
  const engine: any = id === 'xr8' ? createXr8Engine(opts.xr8) : createMediapipeEngine();
  const t0 = performance.now();
  await engine.init();
  const initMs = performance.now() - t0;
  const block: number[] = [];
  const staged: any[] = [], emits: any[] = [], renderMs: number[] = [];
  // 8th Wall blocks inside its pipeline passes: time each pass's three stages, keep passes that inferred or staged.
  if (id === 'xr8') {
    const X = (window as any).XR8;
    let tick = 0, lastInf = engine.lastInferenceMs(), lastUploads = 0, lastEmitted = NaN, pendingEmit: any = null;
    const timed = (k: string, after?: (ms: number) => void) => {
      const f = X[k].bind(X);
      X[k] = (...a: any[]) => {
        const s = performance.now();
        try { return f(...a); } finally { const d = performance.now() - s; tick += d; after?.(d); }
      };
    };
    timed('runPreRender', () => {
      if (!opts.bar) return;
      const d = engine.diagnostics();
      if (!d) return;
      if (d.uploads !== lastUploads) { lastUploads = d.uploads; staged.push({ t: d.lastStagedMs, vt: d.lastStagedVideoTime, n: readBar(video) }); }
      if (d.emittedMs !== lastEmitted && Number.isFinite(d.emittedMs)) { lastEmitted = d.emittedMs; pendingEmit = { t: d.emittedMs, vt: d.analysedVideoTime, stagedMs: d.stagedMs }; }
    });
    timed('runRender', (ms) => {
      renderMs.push(ms);
      if (pendingEmit) { pendingEmit.canvasN = readBar(engine.getAnalysedFrame()); emits.push(pendingEmit); pendingEmit = null; }
    });
    timed('runPostRender');
    const orig = X.runPostRender;
    X.runPostRender = (...a: any[]) => { const r = orig(...a); const li = engine.lastInferenceMs(); if (li !== lastInf) { block.push(tick); lastInf = li; } tick = 0; return r; };
  }
  const W = video.videoWidth, H = video.videoHeight;
  const raw: any[] = [], filt: any[] = [], reg: any[] = [], mpInfer: any[] = [], pollLat: number[] = [];
  const pos = new OneEuroVec3(posCfg), rot = new OneEuroQuat(rotCfg);
  let target: any = null, lastMs = 0, firstPoseMs = -1, extra: any = null, lastBs: any = null, orient: any = null;
  let held: number[] | null = null, heldN = -1, heldScale = [1, 1, 1];
  const emitN = (t: number) => { for (let i = emits.length - 1; i >= 0 && i >= emits.length - 8; i--) if (emits[i].t === t) return emits[i].canvasN; return -1; };
  await new Promise<void>((done) => {
    const step = () => {
      const now = performance.now();
      const preN = opts.bar && id === 'mediapipe' ? readBar(video) : -1;
      const ps = performance.now();
      const s = engine.poll(video, now);
      const pd = performance.now() - ps;
      if (s && s.matrix) {
        if (id === 'mediapipe') { block.push(pd); if (opts.bar) mpInfer.push({ t: ps, n: preN, ms: pd }); }
        else pollLat.push(performance.now() - s.t);
        if (s.blendshapes) lastBs = s.blendshapes;
        if (firstPoseMs < 0) firstPoseMs = now - t0;
        target = { p: [s.matrix[12], s.matrix[13], s.matrix[14]], q: quatOf(s.matrix) };
        raw.push({ t: now, vt: video.currentTime, ...target });
        const m: number[] = Array.from(s.matrix as ArrayLike<number>);
        held = m;
        heldScale = [0, 1, 2].map((c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]));
        heldN = id === 'mediapipe' ? preN : emitN(s.t);
      }
      if (target) {
        const dt = Math.min(Math.max(now - lastMs, 1), 100) / 1000;
        lastMs = now;
        const fp = pos.filter(target.p, dt, [0, 0, 0]), fq = rot.filter(target.q, dt, [0, 0, 0, 1]);
        filt.push({ t: now, vt: video.currentTime, p: fp, q: fq });
        if (opts.bar && held) {
          const nNew = readBar(video);
          reg.push({ t: now, nNew, nAn: heldN, raw: projAll(held, W, H), filt: projAll(compose(Array.from(fp), Array.from(fq), heldScale), W, H) });
        }
      }
      if (now - t0 > secs * 1000) {
        if (id === 'xr8') {
          const m = engine.getLatestFaceMesh(), topo = engine.getFaceMeshTopology();
          extra = { meshFloats: m ? m.vertices.length : 0, topoPoints: topo ? topo.pointsPerDetection : 0, topoTris: topo ? topo.indices.length / 3 : 0, topoUvs: topo ? topo.uvs.length / 2 : 0, blendKeys: lastBs ? Object.keys(lastBs).sort().join(',') : '' };
          const d = engine.diagnostics();
          if (d) extra.cost = { uploads: d.uploads, uploadMs: d.uploadMs, drawUploadMs: d.drawUploadMs };
          const fr = engine.getAnalysedFrame();
          if (opts.orient && fr) orient = { size: [fr.width, fr.height], video: [W, H], ...compareFrames(video, fr, W, H) };
        }
        engine.dispose();
        done();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return { initMs, firstPoseMs, raw, filt, block, extra, orient, reg, staged, emits, renderMs, mpInfer, pollLat, arrivals: arrivals.slice(), videoW: W, videoH: H };
};

// ---- compatibility probe (one emulated device per page) ------------------------
(window as any).__probe = async (opts: { removeGum: boolean; xr8: any }) => {
  const video = await camera();
  const W = video.videoWidth, H = video.videoHeight;
  if (opts.removeGum) {
    // After OUR camera is open, before 8th Wall's compatibility check (computed once, lazily, in XR8.run).
    delete (MediaDevices.prototype as any).getUserMedia;
    delete (navigator.mediaDevices as any).getUserMedia;
  }
  const mean = (a: number[][]) => a.length ? a[0].map((_, k) => a.reduce((s, v) => s + v[k], 0) / a.length) : [];
  const sampleOf = async (engine: any, ms: number) => {
    const pts: number[][] = [];
    let ttfp = -1;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = () => {
        const now = performance.now();
        const s = engine.poll(video, now);
        if (s && s.matrix) { if (ttfp < 0) ttfp = now - t0; pts.push(projAll(s.matrix, W, H).flat()); }
        if (now - t0 > ms) { done(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return { ttfp, n: pts.length, anchorsPx: mean(pts).map((v) => Math.round(v * 10) / 10) };
  };
  const out: any = { ua: navigator.userAgent, orientation: (window as any).orientation ?? null, screenAngle: screen.orientation ? screen.orientation.angle : null };
  const x: any = createXr8Engine(opts.xr8);
  const t0 = performance.now();
  try {
    await x.init();
    out.xr8 = { initMs: performance.now() - t0, ...(await sampleOf(x, 4000)) };
  } catch (e: any) {
    out.xr8 = { initMs: performance.now() - t0, rejected: String(e?.message ?? e).slice(0, 160) };
  }
  x.dispose();
  const XR8 = (window as any).XR8;
  if (XR8?.XrDevice) {
    const cfg = { allowedDevices: XR8.XrConfig.device().ANY };
    out.compatible = { any: XR8.XrDevice.isDeviceBrowserCompatible(cfg), reasons: XR8.XrDevice.incompatibleReasons(cfg) };
  }
  if (!opts.removeGum) {
    const m: any = createMediapipeEngine();
    await m.init();
    out.mediapipe = await sampleOf(m, 3000);
    m.dispose();
  }
  return out;
};

// ---- lifecycle -----------------------------------------------------------------
(window as any).__lifecycle = async (opts: any) => {
  // Instrument BEFORE the first engine exists (xr.js is injected by init).
  const ctxs = new Set<unknown>();
  let ctxCreated = 0;
  for (const C of [HTMLCanvasElement, (window as any).OffscreenCanvas].filter(Boolean)) {
    const gc = C.prototype.getContext;
    C.prototype.getContext = function (this: any, type: string, ...rest: any[]) {
      const c = gc.call(this, type, ...rest);
      if (c && /webgl/.test(type) && !ctxs.has(c)) { ctxs.add(c); ctxCreated++; }
      return c;
    };
  }
  const pendingRaf = new Set<number>();
  const rAF = window.requestAnimationFrame.bind(window), cAF = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => { const id = rAF((t) => { pendingRaf.delete(id); cb(t); }); pendingRaf.add(id); return id; };
  window.cancelAnimationFrame = (id: number) => { pendingRaf.delete(id); cAF(id); };
  const listeners = new Map<string, number>();
  const desc = (t: any) => (t === window ? 'window' : t === document ? 'document' : t instanceof HTMLCanvasElement ? 'canvas' : t instanceof HTMLVideoElement ? 'video' : t?.constructor?.name ?? '?');
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const seen = new WeakMap<object, Set<string>>();
  const bump = (k: string, d: number) => listeners.set(k, (listeners.get(k) ?? 0) + d);
  EventTarget.prototype.addEventListener = function (this: any, type: string, l: any, o?: any) {
    if (l) {
      const k2 = desc(this) + ':' + type + '|' + (typeof o === 'boolean' ? o : !!o?.capture);
      let s = seen.get(l); if (!s) { s = new Set(); seen.set(l, s); }
      if (!s.has(k2)) { s.add(k2); bump(desc(this) + ':' + type, 1); }
    }
    return add.call(this, type, l, o);
  };
  EventTarget.prototype.removeEventListener = function (this: any, type: string, l: any, o?: any) {
    if (l) {
      const k2 = desc(this) + ':' + type + '|' + (typeof o === 'boolean' ? o : !!o?.capture);
      const s = seen.get(l);
      if (s && s.has(k2)) { s.delete(k2); bump(desc(this) + ':' + type, -1); }
    }
    return rem.call(this, type, l, o);
  };
  const netListeners = () => Array.from(listeners.values()).reduce((a, v) => a + v, 0);
  const byTarget = () => Object.fromEntries(Array.from(listeners.entries()).filter(([, v]) => v !== 0));
  const snap = () => ({ ctxCreated, rafPending: pendingRaf.size, listeners: netListeners() });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const video = await camera();
  /** Poll every frame until the first pose (or maxMs), then for extraMs more. */
  const run = (engine: any, v: HTMLVideoElement, maxMs: number, extraMs: number, onSample?: (s: any) => void) => new Promise<{ ttfp: number; poses: number; lost: number }>((done) => {
    const t0 = performance.now();
    let ttfp = -1, poses = 0, lost = 0;
    const step = () => {
      const now = performance.now();
      const s = engine.poll(v, now);
      if (s) { if (s.matrix) { poses++; if (ttfp < 0) ttfp = now - t0; onSample?.(s); } else lost++; }
      if ((ttfp < 0 && now - t0 > maxMs) || (ttfp >= 0 && now - t0 > ttfp + extraMs)) { done({ ttfp, poses, lost }); return; }
      rAF(step);
    };
    rAF(step);
  });
  const out: any = { cycles: [], baseline: snap() };
  for (let i = 0; i < 6; i++) {
    const e: any = createXr8Engine(opts.xr8);
    const t0 = performance.now();
    let initErr = '';
    try { await e.init(); } catch (err: any) { initErr = String(err?.message ?? err); }
    const initMs = performance.now() - t0;
    const r = initErr ? { ttfp: -1, poses: 0, lost: 0 } : await run(e, video, 6000, 1000);
    const running = snap();
    e.dispose();
    await sleep(300);
    out.cycles.push({ initMs, initErr, ...r, running, afterDispose: snap() });
  }
  out.listenersAfterCycles = byTarget();

  // WEBGL_lose_context on the engine canvas.
  {
    const e: any = createXr8Engine(opts.xr8);
    await e.init();
    const a = await run(e, video, 6000, 500);
    const canvas = e.getAnalysedFrame();
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_lose_context');
    const res: any = { before: a, hasExt: !!ext };
    if (ext) {
      ext.loseContext();
      await sleep(50);
      res.lostReported = gl.isContextLost();
      res.frameWhileLost = e.getAnalysedFrame() === null ? 'null' : 'canvas';
      res.whileLost = await run(e, video, 1000, 0);
      ext.restoreContext();
      res.afterRestore = await run(e, video, 8000, 1000);
      const fr = e.getAnalysedFrame();
      res.frameAfter = fr ? compareFrames(video, fr, video.videoWidth, video.videoHeight).asIs : null;
    }
    e.dispose();
    await sleep(300);
    res.afterDispose = snap();
    out.contextLoss = res;
  }

  // Mid-run <video> swap to a different resolution (front <-> back camera flip), and back.
  {
    const e: any = createXr8Engine(opts.xr8);
    await e.init();
    const centre = (s: any, v: HTMLVideoElement) => { const p = project(s.matrix, [0, 0, 0], v.videoWidth, v.videoHeight); return [p[0] / v.videoWidth, p[1] / v.videoHeight]; };
    let c1: number[] = [], c2: number[] = [], c3: number[] = [];
    const a = await run(e, video, 6000, 1000, (s) => { c1 = centre(s, video); });
    const v2 = await openVideo({ width: { exact: 270 }, height: { exact: 480 } }).catch(() => openVideo({ width: 360, height: 640 }));
    const b = await run(e, v2, 6000, 1000, (s) => { c2 = centre(s, v2); });
    const fr2 = e.getAnalysedFrame();
    const sizeB = fr2 ? [fr2.width, fr2.height] : null;
    const cmpB = fr2 ? compareFrames(v2, fr2, v2.videoWidth, v2.videoHeight).asIs : null;
    const c = await run(e, video, 6000, 1000, (s) => { c3 = centre(s, video); });
    const fr3 = e.getAnalysedFrame();
    out.swap = {
      first: { video: [video.videoWidth, video.videoHeight], ...a, centre: c1 },
      swapped: { video: [v2.videoWidth, v2.videoHeight], canvas: sizeB, frameDiff: cmpB, ...b, centre: c2 },
      back: { canvas: fr3 ? [fr3.width, fr3.height] : null, ...c, centre: c3 },
    };
    e.dispose();
    (v2.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    await sleep(300);
    out.swap.afterDispose = snap();
  }
  out.listenersAtEnd = byTarget();
  return out;
};
`);
// Vite replaces import.meta.env at build time; esbuild leaves it undefined (faceTracking.ts reads
// VITE_EVENT at module scope). A production platform build: no VITE_* overrides.
const VITE_ENV = { MODE: 'production', DEV: false, PROD: true, SSR: false, BASE_URL: '/' };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', outfile: join(work, 'bundle.js'), logLevel: 'error', define: { 'import.meta.env': JSON.stringify(VITE_ENV) } });
writeFileSync(join(work, 'index.html'), '<!doctype html><meta charset="utf-8"><body></body><script type="module" src="/__check/bundle.js"></script>');

// ---- strict static server (a missing file is a 404, never index.html) ---------
const TYPES = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.task': 'application/octet-stream' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const base = url.startsWith('/__check/') ? work : join(root, 'public');
  const rel = url.startsWith('/__check/') ? url.slice('/__check/'.length) : url;
  const file = normalize(join(base, rel === '/' || rel === '' ? 'index.html' : rel));
  if (!file.startsWith(resolve(base)) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size });
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

async function withPage(clip, fn, context = {}) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${resolve(clip)}`,
      '--no-sandbox', '--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await (await browser.newContext({ permissions: ['camera'], ...context })).newPage();
    const errors = [], failed = [], warnings = [];
    page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
    page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text().slice(0, 160)); });
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await page.goto(`http://127.0.0.1:${PORT}/__check/index.html`);
    await page.waitForFunction(() => typeof window.__check === 'function', null, { timeout: 15000 }).catch((e) => {
      throw new Error(`harness did not load: ${e.message.split('\n')[0]}; page errors: ${errors.join(' | ') || 'none'}; console: ${warnings.join(' | ') || 'none'}; failed: ${failed.join(', ') || 'none'}`);
    });
    return await fn(page, { errors, failed, warnings });
  } finally {
    await browser.close();
  }
}

async function runClip(clip, secs, opts) {
  return withPage(clip, async (page, logs) => {
    const out = {};
    for (const id of ['mediapipe', 'xr8']) {
      out[id] = await page.evaluate(([i, s, p, r, o]) => window.__check(i, s, p, r, o), [id, secs, POS_FILTER, ROT_FILTER, { ...opts, xr8: XR8_OPTS }]);
      out[id].errors = logs.errors.splice(0);
      out[id].failed = logs.failed.splice(0);
      logs.warnings.splice(0);
    }
    return out;
  });
}

// ---- metrics ----------------------------------------------------------------
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const pct = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
function jitter(samples, fromMs) {
  const s = samples.filter((x) => x.t >= fromMs);
  if (s.length < 3) return { posCm: NaN, rotDeg: NaN, n: s.length };
  const mp = [0, 1, 2].map((k) => mean(s.map((x) => x.p[k])));
  const posCm = Math.sqrt(mean(s.map((x) => (x.p[0] - mp[0]) ** 2 + (x.p[1] - mp[1]) ** 2 + (x.p[2] - mp[2]) ** 2)));
  const q0 = s[0].q;
  const mq = [0, 1, 2, 3].map((k) => mean(s.map((x) => (x.q[0] * q0[0] + x.q[1] * q0[1] + x.q[2] * q0[2] + x.q[3] * q0[3] < 0 ? -x.q[k] : x.q[k]))));
  const nq = Math.hypot(...mq);
  const ang = (q) => 2 * Math.acos(Math.min(1, Math.abs((q[0] * mq[0] + q[1] * mq[1] + q[2] * mq[2] + q[3] * mq[3]) / nq))) * 180 / Math.PI;
  const zCm = Math.sqrt(mean(s.map((x) => (x.p[2] - mp[2]) ** 2)));
  return { posCm, zCm, rotDeg: Math.sqrt(mean(s.map((x) => ang(x.q) ** 2))), n: s.length };
}
/** Roll (deg) of the head's +X axis in the image plane. */
const roll = (q) => {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (x * y + z * w), 1 - 2 * (y * y + z * z)) * 180 / Math.PI;
};
/** Phase (s, mod 3) of the best-fit 3 s-period sine to roll(videoTime); only differences between engines mean anything. */
function lag(samples, fromMs) {
  const s = samples.filter((x) => x.t >= fromMs);
  if (s.length < 20) return NaN;
  const w = (2 * Math.PI) / 3;
  let best = { e: Infinity, l: NaN };
  for (let l = 0; l < 3; l += 0.001) {
    const xs = s.map((p) => Math.sin(w * (p.vt - l))), ys = s.map((p) => roll(p.q));
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const a = sxy / sxx;
    if (!(a > 0)) continue;
    let e = 0;
    for (let i = 0; i < xs.length; i++) e += (ys[i] - my - a * (xs[i] - mx)) ** 2;
    if (e < best.e) best = { e, l };
  }
  return best.l;
}

// Ground truth of the rollbar clip: frame N is the still rotated by θ(N) about the frame centre.
const CLIP_FRAMES = 180, ROLL_PERIOD_FRAMES = 90, ROLL_AMP_RAD = 0.3491;
const theta = (n) => ROLL_AMP_RAD * Math.sin((2 * Math.PI * n) / ROLL_PERIOD_FRAMES);
const wrapFrames = (d) => ((((d + CLIP_FRAMES / 2) % CLIP_FRAMES) + CLIP_FRAMES) % CLIP_FRAMES) - CLIP_FRAMES / 2;
const rotAbout = (p, c, th) => { const dx = p[0] - c[0], dy = p[1] - c[1], co = Math.cos(th), si = Math.sin(th); return [c[0] + co * dx - si * dy, c[1] + si * dx + co * dy]; };
/**
 * Registration error (px) of the `which` projections against the true positions in frame
 * `nKey` shifted by `lagFrames`; each anchor's unrotated position is fitted by least squares
 * (so a constant offset between the engines' face models does not count — only misregistration
 * over time does). Returns RMS and p95 over all anchors and render frames.
 */
function registration(recs, which, nKey, lagFrames, sign, W, H) {
  const c = [W / 2, H / 2];
  const use = recs.filter((r) => r[nKey] >= 0);
  if (use.length < 20) return { rms: NaN, p95: NaN, n: use.length };
  const errs = [];
  for (let k = 0; k < use[0][which].length; k++) {
    let sx = 0, sy = 0;
    for (const r of use) { const u = rotAbout(r[which][k], c, -sign * theta(r[nKey] - lagFrames)); sx += u[0]; sy += u[1]; }
    const p0 = [sx / use.length, sy / use.length];
    for (const r of use) { const t = rotAbout(p0, c, sign * theta(r[nKey] - lagFrames)); errs.push(Math.hypot(r[which][k][0] - t[0], r[which][k][1] - t[1])); }
  }
  return { rms: Math.sqrt(mean(errs.map((e) => e * e))), p95: pct(errs, 0.95), n: use.length };
}
function fitLag(recs, which, nKey, sign, W, H) {
  let best = { l: NaN, rms: Infinity };
  for (let l = -3; l <= 12; l += 0.1) { const r = registration(recs, which, nKey, l, sign, W, H).rms; if (r < best.rms) best = { l, rms: r }; }
  return best;
}

const gz = (files) => files.reduce((a, f) => a + gzipSync(readFileSync(join(root, f)), { level: 9 }).length, 0);
const rawSize = (files) => files.reduce((a, f) => a + statSync(join(root, f)).size, 0);
const PAYLOAD = {
  mediapipe: ['node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', 'public/mediapipe/wasm/vision_wasm_internal.js', 'public/mediapipe/wasm/vision_wasm_internal.wasm', 'public/models/face_landmarker.task'],
  xr8: ['public/xr8/xr.js', 'public/xr8/xr-face.js', 'public/xr8/resources/face-model.tflite', 'public/xr8/resources/face-mesh-model.tflite'],
};
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

// Emulated devices for --compat (8th Wall's own UA rules: js-device.ts:146-191, compatibility.ts:11-75).
const MOBILE = { isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const DEVICES = [
  { name: 'desktop chromium', context: {} },
  { name: 'android chrome', context: { ...MOBILE, userAgent: ANDROID } },
  { name: 'ios safari', context: { ...MOBILE, userAgent: IPHONE } },
  { name: 'ios instagram', context: { ...MOBILE, userAgent: IPHONE.replace(' Safari/604.1', ' Instagram 340.0.0.0 (iPhone15,2; iOS 17_5; en_US; en)') } },
  { name: 'ios tiktok', context: { ...MOBILE, userAgent: IPHONE + ' musical_ly_34.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US' } },
  { name: 'android tiktok', context: { ...MOBILE, userAgent: ANDROID + ' musical_ly_2023401030 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly' } },
  { name: 'huawei browser', context: { ...MOBILE, userAgent: 'Mozilla/5.0 (Linux; Android 12; NOH-NX9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/14.0.0.322 Mobile Safari/537.36' } },
  { name: 'android, no getUserMedia', context: { ...MOBILE, userAgent: ANDROID }, removeGum: true },
];
if (COMPAT) {
  try {
    console.log(`\nXR8 COMPATIBILITY — emulated devices, ${STATIC}, options ${JSON.stringify(XR8_OPTS)}. anchorsPx = mean image px of the four anchors (x,y each); MediaPipe is the UA-independent reference.`);
    for (const d of DEVICES) {
      const r = await withPage(STATIC, async (page, logs) => {
        const o = await page.evaluate((x) => window.__probe(x), { removeGum: !!d.removeGum, xr8: XR8_OPTS });
        o.errors = logs.errors;
        return o;
      }, d.context);
      const dx = r.xr8?.anchorsPx?.length && r.mediapipe?.anchorsPx?.length ? Math.max(...r.xr8.anchorsPx.map((v, i) => Math.abs(v - r.mediapipe.anchorsPx[i]))) : NaN;
      console.log(`${d.name.padEnd(26)} orientation ${r.orientation}/${r.screenAngle}  xr8 ${JSON.stringify(r.xr8)}  compatible ${JSON.stringify(r.compatible)}  max |xr8-mp| anchor px ${f(dx, 1)}${r.errors.length ? `  page errors: ${r.errors.join(' | ')}` : ''}`);
      if (r.mediapipe) console.log(`${''.padEnd(26)} mediapipe ${JSON.stringify(r.mediapipe)}`);
    }
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(0);
}

if (LIFECYCLE) {
  try {
    const out = await withPage(STATIC, async (page, logs) => {
      const r = await page.evaluate((o) => window.__lifecycle(o), { xr8: XR8_OPTS });
      r.errors = logs.errors; r.failed = [...new Set(logs.failed)];
      r.warnings = [...new Set(logs.warnings.filter((w) => /context|WebGL|8th Wall|xr8/i.test(w)))].slice(0, 12);
      return r;
    });
    console.log(`\nXR8 LIFECYCLE — ${STATIC}   options ${JSON.stringify(XR8_OPTS)}   baseline ${JSON.stringify(out.baseline)}`);
    console.log('cycle  init(ms)  ttfp(ms)  poses  running{ctxCreated,rafPending,listeners}       afterDispose{...}                            error');
    out.cycles.forEach((c, i) => console.log(`${String(i).padEnd(7)}${f(c.initMs, 0).padEnd(10)}${f(c.ttfp, 0).padEnd(10)}${String(c.poses).padEnd(7)}${JSON.stringify(c.running).padEnd(47)}${JSON.stringify(c.afterDispose).padEnd(45)}${c.initErr}`));
    console.log(`net listeners after the cycles: ${JSON.stringify(out.listenersAfterCycles)}`);
    console.log(`context loss: ${JSON.stringify(out.contextLoss)}`);
    console.log(`video swap:   ${JSON.stringify(out.swap)}`);
    console.log(`net listeners at end: ${JSON.stringify(out.listenersAtEnd)}`);
    if (out.errors.length) console.log(`page errors: ${out.errors.join(' | ')}`);
    if (out.failed.length) console.log(`failed requests: ${out.failed.join(', ')}`);
    if (out.warnings.length) console.log(`GL/engine console warnings: ${out.warnings.join(' | ')}`);
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(0);
}

const results = {};
try {
  const stAll = await runClip(STATIC, SECS, { bar: false, orient: true });
  const moAll = MOTION ? await runClip(MOTION, SECS, { bar: true, orient: false }) : null;
  for (const id of ['mediapipe', 'xr8']) {
    const st = stAll[id];
    const settle = st.firstPoseMs + 1000; // skip the acquisition transient
    const t0 = st.raw.length ? st.raw[0].t - st.firstPoseMs : 0;
    const winS = st.raw.length ? (st.raw[st.raw.length - 1].t - (t0 + settle)) / 1000 : NaN;
    const r = {
      initMs: st.initMs, firstPoseMs: st.firstPoseMs,
      rate: st.raw.filter((x) => x.t >= t0 + settle).length / winS,
      // Total main-thread time spent in inference/staging, per pose delivered; and the worst single block.
      blockPerPose: st.block.reduce((a, v) => a + v, 0) / Math.max(1, st.raw.length),
      blockMax: st.block.length ? Math.max(...st.block) : NaN,
      jitRaw: jitter(st.raw, t0 + settle), jitFilt: jitter(st.filt, t0 + settle),
      errors: st.errors, failed: st.failed, extra: st.extra, orient: st.orient,
      renderMs: mean(st.renderMs),
      gzMB: gz(PAYLOAD[id]) / 1e6, rawMB: rawSize(PAYLOAD[id]) / 1e6,
    };
    if (moAll) {
      const mo = moAll[id];
      const m0 = mo.raw.length ? mo.raw[0].t - mo.firstPoseMs : 0;
      const from = m0 + mo.firstPoseMs + 1000;
      r.lagRaw = lag(mo.raw, from);
      r.lagFilt = lag(mo.filt, from);
      const recs = mo.reg.filter((x) => x.t >= from);
      const W = mo.videoW, H = mo.videoH;
      const sgn = [1, -1].map((s) => ({ s, e: registration(recs, 'raw', 'nAn', 0, s, W, H).rms })).sort((a, b) => a.e - b.e)[0].s;
      r.reg = { sign: sgn, n: recs.length };
      for (const which of ['raw', 'filt']) for (const nKey of ['nNew', 'nAn']) r.reg[`${which}_${nKey}`] = registration(recs, which, nKey, 0, sgn, W, H);
      r.reg.lagAnRaw = fitLag(recs, 'raw', 'nAn', sgn, W, H);
      r.reg.lagNewRaw = fitLag(recs, 'raw', 'nNew', sgn, W, H);
      r.reg.lagNewFilt = fitLag(recs, 'filt', 'nNew', sgn, W, H);
      r.reg.lagAnFilt = fitLag(recs, 'filt', 'nAn', sgn, W, H);
      const behind = recs.filter((x) => x.nNew >= 0 && x.nAn >= 0).map((x) => wrapFrames(x.nNew - x.nAn));
      r.reg.framesBehind = mean(behind);
      r.reg.unreadNew = mo.reg.filter((x) => x.nNew < 0).length;
      r.reg.unreadAn = mo.reg.filter((x) => x.nAn < 0).length;
      // First presentation of frame n in the loop that ends at or before time t.
      const byN = new Map();
      for (const [n, t] of mo.arrivals) { const a = byN.get(n) ?? []; if (!a.length || t - a[a.length - 1] > 3000) a.push(t); byN.set(n, a); }
      const arrivalOf = (n, t) => { const a = byN.get(n); if (!a) return NaN; let best = NaN; for (const x of a) if (x <= t + 1) best = x; return best; };
      if (id === 'xr8') {
        const stagedByVt = new Map(mo.staged.map((s) => [s.vt, s]));
        const em = mo.emits.filter((e) => e.t >= from);
        const pairs = em.map((e) => ({ e, s: stagedByVt.get(e.vt) })).filter((p) => p.s);
        r.lagBreak = {
          arrivalToStage: mean(mo.staged.filter((s) => s.t >= from && s.n >= 0).map((s) => s.t - arrivalOf(s.n, s.t)).filter(Number.isFinite)),
          stageToEmit: mean(pairs.map((p) => p.e.t - p.s.t)),
          emitToPoll: mean(mo.pollLat),
          pairOk: pairs.filter((p) => p.s.n >= 0 && p.e.canvasN === p.s.n).length,
          pairBad: pairs.filter((p) => p.s.n >= 0 && p.e.canvasN !== p.s.n).length,
          pairs: pairs.length,
          canvasUnread: em.filter((e) => e.canvasN < 0).length,
          // canvas frame index minus the frame index read from the <video> right after its upload
          canvasMinusStaged: Object.entries(pairs.reduce((h, p) => { const d = wrapFrames(p.e.canvasN - p.s.n); h[d] = (h[d] ?? 0) + 1; return h; }, {})).map(([k, v]) => `${k}:${v}`).join(' '),
          arrivalToEmit: mean(pairs.filter((p) => p.s.n >= 0).map((p) => p.e.t - arrivalOf(p.s.n, p.s.t)).filter(Number.isFinite)),
        };
      } else {
        const inf = mo.mpInfer.filter((x) => x.t >= from && x.n >= 0);
        r.lagBreak = { arrivalToInfer: mean(inf.map((x) => x.t - arrivalOf(x.n, x.t)).filter(Number.isFinite)), inferMs: mean(inf.map((x) => x.ms)) };
      }
    }
    results[id] = r;
  }
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log('\nFACE ENGINES — headless Chromium + SwiftShader. SOFTWARE-GL NUMBERS ARE NOT PHONE NUMBERS: compare the columns, not the absolutes.');
console.log(`static clip: ${STATIC}${MOTION ? `   motion clip: ${MOTION}` : ''}   ${SECS}s per run   xr8 options ${JSON.stringify(XR8_OPTS)}   One-Euro POS ${JSON.stringify(POS_FILTER)} ROT ${JSON.stringify(ROT_FILTER)}\n`);
const regCell = (k) => (r) => (r.reg ? `${f(r.reg[k].rms, 1)} [p95 ${f(r.reg[k].p95, 1)}]` : 'n/a');
const lagCell = (k) => (r) => (r.reg ? `${f(r.reg[k].l, 1)} (rms ${f(r.reg[k].rms, 1)})` : 'n/a');
const rows = [
  ['init (ms)', (r) => f(r.initMs, 0)],
  ['time to first pose (ms, from init())', (r) => f(r.firstPoseMs, 0)],
  ['pose rate (/s)', (r) => f(r.rate, 1)],
  ['main-thread blocking per pose (ms)', (r) => f(r.blockPerPose, 1)],
  ['worst single main-thread block (ms)', (r) => f(r.blockMax, 1)],
  ['static jitter RAW — position RMS (cm)', (r) => f(r.jitRaw.posCm, 3)],
  ['static jitter RAW — of which depth z (cm)', (r) => f(r.jitRaw.zCm, 3)],
  ['static jitter RAW — rotation RMS (deg)', (r) => f(r.jitRaw.rotDeg, 3)],
  ['static jitter One-Euro — position RMS (cm)', (r) => f(r.jitFilt.posCm, 3)],
  ['static jitter One-Euro — rotation RMS (deg)', (r) => f(r.jitFilt.rotDeg, 3)],
  ...(MOTION ? [
    ['motion phase RAW (ms; compare columns)', (r) => f(r.lagRaw * 1000, 0)],
    ['motion phase One-Euro (ms; compare columns)', (r) => f(r.lagFilt * 1000, 0)],
    ['registration RAW vs newest frame (px)', regCell('raw_nNew')],
    ['registration RAW vs analysed frame (px)', regCell('raw_nAn')],
    ['registration One-Euro vs newest frame (px)', regCell('filt_nNew')],
    ['registration One-Euro vs analysed frame (px)', regCell('filt_nAn')],
    ['pose frame behind newest frame (frames)', (r) => (r.reg ? f(r.reg.framesBehind, 2) : 'n/a')],
    ['fitted lag RAW vs analysed (frames)', lagCell('lagAnRaw')],
    ['fitted lag RAW vs newest (frames)', lagCell('lagNewRaw')],
    ['fitted lag One-Euro vs analysed (frames)', lagCell('lagAnFilt')],
    ['fitted lag One-Euro vs newest (frames)', lagCell('lagNewFilt')],
  ] : []),
  ['payload gzip -9 (MB)  [raw MB]', (r) => `${f(r.gzMB, 2)} [${f(r.rawMB, 2)}]`],
];
console.log(`${'metric'.padEnd(46)}${'mediapipe'.padEnd(24)}xr8`);
for (const [name, fn] of rows) console.log(`${name.padEnd(46)}${fn(results.mediapipe).padEnd(24)}${fn(results.xr8)}`);
const x = results.xr8;
if (x.extra) console.log(`xr8 mesh: ${JSON.stringify({ ...x.extra, cost: undefined })}`);
if (x.orient) console.log(`xr8 analysed frame vs <video> (static clip; per-pixel max-channel error, 0-255): ${JSON.stringify(x.orient)}`);
if (x.extra?.cost) console.log(`xr8 frame-lock cost: draw-texture upload ${f(x.extra.cost.drawUploadMs / Math.max(1, x.extra.cost.uploads), 2)} ms/frame (of ${f(x.extra.cost.uploadMs / Math.max(1, x.extra.cost.uploads), 2)} ms total upload); runRender (GlTextureRenderer draw) ${f(x.renderMs, 2)} ms/pass`);
if (MOTION) {
  console.log(`xr8 lag breakdown (ms): ${JSON.stringify(x.lagBreak)}`);
  console.log(`mediapipe lag breakdown (ms): ${JSON.stringify(results.mediapipe.lagBreak)}`);
  for (const id of ['mediapipe', 'xr8']) console.log(`${id} registration: rotation sign ${results[id].reg.sign}, ${results[id].reg.n} render frames, unread bars newest/analysed ${results[id].reg.unreadNew}/${results[id].reg.unreadAn}`);
}
for (const id of ['mediapipe', 'xr8']) {
  const r = results[id];
  if (r.errors.length) console.log(`${id} page errors: ${r.errors.join(' | ')}`);
  if (r.failed.length) console.log(`${id} failed requests: ${[...new Set(r.failed)].join(', ')}`);
}
