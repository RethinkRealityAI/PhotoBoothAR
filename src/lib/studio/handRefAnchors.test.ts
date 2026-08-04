import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_HAND_LANDMARKS,
  CANONICAL_KNUCKLE_CM,
  CANONICAL_PALM_LEN_CM,
  handRefAnchorPoint,
  handRefAnchors,
  measureHandMannequin,
  type Vec3,
} from './handRefAnchors';
import { HAND_ANCHOR_MAP, HAND_ANCHORS } from '../handPose';

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The fit splits the difference between two independent span estimates, so the
 *  recovered spans straddle the canonical pair rather than hitting it exactly.
 *  What matters is that they land within a few percent — the bug being fixed
 *  was a mannequin ~25% off. */
const withinPct = (actual: number, expected: number, pct: number) =>
  expect(Math.abs(actual - expected) / expected).toBeLessThan(pct);

describe('the canonical hand', () => {
  it('carries the fixture spans solveHandPose inverts', () => {
    // src/lib/handPose.test.ts worldHand(): |L9-L0| and |L5-L17|.
    expect(dist(CANONICAL_HAND_LANDMARKS[9], CANONICAL_HAND_LANDMARKS[0])).toBeCloseTo(9.851, 3);
    expect(dist(CANONICAL_HAND_LANDMARKS[5], CANONICAL_HAND_LANDMARKS[17])).toBeCloseTo(6.22, 3);
    expect(CANONICAL_PALM_LEN_CM).toBeCloseTo(9.851, 3);
    expect(CANONICAL_KNUCKLE_CM).toBeCloseTo(6.22, 3);
  });

  it('is the handPose.test fixture projected onto its own palm basis', () => {
    // The fixture verbatim (MediaPipe world metres, y DOWN).
    const world: Record<number, Vec3> = {
      0: [0, 0.05, 0],
      5: [0.03, -0.04, 0],
      9: [0.01, -0.048, 0],
      13: [-0.012, -0.045, 0],
      17: [-0.032, -0.035, 0],
    };
    const cm = (p: Vec3): Vec3 => [p[0] * 100, -p[1] * 100, -p[2] * 100];
    const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (v: Vec3): Vec3 => {
      const l = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const cross = (a: Vec3, b: Vec3): Vec3 => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const L0 = cm(world[0]);
    const up = norm(sub(cm(world[9]), L0));
    const normal = norm(cross(sub(cm(world[5]), cm(world[17])), up));
    const right = norm(cross(up, normal));
    // The basis the solver builds is right-handed with right x up = normal.
    expect(cross(right, up)).toEqual(normal.map((v) => expect.closeTo(v, 6)));
    for (const id of [0, 5, 9, 13, 17]) {
      const d = sub(cm(world[id]), L0);
      const expected: Vec3 = [dot(d, right), dot(d, up), dot(d, normal)];
      const actual = CANONICAL_HAND_LANDMARKS[id];
      for (let k = 0; k < 3; k++) expect(actual[k]).toBeCloseTo(expected[k], 5);
    }
  });
});

describe('handRefAnchorPoint', () => {
  it('evaluates each HAND_ANCHORS definition rather than restating it', () => {
    for (const def of HAND_ANCHORS) {
      const p = handRefAnchorPoint(def);
      expect(p).not.toBeNull();
      if (p === null) continue;
      const a = CANONICAL_HAND_LANDMARKS[def.between[0]];
      const b = CANONICAL_HAND_LANDMARKS[def.between[1]];
      expect(p[0]).toBeCloseTo((a[0] + b[0]) / 2, 6);
      expect(p[1]).toBeCloseTo((a[1] + b[1]) / 2, 6);
      // The whole offset is along the palm normal (+Z in the hand frame).
      expect(p[2] - (a[2] + b[2]) / 2).toBeCloseTo(def.normalOffsetCm, 6);
    }
  });

  it('puts the wrist band on the wrist and the grip inside the fist', () => {
    const a = handRefAnchors();
    // wristBack sits AT the wrist landmark, 1.2cm proud of the back.
    expect(a.wristBack).toEqual([0, 0, 1.2]);
    // grip is between the middle and ring knuckles, 2.2cm INTO the hand.
    expect(a.grip[1]).toBeCloseTo(9.59, 2);
    expect(a.grip[2]).toBeCloseTo(-2.2, 6);
    // palm is the same midpoint, 1.5cm out of the palm — so grip and palm
    // differ ONLY along the normal, exactly as HAND_ANCHORS says.
    expect(a.palm[0]).toBeCloseTo(a.grip[0], 6);
    expect(a.palm[1]).toBeCloseTo(a.grip[1], 6);
    expect(a.palm[2] - a.grip[2]).toBeCloseTo(
      HAND_ANCHOR_MAP.palm.normalOffsetCm - HAND_ANCHOR_MAP.grip.normalOffsetCm,
      6,
    );
  });

  it('returns null for a landmark set that does not cover the pair', () => {
    expect(handRefAnchorPoint(HAND_ANCHOR_MAP.grip, { 0: [0, 0, 0] })).toBeNull();
    expect(Object.keys(handRefAnchors({ 0: [0, 0, 0] }))).toEqual(['wristBack']);
  });
});

/* ── measureHandMannequin ──────────────────────────────────────────────── */

/**
 * A synthetic hand point cloud in a caller-chosen frame: forearm stub, flaring
 * palm slab, four fingers at the canonical knuckle spread, and a thumb lobe on
 * the PALM side. `place` maps the hand frame (right, up, normal) into mesh axes,
 * which is what lets one fixture exercise every orientation.
 */
function syntheticHand(place: (r: number, u: number, nn: number) => Vec3, scale = 1): Float64Array {
  const pts: number[] = [];
  const push = (r: number, u: number, nn: number) => {
    const p = place(r * scale, u * scale, nn * scale);
    pts.push(p[0], p[1], p[2]);
  };
  // An elliptical cross-section sampled EVENLY along r (a ring sampled by angle
  // leaves r-gaps near its centre wide enough to read as separate lobes).
  const lobe = (u: number, rc: number, nc: number, rr: number, nr: number) => {
    for (let d = -rr; d <= rr + 1e-9; d += 0.05) {
      const k = Math.sqrt(Math.max(0, 1 - (d / rr) ** 2));
      push(rc + d, u, nc + nr * k);
      push(rc + d, u, nc - nr * k);
    }
  };
  // Forearm stub, wrist crease at u = 0.
  for (let u = -5; u < 0; u += 0.25) lobe(u, 0, 0, 1.8, 1.2);
  // Palm: flares immediately and keeps widening to the knuckle line.
  for (let u = 0; u <= 9.851; u += 0.2) lobe(u, -0.99, 0, 2.6 + (u / 9.851) * 1.3, 1.15);
  // Four fingers rooted at the canonical MCP spread.
  for (const r of [2.070881, 0, -2.158179, -4.046334]) {
    for (let u = 9.851; u <= 16.5; u += 0.25) lobe(u, r, 0, 0.62, 0.6);
  }
  // Thumb lobe, beyond the index and proud of the PALM side (+normal).
  for (let u = 1.5; u <= 6.5; u += 0.25) lobe(u, 4.6, 1.9, 1.0, 0.95);
  return Float64Array.from(pts);
}

describe('measureHandMannequin', () => {
  it('recovers the canonical spans and an identity scale from a life-size hand', () => {
    const fit = measureHandMannequin(syntheticHand((r, u, n) => [r, u, n]));
    expect(fit).not.toBeNull();
    if (fit === null) return;
    expect(fit.scale).toBeGreaterThan(0.85);
    expect(fit.scale).toBeLessThan(1.15);
    withinPct(fit.palmLenCm, CANONICAL_PALM_LEN_CM, 0.06);
    withinPct(fit.knuckleCm, CANONICAL_KNUCKLE_CM, 0.06);
    expect(fit.up).toEqual([0, 1, 0]);
    expect(fit.normal).toEqual([0, 0, 1]);
    expect(fit.right).toEqual([1, 0, 0]);
    // Index (L5) is the knuckle on the thumb side.
    expect(fit.landmarks[5][0]).toBeGreaterThan(fit.landmarks[17][0]);
  });

  it('scales a half-size mesh up to the metric hand', () => {
    const fit = measureHandMannequin(syntheticHand((r, u, n) => [r, u, n], 0.5));
    expect(fit).not.toBeNull();
    if (fit === null) return;
    expect(fit.scale).toBeGreaterThan(1.7);
    expect(fit.scale).toBeLessThan(2.3);
    // Whatever the source units, the fitted hand is the canonical hand.
    withinPct(fit.palmLenCm, CANONICAL_PALM_LEN_CM, 0.06);
    withinPct(fit.knuckleCm, CANONICAL_KNUCKLE_CM, 0.06);
  });

  it('finds the wrist end and the palm side whichever way the mesh is exported', () => {
    // Fingers down -Y, palm facing -Z, hand across +X: a proper rotation of the
    // first fixture (180 degrees about X).
    const fit = measureHandMannequin(syntheticHand((r, u, n) => [r, -u, -n]));
    expect(fit).not.toBeNull();
    if (fit === null) return;
    expect(fit.up).toEqual([0, -1, 0]);
    expect(fit.normal).toEqual([0, 0, -1]);
    // right = up x normal keeps the frame right-handed.
    expect(fit.right).toEqual([1, 0, 0]);
    withinPct(fit.palmLenCm, CANONICAL_PALM_LEN_CM, 0.06);
  });

  it('handles a mesh whose long axis is not Y', () => {
    const fit = measureHandMannequin(syntheticHand((r, u, n) => [u, n, r]));
    expect(fit).not.toBeNull();
    if (fit === null) return;
    expect(fit.up).toEqual([1, 0, 0]);
    expect(fit.normal).toEqual([0, 1, 0]);
    withinPct(fit.knuckleCm, CANONICAL_KNUCKLE_CM, 0.06);
  });

  it('refuses a mesh it cannot read rather than guessing a size', () => {
    expect(measureHandMannequin(new Float64Array(30))).toBeNull();
    // A featureless box: no four-lobe station, so no knuckle line.
    const box: number[] = [];
    for (let i = 0; i < 2000; i++) box.push(Math.random(), Math.random() * 3, Math.random());
    expect(measureHandMannequin(Float64Array.from(box))).toBeNull();
  });
});

/* ── the asset that actually ships ─────────────────────────────────────── */

/** Minimal GLB reader: baked POSITION accessor of primitive 0, node TRS applied. */
function glbPositions(relPath: string): Float64Array {
  const buf = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)));
  let off = 12;
  let json: Record<string, never> | null = null;
  let bin: Buffer | null = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
    if (type === 0x004e4942) bin = buf.subarray(off + 8, off + 8 + len);
    off += 8 + len;
  }
  const g = json as unknown as {
    nodes: { mesh?: number; rotation?: number[]; scale?: number[]; translation?: number[] }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { bufferView: number; byteOffset?: number; count: number }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  const node = g.nodes.find((nd) => nd.mesh !== undefined);
  if (!node || bin === null) throw new Error('no mesh node');
  const acc = g.accessors[g.meshes[node.mesh as number].primitives[0].attributes.POSITION];
  const view = g.bufferViews[acc.bufferView];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const t = node.translation ?? [0, 0, 0];
  const out = new Float64Array(acc.count * 3);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    const x = bin.readFloatLE(o) * s[0];
    const y = bin.readFloatLE(o + 4) * s[1];
    const z = bin.readFloatLE(o + 8) * s[2];
    // Rotate by the node quaternion: v + 2q_v x (q_v x v + w v).
    const cx = qy * z - qz * y + qw * x;
    const cy = qz * x - qx * z + qw * y;
    const cz = qx * y - qy * x + qw * z;
    out[i * 3] = x + 2 * (qy * cz - qz * cy) + t[0];
    out[i * 3 + 1] = y + 2 * (qz * cx - qx * cz) + t[1];
    out[i * 3 + 2] = z + 2 * (qx * cy - qy * cx) + t[2];
  }
  return out;
}

