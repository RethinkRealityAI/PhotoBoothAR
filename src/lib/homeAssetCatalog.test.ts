import { describe, expect, it } from 'vitest';
import {
  buildCatalog, filterCatalog, sceneModelUrl, typeCounts, uploadName, uploadPick,
  type CatalogEntry, type CatalogInput, type CatalogQuery, type LibraryRowLike,
} from './homeAssetCatalog';
import { lookUrlKind, resolveAssetUrl } from './homeAssets';
import { BUILTIN_ASSETS, BUILTIN_EFFECT_LOOKS } from './homeAssetSources';

const ST = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets/';
const lib = (over: Partial<LibraryRowLike> & { id: string; kind: string }): LibraryRowLike => ({
  name: over.id, assetUrl: null, thumbnailUrl: `${ST}_platform/library/${over.id}/thumb.png`, state: 'listed', ...over,
});

const INPUT: CatalogInput = {
  categories: [{ id: 'c-head', name: 'Headwear', parentId: null } as never, { id: 'c-hats', name: 'Hats', parentId: 'c-head' } as never],
  library: [
    lib({ id: 'crown', kind: '3d_attachment', assetUrl: `${ST}_platform/library/crown/model.glb`, modelUrl: `${ST}_platform/library/crown/model.glb`, keywords: ['sparkly'], categoryId: 'c-hats' }),
    lib({ id: 'retired-hat', kind: '3d_attachment', assetUrl: `${ST}_platform/library/rh/model.glb`, state: 'retired' }),
    lib({ id: 'gone', kind: '3d_attachment', assetUrl: `${ST}_platform/library/g/model.glb`, state: 'withdrawn', access: 'orgs' }),
    lib({ id: 'scene', kind: 'composite', assetUrl: null, modelUrl: `${ST}_platform/library/s/layer.glb` }),
    lib({ id: 'flat-scene', kind: 'composite', assetUrl: null, modelUrl: null }),
    lib({ id: 'gold-frame', kind: 'border', assetUrl: `${ST}_platform/library/f/frame.png` }),
    lib({ id: 'svg-frame', kind: 'border', assetUrl: `${ST}_platform/library/f2/frame.svg`, thumbnailUrl: null }),
    lib({ id: 'sticker', kind: '2d_filter', assetUrl: `${ST}_platform/library/st/sticker.png` }),
    lib({ id: 'gltf-hat', kind: '3d_attachment', assetUrl: `${ST}_platform/library/gh/model.gltf`, modelUrl: `${ST}_platform/library/gh/model.gltf` }),
  ],
  drafts: [{ id: 'd1', name: 'Imported cap', assetUrl: `${ST}_platform/library/d1/model.glb`, thumbnailUrl: `${ST}_platform/library/d1/thumb.png` }],
  events: [
    { id: 'e1', name: 'Party hat', kind: '3d_attachment', assetUrl: `${ST}tolas-bash/hat.glb`, thumbnailUrl: null, config: { layers: [] }, eventName: "Tola's bash", eventArchived: true, inLibrary: false },
    { id: 'e2', name: 'Copied crown', kind: '3d_attachment', assetUrl: `${ST}daps/crown.glb`, thumbnailUrl: null, config: { layers: [] }, eventName: 'Daps', eventArchived: false, inLibrary: true },
    { id: 'e3', name: 'Neon scene', kind: 'composite', assetUrl: null, thumbnailUrl: `${ST}daps/thumb.webp`, config: { layers: [{ kind: 'border', asset_url: `${ST}daps/f.png` }, { kind: '3d_attachment', asset_url: `${ST}daps/neon.glb` }] }, eventName: 'Daps', eventArchived: false, inLibrary: false },
  ],
  uploads: [
    { url: `${ST}_platform/landing/0b1c2d3e-0000-4000-8000-000000000000-wall.webp`, name: '0b1c2d3e-0000-4000-8000-000000000000-wall.webp' },
    { url: `${ST}_platform/landing/aaa.glb`, name: 'aaa.glb' },
    { url: `${ST}_platform/landing/clip.mp4`, name: 'clip.mp4' },
  ],
};

const Q: CatalogQuery = { source: 'all', type: 'all', text: '', fitsOnly: false };
const byKey = (list: CatalogEntry[], k: string) => list.find((e) => e.key === k);

