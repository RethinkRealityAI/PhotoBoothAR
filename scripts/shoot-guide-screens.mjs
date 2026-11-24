/**
 * Re-shoots the guest and live-wall screens in public/guides/screens/.
 *
 *   node scripts/shoot-guide-screens.mjs [baseUrl] [outDir]
 *
 * baseUrl defaults to http://localhost:5173: a dev server of THIS branch with
 * the production VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY inline, so the
 * pages read real public demo events. Everything it does is read-only: it
 * opens public guest pages, picks looks and takes a photo, and NEVER presses
 * Send. The wall is shot through `?preview=1` inside a same-origin frame
 * (src/lib/wallPreview.ts), which draws sample photos with no database I/O.
 *
 * The camera is a fake device fed the platform's AI stand-in guest
 * (src/assets/landing/booth-standin.webp, converted to a y4m with the bundled
 * ffmpeg), so no real person appears and face tracking still runs.
 *
 * Output is raw PNG at @2x into outDir (default scratch-shots/guide-screens/).
 * Look at every one, then convert the keepers to WebP at the sizes recorded in
 * GUIDE_SCREENS (600 wide phone / 1600 wide desktop, quality 80). The
 * structural test holds each recorded width/height to the WebP's own header.
 *
 * The host setup screens (setup-*) are NOT shot here: they need a signed-in
 * host, and were captured from a walk through the setup wizard at 1440 × 900
 * @2x. Re-shoot those by walking /host/new as a test host.
 *
 * Traps: the sandbox proxy must carry *.supabase.co but NOT localhost (hence
 * the bypass); `networkidle` never settles on the booth (use load + waits);
 * WebGL needs --enable-unsafe-swiftshader in headless Chromium.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'scratch-shots/guide-screens';
mkdirSync(out, { recursive: true });

// Public demo events: a deluxe gala with every kind of look, and a wedding.
const GALA = 'the-winter-gala';
const WEDDING = 'ada-tolu-s-wedding-cav4';

const y4m = join(out, 'standin.y4m');
if (!existsSync(y4m)) {
  execFileSync(ffmpeg.path, [
    '-y', '-loop', '1', '-i', 'src/assets/landing/booth-standin.webp',
    '-t', '3', '-r', '15', '-vf', 'scale=720:1280,format=yuv420p', y4m,
  ], { stdio: 'ignore' });
}

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({
  // The repo pins its own Playwright, whose bundled browser may not be the one
  // installed here; same override as scripts/shoot-guides.mjs.
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium',
  proxy,
  args: [
    '--ignore-certificate-errors',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
    '--enable-unsafe-swiftshader',
  ],
});

/** Clicks by visible text, or by CSS selector when prefixed with '@'. */
async function tap(page, what) {
  const loc = what.startsWith('@') ? page.locator(what.slice(1)) : page.getByText(what, { exact: false });
  await loc.first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
}

// ---- Guest phone screens -------------------------------------------------
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'],
});
const p = await phone.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const shoot = async (name, settle = 8000) => {
  await p.waitForTimeout(settle);
  await p.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
};

await p.goto(`${base}/e/${GALA}/welcome`, { waitUntil: 'load' });
await shoot('guest-welcome', 9000);
await p.goto(`${base}/e/${GALA}/challenges`, { waitUntil: 'load' });
await shoot('guest-challenges', 8000);

await p.goto(`${base}/e/${GALA}/booth`, { waitUntil: 'load' });
await p.waitForTimeout(4000);
await tap(p, 'Step inside');
await tap(p, 'More looks');
await shoot('guest-more-looks', 3000);
await tap(p, 'Gold Classic');
await tap(p, 'Done');
await shoot('guest-frame');
await tap(p, 'More looks');
await tap(p, 'Confetti Party');
await tap(p, 'Done');
await shoot('guest-crown');
await tap(p, '@[aria-label="Take photo"]');
await shoot('guest-send', 4000);
// Back to the live camera without sending anything.
await tap(p, 'Retake');
await tap(p, 'More looks');
await tap(p, 'Clear all');
await tap(p, 'Done');
await tap(p, 'Paint');
await tap(p, 'Tiger');
await shoot('guest-paint');
await tap(p, 'More looks');
await tap(p, 'Clear all');
await tap(p, 'Snow Queen');
await tap(p, 'Done');
await shoot('guest-effects');
await phone.close();

// ---- Live wall, in the wizard's preview frame ----------------------------
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
for (const [name, slug, layout] of [['wall-gallery', WEDDING, null], ['wall-grid', GALA, 'Grid']]) {
  const w = await desk.newPage();
  await w.route(`${base}/__guide-frame`, (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: `<html><body style="margin:0"><iframe id="f" src="/e/${slug}/wall?preview=1" style="border:0;width:1440px;height:900px"></iframe></body></html>`,
    }),
  );
  await w.goto(`${base}/__guide-frame`);
  await w.waitForTimeout(10000);
  if (layout !== null) {
    await w.frameLocator('#f').getByText(layout, { exact: true }).first().click();
    await w.waitForTimeout(5000);
  }
  await w.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
  await w.close();
}
await desk.close();
await browser.close();

if (errors.length > 0) {
  console.error(`${errors.length} page error(s):\n${errors.join('\n')}`);
  process.exit(1);
}
