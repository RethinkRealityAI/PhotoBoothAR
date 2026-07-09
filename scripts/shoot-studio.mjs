/**
 * Studio visual verification — screenshots the DEV harness (/dev/studio) at
 * phone / tablet / desktop widths so panel visibility is checked with eyes, not
 * assumptions. Usage: node scripts/shoot-studio.mjs [baseUrl] [tag]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const tag = process.argv[3] || 'run';
const OUT = 'scratch-shots';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'],
});
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      permissions: ['camera'],
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/dev/studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Let the shell mount + camera error settle.
    await page.waitForTimeout(2500);

    // A panel is "reachable" if it is on-screen now (lg columns) OR a toggle
    // exists to open it (mobile drawers). Check actual geometry, not DOM text.
    const onScreen = async (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.right > 8 && r.left < window.innerWidth - 8;
    }, sel);

    const assetsCol = await onScreen('[data-panel="assets"]');
    const propsCol = await onScreen('[data-panel="props"]');
    const assetsToggle = await page.locator('button[aria-label="Toggle assets panel"]').count();
    const propsToggle = await page.locator('button[aria-label="Toggle properties panel"]').count();

    const file = `${OUT}/studio-${tag}-${vp.name}.png`;
    await page.screenshot({ path: file, fullPage: false });
    const reach = (col, toggle) => col ? 'column' : toggle ? 'drawer' : 'MISSING';
    console.log(`${vp.name.padEnd(8)} ${vp.width}x${vp.height}  assets=${reach(assetsCol, assetsToggle)} props=${reach(propsCol, propsToggle)}  errs=${errors.length}  -> ${file}`);

    // On mobile, open each drawer and screenshot to prove it reaches content.
    if (assetsToggle && !assetsCol) {
      await page.locator('button[aria-label="Toggle assets panel"]').click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/studio-${tag}-${vp.name}-assets-open.png` });
      const open = await onScreen('[data-panel="assets"]');
      console.log(`         assets drawer opens on-screen: ${open}`);
      await page.locator('button[aria-label="Close panel"]').first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
    if (propsToggle && !propsCol) {
      await page.locator('button[aria-label="Toggle properties panel"]').click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/studio-${tag}-${vp.name}-props-open.png` });
      const open = await onScreen('[data-panel="props"]');
      console.log(`         props drawer opens on-screen:  ${open}`);
    }
    if (errors.length) console.log('   pageerrors:', errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}
