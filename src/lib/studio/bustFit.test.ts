import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  computeBustFit,
  computePropFitScale,
  computeAnchorAlignedFit,
  collectWorldPositions,
  normalizeFitToCanonical,
  canonicalWidthStretch,
  surfaceRadiusAlong,
  ANCHOR_CLEARANCE_CM,
  HEAD_HEIGHT_CM,
  PROP_TARGET_CM,
} from './bustFit';
import { parseObj } from './occluder';
import { ANCHOR_PRESETS } from '../faceRig';

/** Build a mesh like the vendored bust: a box with a tiny native size AND a
 *  90° X-axis node rotation (the case that broke the orbit view). */
function makeRotatedBust(): THREE.Object3D {
  const geo = new THREE.BoxGeometry(1.083, 1.526, 1.911); // raw GLB bbox size
  geo.translate(0.1, -0.2, 0.3); // off-centre, like real mesh origins
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  const group = new THREE.Group();
  group.quaternion.set(0.7071068, 0, 0, 0.7071068); // 90° about X
  group.add(mesh);
  return group;
}

/** Apply a fit to a fresh clone and return the resulting WORLD bbox. */
function worldBoxAfterFit(root: THREE.Object3D, fit: { scale: number; position: [number, number, number] }) {
  const outer = new THREE.Group();
  outer.scale.setScalar(fit.scale);
  outer.position.set(...fit.position);
  outer.add(root);
  outer.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(outer);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { size, center };
}

describe('computeBustFit', () => {
  it('centres a rotated, off-origin bust at the head-space origin', () => {
    const fit = computeBustFit(makeRotatedBust())!;
    const { center } = worldBoxAfterFit(makeRotatedBust(), fit);
    expect(center.x).toBeCloseTo(0, 3);
    expect(center.y).toBeCloseTo(0, 3);
    expect(center.z).toBeCloseTo(0, 3);
  });

  it('scales the bust to average head height (~17.7cm tall)', () => {
    const fit = computeBustFit(makeRotatedBust())!;
    const { size } = worldBoxAfterFit(makeRotatedBust(), fit);
    expect(size.y).toBeCloseTo(HEAD_HEIGHT_CM, 2);
  });

  it('produces a sane, camera-safe scale (never huge/NaN)', () => {
    const fit = computeBustFit(makeRotatedBust())!;
    expect(fit.scale).toBeGreaterThan(1);
    expect(fit.scale).toBeLessThan(100);
    expect(Number.isFinite(fit.scale)).toBe(true);
  });

  it('returns null for an empty object (→ procedural fallback)', () => {
    expect(computeBustFit(new THREE.Group())).toBeNull();
  });
});

/** A bare box mesh of the given dimensions (world axis-aligned). */
function makeBox(w: number, h: number, d: number): THREE.Object3D {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
}

describe('computePropFitScale', () => {
  it('fits a raw ~1-unit Meshy model so its largest dimension is PROP_TARGET_CM', () => {
    const scale = computePropFitScale(makeBox(0.6, 1.0, 0.4))!;
    expect(scale).toBeCloseTo(PROP_TARGET_CM / 1.0, 4);
  });

  it('uses the LARGEST dimension regardless of axis', () => {
    const scale = computePropFitScale(makeBox(2.0, 0.5, 0.5))!;
    expect(scale).toBeCloseTo(PROP_TARGET_CM / 2.0, 4);
  });

  it('leaves an already-cm-sized model near scale 1', () => {
    const scale = computePropFitScale(makeBox(10, PROP_TARGET_CM, 6))!;
    expect(scale).toBeCloseTo(1, 4);
  });

  it('honours node transforms when measuring (rotated tiny bust case)', () => {
    const scale = computePropFitScale(makeRotatedBust())!;
    // Rotated 90° about X: raw depth 1.911 becomes world height; still the max.
    expect(scale).toBeCloseTo(PROP_TARGET_CM / 1.911, 3);
  });

  it('clamps to the prop-scale bounds (0.05–50, mirrored in faceRig.ts)', () => {
    expect(computePropFitScale(makeBox(0.01, 0.01, 0.01))).toBe(50);
    expect(computePropFitScale(makeBox(5000, 5000, 5000))).toBe(0.05);
  });

  it('lets a small ~0.5-unit Meshy model reach the full PROP_TARGET_CM', () => {
    const scale = computePropFitScale(makeBox(0.5, 0.3, 0.2))!;
    expect(scale).toBeCloseTo(PROP_TARGET_CM / 0.5, 4); // 48 — must NOT be clamped
  });

  it('returns null for an empty object (caller keeps legacy scale 1)', () => {
    expect(computePropFitScale(new THREE.Group())).toBeNull();
  });
});

