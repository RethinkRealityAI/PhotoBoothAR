import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseObj,
  CRANIUM,
  clampHeadScale,
  normalizeStudioSettings,
  DEFAULT_STUDIO_SETTINGS,
  HEAD_SCALE_MIN,
  HEAD_SCALE_MAX,
} from './occluder';

const FIXTURE = `
# tiny quad
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
f 1/1 2/1 3/1 4/1
`;

describe('parseObj', () => {
  it('parses vertices and fan-triangulates polygons', () => {
    const g = parseObj(FIXTURE);
    expect(g.positions).toHaveLength(12);
    // quad → 2 triangles: (0,1,2) (0,2,3)
    expect(Array.from(g.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(g.bbox.min).toEqual([0, 0, 0]);
    expect(g.bbox.max).toEqual([1, 1, 0]);
  });
  it('ignores vt/vn/comments and malformed lines', () => {
    const g = parseObj('vn 0 0 1\nvt 0.5 0.5\n# hi\nv 2 3 4\nf zz\n');
    expect(Array.from(g.positions)).toEqual([2, 3, 4]);
    expect(g.indices).toHaveLength(0);
  });

  it('the vendored canonical face model matches the faceRig anchor space', () => {
    // Same metric-cm space faceRig.ts ANCHOR_PRESETS were calibrated against:
    // ears x≈±7.7, chin y≈−9.4, crown y≈+8.3, nose tip z≈+7.6.
    const objPath = fileURLToPath(new URL('../../assets/ar/canonical_face_model.obj', import.meta.url));
    const g = parseObj(readFileSync(objPath, 'utf8'));
    expect(g.positions.length / 3).toBe(468);
    expect(g.indices.length / 3).toBeGreaterThan(800);
    const [minX, minY, minZ] = g.bbox.min;
    const [maxX, maxY, maxZ] = g.bbox.max;
    expect(minX).toBeCloseTo(-7.74, 1);
    expect(maxX).toBeCloseTo(7.74, 1);
    expect(minY).toBeCloseTo(-9.4, 1);
    expect(maxY).toBeCloseTo(8.26, 1);
    expect(maxZ).toBeCloseTo(7.59, 1);
    expect(minZ).toBeGreaterThan(-3); // face shell only — cranium closes the back
  });
});

describe('CRANIUM ellipsoid stays inside prop space', () => {
  const [cx, cy, cz] = CRANIUM.center;
  const [rx, ry, rz] = CRANIUM.radii;
  it('front face never pokes through the canonical face shell (z < +6)', () => {
    expect(cz + rz).toBeLessThan(6);
  });
  it('sides stay inside the ears (±7.7) and top below crown props (y ≤ 10.5)', () => {
    expect(cx + rx).toBeLessThanOrEqual(7.7);
    expect(cy + ry).toBeLessThanOrEqual(10.5);
  });
  it('closes the back of the head (back of skull ≈ 9–12cm behind origin)', () => {
    expect(cz - rz).toBeLessThan(-9);
    expect(cz - rz).toBeGreaterThan(-13);
  });
});

describe('head-size calibration', () => {
  it('clamps to the supported range and defaults junk to 1', () => {
    expect(clampHeadScale(1)).toBe(1);
    expect(clampHeadScale(0.1)).toBe(HEAD_SCALE_MIN);
    expect(clampHeadScale(99)).toBe(HEAD_SCALE_MAX);
    expect(clampHeadScale(NaN)).toBe(1);
    expect(clampHeadScale('1.2')).toBeCloseTo(1.2);
    expect(clampHeadScale(undefined)).toBe(1);
  });
  it('normalizeStudioSettings tolerates junk rows and keeps defaults', () => {
    expect(normalizeStudioSettings(null)).toEqual(DEFAULT_STUDIO_SETTINGS);
    expect(normalizeStudioSettings({ headScale: 1.15, occlusion: false })).toEqual({ headScale: 1.15, occlusion: false });
    expect(normalizeStudioSettings({ headScale: 'x', occlusion: 'yes' })).toEqual({ headScale: 1, occlusion: true });
  });
});
