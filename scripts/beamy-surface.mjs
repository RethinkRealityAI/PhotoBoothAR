/**
 * Beamy's front skin, measured from his own model (public/mascot/beamy.glb),
 * for the bakes that must sit ON him (scripts/bake-beamy-face-paint.mjs,
 * scripts/bake-beamy-masquerade.mjs).
 *
 * Space: his MODEL space, metres, +y up from his feet, +z toward the viewer.
 * The homepage fits props in his `body` bone's space, which is this space
 * minus 0.12 in y (BODY_BONE_Y).
 */
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/** His body bone sits this far above his feet (BeamyStage / beamyLooks). */
export const BODY_BONE_Y = 0.12;
/** His lids' centres (model space): the eyes every face piece is placed by. */
export const EYE = { x: 0.1015, y: 0.36 };

/**
 * z of his front skin at (x, y), or null off his body. Each query takes the
 * highest skin vertex within `r` of (x, y) seen from the front, so it is the
 * surface a decal must clear.
 */
export async function beamyFrontSurface(root, r = 0.02) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(join(root, 'public', 'mascot', 'beamy.glb'));
  const node = doc.getRoot().listNodes().find((n) => n.getName() === 'Beamy');
  if (node === undefined || node.getMesh() === null) throw new Error('beamy.glb: no "Beamy" body mesh');
  const pos = node.getMesh().listPrimitives()[0].getAttribute('POSITION').getArray();
  // Bin the front-facing half (z > 0) on a 1cm grid: max z per bin.
  const BIN = 0.01;
  const bins = new Map();
  for (let i = 0; i < pos.length; i += 3) {
    const z = pos[i + 2];
    if (z <= 0) continue;
    const k = `${Math.round(pos[i] / BIN)},${Math.round(pos[i + 1] / BIN)}`;
    if (!(bins.get(k) >= z)) bins.set(k, z);
  }
  const reach = Math.ceil(r / BIN);
  return (x, y) => {
    const bx = Math.round(x / BIN), by = Math.round(y / BIN);
    let best = null;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        if ((dx * dx + dy * dy) * BIN * BIN > r * r) continue;
        const z = bins.get(`${bx + dx},${by + dy}`);
        if (z !== undefined && (best === null || z > best)) best = z;
      }
    }
    return best;
  };
}

/**
 * His body's rest-pose vertices (model space, metres, flat xyz), for bakes
 * that wrap ALL the way round him (scripts/bake-beamy-necklace.mjs).
 */
export async function beamyBodyVertices(root) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(join(root, 'public', 'mascot', 'beamy.glb'));
  const node = doc.getRoot().listNodes().find((n) => n.getName() === 'Beamy');
  if (node === undefined || node.getMesh() === null) throw new Error('beamy.glb: no "Beamy" body mesh');
  return node.getMesh().listPrimitives()[0].getAttribute('POSITION').getArray();
}
