/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  AXIS_VECTORS,
  DEFAULT_FRONT_AXIS,
  axisIndex,
  bandRegionIds,
  boundsCenter,
  boundsOfPositions,
  boundsSize,
  buildTemplateDescriptor,
  connectedComponents,
  descriptorJson,
  nearestAxis,
  paintSphere,
  proposeDecalDepth,
  proposeFitCm,
  proposeTextAnchor,
  usedRegionIndices,
  type PrepBounds,
} from './assetPrep';
import { normalizeTemplate } from './assetTemplate';
import { MAX_REGIONS, unpackRegionIds } from './regionTint';

const BOX: PrepBounds = { min: [-1, -2, -3], max: [1, 2, 3] };

describe('bounds', () => {
  it('measures size and centre', () => {
    expect(boundsSize(BOX)).toEqual([2, 4, 6]);
    expect(boundsCenter(BOX)).toEqual([0, 0, 0]);
  });

  it('reads a position buffer', () => {
    const b = boundsOfPositions(new Float32Array([0, 0, 0, 1, 2, 3, -1, 5, 0]))!;
    expect(b.min).toEqual([-1, 0, 0]);
    expect(b.max).toEqual([1, 5, 3]);
  });

  it('refuses an empty or non-finite buffer rather than returning Infinity', () => {
    expect(boundsOfPositions(new Float32Array([]))).toBeNull();
    expect(boundsOfPositions([0, 0, NaN])).toBeNull();
  });
});

describe('axes', () => {
  it('snaps to the nearest cardinal', () => {
    expect(nearestAxis([0.1, 0.2, 0.95])).toBe('+z');
    expect(nearestAxis([-0.9, 0.1, 0])).toBe('-x');
    expect(nearestAxis([0, -1, 0])).toBe('-y');
  });
  it('maps an id to its component', () => {
    expect(axisIndex('+x')).toBe(0);
    expect(axisIndex('-y')).toBe(1);
    expect(axisIndex('+z')).toBe(2);
  });
});

describe('proposeFitCm', () => {
  it('treats a ~1-unit export as normalised and takes the stated real size', () => {
    const p = proposeFitCm(1.05, 20);
    expect(p.fitCm).toBe(20);
    expect(p.confident).toBe(true);
  });

  it('takes a 5..300 unit model at face value as centimetres', () => {
    const p = proposeFitCm(18.4, 20);
    expect(p.fitCm).toBeCloseTo(18.4);
    expect(p.confident).toBe(true);
  });

  it('is NOT confident for a magnitude that means neither, and says so', () => {
    const tiny = proposeFitCm(0.004, 20);
    expect(tiny.confident).toBe(false);
    expect(tiny.reason).toContain('check this one');
    expect(proposeFitCm(9000, 20).confident).toBe(false);
    expect(proposeFitCm(0, 20).confident).toBe(false);
    expect(proposeFitCm(NaN, 20).confident).toBe(false);
  });

  it('never proposes a size outside the template bounds', () => {
    expect(proposeFitCm(1, 100000).fitCm).toBe(200);
    expect(proposeFitCm(1, -5).fitCm).toBe(0.5);
  });
});

describe('proposeTextAnchor', () => {
  it('lands ON the front face, not inside the model', () => {
    const a = proposeTextAnchor(BOX, '+z', 0.5);
    expect(a.position[2]).toBe(BOX.max[2]);
    expect(a.normal).toEqual(AXIS_VECTORS['+z']);
  });

  it('honours the negative half-axis', () => {
    expect(proposeTextAnchor(BOX, '-x').position[0]).toBe(BOX.min[0]);
    expect(proposeTextAnchor(BOX, '-x').normal).toEqual([-1, 0, 0]);
  });

  it('slides along the model vertical, clamped', () => {
    expect(proposeTextAnchor(BOX, '+z', 0).position[1]).toBe(-2);
    expect(proposeTextAnchor(BOX, '+z', 1).position[1]).toBe(2);
    expect(proposeTextAnchor(BOX, '+z', 9).position[1]).toBe(2);
    expect(proposeTextAnchor(BOX, '+z', NaN).position[1]).toBe(0);
  });

  it('gives a usable up even when the front IS the world up — the collapsed-basis case', () => {
    const a = proposeTextAnchor(BOX, '+y');
    const dot = a.up[0] * a.normal[0] + a.up[1] * a.normal[1] + a.up[2] * a.normal[2];
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });
});

