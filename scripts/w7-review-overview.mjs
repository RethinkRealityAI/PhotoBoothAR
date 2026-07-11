/**
 * W7 review — overview + regression sweep across 4 widths.
 * Full-panel screenshots, stage-width (director closed/open), header-name
 * offset, drawer mutual exclusion, emoji scan, console errors, booth route.
 * Usage: node scripts/w7-review-overview.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = 'scratch-shots/w7';
mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { name: '390', width: 390, height: 844 },
  { name: '820', width: 820, height: 1180 },
  { name: '1152', width: 1152, height: 820 },
  { name: '1440', width: 1440, height: 900 },
];

// Pictographic emoji only (exclude typographic arrows →, middot ·, dashes —).
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'],
});

const box = async (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, cx: r.x + r.width / 2 };
}, sel);

try {
  for (const vp of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, permissions: ['camera'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });
    await page.goto(`${BASE}/dev/studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    // Dismiss the z-50 naming dialog.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const dialogGone = !(await box(page, '.z-50'));

    await page.screenshot({ path: `${OUT}/overview-${vp.name}.png`, fullPage: false });

    // Stage width, director CLOSED.
    const stageClosed = await box(page, 'main');
    // Header name offset from true viewport center (sm+ absolute-centered mode).
    const nameBox = await box(page, 'button[aria-label="Rename experience"], input[aria-label="Experience name"]');
    const nameOffset = nameBox ? Math.round(Math.abs(nameBox.cx - vp.width / 2)) : null;

    // Open Director (header button with aria-pressed).
    const dirToggle = page.locator('header button[aria-pressed]');
    let stageOpen = null, dirBox = null;
    if (await dirToggle.count()) {
      await dirToggle.first().click();
      await page.waitForTimeout(500);
      stageOpen = await box(page, 'main');
      dirBox = await box(page, '[data-panel="director"]');
      await page.screenshot({ path: `${OUT}/overview-${vp.name}-director.png`, fullPage: false });
      // close again
      await dirToggle.first().click();
      await page.waitForTimeout(300);
    }

    // Emoji scan of the whole rendered studio.
    const emojiHits = await page.evaluate((src) => {
      const re = new RegExp(src, 'u');
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walk.nextNode())) {
        const t = n.nodeValue || '';
        if (re.test(t)) out.push(t.trim().slice(0, 40));
      }
      return [...new Set(out)].slice(0, 20);
    }, EMOJI.source);

    console.log(`\n== ${vp.name}px (${vp.width}x${vp.height}) ==`);
    console.log(`  dialogDismissed=${dialogGone}  errs=${errors.length}`);
    console.log(`  stage closed: w=${stageClosed ? Math.round(stageClosed.w) : '??'}  x=${stageClosed ? Math.round(stageClosed.x) : '?'}`);
    if (stageOpen) console.log(`  stage w/Director: w=${Math.round(stageOpen.w)}  director: x=${dirBox ? Math.round(dirBox.x) : '?'} w=${dirBox ? Math.round(dirBox.w) : '?'} (overlay if x<stageClosed.right)`);
    console.log(`  header name offset from center: ${nameOffset}px  (name cx=${nameBox ? Math.round(nameBox.cx) : '?'})`);
    console.log(`  emoji glyphs: ${emojiHits.length ? JSON.stringify(emojiHits) : 'none'}`);
    if (errors.length) console.log(`  ERRORS: ${errors.slice(0, 4).join(' | ')}`);

    // Drawer mutual exclusion (below lg only — toggles exist).
    const assetsT = page.locator('button[aria-label="Toggle assets panel"]');
    const propsT = page.locator('button[aria-label="Toggle properties panel"]');
    const assetsVisible = (await assetsT.count()) && (await assetsT.first().isVisible());
    if (assetsVisible) {
      await assetsT.first().click(); await page.waitForTimeout(350);
      const aOpen = await box(page, '[data-panel="assets"]');
      await propsT.first().click(); await page.waitForTimeout(350);
      const aAfter = await box(page, '[data-panel="assets"]');
      const pAfter = await box(page, '[data-panel="props"]');
      const onScreen = (b) => b && b.x > -20 && b.x < vp.width - 20;
      console.log(`  drawer exclusion: assets onscreen before=${onScreen(aOpen)} after-props-open=${onScreen(aAfter)}  props onscreen=${onScreen(pAfter)} -> ${onScreen(aAfter) && onScreen(pAfter) ? 'BOTH OPEN (bug)' : 'mutually exclusive OK'}`);
      await page.keyboard.press('Escape');
    }
    await ctx.close();
  }

  // Booth route sanity.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  const bErrs = [];
  page.on('pageerror', (e) => bErrs.push(e.message));
  const resp = await page.goto(`${BASE}/e/hope-gala`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  const bodyLen = (await page.evaluate(() => document.body.innerText.length)) || 0;
  await page.screenshot({ path: `${OUT}/booth-hope-gala.png` });
  console.log(`\n== booth /e/hope-gala ==  http=${resp && resp.status()}  innerTextLen=${bodyLen}  pageerrors=${bErrs.length}  ${bErrs.slice(0, 2).join(' | ')}`);
  await ctx.close();
} finally {
  await browser.close();
}
