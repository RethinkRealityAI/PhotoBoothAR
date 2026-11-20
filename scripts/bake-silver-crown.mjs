/**
 * Bake the hero's old "Royal crown" (public/models/props/royal-crown.glb) into
 * a polished SILVER crown with real materials and real gems, for the
 * homepage's AR step (public/models/props/silver-crown.glb).
 *
 * Why a bake: royal-crown.glb carries no material at all, so three drew it
 * flat grey (which is why it was dropped from the hero). Its geometry is ONE
 * watertight mesh with its cabochons modelled as low bumps on the band (too
 * coarse to cut out cleanly), so the body stays whole, in silver, and a
 * faceted gem is SEATED on each setting:
 *
 *   • the eight round settings under the points are found by measurement:
 *     outward-facing band vertices that stand proud of their neighbourhood
 *     (the band's median radius within ±WA radians and ±WY) by more than
 *     PROUD, grouped by angle; a ruby dome sits on each;
 *   • the eight oval bezels sit half-way between them (the crown's 8-fold
 *     symmetry), at the same height; sapphire and emerald ovals alternate.
 *
 * Materials: silver metalness 1, roughness 0.16, a near-white base (polished
 * sterling, not chrome-blue); gems glassy (low roughness, a little glow).
 * Every material carries glTF extras `beamyEnv` (env-map intensity): the
 * homepage stage has no environment of its own and a metal with nothing to
 * reflect renders black, so BeamyStage gives these materials a studio room
 * (every other prop renders exactly as before).
 *
 * Run: node scripts/bake-silver-crown.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'public', 'models', 'props', 'royal-crown.glb');
const OUT = process.env.OUT ?? join(root, 'public', 'models', 'props', 'silver-crown.glb');

/** A round setting stands this far proud of its neighbourhood (crown units; the crown is 1.9 across). */
const PROUD = 0.018;
/** The neighbourhood: ±WA radians round the crown, ±WY up and down. */
const WA = 0.22, WY = 0.07;
/** Settings live on the band (y below this); the knobs on the points stay silver. */
const BAND_TOP = 0.1;

const src = await new NodeIO().read(SRC);
const node = src.getRoot().listNodes().find((n) => n.getMesh() !== null);
if (node === undefined) throw new Error('royal-crown.glb: no mesh');
const prim = node.getMesh().listPrimitives()[0];
// Bake the node's transform (it stands the crown up) into the vertices.
const m = new THREE.Matrix4().fromArray(node.getWorldMatrix());
const nm = new THREE.Matrix3().getNormalMatrix(m);
const P = prim.getAttribute('POSITION').getArray();
const N = prim.getAttribute('NORMAL').getArray();
const idx = prim.getIndices().getArray();
const n = P.length / 3;
const pos = new Float32Array(P.length), nor = new Float32Array(N.length);
const v = new THREE.Vector3();
for (let i = 0; i < n; i++) {
  v.fromArray(P, 3 * i).applyMatrix4(m).toArray(pos, 3 * i);
  v.fromArray(N, 3 * i).applyMatrix3(nm).normalize().toArray(nor, 3 * i);
}

// 1. Each outward-facing band vertex: how far it stands proud of its neighbourhood.
const R = (i) => Math.hypot(pos[3 * i], pos[3 * i + 2]);
const A = (i) => Math.atan2(pos[3 * i + 2], pos[3 * i]);
const dAng = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
const outward = [];
for (let i = 0; i < n; i++) if ((pos[3 * i] * nor[3 * i] + pos[3 * i + 2] * nor[3 * i + 2]) / Math.max(1e-6, R(i)) > 0.2) outward.push(i);
/** The band's median radius round (a, y), over outward vertices. */
const bandR = (a, y) => {
  const rs = [];
  for (const j of outward) if (dAng(A(j), a) < WA && Math.abs(pos[3 * j + 1] - y) < WY) rs.push(R(j));
  if (rs.length === 0) throw new Error(`no band near angle ${a.toFixed(2)} y ${y.toFixed(2)}`);
  rs.sort((x, y2) => x - y2);
  return rs[Math.floor(rs.length / 2)];
};

