import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_IDS,
  ANCHOR_PRESETS,
  AR_LOOKS_MAX,
  EMPTY_HOME_OVERRIDES,
  FIT_WIDTH_MAX,
  anchorOf,
  countOverrides,
  guessAnchor,
  lookUrlKind,
  normalizeFit,
  normalizeHomeAssets,
  presetFit,
  resolveAssetUrl,
  tintSwatch,
} from './homeAssets';
import {
  BUILTIN_ASSETS,
  BUILTIN_EFFECT_LOOKS,
  categoryForLibraryKind,
  editableDefaults,
  lookFromBuiltin,
  lookFromLibraryItem,
} from './homeAssetSources';
import { HOME_ASSET_DEFAULTS, lookAction } from './beamyAssets';
import { DEFAULT_LANDING_CONTENT, normalizeLandingContent } from './landingContent';

const S = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets/_platform/landing';
const img = (n: string) => `${S}/${n}.webp`;
const glb = (n: string) => `${S}/${n}.glb`;
const mp4 = (n: string) => `${S}/${n}.mp4`;
const PUBLIC = resolve(__dirname, '../../public');

describe('resolveAssetUrl', () => {
  it('accepts storage public-object URLs of the right kind', () => {
    expect(resolveAssetUrl(img('a'), 'image')).toBe(img('a'));
    expect(resolveAssetUrl(glb('a'), 'model')).toBe(glb('a'));
    expect(resolveAssetUrl(mp4('a'), 'video')).toBe(mp4('a'));
  });
  it('rejects a kind mismatch', () => {
    expect(resolveAssetUrl(img('a'), 'model')).toBeUndefined();
    expect(resolveAssetUrl(mp4('a'), 'image')).toBeUndefined();
    expect(resolveAssetUrl(glb('a'), 'video')).toBeUndefined();
  });
  it('accepts same-origin bundled files under /models and /guides only', () => {
    expect(resolveAssetUrl('/models/props/royal-crown.glb', 'model')).toBe('/models/props/royal-crown.glb');
    expect(resolveAssetUrl('/guides/frames/nye-countdown.png', 'image')).toBe('/guides/frames/nye-countdown.png');
    expect(resolveAssetUrl('/assets/x.png', 'image')).toBeUndefined();
    expect(resolveAssetUrl('/mascot/beamy.glb', 'model')).toBeUndefined();
    expect(resolveAssetUrl('//evil.example/models/x.glb', 'model')).toBeUndefined();
    expect(resolveAssetUrl('/models/../secret.glb', 'model')).toBeUndefined();
    expect(resolveAssetUrl('/models/a b.glb', 'model')).toBeUndefined();
  });
  it('rejects foreign origins, http, credentials, non-public storage paths, data: and javascript:', () => {
    expect(resolveAssetUrl('https://evil.example/x.png', 'image')).toBeUndefined();
    expect(resolveAssetUrl('https://evil.example/x/storage/v1/object/public/x.png', 'image')).toBeUndefined();
    expect(resolveAssetUrl(img('a').replace('https:', 'http:'), 'image')).toBeUndefined();
    expect(resolveAssetUrl(img('a').replace('https://', 'https://u:p@'), 'image')).toBeUndefined();
    expect(resolveAssetUrl(img('a').replace('/public/', '/sign/'), 'image')).toBeUndefined();
    expect(resolveAssetUrl('data:image/png;base64,AAAA', 'image')).toBeUndefined();
    expect(resolveAssetUrl('javascript:alert(1)//.png', 'image')).toBeUndefined();
    expect(resolveAssetUrl(42, 'image')).toBeUndefined();
  });
});

describe('lookUrlKind', () => {
  it('knows the page built-ins: tint colours and every effect the page draws', () => {
    expect(lookUrlKind('tint:prismatic', 'filter')).toBe('builtin');
    expect(lookUrlKind('tint:#34D399', 'filter')).toBe('builtin');
    expect(lookUrlKind('tint:red', 'filter')).toBeUndefined();
    for (const fx of ['sparkles', 'snow', 'confetti', 'hearts', 'notes', 'spotlight']) expect(lookUrlKind(`fx:${fx}`, 'effect')).toBe('builtin');
    expect(lookUrlKind('fx:lasers', 'effect')).toBeUndefined();
    expect(lookUrlKind('fx:snow', 'filter')).toBeUndefined();
    expect(lookUrlKind(mp4('sparkle'), 'effect')).toBe('video');
    expect(lookUrlKind(mp4('sparkle'), 'frame')).toBeUndefined();
  });
  it('shows a swatch for tints', () => {
    expect(tintSwatch('tint:#FFB547')).toBe('#FFB547');
    expect(tintSwatch('tint:prismatic')).toMatch(/gradient/);
    expect(tintSwatch('fx:snow')).toBeUndefined();
  });
});

