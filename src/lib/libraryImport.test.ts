import { describe, expect, it } from 'vitest';
import {
  IMPORT_CATEGORIES,
  IMPORT_MAX_BYTES,
  buildDraftRenderConfig,
  checkGlbFile,
  fitScaleFor,
  importWarnings,
  applyClassification,
  nameFromFileName,
  needsReview,
} from './libraryImport';
import {
  CLASSIFY_RESPONSE_SCHEMA,
  buildDraftRow,
  checkDraftAssetSwap,
  checkDraftConfig,
  checkDraftCreate,
  draftModelKey,
  draftOptimizedModelKey,
  draftPublishBlocker,
  draftThumbKey,
  isDraftConfig,
  normalizeClassification,
  normalizeImportMeta,
  patchDraftConfig,
  publishedDraftConfig,
} from '../../supabase/functions/admin-api/libraryImport.ts';
import { libraryStateOf, readLibraryMeta } from '../../supabase/functions/admin-api/library.ts';
import { HAND_ANCHOR_MAP } from './handPose';
import { ANCHOR_PRESETS } from './faceRig';

const ORIGIN = 'https://proj.supabase.co';
const ID = '11111111-2222-4333-8444-555555555555';
const url = (key: string) => `${ORIGIN}/storage/v1/object/public/assets/${key}`;

function glbHeader(declaredLength: number, version = 2, magic = 'glTF'): Uint8Array {
  const b = new Uint8Array(12);
  for (let i = 0; i < 4; i++) b[i] = magic.charCodeAt(i);
  const v = new DataView(b.buffer);
  v.setUint32(4, version, true);
  v.setUint32(8, declaredLength, true);
  return b;
}

describe('checkGlbFile', () => {
  it('accepts a well-formed GLB header whose length matches', () => {
    expect(checkGlbFile('crown.glb', 4096, glbHeader(4096))).toEqual({ ok: true });
    expect(checkGlbFile('CROWN.GLB', 4096, glbHeader(4096))).toEqual({ ok: true });
  });
  it('refuses a .gltf with a reason that says what to do', () => {
    const r = checkGlbFile('crown.gltf', 10, glbHeader(10));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/single \.glb/);
  });
  it('refuses other extensions, empty and oversize files', () => {
    expect(checkGlbFile('crown.obj', 10, glbHeader(10)).ok).toBe(false);
    expect(checkGlbFile('crown.glb', 0, glbHeader(0)).ok).toBe(false);
    expect(checkGlbFile('crown.glb', IMPORT_MAX_BYTES + 1, glbHeader(IMPORT_MAX_BYTES + 1)).ok).toBe(false);
  });
  it('refuses a renamed file, glTF v1 and a truncated download', () => {
    expect(checkGlbFile('a.glb', 100, glbHeader(100, 2, 'PK\u0003\u0004')).ok).toBe(false);
    expect(checkGlbFile('a.glb', 100, glbHeader(100, 1)).ok).toBe(false);
    const cut = checkGlbFile('a.glb', 100, glbHeader(5000));
    expect(cut.ok).toBe(false);
    if (!cut.ok) expect(cut.reason).toMatch(/cut off/);
    expect(checkGlbFile('a.glb', 100, new Uint8Array(4)).ok).toBe(false);
  });
  it('accepts a file over the import cap only when a larger cap is passed (optimize first)', () => {
    const big = IMPORT_MAX_BYTES + 1;
    expect(checkGlbFile('a.glb', big, glbHeader(big)).ok).toBe(false);
    expect(checkGlbFile('a.glb', big, glbHeader(big), big)).toEqual({ ok: true });
  });
});

describe('nameFromFileName', () => {
  it('turns a file name into a readable default', () => {
    expect(nameFromFileName('gold_crown-v2 (1).glb')).toBe('Gold crown v2');
    expect(nameFromFileName('.glb')).toBe('3D prop');
    expect(nameFromFileName(`${'x'.repeat(200)}.glb`).length).toBeLessThanOrEqual(80);
  });
});

describe('categories', () => {
  it('every head anchor is a real faceRig preset and every hand anchor a real HAND_ANCHOR', () => {
    for (const c of IMPORT_CATEGORIES) {
      expect(ANCHOR_PRESETS.some((a) => a.id === c.anchor), c.id).toBe(true);
      if (c.handAnchor) expect(HAND_ANCHOR_MAP[c.handAnchor], c.id).toBeDefined();
      expect(c.targetCm).toBeGreaterThan(0);
    }
  });
  it('the Gemini schema enum is exactly the category list', () => {
    expect(CLASSIFY_RESPONSE_SCHEMA.properties.category.enum).toEqual(IMPORT_CATEGORIES.map((c) => c.id));
  });
});