// 2. The round settings: proud vertices on the band, grouped by angle.
const settings = [];
for (const i of outward) {
  const y = pos[3 * i + 1];
  if (y > BAND_TOP || R(i) - bandR(A(i), y) <= PROUD) continue;
  const a = A(i);
  const s = settings.find((c) => dAng(c.a0, a) < 0.15 && Math.abs(c.y - y) < 0.08);
  if (s !== undefined) { s.x += Math.cos(a); s.z += Math.sin(a); s.ys.push(y); s.r = Math.max(s.r, R(i)); s.k++; } else settings.push({ a0: a, x: Math.cos(a), z: Math.sin(a), y, ys: [y], r: R(i), k: 1 });
}
// The real settings carry several proud vertices; a stray bead carries one or two.
const rounds = settings.filter((s) => s.k >= 5).map((s) => ({ a: Math.atan2(s.z, s.x), y: s.ys.reduce((p, q) => p + q, 0) / s.ys.length, r: s.r }));
if (rounds.length !== 8) throw new Error(`expected 8 round settings, found ${rounds.length}`);
rounds.sort((p, q) => p.a - q.a);
const setY = rounds.reduce((p, q) => p + q.y, 0) / rounds.length;

// 3. The gems: a faceted dome per setting, its base on the band, facing out.
/** A faceted dome (flat-shaded facets catch the light), unit radius, +z out. */
const dome = (rx, ry, h) => {
  const g = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  g.rotateX(Math.PI / 2); // pole on +z
  g.scale(rx, ry, h);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
};
const seat = (g, a, y, r) => {
  // +z -> radial direction at angle a (x = cos a, z = sin a); y stays up.
  const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out);
  g.applyQuaternion(q);
  g.translate(out.x * r, y, out.z * r);
  return g;
};
const gems = { ruby: [], sapphire: [], emerald: [] };
for (const s of rounds) gems.ruby.push(seat(dome(0.05, 0.05, 0.036), s.a, s.y, s.r - 0.012));
for (let k = 0; k < rounds.length; k++) {
  const a0 = rounds[k].a, a1 = rounds[(k + 1) % rounds.length].a + (k === rounds.length - 1 ? Math.PI * 2 : 0);
  const a = (a0 + a1) / 2;
  gems[k % 2 === 0 ? 'sapphire' : 'emerald'].push(seat(dome(0.074, 0.036, 0.032), a, setY, bandR(a, setY) + 0.002));
}

// 4. The silver body, as authored (UVs dropped: nothing is textured).
const body = new THREE.BufferGeometry();
body.setAttribute('position', new THREE.BufferAttribute(pos, 3));
body.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
body.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));

/** glTF factors are linear. */
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const MATS = {
  silver: { geo: body, color: '#F2F3F6', metal: 1, rough: 0.16, glow: 0, env: 1.25 },
  ruby: { geo: mergeGeometries(gems.ruby, false), color: '#C0102E', metal: 0.2, rough: 0.05, glow: 0.25, env: 1.6 },
  sapphire: { geo: mergeGeometries(gems.sapphire, false), color: '#2152C4', metal: 0.2, rough: 0.05, glow: 0.25, env: 1.6 },
  emerald: { geo: mergeGeometries(gems.emerald, false), color: '#0F8C5C', metal: 0.2, rough: 0.05, glow: 0.25, env: 1.6 },
};

const doc = new Document();
const buffer = doc.createBuffer();
const mesh = doc.createMesh('SilverCrown');
for (const [k, mt] of Object.entries(MATS)) {
  const g = mt.geo;
  if (g === null) throw new Error(`merge failed: ${k}`);
  const count = g.attributes.position.count;
  const index = g.index !== null ? g.index.array : Uint32Array.from({ length: count }, (_, i) => i);
  const material = doc.createMaterial(k)
    .setBaseColorFactor([...lin(mt.color), 1])
    .setMetallicFactor(mt.metal)
    .setRoughnessFactor(mt.rough)
    .setEmissiveFactor(lin(mt.color).map((c) => c * mt.glow))
    .setExtras({ beamyEnv: mt.env });
  const acc = (name, arr, type) => doc.createAccessor(name).setType(type).setArray(arr).setBuffer(buffer);
  mesh.addPrimitive(doc.createPrimitive()
    .setAttribute('POSITION', acc(`${k}-pos`, new Float32Array(g.attributes.position.array), 'VEC3'))
    .setAttribute('NORMAL', acc(`${k}-nrm`, new Float32Array(g.attributes.normal.array), 'VEC3'))
    .setIndices(acc(`${k}-idx`, count < 65536 ? new Uint16Array(index) : new Uint32Array(index), 'SCALAR'))
    .setMaterial(material));
}
doc.createScene('Scene').addChild(doc.createNode('SilverCrown').setMesh(mesh));
const glb = await new NodeIO().writeBinary(doc);
writeFileSync(OUT, glb);
console.log(`[bake-silver-crown] wrote ${OUT} (${glb.byteLength} bytes): 8 rubies at y ${setY.toFixed(3)}, 4 sapphires, 4 emeralds`);