describe('homeAssetCatalog: coverage', () => {
  const prop = buildCatalog(INPUT, { accept: ['model'], category: 'prop' });

  it('lists every library row whatever its state or access, the drafts, the event pieces and the uploads', () => {
    for (const id of ['crown', 'retired-hat', 'gone', 'scene', 'gold-frame', 'sticker']) expect(byKey(prop, `library:${id}`)).toBeDefined();
    expect(byKey(prop, 'draft:d1')).toBeDefined();
    expect(byKey(prop, 'event:e1')).toBeDefined();
    expect(byKey(prop, `upload:${ST}_platform/landing/aaa.glb`)).toBeDefined();
    // Every built-in file and effect is there too.
    for (const a of BUILTIN_ASSETS) expect(byKey(prop, `builtin:${a.url}`)).toBeDefined();
    for (const l of BUILTIN_EFFECT_LOOKS) expect(byKey(prop, `builtin:${l.url}`)).toBeDefined();
  });

  it('says what a row is: hidden, withdrawn, host-only, draft, which event', () => {
    expect(byKey(prop, 'library:retired-hat')?.badges).toContain('Hidden from hosts');
    expect(byKey(prop, 'library:gone')?.badges).toEqual(['Withdrawn', 'Host-only']);
    expect(byKey(prop, 'draft:d1')?.badges).toEqual(['Draft']);
    expect(byKey(prop, 'event:e1')?.badges).toEqual(["From Tola's bash", 'Archived event']);
    expect(byKey(prop, 'event:e1')?.warn).toMatch(/deleting that event removes it/);
  });

  it('an event piece already copied into the library shows once in Everything, and under From events', () => {
    expect(filterCatalog(prop, Q).some((e) => e.key === 'event:e2')).toBe(false);
    expect(filterCatalog(prop, { ...Q, source: 'event' }).some((e) => e.key === 'event:e2')).toBe(true);
  });
});