/* ── Anchor-aligned fit ───────────────────────────────────────────────────── */

/** Evenly-distributed points on a sphere (Fibonacci lattice), as xyz triples. */
function sphereCloud(radius: number, n = 900, centre: [number, number, number] = [0, 0, 0]): Float32Array {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    out[i * 3] = Math.cos(th) * r * radius + centre[0];
    out[i * 3 + 1] = y * radius + centre[1];
    out[i * 3 + 2] = Math.sin(th) * r * radius + centre[2];
  }
  return out;
}

/** Anchors spread over the upper hemisphere at a fixed radius from the origin. */
function anchorsAt(radius: number): [number, number, number][] {
  return [
    [0, radius, 0], [0, 0, radius], [radius, 0, 0], [-radius, 0, 0],
    [0, radius * 0.7, radius * 0.7], [radius * 0.7, radius * 0.7, 0],
  ];
}

describe('surfaceRadiusAlong', () => {
  it('measures the radius of a sphere in any direction', () => {
    const cloud = sphereCloud(4);
    for (const dir of [[0, 1, 0], [1, 0, 0], [0, 0, 1], [1, 1, 1]] as const) {
      expect(surfaceRadiusAlong(cloud, dir)!).toBeCloseTo(4, 1);
    }
  });

  it('normalises a non-unit direction', () => {
    const cloud = sphereCloud(4);
    expect(surfaceRadiusAlong(cloud, [0, 17, 0])!).toBeCloseTo(4, 1);
  });

  it('returns null when nothing lies inside the cone', () => {
    // A single point on +Y only; ask about −Y.
    expect(surfaceRadiusAlong(new Float32Array([0, 5, 0]), [0, -1, 0])).toBeNull();
  });

  it('returns null for an empty cloud or a zero-length direction', () => {
    expect(surfaceRadiusAlong(new Float32Array(0), [0, 1, 0])).toBeNull();
    expect(surfaceRadiusAlong(sphereCloud(2), [0, 0, 0])).toBeNull();
  });
});

