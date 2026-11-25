#!/usr/bin/env node
/**
 * Rasterises the animated-Frame layers drawn by art.py into transparent
 * 1080x1920 WebP files under public/library/motion/<frame>/<layer>.webp, plus a
 * 360x640 thumbnail per frame (every layer at rest over a soft backdrop).
 *
 * The SVGs are rendered INLINE in a page (not as <img>), because an SVG image
 * cannot load web fonts — the lettering would silently fall back to a system
 * face. Fonts come from public/fonts through a routed fake origin.
 *
 *   python3 scripts/motion-frames/art.py && node scripts/motion-frames/render.mjs
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const svgRoot = join(here, 'svg');
const outRoot = join(root, 'public', 'library', 'motion');
const ORIGIN = 'http://motion.local';

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.route(`${ORIGIN}/**`, async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/render.html') {
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:transparent"></body></html>' });
  }
  const file = join(root, 'public', path);
  if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
  const type = extname(file) === '.woff2' ? 'font/woff2' : 'application/octet-stream';
  return route.fulfill({ contentType: type, body: readFileSync(file) });
});
await page.goto(`${ORIGIN}/render.html`);
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));

for (const frame of readdirSync(svgRoot)) {
  const dir = join(svgRoot, frame);
  const out = join(outRoot, frame);
  mkdirSync(out, { recursive: true });
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg')).sort()) {
    const svg = readFileSync(join(dir, file), 'utf8');
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(60);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
    const name = file.replace(/\.svg$/, '');
    const webp = await sharp(png).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toBuffer();
    writeFileSync(join(out, `${name}.webp`), webp);
    console.log(frame, name, `${Math.round(webp.length / 1024)} KB`);
  }
  // Every layer at rest, in the manifest's draw order: `flat.webp` is the
  // row's top-level asset_url (what layer-unaware renderers and thumbnails
  // see), and `thumb.webp` is a square tile showing the whole frame as a mini
  // card over a soft backdrop (a circle crop of the raw frame is all empty
  // middle, since the art keeps clear of the face).
  const order = (manifest[frame]?.layers ?? []).map((l) => join(out, `${l.file}.webp`));
  const flat = await sharp({ create: { width: 1080, height: 1920, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(order.map((input) => ({ input }))).png().toBuffer();
  writeFileSync(join(out, 'flat.webp'), await sharp(flat).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toBuffer());
  const cardH = 352;
  const cardW = Math.round(cardH * 1080 / 1920);
  const photo = await sharp({ create: { width: 1080, height: 1920, channels: 4, background: { r: 92, g: 78, b: 120, alpha: 1 } } })
    .composite([{ input: flat }]).png().toBuffer()
    .then((b) => sharp(b).resize(cardW, cardH).png().toBuffer());
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><radialGradient id="g" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="#4a3f6b"/><stop offset="1" stop-color="#191428"/></radialGradient></defs><rect width="400" height="400" fill="url(#g)"/></svg>`);
  const visible = await sharp(photo).extract({ left: 0, top: 0, width: cardW, height: cardH }).toBuffer();
  const thumb = await sharp(bg).composite([{ input: visible, left: Math.round((400 - cardW) / 2), top: 24 }])
    .webp({ quality: 84 }).toBuffer();
  writeFileSync(join(out, 'thumb.webp'), thumb);
}
await browser.close();
