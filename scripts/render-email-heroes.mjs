/**
 * render-email-heroes.mjs — paints each card design's EMAIL hero: a landscape
 * still of the design's scene, with its foreground cut-outs in the corners for
 * depth, as an email-safe JPG (no WebP, no SVG: inbox clients).
 *
 *   node scripts/render-email-heroes.mjs            # every design
 *   node scripts/render-email-heroes.mjs love-notes
 *
 * Writes public/email/designs/<EMAIL_HERO_VERSION>/<id>.jpg at 2x the size
 * the email shows it. Framing (focusY) and the version come from
 * src/lib/designPacks.ts, bundled here with esbuild so this script and the
 * app read the same numbers. Never repaint a published version in place: mail
 * proxies cache images for years. Bump EMAIL_HERO_VERSION instead.
 */
import { buildSync } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const bundle = buildSync({
  entryPoints: [join(ROOT, 'src/lib/designPacks.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
}).outputFiles[0].text;
const packs = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);

const W = packs.EMAIL_HERO_W * 2;
const H = packs.EMAIL_HERO_H * 2;
const OUT = join(ROOT, 'public/email/designs', packs.EMAIL_HERO_VERSION);
mkdirSync(OUT, { recursive: true });

async function render(pack) {
  const dir = join(ROOT, 'public/card-designs', pack.id);
  // The portrait scene, scaled to the hero's width, then a landscape window cut at focusY.
  const src = await sharp(join(dir, 'back.webp')).metadata();
  const bh = Math.round((src.height * W) / src.width);
  const top = Math.max(0, Math.min(bh - H, Math.round(bh * pack.email.focusY - H / 2)));
  const scene = await sharp(join(dir, 'back.webp')).resize({ width: W, height: bh }).extract({ left: 0, top, width: W, height: H }).toBuffer();

  // The foreground cut-outs, small, in the two corners they hang from (mirrored on the right).
  const mh = Math.round(H * 0.62);
  const left = await sharp(join(dir, 'mid.webp')).resize({ height: mh }).png().toBuffer();
  const { width: mw } = await sharp(left).metadata();
  const right = await sharp(left).flop().toBuffer();
  const y = pack.core.design.mid.placement === 'top' ? 0 : H - mh;
  const out = await sharp(scene)
    .composite([
      { input: left, left: 0, top: y },
      { input: right, left: W - mw, top: y },
    ])
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  writeFileSync(join(OUT, `${pack.id}.jpg`), out);
  console.log('email hero', pack.id, `${Math.round(out.length / 1024)}KB`);
}

const only = process.argv.slice(2);
for (const pack of packs.DESIGN_PACKS) {
  if (only.length && !only.includes(pack.id)) continue;
  await render(pack);
}
