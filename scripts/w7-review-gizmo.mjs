/**
 * W7 review — transform gizmo in 3D orbit ("Model") view. Confirms it renders
 * at a constant screen size (~90px, `fixed`) across wheel-zoom levels, and that
 * the anchor dots/labels are not swallowed by it.
 * Usage: node scripts/w7-review-gizmo.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = 'scratch-shots/w7';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'],
});

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE}/dev/studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Add a head piece (selected on add).
await page.locator('[data-panel="assets"] button:has-text("3D")').first().click();
await page.waitForTimeout(400);
await page.locator('[data-panel="assets"] button[class*="aspect-square"]').first().click();
await page.waitForTimeout(600);

// Switch to 3D mode, then the "Model" (orbit) sub-pill.
await page.locator('main button:has-text("3D")').first().click();
await page.waitForTimeout(600);
const modelPill = page.locator('main button:has-text("Model")').first();
if (await modelPill.count()) { await modelPill.click(); await page.waitForTimeout(1200); }
else console.log('  (no Model/orbit sub-pill found — capturing default 3D view)');

// Stage clip.
const stageBox = await page.evaluate(() => {
  const el = document.querySelector('main');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
});
const clip = { x: stageBox.x, y: stageBox.y, width: stageBox.w, height: Math.min(stageBox.h, 900 - stageBox.y) };
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/gizmo-zoom-default.png`, clip });
console.log('== Gizmo ==');
console.log(`  stage: ${JSON.stringify(stageBox)}`);

// Wheel-zoom IN on the canvas center, screenshot.
await page.mouse.move(stageBox.cx, stageBox.cy);
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(80); }
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/gizmo-zoom-in.png`, clip });

// Wheel-zoom OUT well past default, screenshot.
for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(80); }
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/gizmo-zoom-out.png`, clip });

// Measure the gizmo's colored-axis footprint in each screenshot by sampling the
// canvas pixels for the gizmo axis colors (red ~E25563, green ~7CC36B, blue ~5B8BE0).
// Bounding box of those pixels ~ gizmo screen size; constant `fixed` size => stable.
const measure = await page.evaluate(async (stage) => {
  const canvas = document.querySelector('main canvas');
  if (!canvas) return null;
  // Render already on screen; read via a 2D copy.
  const w = canvas.width, h = canvas.height;
  const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
  const g = tmp.getContext('2d');
  try { g.drawImage(canvas, 0, 0); } catch (e) { return { error: String(e) }; }
  let data;
  try { data = g.getImageData(0, 0, w, h).data; } catch (e) { return { error: 'readback blocked: ' + String(e) }; }
  const isAxis = (r, gr, b) => (
    (r > 150 && gr < 120 && b < 130) ||        // red arm
    (gr > 140 && r < 150 && b < 140) ||        // green arm
    (b > 150 && r < 140 && gr < 160) ||        // blue arm
    (r > 200 && gr > 160 && b < 120)           // gold hover
  );
  let minX = w, minY = h, maxX = 0, maxY = 0, count = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (isAxis(data[i], data[i + 1], data[i + 2])) {
        count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const dpr = w / stage.w; // canvas backing px per CSS px (device pixel ratio-ish)
  return count > 20 ? { cssW: Math.round((maxX - minX) / dpr), cssH: Math.round((maxY - minY) / dpr), pixels: count, backing: `${w}x${h}` } : { pixels: count, backing: `${w}x${h}` };
}, stageBox);
console.log(`  axis-color footprint (approx gizmo CSS size): ${JSON.stringify(measure)}`);
console.log(`  pageerrors: ${errs.length} ${errs.slice(0, 2).join(' | ')}`);

await ctx.close();
await browser.close();
