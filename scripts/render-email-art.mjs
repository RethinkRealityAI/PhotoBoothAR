#!/usr/bin/env node
/**
 * render-email-art.mjs — paints the keepsake-email artwork and writes it to
 * public/email/<VERSION>/, where Netlify serves it at
 * https://beamwall.app/email/<VERSION>/… (the card-publish edge function points
 * every <img> there through EMAIL_ASSET_BASE).
 *
 *   node scripts/render-email-art.mjs            # write all assets
 *   node scripts/render-email-art.mjs --only=seal-A,frame-top
 *
 * WHY RENDERED ART: email clients strip CSS gradients, filters, shadows and
 * every animation except an animated GIF, so the only way an inbox shows real
 * paper, wax and a shimmering rim is as images. Everything here is painted
 * procedurally by scripts/email-art/painter.js inside headless Chromium
 * (canvas 2D; the envelope and wax are lit height maps), returned to Node as
 * raw RGBA, and encoded with sharp.
 *
 * DETERMINISTIC: no Math.random and no network — every random choice comes from
 * a seeded PRNG, the only font is the self-hosted Bricolage Grotesque under
 * public/fonts/, so a re-run reproduces the same pixels (encoder output may
 * differ by a byte between sharp/libvips versions; the art does not).
 *
 * VERSIONED PATHS: inbox images are cached for years by mail proxies (Gmail's
 * image proxy among them) and an already-sent email keeps pointing at its URL.
 * Never repaint in place — bump VERSION (and EMAIL_ART_VERSION in
 * supabase/functions/card-publish/email.ts) so old mail keeps its old art.
 *
 * FORMATS (email-safe only — no WebP, no SVG):
 *   JPG  field, envelope top/bottom, and one full-width seal BAND per letter
 *        (A-Z + star) that sits between them (opaque, photographic)
 *   GIF  frame-top / frame-bottom / button (animated; FRAME 0 IS THE STILL —
 *        Outlook desktop shows only frame 0, so it must look finished alone;
 *        GIF transparency is 1-bit, so the painter thresholds alpha)
 *   PNG  divider (palette)
 *   Everything is @2x: the email sets width/height to half the pixel size.
 *
 * BUDGET: each file ≤ 150 KB, the whole set ≤ 1.5 MB — the run FAILS (exit 1)
 * past either, because a heavy email is clipped by Gmail at 102 KB of HTML and
 * slow on venue wifi; images do not count toward the clip but do toward load.
 *
 * DEPENDENCIES: playwright (devDependency) + its Chromium (CHROMIUM_PATH, default
 * /opt/pw-browsers/chromium, else Playwright's own), and sharp, which is
 * already installed transitively (via @gltf-transform/functions); no new
 * package was added for this script.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = 'v1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'email', VERSION);
const PAINTER = join(ROOT, 'scripts', 'email-art', 'painter.js');
const FONT = join(ROOT, 'public', 'fonts', 'bricolage-grotesque-var-latin.woff2');
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const MAX_FILE = 150 * 1024;
const MAX_TOTAL = 1536 * 1024;

/**
 * Where frame-top.gif's last row meets the email's CSS side borders: the
 * outer rim (3px @1x), the panel, the inner hairline (1px, 10px in). MIRROR of
 * EMAIL_ART_SEAM in supabase/functions/card-publish/email.ts (pinned by
 * src/lib/cardEmail.test.ts). Re-measured after every cap render below — a
 * repaint that moves these colours fails the run instead of opening a seam.
 */
export const SEAM = { panel: '#232167', rim: '#DADCFD', inner: '#645F93' };
const SEAM_TOLERANCE = 12; // per channel: GIF palette + dither noise

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter((s) => s !== '');
const wanted = (name) => only.length === 0 || only.includes(name);

function rgba(asset, i = 0) {
  return Buffer.from(asset.frames[i], 'base64');
}
function raw(asset, i = 0) {
  return sharp(rgba(asset, i), { raw: { width: asset.width, height: asset.height, channels: 4 } });
}
const jpg = (asset, quality = 80) =>
  raw(asset).flatten({ background: '#232167' }).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
