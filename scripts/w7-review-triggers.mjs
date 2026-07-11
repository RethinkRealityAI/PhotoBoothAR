/**
 * W7 review — Magic Triggers (PropertiesDock, scene-level). Add-trigger flow,
 * source/action pickers, Reveal target, cap of 4, remove X, and that triggers
 * do not bury Scene Layers. Adds a 3D head piece first (Reveal needs a target).
 * Usage: node scripts/w7-review-triggers.mjs
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

const width = 1440;
const ctx = await browser.newContext({ viewport: { width, height: 1000 }, permissions: ['camera'] });
const page = await ctx.newPage();
await page.goto(`${BASE}/dev/studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

const propsClip = async () => page.evaluate((w) => {
  const el = document.querySelector('[data-panel="props"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, w - Math.max(0, r.x)), height: Math.min(r.height, 1000) };
}, width);

// 1) Add a 3D head piece (Reveal target + populates Scene Layers).
await page.locator('[data-panel="assets"] button:has-text("3D")').first().click();
await page.waitForTimeout(400);
await page.locator('[data-panel="assets"] button[class*="aspect-square"]').first().click();
await page.waitForTimeout(600);

// Section order: is Scene Layers above Magic Triggers?
const order = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('[data-panel="props"] *')].filter((e) => /^(Scene Layers|Magic Triggers)$/.test(e.textContent.trim()) && e.children.length === 0);
  return labels.map((e) => ({ t: e.textContent.trim(), y: Math.round(e.getBoundingClientRect().top) }));
});
console.log(`== Magic Triggers ${width}px ==`);
console.log(`  section order (y): ${JSON.stringify(order)}  -> Scene Layers above Magic Triggers = ${order.length === 2 && order[0].t === 'Scene Layers' && order[0].y < order[1].y}`);

// 2) Open the add-trigger flow.
const addBtn = page.locator('[data-panel="props"] button:has-text("Add trigger")').first();
await addBtn.scrollIntoViewIfNeeded();
await addBtn.click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/triggers-picker-burst.png`, clip: await propsClip() });

// Read the source + action chip labels shown.
const chips = await page.evaluate(() => {
  const panel = document.querySelector('[data-panel="props"]');
  const grab = (labelText) => {
    const lbls = [...panel.querySelectorAll('*')].filter((e) => e.textContent.trim() === labelText && e.children.length === 0);
    if (!lbls.length) return [];
    // the grid of chips is the next sibling block
    const grid = lbls[0].parentElement.querySelector('.grid');
    return grid ? [...grid.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
  };
  return { sources: grab('When guest…'), actions: grab('Do…'), burstStyles: grab('Style') };
});
console.log(`  sources: ${JSON.stringify(chips.sources)}`);
console.log(`  actions: ${JSON.stringify(chips.actions)}`);
console.log(`  burst styles: ${JSON.stringify(chips.burstStyles)}`);

// 3) Switch action to Reveal -> dropdown should list the head piece.
await page.locator('[data-panel="props"] button:has-text("Reveal")').first().click();
await page.waitForTimeout(300);
const revealOpts = await page.evaluate(() => {
  const sel = document.querySelector('[data-panel="props"] select');
  return sel ? [...sel.options].map((o) => o.textContent.trim()) : null;
});
console.log(`  Reveal dropdown options: ${JSON.stringify(revealOpts)}`);
await page.screenshot({ path: `${OUT}/triggers-picker-reveal.png`, clip: await propsClip() });

// 4) Commit a Smile->Reveal trigger, then fill to cap (4) with Burst.
await page.locator('[data-panel="props"] button:has-text("Add"):not(:has-text("Add trigger"))').first().click();
await page.waitForTimeout(400);
for (let i = 0; i < 4; i++) {
  const btn = page.locator('[data-panel="props"] button:has-text("Add trigger")').first();
  if (!(await btn.count()) || !(await btn.isVisible())) break;
  await btn.scrollIntoViewIfNeeded(); await btn.click(); await page.waitForTimeout(250);
  // default action is Burst; just commit
  const commit = page.locator('[data-panel="props"] button:has-text("Add"):not(:has-text("Add trigger"))').first();
  if (await commit.count()) { await commit.click(); await page.waitForTimeout(300); }
}

const capState = await page.evaluate(() => {
  const panel = document.querySelector('[data-panel="props"]');
  const counter = [...panel.querySelectorAll('span.font-mono')].map((s) => s.textContent.trim()).find((t) => /\/\d/.test(t));
  const list = panel.querySelectorAll('button[aria-label="Remove trigger"]').length;
  const addVisible = [...panel.querySelectorAll('button')].some((b) => /Add trigger/.test(b.textContent) && b.offsetParent !== null);
  const capMsg = panel.innerText.includes('Up to 4 triggers');
  return { counter, listCount: list, addVisible, capMsg };
});
console.log(`  after filling: counter=${capState.counter}  trigger rows=${capState.listCount}  'Add trigger' visible=${capState.addVisible}  capMsg='Up to 4'=${capState.capMsg}`);
await page.screenshot({ path: `${OUT}/triggers-at-cap.png`, clip: await propsClip() });

// 5) Remove one -> counter drops, add button returns.
await page.locator('[data-panel="props"] button[aria-label="Remove trigger"]').first().click();
await page.waitForTimeout(300);
const afterRemove = await page.evaluate(() => {
  const panel = document.querySelector('[data-panel="props"]');
  const counter = [...panel.querySelectorAll('span.font-mono')].map((s) => s.textContent.trim()).find((t) => /\/\d/.test(t));
  const list = panel.querySelectorAll('button[aria-label="Remove trigger"]').length;
  return { counter, listCount: list };
});
console.log(`  after remove X: counter=${afterRemove.counter}  rows=${afterRemove.listCount}`);

await ctx.close();
await browser.close();
