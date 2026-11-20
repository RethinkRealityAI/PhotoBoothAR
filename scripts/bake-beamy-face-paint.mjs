/**
 * Bake one of the platform's Living Face Paint designs (src/lib/facePaint)
 * onto Beamy's face, as a GLB the homepage's AR step wears like any prop
 * (public/models/props/beamy-face-paint.glb).
 *
 * Why a bake: on a guest the paint is a texture on the tracked face mesh;
 * Beamy has no face mesh, so the SAME painter (paintFacePaint, the same
 * design and default colours the booth uses) paints the texture, and it is
 * laid on a thin shell that follows his measured front skin
 * (scripts/beamy-surface.mjs). The face-paint frame is placed by his eyes:
 * the design's eye centres land on his lids' centres, at their spacing.
 * The shell is in his body bone's space, so its fit is exact (scale 1).
 *
 * Run: node scripts/bake-beamy-face-paint.mjs [design]   (default butterfly)
 * Needs Playwright's Chromium to paint (set CHROMIUM=<path> to pick one).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { Document, NodeIO } from '@gltf-transform/core';
import { BODY_BONE_Y, EYE, beamyFrontSurface } from './beamy-surface.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = process.argv[2] ?? 'butterfly';
const OUT = process.env.OUT ?? join(root, 'public', 'models', 'props', 'beamy-face-paint.glb');

/** The shell's extent on him (model space, metres) and how far it floats off his skin.
 *  It reaches up his head so the design is cut by his own silhouette, never by a straight edge. */
const X = 0.27, Y0 = 0.19, Y1 = 0.56, LIFT = 0.004;
const COLS = 55, ROWS = 38;
/** Paint goes on skin only: his eyes stay clear (holes a little larger than his lids,
 *  half-size 0.070 x 0.069) and nothing is painted off his silhouette. Soft edge, metres. */
const EYE_HOLE = { rx: 0.076, ry: 0.075 }, SOFT = 0.006;
/** Texture width (px); height follows the shell's aspect. */
const TEX_W = 1024;
/** The square the painter paints the whole face into. */
const PAINT = 2048;

