/**
 * Bake a gold masquerade mask cut for Beamy's face, for the homepage's AR
 * step (public/models/props/beamy-masquerade.glb).
 *
 * Why a bake: every mask in the platform library is a full HUMAN face. Fitted
 * to Beamy's eye spacing (his eyes are three times a person's apart) one
 * covers most of his body, so the homepage would show a mask held in front of
 * him, not a mask he wears. This one is drawn around his own eyes: eye holes
 * a little larger than his lids, a bridge between them, swept wing tips past
 * his silhouette, laid on his measured front skin (scripts/beamy-surface.mjs).
 * Same gold as the baked Royal Crown (scripts/bake-royal-crown.mjs: metalness
 * 0.95, roughness 0.22, a faint emissive), with an amethyst and crystals.
 * Built in his body bone's space, so its fit is exact (scale 1).
 *
 * Run: node scripts/bake-beamy-masquerade.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { BODY_BONE_Y, EYE, beamyFrontSurface } from './beamy-surface.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT ?? join(root, 'public', 'models', 'props', 'beamy-masquerade.glb');

/** How far the mask's back floats off his skin, and its thickness (metres). */
const LIFT = 0.006, DEPTH = 0.007;
/** Eye holes: a little larger than his lids (half-size 0.070 x 0.069). */
const HOLE = { rx: 0.082, ry: 0.078 };

// The outline (model space, metres), right half; the left is its mirror.
// Starts at the top of the bridge and runs clockwise round the right eye.
const RIGHT = [
  ['M', 0, 0.418],
  ['Q', 0.045, 0.452, 0.105, 0.455],
  ['Q', 0.2, 0.458, 0.285, 0.505], // the wing sweeps up past his silhouette
  ['Q', 0.262, 0.42, 0.212, 0.36],
  ['Q', 0.19, 0.282, 0.118, 0.27],
  ['Q', 0.05, 0.266, 0.024, 0.312],
  ['Q', 0.012, 0.33, 0, 0.334],
];

const surf = await beamyFrontSurface(root, 0.025);
/** Skin z at (x, y); off his silhouette, the skin nearest the centre line. */
const rawSkin = (x, y) => {
  for (let k = 0; k <= 40; k++) {
    const z = surf(x * (1 - k * 0.025), y);
    if (z !== null) return z;
  }
  throw new Error(`no skin near (${x.toFixed(3)}, ${y.toFixed(3)})`);
};
/** …averaged over a 5x5 patch 4cm across, so the gold does not pick up the sampler's 1cm steps. */
const skin = (x, y) => {
  let sum = 0;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) sum += rawSkin(x + i * 0.01, y + j * 0.01);
  return sum / 25;
};

// 1. The flat mask: outline with two eye holes, extruded, then tessellated so
//    it can bend onto his round face without chords cutting into him.
const shape = new THREE.Shape();
const pt = (x, y, side) => [side * x, y];
const trace = (side) => {
  const seq = side === 1 ? RIGHT : [...RIGHT].reverse();
  if (side === 1) {
    for (const s of seq) {
      if (s[0] === 'M') shape.moveTo(...pt(s[1], s[2], 1));
      else shape.quadraticCurveTo(...pt(s[1], s[2], 1), ...pt(s[3], s[4], 1));
    }
    return;
  }
  // The left half: the same curves mirrored, walked back from the bottom of the bridge.
  for (let k = RIGHT.length - 1; k >= 1; k--) {
    const s = RIGHT[k], prev = RIGHT[k - 1];
    const end = prev[0] === 'M' ? [prev[1], prev[2]] : [prev[3], prev[4]];
    shape.quadraticCurveTo(...pt(s[1], s[2], -1), ...pt(end[0], end[1], -1));
  }
};
trace(1);
trace(-1);
for (const side of [1, -1]) {
  const h = new THREE.Path();
  h.absellipse(side * EYE.x, EYE.y, HOLE.rx, HOLE.ry, 0, Math.PI * 2, true);
  shape.holes.push(h);
}
let mask = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, curveSegments: 28, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.0025, bevelSegments: 2 });
mask = new TessellateModifier(0.012, 8).modify(mask);
mask.deleteAttribute('normal');
mask.deleteAttribute('uv');
mask = mergeVertices(mask, 1e-5);
const p = mask.attributes.position;
for (let i = 0; i < p.count; i++) {
  const x = p.getX(i), y = p.getY(i);
  p.setXYZ(i, x, y - BODY_BONE_Y, skin(x, y) + LIFT + p.getZ(i));
}
mask.computeVertexNormals();

