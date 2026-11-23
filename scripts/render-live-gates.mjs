/**
 * render-live-gates.mjs — writes the still files of the designs whose gate
 * is drawn live in the app (src/lib/liveGates.ts): gate.webp (the gate at
 * rest, for the film intro and any place that shows a picture) and
 * thumb.webp (the scene with the gate's edges either side, like every other
 * design's tile). Run it after render-vector-art for a vector design.
 *
 *   node scripts/render-live-gates.mjs              # every live design
 *   node scripts/render-live-gates.mjs showtime
 *
 * The gate comes from the same pure functions the app animates, bundled with
 * esbuild, so the still and the live gate can never drift apart.
 */
import { buildSync } from 'esbuild';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = (entry) =>
  buildSync({ entryPoints: [join(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', write: false }).outputFiles[0].text;
const load = async (entry) => import(`data:text/javascript;base64,${Buffer.from(bundle(entry)).toString('base64')}`);
const designs = await load('src/lib/cardDesigns.ts');
const live = await load('src/lib/liveGates.ts');

const SW = 722;
const SH = 1294;
const only = process.argv.slice(2);

for (const d of designs.CARD_DESIGNS) {
  if (!d.live || (only.length && !only.includes(d.id))) continue;
  const dir = join(ROOT, 'public/card-designs', d.id);
  const gateSvg = live.liveGateSvg(d.live, 0, live.LIVE_SEED);
  const gate = sharp(Buffer.from(gateSvg), { density: 96 }).resize(SW, SH, { fit: 'cover' });
  await gate.clone().webp({ quality: 82 }).toFile(join(dir, 'gate.webp'));
  const backPng = await sharp(join(dir, 'back.webp')).resize(240, 400, { fit: 'cover' }).png().toBuffer();
  const gatePng = await gate.clone().resize(240, 400, { fit: 'cover' }).png().toBuffer();
  const left = await sharp(gatePng).extract({ left: 0, top: 0, width: 60, height: 400 }).toBuffer();
  const right = await sharp(gatePng).extract({ left: 180, top: 0, width: 60, height: 400 }).toBuffer();
  await sharp(backPng)
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 180, top: 0 }])
    .webp({ quality: 82 })
    .toFile(join(dir, 'thumb.webp'));
  console.log('live gate', d.id, d.live);
}
