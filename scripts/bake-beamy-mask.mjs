/**
 * Bake a full-face Venetian mask cut for Beamy's face, for the homepage's AR
 * step (public/models/props/beamy-mask.glb).
 *
 * Why a bake: every full-face mask in the platform library (Kabuki, the
 * porcelain and gilded-vine masks) is a HUMAN face: his eyes sit three times
 * a person's apart, so fitted by its eye holes one covers most of his body
 * and its painted features fall nowhere near his. This one is drawn on his
 * own face: a porcelain volto from his brow to under his mouth, eye holes
 * on his eyes (a little larger than his lids, so his eyes show through) and
 * a small smile-shaped opening on his mouth, laid on his measured front skin
 * (scripts/beamy-surface.mjs, the same sampler as the face paint). Gold
 * filigree is drawn ON it as raised wire: a trim round the edge, rims round
 * the eyes and mouth, volutes along each brow (curling in beside the ruby
 * teardrop on the brow) and under each eye, with bead terminals.
 *
 * Materials: porcelain (white, satin, clear-coated), gold metalness 1, a
 * glassy ruby. Gold and ruby carry glTF extras `beamyEnv` so BeamyStage
 * gives them reflections; the porcelain carries a softer one for its glaze.
 * Built in his body bone's space, so its fit is exact (scale 1).
 *
 * Run: node scripts/bake-beamy-mask.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsClearcoat } from '@gltf-transform/extensions';
import { BODY_BONE_Y, EYE, beamyFrontSurface } from './beamy-surface.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT ?? join(root, 'public', 'models', 'props', 'beamy-mask.glb');

/** How far the mask's back floats off his skin, and its thickness (metres). */
const LIFT = 0.006, DEPTH = 0.008;
/** Eye holes: a little larger than his lids (half-size 0.070 x 0.069). */
const HOLE = { rx: 0.084, ry: 0.08 };
/** His mouth (model space): the opening that keeps his smile in view. */
const MOUTH = { y: 0.293, rx: 0.036, ry: 0.016 };

/** The face outline, right half (model space, metres), brow to chin; the left is its mirror. */
const OUTLINE = [[0, 0.512], [0.06, 0.505], [0.115, 0.484], [0.16, 0.448], [0.193, 0.4], [0.212, 0.345], [0.208, 0.29], [0.186, 0.248], [0.148, 0.218], [0.098, 0.2], [0.045, 0.192], [0, 0.19]];

const surf = await beamyFrontSurface(root, 0.012);
/**
 * His face as ONE smooth surface: a least-squares fit, symmetric in x
 * (x^0, x^2, x^4 times y^0..y^4), to his skin over the mask's area, eye
 * holes left out (they are open), then lifted by its worst shortfall so it
 * never dips into him. The raw sampler steps every centimetre; laid on that,
 * the porcelain and its gold wire visibly wobbled.
 */
