import { describe, expect, it } from 'vitest';
import { DEFAULT_FIT_BY_CATEGORY, HOME_ASSET_DEFAULTS as D } from './beamyAssets';
import { mergeHomeAssets } from './beamyAssetsMerge';
import { heroTour } from './beamyLooks';
import { EMPTY_HOME_ASSETS, normalizeHomeAssets } from './homeAssets';

const S = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets/_platform/landing/';
const merge = (raw: unknown) => mergeHomeAssets(D, normalizeHomeAssets(raw));

describe('mergeHomeAssets', () => {
  it('an empty CMS renders the bundled homepage unchanged', () => {
    expect(mergeHomeAssets(D, EMPTY_HOME_ASSETS)).toEqual(D);
  });

  it('films override per field; the other field stays bundled', () => {
    const m = merge({ films: { wall: { video: `${S}w.mp4` } } });
    expect(m.films.wall).toEqual({ video: `${S}w.mp4` });
    expect(m.films.booth).toEqual(D.films.booth);
  });

  it('a non-empty look list replaces the defaults; props get a fit', () => {
    const m = merge({ heroLooks: [{ id: 'cap', name: 'Cap', category: 'prop', url: `${S}cap.glb` }] });
    expect(m.heroLooks).toHaveLength(1);
    expect(m.heroLooks[0].fit).toEqual(DEFAULT_FIT_BY_CATEGORY.prop);
    expect(m.arLooks).toBe(D.arLooks);
  });

  it('a frame without a window borrows the measured one of the same bundled file', () => {
    const def = D.arLooks.find((l) => l.id === 'ar-sangeet');
    const m = merge({ arLooks: [{ id: 'mine', name: 'Mine', category: 'frame', url: def?.url }] });
    expect(m.arLooks[0].opening).toEqual(def?.opening);
  });

  it('a frame with its own window keeps it', () => {
    const m = merge({ arLooks: [{ id: 'mine', name: 'Mine', category: 'frame', url: `${S}f.png`, opening: { top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 } }] });
    expect(m.arLooks[0].opening).toEqual({ top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 });
  });

  it('scene props replace by position; missing slots keep the bundled prop', () => {
    const m = merge({ sceneProps: [`${S}a.glb`] });
    expect(m.sceneProps).toHaveLength(D.sceneProps.length);
    expect(m.sceneProps[0]).toBe(`${S}a.glb`);
    expect(m.sceneProps.slice(1)).toEqual(D.sceneProps.slice(1));
  });

  it('wall photos need a full wall; challenge, slug and keepsakes override', () => {
    const few = Array.from({ length: 4 }, (_, i) => `${S}p${i}.jpg`);
    const many = Array.from({ length: 12 }, (_, i) => `${S}p${i}.jpg`);
    expect(merge({ wallPhotos: few }).wallPhotos).toEqual(D.wallPhotos);
    expect(merge({ wallPhotos: many }).wallPhotos).toEqual(many);
    const m = merge({ challengePhoto: `${S}c.jpg`, demoEventSlug: 'my-demo', keepsakePhotos: few });
    expect(m.challengePhoto).toBe(`${S}c.jpg`);
    expect(m.demoEventSlug).toBe('my-demo');
    expect(m.keepsakePhotos).toEqual(few);
  });
});

describe('heroTour', () => {
  it('greets first, then the wearable looks; filters/effects are skipped', () => {
    const t = heroTour([...D.heroLooks, { id: 'f', name: 'F', category: 'filter', url: 'tint:prismatic' }]);
    expect(t[0].id).toBe('hello');
    expect(t.map((l) => l.id).slice(1)).toEqual(D.heroLooks.map((l) => l.id));
  });
});
