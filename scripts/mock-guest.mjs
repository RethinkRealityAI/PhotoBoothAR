/**
 * Offline guest-surface harness — renders /e/<slug>/** against a FAKE Supabase
 * so the welcome page, booth and live wall can be screenshotted with real-looking
 * data in this sandbox (which cannot reach *.supabase.co).
 *
 * Requires the dev server to run with:
 *   VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=mock
 *
 * Usage as a library:
 *   import { installGuestMocks } from './mock-guest.mjs';
 *   await installGuestMocks(page, { base, config: { scene: {...} }, wall: { wallLook: {...} }, posts: 16 });
 *
 * Usage as a CLI (one screenshot per route × viewport):
 *   node scripts/mock-guest.mjs http://localhost:5181 out-dir /e/sam/welcome /e/sam/wall
 *   FIXTURE='{"config":{...},"wall":{...},"posts":16}' node scripts/mock-guest.mjs ...
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

export const MOCK_HOST = 'mock.supabase.co';
export const SLUG = 'sam';

const PHOTOS = [
  'hero/hero-wedding.webp', 'hero/hero-gala.webp', 'hero/hero-birthday.webp', 'hero/hero-conference.webp',
  'hero/hero-tradeshow.webp', 'hero/hero-activation-v2.webp', 'hero/hero-activation.webp',
  'event-wedding.webp', 'event-gala.webp', 'event-birthday.webp', 'event-conference.webp',
  'event-tradeshow.webp', 'event-activation.webp', 'booth-portrait.webp',
];
const NAMES = ['Ada', 'Tunde', 'Maya', 'Leo', 'Priya', 'Sam', 'Noah', 'Zara', 'Kofi', 'Ines', 'Theo', 'Lena', 'Omar', 'Ivy'];

export function fixturePosts(base, n = 16) {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    event_id: SLUG,
    session_id: `s${i % 7}`,
    guest_name: NAMES[i % NAMES.length],
    image_url: `${base}/src/assets/landing/${PHOTOS[i % PHOTOS.length]}`,
    media_type: 'image',
    message: i % 4 === 0 ? 'Best night ever' : null,
    challenge_id: null,
    points: 10,
    approved: true,
    hidden: false,
    created_at: new Date(now - i * 90_000).toISOString(),
  }));
}

export function fixtureEvent(config = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: SLUG,
    name: "Sam's 30th",
    event_type: 'birthday',
    status: 'live',
    plan_tier: 'pro',
    config: { look: 'beamwall', copy: { fullName: "Sam's 30th", eventName: "Sam's 30th", tagline: 'Thirty, flirty and thriving.' }, ...config },
  };
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
}

/** Install REST + realtime mocks on a page. `fixture` = { config, wall, posts, challenges, branding }. */
export async function installGuestMocks(page, { base, config = {}, wall = {}, posts = 16, challenges = [], branding = null } = {}) {
  const event = fixtureEvent(config);
  const postRows = Array.isArray(posts) ? posts : fixturePosts(base, posts);
  const settings = { wall: { showQR: true, showLeaderboard: true, showChallenges: true, featuredSpotlight: false, ...wall } };
  if (branding) settings.branding = branding;

  await page.route(`https://${MOCK_HOST}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    const url = new URL(req.url());
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const p = url.pathname;
    if (p.startsWith('/auth/')) return json(route, {});
    if (p.startsWith('/functions/')) return json(route, {});
    if (p.startsWith('/storage/')) return route.fulfill({ status: 404, body: '' });
    const m = /^\/rest\/v1\/(rpc\/)?([^/?]+)/.exec(p);
    if (!m) return json(route, []);
    const [, rpc, name] = m;
    if (rpc) return json(route, name.includes('feature') ? {} : null);
    let rows = [];
    if (name === 'events') rows = [event];
    else if (name === 'posts') rows = req.method() === 'GET' ? postRows : [];
    else if (name === 'challenges') rows = challenges;
    else if (name === 'app_settings') {
      const key = url.searchParams.get('key')?.replace(/^eq\./, '');
      rows = key && settings[key] ? [{ key, value: settings[key], event_id: SLUG }] : [];
    }
    if (single) return rows.length ? json(route, rows[0]) : json(route, null, 406);
    return json(route, rows);
  });

  // Realtime: acknowledge every join so the wall shows LIVE, never "Reconnecting".
  await page.routeWebSocket(new RegExp(`wss://${MOCK_HOST.replace(/\./g, '\\.')}/.*`), (ws) => {
    ws.onMessage((raw) => {
      let parsed;
      try { parsed = JSON.parse(String(raw)); } catch { return; }
      // realtime-js >= 2.10x speaks protocol vsn 2.0.0: every frame is the
      // array [join_ref, ref, topic, event, payload]. Older clients sent an
      // object. Read either, and answer in the shape we were spoken to.
      const isArray = Array.isArray(parsed);
      const msg = isArray
        ? { join_ref: parsed[0], ref: parsed[1], topic: parsed[2], event: parsed[3], payload: parsed[4] }
        : parsed;
      if (msg.event === 'phx_join' || msg.event === 'heartbeat' || msg.event === 'access_token') {
        const payload = { status: 'ok', response: { postgres_changes: (msg.payload?.config?.postgres_changes ?? []).map((c, i) => ({ ...c, id: i + 1 })) } };
        ws.send(JSON.stringify(isArray
          ? [msg.join_ref ?? null, msg.ref ?? null, msg.topic, 'phx_reply', payload]
          : { topic: msg.topic, event: 'phx_reply', ref: msg.ref, payload }));
      }
    });
  });
  return { event, posts: postRows };
}

export const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
];

export async function launch() {
  return chromium.launch({
    executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'],
  });
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [base = 'http://localhost:5181', out = 'scratch-shots/mock', ...routes] = process.argv.slice(2);
  const fixture = process.env.FIXTURE ? JSON.parse(process.env.FIXTURE) : {};
  mkdirSync(out, { recursive: true });
  const browser = await launch();
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, permissions: ['camera'], deviceScaleFactor: 1 });
    for (const r of routes.length ? routes : [`/e/${SLUG}/welcome`, `/e/${SLUG}/wall`]) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await installGuestMocks(page, { base, ...fixture });
      await page.goto(base + r, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(Number(process.env.SETTLE ?? 3500));
      const file = `${out}/${r.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-${vp.name}.png`;
      await page.screenshot({ path: file });
      console.log(file, errors.length ? `pageerrors: ${errors.join(' | ')}` : 'ok');
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
}
