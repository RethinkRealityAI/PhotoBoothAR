import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ASSETS,
  EMPTY_HOME_ASSETS,
  FIT_PRESETS,
  LOOKS_MAX,
  WALL_MIN_PHOTOS,
  categoryForLibraryKind,
  countOverrides,
  lookFromBuiltin,
  lookFromLibraryItem,
  normalizeHomeAssets,
  pickList,
  pickWallPhotos,
  resolveAssetUrl,
} from './homeAssets';
import { DEFAULT_LANDING_CONTENT, normalizeLandingContent } from './landingContent';

const S = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets/_platform/landing';
const img = (n: string) => `${S}/${n}.webp`;
const glb = (n: string) => `${S}/${n}.glb`;
const mp4 = (n: string) => `${S}/${n}.mp4`;

describe('resolveAssetUrl', () => {
  it('accepts storage URLs of the right kind', () => {
    expect(resolveAssetUrl(img('a'), 'image')).toBe(img('a'));
    expect(resolveAssetUrl(glb('a'), 'model')).toBe(glb('a'));
    expect(resolveAssetUrl(mp4('a'), 'video')).toBe(mp4('a'));
  });
  it('rejects a kind mismatch', () => {
    expect(resolveAssetUrl(img('a'), 'model')).toBeUndefined();
    expect(resolveAssetUrl(mp4('a'), 'image')).toBeUndefined();
    expect(resolveAssetUrl(glb('a'), 'video')).toBeUndefined();
  });
  it('accepts bundled root-relative paths only in plain form', () => {
    expect(resolveAssetUrl('/models/props/royal-crown.glb', 'model')).toBe('/models/props/royal-crown.glb');
    expect(resolveAssetUrl('//evil.example/x.glb', 'model')).toBeUndefined();
    expect(resolveAssetUrl('/models/../secret.glb', 'model')).toBeUndefined();
    expect(resolveAssetUrl('/models/a b.glb', 'model')).toBeUndefined();
  });
  it('rejects foreign origins, http, data: and javascript:', () => {
    expect(resolveAssetUrl('https://evil.example/x.png', 'image')).toBeUndefined();
    expect(resolveAssetUrl(img('a').replace('https:', 'http:'), 'image')).toBeUndefined();
    expect(resolveAssetUrl('data:image/png;base64,AAAA', 'image')).toBeUndefined();
    expect(resolveAssetUrl('javascript:alert(1)//.png', 'image')).toBeUndefined();
    expect(resolveAssetUrl(42, 'image')).toBeUndefined();
  });
});