describe('proposeDecalDepth', () => {
  it('is a shallow fraction of the depth along the projection axis', () => {
    expect(proposeDecalDepth(BOX, '+z')).toBeCloseTo(6 * 0.12);
    expect(proposeDecalDepth(BOX, '+x')).toBeCloseTo(2 * 0.12);
  });
  it('stays inside the template bounds for a degenerate box', () => {
    const flat: PrepBounds = { min: [0, 0, 0], max: [0, 0, 0] };
    expect(proposeDecalDepth(flat, '+z')).toBeGreaterThanOrEqual(0.001);
  });
});

describe('connectedComponents — the reason the prep tool needs a human', () => {
  // Two disjoint triangles.
  const twoTris = {
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      5, 5, 5, 6, 5, 5, 5, 6, 5,
    ]),
    indices: new Uint16Array([0, 1, 2, 3, 4, 5]),
  };

  it('finds genuinely separate shells', () => {
    const r = connectedComponents(twoTris.positions, twoTris.indices);
    expect(r.count).toBe(2);
    expect(Array.from(r.ids)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('WELDS a seam-duplicated vertex — the exporter split that fakes extra parts', () => {
    // One quad as two triangles, but the shared edge's two vertices are
    // DUPLICATED (what a glTF exporter does at a UV seam). Raw union-find sees
    // two components; the physical object is one.
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 1, 1, 0, 0, 1, 0,
    ]);
    const indices = new Uint16Array([0, 1, 2, 3, 4, 5]);
    const r = connectedComponents(positions, indices);
    expect(r.rawCount).toBe(2);
    expect(r.count).toBe(1);
    expect(Array.from(r.ids)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('handles a NON-indexed buffer (every three vertices a triangle)', () => {
    const r = connectedComponents(twoTris.positions, null);
    expect(r.count).toBe(2);
  });

  it('returns nothing rather than throwing on an empty mesh', () => {
    expect(connectedComponents(new Float32Array([]), null)).toEqual({
      count: 0, rawCount: 0, ids: new Uint32Array(0),
    });
  });

  it('ignores an out-of-range index instead of reading past the buffer', () => {
    const r = connectedComponents(twoTris.positions, new Uint16Array([0, 1, 2, 99, 100, 101]));
    expect(r.count).toBeGreaterThan(0);
  });
});

describe('bandRegionIds', () => {
  const positions = new Float32Array([
    0, -2, 0,   // bottom
    0, 0, 0,    // middle
    0, 2, 0,    // top
  ]);
  const bounds: PrepBounds = { min: [0, -2, 0], max: [0, 2, 0] };

  it('slices along the axis, top vertex included in the LAST band not a new one', () => {
    expect(Array.from(bandRegionIds(positions, bounds, '+y', 2))).toEqual([0, 1, 1]);
    expect(Array.from(bandRegionIds(positions, bounds, '+y', 3))).toEqual([0, 1, 2]);
  });

  it('reverses for a negative axis', () => {
    expect(Array.from(bandRegionIds(positions, bounds, '-y', 3))).toEqual([2, 1, 0]);
  });

  it('one band, a zero-span axis, and a junk count all give "everything is region 0"', () => {
    expect(Array.from(bandRegionIds(positions, bounds, '+y', 1))).toEqual([0, 0, 0]);
    expect(Array.from(bandRegionIds(positions, bounds, '+x', 4))).toEqual([0, 0, 0]);
    expect(Array.from(bandRegionIds(positions, bounds, '+y', NaN))).toEqual([0, 0, 0]);
  });

  it('never exceeds the GLSL uniform bound', () => {
    const ids = bandRegionIds(positions, bounds, '+y', 99);
    expect(Math.max(...ids)).toBeLessThanOrEqual(MAX_REGIONS - 1);
  });
});

describe('paintSphere — the human correction', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 10, 0, 0]);

  it('repaints only what it reaches and REPORTS the count', () => {
    const ids = new Uint8Array(3);
    expect(paintSphere(positions, ids, [0, 0, 0], 1.5, 2)).toBe(2);
    expect(Array.from(ids)).toEqual([2, 2, 0]);
  });

  it('reports 0 for a click that changed nothing — an edit the tool must not count', () => {
    const ids = new Uint8Array([2, 2, 0]);
    expect(paintSphere(positions, ids, [0, 0, 0], 1.5, 2)).toBe(0);
    expect(paintSphere(positions, ids, [50, 50, 50], 1, 3)).toBe(0);
    expect(paintSphere(positions, ids, [0, 0, 0], 0, 3)).toBe(0);
  });

  it('clamps the region into the uniform array bound', () => {
    const ids = new Uint8Array(3);
    paintSphere(positions, ids, [0, 0, 0], 100, 999);
    expect(ids[0]).toBe(MAX_REGIONS - 1);
    paintSphere(positions, ids, [0, 0, 0], 100, -4);
    expect(ids[0]).toBe(0);
  });
});