describe('the vendored open-hand mannequin', () => {
  it('measures as a real hand, so the orbit view can size it from the mesh', () => {
    const fit = measureHandMannequin(glbPositions('../../../public/models/reference-hand-open.glb'));
    expect(fit).not.toBeNull();
    if (fit === null) return;
    // Sized by its own geometry: the fitted spans land on the canonical hand.
    withinPct(fit.palmLenCm, CANONICAL_PALM_LEN_CM, 0.04);
    withinPct(fit.knuckleCm, CANONICAL_KNUCKLE_CM, 0.04);
    // The two independent estimates agree closely — this is what makes the
    // measurement trustworthy rather than a proportion guess.
    const byPalm = CANONICAL_PALM_LEN_CM / fit.rawPalmLen;
    const byKnuckle = CANONICAL_KNUCKLE_CM / fit.rawKnuckle;
    expect(Math.abs(byPalm - byKnuckle) / fit.scale).toBeLessThan(0.06);
    // The Meshy export is unit-boxed: a hand-sized mesh needs a scale near 11.
    expect(fit.scale).toBeGreaterThan(8);
    expect(fit.scale).toBeLessThan(15);
    // Fingers run up the long axis and the palm faces out of a lateral one.
    expect(Math.abs(fit.up[1])).toBe(1);
    expect(Math.abs(fit.normal[2])).toBe(1);
    // Mount points land on the mannequin, not in space beside it.
    const anchors = handRefAnchors(fit.landmarks);
    expect(anchors.grip[1]).toBeGreaterThan(7);
    expect(anchors.grip[1]).toBeLessThan(12);
    // The offset is measured from THIS mannequin's knuckle line, not from a
    // notional palm plane — the knuckles sit slightly proud of the wrist centre.
    const knuckleN = (fit.landmarks[9][2] + fit.landmarks[13][2]) / 2;
    expect(anchors.grip[2] - knuckleN).toBeCloseTo(-2.2, 6);
    expect(Math.abs(knuckleN)).toBeLessThan(1.5);
  });

  it('reads the FIST pose too, and puts the grip inside the fist', () => {
    const pts = measureHandMannequin(glbPositions('../../../public/models/reference-hand-fist.glb'));
    expect(pts).not.toBeNull();
    if (pts === null) return;
    // A closed fist has no MCP row to find — its four lobes are the FOLDED
    // fingers — so the two span estimates disagree far more than the open
    // hand's 3%, and the fit is the mean. That is a mannequin-grade size, not a
    // calibration: ~13cm wrist-to-knuckles for a 1.9-unit mesh.
    expect(pts.scale).toBeGreaterThan(4);
    expect(pts.scale).toBeLessThan(10);
    // Same export convention as the open hand — both come off the same
    // generator, so a disagreement here would mean the reader mis-oriented one.
    expect(pts.up).toEqual([0, 1, 0]);
    expect(pts.normal).toEqual([0, 0, -1]);
    // The held-gear mount lands in the fist's mass rather than beside it.
    const grip = handRefAnchors(pts.landmarks).grip;
    expect(grip[1]).toBeGreaterThan(2);
    expect(grip[1]).toBeLessThan(11);
    expect(Math.abs(grip[2])).toBeLessThan(4);
  });
});
