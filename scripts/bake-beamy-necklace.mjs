/**
 * Bake an emerald necklace that Beamy actually WEARS, for the homepage's AR
 * step (public/models/props/beamy-necklace.glb).
 *
 * Why a bake: he is a rounded crystal with no neck, so the library's
 * "Emerald Statement Necklace" (a flat, human-collar piece) could only float
 * on his chest. This one is built on him: a gold curb chain that wraps ALL
 * the way round his body, resting on his measured skin (scripts/
 * beamy-surface.mjs, every link just off the surface), high at his back and
 * sides, above his arms, and dipping in front under his mouth the way a
 * chain hangs on a cone; an emerald drop in a gold bezel with a diamond halo hangs from the low
 * point, lying on his chest, with two smaller emerald stations on the chain.
 *
 * Materials: gold metalness 1, roughness 0.2; emeralds glassy. Every material
 * carries glTF extras `beamyEnv` (env-map intensity), so BeamyStage gives it
 * studio reflections (a metal with nothing to reflect renders black).
 * Built in his body bone's space, so its fit is exact (scale 1).
 *
 * Run: node scripts/bake-beamy-necklace.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { BODY_BONE_Y, beamyBodyVertices, beamyFrontSurface } from './beamy-surface.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT ?? join(root, 'public', 'models', 'props', 'beamy-necklace.glb');

/** Where the chain rests (model space, metres): low in front, high at the back. */
const Y_FRONT = 0.205, Y_BACK = 0.385, SAG = 1.6;
/** One curb link: ring radius, wire radius, stretch along the chain; link pitch. */
const LINK = { r: 0.0064, wire: 0.0024, stretch: 1.4 }, PITCH = 0.0142;
/** The chain's centre line floats this far off his skin (clears a standing link). */
const CLEAR = 0.0105;

const body = await beamyBodyVertices(root);
const front = await beamyFrontSurface(root, 0.012);

/** The chain's height at angle t round him (t = 0 in front, +z). */
const chainY = (t) => Y_BACK - (Y_BACK - Y_FRONT) * ((1 + Math.cos(t)) / 2) ** SAG;

// 1. His radius under the chain, all the way round: the widest skin within
//    a small window of each angle and height (so no link cuts into him).
const SAMPLES = 720;
const rad = new Float64Array(SAMPLES);
for (let s = 0; s < SAMPLES; s++) {
  const t = (s / SAMPLES) * Math.PI * 2, y = chainY(t);
  let best = 0;
  for (let i = 0; i < body.length; i += 3) {
    if (Math.abs(body[i + 1] - y) > 0.012) continue;
    let d = Math.abs(Math.atan2(body[i], body[i + 2]) - t) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < 0.05) best = Math.max(best, Math.hypot(body[i], body[i + 2]));
  }
  if (best === 0) throw new Error(`no skin under the chain at ${(t * 180 / Math.PI).toFixed(0)} deg`);
  rad[s] = best;
}
// Dilate then smooth, so the chain glides over his facets instead of tracing them.
const at = (a, s) => a[((s % SAMPLES) + SAMPLES) % SAMPLES];
const dil = rad.map((_, s) => { let m = 0; for (let k = -6; k <= 6; k++) m = Math.max(m, at(rad, s + k)); return m; });
const smooth = dil.map((_, s) => { let sum = 0; for (let k = -8; k <= 8; k++) sum += at(dil, s + k); return sum / 17; });
const pathPt = (s) => {
  const t = (s / SAMPLES) * Math.PI * 2, r = Math.max(at(smooth, s), at(rad, s)) + CLEAR;
  return new THREE.Vector3(Math.sin(t) * r, chainY(t), Math.cos(t) * r);
};
const curve = new THREE.CatmullRomCurve3(Array.from({ length: SAMPLES }, (_, s) => pathPt(s)), true, 'centripetal');

// 2. The links: alternately lying on his skin and standing off it (a curb chain).
const len = curve.getLength();
const nLinks = Math.round(len / PITCH / 2) * 2; // even, so the twist closes
const ring = new THREE.TorusGeometry(LINK.r, LINK.wire, 6, 14);
ring.scale(LINK.stretch, 1, 1);
ring.deleteAttribute('uv');
const links = [];
for (let k = 0; k < nLinks; k++) {
  const u = k / nLinks;
  const p = curve.getPointAt(u);
  const T = curve.getTangentAt(u).normalize();
  // Outward: horizontal, away from his axis, made square to the chain.
  const out = new THREE.Vector3(p.x, 0, p.z).normalize();
  const Nn = out.sub(T.clone().multiplyScalar(out.dot(T))).normalize();
  const B = new THREE.Vector3().crossVectors(T, Nn).normalize();
  // Torus: x along the chain; flat links span (T, B), standing ones (T, N).
  // Right-handed bases only (a reflection would turn the ring inside out): T x B = -N, T x N = B.
  const m = k % 2 === 0 ? new THREE.Matrix4().makeBasis(T, B, Nn.clone().negate()) : new THREE.Matrix4().makeBasis(T, Nn, B);
  m.setPosition(p);
  links.push(ring.clone().applyMatrix4(m));
}

