/**
 * Bake the platform's procedural Royal Crown (src/components/ar/HeadPieces.tsx
 * RoyalCrown: the gold band, two rims, eight points with jewel tips, eight
 * band jewels) into a GLB WITH its materials, for the homepage's AR step
 * (public/models/props/gold-crown.glb).
 *
 * Why a bake: the bundled public/models/props/royal-crown.glb carries no
 * material at all (three draws it flat grey), and the homepage wears props as
 * GLBs. Same geometry and the same numbers as HeadPieces (gold metalness 0.95,
 * roughness 0.22, a faint emissive; jewels metalness 0.3, roughness 0.1), so
 * the homepage shows the crown hosts really get.
 *
 * Run: node scripts/bake-royal-crown.mjs   (re-run after changing RoyalCrown)
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public', 'models', 'props', 'gold-crown.glb');

// HeadPieces.tsx colours (sRGB hex).
const GOLD = '#D4AF37';
const GOLD_LIGHT = '#F0DC9A';
const RUBY = '#9C1B33';
const SAPPHIRE = '#1E4D8C';
const EMERALD = '#1E7A4D';

/** Geometry per material key, placed in the crown's own space (as HeadPieces places it). */
const parts = new Map();
const add = (key, geo, matrix) => {
  const g = geo;
  g.applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  (parts.get(key) ?? parts.set(key, []).get(key)).push(g);
};
const at = (x, y, z, rx = 0, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1));

const points = 8;
const bandR = 3.5;
add('gold', new THREE.CylinderGeometry(bandR, bandR, 1.5, 48, 1, true), at(0, 0, 0));
add('goldLight', new THREE.TorusGeometry(bandR, 0.12, 12, 48), at(0, 0.75, 0, Math.PI / 2));
add('goldLight', new THREE.TorusGeometry(bandR, 0.12, 12, 48), at(0, -0.75, 0, Math.PI / 2));
for (let i = 0; i < points; i++) {
  const a = (i / points) * Math.PI * 2;
  const base = at(Math.cos(a) * bandR, 0.75, Math.sin(a) * bandR, 0, -a);
  add('gold', new THREE.ConeGeometry(0.5, 2.0, 4), base.clone().multiply(at(0, 1.0, 0)));
  add(i % 3 === 0 ? 'ruby' : i % 3 === 1 ? 'sapphire' : 'emerald', new THREE.SphereGeometry(0.22, 16, 16), base.clone().multiply(at(0, 2.1, 0)));
}
for (let i = 0; i < points; i++) {
  const a = ((i + 0.5) / points) * Math.PI * 2;
  add(i % 2 === 0 ? 'ruby' : 'emerald', new THREE.SphereGeometry(0.2, 16, 16), at(Math.cos(a) * (bandR + 0.05), 0, Math.sin(a) * (bandR + 0.05)));
}

/** glTF factors are linear. */
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const MATS = {
  gold: { color: GOLD, metal: 0.95, rough: 0.22, glow: 0.18, double: true },
  goldLight: { color: GOLD_LIGHT, metal: 0.95, rough: 0.22, glow: 0.18 },
  ruby: { color: RUBY, metal: 0.3, rough: 0.1, glow: 0.35 },
  sapphire: { color: SAPPHIRE, metal: 0.3, rough: 0.1, glow: 0.35 },
  emerald: { color: EMERALD, metal: 0.3, rough: 0.1, glow: 0.35 },
};

const doc = new Document();
const buffer = doc.createBuffer();
const mesh = doc.createMesh('RoyalCrown');
for (const [key, geos] of parts) {
  const g = mergeGeometries(geos, false);
  if (g === null) throw new Error(`merge failed: ${key}`);
  const m = MATS[key];
  const material = doc.createMaterial(key)
    .setBaseColorFactor([...lin(m.color), 1])
    .setMetallicFactor(m.metal)
    .setRoughnessFactor(m.rough)
    .setEmissiveFactor(lin(m.color).map((v) => v * m.glow))
    .setDoubleSided(m.double === true);
  const acc = (name, attr, type) => doc.createAccessor(name).setType(type).setArray(new Float32Array(attr.array)).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc(`${key}-pos`, g.attributes.position, 'VEC3'))
    .setAttribute('NORMAL', acc(`${key}-nrm`, g.attributes.normal, 'VEC3'))
    .setAttribute('TEXCOORD_0', acc(`${key}-uv`, g.attributes.uv, 'VEC2'))
    .setIndices(doc.createAccessor(`${key}-idx`).setType('SCALAR').setArray(g.attributes.position.count < 65536 ? new Uint16Array(g.index.array) : new Uint32Array(g.index.array)).setBuffer(buffer))
    .setMaterial(material);
  mesh.addPrimitive(prim);
}
const node = doc.createNode('RoyalCrown').setMesh(mesh);
doc.createScene('Scene').addChild(node);
const glb = await new NodeIO().writeBinary(doc);
writeFileSync(OUT, glb);
console.log(`[bake-royal-crown] wrote ${OUT} (${glb.byteLength} bytes, ${parts.size} materials)`);