describe('normalizeHomeAssets', () => {
  it('is total: junk gives the empty overrides', () => {
    for (const raw of [undefined, null, 7, 'x', [], { films: 'x', heroLooks: {} }]) {
      expect(normalizeHomeAssets(raw)).toEqual(EMPTY_HOME_ASSETS);
    }
  });

  it('keeps valid films and drops wrong-kind media', () => {
    const out = normalizeHomeAssets({
      films: { booth: { video: mp4('b'), poster: img('p') }, wall: { video: img('nope') }, nope: { video: mp4('x') } },
    });
    expect(out.films).toEqual({ booth: { video: mp4('b'), poster: img('p') } });
  });

  it('drops looks whose url does not fit the category, and keeps the rest in order', () => {
    const out = normalizeHomeAssets({
      arLooks: [
        { id: 'c', name: 'Crown', category: 'prop', url: glb('crown') },
        { id: 'bad', name: 'Bad prop', category: 'prop', url: img('x') },
        { id: 'f', name: 'Frame', category: 'frame', url: img('frame') },
        { id: 'v', name: 'Sparkle', category: 'effect', url: mp4('sparkle') },
        { id: 'z', name: 'Unknown cat', category: 'hat', url: glb('x') },
        { id: 'n', name: '   ', category: 'frame', url: img('y') },
      ],
    });
    expect(out.arLooks.map((l) => l.id)).toEqual(['c', 'f', 'v']);
  });

  it('dedupes look ids and caps the list', () => {
    const many = Array.from({ length: LOOKS_MAX + 5 }, () => ({ id: 'same', name: 'Same', category: 'frame', url: img('f') }));
    const out = normalizeHomeAssets({ heroLooks: many });
    expect(out.heroLooks).toHaveLength(LOOKS_MAX);
    expect(new Set(out.heroLooks.map((l) => l.id)).size).toBe(LOOKS_MAX);
    expect(out.heroLooks[1].id).toBe('same-2');
  });

  it('keeps a prop fit only when complete, clamps it, and never on a non-prop', () => {
    const out = normalizeHomeAssets({
      arLooks: [
        { name: 'A', category: 'prop', url: glb('a'), fit: { width: 9, at: [0, 0.3, 0], align: 'base', tilt: -0.1 } },
        { name: 'B', category: 'prop', url: glb('b'), fit: { width: 0.3, at: [0, 0.3], align: 'base' } },
        { name: 'C', category: 'frame', url: img('c'), fit: FIT_PRESETS.crown.fit },
      ],
    });
    expect(out.arLooks[0].fit).toEqual({ width: 1.2, at: [0, 0.3, 0], align: 'base', tilt: -0.1 });
    expect(out.arLooks[1].fit).toBeUndefined();
    expect(out.arLooks[2].fit).toBeUndefined();
  });

  it('filters url lists by kind, dedupes, and validates the demo slug', () => {
    const out = normalizeHomeAssets({
      sceneProps: [glb('a'), glb('a'), img('b'), '/models/props/halo-ring.glb'],
      wallPhotos: [img('1'), mp4('2'), 'https://evil.example/x.png'],
      keepsakePhotos: [img('k')],
      challengePhoto: img('bride'),
      demoEventSlug: '  Beamy-Demo ',
    });
    expect(out.sceneProps).toEqual([glb('a'), '/models/props/halo-ring.glb']);
    expect(out.wallPhotos).toEqual([img('1')]);
    expect(out.keepsakePhotos).toEqual([img('k')]);
    expect(out.challengePhoto).toBe(img('bride'));
    expect(out.demoEventSlug).toBe('beamy-demo');
    expect(normalizeHomeAssets({ demoEventSlug: '../admin' }).demoEventSlug).toBeUndefined();
  });

  it('is idempotent and survives a JSON round trip', () => {
    const raw = {
      films: { cards: { video: mp4('c') } },
      arLooks: [{ name: 'Crown', category: 'prop', url: glb('crown'), fit: FIT_PRESETS.hat.fit, line: ' Hi  there ' }],
      wallPhotos: [img('1')],
    };
    const once = normalizeHomeAssets(raw);
    expect(normalizeHomeAssets(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(once.arLooks[0].line).toBe('Hi there');
  });
});

describe('landing_content integration', () => {
  it('the platform normalizer carries `home` through, so /admin/landing saves never drop it', () => {
    const out = normalizeLandingContent({ home: { wallPhotos: [img('1')] } });
    expect(out.home.wallPhotos).toEqual([img('1')]);
    expect(normalizeLandingContent(undefined).home).toEqual(EMPTY_HOME_ASSETS);
    expect(normalizeLandingContent(DEFAULT_LANDING_CONTENT)).toEqual(DEFAULT_LANDING_CONTENT);
  });
});

describe('page helpers', () => {
  it('pickList falls back on an empty override', () => {
    expect(pickList([], ['d'])).toEqual(['d']);
    expect(pickList(['o'], ['d'])).toEqual(['o']);
  });
  it('the wall needs enough photos to swap', () => {
    const few = normalizeHomeAssets({ wallPhotos: Array.from({ length: WALL_MIN_PHOTOS - 1 }, (_, i) => img(`w${i}`)) });
    const enough = normalizeHomeAssets({ wallPhotos: Array.from({ length: WALL_MIN_PHOTOS }, (_, i) => img(`w${i}`)) });
    expect(pickWallPhotos(few, ['d'])).toEqual(['d']);
    expect(pickWallPhotos(enough, ['d'])).toHaveLength(WALL_MIN_PHOTOS);
  });
  it('counts overrides', () => {
    expect(countOverrides(EMPTY_HOME_ASSETS)).toBe(0);
    expect(countOverrides(normalizeHomeAssets({ films: { booth: { video: mp4('b'), poster: img('p') } }, demoEventSlug: 'demo' }))).toBe(3);
  });
});

describe('library + built-in picking', () => {
  const lib = (kind: string, assetUrl: string | null, thumbnailUrl: string | null) =>
    ({ id: '0123456789abcdef', name: 'Gold crown', kind, assetUrl, thumbnailUrl });

  it('maps library kinds to homepage categories', () => {
    expect(categoryForLibraryKind('border')).toBe('frame');
    expect(categoryForLibraryKind('3d_attachment')).toBe('prop');
    expect(categoryForLibraryKind('shader')).toBe('filter');
    expect(categoryForLibraryKind('2d_filter')).toBe('effect');
  });
  it('a 3D library item becomes a fitted prop look', () => {
    const l = lookFromLibraryItem(lib('3d_attachment', glb('crown'), img('crown')));
    expect(l).toMatchObject({ category: 'prop', url: glb('crown'), thumb: img('crown'), fit: FIT_PRESETS.crown.fit });
  });
  it('a filter with no image asset falls back to its thumbnail', () => {
    expect(lookFromLibraryItem(lib('shader', null, img('after')))?.url).toBe(img('after'));
  });
  it('an item with no usable media is refused', () => {
    expect(lookFromLibraryItem(lib('3d_attachment', null, img('t')))).toBeNull();
    expect(lookFromLibraryItem(lib('border', 'https://evil.example/f.png', null))).toBeNull();
  });
  it('every built-in asset normalizes to a look', () => {
    for (const a of BUILTIN_ASSETS) expect(lookFromBuiltin(a), a.url).not.toBeNull();
  });
});
