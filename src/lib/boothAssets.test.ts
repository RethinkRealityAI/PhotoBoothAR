import { describe, it, expect } from 'vitest';
import { assetUrlsOf, selectionSignature, isPending, withLoaded } from './boothAssets';
import type { Experience, ExperienceKind } from '../types';

function exp(over: Partial<Experience> & { kind: ExperienceKind }): Experience {
  return {
    id: 'e1',
    created_at: '',
    updated_at: '',
    name: 'Test',
    asset_url: null,
    thumbnail_url: null,
    config: {},
    is_published: true,
    featured: false,
    sort_order: 0,
    ...over,
  };
}

describe('assetUrlsOf', () => {
  it('returns nothing for null/undefined', () => {
    expect(assetUrlsOf(null)).toEqual([]);
    expect(assetUrlsOf(undefined)).toEqual([]);
  });

  it('finds a single-asset frame', () => {
    expect(assetUrlsOf(exp({ kind: 'border', asset_url: 'https://x/f.png' })))
      .toEqual(['https://x/f.png']);
  });

  it('finds a single-asset 3D piece', () => {
    expect(assetUrlsOf(exp({ kind: '3d_attachment', asset_url: 'https://x/crown.glb' })))
      .toEqual(['https://x/crown.glb']);
  });

  it('finds every layer of a studio multi-layer scene', () => {
    const e = exp({
      kind: 'composite',
      config: {
        layers: [
          { id: 'a', kind: 'border', asset_url: 'https://x/a.png' },
          { id: 'b', kind: '3d_attachment', asset_url: 'https://x/b.glb' },
        ],
      },
    });
    expect(assetUrlsOf(e)).toEqual(['https://x/a.png', 'https://x/b.glb']);
  });

  it('dedupes a url that appears both on a layer and on the singular field', () => {
    const e = exp({
      kind: 'composite',
      asset_url: 'https://x/a.png',
      config: { layers: [{ id: 'a', kind: 'border', asset_url: 'https://x/a.png' }] },
    });
    expect(assetUrlsOf(e)).toEqual(['https://x/a.png']);
  });

  it('reports NOTHING pending for a procedural head piece — it has no download', () => {
    const e = exp({ kind: '3d_attachment', config: { procedural: 'royal-crown' } });
    expect(assetUrlsOf(e)).toEqual([]);
  });

  it('reports nothing for a bare shader experience', () => {
    expect(assetUrlsOf(exp({ kind: 'shader', config: { shader: { shaderId: 'prismatic-holo' } } })))
      .toEqual([]);
  });

  it('skips null and empty layer urls', () => {
    const e = exp({
      kind: 'composite',
      config: {
        layers: [
          { id: 'a', kind: 'border', asset_url: null },
          { id: 'b', kind: '3d_attachment', procedural: 'halo' },
          { id: 'c', kind: 'border', asset_url: 'https://x/c.png' },
        ],
      },
    });
    expect(assetUrlsOf(e)).toEqual(['https://x/c.png']);
  });
});

describe('selectionSignature', () => {
  it('is null when nothing is selected', () => {
    expect(selectionSignature(null, null)).toBeNull();
    expect(selectionSignature(undefined, undefined)).toBeNull();
  });

  it('distinguishes frame-only from 3D-only', () => {
    expect(selectionSignature('f1', null)).not.toBe(selectionSignature(null, 'f1'));
  });

  it('is stable for the same selection', () => {
    expect(selectionSignature('f1', 'a1')).toBe(selectionSignature('f1', 'a1'));
  });
});

describe('isPending', () => {
  it('is false when there is nothing to download', () => {
    expect(isPending([], new Set())).toBe(false);
  });

  it('is true while any url is outstanding', () => {
    expect(isPending(['a', 'b'], new Set(['a']))).toBe(true);
  });

  it('is false once every url has landed', () => {
    expect(isPending(['a', 'b'], new Set(['a', 'b']))).toBe(false);
  });
});

describe('withLoaded', () => {
  it('adds a new url', () => {
    const next = withLoaded(new Set(['a']), 'b');
    expect([...next].sort()).toEqual(['a', 'b']);
  });

  it('returns the SAME set object for a duplicate, so React can skip the render', () => {
    const s = new Set(['a']);
    expect(withLoaded(s, 'a')).toBe(s);
  });

  it('does not mutate the input set', () => {
    const s = new Set(['a']);
    withLoaded(s, 'b');
    expect([...s]).toEqual(['a']);
  });
});
