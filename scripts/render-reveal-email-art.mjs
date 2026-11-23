#!/usr/bin/env node
/**
 * render-reveal-email-art.mjs — the art for Beamwall's marketing reveal emails
 * (src/lib/reveals/revealEmail.ts), written to public/email/reveals/<VERSION>/
 * and served by the site at https://beamwall.app/email/reveals/<VERSION>/….
 *
 *   node scripts/render-reveal-email-art.mjs --buttons
 *       button-<theme>.gif: the glowing ring + bloom + orbiting spark round a
 *       solid white pill, painted by scripts/email-art/painter.js (the keepsake
 *       button, themed through its optional panel/stops arguments)
 *
 *   node scripts/render-reveal-email-art.mjs --heroes --base=http://localhost:5191
 *       hero-<unlock>-<theme>.jpg: Beamy guarding the sealed surprise, a still
 *       of the real page (/reveal/demo/…?poster=1) — so the email shows exactly
 *       what the reader is about to unlock. Needs a running dev server.
 *
 * VERSIONED: mail proxies cache image URLs for years and sent mail keeps
 * pointing at them. Never repaint in place: bump VERSION here AND
 * REVEAL_ART_VERSION in src/lib/reveals/revealEmail.ts.
 *
 * Email-safe formats only (no WebP/SVG); everything @2x; each file ≤150 KB.
 * DEPENDENCIES: playwright + Chromium (CHROMIUM_PATH, default
 * /opt/pw-browsers/chromium) and sharp; nothing new.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'email', 'reveals', VERSION);
const PAINTER = join(ROOT, 'scripts', 'email-art', 'painter.js');
const FONT = join(ROOT, 'public', 'fonts', 'bricolage-grotesque-var-latin.woff2');
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const MAX_FILE = 150 * 1024;

/** MIRROR of THEME_PALETTES' panel/accent/core in src/lib/reveals/revealModel.ts
 *  (a .mjs script cannot import the .ts). revealArt.test.ts pins the two. */
export const THEMES = {
  periwinkle: { panel: '#17165A', accent: '#D4D6FF', core: '#FFC46B' },
  midnight: { panel: '#0E1330', accent: '#8EA2FF', core: '#E8ECFF' },
  sunrise: { panel: '#3A1430', accent: '#FFB38A', core: '#FFE1A8' },
  mint: { panel: '#0A2E29', accent: '#7FF0C8', core: '#F4FFB8' },
  gold: { panel: '#2B1F0A', accent: '#FFD36B', core: '#FFF2C8' },
  frost: { panel: '#0F2A47', accent: '#BFE6FF', core: '#FFFFFF' },
};
export const UNLOCKS = ['blast', 'melt', 'shine', 'tap', 'turn', 'trace', 'rub'];
/** @2x sizes of REVEAL_ART in revealEmail.ts. */
const BUTTON = { width: 760, height: 184 };
const HERO = { width: 1120, height: 672 };

const args = process.argv.slice(2);
const want = (f) => args.includes(f);
const base = (args.find((a) => a.startsWith('--base=')) ?? '--base=http://localhost:5191').slice(7);
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
if (!want('--buttons') && !want('--heroes')) {
  console.error('usage: render-reveal-email-art.mjs --buttons | --heroes [--base=URL] [--only=unlock-theme,…]');
  process.exit(2);
}

const browser = await chromium.launch({
  ...(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}),
  args: ['--no-sandbox', '--no-proxy-server', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
mkdirSync(OUT, { recursive: true });
const written = [];
const save = (name, buf) => {
  writeFileSync(join(OUT, name), buf);
  written.push(name);
};

try {
  if (want('--buttons')) {
    const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    await page.addScriptTag({ content: readFileSync(PAINTER, 'utf8') });
    await page.evaluate((b64) => window.EmailArt.loadFont(b64), readFileSync(FONT).toString('base64'));
    for (const [id, t] of Object.entries(THEMES)) {
      // The ring runs white → the theme's accent → white → its warm core → accent → white.
      const stops = [[0, '#FFFFFF'], [0.25, t.accent], [0.4, '#FFFFFF'], [0.55, t.core], [0.75, t.accent], [1, '#FFFFFF']];
      const asset = await page.evaluate(
        (a) => window.EmailArt.button(a),
        { frames: 24, ...BUTTON, panel: t.panel, pill: '#FFFFFF', stops },
      );
      const n = asset.frames.length;
      const strip = Buffer.concat(asset.frames.map((f) => Buffer.from(f, 'base64')));
      save(`button-${id}.gif`, await sharp(strip, { raw: { width: asset.width, height: asset.height * n, channels: 4, pageHeight: asset.height } })
        .gif({ colours: 128, dither: 0.4, effort: 10, interFrameMaxError: 6, interPaletteMaxError: 6, delay: 70, loop: 0 })
        .toBuffer());
    }
    if (errors.length > 0) throw new Error(`painter errors:\n${errors.join('\n')}`);
  }

  if (want('--heroes')) {
    const page = await browser.newPage({ viewport: { width: HERO.width / 2, height: HERO.height / 2 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const unlock of UNLOCKS) {
      for (const theme of Object.keys(THEMES)) {
        const key = `${unlock}-${theme}`;
        if (only.length > 0 && !only.includes(key)) continue;
        await page.goto(`${base}/reveal/demo/feature-drop?poster=1&unlock=${unlock}&theme=${theme}`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.documentElement.dataset.revealReady === '1', null, { timeout: 60_000 });
        await page.waitForTimeout(400); // let Beamy settle into Idle
        const png = await page.screenshot({ type: 'png' });
        save(`hero-${key}.jpg`, await sharp(png).resize(HERO.width, HERO.height, { fit: 'cover' })
          .jpeg({ quality: 78, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer());
        console.log(`hero-${key}.jpg`);
      }
    }
    if (errors.length > 0) throw new Error(`page errors:\n${errors.join('\n')}`);
  }
} finally {
  await browser.close();
}

let over = false;
let total = 0;
for (const name of written) {
  const size = statSync(join(OUT, name)).size;
  total += size;
  if (size > MAX_FILE) {
    over = true;
    console.error(`${name} is ${(size / 1024).toFixed(1)} KB (over 150 KB)`);
  }
}
console.log(`wrote ${written.length} files, ${(total / 1024).toFixed(1)} KB`);
if (over) process.exit(1);