describe('usedRegionIndices', () => {
  it('lists what is actually painted, sorted', () => {
    expect(usedRegionIndices(new Uint8Array([3, 0, 3, 1]))).toEqual([0, 1, 3]);
  });
});

describe('buildTemplateDescriptor', () => {
  const region = (index: number, id: string) => ({
    index, id, label: '', recolourable: true, defaultHex: '#ffffff', refLuminance: 0.18,
  });
  const base = {
    id: 'demo-cap',
    name: 'Demo Cap',
    glbUrl: '/models/demo.glb',
    fitCm: 20,
    frontAxis: DEFAULT_FRONT_AXIS,
    textSlots: [],
    humanEdited: false,
  };

  it("preparedBy is 'auto' ONLY when nobody touched it", () => {
    expect(buildTemplateDescriptor({ ...base, regions: [region(0, 'body')], regionIds: null }).preparedBy).toBe('auto');
    expect(buildTemplateDescriptor({ ...base, regions: [region(0, 'body')], regionIds: null, humanEdited: true }).preparedBy).toBe('human');
  });

  it('DROPS a region no vertex carries — a colour control that does nothing', () => {
    const ids = new Uint8Array([0, 0, 2]);
    const t = buildTemplateDescriptor({
      ...base,
      regions: [region(0, 'crown'), region(1, 'brim'), region(2, 'button')],
      regionIds: ids,
    });
    expect(t.regions.map((r) => r.id)).toEqual(['crown', 'button']);
  });

  it('omits the packed ids when there is only ONE region to distinguish', () => {
    const t = buildTemplateDescriptor({ ...base, regions: [region(0, 'body')], regionIds: new Uint8Array([0, 0, 0]) });
    expect(t.regionIds).toBeUndefined();
  });

  it('packs the ids round-trippably when there is more than one', () => {
    const ids = new Uint8Array([0, 1, 1, 0]);
    const t = buildTemplateDescriptor({
      ...base, regions: [region(0, 'crown'), region(1, 'brim')], regionIds: ids,
    });
    expect(Array.from(unpackRegionIds(t.regionIds)!)).toEqual([0, 1, 1, 0]);
  });

  it('labels an unlabelled region and slot with its own id', () => {
    const t = buildTemplateDescriptor({
      ...base,
      regions: [region(0, 'crown')],
      regionIds: null,
      textSlots: [{ id: 'front', position: [0, 0, 1], normal: [0, 0, 1], up: [0, 1, 0], maxWidthCm: 6, decalDepth: 0.5 }],
    });
    expect(t.regions[0].label).toBe('crown');
    expect(t.textSlots[0].label).toBe('front');
  });

  it('produces something normalizeTemplate accepts UNCHANGED — the tool cannot emit a descriptor the app rejects', () => {
    const ids = new Uint8Array([0, 1, 1, 0]);
    const t = buildTemplateDescriptor({
      ...base,
      humanEdited: true,
      regions: [region(0, 'crown'), region(1, 'brim')],
      regionIds: ids,
      textSlots: [{ id: 'front', position: [0, 0, 1], normal: [0, 0, 1], up: [0, 1, 0], maxWidthCm: 6, decalDepth: 0.5 }],
    });
    // Round-tripped through JSON exactly as a human pastes it into the catalogue.
    expect(normalizeTemplate(JSON.parse(descriptorJson(t)))).toEqual(t);
  });
});