describe('fitScaleFor', () => {
  it('puts the largest dimension at the category target', () => {
    expect(fitScaleFor('headwear', 1)).toBeCloseTo(24);
    expect(fitScaleFor('eyewear', 2)).toBeCloseTo(8);
  });
  it('clamps tiny and huge models like the Studio auto-fit', () => {
    expect(fitScaleFor('headwear', 0.001)).toBe(50);
    expect(fitScaleFor('headwear', 100_000)).toBe(0.05);
  });
  it('an unmeasurable model starts at the target, never scale 1', () => {
    expect(fitScaleFor('headwear', 0)).toBe(24);
    expect(fitScaleFor('ears', Number.NaN)).toBe(5);
  });
});

describe('buildDraftRenderConfig', () => {
  const assetUrl = url(draftModelKey(ID));

  it('builds a one-layer v2 head piece the server accepts', () => {
    const cfg = buildDraftRenderConfig({ assetUrl, name: 'Crown', categoryId: 'headwear', maxDim: 2 });
    expect(cfg.anchor).toMatchObject({ anchor: 'crown', scale: 12 });
    const layers = cfg.layers as Record<string, unknown>[];
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ kind: '3d_attachment', asset_url: assetUrl, anchorVersion: 2, name: 'Crown' });
    expect(layers[0].handAnchor).toBeUndefined();
    expect(checkDraftConfig(cfg, assetUrl).ok).toBe(true);
  });

  it('a held prop rides the hand grip', () => {
    const cfg = buildDraftRenderConfig({ assetUrl, name: 'Wand', categoryId: 'held', maxDim: 1 });
    expect((cfg.layers as Record<string, unknown>[])[0].handAnchor).toBe('grip');
  });
});

describe('server checks', () => {
  const assetUrl = url(draftModelKey(ID));
  const thumbnailUrl = url(draftThumbKey(ID));
  const config = buildDraftRenderConfig({ assetUrl, name: 'Crown', categoryId: 'headwear', maxDim: 1 });
  const good = { id: ID, name: '  Gold   crown ', assetUrl, thumbnailUrl, config, tags: { colors: ['gold'] }, importMeta: { category: 'headwear', bytes: 10, triangles: 5, maxDim: 1 } };

  it('accepts a payload pointing at the row’s own folder', () => {
    const r = checkDraftCreate(good, ORIGIN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Gold crown');
      expect(r.value.tags.colors).toEqual(['gold']);
    }
  });

  it('refuses media outside the row’s own folder or bucket', () => {
    const other = '99999999-2222-4333-8444-555555555555';
    expect(checkDraftCreate({ ...good, assetUrl: url(draftModelKey(other)) }, ORIGIN)).toEqual({ ok: false, error: 'invalid_asset' });
    expect(checkDraftCreate({ ...good, thumbnailUrl: 'https://evil.example/x.png' }, ORIGIN)).toEqual({ ok: false, error: 'invalid_asset' });
    expect(checkDraftCreate({ ...good, assetUrl: url('acme-event/x.glb') }, ORIGIN)).toEqual({ ok: false, error: 'invalid_asset' });
  });

  it('refuses bad ids, names, tags and configs', () => {
    expect(checkDraftCreate({ ...good, id: 'nope' }, ORIGIN)).toEqual({ ok: false, error: 'invalid_args' });
    expect(checkDraftCreate({ ...good, name: '' }, ORIGIN)).toEqual({ ok: false, error: 'invalid_name' });
    expect(checkDraftCreate({ ...good, tags: { colors: ['burgundy'] } }, ORIGIN)).toEqual({ ok: false, error: 'invalid_tags' });
    expect(checkDraftCreate({ ...good, config: { anchor: {}, layers: [{ kind: '3d_attachment', asset_url: 'x' }] } }, ORIGIN))
      .toEqual({ ok: false, error: 'invalid_config' });
    expect(checkDraftCreate({ ...good, config: { anchor: {}, pad: 'x'.repeat(20_000) } }, ORIGIN)).toEqual({ ok: false, error: 'invalid_config' });
  });

  it('drops a browser-sent library block — the server owns it', () => {
    const r = checkDraftConfig({ ...config, library: { listed: true, draft: false } }, assetUrl);
    expect(r.ok && 'library' in r.value).toBe(false);
  });

  it('a new draft is a hidden global row that never reads as listed', () => {
    const r = checkDraftCreate(good, ORIGIN);
    if (!r.ok) throw new Error('setup');
    const row = buildDraftRow(r.value, 'admin-1', '2026-11-19T00:00:00Z');
    expect(row).toMatchObject({ is_global: true, is_published: false, event_id: null, org_id: null, kind: '3d_attachment' });
    expect(isDraftConfig(row.config)).toBe(true);
    expect(libraryStateOf({ is_published: false, config: row.config })).toBe('withdrawn');
    expect(readLibraryMeta(row.config)?.listed).toBe(false);
  });

  it('review edits keep the draft flag and the other library keys', () => {
    const r = checkDraftCreate(good, ORIGIN);
    if (!r.ok) throw new Error('setup');
    const row = buildDraftRow(r.value, 'admin-1', 'now');
    const next = patchDraftConfig(row.config, { tags: { occasions: ['party'], colors: [], styles: [] } });
    expect(isDraftConfig(next)).toBe(true);
    expect((next.library as Record<string, unknown>).importedAt).toBe('now');
    expect(next.layers).toEqual((row.config as Record<string, unknown>).layers);
    const rebuilt = buildDraftRenderConfig({ assetUrl, name: 'Wand', categoryId: 'held', maxDim: 1 });
    const swapped = patchDraftConfig(next, { config: rebuilt });
    expect((swapped.layers as Record<string, unknown>[])[0].handAnchor).toBe('grip');
    expect((swapped.library as Record<string, unknown>).tags).toEqual({ occasions: ['party'], colors: [], styles: [] });
  });

  it('publishing clears the draft flag, lists it, and leaves rendering alone', () => {
    const r = checkDraftCreate(good, ORIGIN);
    if (!r.ok) throw new Error('setup');
    const row = buildDraftRow(r.value, 'admin-1', 'then');
    const pub = publishedDraftConfig(row.config, 'admin-2', 'now');
    expect(isDraftConfig(pub)).toBe(false);
    expect(libraryStateOf({ is_published: true, config: pub })).toBe('listed');
    expect(pub.layers).toEqual((row.config as Record<string, unknown>).layers);
    expect(readLibraryMeta(pub)?.publishedBy).toBe('admin-2');
  });

  it('a draft without a name or thumbnail cannot be published', () => {
    expect(draftPublishBlocker({ name: 'Crown', thumbnail_url: 'x', asset_url: 'y' })).toBeNull();
    expect(draftPublishBlocker({ name: ' ', thumbnail_url: 'x', asset_url: 'y' })).toBe('invalid_name');
    expect(draftPublishBlocker({ name: 'Crown', thumbnail_url: null, asset_url: 'y' })).toBe('thumbnail_required');
  });
});

