import { describe, it, expect } from 'vitest';
import { assetUrlsOf, selectionSignature, isPending, withLoaded, drawableScene, glbPreloadQueue, MAX_PRELOADED_MODELS, layersWantGuestName } from './boothAssets';
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

describe('drawableScene (prop switch)', () => {
  const shades = { url: 'https://x/shades.glb', scene: 'SHADES' };
  it('draws nothing before the first load', () => {
    expect(drawableScene(null, 'https://x/shades.glb', true)).toBeNull();
    expect(drawableScene(null, 'https://x/shades.glb', false)).toBeNull();
  });
  it('draws the loaded scene for its own url', () => {
    expect(drawableScene(shades, 'https://x/shades.glb', true)).toBe('SHADES');
  });
  it('hides the previous prop while the next one loads', () => {
    expect(drawableScene(shades, 'https://x/beanie.glb', true)).toBeNull();
  });
  it('keeps the old behaviour (draw the kept scene) when not opted in', () => {
    expect(drawableScene(shades, 'https://x/beanie.glb', false)).toBe('SHADES');
  });
});

describe('glbPreloadQueue', () => {
  const none = () => false;
  it('lists 3D GLBs in catalogue order, skipping 2D and procedural pieces', () => {
    const catalog = [
      exp({ id: 'f', kind: 'border', asset_url: 'https://x/frame.png' }),
      exp({ id: 'a', kind: '3d_attachment', asset_url: 'https://x/shades.glb' }),
      exp({ id: 'p', kind: '3d_attachment', config: { procedural: 'crown' } }),
      exp({
        id: 'c', kind: 'composite',
        config: { layers: [
          { id: 'l1', kind: 'border', asset_url: 'https://x/f2.png' },
          { id: 'l2', kind: '3d_attachment', asset_url: 'https://x/beanie.glb' },
          { id: 'l3', kind: '3d_attachment', asset_url: 'https://x/shades.glb' },
        ] },
      }),
    ];
    expect(glbPreloadQueue(catalog, none)).toEqual(['https://x/shades.glb', 'https://x/beanie.glb']);
  });
  it('skips models already parsed', () => {
    const catalog = [
      exp({ id: 'a', kind: '3d_attachment', asset_url: 'https://x/a.glb' }),
      exp({ id: 'b', kind: '3d_attachment', asset_url: 'https://x/b.glb' }),
    ];
    expect(glbPreloadQueue(catalog, (u) => u === 'https://x/a.glb')).toEqual(['https://x/b.glb']);
  });
  it('caps the list so memory stays bounded', () => {
    const catalog = Array.from({ length: 20 }, (_, i) =>
      exp({ id: `e${i}`, kind: '3d_attachment', asset_url: `https://x/m${i}.glb` }));
    expect(glbPreloadQueue(catalog, none)).toHaveLength(MAX_PRELOADED_MODELS);
    expect(glbPreloadQueue(catalog, none, 2)).toEqual(['https://x/m0.glb', 'https://x/m1.glb']);
    expect(glbPreloadQueue(catalog, none, 0)).toEqual([]);
  });
  it('ignores 2D layers on a frame-only composite and empty urls', () => {
    const catalog = [
      exp({ id: 'c', kind: 'composite', config: { layers: [{ id: 'l', kind: 'border', asset_url: 'https://x/a.png' }] } }),
      exp({ id: 'e', kind: '3d_attachment', asset_url: '' }),
    ];
    expect(glbPreloadQueue(catalog, none)).toEqual([]);
  });
});

describe('layersWantGuestName', () => {
  const cap = (token: string) => ({ kind: '3d_attachment', customization: { label: { slotId: 'front', token, style: 'block', hex: '#fff' } } });
  it('is true only for a 3D layer whose label is the guest name', () => {
    expect(layersWantGuestName([cap('guestName')])).toBe(true);
    expect(layersWantGuestName([{ kind: '3d_attachment' }, cap('guestName')])).toBe(true);
  });
  it('is false for a fixed label, no label, a 2D layer or no layers', () => {
    expect(layersWantGuestName([cap('fixed')])).toBe(false);
    expect(layersWantGuestName([{ kind: '3d_attachment', customization: { parts: { crown: { hex: '#c8102e' } } } }])).toBe(false);
    expect(layersWantGuestName([{ kind: 'border', customization: { label: { token: 'guestName' } } }])).toBe(false);
    expect(layersWantGuestName([])).toBe(false);
    expect(layersWantGuestName(undefined)).toBe(false);
    expect(layersWantGuestName([{ kind: '3d_attachment', customization: 'junk' }])).toBe(false);
  });
});
