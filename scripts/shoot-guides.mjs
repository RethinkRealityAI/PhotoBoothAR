/**
 * Guides visual verification — two modes.
 *
 *   node scripts/shoot-guides.mjs shots [baseUrl]
 *     Hotspot source screenshots at a FIXED 1440×900 @2x (hotspot coordinates
 *     in guidesContent.ts are fractions of these exact captures — re-shooting
 *     at another viewport invalidates every coordinate, which the IHDR
 *     assertion in guidesContent.test.ts turns into a red test, on purpose):
 *       /dev/studio       -> src/assets/guides/shots/studio-editor.png
 *       /dev/event-chrome -> src/assets/guides/shots/event-chrome.png (skipped
 *                            with a warning until that DEV harness exists)
 *
 *   node scripts/shoot-guides.mjs sweep [baseUrl]
 *     Responsive gate for /guides + every guide slug at 390×844 / 820×1180 /
 *     1440×900: 0 pageerrors · no horizontal overflow · every
 *     [data-guide-block] has height · every <img> decoded (naturalWidth>0 —
 *     a missing public/ file is served as index.html at HTTP 200, and HTML
 *     decoded as an image gives naturalWidth 0, so this catches it) · every
 *     download link HEADs 200 with content-type image/png · at 390 a hotspot
 *     marker (when present) opens its bottom sheet on-screen. Exit code 1 on
 *     any failure. Screenshots land in scratch-shots/guides/ for eyeballing.
 *
 * Traps this script must never re-learn: dev server runs on 5173 (vite
 * default); NEVER shoot a server started with DISABLE_HMR=true (watch:null —
 * it silently serves stale code); --no-proxy-server or Chromium proxies
 * localhost and every request fails; mp4 embeds never play here (no H.264
 * decoder) so only posters are asserted.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const mode = process.argv[2];
const base = process.argv[3] || 'http://localhost:5173';
if (mode !== 'shots' && mode !== 'sweep') {
  console.error('usage: node scripts/shoot-guides.mjs <shots|sweep> [baseUrl]');
  process.exit(2);
}

const GUIDE_SLUGS = ['make-a-frame', 'make-3d-props', 'use-the-studio', 'first-event', 'run-the-night'];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--no-proxy-server',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--no-sandbox',
  ],
});

let failures = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };

try {
  if (mode === 'shots') {
    mkdirSync('public/guides/shots', { recursive: true });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      permissions: ['camera'],
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    for (const [route, out] of [
      ['/dev/studio', 'public/guides/shots/studio-editor.png'],
    ]) {
      const res = await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
      if (!res) { console.log(`! ${route} unreachable — skipped`); continue; }
      await page.waitForTimeout(3000);
      // A dropped DEV route falls through to the landing redirect — detect it.
      const isDevRoute = await page.evaluate(() => !document.querySelector('[data-hero]') || location.pathname.startsWith('/dev/'));
      if (!isDevRoute || page.url().endsWith('/')) { console.log(`! ${route} redirected (harness absent) — skipped`); continue; }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: out, fullPage: false });
      console.log(`✓ ${route} -> ${out} (1440x900@2x, errs=${errors.length})`);
    }
    await ctx.close();
  }

  if (mode === 'sweep') {
    mkdirSync('scratch-shots/guides', { recursive: true });
    const VIEWPORTS = [
      { name: 'phone', width: 390, height: 844 },
      { name: 'tablet', width: 820, height: 1180 },
      { name: 'desktop', width: 1440, height: 900 },
    ];
    const routes = ['/guides', ...GUIDE_SLUGS.map((s) => `/guides/${s}`)];

    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      for (const route of routes) {
        errors.length = 0;
        await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2200);
        // Scroll through so lazy images decode and reveals fire.
        await page.evaluate(async () => {
          const scroller = document.querySelector('main')?.closest('[class*="overflow-y-auto"]')
            ?? document.scrollingElement;
          for (let y = 0; y <= scroller.scrollHeight; y += 700) {
            scroller.scrollTop = y;
            await new Promise((r) => setTimeout(r, 60));
          }
          scroller.scrollTop = 0;
        });
        await page.waitForTimeout(800);

        const name = route.replaceAll('/', '_') || '_hub';
        await page.screenshot({ path: `scratch-shots/guides/${vp.name}${name}.png`, fullPage: true });

        console.log(`${vp.name} ${route}`);
        if (errors.length) fail(`pageerrors: ${errors.slice(0, 2).join(' | ')}`);

        const geom = await page.evaluate(() => {
          const doc = document.documentElement;
          const blocks = [...document.querySelectorAll('[data-guide-block]')];
          const imgs = [...document.querySelectorAll('img')];
          return {
            overflow: doc.scrollWidth > window.innerWidth + 1,
            zeroBlocks: blocks.filter((b) => b.getBoundingClientRect().height <= 0).length,
            blockCount: blocks.length,
            deadImgs: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
            downloads: [...document.querySelectorAll('a[download]')].map((a) => a.href),
          };
        });
        if (geom.overflow) fail('horizontal overflow');
        if (geom.zeroBlocks) fail(`${geom.zeroBlocks}/${geom.blockCount} guide blocks collapsed to 0 height`);
        if (geom.deadImgs.length) fail(`images that never decoded: ${geom.deadImgs.slice(0, 3).join(', ')}`);

        // Download links: 200 AND image/png — res.ok alone passes the
        // SPA-catch-all serving index.html for a missing file.
        for (const href of [...new Set(geom.downloads)]) {
          const head = await page.evaluate(async (u) => {
            try {
              const r = await fetch(u, { method: 'HEAD' });
              return { ok: r.ok, type: r.headers.get('content-type') || '' };
            } catch (e) { return { ok: false, type: String(e) }; }
          }, href);
          if (!head.ok || !head.type.startsWith('image/png')) {
            fail(`download ${href} -> ok=${head.ok} content-type=${head.type}`);
          }
        }

        // Phone-only: a hotspot marker must open its sheet on-screen.
        if (vp.name === 'phone') {
          const marker = page.locator('[data-hotspot-marker]').first();
          if (await marker.count()) {
            await marker.click();
            await page.waitForTimeout(500);
            // Two dialogs exist per open hotspot (the md popover is
            // display:none on phone) — pass if ANY dialog is actually visible
            // and fully on-screen.
            const sheetVisible = await page.evaluate(() => {
              return [...document.querySelectorAll('[role="dialog"]')].some((el) => {
                const r = el.getBoundingClientRect();
                return r.height > 60 && r.top >= 0 && r.bottom <= window.innerHeight + 1;
              });
            });
            if (!sheetVisible) fail('hotspot bottom sheet did not open on-screen');
            else console.log('  ✓ hotspot sheet opens on-screen');
            await page.keyboard.press('Escape');
            await page.screenshot({ path: `scratch-shots/guides/${vp.name}${name}-sheet.png` });
          }
        }
      }
      await ctx.close();
    }
    console.log(failures ? `\nSWEEP FAILED: ${failures} finding(s)` : '\nSWEEP CLEAN');
  }
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