const insideEye = (x, y) => [-1, 1].some((sd) => ((x - sd * EYE.x) / HOLE.rx) ** 2 + ((y - EYE.y) / HOLE.ry) ** 2 < 1);
const fitPts = [];
for (let x = -0.23; x <= 0.2301; x += 0.005) {
  for (let y = 0.17; y <= 0.535; y += 0.005) {
    const z = surf(x, y);
    if (z !== null && !insideEye(x, y)) fitPts.push([x, y, z]);
  }
}
const basis = (x, y) => {
  const u = (x / 0.25) ** 2, w = (y - 0.35) / 0.2;
  const out = [];
  for (const ux of [1, u, u * u]) for (let j = 0, wy = 1; j <= 4; j++, wy *= w) out.push(ux * wy);
  return out;
};
const NB = basis(0, 0).length;
const ata = Array.from({ length: NB }, () => new Float64Array(NB)), atb = new Float64Array(NB);
for (const [x, y, z] of fitPts) {
  const b = basis(x, y);
  for (let i = 0; i < NB; i++) { atb[i] += b[i] * z; for (let j = 0; j < NB; j++) ata[i][j] += b[i] * b[j]; }
}
// Gaussian elimination with partial pivoting.
for (let c = 0; c < NB; c++) {
  let piv = c;
  for (let r = c + 1; r < NB; r++) if (Math.abs(ata[r][c]) > Math.abs(ata[piv][c])) piv = r;
  [ata[c], ata[piv]] = [ata[piv], ata[c]];
  [atb[c], atb[piv]] = [atb[piv], atb[c]];
  for (let r = c + 1; r < NB; r++) {
    const f = ata[r][c] / ata[c][c];
    for (let j = c; j < NB; j++) ata[r][j] -= f * ata[c][j];
    atb[r] -= f * atb[c];
  }
}
const coef = new Float64Array(NB);
for (let r = NB - 1; r >= 0; r--) {
  let sum = atb[r];
  for (let j = r + 1; j < NB; j++) sum -= ata[r][j] * coef[j];
  coef[r] = sum / ata[r][r];
}
const smoothZ = (x, y) => basis(x, y).reduce((a, b, i) => a + b * coef[i], 0);
// Where the fit dips below his skin (his eye bulges, the edge of his
// face), it is pushed out by a smooth bump: the max of Gaussians, each as
// tall as one shortfall, so every sample is cleared and nothing steps.
const SIGMA = 0.022;
let shortfall = 0, rms = 0;
const under = [];
for (const [x, y, z] of fitPts) {
  const d = z - smoothZ(x, y);
  shortfall = Math.max(shortfall, d);
  rms += d * d;
  if (d > 0) under.push([x, y, d]);
}
rms = Math.sqrt(rms / fitPts.length);
/** Skin z at (x, y), smooth and never inside him. */
const skin = (x, y) => {
  let bump = 0;
  for (const [ux, uy, d] of under) bump = Math.max(bump, d * Math.exp(-((x - ux) ** 2 + (y - uy) ** 2) / (2 * SIGMA * SIGMA)));
  return smoothZ(x, y) + bump;
};
if (process.env.DEBUG) for (const [x, y, d] of under.filter((u) => u[2] > 0.006)) console.log('under', x.toFixed(3), y.toFixed(3), (d * 1000).toFixed(1));
/** The mask's front face at (x, y). */
const face = (x, y) => skin(x, y) + LIFT + DEPTH;

// 1. The porcelain: outline with eye holes and a mouth opening, extruded,
//    tessellated so it bends onto his round face, then laid on his skin.
const outline2d = new THREE.SplineCurve([...OUTLINE.map(([x, y]) => new THREE.Vector2(x, y)), ...OUTLINE.slice(1, -1).reverse().map(([x, y]) => new THREE.Vector2(-x, y))]);
const ring = outline2d.getSpacedPoints(160);
ring.pop();
const shape = new THREE.Shape(ring);
for (const side of [1, -1]) {
  const h = new THREE.Path();
  h.absellipse(side * EYE.x, EYE.y, HOLE.rx, HOLE.ry, 0, Math.PI * 2, true);
  shape.holes.push(h);
}
const mouthPts = (grow) => {
  // A gentle smile: the top edge flatter than the bottom.
  const pts = [];
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const sy = Math.sin(a) > 0 ? 0.55 : 1;
    pts.push(new THREE.Vector2(Math.cos(a) * (MOUTH.rx + grow), MOUTH.y + Math.sin(a) * (MOUTH.ry + grow) * sy));
  }
  return pts;
};
shape.holes.push(new THREE.Path(mouthPts(0).reverse()));
let mask = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, curveSegments: 32, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.0025, bevelSegments: 2 });
mask = new TessellateModifier(0.012, 8).modify(mask);
mask.deleteAttribute('normal');
mask.deleteAttribute('uv');
mask = mergeVertices(mask, 1e-5);
const mp = mask.attributes.position;
for (let i = 0; i < mp.count; i++) {
  const x = mp.getX(i), y = mp.getY(i);
  mp.setXYZ(i, x, y, skin(x, y) + LIFT + mp.getZ(i));
}
mask.computeVertexNormals();

