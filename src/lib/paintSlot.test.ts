import { describe, it, expect } from 'vitest';
import { mergePaintLayers, singlePropLayer, SINGLE_PROP_LAYER_ID } from './paintSlot';
import { isPristine } from './boothDeck';
import type { Experience } from '../types';

const ANCHOR = { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };

function exp(id: string, config: Record<string, unknown>, asset_url: string | null = null): Experience {
  return { id, name: id, kind: '3d_attachment', asset_url, config } as unknown as Experience;
}

const paint = exp('paint', { procedural: 'face-paint', anchor: ANCHOR, layers: [
  { id: 'l1', kind: '3d_attachment', anchor: ANCHOR, procedural: 'face-paint', facePaint: { design: 'tiger' } },
] });
const layeredProp = exp('crown', { anchor: ANCHOR, layers: [
  { id: 'l1', kind: '3d_attachment', anchor: ANCHOR, asset_url: '/crown.glb' },
] });
const singleProp = exp('hat', { anchor: ANCHOR, occlusion: true }, '/hat.glb');

describe('mergePaintLayers', () => {
  it('returns the prop\'s own layers BY REFERENCE when no paint is on', () => {
    expect(mergePaintLayers(layeredProp, null)).toBe(layeredProp.config!.layers);
    expect(mergePaintLayers(singleProp, null)).toBeUndefined();
    expect(mergePaintLayers(null, null)).toBeUndefined();
  });

  it('is just the paint when no prop is on', () => {
    expect(mergePaintLayers(null, paint)).toEqual(paint.config!.layers);
  });

  it('puts the paint after a layered prop, renaming a clashing id', () => {
    const out = mergePaintLayers(layeredProp, paint)!;
    expect(out.map((l) => l.id)).toEqual(['l1', 'paint:l1']);
    expect(out[0]).toBe(layeredProp.config!.layers![0]);
    expect(out[1].facePaint).toEqual({ design: 'tiger' });
  });

  it('turns a single-piece prop into one layer so it is not dropped', () => {
    const out = mergePaintLayers(singleProp, paint)!;
    expect(out.map((l) => l.id)).toEqual([SINGLE_PROP_LAYER_ID, 'l1']);
    expect(out[0]).toEqual({ id: SINGLE_PROP_LAYER_ID, kind: '3d_attachment', asset_url: '/hat.glb', anchor: ANCHOR, occlusion: true });
  });

  it('ignores a "paint" that is not a paint look', () => {
    expect(mergePaintLayers(layeredProp, layeredProp)).toBe(layeredProp.config!.layers);
  });
});

describe('singlePropLayer', () => {
  it('needs an anchor and something to draw', () => {
    expect(singlePropLayer(exp('x', {}, '/x.glb'))).toBeNull();
    expect(singlePropLayer(exp('x', { anchor: ANCHOR }))).toBeNull();
    expect(singlePropLayer(exp('x', { anchor: ANCHOR, procedural: 'crown' }))).toEqual({
      id: SINGLE_PROP_LAYER_ID, kind: '3d_attachment', asset_url: null, anchor: ANCHOR, procedural: 'crown',
    });
  });
});

describe('isPristine with a paint slot', () => {
  it('is not pristine while a paint is on', () => {
    const base = { effectId: 'none', frameId: null, attachmentId: null };
    expect(isPristine(base, false)).toBe(true);
    expect(isPristine({ ...base, paintId: null }, false)).toBe(true);
    expect(isPristine({ ...base, paintId: 'fp1' }, false)).toBe(false);
  });
});
