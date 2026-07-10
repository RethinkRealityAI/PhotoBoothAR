/**
 * W8 UI spot-check — /dev/studio harness. Verifies, at 390px & 1440px:
 *   1. NO procedural head in 3D orbit (GLB absent here → nothing renders where
 *      the head was, only anchor dots). Shots immediately + after 3s.
 *   2. Studio triggers UI — add a head piece + a Smile→Confetti Magic Trigger,
 *      then the "Testing triggers" indicator in 3D-Live & 2D, and Preview
 *      must not error.
 *   3. Auto head-size calibration copy renders; the tracker-estimate chip and
 *      the "Auto-fit each guest" toggle are ABSENT (no tracked face / baseline).
 *   4. Regression — stage width with panels open (1440), no horizontal overflow
 *      at 390, zero uncaught pageerrors through the flow.
 * Usage: node scripts/w8-spot-check.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = 'scratch-shots/w8';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
});

// First on-screen match of a locator (filters off-canvas drawer twins by box).
async function firstVisible(locator) {
  const n = await locator.count();
  for (let i = 0; i < n; i++) {
    const el = locator.nth(i);
    const box = await el.boundingBox();
    if (!box || box.width <= 1 || box.height <= 1) continue;
    const vw = locator.page().viewportSize()?.width ?? 9999;
    // Reject off-canvas drawer twins (translated left/right out of the viewport).
    if (box.x + box.width < 4 || box.x > vw - 4) continue;
    return el;
  }
  return null;
}
const clickVisible = async (loc, label) => {
  const el = await firstVisible(loc);
  if (!el) { console.log(`      ! could not click (no visible): ${label}`); return false; }
  await el.click();
  return true;
};

for (const width of [390, 1440]) {
  const mobile = width < 1024;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedReq = [];
  let glbReq = null;
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => failedReq.push(`${r.url().slice(0, 70)} ${r.failure()?.errorText || ''}`));
  page.on('response', (r) => { if (r.url().includes('reference-head.glb')) glbReq = r.status(); });
  page.on('requestfailed', (r) => { if (r.url().includes('reference-head.glb')) glbReq = `failed:${r.failure()?.errorText}`; });

  console.log(`\n================ ${width}px (${mobile ? 'mobile' : 'desktop'}) ================`);
  await page.goto(`${BASE}/dev/studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.keyboard.press('Escape'); // dismiss the first-load naming dialog
  await page.waitForTimeout(400);
  const errAtLoad = pageErrors.length;

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));

  // ---- CHECK 1: no procedural head in orbit (fresh empty scene) ----
  await clickVisible(page.locator('main').getByRole('button', { name: '3D', exact: true }), '3D mode tab');
  await page.waitForTimeout(300);
  await clickVisible(page.locator('main').getByRole('button', { name: 'Model', exact: true }), 'Model/orbit');
  await page.waitForTimeout(500); // "immediately after entering orbit"
  await page.screenshot({ path: `${OUT}/c1-${width}-orbit-immediate.png` });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/c1-${width}-orbit-3s.png` });
  console.log(`[1] orbit shots taken. reference-head.glb → ${glbReq === null ? 'NOT requested' : glbReq} (absent asset expected)`);

  // ---- CHECK 2a: add a head piece ----
  if (mobile) { await clickVisible(page.locator('button[aria-label="Toggle assets panel"]'), 'assets toggle'); await page.waitForTimeout(400); }
  const added = await clickVisible(page.locator('aside[data-panel="assets"] button[title^="Royal Crown"]'), 'Royal Crown tile');
  await page.waitForTimeout(600);
  if (mobile) { await clickVisible(page.locator('aside[data-panel="assets"] button[aria-label="Close panel"]'), 'close assets'); await page.waitForTimeout(400); }

  // ---- CHECK 2b: add a Smile → Confetti Magic Trigger (defaults are exactly that) ----
  if (mobile) { await clickVisible(page.locator('button[aria-label="Toggle properties panel"]'), 'props toggle'); await page.waitForTimeout(400); }
  await clickVisible(page.locator('aside[data-panel="props"] button:has-text("Add trigger")'), 'Add trigger');
  await page.waitForTimeout(300);
  await clickVisible(page.locator('aside[data-panel="props"] button:has-text("Add")').last(), 'commit trigger');
  await page.waitForTimeout(400);
  const propsText1 = await page.evaluate(() => {
    const a = [...document.querySelectorAll('aside[data-panel="props"]')].find((x) => x.getBoundingClientRect().width > 1);
    return a ? a.innerText : '';
  });
  const triggerAdded = /smile/i.test(propsText1) && /confetti/i.test(propsText1);
  console.log(`[2] head piece added=${added}  trigger listed (Smile→Confetti)=${triggerAdded}`);
  if (mobile) { await clickVisible(page.locator('aside[data-panel="props"] button[aria-label="Close panel"]'), 'close props'); await page.waitForTimeout(400); }

  // indicator in 3D-Live
  await clickVisible(page.locator('main').getByRole('button', { name: '3D', exact: true }), '3D mode');
  await page.waitForTimeout(300);
  await clickVisible(page.locator('main').getByRole('button', { name: 'Live', exact: true }), 'Live');
  await page.waitForTimeout(1800);
  const ind3d = await firstVisible(page.locator('[data-testid="studio-trigger-indicator"]'));
  const ind3dText = ind3d ? (await ind3d.innerText()).replace(/\s+/g, ' ').trim() : null;
  await page.screenshot({ path: `${OUT}/c2-${width}-3dlive-indicator.png` });

  // indicator in 2D
  await clickVisible(page.locator('main').getByRole('button', { name: '2D', exact: true }), '2D mode');
  await page.waitForTimeout(1200);
  const ind2d = await firstVisible(page.locator('[data-testid="studio-trigger-indicator"]'));
  await page.screenshot({ path: `${OUT}/c2-${width}-2dlive-indicator.png` });

  // Preview must not crash
  const errBeforePreview = pageErrors.length;
  await clickVisible(page.locator('main').getByRole('button', { name: 'Preview', exact: true }), 'Preview mode');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/c2-${width}-preview.png` });
  const previewNewErrs = pageErrors.length - errBeforePreview;
  console.log(`[2] indicator 3D-Live=${!!ind3d} ("${ind3dText}")  2D=${!!ind2d}  preview pageerrors=${previewNewErrs}`);

  // ---- CHECK 3: calibration copy + absent chip/toggle (head piece still selected) ----
  if (mobile) { await clickVisible(page.locator('button[aria-label="Toggle properties panel"]'), 'props toggle'); await page.waitForTimeout(400); }
  const cal = await page.evaluate(() => {
    const a = [...document.querySelectorAll('aside[data-panel="props"]')].find((x) => x.getBoundingClientRect().width > 1);
    if (!a) return null;
    const t = a.innerText;
    return {
      header: /head size calibration/i.test(t),
      newCopy: /tracker estimate, not exact/i.test(t),
      chipPresent: /tracker estimate ×/i.test(t),   // the "Apply" suggestion chip
      togglePresent: /auto-fit each guest/i.test(t),
    };
  });
  // Clip the screenshot to the calibration card.
  const calBox = await page.evaluate(() => {
    const a = [...document.querySelectorAll('aside[data-panel="props"]')].find((x) => x.getBoundingClientRect().width > 1);
    if (!a) return null;
    const el = [...a.querySelectorAll('div')].find((d) => /head size calibration/i.test(d.textContent || '') && d.querySelectorAll('div').length < 12);
    const target = el || a;
    const r = target.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, window.innerWidth - Math.max(0, r.x)), height: Math.min(r.height, 900 - Math.max(0, r.y)) };
  });
  if (calBox && calBox.width > 4 && calBox.height > 4) await page.screenshot({ path: `${OUT}/c3-${width}-calibration.png`, clip: calBox });
  else await page.screenshot({ path: `${OUT}/c3-${width}-calibration.png` });
  console.log(`[3] calibration: header=${cal?.header} newCopy=${cal?.newCopy}  chipABSENT=${!cal?.chipPresent}  toggleABSENT=${!cal?.togglePresent}`);

  // ---- CHECK 4: stage width + overflow + errors ----
  const stageW = await page.evaluate(() => {
    const s = document.querySelector('main [style*="9/16"], main [style*="aspect-ratio"]');
    return s ? Math.round(s.getBoundingClientRect().width) : null;
  });
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const glbFails = failedReq.filter((r) => /reference-head\.glb/.test(r)).length;
  const tunnelFails = failedReq.filter((r) => /ERR_TUNNEL|supabase|zrtftliozslrjomxbfrr/i.test(r)).length;
  const otherFails = failedReq.length - tunnelFails;
  console.log(`[4] stageWidth=${stageW}px  overflow(load doc/body)=${overflow.doc}/${overflow.body}  overflow(end)=${overflow2}`);
  console.log(`    pageErrors total=${pageErrors.length} (atLoad=${errAtLoad})  consoleErrors=${consoleErrors.length}  netFails: tunnel/supabase=${tunnelFails} other=${otherFails}`);
  if (pageErrors.length) console.log('    PAGEERRORS:', pageErrors.slice(0, 4).join(' || '));
  if (otherFails > 0) console.log('    NON-TUNNEL NET FAILS:', failedReq.filter((r) => !/ERR_TUNNEL|supabase|zrtftliozslrjomxbfrr/i.test(r)).slice(0, 5).join(' | '));
  if (consoleErrors.length) console.log('    CONSOLE ERR SAMPLE:', consoleErrors.slice(0, 4).map((e) => e.slice(0, 90)).join(' || '));

  await ctx.close();
}
await browser.close();
console.log('\nDONE');