describe('computeAnchorAlignedFit', () => {
  it('scales a mesh so no anchor is left buried inside it', () => {
    // A unit sphere against anchors 3 units out: the whole-bbox fit would blow
    // the sphere up to HEAD_HEIGHT_CM tall (radius 8.85) and swallow every one.
    const fit = computeAnchorAlignedFit(sphereCloud(1), anchorsAt(3))!;
    expect(fit).not.toBeNull();
    expect(fit.worstClearance).toBeGreaterThanOrEqual(0);
    // On a sphere every anchor is equidistant, so the optimum puts them all at
    // exactly the clearance target — the dots hug the surface rather than
    // hovering. Tolerance covers the search's step granularity.
    for (const c of fit.clearances) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(Math.abs(c - ANCHOR_CLEARANCE_CM)).toBeLessThanOrEqual(0.15);
    }
    // Sanity: the sphere must end up smaller than the anchor shell it sits in.
    expect(fit.scale).toBeLessThan(3);
  });

  it('rescues a mesh the legacy whole-bbox fit would swallow whole', () => {
    // computeBustFit stretches ANY mesh to HEAD_HEIGHT_CM tall — for a unit
    // sphere that is radius 8.85, which buries an anchor shell at radius 3.
    // This is the exact shape of the shipped bug (all 12 anchors 2.9–8.8cm deep).
    const cloud = sphereCloud(1);
    const legacyScale = HEAD_HEIGHT_CM / 2; // bbox height of a unit sphere is 2
    expect(3 - legacyScale).toBeLessThan(0); // legacy fit really does bury them
    const fit = computeAnchorAlignedFit(cloud, anchorsAt(3))!;
    expect(fit.worstClearance).toBeGreaterThanOrEqual(0);
  });

  it('recovers a translation that pushes the mesh off the anchor origin', () => {
    // Same sphere, but modelled 5 units up and 2 forward: the fit must bring it
    // back so the anchor shell stays clear on every side.
    const fit = computeAnchorAlignedFit(sphereCloud(1, 900, [0, 5, 2]), anchorsAt(3))!;
    expect(fit.worstClearance).toBeGreaterThanOrEqual(0);
    expect(fit.position[1]).toBeCloseTo(-5 * fit.scale, 0);
    expect(fit.position[2]).toBeCloseTo(-2 * fit.scale, 0);
  });

  it('reports one clearance per anchor, in order', () => {
    const anchors = anchorsAt(3);
    const fit = computeAnchorAlignedFit(sphereCloud(1), anchors)!;
    expect(fit.clearances).toHaveLength(anchors.length);
    expect(fit.worstClearance).toBe(Math.min(...fit.clearances));
  });

  it('is deterministic — the same cloud fits identically every time', () => {
    const cloud = sphereCloud(1.3);
    const a = computeAnchorAlignedFit(cloud, anchorsAt(4))!;
    const b = computeAnchorAlignedFit(cloud, anchorsAt(4))!;
    expect(b.scale).toBe(a.scale);
    expect(b.position).toEqual(a.position);
  });

  it('honours a custom clearance target', () => {
    const tight = computeAnchorAlignedFit(sphereCloud(1), anchorsAt(3), { clearanceCm: 0.2 })!;
    const loose = computeAnchorAlignedFit(sphereCloud(1), anchorsAt(3), { clearanceCm: 2.0 })!;
    // A bigger gap demands a smaller head.
    expect(loose.scale).toBeLessThan(tight.scale);
  });

  it('ignores non-finite vertices instead of poisoning the fit', () => {
    const clean = sphereCloud(1);
    const dirty = new Float32Array(clean.length + 3);
    dirty.set(clean);
    dirty[clean.length] = NaN; dirty[clean.length + 1] = Infinity; dirty[clean.length + 2] = 0;
    const fit = computeAnchorAlignedFit(dirty, anchorsAt(3))!;
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(fit.worstClearance).toBeGreaterThanOrEqual(0);
  });

  it('returns null when there is nothing to fit', () => {
    expect(computeAnchorAlignedFit(new Float32Array(0), anchorsAt(3))).toBeNull();
    expect(computeAnchorAlignedFit(sphereCloud(1), [])).toBeNull();
    // An anchor list of nothing but the origin has no direction to measure.
    expect(computeAnchorAlignedFit(sphereCloud(1), [[0, 0, 0]])).toBeNull();
  });
});

describe('collectWorldPositions', () => {
  it('returns world-space vertices, honouring node transforms', () => {
    const pts = collectWorldPositions(makeRotatedBust());
    expect(pts.length).toBeGreaterThan(0);
    let maxY = -Infinity;
    for (let i = 1; i < pts.length; i += 3) maxY = Math.max(maxY, pts[i]);
    // Rotated 90° about X, so the raw 1.911 depth becomes world height (±~0.955
    // around the geometry's translated centre).
    expect(maxY).toBeGreaterThan(0.6);
  });

  it('samples down to the requested budget', () => {
    const pts = collectWorldPositions(makeRotatedBust(), 12);
    expect(pts.length / 3).toBeLessThanOrEqual(12);
  });

  it('returns an empty array for an object with no meshes', () => {
    expect(collectWorldPositions(new THREE.Group()).length).toBe(0);
  });
});

