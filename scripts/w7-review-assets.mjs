/**
 * W7 review — My Assets panel (AssetsDock). Counts, chips, search, inline
 * settings-card position, sticky-header occlusion, 390 overflow.
 * Usage: node scripts/w7-review-assets.mjs
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

const panelBox = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-panel="assets"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

const scan = (page) => page.evaluate(() => {
  const panel = document.querySelector('[data-panel="assets"]');
  if (!panel) return { heads: [], frames: 0, squares: 0, overflowX: false, maxRight: 0 };
  const heads = [];
  panel.querySelectorAll('button').forEach((b) => {
    const mono = b.querySelector('span.font-mono');
    const lbl = b.querySelector('span.font-label');
    if (mono && lbl && /^\d+$/.test(mono.textContent.trim())) heads.push({ label: lbl.textContent.trim(), count: mono.textContent.trim() });
  });
  const frames = panel.querySelectorAll('button[class*="aspect-[9/16]"]').length;
  const squares = panel.querySelectorAll('button[class*="aspect-square"]').length;
  // Horizontal overflow inside the panel.
  const pr = panel.getBoundingClientRect();
  let maxRight = 0, overflowX = panel.scrollWidth > panel.clientWidth + 1;
  panel.querySelectorAll('*').forEach((n) => { const r = n.getBoundingClientRect(); if (r.width > 0 && r.right > maxRight) maxRight = r.right; });
  return { heads, frames, squares, overflowX, maxRight: Math.round(maxRight), panelRight: Math.round(pr.right), scrollW: panel.scrollWidth, clientW: panel.clientWidth };
});

async function openAssets(page, width) {
  if (width < 1024) {
    const t = page.locator('button[aria-label="Toggle assets panel"]');
    if (await t.count()) { await t.first().click(); await page.waitForTimeout(400); }
  }
}

for (const width of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await openAssets(page, width);

  const pb = await panelBox(page);
  const clip = pb ? { x: Math.max(0, pb.x), y: pb.y, width: Math.min(pb.w, width - Math.max(0, pb.x)), height: Math.min(pb.h, 900) } : undefined;
  await page.screenshot({ path: `${OUT}/assets-${width}-all.png`, clip });

  const s1 = await scan(page);
  console.log(`\n== assets ${width}px (chip=All) ==`);
  console.log(`  sub-group counts: ${JSON.stringify(s1.heads)}`);
  console.log(`  visible tiles: frames(9:16)=${s1.frames}  squares=${s1.squares}`);
  console.log(`  overflowX=${s1.overflowX}  maxRight=${s1.maxRight} vs viewport ${width} (panelRight=${s1.panelRight})  scrollW=${s1.scrollW}/clientW=${s1.clientW}`);

  // Zoom close-up of Studio Library header + first Frames row (to read the count).
  if (clip) await page.screenshot({ path: `${OUT}/assets-${width}-lib-zoom.png`, clip: { x: clip.x, y: Math.min(clip.y + 210, 900 - 260), width: clip.width, height: 260 } });

  // Click first Frames tile -> inline settings card below its row.
  const firstFrame = page.locator('[data-panel="assets"] button[class*="aspect-[9/16]"]').first();
  if (await firstFrame.count()) {
    const tb = await firstFrame.boundingBox();
    await firstFrame.click();
    await page.waitForTimeout(500);
    // The inline card is a .liquid-glass row; find the one just below the clicked tile.
    const card = await page.evaluate((ty) => {
      const cards = [...document.querySelectorAll('[data-panel="assets"] .liquid-glass')];
      const below = cards.map((c) => { const r = c.getBoundingClientRect(); return { top: r.top, left: r.left, w: r.width, h: r.height }; })
        .filter((r) => r.top > ty && r.h > 20).sort((a, b) => a.top - b.top)[0];
      return below || null;
    }, tb.y + tb.height - 10);
    console.log(`  inline card after Frame click: tile.y=${Math.round(tb.y)} bottom=${Math.round(tb.y + tb.height)} -> card.top=${card ? Math.round(card.top) : 'NONE'} left=${card ? Math.round(card.left) : '?'} w=${card ? Math.round(card.w) : '?'}`);
    const pb2 = await panelBox(page);
    const c2 = { x: Math.max(0, pb2.x), y: pb2.y, width: Math.min(pb2.w, width - Math.max(0, pb2.x)), height: Math.min(pb2.h, 900) };
    await page.screenshot({ path: `${OUT}/assets-${width}-inline-card.png`, clip: c2 });
  }

  // Sticky-header occlusion: scroll the panel body and screenshot.
  await page.evaluate(() => { const p = document.querySelector('[data-panel="assets"]'); const inner = p.querySelector('.overflow-y-auto') || p; inner.scrollTop = 260; });
  await page.waitForTimeout(300);
  if (clip) await page.screenshot({ path: `${OUT}/assets-${width}-scrolled.png`, clip });

  // Chips: 3D (head pieces only), then Filters.
  const chip = (name) => page.locator(`[data-panel="assets"] button:has-text("${name}")`).first();
  await page.evaluate(() => { const p = document.querySelector('[data-panel="assets"]'); const inner = p.querySelector('.overflow-y-auto') || p; inner.scrollTop = 0; });
  await chip('3D').click(); await page.waitForTimeout(400);
  const s3d = await scan(page);
  if (clip) await page.screenshot({ path: `${OUT}/assets-${width}-chip-3d.png`, clip });
  console.log(`  chip=3D -> heads:${JSON.stringify(s3d.heads)} squares=${s3d.squares} frames=${s3d.frames} (frames should be 0)`);

  // Search filter.
  await chip('All').click(); await page.waitForTimeout(200);
  await page.locator('[data-panel="assets"] input[placeholder="Search assets…"]').fill('gold');
  await page.waitForTimeout(400);
  const sSearch = await scan(page);
  if (clip) await page.screenshot({ path: `${OUT}/assets-${width}-search-gold.png`, clip });
  console.log(`  search "gold" -> heads:${JSON.stringify(sSearch.heads)} frames=${sSearch.frames} squares=${sSearch.squares}`);

  await ctx.close();
}
await browser.close();
