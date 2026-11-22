/**
 * render-vector-art.mjs — rasterises the hand-built (vector) card design
 * scenes in scripts/vector-art/<id>.mjs into the same files every other
 * design ships: public/card-designs/<id>/{gate,back,mid,thumb}.webp.
 *
 * So a vector design flows through the card, the film intro and the email
 * exactly like a painted one; its source stays editable code.
 *
 *   node scripts/render-vector-art.mjs            # every vector design
 *   node scripts/render-vector-art.mjs jungle-party
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'scripts/vector-art');
const OUT = join(ROOT, 'public/card-designs');
// Same pixel size as the painted designs.
const SW = 722;
const SH = 1294;

async function render(id) {
  const mod = await import(pathToFileURL(join(SRC, `${id}.mjs`)).href);
  const dir = join(OUT, id);
  mkdirSync(dir, { recursive: true });
  const full = (s) => sharp(Buffer.from(s), { density: 96 }).resize(SW, SH, { fit: 'cover' });
  await full(mod.back()).webp({ quality: 82 }).toFile(join(dir, 'back.webp'));
  await full(mod.gate()).webp({ quality: 82 }).toFile(join(dir, 'gate.webp'));
  await sharp(Buffer.from(mod.mid()), { density: 96 }).resize(540).webp({ quality: 84, alphaQuality: 90 }).toFile(join(dir, 'mid.webp'));
  // Thumb: the scene with the gateway's edges either side, as for the painted designs.
  const backPng = await full(mod.back()).resize(240, 400, { fit: 'cover' }).png().toBuffer();
  const gatePng = await full(mod.gate()).resize(240, 400, { fit: 'cover' }).png().toBuffer();
  const left = await sharp(gatePng).extract({ left: 0, top: 0, width: 60, height: 400 }).toBuffer();
  const right = await sharp(gatePng).extract({ left: 180, top: 0, width: 60, height: 400 }).toBuffer();
  await sharp(backPng)
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 180, top: 0 }])
    .webp({ quality: 82 })
    .toFile(join(dir, 'thumb.webp'));
  console.log('rendered', id);
}

const only = process.argv.slice(2);
const ids = only.length
  ? only
  : readdirSync(SRC).filter((f) => f.endsWith('.mjs') && f !== 'paper.mjs').map((f) => f.replace(/\.mjs$/, ''));
for (const id of ids) await render(id);
