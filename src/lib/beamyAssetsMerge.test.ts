import { describe, expect, it } from 'vitest';
import { DEFAULT_FIT_BY_CATEGORY, HOME_ASSET_DEFAULTS, arOrder, toBeamyLook } from './beamyAssets';
import { mergeHomeAssets } from './beamyAssetsMerge';
import { EMPTY_HOME_OVERRIDES, normalizeHomeAssets, presetFit } from './homeAssets';

const S = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets/_platform/landing';
const img = (n: string) => `${S}/${n}.webp`;
const glb = (n: string) => `${S}/${n}.glb`;
const D = HOME_ASSET_DEFAULTS;

describe('mergeHomeAssets', () => {
  it('no overrides: the page is exactly its bundled defaults', () => {
    const m = mergeHomeAssets(D, EMPTY_HOME_OVERRIDES);
    const { virtualPhotos, ...rest } = m;
    expect(rest).toEqual(D);
    expect(virtualPhotos).toEqual([]);
    // Same row objects, not copies: nothing downstream can tell the difference.
    expect(m.heroLooks).toBe(D.heroLooks);
    expect(m.arLooks).toBe(D.arLooks);
  });

  it('a non-empty look list replaces the bundled one, in the owner’s order', () => {
    const o = normalizeHomeAssets({
      arLooks: [
        { id: 'crown2', name: 'Silver crown', category: 'prop', url: glb('silver'), fit: presetFit('crown') },
        { id: 'gala', name: 'Gala', category: 'frame', url: img('gala'), occasion: 'Gala' },
      ],
    });
    const m = mergeHomeAssets(D, o);
    expect(m.arLooks.map((l) => l.id)).toEqual(['crown2', 'gala']);
    expect(m.heroLooks).toBe(D.heroLooks);
    // And the AR picker orders by category (frames first), as it always has.
    expect(arOrder(m.arLooks).map((l) => l.id)).toEqual(['gala', 'crown2']);
    expect(toBeamyLook(m.arLooks[0])).toMatchObject({ kind: 'prop', url: glb('silver'), fit: presetFit('crown') });
  });

  it('a bundled frame with no window of its own borrows the measured one; a prop with no fit gets the default', () => {
    const asoebi = D.arLooks.find((l) => l.id === 'ar-asoebi')!;
    const o = normalizeHomeAssets({
      arLooks: [
        { id: 'f', name: 'Arch', category: 'frame', url: asoebi.url },
        { id: 'p', name: 'P', category: 'prop', url: glb('p') },
      ],
    });
    const m = mergeHomeAssets(D, o);
    expect(m.arLooks[0].opening).toEqual(asoebi.opening);
    expect(m.arLooks[1].fit).toEqual(DEFAULT_FIT_BY_CATEGORY.prop);
  });

  it('scene props swap by index; blanks and missing spots keep the bundled prop', () => {
    const m = mergeHomeAssets(D, normalizeHomeAssets({ sceneProps: ['', glb('b')] }));
    expect(m.sceneProps).toHaveLength(D.sceneProps.length);
    expect(m.sceneProps[0]).toBe(D.sceneProps[0]);
    expect(m.sceneProps[1]).toBe(glb('b'));
    expect(m.sceneProps.slice(2)).toEqual(D.sceneProps.slice(2));
  });

  it('photo pools apply only once they are big enough to run the section', () => {
    const few = normalizeHomeAssets({ wallPhotos: [img('1'), img('2')], keepsakePhotos: [img('k')] });
    expect(mergeHomeAssets(D, few).wallPhotos).toEqual(D.wallPhotos);
    expect(mergeHomeAssets(D, few).keepsakePhotos).toEqual(D.keepsakePhotos);
    const wall = Array.from({ length: 10 }, (_, i) => img(`w${i}`));
    const album = Array.from({ length: 6 }, (_, i) => img(`k${i}`));
    const m = mergeHomeAssets(D, normalizeHomeAssets({ wallPhotos: wall, keepsakePhotos: album, virtualPhotos: [img('v')], challengePhoto: img('c'), demoEventSlug: 'my-demo' }));
    expect(m.wallPhotos).toEqual(wall);
    expect(m.keepsakePhotos).toEqual(album);
    expect(m.virtualPhotos).toEqual([img('v')]);
    expect(m.challengePhoto).toBe(img('c'));
    expect(m.demoEventSlug).toBe('my-demo');
  });
});