const png = (asset) => raw(asset).png({ palette: true, colours: 128, effort: 10, compressionLevel: 9 }).toBuffer();
async function gif(asset, { delay = 70, colours = 96 } = {}) {
  const n = asset.frames.length;
  const strip = Buffer.concat(asset.frames.map((_, i) => rgba(asset, i)));
  return sharp(strip, { raw: { width: asset.width, height: asset.height * n, channels: 4, pageHeight: asset.height } })
    .gif({ colours, dither: 0.4, effort: 10, interFrameMaxError: 6, interPaletteMaxError: 6, delay, loop: 0 })
    .toBuffer();
}

const browser = await chromium.launch({
  ...(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}),
  args: ['--no-sandbox', '--no-proxy-server'],
});
const written = [];
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  await page.addScriptTag({ content: readFileSync(PAINTER, 'utf8') });
  await page.evaluate((b64) => window.EmailArt.loadFont(b64), readFileSync(FONT).toString('base64'));
  const paint = (fn, arg) => page.evaluate(([f, a]) => window.EmailArt[f](a), [fn, arg ?? {}]);

  mkdirSync(OUT, { recursive: true });
  const save = (name, buf) => {
    writeFileSync(join(OUT, name), buf);
    written.push(name);
  };

  if (wanted('field')) save('field.jpg', await jpg(await paint('field'), 74));
  if (wanted('envelope')) {
    const env = await paint('envelopeSlices');
    for (const part of ['top', 'bottom']) save(`envelope-${part}.jpg`, await jpg(env[part], 82));
  }
  for (const [k, L] of [...LETTERS, 'star'].entries()) {
    if (!wanted(`seal-${L}`) && !wanted('seal')) continue;
    const letter = L === 'star' ? '✦' : L;
    save(`seal-${L}.jpg`, await jpg(await paint('seal', { letter, seed: 7 + k * 13 }), 76));
  }
  if (wanted('frame-top')) save('frame-top.gif', await gif(await paint('cap', { which: 'top', frames: 28 }), { colours: 128 }));
  if (wanted('frame-bottom')) save('frame-bottom.gif', await gif(await paint('cap', { which: 'bottom', frames: 28 }), { colours: 128 }));
  if (wanted('button')) save('button.gif', await gif(await paint('button', { frames: 24 }), { colours: 128 }));
  if (wanted('divider')) save('divider.png', await png(await paint('divider')));
  if (errors.length > 0) throw new Error(`painter errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
}

if (written.includes('frame-top.gif')) {
  const { data, info } = await sharp(join(OUT, 'frame-top.gif'), { page: 0 }).raw().toBuffer({ resolveWithObject: true });
  const y = info.height - 1;
  const at = (x) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  const want = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  for (const [name, x] of [['rim', 2], ['panel', 10], ['inner', 20], ['panel', 600], ['rim', info.width - 3]]) {
    const got = at(x);
    const dev = Math.max(...got.map((v, i) => Math.abs(v - want(SEAM[name])[i])));
    if (dev > SEAM_TOLERANCE) {
      console.error(`render-email-art: frame-top.gif seam ${name}@x=${x} is rgb(${got}) — expected ${SEAM[name]} (update SEAM + EMAIL_ART_SEAM together)`);
      process.exitCode = 1;
    }
  }
}

let total = 0;
let over = false;
for (const name of written) {
  const size = statSync(join(OUT, name)).size;
  const meta = await sharp(join(OUT, name), { animated: true }).metadata();
  total += size;
  const flag = size > MAX_FILE ? '  << OVER 150KB' : '';
  if (size > MAX_FILE) over = true;
  const frames = (meta.pages ?? 1) > 1 ? ` ×${meta.pages}f` : '';
  console.log(`${name.padEnd(22)} ${String(meta.width).padStart(5)}×${String(meta.pageHeight ?? meta.height).padEnd(5)}${frames.padEnd(6)} ${(size / 1024).toFixed(1).padStart(7)} KB${flag}`);
}
if (only.length === 0) {
  console.log(`TOTAL ${(total / 1024).toFixed(1)} KB across ${written.length} files (budget ${MAX_TOTAL / 1024} KB)`);
  if (total > MAX_TOTAL) over = true;
}
if (over) {
  console.error('render-email-art: budget exceeded');
  process.exit(1);
}
