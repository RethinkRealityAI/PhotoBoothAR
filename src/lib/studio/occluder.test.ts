import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseObj,
  CRANIUM,
  HAIR_DOME,
  craniumNormalizedRadius,
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

  /**
   * THE INVARIANT THAT ACTUALLY BOUNDS THE SHELL. The axis-extent assertions
   * above only look along x/y/z; every anchor that matters sits OFF-axis (the
   * ear anchors are the binding pair, and their clearance depends on all three
   * radii at once). A resize that quietly buries one of these would hide the
   * prop mounted there — an invisible earring, not an error.
   *
   * The offsets are read out of faceRig.ts's own source rather than imported:
   * that module pulls in three and @mediapipe/tasks-vision, which this suite
   * (vitest `node`, .ts only) must not load. Re-typing the table here would let
   * the two drift silently, so the numbers come from the one real definition
   * and the parse fails loudly if its shape ever changes.
   */
  const anchorSrc = readFileSync(
    fileURLToPath(new URL('../faceRig.ts', import.meta.url)),
    'utf8',
  );
  const anchorBlock = anchorSrc.slice(
    anchorSrc.indexOf('export const ANCHOR_PRESETS'),
    anchorSrc.indexOf('export const ANCHOR_MAP'),
  );
  const anchors = [...anchorBlock.matchAll(
    /id:\s*'(\w+)'[\s\S]*?offset:\s*\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]/g,
  )].map((m) => ({
    id: m[1],
    offset: [Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number],
  }));

  it('reads every anchor preset out of faceRig.ts (guards the parse itself)', () => {
    expect(anchors.length).toBe(12);
    expect(anchors.map((a) => a.id)).toContain('leftEar');
    expect(anchors.find((a) => a.id === 'crown')?.offset).toEqual([0, 8.3, 4]);
  });

  it('no anchor preset is swallowed by the shell', () => {
    for (const a of anchors) {
      // >1 = outside the ellipsoid. Stated per anchor so a failure names it.
      expect(`${a.id}:${craniumNormalizedRadius(a.offset) > 1}`).toBe(`${a.id}:true`);
    }
  });

  it('the ear anchors — the binding pair — keep a real margin, not a rounding one', () => {
    const ear = craniumNormalizedRadius([7.7, 1.5, -1.5]);
    expect(ear).toBeGreaterThan(1.03);
    // Mirrored anchor must measure identically (the shell is x-symmetric).
    expect(craniumNormalizedRadius([-7.7, 1.5, -1.5])).toBeCloseTo(ear, 12);
  });

  it('covers a head with hair, not a bare skull — the cap regression', () => {
    // A cap sits ON hair: the shell must reach above the canonical crown
    // (y +8.26 in the vendored OBJ) and behind the face shell's own back.
    expect(cy + ry).toBeGreaterThan(9.5);
    expect(cz - rz).toBeLessThan(-11);
    // …and be at least as wide as the widest thing MediaPipe hands us minus a
    // touch, so the silhouette does not pinch in behind the face.
    expect(cx + rx).toBeGreaterThan(7.5);
  });

  /**
   * The shells exist to hide what passes BEHIND the head. Anywhere the face
   * shell exists, a skull ellipsoid in front of it culls props the guest's face
   * should show — at the recessed eye sockets that was up to 0.84cm, enough to
   * eat glasses and visors seated at the eyes. Sampled over the canonical face's
   * own footprint (0.5cm grid), both shells must stay behind the face surface.
   */
  it('no skull shell pokes in front of the canonical face shell', () => {
    const objPath = fileURLToPath(new URL('../../assets/ar/canonical_face_model.obj', import.meta.url));
    const g = parseObj(readFileSync(objPath, 'utf8'));
    const P = g.positions;
    const faceZ = (x: number, y: number): number => {
      let best = -Infinity;
      for (let t = 0; t < g.indices.length; t += 3) {
        const a = g.indices[t] * 3, b = g.indices[t + 1] * 3, c = g.indices[t + 2] * 3;
        const d = (P[b + 1] - P[c + 1]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 1] - P[c + 1]);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((P[b + 1] - P[c + 1]) * (x - P[c]) + (P[c] - P[b]) * (y - P[c + 1])) / d;
        const l2 = ((P[c + 1] - P[a + 1]) * (x - P[c]) + (P[a] - P[c]) * (y - P[c + 1])) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const z = l1 * P[a + 2] + l2 * P[b + 2] + l3 * P[c + 2];
        if (z > best) best = z;
      }
      return best;
    };
    const shellZ = (x: number, y: number, s: typeof CRANIUM): number => {
      const q = 1 - ((x - s.center[0]) / s.radii[0]) ** 2 - ((y - s.center[1]) / s.radii[1]) ** 2;
      return q < 0 ? -Infinity : s.center[2] + s.radii[2] * Math.sqrt(q);
    };
    let worst = -Infinity;
    let sampled = 0;
    for (let x = -7.5; x <= 7.5; x += 0.5) {
      for (let y = -9.5; y <= 8.5; y += 0.5) {
        const fz = faceZ(x, y);
        if (fz === -Infinity) continue;
        sampled++;
        worst = Math.max(worst, shellZ(x, y, CRANIUM) - fz, shellZ(x, y, HAIR_DOME) - fz);
      }
    }
    expect(sampled).toBeGreaterThan(800);
    // Behind the face everywhere, with a real margin (measured: −0.33cm).
    expect(worst).toBeLessThan(-0.2);
  });

  it('shrinks about a FIXED back, so back-of-head coverage cannot drop', () => {
    // cz − rz is the back reach; holding it while rz shrinks moves every point
    // of the back surface backward or not at all: z_back' − z_back = Δrz·(1 − √q).
    expect(cz - rz).toBeCloseTo(-11.6, 9);
  });

  it('degenerate radii report "outside" instead of dividing by zero', () => {
    expect(craniumNormalizedRadius([0, 0, 0], { center: [0, 0, 0], radii: [0, 1, 1] })).toBe(Infinity);
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
    // `lighting` (W6) is ALWAYS emitted, so these exact-shape assertions list it.
    expect(normalizeStudioSettings({ headScale: 1.15, occlusion: false })).toEqual({ headScale: 1.15, occlusion: false, lighting: 'studio' });
    expect(normalizeStudioSettings({ headScale: 'x', occlusion: 'yes' })).toEqual({ headScale: 1, occlusion: true, lighting: 'studio' });
  });
  it('normalizeStudioSettings round-trips a stored lighting preset and rejects junk', () => {
    expect(normalizeStudioSettings({ lighting: 'neon' }).lighting).toBe('neon');
    expect(normalizeStudioSettings({ lighting: 'candlelit' }).lighting).toBe('candlelit');
    // A row written before this key existed, and a hostile one, both fall back.
    expect(normalizeStudioSettings({}).lighting).toBe('studio');
    expect(normalizeStudioSettings({ lighting: 'chartreuse' }).lighting).toBe('studio');
    expect(normalizeStudioSettings({ lighting: 42 }).lighting).toBe('studio');
  });
});

