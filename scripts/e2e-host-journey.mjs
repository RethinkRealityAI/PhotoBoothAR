/**
 * New-host journey, end to end, against a real deployment.
 *
 *   sign in → create an event in the setup wizard (every step, defaults)
 *   → go live → a guest on a phone takes and sends a photo
 *   → the photo shows on the live wall.
 *
 * It records step timings, page errors, console errors and HTTP >= 400 per
 * surface, and saves a screenshot of every screen at the viewports it runs.
 * Built from the 2026-11-21 onboarding test; rerun it after any change to
 * sign-in, the wizard, the booth or the wall.
 *
 * It WRITES REAL DATA: one event named "TEST – <stamp> (delete me)" and one
 * guest post captioned "QA test (delete)". Use a dedicated test account.
 *
 * Usage:
 *   E2E_EMAIL=… E2E_PASSWORD=… node scripts/e2e-host-journey.mjs [baseUrl]
 *     baseUrl      default https://beamwall.app
 *     OUT=dir      screenshots + report.json (default scratch-shots/e2e-journey)
 *     SIGNUP_EMAIL=addr   also fill the sign-up form for this NEW address and
 *                         stop at "Check your email" (confirm it by hand)
 *     HTTPS_PROXY  honoured, so it runs inside proxied sandboxes too
 *     CHROME_PATH  a Chromium binary, when Playwright's own download is absent
 *
 * Exit code 1 when any step fails or any page error was seen.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.argv[2] || 'https://beamwall.app').replace(/\/$/, '');
const OUT = process.env.OUT || 'scratch-shots/e2e-journey';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const SIGNUP_EMAIL = process.env.SIGNUP_EMAIL;
if (!EMAIL || !PASSWORD) {
  console.error('Set E2E_EMAIL and E2E_PASSWORD (a confirmed TEST host account).');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};
const DESKTOP = { viewport: { width: 1440, height: 900 } };

const report = { base: BASE, startedAt: new Date().toISOString(), steps: [], problems: [] };
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({
  proxy,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function surface(name, ctxOpts) {
  const ctx = await browser.newContext({ ...ctxOpts, permissions: ['camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.problems.push({ surface: name, kind: 'pageerror', text: e.message }));
  page.on('console', (m) => {
    if (m.type() === 'error') report.problems.push({ surface: name, kind: 'console', text: m.text().slice(0, 300) });
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) {
      report.problems.push({ surface: name, kind: `http ${r.status()}`, text: `${r.request().method()} ${r.url().slice(0, 160)}` });
    }
  });
  return { ctx, page };
}

const shot = (page, name) =>
  page.screenshot({ path: `${OUT}/${name}.png`, timeout: 45000 }).catch(() => report.problems.push({ surface: name, kind: 'screenshot', text: 'timed out' }));

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    report.steps.push({ name, ok: true, ms: Date.now() - t0, detail });
    console.log(`ok   ${name} (${Date.now() - t0} ms)${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    report.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 300) });
    console.log(`FAIL ${name}: ${String(e?.message || e).slice(0, 200)}`);
    throw e;
  }
}

const visible = (page, sel, timeout = 2500) => page.locator(sel).first().isVisible({ timeout }).catch(() => false);

let slug = null;
let eventId = null;
try {
  if (SIGNUP_EMAIL) {
    const { page } = await surface('signup', PHONE);
    await step('sign-up form → check your email', async () => {
      await page.goto(`${BASE}/signup`, { waitUntil: 'load' });
      await shot(page, '00-signup-390');
      await page.fill('input[autocomplete=name]', 'QA Test Host (TEST)');
      await page.fill('input[type=email]', SIGNUP_EMAIL);
      await page.fill('input[autocomplete=new-password]', PASSWORD);
      await page.click('button[type=submit]');
      await page.getByText('Check your email').waitFor({ timeout: 20000 });
      await shot(page, '01-check-email-390');
    });
  }

  const host = await surface('host', DESKTOP);
  const hp = host.page;

  await step('sign in (deep link returns to the wizard)', async () => {
    await hp.goto(`${BASE}/host/new`, { waitUntil: 'load' });
    await hp.waitForURL(/\/login/, { timeout: 15000 });
    await hp.fill('input[type=email]', EMAIL);
    await hp.fill('input[type=password]', PASSWORD);
    await hp.click('button[type=submit]');
    await hp.waitForURL(/\/host\/new/, { timeout: 20000 });
  });

  await step('wizard: basics → create event', async () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    await hp.locator('#wz-name').waitFor({ timeout: 20000 });
    await shot(hp, '10-basics-1440');
    await hp.fill('#wz-name', `TEST – ${stamp} (delete me)`);
    await hp.locator('[role=radio]').nth(1).click();
    await hp.fill('#wz-date', '2030-12-12');
    await hp.locator('.wz-footer button').last().click();
    await hp.waitForURL(/\/host\/setup\/[^/]+\/invite/, { timeout: 30000 });
    eventId = hp.url().split('/host/setup/')[1].split('/')[0];
    return `event ${eventId}`;
  });

  for (const s of ['invite', 'looks', 'powerups', 'challenges', 'booth']) {
    await step(`wizard: ${s} → continue`, async () => {
      await hp.waitForTimeout(2500);
      await shot(hp, `11-${s}-1440`);
      await hp.locator('.wz-footer button').last().click();
      await hp.waitForFunction((x) => !location.pathname.endsWith(`/${x}`), s, { timeout: 30000 });
    });
  }

  await step('wizard: launch → go live', async () => {
    await hp.getByRole('button', { name: /go live/i }).click();
    await hp.getByText(/you.re live/i).first().waitFor({ timeout: 20000 });
    await hp.waitForTimeout(1500);
    await shot(hp, '12-live-1440');
    const link = await hp.getByText(/\/e\/[^/]+\/welcome/).first().innerText();
    slug = link.split('/e/')[1].split('/')[0];
    return `slug ${slug}`;
  });

  const wall = await surface('wall', DESKTOP);
  await step('live wall opens (empty)', async () => {
    await wall.page.goto(`${BASE}/e/${slug}/wall`, { waitUntil: 'load' });
    await wall.page.waitForTimeout(5000);
    await shot(wall.page, '20-wall-empty-1440');
  });

  const guest = await surface('guest', PHONE);
  const gp = guest.page;
  await step('guest: welcome → camera (taps counted)', async () => {
    await gp.goto(`${BASE}/e/${slug}/welcome`, { waitUntil: 'load' });
    await gp.waitForTimeout(2500);
    await shot(gp, '30-welcome-390');
    let taps = 0;
    await gp.getByText(/step into the booth|open the photo booth/i).first().tap();
    taps++;
    for (let i = 0; i < 4; i++) {
      if (await visible(gp, '[aria-label="Take photo"]', 3000)) break;
      if (await visible(gp, 'text=Step inside', 500)) { await gp.tap('text=Step inside'); taps++; continue; }
      if (await visible(gp, 'button:has-text("Skip")', 500)) { await gp.tap('button:has-text("Skip")'); taps++; continue; }
      if (await visible(gp, 'button:has-text("Start camera")', 500)) { await gp.tap('button:has-text("Start camera")'); taps++; }
    }
    await gp.locator('[aria-label="Take photo"]').waitFor({ timeout: 20000 });
    await gp.waitForTimeout(2500);
    await shot(gp, '31-camera-390');
    return `${taps} tap(s) from welcome to camera`;
  });

  await step('guest: capture → send', async () => {
    await gp.tap('[aria-label="Take photo"]');
    await gp.locator('[aria-label="Send your photo to the live wall"]').waitFor({ timeout: 20000 });
    await shot(gp, '32-review-390');
    if (await visible(gp, 'text=Add a name or note', 1000)) {
      await gp.tap('text=Add a name or note');
      const input = gp.locator('input[type=text], textarea').first();
      if (await input.isVisible().catch(() => false)) await input.fill('QA test (delete)');
    }
    await gp.tap('[aria-label="Send your photo to the live wall"]');
    await gp.getByText('Sent!').waitFor({ timeout: 30000 });
    await gp.waitForTimeout(1500);
    await shot(gp, '33-sent-390');
  });

  await step('live wall shows the photo', async () => {
    await wall.page.getByText(/\b1 moment\b/).first().waitFor({ timeout: 30000 });
    await wall.page.waitForTimeout(3000);
    await shot(wall.page, '21-wall-with-photo-1440');
  });

  const phoneHost = await surface('host-phone', PHONE);
  await step('host dashboard on a phone', async () => {
    const p = phoneHost.page;
    await p.goto(`${BASE}/login`, { waitUntil: 'load' });
    await p.fill('input[type=email]', EMAIL);
    await p.fill('input[type=password]', PASSWORD);
    await p.click('button[type=submit]');
    await p.waitForURL(/\/host/, { timeout: 20000 });
    await p.waitForTimeout(4000);
    await shot(p, '40-dashboard-390');
    await p.goto(`${BASE}/host/setup/${eventId}/launch`, { waitUntil: 'load' });
    await p.waitForTimeout(4000);
    await shot(p, '41-launch-390');
    const overflow = await p.evaluate(() =>
      [...document.querySelectorAll('section')].some((s) => s.getBoundingClientRect().right > innerWidth + 1),
    );
    if (overflow) throw new Error('a Launch section runs past the right edge at 390px');
  });
} catch {
  // the failing step is already in the report
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.testData = { eventId, slug };
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  const pageErrors = report.problems.filter((p) => p.kind === 'pageerror').length;
  const failed = report.steps.filter((s) => !s.ok).length;
  console.log(`\n${report.steps.length - failed}/${report.steps.length} steps ok · ${pageErrors} page errors · ${report.problems.length} problems logged`);
  console.log(`report: ${OUT}/report.json`);
  if (eventId) console.log(`TEST data created: event ${eventId} (${slug}) — delete when done.`);
  process.exitCode = failed > 0 || pageErrors > 0 ? 1 : 0;
}