// 1. Paint the design with the platform's own painter, in Chromium.
const bundle = await build({
  stdin: {
    contents: `
      import { paintFacePaint } from './src/lib/facePaint/painter';
      import { faceFrameFromUvs } from './src/lib/facePaint/features';
      import { STANDARD_FACE_UVS } from './src/lib/facePaint/faceTopology';
      import { FACE_PAINT_DESIGN_MAP, defaultColorsFor } from './src/lib/facePaint/designs';
      import { FACE_PAINT_OPACITY } from './src/lib/facePaint/spec';
      window.bake = (design, size, crop) => {
        if (FACE_PAINT_DESIGN_MAP[design] === undefined) throw new Error('unknown design ' + design);
        const f = faceFrameFromUvs(STANDARD_FACE_UVS, size);
        const c = document.createElement('canvas'); c.width = c.height = size;
        paintFacePaint(c.getContext('2d'), f, { design, colors: defaultColorsFor(design), opacity: FACE_PAINT_OPACITY.default });
        const eyes = { l: { x: (f.eyeOuterL.x + f.eyeInnerL.x) / 2, y: (f.eyeOuterL.y + f.eyeInnerL.y) / 2 }, r: { x: (f.eyeOuterR.x + f.eyeInnerR.x) / 2, y: (f.eyeOuterR.y + f.eyeInnerR.y) / 2 } };
        if (crop === null) return { eyes };
        const o = document.createElement('canvas'); o.width = crop.w; o.height = crop.h;
        const ctx = o.getContext('2d');
        ctx.drawImage(c, crop.x, crop.y, crop.sw, crop.sh, 0, 0, crop.w, crop.h);
        // Skin only: his silhouette (a coarse mask, smoothed as it scales up) keeps the paint...
        const m = document.createElement('canvas'); m.width = crop.mask.w; m.height = crop.mask.h;
        const md = m.getContext('2d').createImageData(crop.mask.w, crop.mask.h);
        crop.mask.a.forEach((v, i) => { md.data[i * 4 + 3] = v; });
        m.getContext('2d').putImageData(md, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(m, 0, 0, crop.w, crop.h);
        // ...and his eyes are left clear.
        ctx.globalCompositeOperation = 'destination-out';
        for (const h of crop.holes) {
          ctx.save(); ctx.translate(h.cx, h.cy); ctx.scale(1, h.ry / h.rx);
          const g = ctx.createRadialGradient(0, 0, Math.max(0, h.rx - h.soft), 0, 0, h.rx + h.soft);
          g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, h.rx + h.soft, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
        return { eyes, png: o.toDataURL('image/png') };
      };`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  logLevel: 'error',
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-proxy-server'] });
let png, metresPerPx;
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  // Where the design's eyes are, then the crop that puts them on his.
  const { eyes } = await page.evaluate(([d, s]) => window.bake(d, s, null), [DESIGN, PAINT]);
  metresPerPx = (2 * EYE.x) / (eyes.r.x - eyes.l.x);
  const midX = (eyes.l.x + eyes.r.x) / 2, midY = (eyes.l.y + eyes.r.y) / 2;
  const px = (x) => midX + x / metresPerPx;
  const py = (y) => midY - (y - EYE.y) / metresPerPx;
  const crop = { x: px(-X), y: py(Y1), sw: px(X) - px(-X), sh: py(Y0) - py(Y1), w: TEX_W, h: Math.round(TEX_W * (Y1 - Y0) / (2 * X)) };
  // The texture maps x -X..X, y Y1..Y0 linearly (the shell's grid): metres -> texture px.
  const tx = (x) => ((x + X) / (2 * X)) * crop.w, ty = (y) => ((Y1 - y) / (Y1 - Y0)) * crop.h;
  const kx = crop.w / (2 * X), ky = crop.h / (Y1 - Y0);
  crop.holes = [-EYE.x, EYE.x].map((x) => ({ cx: tx(x), cy: ty(EYE.y), rx: EYE_HOLE.rx * kx, ry: EYE_HOLE.ry * ky, soft: SOFT * kx }));
  // His silhouette from the front, every 5mm (0 = off him); the page smooths it as it scales up.
  const skin = await beamyFrontSurface(root, 0.006);
  const MW = Math.round((2 * X) / 0.005), MH = Math.round((Y1 - Y0) / 0.005);
  crop.mask = { w: MW, h: MH, a: Array.from({ length: MW * MH }, (_, k) => (skin(-X + ((k % MW) + 0.5) * 0.005, Y1 - (Math.floor(k / MW) + 0.5) * 0.005) === null ? 0 : 255)) };
  const r = await page.evaluate(([d, s, c]) => window.bake(d, s, c), [DESIGN, PAINT, crop]);
  png = Buffer.from(r.png.split(',')[1], 'base64');
} finally {
  await browser.close();
}

// 2. The shell: a grid over his face, each vertex just off his skin.
const surf = await beamyFrontSurface(root);
const zs = [];
for (let j = 0; j < ROWS; j++) {
  const y = Y1 - (j / (ROWS - 1)) * (Y1 - Y0);
  const row = [];
  for (let i = 0; i < COLS; i++) row.push(surf(-X + (i / (COLS - 1)) * 2 * X, y));
  // Off his silhouette (the top corners): carry the nearest skin outward.
  const mid = (COLS - 1) / 2;
  for (let i = Math.floor(mid); i >= 0; i--) if (row[i] === null) row[i] = row[i + 1];
  for (let i = Math.ceil(mid); i < COLS; i++) if (row[i] === null) row[i] = row[i - 1];
  if (row.some((z) => z === null)) throw new Error(`no skin on row y=${y.toFixed(3)}`);
  zs.push(row);
}
const position = [], uv = [], index = [];
for (let j = 0; j < ROWS; j++) {
  for (let i = 0; i < COLS; i++) {
    const u = i / (COLS - 1), v = j / (ROWS - 1);
    position.push(-X + u * 2 * X, Y1 - v * (Y1 - Y0) - BODY_BONE_Y, zs[j][i] + LIFT);
    uv.push(u, v);
    if (i < COLS - 1 && j < ROWS - 1) {
      const a = j * COLS + i, b = a + 1, c = a + COLS, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
}
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
g.setIndex(index);
g.computeVertexNormals();

// 3. Write it: the paint as base colour AND a soft glow (it reads on a dark page).
const doc = new Document();
const buffer = doc.createBuffer();
const tex = doc.createTexture('face-paint').setImage(png).setMimeType('image/png');
const material = doc.createMaterial(`face-paint-${DESIGN}`)
  .setBaseColorTexture(tex)
  .setEmissiveTexture(tex)
  .setEmissiveFactor([0.35, 0.35, 0.35])
  .setMetallicFactor(0)
  .setRoughnessFactor(0.55)
  .setAlphaMode('BLEND');
const acc = (name, arr, type) => doc.createAccessor(name).setType(type).setArray(arr).setBuffer(buffer);
const prim = doc.createPrimitive()
  .setAttribute('POSITION', acc('pos', new Float32Array(position), 'VEC3'))
  .setAttribute('NORMAL', acc('nrm', new Float32Array(g.attributes.normal.array), 'VEC3'))
  .setAttribute('TEXCOORD_0', acc('uv', new Float32Array(uv), 'VEC2'))
  .setIndices(acc('idx', new Uint16Array(index), 'SCALAR'))
  .setMaterial(material);
const node = doc.createNode('BeamyFacePaint').setMesh(doc.createMesh('BeamyFacePaint').addPrimitive(prim));
doc.createScene('Scene').addChild(node);
const glb = await new NodeIO().writeBinary(doc);
writeFileSync(OUT, glb);
g.computeBoundingBox();
const b = g.boundingBox;
const c = b.getCenter(new THREE.Vector3());
console.log(`[bake-beamy-face-paint] ${DESIGN}: wrote ${OUT} (${glb.byteLength} bytes, ${(metresPerPx * 1000).toFixed(3)} mm/px)`);
console.log(`  fit: { width: ${(b.max.x - b.min.x).toFixed(3)}, at: [0, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}], align: 'centre' }`);