// 2. The jewels: an amethyst over the bridge, crystals along each wing.
const onSkin = (x, y, out) => new THREE.Vector3(x, y - BODY_BONE_Y, skin(x, y) + LIFT + DEPTH + out);
const gems = { amethyst: [], crystal: [] };
const gem = (key, g, at, s) => { g.scale(s[0], s[1], s[2]); g.translate(at.x, at.y, at.z); g.deleteAttribute('uv'); gems[key].push(g); };
gem('amethyst', new THREE.OctahedronGeometry(1, 0), onSkin(0, 0.405, 0.006), [0.022, 0.03, 0.012]);
for (const side of [1, -1]) {
  for (const [x, y, r] of [[0.15, 0.452, 0.0075], [0.195, 0.462, 0.0085], [0.238, 0.476, 0.0095], [0.268, 0.493, 0.0075]]) {
    gem('crystal', new THREE.IcosahedronGeometry(1, 1), onSkin(side * x, y - 0.012, 0.003), [r, r, r * 0.7]);
  }
}

/** glTF factors are linear. */
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const MATS = {
  gold: { geo: mask, color: '#D4AF37', metal: 0.95, rough: 0.22, glow: 0.18 },
  amethyst: { geo: mergeGeometries(gems.amethyst, false), color: '#8E44C9', metal: 0.3, rough: 0.1, glow: 0.35 },
  crystal: { geo: mergeGeometries(gems.crystal, false), color: '#EAF4FF', metal: 0.2, rough: 0.06, glow: 0.3 },
};

const doc = new Document();
const buffer = doc.createBuffer();
const mesh = doc.createMesh('BeamyMasquerade');
for (const [key, m] of Object.entries(MATS)) {
  let g = m.geo;
  if (g === null) throw new Error(`merge failed: ${key}`);
  if (g.index === null) g = mergeVertices(g, 1e-6);
  if (g.attributes.normal === undefined) g.computeVertexNormals();
  const material = doc.createMaterial(key)
    .setBaseColorFactor([...lin(m.color), 1])
    .setMetallicFactor(m.metal)
    .setRoughnessFactor(m.rough)
    .setEmissiveFactor(lin(m.color).map((v) => v * m.glow));
  const acc = (name, arr, type) => doc.createAccessor(name).setType(type).setArray(arr).setBuffer(buffer);
  const n = g.attributes.position.count;
  mesh.addPrimitive(doc.createPrimitive()
    .setAttribute('POSITION', acc(`${key}-pos`, new Float32Array(g.attributes.position.array), 'VEC3'))
    .setAttribute('NORMAL', acc(`${key}-nrm`, new Float32Array(g.attributes.normal.array), 'VEC3'))
    .setIndices(acc(`${key}-idx`, n < 65536 ? new Uint16Array(g.index.array) : new Uint32Array(g.index.array), 'SCALAR'))
    .setMaterial(material));
}
doc.createScene('Scene').addChild(doc.createNode('BeamyMasquerade').setMesh(mesh));
const glb = await new NodeIO().writeBinary(doc);
writeFileSync(OUT, glb);
const all = mergeGeometries([MATS.gold.geo, MATS.amethyst.geo, MATS.crystal.geo].map((g) => { const c = g.clone(); for (const k of Object.keys(c.attributes)) if (k !== 'position') c.deleteAttribute(k); return c.index ? c.toNonIndexed() : c; }), false);
all.computeBoundingBox();
const b = all.boundingBox, c = b.getCenter(new THREE.Vector3());
console.log(`[bake-beamy-masquerade] wrote ${OUT} (${glb.byteLength} bytes, ${mask.attributes.position.count} mask verts)`);
console.log(`  fit: { width: ${(b.max.x - b.min.x).toFixed(3)}, at: [${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}], align: 'centre' }`);