describe('normalizeClassification', () => {
  it('keeps valid picks, drops invented vocabulary, clamps confidence', () => {
    const c = normalizeClassification({
      name: 'Golden Crown.glb', category: 'headwear', occasions: 'Birthday, gala, prom',
      colors: 'gold, burgundy, red, blue, white', styles: 'elegant', confidence: 1.4, note: 'A crown.',
    });
    expect(c.name).toBe('Golden Crown');
    expect(c.tags).toEqual({ occasions: ['gala', 'birthday'], colors: ['red', 'gold', 'blue'], styles: ['elegant'] });
    expect(c.confidence).toBe(1);
  });
  it('degrades garbage to an "other" with zero confidence', () => {
    const c = normalizeClassification('nope');
    expect(c).toEqual({ name: null, category: 'other', tags: { occasions: [], colors: [], styles: [] }, confidence: 0, note: '' });
  });
});

describe('normalizeImportMeta + warnings', () => {
  it('is total', () => {
    expect(normalizeImportMeta(null)).toMatchObject({ category: 'headwear', classifiedBy: 'none', bytes: 0 });
    expect(normalizeImportMeta({ category: 'held', classifiedBy: 'ai', confidence: -2 })).toMatchObject({ category: 'held', classifiedBy: 'ai', confidence: 0 });
  });
  it('warns on heavy files, dense meshes and unmeasured sizes only', () => {
    expect(importWarnings({ bytes: 1e6, triangles: 20_000, maxDim: 1 })).toEqual([]);
    expect(importWarnings({ bytes: 30 * 1024 * 1024, triangles: 400_000, maxDim: 0 })).toHaveLength(3);
  });
});