// 2. The filigree: gold wire laid on the porcelain's front face.
const gold = [];
/** A wire along 2D points (model x, y), riding the mask's face. */
const wire = (pts2, r, closed = false) => {
  const pts3 = pts2.map((p) => new THREE.Vector3(p.x, p.y, face(p.x, p.y) + r * 0.45));
  const c = new THREE.CatmullRomCurve3(pts3, closed, 'centripetal');
  const g = new THREE.TubeGeometry(c, Math.max(24, pts2.length * 2), r, 7, closed);
  g.deleteAttribute('uv');
  gold.push(g);
  // Round off open ends.
  if (!closed) for (const end of [pts3[0], pts3[pts3.length - 1]]) { const s = new THREE.SphereGeometry(r * 1.05, 8, 6); s.deleteAttribute('uv'); s.translate(end.x, end.y, end.z); gold.push(s); }
};
/** A scroll: from `from`, curving to a spiral of radius R round `c` that winds `turns` times inward. */
const scroll = (from, c, R, startAng, turns, dir) => {
  const pts = [];
  const lead = 12;
  const s0 = new THREE.Vector2(c.x + Math.cos(startAng) * R, c.y + Math.sin(startAng) * R);
  for (let k = 0; k < lead; k++) pts.push(new THREE.Vector2().lerpVectors(from, s0, k / lead));
  const n = Math.round(48 * turns);
  for (let k = 0; k <= n; k++) {
    const t = k / n, a = startAng + dir * t * turns * Math.PI * 2, r = R * (1 - 0.72 * t);
    pts.push(new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));
  }
  return pts;
};
const V = (x, y) => new THREE.Vector2(x, y);
const mirror = (pts) => pts.map((p) => V(-p.x, p.y));
// Edge trim, just inside the outline.
const inset = ring.map((p) => { const d = p.clone().sub(V(0, 0.35)); return p.clone().sub(d.normalize().multiplyScalar(0.007)); });
wire(inset, 0.0045, true);
// Eye rims.
for (const side of [1, -1]) {
  const pts = [];
  for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push(V(side * EYE.x + Math.cos(a) * (HOLE.rx + 0.006), EYE.y + Math.sin(a) * (HOLE.ry + 0.006))); }
  wire(pts, 0.0038, true);
}
// Mouth rim.
wire(mouthPts(0.005), 0.003, true);
// Volutes: a flowing line (a spline through `path`) that ends at the top
// of a circle round `c` and winds inward from there (`dir` +1 counter-
// clockwise, so a line arriving leftward curls on), with a gold bead at
// the heart of the curl.
const volute = (path, c, turns, dir, r) => {
  const pts = new THREE.SplineCurve(path.map(([x, y]) => V(x, y))).getSpacedPoints(30);
  const end = pts[pts.length - 1];
  const R = end.distanceTo(c), a0 = Math.atan2(end.y - c.y, end.x - c.x);
  const n = Math.round(56 * turns);
  for (let k = 1; k <= n; k++) {
    const t = k / n, a = a0 + dir * t * turns * Math.PI * 2, rr = R * (1 - 0.7 * t);
    pts.push(V(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr));
  }
  for (const side of [1, -1]) {
    wire(side === 1 ? pts : mirror(pts), r);
    const b = new THREE.SphereGeometry(r * 1.7, 10, 8);
    b.deleteAttribute('uv');
    gold.push(b.translate(side * c.x, c.y, face(side * c.x, c.y) + r * 0.9));
  }
};
// Brows: from the temple along the top of each eye, curling in beside the ruby.
volute([[0.152, 0.452], [0.12, 0.474], [0.085, 0.478], [0.045, 0.471]], V(0.045, 0.455), 1.1, 1, 0.0036);
// Cheeks: from beside each eye, down and in, curling under it.
volute([[0.18, 0.305], [0.166, 0.27], [0.13, 0.25], [0.084, 0.246]], V(0.084, 0.232), 1.1, 1, 0.0036);
// A gold bead on the chin.
{
  const b = new THREE.SphereGeometry(0.0075, 12, 10);
  b.deleteAttribute('uv');
  gold.push(b.translate(0, 0.222, face(0, 0.222) + 0.004));
}