describe('HAIR_DOME — the second shell the ear bound forces', () => {
  const anchorSrc = readFileSync(
    fileURLToPath(new URL('../faceRig.ts', import.meta.url)),
    'utf8',
  );
  const block = anchorSrc.slice(
    anchorSrc.indexOf('export const ANCHOR_PRESETS'),
    anchorSrc.indexOf('export const ANCHOR_MAP'),
  );
  const anchors = [...block.matchAll(
    /id:\s*'(\w+)',\s*label:[^,]+,\s*offset:\s*\[([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\]/g,
  )].map((m) => ({
    id: m[1],
    offset: [Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number],
  }));

  it('no anchor preset is swallowed by the dome either', () => {
    for (const a of anchors) {
      expect(`${a.id}:${craniumNormalizedRadius(a.offset, HAIR_DOME) > 1}`).toBe(`${a.id}:true`);
    }
  });

  it('the binding anchors keep a real margin against the dome', () => {
    expect(craniumNormalizedRadius([7.7, 1.5, -1.5], HAIR_DOME)).toBeGreaterThan(1.03);
    expect(craniumNormalizedRadius([0, 8.3, 4.0], HAIR_DOME)).toBeGreaterThan(1.03);
  });

  it('is wide where hair lives — wider than the ear-capped cranium up high', () => {
    // The whole reason it exists: at hair height the dome's half-width must
    // exceed the cranium's ear-capped 7.6 and approach the cap shell's 8.61.
    expect(HAIR_DOME.radii[0]).toBeGreaterThan(8.3);
    expect(HAIR_DOME.center[1] + HAIR_DOME.radii[1]).toBeGreaterThan(12);
  });
});
