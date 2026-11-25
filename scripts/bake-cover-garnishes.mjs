#!/usr/bin/env node
/**
 * Bakes the magazine-cover garnish models (flowers, balloons, stars…) from raw
 * Meshy GLBs into the small, centred files the AR cover loads
 * (public/models/garnish/<id>.glb).
 *
 *   node scripts/bake-cover-garnishes.mjs <dir with raw <id>.glb files>
 *
 * Per file: bake node transforms into the vertices (Meshy files carry a node
 * rotation), dedup/prune/weld, simplify above the triangle budget, textures to
 * WebP at 1024 px (sharp), then recentre so the bounding-box CENTRE is the
 * origin and scale so the LONGEST side is 1 unit. The cover places each one by
 * its centre and sizes it in metres (lib/cover/garnishes.ts), so the raw
 * model's own units never matter. Meshopt-compressed: glbCache already
 * registers the decoder.
 */
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, meshopt, prune, simplify, textureCompress, weld, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'models', 'garnish');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: bake-cover-garnishes.mjs <raw dir>'); process.exit(1); }

const TRI_BUDGET = 14000;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(OUT, { recursive: true });

function triCount(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.glb')).sort()) {
  const id = basename(file, '.glb');
  const doc = await io.read(join(SRC, file));
  await doc.transform(flatten(), dedup(), prune(), weld());
  // Bake every node's world matrix into its mesh, then reset the node.
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const nrm = prim.getAttribute('NORMAL');
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        pos.setElement(i, [
          m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
        ]);
        if (nrm) {
          nrm.getElement(i, v);
          const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
          const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
          const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
          const l = Math.hypot(x, y, z) || 1;
          nrm.setElement(i, [x / l, y / l, z / l]);
        }
      }
    }
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
  for (const node of doc.getRoot().listNodes()) node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const before = triCount(doc);
  if (before > TRI_BUDGET) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: TRI_BUDGET / before, error: 0.002 }));
  }
  // Recentre on the bounding-box centre, longest side = 1.
  const b = getBounds(scene);
  const c = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
  const size = Math.max(...[0, 1, 2].map((k) => b.max[k] - b.min[k])) || 1;
  const done = new Set();
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (done.has(pos)) continue;
    done.add(pos);
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      pos.setElement(i, [(v[0] - c[0]) / size, (v[1] - c[1]) / size, (v[2] - c[2]) / size]);
    }
  }
  const nb = getBounds(scene);
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = join(OUT, `${id}.glb`);
  await io.write(out, doc);
  const dims = [0, 1, 2].map((k) => +(nb.max[k] - nb.min[k]).toFixed(3));
  console.log(`${id}: ${Math.round(before)} → ${Math.round(triCount(doc))} tris, box ${dims.join('×')}, ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