describe('homeAssetCatalog: only what the slot can render is pickable', () => {
  it('a 3D prop slot takes .glb models (a scene wears its 3D piece) and explains the rest', () => {
    const c = buildCatalog(INPUT, { accept: ['model'], category: 'prop' });
    const ok = c.filter((e) => e.pick !== null);
    for (const e of ok) {
      expect(resolveAssetUrl(e.pick!.url, 'model')).toBeDefined();
      expect(e.pick!.look?.category).toBe('prop');
      expect(e.pick!.look?.fit).toBeDefined();
    }
    expect(byKey(c, 'library:crown')?.pick?.url).toBe(`${ST}_platform/library/crown/model.glb`);
    expect(byKey(c, 'library:scene')?.pick?.url).toBe(`${ST}_platform/library/s/layer.glb`);
    expect(byKey(c, 'library:scene')?.badges).toContain('Wears its 3D piece');
    expect(byKey(c, 'event:e3')?.pick?.url).toBe(`${ST}daps/neon.glb`);
    expect(byKey(c, 'draft:d1')?.pick).not.toBeNull();
    expect(byKey(c, 'library:flat-scene')?.reason).toBe('No .glb model file in it.');
    expect(byKey(c, 'library:gltf-hat')?.reason).toMatch(/\.gltf model can't load here/);
    expect(byKey(c, 'library:gold-frame')?.reason).toBe('A frame. Add it under Frames.');
    expect(byKey(c, 'builtin:fx:snow')?.reason).toBe('An effect. Add it under Effects.');
    // Pickable first.
    const firstBad = c.findIndex((e) => e.pick === null);
    expect(c.slice(firstBad).every((e) => e.pick === null)).toBe(true);
  });

  it('a frame slot takes frame pictures and uploaded images, never a 3D model, a sticker or an SVG', () => {
    const c = buildCatalog(INPUT, { accept: ['image'], category: 'frame' });
    expect(byKey(c, 'library:gold-frame')?.pick?.look?.thumb).toBeDefined();
    expect(byKey(c, 'library:crown')?.reason).toBe('A 3D model. Add it under 3D props.');
    expect(byKey(c, 'library:sticker')?.reason).toBe('A sticker, not a full frame.');
    expect(byKey(c, 'library:svg-frame')?.reason).toMatch(/SVG isn't supported/);
    const up = byKey(c, `upload:${ST}_platform/landing/0b1c2d3e-0000-4000-8000-000000000000-wall.webp`);
    expect(up?.name).toBe('wall');
    expect(up?.pick?.look?.category).toBe('frame');
    expect(byKey(c, `upload:${ST}_platform/landing/aaa.glb`)?.pick).toBeNull();
    for (const e of c) if (e.pick !== null) expect(lookUrlKind(e.pick.url, 'frame')).toBe('image');
  });

  it('a filter slot takes the built-in tints, pictures and clips; an effect slot takes fx', () => {
    const f = buildCatalog(INPUT, { accept: ['image', 'video'], category: 'filter' });
    for (const l of BUILTIN_EFFECT_LOOKS.filter((x) => x.category === 'filter')) expect(byKey(f, `builtin:${l.url}`)?.pick?.kind).toBe('builtin');
    expect(byKey(f, 'builtin:fx:snow')?.pick).toBeNull();
    expect(byKey(f, `upload:${ST}_platform/landing/clip.mp4`)?.pick?.kind).toBe('video');
    expect(byKey(f, 'library:sticker')?.pick?.kind).toBe('image');
    const e = buildCatalog(INPUT, { accept: ['image', 'video'], category: 'effect' });
    expect(byKey(e, 'builtin:fx:snow')?.pick?.kind).toBe('builtin');
  });

  it('plain slots take the file itself: scene props a .glb, wall photos a picture', () => {
    const scene = buildCatalog(INPUT, { accept: ['model'] });
    expect(byKey(scene, 'library:crown')?.pick).toEqual({ url: `${ST}_platform/library/crown/model.glb`, kind: 'model', name: 'crown', thumb: `${ST}_platform/library/crown/thumb.png` });
    expect(byKey(scene, 'library:crown')?.pick?.look).toBeUndefined();
    expect(byKey(scene, `upload:${ST}_platform/landing/clip.mp4`)?.reason).toBe('A clip, not a 3D model.');
    const photos = buildCatalog(INPUT, { accept: ['image'] });
    expect(byKey(photos, `upload:${ST}_platform/landing/clip.mp4`)?.reason).toBe('A clip. This slot takes pictures.');
    expect(byKey(photos, 'library:gold-frame')?.pick?.kind).toBe('image');
  });
});

describe('homeAssetCatalog: search and filters', () => {
  const c = buildCatalog(INPUT, { accept: ['model'], category: 'prop' });

  it('searches names, tags, category path, event names and states; every word must match', () => {
    expect(filterCatalog(c, { ...Q, text: 'sparkly' }).map((e) => e.key)).toEqual(['library:crown']);
    expect(filterCatalog(c, { ...Q, text: 'hats' }).map((e) => e.key)).toContain('library:crown');
    expect(filterCatalog(c, { ...Q, text: 'tola' }).map((e) => e.key)).toEqual(['event:e1']);
    expect(filterCatalog(c, { ...Q, text: 'hidden hat' }).map((e) => e.key)).toEqual(['library:retired-hat']);
    expect(filterCatalog(c, { ...Q, text: 'zzz-nothing' })).toEqual([]);
  });

  it('filters by source (drafts sit under Library), type and fits-only, and counts per type', () => {
    const libOnly = filterCatalog(c, { ...Q, source: 'library' });
    expect(libOnly.every((e) => e.source === 'library' || e.source === 'draft')).toBe(true);
    expect(libOnly.some((e) => e.source === 'draft')).toBe(true);
    expect(filterCatalog(c, { ...Q, type: 'frame' }).every((e) => e.type === 'frame')).toBe(true);
    expect(filterCatalog(c, { ...Q, fitsOnly: true }).every((e) => e.pick !== null)).toBe(true);
    const n = typeCounts(c, { ...Q, source: 'library' });
    expect(n.all).toBe(libOnly.length);
    expect(n['3d'] + n.scene + n.frame + n.sticker).toBe(n.all);
  });

  it('missing sources (a list that failed to load) simply contribute nothing', () => {
    const only = buildCatalog({}, { accept: ['model'], category: 'prop' });
    expect(only.every((e) => e.source === 'builtin')).toBe(true);
  });
});

describe('homeAssetCatalog: helpers', () => {
  it('finds a scene\'s first 3D layer', () => {
    expect(sceneModelUrl([{ kind: 'border', asset_url: 'a.png' }, { kind: '3d_attachment', asset_url: 'x' }])).toBe('x');
    expect(sceneModelUrl([{ kind: 'sticker', asset_url: 'b.glb' }])).toBe('b.glb');
    expect(sceneModelUrl([{ kind: 'border', asset_url: 'a.png' }])).toBeNull();
  });

  it('names an upload without its uuid prefix or extension', () => {
    expect(uploadName('0b1c2d3e-0000-4000-8000-000000000000-crown.glb')).toBe('crown');
    expect(uploadName('plain')).toBe('plain');
  });

  it('a fresh upload into a prop slot comes back as a look with a guessed fit', () => {
    const p = uploadPick(`${ST}_platform/landing/x-earrings.glb`, 'model', 'earrings', 'prop');
    expect(p.look?.fit?.pair).toBeDefined();
    expect(uploadPick(`${ST}_platform/landing/x.png`, 'image', 'x', undefined)).toEqual({ url: `${ST}_platform/landing/x.png`, kind: 'image', name: 'x', thumb: `${ST}_platform/landing/x.png` });
  });
});
