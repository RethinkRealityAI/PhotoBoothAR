/**
 * render-qr-card-art.mjs — rasterises the hand-built scenes that only the QR
 * card templates use (scripts/qr-card-art/<id>.mjs) to
 * public/qr-cards/art/<id>.webp, at print resolution: 1350x2400, enough for a
 * full-bleed A5 at 300 dpi. Every other template reuses the card design art
 * (public/email/designs/v2/<id>/field.jpg), so this list stays short.
 *
 *   node scripts/render-qr-card-art.mjs             # every scene
 *   node scripts/render-qr-card-art.mjs pumpkin-moon
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'scripts/qr-card-art');
const OUT = join(ROOT, 'public/qr-cards/art');
const OW = 1350;
const OH = 2400;

async function render(id) {
  const mod = await import(pathToFileURL(join(SRC, `${id}.mjs`)).href);
  mkdirSync(OUT, { recursive: true });
  // Density 144 renders the 900x1600 stage at 1350x2400 natively (no upscale).
  await sharp(Buffer.from(mod.back()), { density: 144 })
    .resize(OW, OH, { fit: 'cover' })
    .webp({ quality: 86 })
    .toFile(join(OUT, `${id}.webp`));
  console.log('rendered', id);
}

const only = process.argv.slice(2);
const ids = only.length ? only : readdirSync(SRC).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''));
for (const id of ids) await render(id);
