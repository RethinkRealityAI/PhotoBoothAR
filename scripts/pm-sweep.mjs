/**
 * PM launch-readiness sweep — screenshots the PUBLIC surfaces (no auth, no
 * backend reachability assumed) at phone / tablet / desktop widths and records
 * pageerrors, console errors, horizontal overflow and failed-request hosts per
 * route. Data-coupled routes are EXPECTED to show their honest error/empty
 * states here (the sandbox cannot reach *.supabase.co) — that state is part of
 * what is being reviewed. Modeled on scripts/shoot-studio.mjs + w8-spot-check.mjs.
 *
 * Usage: node scripts/pm-sweep.mjs [baseUrl]
 *   OUT=dir  override the output directory (default scratch-shots/pm)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const OUT = process.env.OUT || 'scratch-shots/pm';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];

// settle: extra ms after domcontentloaded (3D scenes, fetch-failure states).
// fullPage: long marketing/guide pages get a full-page capture too.
// escape: dismiss the /dev/studio first-load naming dialog.
const ROUTES = [
  { path: '/', name: 'landing', fullPage: true, settle: 5000 },
  { path: '/guides', name: 'guides-hub', fullPage: true, settle: 2500 },
  { path: '/guides/first-event', name: 'guide-first-event', fullPage: true, settle: 2500 },
  { path: '/guides/make-a-frame', name: 'guide-make-a-frame', fullPage: true, settle: 2500 },
  { path: '/login', name: 'login', settle: 1500 },
  { path: '/signup', name: 'signup', settle: 1500 },
  { path: '/forgot-password', name: 'forgot-password', settle: 1500 },
  { path: '/host', name: 'host-unauth', settle: 2500 },
  { path: '/e/demo/welcome', name: 'guest-welcome', settle: 4000 },
  { path: '/e/demo', name: 'guest-booth', settle: 4000 },
  { path: '/e/demo/wall', name: 'guest-wall', settle: 4000 },
  { path: '/r/demo', name: 'recap', settle: 4000 },
  { path: '/dev/studio', name: 'dev-studio', settle: 3000, escape: true },
  { path: '/dev/asset-prep', name: 'dev-asset-prep', settle: 2500 },
  { path: '/definitely-not-a-route', name: 'not-found', settle: 1500 },
];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'],
});

const summary = [];
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      permissions: ['camera'],
      reducedMotion: 'reduce', // decorative reveals render in final state
    });
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      const failedHosts = new Set();
      page.on('pageerror', (e) => pageErrors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('requestfailed', (r) => { try { failedHosts.add(new URL(r.url()).host); } catch { /* data: etc. */ } });
      const row = { route: route.name, viewport: vp.name, ok: false };
      try {
        await page.goto(`${base}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(route.settle ?? 2000);
        if (route.escape) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
        const overflow = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth - window.innerWidth,
          body: document.body.scrollWidth - window.innerWidth,
        }));
        const shot = `${OUT}/${route.name}-${vp.name}.png`;
        await page.screenshot({ path: shot, fullPage: false });
        if (route.fullPage) {
          await page.screenshot({ path: `${OUT}/${route.name}-${vp.name}-full.png`, fullPage: true });
        }
        Object.assign(row, {
          ok: true,
          url: page.url(),
          overflow,
          pageErrors: pageErrors.slice(0, 5),
          consoleErrors: consoleErrors.slice(0, 5),
          consoleErrorCount: consoleErrors.length,
          failedHosts: [...failedHosts],
        });
        const flag = (overflow.doc > 1 || overflow.body > 1) ? ` OVERFLOW doc=${overflow.doc} body=${overflow.body}` : '';
        console.log(`${vp.name.padEnd(8)} ${route.name.padEnd(18)} errs=${pageErrors.length}/${consoleErrors.length}${flag}`);
        if (pageErrors.length) console.log(`   pageerrors: ${pageErrors.slice(0, 2).join(' | ').slice(0, 200)}`);
      } catch (err) {
        row.error = String(err).slice(0, 200);
        console.log(`${vp.name.padEnd(8)} ${route.name.padEnd(18)} NAV-FAIL ${row.error}`);
      }
      summary.push(row);
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log(`\nwrote ${summary.length} rows -> ${OUT}/summary.json`);
