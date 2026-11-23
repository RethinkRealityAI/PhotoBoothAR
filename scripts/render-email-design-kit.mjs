/**
 * render-email-design-kit.mjs — paints each card design's EMAIL KIT, so the
 * inbox looks like the card itself (email-safe JPG/PNG: no WebP, no SVG):
 *
 *   field.jpg   the design's scene with its foreground cut-outs (the page)
 *   top.png     the frosted glass panel's rounded top, with the card's rim
 *   bottom.png  its rounded bottom
 *   gate.jpg    the locked gateway, with the card's paper cut-outs in its corners
 *
 *   node scripts/render-email-design-kit.mjs            # every design
 *   node scripts/render-email-design-kit.mjs deep-blue
 *
 * Writes public/email/designs/<EMAIL_KIT_VERSION>/<id>/ at 2x the size the
 * email shows them. Sizes and version come from src/lib/designPacks.ts, the
 * glass colours from the edge function's designGlass() (card-publish/email.ts)
 * and the cut-outs from the card's own DesignDecor, all bundled here with
 * esbuild, so the email, the card and this script cannot drift. Never repaint
 * a published version in place: mail proxies cache images for years.
 */
import { buildSync } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Bundle a TS/TSX entry (React kept external) and import it. */
async function load(entry, name) {
  const out = join(ROOT, 'node_modules/.cache/email-kit', `${name}.mjs`);
  buildSync({
    entryPoints: [join(ROOT, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    outfile: out,
  });
  return import(pathToFileURL(out).href);
}

const packs = await load('src/lib/designPacks.ts', 'packs');
const email = await load('supabase/functions/card-publish/email.ts', 'email');
const skinMod = await load('src/components/cards/designSkin.tsx', 'skin');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

const K = packs.EMAIL_KIT;
if (JSON.stringify({ version: packs.EMAIL_KIT_VERSION, ...K }) !== JSON.stringify(email.EMAIL_DESIGN_KIT)) {
  throw new Error('EMAIL_KIT (designPacks.ts) and EMAIL_DESIGN_KIT (card-publish/email.ts) disagree');
}
const OUT = join(ROOT, 'public/email/designs', packs.EMAIL_KIT_VERSION);

/** The card's corner cut-outs, as standalone SVGs: [top-right, bottom-left?]. */
function decorSvgs(skin) {
  const html = renderToStaticMarkup(
    createElement(skinMod.DesignSkinContext.Provider, { value: skin }, createElement(skinMod.DesignDecor)),
  );
  const inners = [...html.matchAll(/<svg[^>]*>([\s\S]*?)<\/svg>/g)].map((m) => m[1]);
  // Padded viewBox: the clusters spill past their 100x100 box (overflow visible on the card).
  return inners.map(
    (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -30 160 160">
      <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.6"/><feOffset dy="1.8" result="b"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter></defs>
      <g filter="url(#s)">${inner}</g></svg>`,
  );
}

/** The cut-outs on an image W wide: the card's clamp(5.5rem, 30%, 8.5rem) box, 6px in from the corner. */
async function withDecor(base, W, H, scale, svgs) {
  const box = Math.max(88, Math.min(136, 0.3 * (W / scale))) * scale;
  const pad = (box * 30) / 100;
  const size = Math.round(box + 2 * pad);
  const inset = 6 * scale;
  const layers = [];
  for (const [k, svg] of svgs.entries()) {
    const png = await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toBuffer();
    const left = k === 0 ? Math.round(W - inset - box - pad) : Math.round(inset - pad);
    const top = k === 0 ? Math.round(inset - pad) : Math.round(H - inset - box - pad);
    // keep inside the image: crop what spills past the edges
    const l = Math.max(0, left), t = Math.max(0, top);
    const cw = Math.min(size - (l - left), W - l), ch = Math.min(size - (t - top), H - t);
    const piece = await sharp(png).extract({ left: l - left, top: t - top, width: cw, height: ch }).toBuffer();
    layers.push({ input: piece, left: l, top: t });
  }
  return sharp(base).composite(layers);
}

/** A rounded cap of the glass panel; the seam row matches the CSS middle exactly. */
function capSvg(W, H, r, glass, accent, top) {
  const s = 2; // the rim, 1px at 1x
  const h = s / 2;
  const path = top
    ? `M${h} ${H} L${h} ${r} A${r - h} ${r - h} 0 0 1 ${r} ${h} L${W - r} ${h} A${r - h} ${r - h} 0 0 1 ${W - h} ${r} L${W - h} ${H}`
    : `M${h} 0 L${h} ${H - r} A${r - h} ${r - h} 0 0 0 ${r} ${H - h} L${W - r} ${H - h} A${r - h} ${r - h} 0 0 0 ${W - h} ${H - r} L${W - h} 0`;
  // a lighter rim where the light catches the top, the plain rim colour at the seam
  const grad = top
    ? `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.7"/><stop offset="0.55" stop-color="${accent}" stop-opacity="0.6"/><stop offset="1" stop-color="${accent}" stop-opacity="0.6"/></linearGradient>`
    : `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.6"/><stop offset="1" stop-color="${accent}" stop-opacity="0.6"/></linearGradient>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>${grad}</defs>
    <path d="${path} Z" fill="${glass.bg}" fill-opacity="${glass.alpha}"/>
    <path d="${path}" fill="none" stroke="url(#g)" stroke-width="${s}" stroke-linejoin="round"/>
  </svg>`;
}

async function render(pack) {
  const id = pack.id;
  const dir = join(ROOT, 'public/card-designs', id);
  const out = join(OUT, id);
  mkdirSync(out, { recursive: true });
  const d = email.EMAIL_DESIGNS[id];
  const svgs = decorSvgs(pack.card.skin);

  // field: the portrait scene, top-anchored, with the foreground cut-outs like the card's page
  const FW = K.fieldW * 2, FH = K.fieldH * 2;
  const meta = await sharp(join(dir, 'back.webp')).metadata();
  const bh = Math.round((meta.height * FW) / meta.width);
  let scene = await sharp(join(dir, 'back.webp')).resize({ width: FW, height: bh }).toBuffer();
  if (bh < FH) scene = await sharp(scene).resize({ width: FW, height: FH, fit: 'cover' }).toBuffer();
  else scene = await sharp(scene).extract({ left: 0, top: 0, width: FW, height: FH }).toBuffer();
  const mw = Math.round(FW * pack.core.design.mid.size);
  const midL = await sharp(join(dir, 'mid.webp')).resize({ width: mw }).png().toBuffer();
  const { height: mh } = await sharp(midL).metadata();
  const midR = await sharp(midL).flop().toBuffer();
  const my = pack.core.design.mid.placement === 'top' ? Math.round(-0.03 * FH) : FH - mh + Math.round(0.04 * mh);
  const clip = async (buf, top) => {
    const t = Math.max(0, top), b = Math.min(FH, top + mh);
    return { input: await sharp(buf).extract({ left: 0, top: t - top, width: mw, height: b - t }).toBuffer(), top: t };
  };
  const L = await clip(midL, my), R = await clip(midR, my);
  const field = await sharp(scene)
    .composite([
      { input: L.input, left: Math.round(-0.09 * FW) < 0 ? 0 : 0, top: L.top },
      { input: R.input, left: FW - mw, top: R.top },
    ])
    .modulate({ brightness: 0.9 })
    .jpeg({ quality: 62, mozjpeg: true })
    .toBuffer();
  writeFileSync(join(out, 'field.jpg'), field);

  // gate: the locked gateway at the panel's inner width, centred on the gateway, cut-outs in the corners
  const GW = (K.w - 40) * 2, GH = Math.round((K.gateH * (K.w - 40)) / K.w) * 2;
  const gm = await sharp(join(dir, 'gate.webp')).metadata();
  const gh = Math.round((gm.height * GW) / gm.width);
  const gTop = Math.max(0, Math.min(gh - GH, Math.round(gh * (760 / 1600) - GH / 2)));
  const gateBase = await sharp(join(dir, 'gate.webp')).resize({ width: GW, height: gh }).extract({ left: 0, top: gTop, width: GW, height: GH }).toBuffer();
  const gate = await (await withDecor(gateBase, GW, GH, 2, svgs)).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  writeFileSync(join(out, 'gate.jpg'), gate);

  // caps: the glass panel's rounded ends, in designGlass() colours
  const glass = { bg: d.bg, alpha: 0.82 };
  if (email.designGlass(id).fill !== email.rgba(d.bg, 0.82)) throw new Error('designGlass alpha changed: update the caps');
  const W = K.w * 2, H = K.capH * 2, r = 34 * 2;
  writeFileSync(join(out, 'top.png'), await sharp(Buffer.from(capSvg(W, H, r, glass, d.accent, true))).png({ compressionLevel: 9 }).toBuffer());
  writeFileSync(join(out, 'bottom.png'), await sharp(Buffer.from(capSvg(W, H, r, glass, d.accent, false))).png({ compressionLevel: 9 }).toBuffer());

  console.log('email kit', id, `field ${Math.round(field.length / 1024)}KB`, `gate ${Math.round(gate.length / 1024)}KB`);
}

const only = process.argv.slice(2);
for (const pack of packs.DESIGN_PACKS) {
  if (only.length && !only.includes(pack.id)) continue;
  await render(pack);
}