describe('normalizeFitToCanonical', () => {
  const DIRS = ANCHOR_PRESETS.map((a) => a.offset);
  const canonical = (() => {
    const p = fileURLToPath(new URL('../../assets/ar/canonical_face_model.obj', import.meta.url));
    return parseObj(readFileSync(p, 'utf8')).positions;
  })();
  const scaled = (k: number) => {
    const out = new Float64Array(canonical.length);
    for (let i = 0; i < canonical.length; i++) out[i] = canonical[i] * k;
    return out;
  };
  /** Mean surface-radius ratio of a cloud against the canonical face. */
  const sizeVsCanonical = (pts: ArrayLike<number>) => {
    const rs: number[] = [];
    for (const d of DIRS) {
      const a = surfaceRadiusAlong(pts, d);
      const b = surfaceRadiusAlong(canonical, d);
      if (a != null && b != null && b > 1e-6) rs.push(a / b);
    }
    return rs.reduce((s, r) => s + r, 0) / rs.length;
  };

  it('THE SIZE BUG: a head fitted 23% small is corrected to canonical size', () => {
    // The clearance-optimal fit lands the vendored bust at ~0.77x canonical, so
    // props authored against it render ~1.3x oversized on a real face. This is
    // that exact situation, built from the canonical face itself so the
    // expected answer is known rather than eyeballed.
    const small = scaled(0.77);
    expect(sizeVsCanonical(small)).toBeCloseTo(0.77, 2);

    const fixed = normalizeFitToCanonical(small, { scale: 1, position: [0, 0, 0] }, canonical, DIRS);
    expect(fixed.ratio).toBeCloseTo(1 / 0.77, 1);

    const corrected = new Float64Array(small.length);
    for (let i = 0; i < small.length; i += 3) {
      corrected[i] = small[i] * fixed.scale + fixed.position[0];
      corrected[i + 1] = small[i + 1] * fixed.scale + fixed.position[1];
      corrected[i + 2] = small[i + 2] * fixed.scale + fixed.position[2];
    }
    expect(sizeVsCanonical(corrected)).toBeCloseTo(1, 2);
  });

  it('leaves an already-canonical fit alone', () => {
    const same = normalizeFitToCanonical(canonical, { scale: 1, position: [0, 0, 0] }, canonical, DIRS);
    expect(same.ratio).toBeCloseTo(1, 6);
    expect(same.scale).toBeCloseTo(1, 6);
  });

  it('grows about the head-space ORIGIN, so scale and position move together', () => {
    const fit = { scale: 2, position: [1, -3, 0.5] as [number, number, number] };
    const out = normalizeFitToCanonical(scaled(0.5), fit, canonical, DIRS);
    expect(out.scale).toBeCloseTo(fit.scale * out.ratio, 6);
    expect(out.position[0]).toBeCloseTo(fit.position[0] * out.ratio, 6);
    expect(out.position[1]).toBeCloseTo(fit.position[1] * out.ratio, 6);
    expect(out.position[2]).toBeCloseTo(fit.position[2] * out.ratio, 6);
  });

  it('degrades to the input fit rather than exploding the view', () => {
    const fit = { scale: 3, position: [0, 1, 2] as [number, number, number] };
    // Nothing measurable.
    expect(normalizeFitToCanonical(new Float32Array(0), fit, canonical, DIRS)).toMatchObject({ scale: 3, ratio: 1 });
    expect(normalizeFitToCanonical(canonical, fit, canonical, [])).toMatchObject({ scale: 3, ratio: 1 });
    // A pathological asset (100x too small) would demand a ratio outside the
    // sane band — better an un-normalized head than a head filling the sky.
    expect(normalizeFitToCanonical(scaled(0.01), { scale: 1, position: [0, 0, 0] }, canonical, DIRS).ratio).toBe(1);
  });
});