describe('review helpers', () => {
  const assetUrl = url(draftModelKey(ID));
  const base = {
    name: 'Model final2',
    assetUrl,
    tags: { occasions: [], colors: [], styles: [] },
    importMeta: normalizeImportMeta({ fileName: 'model_final2.glb', category: 'headwear', maxDim: 1 }),
  };
  const suggestion = normalizeClassification({
    name: 'Party Sunglasses', category: 'eyewear', occasions: 'party', colors: 'pink', styles: 'playful', confidence: 0.9, note: 'Pink sunglasses.',
  });

  it('needsReview: unlabelled and unsure need a look; confident AI and people do not', () => {
    expect(needsReview({ classifiedBy: 'none' })).toBe(true);
    expect(needsReview({ classifiedBy: 'ai', confidence: 0.4 })).toBe(true);
    expect(needsReview({ classifiedBy: 'ai', confidence: 0.9 })).toBe(false);
    expect(needsReview({ classifiedBy: 'human' })).toBe(false);
  });

  it('applies an AI suggestion to an untouched draft and rebuilds placement', () => {
    const r = applyClassification(base, suggestion);
    expect(r.name).toBe('Party Sunglasses');
    expect(r.importMeta).toMatchObject({ category: 'eyewear', classifiedBy: 'ai', confidence: 0.9, note: 'Pink sunglasses.' });
    expect(r.tags.colors).toEqual(['pink']);
    expect((r.config?.anchor as Record<string, unknown>).anchor).toBe('noseBridge');
  });

  it('never overwrites a name the operator typed', () => {
    const r = applyClassification({ ...base, name: 'Dapo’s shades' }, suggestion);
    expect(r.name).toBe('Dapo’s shades');
  });

  it('a reviewed draft keeps its category and tags; only the AI note updates', () => {
    const reviewed = { ...base, tags: { occasions: ['wedding'], colors: [], styles: [] }, importMeta: { ...base.importMeta, classifiedBy: 'human' as const } };
    const r = applyClassification(reviewed, suggestion);
    expect(r.importMeta.category).toBe('headwear');
    expect(r.importMeta.classifiedBy).toBe('human');
    expect(r.tags.occasions).toEqual(['wedding']);
    expect(r.config).toBeNull();
  });
});

describe('optimized model swap (update_library_draft assetUrl)', () => {
  const optUrl = url(draftOptimizedModelKey(ID, 1763590000000));
  const config = buildDraftRenderConfig({ assetUrl: optUrl, name: 'Crown', categoryId: 'headwear', maxDim: 1 });

  it('names a fresh model-opt key inside the draft’s own folder', () => {
    expect(draftOptimizedModelKey(ID, 1763590000000)).toBe(`_platform/library/${ID}/model-opt-1763590000000.glb`);
    expect(draftOptimizedModelKey(ID, 3.7)).toBe(`_platform/library/${ID}/model-opt-3.glb`);
  });

  it('accepts the optimized copy or the original, with a config that names it', () => {
    expect(checkDraftAssetSwap(ID, { assetUrl: optUrl, config }, ORIGIN)).toMatchObject({ ok: true, value: { assetUrl: optUrl } });
    const back = url(draftModelKey(ID));
    const backCfg = buildDraftRenderConfig({ assetUrl: back, name: 'Crown', categoryId: 'headwear', maxDim: 1 });
    expect(checkDraftAssetSwap(ID, { assetUrl: back, config: backCfg }, ORIGIN).ok).toBe(true);
  });

  it('refuses another draft’s folder, nested paths, other files and foreign origins', () => {
    const other = '99999999-2222-4333-8444-555555555555';
    for (const bad of [
      url(draftOptimizedModelKey(other, 1)),
      url(`_platform/library/${ID}/x/model-opt-1.glb`),
      url(`_platform/library/${ID}/thumb.png`),
      url(`_platform/library/${ID}/model-opt-1.glb.png`),
      url(`_platform/library/${ID}/../${other}/model.glb`),
      `https://evil.example/storage/v1/object/public/assets/_platform/library/${ID}/model.glb`,
      42,
    ]) {
      expect(checkDraftAssetSwap(ID, { assetUrl: bad, config }, ORIGIN), String(bad)).toEqual({ ok: false, error: 'invalid_asset' });
    }
  });

  it('needs a config, and the config must point at the NEW file', () => {
    expect(checkDraftAssetSwap(ID, { assetUrl: optUrl }, ORIGIN)).toEqual({ ok: false, error: 'invalid_config' });
    const stale = buildDraftRenderConfig({ assetUrl: url(draftModelKey(ID)), name: 'Crown', categoryId: 'headwear', maxDim: 1 });
    expect(checkDraftAssetSwap(ID, { assetUrl: optUrl, config: stale }, ORIGIN)).toEqual({ ok: false, error: 'invalid_config' });
  });

  it('import meta keeps the original size only alongside a real one', () => {
    expect(normalizeImportMeta({ bytes: 4, originalBytes: 40, originalTriangles: 9 })).toMatchObject({ originalBytes: 40, originalTriangles: 9 });
    expect(normalizeImportMeta({ bytes: 4, originalTriangles: 9 }).originalTriangles).toBeUndefined();
    expect(normalizeImportMeta({ bytes: 4, originalBytes: -1 }).originalBytes).toBeUndefined();
  });
});