// 3. The ruby teardrop on the brow, in a gold bezel.
const onFace = (g, x, y, lift) => {
  const dzdy = (face(x, y + 0.01) - face(x, y - 0.01)) / 0.02;
  const dzdx = (face(x + 0.01, y) - face(x - 0.01, y)) / 0.02;
  const nrm = new THREE.Vector3(-dzdx, -dzdy, 1).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm));
  g.translate(x, y, face(x, y) + lift);
  return g;
};
const tear = (rx, ry) => {
  // A teardrop outline (point up), as a flat-shaded faceted dome.
  const s = new THREE.Shape();
  for (let k = 0; k <= 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const x = Math.sin(a) * rx * (1 - 0.55 * Math.max(0, Math.cos(a)) ** 1.5);
    s[k === 0 ? 'moveTo' : 'lineTo'](x, -Math.cos(a) * ry);
  }
  return s;
};
const GEM = { x: 0, y: 0.462, rx: 0.016, ry: 0.024 };
const gemGeo = new THREE.ExtrudeGeometry(tear(GEM.rx, GEM.ry), { depth: 0.004, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6 });
gemGeo.deleteAttribute('uv');
gemGeo.computeVertexNormals();
const ruby = [onFace(gemGeo, GEM.x, GEM.y, 0.004)];
const bezel = tear(GEM.rx + 0.0045, GEM.ry + 0.0055).getSpacedPoints(48);
bezel.pop();
wire(bezel.map((p) => V(GEM.x + p.x, GEM.y + p.y)), 0.0034, true);

/** glTF factors are linear. */
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const toBone = (g) => { const c = g.index !== null ? g.toNonIndexed() : g; c.translate(0, -BODY_BONE_Y, 0); for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal') c.deleteAttribute(k); return c; };
const MATS = {
  porcelain: { geo: toBone(mask), color: '#F6F1E8', metal: 0, rough: 0.34, glow: 0.05, env: 0.7, coat: true },
  gold: { geo: mergeGeometries(gold.map(toBone), false), color: '#F4C764', metal: 1, rough: 0.2, glow: 0.04, env: 1.35 },
  ruby: { geo: mergeGeometries(ruby.map(toBone), false), color: '#C0102E', metal: 0.2, rough: 0.05, glow: 0.3, env: 1.6 },
};

const doc = new Document();
const buffer = doc.createBuffer();
const coatExt = doc.createExtension(KHRMaterialsClearcoat);
const mesh = doc.createMesh('BeamyMask');
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
  if (mt.coat === true) material.setExtension('KHR_materials_clearcoat', coatExt.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(0.08));
  const acc = (name, arr, type) => doc.createAccessor(name).setType(type).setArray(arr).setBuffer(buffer);
  const n = g.attributes.position.count;
  mesh.addPrimitive(doc.createPrimitive()
    .setAttribute('POSITION', acc(`${k}-pos`, new Float32Array(g.attributes.position.array), 'VEC3'))
    .setAttribute('NORMAL', acc(`${k}-nrm`, new Float32Array(g.attributes.normal.array), 'VEC3'))
    .setIndices(acc(`${k}-idx`, n < 65536 ? new Uint16Array(g.index.array) : new Uint32Array(g.index.array), 'SCALAR'))
    .setMaterial(material));
}
doc.createScene('Scene').addChild(doc.createNode('BeamyMask').setMesh(mesh));
const glb = await new NodeIO().registerExtensions([KHRMaterialsClearcoat]).writeBinary(doc);
writeFileSync(OUT, glb);
const c = all.getCenter(new THREE.Vector3());
console.log(`[bake-beamy-mask] wrote ${OUT} (${glb.byteLength} bytes, ${mask.attributes.position.count} porcelain verts; face fit rms ${(rms * 1000).toFixed(1)}mm, worst bump ${(shortfall * 1000).toFixed(1)}mm)`);
console.log(`  fit: { width: ${(all.max.x - all.min.x).toFixed(3)}, at: [${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}], align: 'centre' }`);
