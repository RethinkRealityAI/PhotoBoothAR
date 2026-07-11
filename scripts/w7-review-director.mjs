/**
 * W7 review — Director panel. Intro/pricing visibility, honest failure state
 * when the sandbox refuses the AI call, transcript layout at drawer widths.
 * Usage: node scripts/w7-review-director.mjs
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

const dirClip = (page, width) => page.evaluate((w) => {
  const el = document.querySelector('[data-panel="director"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, w - Math.max(0, r.x)), height: Math.min(r.height, 900) };
}, width);

for (const width of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Open Director via header toggle.
  await page.locator('header button[aria-pressed]').first().click();
  await page.waitForTimeout(600);

  let clip = await dirClip(page, width);
  await page.screenshot({ path: `${OUT}/director-${width}-intro.png`, clip });

  // Does the intro show any explicit price numbers before committing?
  const introText = await page.evaluate(() => {
    const el = document.querySelector('[data-panel="director"]');
    return el ? el.innerText : '';
  });
  const hasPriceWord = /credit/i.test(introText);
  const hasPriceNumber = /\b(1|10|11)\s*credit/i.test(introText);
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  console.log(`\n== director ${width}px intro ==`);
  console.log(`  mentions 'credit'=${hasPriceWord}  explicit N-credit number=${hasPriceNumber}  emoji=${EMOJI.test(introText)}`);
  console.log(`  intro text: ${JSON.stringify(introText.replace(/\s+/g, ' ').slice(0, 220))}`);

  // Composer: type a look and send.
  const composer = page.locator('[data-panel="director"] textarea, [data-panel="director"] input[type="text"]').first();
  const sendBtn = page.locator('[data-panel="director"] button:has-text("Send")').first();
  if (await composer.count()) {
    await composer.fill('A vaporwave neon look with a glowing crown head piece');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/director-${width}-composed.png`, clip: await dirClip(page, width) });
    if (await sendBtn.count()) await sendBtn.click();
    else await composer.press('Enter');
    // Wait for the network attempt to fail + the error bubble to render.
    await page.waitForTimeout(9000);
    clip = await dirClip(page, width);
    await page.screenshot({ path: `${OUT}/director-${width}-failure.png`, clip });
    const afterText = await page.evaluate(() => {
      const el = document.querySelector('[data-panel="director"]');
      return el ? el.innerText : '';
    });
    // Look for an error/amber bubble; detect fake success (e.g. cards) vs honest error.
    const errBubble = await page.evaluate(() => {
      const el = document.querySelector('[data-panel="director"]');
      if (!el) return { amber: 0, rose: 0 };
      const amber = el.querySelectorAll('[class*="amber"]').length;
      const rose = el.querySelectorAll('[class*="rose"]').length;
      return { amber, rose };
    });
    const looksLikeError = /(couldn.t|error|failed|unavailable|try again|invalid|key|unreachable|network)/i.test(afterText.replace(introText, ''));
    console.log(`  after SEND: errorBubbleClasses amber=${errBubble.amber} rose=${errBubble.rose}  honestError=${looksLikeError}`);
    console.log(`  new transcript text: ${JSON.stringify(afterText.replace(introText, '').replace(/\s+/g, ' ').trim().slice(0, 260))}`);
  } else {
    console.log('  COMPOSER NOT FOUND');
  }
  await ctx.close();
}
await browser.close();