describe('normalizeHomeAssets', () => {
  it('is total: junk gives the empty overrides', () => {
    for (const raw of [undefined, null, 7, 'x', [], { heroLooks: {}, arLooks: 'x', sceneProps: 3 }]) {
      expect(normalizeHomeAssets(raw)).toEqual(EMPTY_HOME_OVERRIDES);
    }
  });

  it('drops an old draft’s film slots (the films live on /guides now)', () => {
    const out = normalizeHomeAssets({ films: { booth: { video: mp4('b') } } });
    expect(out).toEqual(EMPTY_HOME_OVERRIDES);
    expect('films' in out).toBe(false);
  });

  it('drops looks whose url does not fit the category, keeping the rest in order', () => {
    const out = normalizeHomeAssets({
      arLooks: [
        { id: 'c', name: 'Crown', category: 'prop', url: glb('crown') },
        { id: 'bad', name: 'Bad prop', category: 'prop', url: img('x') },
        { id: 'f', name: 'Frame', category: 'frame', url: img('frame') },
        { id: 'v', name: 'Sparkle', category: 'effect', url: mp4('sparkle') },
        { id: 't', name: 'Tint', category: 'filter', url: 'tint:#fff' },
        { id: 'z', name: 'Unknown cat', category: 'hat', url: glb('x') },
        { id: 'n', name: '   ', category: 'frame', url: img('y') },
        { id: 'e', name: 'Evil', category: 'frame', url: 'https://evil.example/f.png' },
      ],
    });
    expect(out.arLooks.map((l) => l.id)).toEqual(['c', 'f', 'v', 't']);
  });

  it('keeps only frames and props in the hero (a filter has nothing to put on him)', () => {
    const out = normalizeHomeAssets({
      heroLooks: [
        { id: 'a', name: 'A', category: 'prop', url: glb('a') },
        { id: 't', name: 'Tint', category: 'filter', url: 'tint:#fff' },
        { id: 'f', name: 'F', category: 'frame', url: img('f') },
      ],
    });
    expect(out.heroLooks.map((l) => l.id)).toEqual(['a', 'f']);
  });

  it('dedupes look ids and caps the list', () => {
    const many = Array.from({ length: AR_LOOKS_MAX + 5 }, () => ({ id: 'same', name: 'Same', category: 'prop', url: glb('a') }));
    const out = normalizeHomeAssets({ arLooks: many });
    expect(out.arLooks).toHaveLength(AR_LOOKS_MAX);
    expect(new Set(out.arLooks.map((l) => l.id)).size).toBe(AR_LOOKS_MAX);
    expect(out.arLooks[1].id).toBe('same-2');
  });

  it('keeps a frame’s occasion, window and worn-with prop, and drops a bad window', () => {
    const out = normalizeHomeAssets({
      arLooks: [
        { id: 'f', name: 'F', category: 'frame', url: img('f'), occasion: '  Gala  night ', opening: { top: 0.2, bottom: 0.9, left: 0.1, right: 0.9 }, with: glb('hat'), fit: presetFit('hat') },
        { id: 'g', name: 'G', category: 'frame', url: img('g'), opening: { top: 0.8, bottom: 0.2, left: 0, right: 1 }, with: img('nope') },
      ],
    });
    expect(out.arLooks[0]).toMatchObject({ occasion: 'Gala night', opening: { top: 0.2, bottom: 0.9, left: 0.1, right: 0.9 }, with: glb('hat'), fit: presetFit('hat') });
    expect(out.arLooks[1].opening).toBeUndefined();
    expect(out.arLooks[1].with).toBeUndefined();
    expect(out.arLooks[1].fit).toBeUndefined();
  });

  it('only props and worn-with frames carry a fit; an occasion is frames-only', () => {
    const out = normalizeHomeAssets({
      arLooks: [
        { id: 'p', name: 'P', category: 'prop', url: glb('p'), fit: presetFit('neck'), occasion: 'x' },
        { id: 't', name: 'T', category: 'filter', url: 'tint:#fff', fit: presetFit('neck') },
      ],
    });
    expect(out.arLooks[0].fit).toEqual(presetFit('neck'));
    expect(out.arLooks[0].occasion).toBeUndefined();
    expect(out.arLooks[1].fit).toBeUndefined();
  });

  it('keeps scene props by index (a blank keeps the page’s prop there) and drops a wrong-kind file', () => {
    const out = normalizeHomeAssets({ sceneProps: [null, glb('a'), img('b'), glb('c'), '', ''] });
    expect(out.sceneProps).toEqual(['', glb('a'), '', glb('c')]);
  });

  it('validates the photos, the challenge photo and the demo slug', () => {
    const out = normalizeHomeAssets({
      wallPhotos: [img('1'), img('1'), 'https://evil.example/x.png', img('2')],
      keepsakePhotos: [img('k')],
      virtualPhotos: [img('v'), glb('nope')],
      challengePhoto: mp4('no'),
      demoEventSlug: '  Beamy-Demo ',
    });
    expect(out.wallPhotos).toEqual([img('1'), img('2')]);
    expect(out.keepsakePhotos).toEqual([img('k')]);
    expect(out.virtualPhotos).toEqual([img('v')]);
    expect(out.challengePhoto).toBeUndefined();
    expect(out.demoEventSlug).toBe('beamy-demo');
    expect(normalizeHomeAssets({ demoEventSlug: '../x' }).demoEventSlug).toBeUndefined();
  });

  it('is idempotent', () => {
    const raw = {
      heroLooks: HOME_ASSET_DEFAULTS.heroLooks,
      arLooks: [...HOME_ASSET_DEFAULTS.arLooks, { id: 'x', name: 'X', category: 'prop', url: glb('x'), fit: { width: 9, at: [0, 5, 0], align: 'base', tilt: 3 } }],
      sceneProps: [glb('a')], wallPhotos: [img('a')], challengePhoto: img('c'), demoEventSlug: 'demo',
    };
    const once = normalizeHomeAssets(raw);
    expect(normalizeHomeAssets(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('counts custom slots for the admin badge', () => {
    expect(countOverrides(EMPTY_HOME_OVERRIDES)).toBe(0);
    expect(countOverrides(normalizeHomeAssets({
      arLooks: [{ id: 'c', name: 'C', category: 'prop', url: glb('c') }],
      sceneProps: ['', glb('a')], wallPhotos: [img('1')], challengePhoto: img('c'),
    }))).toBe(3); // the wall needs 10 photos to count
  });
});

describe('the page’s own bundled looks survive the CMS round trip', () => {
  it('every default hero and AR look normalizes to itself, so "Customize" starts from exactly what ships', () => {
    const d = editableDefaults();
    expect(d.heroLooks).toEqual(HOME_ASSET_DEFAULTS.heroLooks);
    expect(d.arLooks).toEqual(HOME_ASSET_DEFAULTS.arLooks);
  });
});

describe('fits and anchors', () => {
  it('clamps a fit into bounds and keeps an earring pair’s spacing', () => {
    expect(normalizeFit({ width: 99, at: [0, 9, -9], align: 'base' })).toEqual({ width: FIT_WIDTH_MAX, at: [0, 0.8, -0.8], align: 'base' });
    expect(normalizeFit({ width: 0.04, pair: 0.4, at: [0, 0.15, 0.135], align: 'centre' })).toEqual({ width: 0.04, pair: 0.4, at: [0, 0.15, 0.135], align: 'centre' });
    expect(normalizeFit({ width: 0.3, at: [0, 0.3], align: 'base' })).toBeUndefined();
    expect(normalizeFit({ width: 0.3, at: [0, 0.3, 0], align: 'middle' })).toBeUndefined();
    expect(normalizeFit({ width: Number.NaN, at: [0, 0.3, 0], align: 'base' })).toBeUndefined();
  });

  it('recognises every preset as itself, and a nudged fit as its nearest preset', () => {
    for (const id of ANCHOR_IDS) expect(anchorOf(presetFit(id))).toBe(id);
    const neck = presetFit('neck');
    expect(anchorOf({ ...neck, at: [0.01, 0.08, 0.18], width: 0.2 })).toBe('neck');
    expect(anchorOf(undefined)).toBe('crown');
  });

  it('every preset passes the fit gate unchanged, and presetFit never shares arrays', () => {
    for (const id of ANCHOR_IDS) expect(normalizeFit(ANCHOR_PRESETS[id].fit)).toEqual(ANCHOR_PRESETS[id].fit);
    const a = presetFit('crown');
    a.at[1] = 9;
    expect(ANCHOR_PRESETS.crown.fit.at[1]).not.toBe(9);
  });

  it('guesses a sensible anchor from a file name', () => {
    expect(guessAnchor('ruby-earrings.glb')).toBe('ears');
    expect(guessAnchor('pearl necklace')).toBe('neck');
    expect(guessAnchor('/models/props/aviator-glasses.glb')).toBe('glasses');
    expect(guessAnchor('full-face-mask.glb')).toBe('mask');
    expect(guessAnchor('top-hat')).toBe('tall');
    expect(guessAnchor('silver-royal-crown')).toBe('crown');
  });
});

describe('the landing_content blob carries `home` through both editors', () => {
  it('defaults to empty overrides', () => {
    expect(DEFAULT_LANDING_CONTENT.home).toEqual(EMPTY_HOME_OVERRIDES);
    expect(normalizeLandingContent({}).home).toEqual(EMPTY_HOME_OVERRIDES);
  });
  it('normalizeLandingContent keeps a valid home block (so a save from /admin/landing never drops it)', () => {
    const home = { arLooks: [{ id: 'c', name: 'C', category: 'prop', url: glb('c'), fit: presetFit('crown') }], demoEventSlug: 'demo' };
    expect(normalizeLandingContent({ home }).home).toEqual(normalizeHomeAssets(home));
  });
});

describe('picker sources', () => {
  it('maps library kinds to homepage categories', () => {
    expect(categoryForLibraryKind('border')).toBe('frame');
    expect(categoryForLibraryKind('3d_attachment')).toBe('prop');
    expect(categoryForLibraryKind('shader')).toBe('filter');
    expect(categoryForLibraryKind('2d_filter')).toBe('effect');
  });

  it('turns a library prop into a look with a GLB and a guessed anchor', () => {
    const look = lookFromLibraryItem({ id: '1234567890', name: 'Pearl necklace', kind: '3d_attachment', assetUrl: null, modelUrl: glb('pearl'), thumbnailUrl: img('t') });
    expect(look).toMatchObject({ category: 'prop', url: glb('pearl'), thumb: img('t'), fit: presetFit('neck') });
    expect(lookFromLibraryItem({ id: '1', name: 'Shader', kind: 'shader', assetUrl: null, thumbnailUrl: null })).toBeNull();
    const shader = lookFromLibraryItem({ id: '2', name: 'Warm', kind: 'shader', assetUrl: null, thumbnailUrl: img('warm') });
    expect(shader).toMatchObject({ category: 'filter', url: img('warm') });
    expect(lookAction(shader!)).toEqual({ kind: 'media', url: img('warm') });
  });

  it('offers every bundled file, each one on disk with its thumbnail', () => {
    expect(BUILTIN_ASSETS.length).toBeGreaterThan(20);
    for (const a of BUILTIN_ASSETS) {
      expect(existsSync(resolve(PUBLIC, `.${a.url}`)), a.url).toBe(true);
      expect(existsSync(resolve(PUBLIC, `.${a.thumb}`)), a.thumb).toBe(true);
      expect(lookFromBuiltin(a), a.url).not.toBeNull();
    }
  });

  it('includes every file the page’s defaults wear (a new default row shows up with no second list)', () => {
    const urls = new Set(BUILTIN_ASSETS.map((a) => a.url));
    for (const l of [...HOME_ASSET_DEFAULTS.heroLooks, ...HOME_ASSET_DEFAULTS.arLooks]) {
      if (l.category === 'prop' || l.category === 'frame') expect(urls.has(l.url), l.url).toBe(true);
      if (l.with !== undefined) expect(urls.has(l.with), l.with).toBe(true);
    }
  });

  it('a bundled prop the page already wears comes with the page’s own fit', () => {
    const worn = HOME_ASSET_DEFAULTS.arLooks.find((l) => l.category === 'prop' && l.fit !== undefined)!;
    const a = BUILTIN_ASSETS.find((x) => x.url === worn.url)!;
    expect(lookFromBuiltin(a)?.fit).toEqual(worn.fit);
  });

  it('offers every effect the page can draw and every default tint', () => {
    expect(BUILTIN_EFFECT_LOOKS.filter((l) => l.category === 'effect').map((l) => l.url).sort()).toEqual(
      ['fx:confetti', 'fx:hearts', 'fx:notes', 'fx:snow', 'fx:sparkles', 'fx:spotlight'],
    );
    for (const l of BUILTIN_EFFECT_LOOKS) expect(lookAction(l).kind, l.url).not.toBe('none');
  });
});