// 3. The emeralds: a drop under the chain's low point, two stations on the chain.
/** A faceted dome, +z out (flat-shaded facets catch the light). */
const dome = (rx, ry, h, seg = 10) => {
  const g = new THREE.SphereGeometry(1, seg, 4, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  g.rotateX(Math.PI / 2);
  g.scale(rx, ry, h);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
};
/** A bezel: a gold rim round a gem's outline. */
const bezel = (rx, ry, wire) => {
  const g = new THREE.TorusGeometry(1, wire / Math.min(rx, ry), 8, 32);
  g.scale(rx, ry, Math.min(rx, ry));
  g.deleteAttribute('uv');
  return g;
};
/** Lie a piece on his chest at (x, y): its +z along his front surface normal. */
const onChest = (g, x, y, lift) => {
  const z = (yy) => front(x, yy) ?? 0;
  const dzdy = (z(y + 0.01) - z(y - 0.01)) / 0.02;
  const nrm = new THREE.Vector3(0, -dzdy, 1).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm));
  g.translate(x, y, z(y) + lift);
  return g;
};
const gold = [...links];
const emerald = [];
const diamond = [];
const lowY = chainY(0);
// The drop: bail just under the chain, then a pear-ish oval emerald in its bezel.
const DROP = { rx: 0.026, ry: 0.034 };
const dropY = lowY - 0.011 - DROP.ry;
gold.push(onChest(bezel(DROP.rx + 0.003, DROP.ry + 0.003, 0.0032), 0, dropY, 0.006));
gold.push(onChest(new THREE.CylinderGeometry(DROP.rx + 0.002, DROP.rx + 0.002, 0.004, 32, 1).rotateX(Math.PI / 2).scale(1, (DROP.ry + 0.002) / (DROP.rx + 0.002), 1), 0, dropY, 0.004));
emerald.push(onChest(dome(DROP.rx, DROP.ry, 0.016, 12), 0, dropY, 0.006));
const bail = new THREE.TorusGeometry(0.0062, 0.0021, 8, 16);
bail.deleteAttribute('uv');
gold.push(onChest(bail.rotateY(Math.PI / 2), 0, lowY - 0.006, CLEAR - 0.002));
// A halo of small diamonds round the drop's bezel.
const HALO = 24;
for (let k = 0; k < HALO; k++) {
  const a = (k / HALO) * Math.PI * 2;
  const x = Math.cos(a) * (DROP.rx + 0.0108), y = dropY + Math.sin(a) * (DROP.ry + 0.0108);
  diamond.push(onChest(dome(0.0046, 0.0046, 0.0038, 8), x, y, 0.0068));
  gold.push(onChest(new THREE.CylinderGeometry(0.0054, 0.0054, 0.0036, 12, 1).rotateX(Math.PI / 2), x, y, 0.005));
}
// The stations: small round emeralds in bezels, set into the chain either side of the drop.
for (const side of [-1, 1]) {
  const u = (side < 0 ? 1 : 0) + side * 0.075;
  const p = curve.getPointAt(((u % 1) + 1) % 1);
  const T = curve.getTangentAt(((u % 1) + 1) % 1);
  const out = new THREE.Vector3(p.x, 0, p.z).normalize();
  const Nn = out.sub(T.clone().multiplyScalar(out.dot(T))).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), Nn);
  const place = (g, lift) => g.applyQuaternion(q).translate(p.x + Nn.x * lift, p.y + Nn.y * lift, p.z + Nn.z * lift);
  gold.push(place(bezel(0.0125, 0.0125, 0.0026), 0.001));
  gold.push(place(new THREE.CylinderGeometry(0.0125, 0.0125, 0.004, 24, 1).rotateX(Math.PI / 2), -0.001));
  emerald.push(place(dome(0.0115, 0.0115, 0.009, 10), 0.001));
}

/** glTF factors are linear. */
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const toBone = (g) => { const c = g.index !== null ? g.toNonIndexed() : g; c.translate(0, -BODY_BONE_Y, 0); for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal') c.deleteAttribute(k); return c; };
const MATS = {
  gold: { geo: mergeGeometries(gold.map(toBone), false), color: '#F4C764', metal: 1, rough: 0.2, glow: 0.04, env: 1.35 },
  emerald: { geo: mergeGeometries(emerald.map(toBone), false), color: '#0E9A63', metal: 0.2, rough: 0.05, glow: 0.3, env: 1.6 },
  diamond: { geo: mergeGeometries(diamond.map(toBone), false), color: '#EEF6FF', metal: 0.1, rough: 0.04, glow: 0.25, env: 1.8 },
};

const doc = new Document();
const buffer = doc.createBuffer();
const mesh = doc.createMesh('BeamyNecklace');
const all = new THREE.Box3();
for (const [k, mt] of Object.entries(MATS)) {
  if (mt.geo === null) throw new Error(`merge failed: ${k}`);
  const g = mergeVertices(mt.geo, 1e-6);
  g.computeBoundingBox();
  all.union(g.boundingBox);
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
    .setIndices(acc(`${k}-idx`, g.attributes.position.count < 65536 ? new Uint16Array(g.index.array) : new Uint32Array(g.index.array), 'SCALAR'))
    .setMaterial(material));
}
doc.createScene('Scene').addChild(doc.createNode('BeamyNecklace').setMesh(mesh));
const glb = await new NodeIO().writeBinary(doc);
writeFileSync(OUT, glb);
const c = all.getCenter(new THREE.Vector3());
console.log(`[bake-beamy-necklace] wrote ${OUT} (${glb.byteLength} bytes, ${nLinks} links, chain ${len.toFixed(3)} m)`);
console.log(`  fit: { width: ${(all.max.x - all.min.x).toFixed(3)}, at: [${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}], align: 'centre' }`);