describe('canonicalWidthStretch — the bust must be as WIDE as the face Live tracks', () => {
  const DIRS = ANCHOR_PRESETS.map((a) => a.offset);
  const canonical = (() => {
    const p = fileURLToPath(new URL('../../assets/ar/canonical_face_model.obj', import.meta.url));
    return parseObj(readFileSync(p, 'utf8')).positions;
  })();
  /** Max-x-span over the cheekbone..temple heights, after a fit with stretch. */
  const widthRatio = (pts: ArrayLike<number>, fit: { scale: number; position: readonly number[] }, kx: number) => {
    const rs: number[] = [];
    for (let y = -2; y <= 6; y++) {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const py = pts[i + 1] * fit.scale + fit.position[1];
        if (py >= y - 1 && py <= y + 1) { const x = (pts[i] * fit.scale + fit.position[0]) * kx; a = Math.min(a, x); b = Math.max(b, x); }
      }
      for (let i = 0; i < canonical.length; i += 3) {
        if (canonical[i + 1] >= y - 1 && canonical[i + 1] <= y + 1) { c = Math.min(c, canonical[i]); d = Math.max(d, canonical[i]); }
      }
      if (b > a && d > c) rs.push((b - a) / (d - c));
    }
    rs.sort((p, q) => p - q);
    return rs[rs.length >> 1];
  };

  it('stretches an x-squeezed head back to canonical width, and only x', () => {
    const narrow = Float64Array.from(canonical, (v, i) => (i % 3 === 0 ? v * 0.85 : v));
    const k = canonicalWidthStretch(narrow, { scale: 1, position: [0, 0, 0] }, canonical);
    expect(k).toBeCloseTo(1 / 0.85, 2);
  });

  it('leaves a canonical-width head alone, and degrades to 1 when unmeasurable', () => {
    expect(canonicalWidthStretch(canonical, { scale: 1, position: [0, 0, 0] }, canonical)).toBeCloseTo(1, 6);
    expect(canonicalWidthStretch(new Float32Array(0), { scale: 1, position: [0, 0, 0] }, canonical)).toBe(1);
    // A pathological width demand (10x) is refused rather than obeyed.
    const sliver = Float64Array.from(canonical, (v, i) => (i % 3 === 0 ? v * 0.1 : v));
    expect(canonicalWidthStretch(sliver, { scale: 1, position: [0, 0, 0] }, canonical)).toBe(1);
  });

  it('THE CROWN BUG on the REAL vendored bust: shipped fit was 0.89x canonical width; stretched it is 1x', () => {
    // The exact pipeline ReferenceBust runs, on the committed GLB (no textures
    // needed — positions only, read straight from the binary chunk).
    const buf = readFileSync(fileURLToPath(new URL('../../../public/models/reference-head.glb', import.meta.url)));
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    const bin = 20 + jsonLen + 8;
    const root = new THREE.Group();
    const build = (ni: number, parent: THREE.Object3D) => {
      const n = gltf.nodes[ni];
      const o = new THREE.Group();
      if (n.translation) o.position.fromArray(n.translation);
      if (n.rotation) o.quaternion.fromArray(n.rotation);
      if (n.scale) o.scale.fromArray(n.scale);
      if (n.mesh !== undefined) {
        for (const prim of gltf.meshes[n.mesh].primitives) {
          const acc = gltf.accessors[prim.attributes.POSITION];
          const view = gltf.bufferViews[acc.bufferView];
          const off = buf.byteOffset + bin + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
          const pos = new Float32Array(buf.buffer.slice(off, off + acc.count * 12));
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          o.add(new THREE.Mesh(geo));
        }
      }
      parent.add(o);
      for (const c of n.children ?? []) build(c, o);
    };
    for (const ni of gltf.scenes[gltf.scene ?? 0].nodes) build(ni, root);

    const points = collectWorldPositions(root);
    const aligned = computeAnchorAlignedFit(points, DIRS);
    expect(aligned).not.toBeNull();
    const fit = normalizeFitToCanonical(points, aligned!, canonical, DIRS);
    // Before: the shipped fit, unstretched — the head a crown wraps is ~11% narrow.
    expect(widthRatio(points, fit, 1)).toBeLessThan(0.9);
    const kx = canonicalWidthStretch(points, fit, canonical);
    expect(widthRatio(points, fit, kx)).toBeCloseTo(1, 2);
  });
});
