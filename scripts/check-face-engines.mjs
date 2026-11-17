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
 * Usage:
 *   npm run copy:vendor          # public/xr8, public/mediapipe must exist
 *   node scripts/check-face-engines.mjs --static <still.y4m> [--motion <roll.y4m>] [--secs 12]
 *
 * Clips (ffmpeg; 540x960, a face filling ~1/3 of the frame):
 *   still:  ffmpeg -loop 1 -i face.jpg -t 6 -r 30 -vf scale=540:960 -pix_fmt yuv420p still.y4m
 *   roll:   ffmpeg -loop 1 -i face.jpg -t 6 -r 30 -vf "scale=540:960,rotate=0.3491*sin(2*PI*t/3):fillcolor=black" -pix_fmt yuv420p roll.y4m
 * The motion clip must be a ±20° roll with a 3 s period (as above): lag is the
 * phase of the best-fit sine. Both engines run one after the other in ONE page
 * on the same stream, so the fake camera's start offset shifts both equally:
 * the DIFFERENCE between the two columns is the extra lag; absolutes mean nothing.
 *
 * Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium), PORT (default 5192).
 */
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const STATIC = arg('static');
const MOTION = arg('motion');
const SECS = Number(arg('secs', '12'));
const PORT = Number(process.env.PORT ?? 5192);
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
if (!STATIC || !existsSync(STATIC)) {
  console.error('usage: node scripts/check-face-engines.mjs --static <still.y4m> [--motion <roll.y4m>] [--secs 12]');
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

// ---- bundle the real engines --------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'face-engines-'));
const entry = join(work, 'entry.ts');
const { writeFileSync } = await import('node:fs');
writeFileSync(entry, `
import { createXr8Engine } from ${JSON.stringify(join(root, 'src/lib/faceEngine/xr8Engine.ts'))};
import { createMediapipeEngine } from ${JSON.stringify(join(root, 'src/lib/faceEngine/mediapipeEngine.ts'))};
import { OneEuroVec3, OneEuroQuat } from ${JSON.stringify(join(root, 'src/lib/smoothing.ts'))};

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

let shared: HTMLVideoElement | null = null;
async function camera(): Promise<HTMLVideoElement> {
  if (shared) return shared;
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 540, height: 960 } });
  await video.play();
  while (video.videoWidth === 0) await new Promise((r) => setTimeout(r, 20));
  return (shared = video);
}

// Both engines run one after the other on the SAME stream in one page, so the
// fake camera's phase offset is shared and their lags are comparable.
(window as any).__check = async (id: 'mediapipe' | 'xr8', secs: number, posCfg: any, rotCfg: any) => {
  const video = await camera();
  const engine = id === 'xr8' ? createXr8Engine() : createMediapipeEngine();
  const t0 = performance.now();
  await engine.init();
  const initMs = performance.now() - t0;
  const block: number[] = [];
  // 8th Wall blocks inside its own loop: time its three stages per tick, keep ticks that inferred.
  if (id === 'xr8') {
    const X = (window as any).XR8;
    let tick = 0, lastInf = engine.lastInferenceMs();
    const wrap = (k: string) => { const f = X[k].bind(X); X[k] = (...a: any[]) => { const s = performance.now(); try { return f(...a); } finally { tick += performance.now() - s; } }; };
    wrap('runPreRender'); wrap('runRender'); wrap('runPostRender');
    const orig = X.runPostRender;
    X.runPostRender = (...a: any[]) => { const r = orig(...a); const li = engine.lastInferenceMs(); if (li !== lastInf) { block.push(tick); lastInf = li; } tick = 0; return r; };
  }
  const raw: any[] = [], filt: any[] = [];
  const pos = new OneEuroVec3(posCfg), rot = new OneEuroQuat(rotCfg);
  let target: any = null, lastMs = 0, firstPoseMs = -1, extra: any = null, lastBs: any = null;
  await new Promise<void>((done) => {
    const step = () => {
      const now = performance.now();
      const ps = performance.now();
      const s = engine.poll(video, now);
      const pd = performance.now() - ps;
      if (s && s.matrix) {
        if (id === 'mediapipe') block.push(pd);
        if (s.blendshapes) lastBs = s.blendshapes;
        if (firstPoseMs < 0) firstPoseMs = now - t0;
        target = { p: [s.matrix[12], s.matrix[13], s.matrix[14]], q: quatOf(s.matrix) };
        raw.push({ t: now, vt: video.currentTime, ...target });
      }
      if (target) {
        const dt = Math.min(Math.max(now - lastMs, 1), 100) / 1000;
        lastMs = now;
        filt.push({ t: now, vt: video.currentTime, p: pos.filter(target.p, dt, [0, 0, 0]), q: rot.filter(target.q, dt, [0, 0, 0, 1]) });
      }
      if (now - t0 > secs * 1000) {
        const x = engine as any;
        if (id === 'xr8') {
          const m = x.getLatestFaceMesh(), topo = x.getFaceMeshTopology();
          extra = { meshFloats: m ? m.vertices.length : 0, topoPoints: topo ? topo.pointsPerDetection : 0, topoTris: topo ? topo.indices.length / 3 : 0, topoUvs: topo ? topo.uvs.length / 2 : 0, blendKeys: lastBs ? Object.keys(lastBs).sort().join(',') : '' };
        }
        engine.dispose();
        done();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return { initMs, firstPoseMs, raw, filt, block, extra, videoW: video.videoWidth, videoH: video.videoHeight };
};
`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', outfile: join(work, 'bundle.js'), logLevel: 'error' });
writeFileSync(join(work, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="/__check/bundle.js"></script>');

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

async function runClip(clip, secs) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${resolve(clip)}`,
      '--no-sandbox', '--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
    const failed = [];
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await page.goto(`http://127.0.0.1:${PORT}/__check/index.html`);
    await page.waitForFunction(() => typeof window.__check === 'function');
    const out = {};
    for (const id of ['mediapipe', 'xr8']) {
      out[id] = await page.evaluate(([i, s, p, r]) => window.__check(i, s, p, r), [id, secs, POS_FILTER, ROT_FILTER]);
      out[id].errors = errors.splice(0);
      out[id].failed = failed.splice(0);
    }
    return out;
  } finally {
    await browser.close();
  }
}

// ---- metrics ----------------------------------------------------------------
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
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
const gz = (files) => files.reduce((a, f) => a + gzipSync(readFileSync(join(root, f)), { level: 9 }).length, 0);
const raw = (files) => files.reduce((a, f) => a + statSync(join(root, f)).size, 0);
const PAYLOAD = {
  mediapipe: ['node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', 'public/mediapipe/wasm/vision_wasm_internal.js', 'public/mediapipe/wasm/vision_wasm_internal.wasm', 'public/models/face_landmarker.task'],
  xr8: ['public/xr8/xr.js', 'public/xr8/xr-face.js', 'public/xr8/resources/face-model.tflite', 'public/xr8/resources/face-mesh-model.tflite'],
};

const results = {};
try {
  const stAll = await runClip(STATIC, SECS);
  const moAll = MOTION ? await runClip(MOTION, SECS) : null;
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
      errors: st.errors, failed: st.failed, extra: st.extra,
      gzMB: gz(PAYLOAD[id]) / 1e6, rawMB: raw(PAYLOAD[id]) / 1e6,
    };
    if (moAll) {
      const mo = moAll[id];
      const m0 = mo.raw.length ? mo.raw[0].t - mo.firstPoseMs : 0;
      r.lagRaw = lag(mo.raw, m0 + mo.firstPoseMs + 1000);
      r.lagFilt = lag(mo.filt, m0 + mo.firstPoseMs + 1000);
    }
    results[id] = r;
  }
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
console.log('\nFACE ENGINES — headless Chromium + SwiftShader. SOFTWARE-GL NUMBERS ARE NOT PHONE NUMBERS: compare the columns, not the absolutes.');
console.log(`static clip: ${STATIC}${MOTION ? `   motion clip: ${MOTION}` : ''}   ${SECS}s per run   One-Euro POS ${JSON.stringify(POS_FILTER)} ROT ${JSON.stringify(ROT_FILTER)}\n`);
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
  ...(MOTION ? [['motion phase RAW (ms; compare columns)', (r) => f(r.lagRaw * 1000, 0)], ['motion phase One-Euro (ms; compare columns)', (r) => f(r.lagFilt * 1000, 0)]] : []),
  ['payload gzip -9 (MB)  [raw MB]', (r) => `${f(r.gzMB, 2)} [${f(r.rawMB, 2)}]`],
];
console.log(`${'metric'.padEnd(46)}${'mediapipe'.padEnd(20)}xr8`);
for (const [name, fn] of rows) console.log(`${name.padEnd(46)}${fn(results.mediapipe).padEnd(20)}${fn(results.xr8)}`);
if (results.xr8.extra) console.log(`xr8 mesh: ${JSON.stringify(results.xr8.extra)}`);
for (const id of ['mediapipe', 'xr8']) {
  const r = results[id];
  if (r.errors.length) console.log(`${id} page errors: ${r.errors.join(' | ')}`);
  if (r.failed.length) console.log(`${id} failed requests: ${[...new Set(r.failed)].join(', ')}`);
}
