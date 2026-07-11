/**
 * AR tracking guard — proves the studio's live 3D view actually STARTS the
 * MediaPipe face landmarker (the "silently never tracks" regression class:
 * a FaceRig surface whose host forgot the init call). Drives the DEV harness:
 * 3D kind → head piece → Live sub-view, then asserts the landmarker WASM was
 * requested and the live canvas + loading pill mounted.
 * Usage: dev server on :5173, then `node scripts/check-ar-tracking.mjs`.
 * PASS = "WASM requests: vision_wasm_internal.js,vision_wasm_internal.wasm".
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
const page = await ctx.newPage();
const wasmReqs = [];
page.on('request', r => { if (r.url().includes('/mediapipe/wasm')) wasmReqs.push(r.url().split('/').pop()); });
page.on('pageerror', e => console.log('PAGEERROR:', e.message.split('\n')[0]));
page.on('console', m => { if (/faceTracking|FaceRig|FaceLandmarker/i.test(m.text())) console.log('CONSOLE:', m.text().slice(0,140)); });
await page.goto('http://localhost:5173/dev/studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// Click helper: only inside the on-screen assets column (the drawer twin is off-screen).
const clickIn = async (scope, text, label) => {
  const els = await page.locator(`${scope} button`, { hasText: text }).all();
  for (const el of els) {
    const box = await el.boundingBox();
    if (box && box.x >= 0 && box.x < 1440 && box.width > 0) {
      await el.click({ timeout: 3000 });
      console.log(`click ${label}: ok @${Math.round(box.x)},${Math.round(box.y)}`);
      return true;
    }
  }
  console.log(`click ${label}: NO ON-SCREEN MATCH (${els.length} candidates)`);
  return false;
};

await clickIn('[data-panel="assets"]', '3D', '3D kind tab');
await page.waitForTimeout(800);
await page.screenshot({ path: 'scratch-shots/tc-1-after3d.png' });
await clickIn('[data-panel="assets"]', 'Royal Crown', 'Royal Crown');
await page.waitForTimeout(800);
await page.screenshot({ path: 'scratch-shots/tc-2-crown.png' });
await clickIn('main', /^Live$/, 'Live subview');
await page.waitForTimeout(6000);
const b = (await page.textContent('body'))?.replace(/\s+/g,' ') ?? '';
console.log(`liveCanvas=${await page.locator('#studio-3d-live').count()} loadingPill=${b.includes('Loading face tracker')}`);
console.log('WASM requests:', wasmReqs.length ? wasmReqs.join(',') : 'NONE');
await page.screenshot({ path: 'scratch-shots/tc-3-live.png' });
await browser.close();
