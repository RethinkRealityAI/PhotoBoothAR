import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { findPairSplit, earAnchorPoints, pairWantLocal, splitScenePair } from './earPair';
import type { EarEstimate } from '../faceEngine/earPoints';

const est: EarEstimate = { left: [8.6, -2, -4], right: [-8.1, -2.4, -3.8], leftSource: 'lobe', rightSource: 'canal' };

/** A flat "earring": a quad (2 triangles) repeated, centred at cx, hanging from y=top. */
function earring(cx: number, top: number, quads = 6): number[] {
  const v: number[] = [];
  for (let i = 0; i < quads; i++) {
    const y1 = top - i * 0.5, y0 = y1 - 0.5;
    v.push(cx - 1, y0, 0, cx + 1, y0, 0, cx + 1, y1, 0, cx - 1, y0, 0, cx + 1, y1, 0, cx - 1, y1, 0);
  }
  return v;
}
function sceneOf(verts: number[], indexed = false): THREE.Group {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  if (indexed) g.setIndex([...Array(verts.length / 3).keys()]);
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
  return scene;
}

describe('findPairSplit', () => {
  it('finds the gap between two separated clusters', () => {
    const xs = [...Array(20)].map((_, i) => -15 + (i % 5) * 0.3).concat([...Array(20)].map((_, i) => (i % 5) * 0.3));
    const x = findPairSplit(xs)!;
    expect(x).toBeGreaterThan(-13.8);
    expect(x).toBeLessThan(0);
  });
  it('one object (no dominant gap) is not a pair', () => {
    expect(findPairSplit([...Array(40)].map((_, i) => i * 0.25))).toBeNull();
  });
  it('a stray fragment beside a big object is not a pair', () => {
    expect(findPairSplit([...Array(40)].map((_, i) => i * 0.01).concat([20, 20.1]))).toBeNull();
  });
  it('too few triangles, or junk, is not a pair', () => {
    expect(findPairSplit([0, 10])).toBeNull();
    expect(findPairSplit([...Array(10)].map(() => NaN))).toBeNull();
  });
});

describe('earAnchorPoints', () => {
  it('unmirrored: leftEar is the guest left ear (+x), rightEar the right', () => {
    const l = earAnchorPoints('leftEar', est, false);
    expect(l.self).toEqual([8.6, -2, -4]);
    expect(l.other).toEqual([-8.1, -2.4, -3.8]);
    const r = earAnchorPoints('rightEar', est, false);
    expect(r.self).toEqual([-8.1, -2.4, -3.8]);
    expect(r.other).toEqual([8.6, -2, -4]);
  });
  it('mirrored: the +x anchor rides the reflected RIGHT ear (as the live occluder mesh is reflected)', () => {
    const l = earAnchorPoints('leftEar', est, true);
    expect(l.self).toEqual([8.1, -2.4, -3.8]);
    expect(l.other).toEqual([-8.6, -2, -4]);
  });
  it('a default (untracked) ear reports tracked=false so the rig keeps its static, headScale-aware point', () => {
    const e: EarEstimate = { ...est, leftSource: 'default' };
    expect(earAnchorPoints('leftEar', e, false).tracked).toBe(false);
    expect(earAnchorPoints('rightEar', e, false).tracked).toBe(true);
    expect(earAnchorPoints('rightEar', e, true).tracked).toBe(false);
  });
});

describe('pairWantLocal', () => {
  it('is the ear-to-ear step, divided by the piece scale', () => {
    expect(pairWantLocal([8, -2, -4], [-8, -2, -4], undefined, 2)).toEqual([-8, 0, 0]);
  });
  it('is taken back through the piece rotation', () => {
    const w = pairWantLocal([8, 0, 0], [-8, 0, 0], { x: 0, y: Math.PI / 2, z: 0 }, 1);
    // head-space −x seen from a model yawed +90° is the model's −z... i.e. R⁻¹·(−16,0,0)
    const back = new THREE.Vector3(w[0], w[1], w[2]).applyEuler(new THREE.Euler(0, Math.PI / 2, 0));
    expect(back.x).toBeCloseTo(-16, 6);
    expect(back.z).toBeCloseTo(0, 6);
  });
});

describe('splitScenePair', () => {
  for (const indexed of [false, true]) {
    it(`splits a pair (${indexed ? 'indexed' : 'non-indexed'}), keeps the earring at the origin, and reports the authored step`, () => {
      const scene = sceneOf([...earring(0, 0.3), ...earring(-15, 0.3)], indexed);
      const mesh = scene.children[0] as THREE.Mesh;
      const original = mesh.geometry;
      const pair = splitScenePair(scene)!;
      expect(pair).not.toBeNull();
      expect(pair.authoredDelta[0]).toBeCloseTo(-15, 6);
      expect(pair.authoredDelta[1]).toBeCloseTo(0, 6);
      // near stays on the original mesh, far moved to the far group; no triangle lost
      const nearTris = mesh.geometry.getIndex()!.count / 3;
      const far = pair.farGroup.children[0] as THREE.Mesh;
      const farTris = far.geometry.getIndex()!.count / 3;
      expect(nearTris).toBe(12);
      expect(farTris).toBe(12);
      mesh.geometry.computeBoundingBox();
      expect(mesh.geometry.boundingBox).not.toBeNull();
      const pos = mesh.geometry.getAttribute('position');
      const idx = mesh.geometry.getIndex()!;
      for (let i = 0; i < idx.count; i++) expect(pos.getX(idx.getX(i))).toBeGreaterThan(-5);
      expect(far.material).toBe(mesh.material);
      // vertex buffers are shared (per-vertex region ids stay aligned)
      expect(far.geometry.getAttribute('position')).toBe(original.getAttribute('position'));
      pair.restore();
      expect(mesh.geometry).toBe(original);
      expect(scene.children.length).toBe(1);
    });
  }

  it('a right-ear pair (twin at +x) keeps the origin earring too', () => {
    const pair = splitScenePair(sceneOf([...earring(0, 0.3), ...earring(15, 0.3)]))!;
    expect(pair.authoredDelta[0]).toBeCloseTo(15, 6);
  });

  it('a single earring is left untouched', () => {
    const scene = sceneOf(earring(0, 0.3, 12));
    const g = (scene.children[0] as THREE.Mesh).geometry;
    expect(splitScenePair(scene)).toBeNull();
    expect((scene.children[0] as THREE.Mesh).geometry).toBe(g);
    expect(scene.children.length).toBe(1);
  });

  it('honours a mesh transform inside the model', () => {
    const scene = sceneOf([...earring(0, 0.3), ...earring(-5, 0.3)]);
    (scene.children[0] as THREE.Mesh).scale.setScalar(3); // the twin is 15cm away in ROOT space
    const pair = splitScenePair(scene)!;
    expect(pair.authoredDelta[0]).toBeCloseTo(-15, 5);
    const far = pair.farGroup.children[0] as THREE.Mesh;
    expect(far.scale.x).toBeCloseTo(3, 6);
  });
});
