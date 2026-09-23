/**
 * Tracking latency + occlusion harness — drives the DEV studio (/dev/studio)
 * with a REAL face on Chromium's fake camera and reads the tracking
 * diagnostics the harness exposes (src/dev/StudioHarness.tsx
 * `window.__beamwallTracking`).
 *
 * Reports, over a sampling window: detections per second, face-inference
 * duration (mean / p95), sample age at render time (mean / p95), whether a
 * face was held throughout — and saves screenshots of the live 3D view with a
 * crown on the face, once plain and once with `?debug=occluder` (the depth
 * shell drawn as a blue wireframe, proving the occluder MOUNTED).
 *
 * Usage: dev server on :5173 (with placeholder VITE_SUPABASE_* env), then
 *   node scripts/check-tracking-latency.mjs <face.y4m> [outDir]
 * A y4m is made from any frontal portrait with ffmpeg (see docs/STATE.md
 * "tracking harness"). Without a y4m Chromium's synthetic pattern plays and
 * no face will be found — the numbers still show inference cost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const y4m = process.argv[2];
const outDir = process.argv[3] ?? 'scratch-shots';
fs.mkdirSync(outDir, { recursive: true });
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';

const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox', '--no-proxy-server'];
if (y4m) args.push(`--use-file-for-fake-video-capture=${path.resolve(y4m)}`);
let browser = await chromium.launch({ executablePath: CHROME, args });
const errors = [];
// One context per scenario: a fresh localStorage, so the studio's "we recovered
// your scene" dialog from the previous run cannot cover the stage.
let page;
async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  page.on('console', (m) => {
    if (/faceTracking|FaceRig|HandRig|handTracking|Error/i.test(m.text())) console.log('CONSOLE:', m.text().slice(0, 160));
  });
  return ctx;
}

const clickIn = async (scope, text, label) => {
  const els = await page.locator(`${scope} button`, { hasText: text }).all();
  for (const el of els) {
    const box = await el.boundingBox();
    if (box && box.x >= 0 && box.x < 1440 && box.width > 0) {
      try {
        await el.click({ timeout: 8000, force: true });
        console.log(`click ${label}: ok`);
        return true;
      } catch (e) {
        await page.screenshot({ path: path.join(outDir, `fail-${label.replace(/\W+/g, '-')}.png`) });
        console.log(`click ${label}: FAILED (${String(e).split('\n')[0]})`);
        return false;
      }
    }
  }
  console.log(`click ${label}: NO ON-SCREEN MATCH (${els.length} candidates)`);
  return false;
};

async function scenario(query, shotName, { hand = false, both = false, powerfx = false } = {}) {
  const ctx = await freshPage();
  await page.goto(`${BASE}/dev/studio${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await clickIn('[data-panel="assets"]', '3D', '3D kind tab');
  await page.waitForTimeout(600);
  await clickIn('[data-panel="assets"]', 'Royal Crown', 'Royal Crown');
  await page.waitForTimeout(600);
  if (powerfx) {
    // A face piece (the crown, above) + the Power FX gauntlet: a HAND piece
    // plus a palmOpen trigger — which is what starts the stage's trigger loop,
    // the path that asks for face inference first on every frame.
    await clickIn('[data-panel="assets"]', 'Power FX', 'Power FX card');
    await page.waitForTimeout(800);
    await page.locator('[role="dialog"] button', { hasText: process.env.GEAR ?? 'Power Gauntlet' }).first().click({ timeout: 8000, force: true }).catch((e) => console.log('click gear: FAILED', String(e).split('\n')[0]));
    await page.waitForTimeout(400);
    await page.locator('[role="dialog"] button', { hasText: 'Add to scene' }).first().click({ timeout: 30000, force: true }).catch((e) => console.log('click add: FAILED', String(e).split('\n')[0]));
    await page.waitForTimeout(2500);
  }
  if (both) {
    // A HEAD piece (the crown) AND a HAND piece (a tiara re-homed onto the
    // hand) in one scene — the concurrency case: both trackers must run.
    await clickIn('[data-panel="assets"]', "Queen's Tiara", "Queen's Tiara");
    await page.waitForTimeout(600);
  }
  if (hand || both) {
    // "Tracks on: Hand" re-homes the piece onto a HandRig (grip anchor) — the
    // cheapest way to mount the hand pipeline without driving the Power FX modal.
    const btn = page.locator('button', { hasText: /^Hand$/ }).last();
    await btn.click({ timeout: 8000, force: true }).catch((e) => console.log('click Hand: FAILED', String(e).split('\n')[0]));
    await page.waitForTimeout(600);
  }
  // 3D mode (its default sub-view is Live); if the view toggle offers "Live",
  // the studio is on the reference model and one click brings the camera back.
  await page.locator('[data-testid="studio-mode-3d"]').click({ timeout: 8000, force: true }).catch((e) => console.log('click 3D mode: FAILED', String(e).split('\n')[0]));
  await page.waitForTimeout(600);
  const toggle = page.locator('[data-testid="studio-view-toggle"]');
  if ((await toggle.count()) > 0 && /Live/i.test((await toggle.textContent()) ?? '')) {
    await toggle.click({ timeout: 8000, force: true }).catch(() => {});
  }
  // Let the wasm + model load and the tracker acquire.
  await page.waitForFunction(
    (wantHand) => (wantHand ? (window.__beamwallTracking?.hand().hands ?? 0) > 0 : window.__beamwallTracking?.face().hasFace === true),
    hand || both || powerfx,
    { timeout: 40000 },
  ).catch(() => {});
  await page.waitForTimeout(1500);
  const counts0 = await page.evaluate(() => ({ f: window.__beamwallTracking?.face().detections ?? 0, h: window.__beamwallTracking?.hand().detections ?? 0, t: performance.now() }));
  const samples = await page.evaluate(async () => {
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      const f = window.__beamwallTracking?.face();
      const h = window.__beamwallTracking?.hand();
      out.push({ t: performance.now(), inferMs: f?.inferMs ?? NaN, ageMs: f?.ageMs ?? NaN, hasFace: f?.hasFace ?? false, handInferMs: h?.inferMs ?? NaN, hands: h?.hands ?? 0 });
      await new Promise((r) => setTimeout(r, 25));
    }
    return out;
  });
  const counts1 = await page.evaluate(() => ({ f: window.__beamwallTracking?.face().detections ?? 0, h: window.__beamwallTracking?.hand().detections ?? 0, t: performance.now() }));
  const secs = (counts1.t - counts0.t) / 1000;
  samples.rates = { faceInferPerSec: +((counts1.f - counts0.f) / secs).toFixed(1), handInferPerSec: +((counts1.h - counts0.h) / secs).toFixed(1) };
  const shot = path.join(outDir, shotName);
  await page.screenshot({ path: shot });
  const occl = await page.locator('[data-testid="studio-occlusion-toggle"]').getAttribute('aria-pressed').catch(() => null);
  await ctx.close();
  return { samples, shot, occl };
}

function handStats(samples) {
  const infer = samples.map((s) => s.handInferMs).filter((v) => Number.isFinite(v) && v > 0);
  const mean = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : NaN);
  return {
    handInferMeanMs: +mean(infer).toFixed(1),
    handHeldPct: +((samples.filter((s) => s.hands > 0).length / samples.length) * 100).toFixed(0),
    maxHands: Math.max(0, ...samples.map((s) => s.hands)),
  };
}

function stats(samples) {
  const ages = samples.map((s) => s.ageMs).filter(Number.isFinite);
  const infer = samples.map((s) => s.inferMs).filter((v) => Number.isFinite(v) && v > 0);
  const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
  const mean = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : NaN);
  // A detection happened whenever the age went DOWN between samples.
  let detections = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].ageMs < samples[i - 1].ageMs) detections++;
  const span = (samples[samples.length - 1].t - samples[0].t) / 1000;
  return {
    detectionsPerSec: +(detections / span).toFixed(1),
    inferMeanMs: +mean(infer).toFixed(1),
    inferP95Ms: +q(infer, 0.95).toFixed(1),
    ageMeanMs: +mean(ages).toFixed(1),
    ageP95Ms: +q(ages, 0.95).toFixed(1),
    faceHeldPct: +((samples.filter((s) => s.hasFace).length / samples.length) * 100).toFixed(0),
  };
}

if (process.env.MODE === 'powerfx') {
  // Face piece + Power FX gauntlet (hand piece + trigger) on a face+hand video.
  // GEAR picks the shelf item; QS=?debug=occluder draws both depth shells.
  const c = await scenario(process.env.QS ?? '?debug=tracking', 'tl-5-powerfx.png', { powerfx: true });
  console.log('POWERFX:', JSON.stringify({ ...stats(c.samples), ...handStats(c.samples), ...c.samples.rates }), 'shot=', c.shot);
  console.log('PAGEERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
  process.exit(0);
}
if (process.env.MODE === 'concurrent') {
  // One video with a face AND a hand; one scene with a head piece AND a hand
  // piece. Both trackers must keep their cadence — neither may starve.
  const c = await scenario('?debug=tracking', 'tl-4-concurrent.png', { both: true });
  console.log('CONCURRENT:', JSON.stringify({ ...stats(c.samples), ...handStats(c.samples), ...c.samples.rates }), 'shot=', c.shot);
  console.log('PAGEERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
  process.exit(0);
}
const plain = await scenario('', 'tl-1-live-crown.png');
console.log('LIVE:', JSON.stringify(stats(plain.samples)), 'occlusionChip=', plain.occl, 'shot=', plain.shot);
const dbg = await scenario('?debug=occluder', 'tl-2-live-occluder-debug.png');
console.log('DEBUG-OCCLUDER:', JSON.stringify(stats(dbg.samples)), 'shot=', dbg.shot);
if (process.env.HAND_Y4M) {
  // A second video with a bare hand in frame drives the hand pipeline.
  await browser.close();
  const b2 = await chromium.launch({ executablePath: CHROME, args: [...args.filter((a) => !a.startsWith('--use-file-for-fake-video-capture')), `--use-file-for-fake-video-capture=${path.resolve(process.env.HAND_Y4M)}`] });
  browser = b2;
  const h = await scenario('?debug=tracking', 'tl-3-live-hand.png', { hand: true });
  console.log('HAND:', JSON.stringify({ ...stats(h.samples), ...handStats(h.samples) }), 'shot=', h.shot);
}
console.log('PAGEERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
