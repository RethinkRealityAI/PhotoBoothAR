import { describe, it, expect } from 'vitest';
import {
  uploadsToDockItems,
  experiencesToDockItems,
  filterDockItems,
  isThumbAsset,
  pairThumbnails,
  storedNameFromUrl,
  thumbUploadName,
  planUploads,
  rejectedUploadMessage,
  UPLOAD_ACCEPT,
  UPLOAD_ACCEPT_LABEL,
  isTemplate,
  splitTemplates,
  stripTemplateSuffix,
  isGenerated,
  splitExperiences,
  dockItemKind,
  dockItemMatchesChip,
  filterDockByChip,
  isDockItemInScene,
  type DockItem,
  type AssetChip,
} from './assetSources';
import type { StoredAsset } from '../db';
import type { Experience, ExperienceConfig } from '../../types';

// `generated` is a server-set provenance flag intentionally absent from the
// ExperienceConfig type (see isGenerated) — cast so the test can set it.
const generatedConfig = (v: boolean): ExperienceConfig => ({ generated: v }) as ExperienceConfig;

const UUID = '11111111-2222-3333-4444-555555555555';
const UUID2 = '66666666-7777-8888-9999-000000000000';

function asset(overrides: Partial<StoredAsset>): StoredAsset {
  return { name: 'x.png', path: 'x.png', url: 'https://cdn/x.png', ...overrides };
}

describe('uploadsToDockItems', () => {
  it('classifies images as 2d with payload.url', () => {
    const [item] = uploadsToDockItems([asset({ name: `${UUID}-frame.png`, path: `${UUID}-frame.png`, url: 'https://cdn/frame.png' })]);
    expect(item.family).toBe('2d');
    expect(item.source).toBe('upload');
    expect(item.payload).toEqual({ url: 'https://cdn/frame.png' });
    expect(item.previewUrl).toBe('https://cdn/frame.png');
  });

  it('classifies models as 3d with payload.assetUrl and no preview', () => {
    const [item] = uploadsToDockItems([asset({ name: `${UUID}-crown.glb`, path: `${UUID}-crown.glb`, url: 'https://cdn/crown.glb' })]);
    expect(item.family).toBe('3d');
    expect(item.payload).toEqual({ assetUrl: 'https://cdn/crown.glb' });
    expect(item.previewUrl).toBeNull();
  });

  it('excludes unknown file types', () => {
    const items = uploadsToDockItems([asset({ name: 'notes.txt', path: 'notes.txt' })]);
    expect(items).toEqual([]);
  });

  it('hides files whose name starts with thumb-', () => {
    const items = uploadsToDockItems([asset({ name: 'thumb-frame.png', path: 'thumb-frame.png' })]);
    expect(items).toEqual([]);
  });

  it('strips a leading uuid prefix from the label', () => {
    const [item] = uploadsToDockItems([asset({ name: `${UUID}-my_asset.png`, path: `${UUID}-my_asset.png` })]);
    expect(item.label).toBe('my_asset');
  });

  it('does not strip when there is no uuid prefix', () => {
    const [item] = uploadsToDockItems([asset({ name: 'my_asset.png', path: 'my_asset.png' })]);
    expect(item.label).toBe('my_asset');
  });

  it('strips the extension from the label', () => {
    const [item] = uploadsToDockItems([asset({ name: 'crown.glb', path: 'crown.glb' })]);
    expect(item.label).toBe('crown');
  });

  it('classifies by mimetype when extension is ambiguous', () => {
    const [item] = uploadsToDockItems([asset({ name: 'x', path: 'x', mimetype: 'image/webp' })]);
    expect(item.family).toBe('2d');
  });

  it('id is the storage path', () => {
    const [item] = uploadsToDockItems([asset({ name: 'a.png', path: 'sub/a.png' })]);
    expect(item.id).toBe('sub/a.png');
  });

  it('excludes a paired thumbnail file and attaches it as the model item preview', () => {
    // REAL storage names. db.uploadAsset appends an extension unconditionally,
    // so a picked `crown.glb` lands as `<uid>-crown.glb.glb` — the old fixture
    // used `<uid>-crown.glb`, a name uploadAsset cannot produce, which is why
    // this suite stayed green while no uploaded model ever showed its capture.
    const items = uploadsToDockItems([
      asset({ name: `${UUID}-crown.glb.glb`, path: `${UUID}-crown.glb.glb`, url: 'https://cdn/crown.glb.glb' }),
      asset({ name: `${UUID2}-${UUID}-crown.glb.glb.thumb.png`, path: `t/${UUID2}-${UUID}-crown.glb.glb.thumb.png`, url: 'https://cdn/crown-thumb.png' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].family).toBe('3d');
    expect(items[0].previewUrl).toBe('https://cdn/crown-thumb.png');
  });

  it('leaves previewUrl null when a model has no paired thumbnail', () => {
    const items = uploadsToDockItems([
      asset({ name: `${UUID}-crown.glb.glb`, path: `${UUID}-crown.glb.glb`, url: 'https://cdn/crown.glb.glb' }),
      asset({ name: `${UUID2}-${UUID}-tiara.glb.glb.thumb.png`, path: `t/${UUID2}-${UUID}-tiara.glb.glb.thumb.png`, url: 'https://cdn/tiara-thumb.png' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].previewUrl).toBeNull();
  });

  it('two uploads sharing a filename keep their OWN thumbnails (stored-name identity)', () => {
    // The normalized-label key could not tell these apart; the stored name can.
    const items = uploadsToDockItems([
      asset({ name: `${UUID}-crown.glb.glb`, path: `a/${UUID}-crown.glb.glb`, url: 'https://cdn/a.glb' }),
      asset({ name: `${UUID2}-crown.glb.glb`, path: `b/${UUID2}-crown.glb.glb`, url: 'https://cdn/b.glb' }),
      asset({ name: `aaaaaaaa-1111-2222-3333-444444444444-${UUID2}-crown.glb.glb.thumb.png`, path: 't/b.png', url: 'https://cdn/b-thumb.png' }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].previewUrl).toBeNull();
    expect(items[1].previewUrl).toBe('https://cdn/b-thumb.png');
  });
});

describe('planUploads (the ONE upload zone routes by type)', () => {
  const f = (name: string, type?: string) => ({ name, type });

  it('routes images and models to their own paths, in input order', () => {
    const { routed, rejected } = planUploads([f('frame.png', 'image/png'), f('crown.glb', 'model/gltf-binary')]);
    expect(routed.map((r) => r.kind)).toEqual(['image', 'model']);
    expect(routed[0].file.name).toBe('frame.png');
    expect(rejected).toEqual([]);
  });

  it('routes by MIME when the extension is missing, and by extension when the MIME is', () => {
    expect(planUploads([f('blob', 'image/webp')]).routed[0].kind).toBe('image');
    expect(planUploads([f('crown.gltf', '')]).routed[0].kind).toBe('model');
    expect(planUploads([f('crown.glb')]).routed[0].kind).toBe('model');
  });

  it('collects the unplaceable rather than dropping them silently', () => {
    const { routed, rejected } = planUploads([f('notes.txt', 'text/plain'), f('a.svg', 'image/svg+xml')]);
    expect(routed).toHaveLength(1);
    expect(rejected).toEqual(['notes.txt']);
    expect(rejectedUploadMessage(rejected)).toBe("notes.txt isn't an image or 3D model — skipped.");
    expect(rejectedUploadMessage(['a', 'b'])).toBe("2 files weren't images or 3D models — skipped.");
    expect(rejectedUploadMessage([])).toBeNull();
  });

  it('only a clean SINGLE file drops into the scene', () => {
    // The trap: every image add replaces the scene's one frame, so auto-adding
    // a 3-file drop would leave two of them uploaded but invisible.
    expect(planUploads([f('a.png', 'image/png')]).addToScene).toBe(true);
    expect(planUploads([f('a.png', 'image/png'), f('b.png', 'image/png')]).addToScene).toBe(false);
    expect(planUploads([f('a.png', 'image/png'), f('n.txt', 'text/plain')]).addToScene).toBe(false);
    expect(planUploads([]).addToScene).toBe(false);
  });

  it('the accept list and its human label cover the same formats', () => {
    for (const ext of ['png', 'jpeg', 'webp', 'svg', 'glb', 'gltf']) {
      expect(UPLOAD_ACCEPT.toLowerCase()).toContain(ext);
    }
    for (const word of ['PNG', 'JPG', 'WEBP', 'SVG', 'GLB', 'GLTF']) {
      expect(UPLOAD_ACCEPT_LABEL).toContain(word);
    }
    // Everything the label promises must actually route (the old button
    // advertised "PNG / JPG / SVG" while quietly also taking webp).
    for (const name of ['a.png', 'a.jpg', 'a.webp', 'a.svg', 'a.glb', 'a.gltf']) {
      expect(planUploads([{ name }]).rejected).toEqual([]);
    }
  });
});

describe('storedNameFromUrl / thumbUploadName', () => {
  it('takes the last path segment, stripping query and fragment', () => {
    expect(storedNameFromUrl(`https://cdn/storage/v1/object/public/assets/ev/uploads/${UUID}-crown.glb.glb`))
      .toBe(`${UUID}-crown.glb.glb`);
    expect(storedNameFromUrl('https://cdn/a/b/c.glb?token=1#x')).toBe('c.glb');
  });

  it('percent-decodes, and survives a malformed sequence rather than throwing', () => {
    expect(storedNameFromUrl('https://cdn/a/my%20model.glb')).toBe('my model.glb');
    expect(storedNameFromUrl('https://cdn/a/100%.glb')).toBe('100%.glb');
  });

  it('names the thumbnail after the model’s STORED file, not the picked file', () => {
    // This is the whole fix: the pair key is an identity, not a normalization.
    const url = `https://cdn/assets/ev/uploads/${UUID}-crown.glb.glb`;
    expect(thumbUploadName(url)).toBe(`${UUID}-crown.glb.glb.thumb`);
    const stored = `${UUID2}-${thumbUploadName(url)}.png`;
    expect(isThumbAsset(stored)).toBe(true);
    expect(pairThumbnails([asset({ name: stored, url: 'https://cdn/t.png' })]).get(`${UUID}-crown.glb.glb`))
      .toBe('https://cdn/t.png');
  });
});

describe('isThumbAsset', () => {
  it('matches the <uid>-<asset-name>.thumb.png convention', () => {
    expect(isThumbAsset(`${UUID}-crown.glb.thumb.png`)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isThumbAsset('crown.glb.THUMB.PNG')).toBe(true);
  });

  it('does not match a plain model or image file', () => {
    expect(isThumbAsset('crown.glb')).toBe(false);
    expect(isThumbAsset('crown.png')).toBe(false);
  });
});

describe('pairThumbnails', () => {
  it('maps a model’s STORED filename to its thumbnail url', () => {
    const map = pairThumbnails([
      asset({ name: `${UUID}-crown.glb.glb`, path: `${UUID}-crown.glb.glb`, url: 'https://cdn/crown.glb.glb' }),
      asset({ name: `${UUID2}-${UUID}-crown.glb.glb.thumb.png`, path: `t/x.png`, url: 'https://cdn/crown-thumb.png' }),
    ]);
    expect(map.get(`${UUID}-crown.glb.glb`)).toBe('https://cdn/crown-thumb.png');
  });

  it('ignores non-thumb assets and returns an empty map', () => {
    const map = pairThumbnails([asset({ name: `${UUID}-crown.glb.glb` })]);
    expect(map.size).toBe(0);
  });

  it('does not pair a thumbnail with a different model', () => {
    const map = pairThumbnails([
      asset({ name: `${UUID2}-${UUID}-tiara.glb.glb.thumb.png`, path: `t/y.png`, url: 'https://cdn/tiara-thumb.png' }),
    ]);
    expect(map.get(`${UUID}-crown.glb.glb`)).toBeUndefined();
    expect(map.get(`${UUID}-tiara.glb.glb`)).toBe('https://cdn/tiara-thumb.png');
  });
});

function experience(overrides: Partial<Experience>): Experience {
  return {
    id: 'exp-1',
    created_at: '',
    updated_at: '',
    name: 'Gold Frame',
    kind: 'border',
    asset_url: 'https://cdn/border.svg',
    thumbnail_url: null,
    config: {},
    is_published: true,
    featured: false,
    sort_order: 0,
    ...overrides,
  };
}

describe('experiencesToDockItems', () => {
  it('maps border with asset_url to a 2d item', () => {
    const [item] = experiencesToDockItems([experience({ kind: 'border' })]);
    expect(item.family).toBe('2d');
    expect(item.source).toBe('experience');
    expect(item.payload).toEqual({ overlayKind: 'border', url: 'https://cdn/border.svg' });
    expect(item.previewUrl).toBe('https://cdn/border.svg'); // falls back to asset_url
  });

  it('maps 2d_filter with asset_url to a 2d item', () => {
    const [item] = experiencesToDockItems([experience({ kind: '2d_filter', asset_url: 'https://cdn/sticker.svg' })]);
    expect(item.payload.overlayKind).toBe('2d_filter');
  });

  it('prefers thumbnail_url for previewUrl when present', () => {
    const [item] = experiencesToDockItems([
      experience({ kind: 'border', thumbnail_url: 'https://cdn/thumb.png' }),
    ]);
    expect(item.previewUrl).toBe('https://cdn/thumb.png');
  });

  it('skips border/2d_filter with no asset_url', () => {
    const items = experiencesToDockItems([experience({ kind: 'border', asset_url: null })]);
    expect(items).toEqual([]);
  });

  it('maps 3d_attachment with config.procedural to a 3d item using proceduralId', () => {
    const [item] = experiencesToDockItems([
      experience({ kind: '3d_attachment', asset_url: null, config: { procedural: 'royal-crown' } }),
    ]);
    expect(item.family).toBe('3d');
    expect(item.payload).toEqual({ proceduralId: 'royal-crown' });
  });

  it('maps 3d_attachment with asset_url (no procedural) to a 3d item using assetUrl', () => {
    const [item] = experiencesToDockItems([
      experience({ kind: '3d_attachment', asset_url: 'https://cdn/crown.glb', config: {} }),
    ]);
    expect(item.payload).toEqual({ assetUrl: 'https://cdn/crown.glb' });
  });

  it('prefers proceduralId over assetUrl when both are present', () => {
    const [item] = experiencesToDockItems([
      experience({ kind: '3d_attachment', asset_url: 'https://cdn/crown.glb', config: { procedural: 'royal-crown' } }),
    ]);
    expect(item.payload).toEqual({ proceduralId: 'royal-crown' });
  });

  it('skips 3d_attachment with neither procedural nor asset_url', () => {
    const items = experiencesToDockItems([experience({ kind: '3d_attachment', asset_url: null, config: {} })]);
    expect(items).toEqual([]);
  });

  it('skips shader and composite kinds', () => {
    const items = experiencesToDockItems([
      experience({ kind: 'shader', asset_url: null }),
      experience({ kind: 'composite', asset_url: null }),
    ]);
    expect(items).toEqual([]);
  });

  it('uses experience name as label', () => {
    const [item] = experiencesToDockItems([experience({ name: 'Hope Gala Banner' })]);
    expect(item.label).toBe('Hope Gala Banner');
  });
});

describe('filterDockItems', () => {
  const items: DockItem[] = [
    { id: '1', label: 'Gold Frame', source: 'upload', family: '2d', previewUrl: null, payload: {} },
    { id: '2', label: 'Royal Crown', source: 'builtin', family: '3d', previewUrl: null, payload: {} },
    { id: '3', label: 'Confetti Overlay', source: 'experience', family: '2d', previewUrl: null, payload: {} },
  ];

  it('filters by family', () => {
    expect(filterDockItems(items, '3d', '').map((i) => i.id)).toEqual(['2']);
  });

  it('empty query returns all items of the family', () => {
    expect(filterDockItems(items, '2d', '').map((i) => i.id).sort()).toEqual(['1', '3']);
  });

  it('matches label case-insensitively as a substring', () => {
    expect(filterDockItems(items, '2d', 'gold').map((i) => i.id)).toEqual(['1']);
    expect(filterDockItems(items, '2d', 'FRAME').map((i) => i.id)).toEqual(['1']);
  });

  it('returns empty when no label matches', () => {
    expect(filterDockItems(items, '2d', 'nonexistent')).toEqual([]);
  });

  it('family mismatch excludes even on label match', () => {
    expect(filterDockItems(items, '3d', 'gold')).toEqual([]);
  });
});

describe('isTemplate', () => {
  it('is true when config.template is exactly true', () => {
    expect(isTemplate(experience({ config: { template: true } }))).toBe(true);
  });

  it('is false when config.template is absent, falsy, or truthy-but-not-boolean-true', () => {
    expect(isTemplate(experience({ config: {} }))).toBe(false);
    expect(isTemplate(experience({ config: { template: false } }))).toBe(false);
    expect(isTemplate(experience({ config: { template: undefined } }))).toBe(false);
  });
});

describe('splitTemplates', () => {
  it('separates templates from regular experiences, preserving relative order', () => {
    const t1 = experience({ id: 't1', name: 'Birthday (template)', config: { template: true } });
    const e1 = experience({ id: 'e1', name: 'Gala Frame', config: {} });
    const t2 = experience({ id: 't2', name: 'Wedding (template)', config: { template: true } });
    const e2 = experience({ id: 'e2', name: 'Sticker Pack', config: {} });
    const { templates, rest } = splitTemplates([t1, e1, t2, e2]);
    expect(templates.map((e) => e.id)).toEqual(['t1', 't2']);
    expect(rest.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('returns empty arrays for an empty input', () => {
    expect(splitTemplates([])).toEqual({ templates: [], rest: [] });
  });
});

describe('stripTemplateSuffix', () => {
  it('strips a trailing " (template)" suffix', () => {
    expect(stripTemplateSuffix('Birthday Bash (template)')).toBe('Birthday Bash');
  });

  it('is case-insensitive', () => {
    expect(stripTemplateSuffix('Birthday Bash (TEMPLATE)')).toBe('Birthday Bash');
  });

  it('leaves a name with no suffix untouched', () => {
    expect(stripTemplateSuffix('Birthday Bash')).toBe('Birthday Bash');
  });

  it('only strips a trailing occurrence, not one mid-name', () => {
    expect(stripTemplateSuffix('My (template) Frame')).toBe('My (template) Frame');
  });
});

describe('isGenerated', () => {
  it('is true when config.generated is exactly true', () => {
    expect(isGenerated(experience({ config: generatedConfig(true) }))).toBe(true);
  });

  it('is false when config.generated is absent, false, or non-boolean-true', () => {
    expect(isGenerated(experience({ config: {} }))).toBe(false);
    expect(isGenerated(experience({ config: generatedConfig(false) }))).toBe(false);
    expect(isGenerated(experience({ config: { generated: 1 } as unknown as ExperienceConfig }))).toBe(false);
  });
});

describe('splitExperiences', () => {
  it('partitions into templates, generated, and mine, preserving relative order', () => {
    const t = experience({ id: 't', name: 'Tmpl (template)', config: { template: true } });
    const g = experience({ id: 'g', name: 'AI Frame', config: generatedConfig(true) });
    const m = experience({ id: 'm', name: 'Hand-made', config: {} });
    const g2 = experience({ id: 'g2', name: 'AI Sticker', config: generatedConfig(true) });
    const { templates, generated, mine } = splitExperiences([t, g, m, g2]);
    expect(templates.map((e) => e.id)).toEqual(['t']);
    expect(generated.map((e) => e.id)).toEqual(['g', 'g2']);
    expect(mine.map((e) => e.id)).toEqual(['m']);
  });

  it('classifies a template that is also AI-generated as a template (templates win)', () => {
    const both = experience({ id: 'b', config: { template: true, generated: true } as unknown as ExperienceConfig });
    const { templates, generated } = splitExperiences([both]);
    expect(templates.map((e) => e.id)).toEqual(['b']);
    expect(generated).toEqual([]);
  });

  it('returns empty arrays for empty input', () => {
    expect(splitExperiences([])).toEqual({ templates: [], generated: [], mine: [] });
  });
});

describe('dockItemKind', () => {
  const item = (family: '2d' | '3d', payload: DockItem['payload']): DockItem => ({
    id: 'x', label: 'x', source: 'upload', family, previewUrl: null, payload,
  });

  it('is 3d for any 3D-family item', () => {
    expect(dockItemKind(item('3d', { assetUrl: 'a.glb' }))).toBe('3d');
    expect(dockItemKind(item('3d', { proceduralId: 'royal-crown' }))).toBe('3d');
  });

  it('reads the overlayKind for classified 2D items', () => {
    expect(dockItemKind(item('2d', { overlayKind: 'border', url: 'u' }))).toBe('frame');
    expect(dockItemKind(item('2d', { overlayKind: '2d_filter', url: 'u' }))).toBe('sticker');
  });

  it('is image for a bare 2D upload with no overlayKind', () => {
    expect(dockItemKind(item('2d', { url: 'u' }))).toBe('image');
  });
});

describe('dockItemMatchesChip / filterDockByChip', () => {
  const items: DockItem[] = [
    { id: 'frame', label: 'Gold Frame', source: 'experience', family: '2d', previewUrl: null, payload: { overlayKind: 'border', url: 'u' } },
    { id: 'sticker', label: 'Confetti', source: 'experience', family: '2d', previewUrl: null, payload: { overlayKind: '2d_filter', url: 'u' } },
    { id: 'model', label: 'Crown', source: 'upload', family: '3d', previewUrl: null, payload: { assetUrl: 'c.glb' } },
    { id: 'image', label: 'Loose PNG', source: 'upload', family: '2d', previewUrl: null, payload: { url: 'u' } },
  ];
  const ids = (chip: AssetChip) => filterDockByChip(items, chip, '').map((i) => i.id).sort();

  it('all keeps every item', () => {
    expect(ids('all')).toEqual(['frame', 'image', 'model', 'sticker']);
  });

  it('filter keeps no DockItem (shaders are not dock items)', () => {
    expect(ids('filter')).toEqual([]);
  });

  it('3d keeps only 3D-family items', () => {
    expect(ids('3d')).toEqual(['model']);
  });

  it('frame keeps frames and bare images (an image can be a frame)', () => {
    expect(ids('frame')).toEqual(['frame', 'image']);
  });

  it('sticker keeps stickers and bare images (an image can be a sticker)', () => {
    expect(ids('sticker')).toEqual(['image', 'sticker']);
  });

  it('applies the case-insensitive label substring on top of the chip', () => {
    expect(filterDockByChip(items, 'all', 'GOLD').map((i) => i.id)).toEqual(['frame']);
    expect(filterDockByChip(items, 'frame', 'confetti')).toEqual([]); // right query, wrong chip
  });
});

describe('isDockItemInScene', () => {
  const imageItem = { id: 'a', label: 'Logo', family: '2d', previewUrl: null, payload: { url: 'https://x/logo.png' } } as never;
  const modelItem = { id: 'b', label: 'Crown', family: '3d', previewUrl: null, payload: { assetUrl: 'https://x/crown.glb' } } as never;
  const procItem = { id: 'c', label: 'Tiara', family: '3d', previewUrl: null, payload: { proceduralId: 'tiara' } } as never;

  it('is false for an empty scene', () => {
    expect(isDockItemInScene(imageItem, [])).toBe(false);
  });

  it('matches an overlay already placed by url', () => {
    expect(isDockItemInScene(imageItem, [{ url: 'https://x/logo.png' }])).toBe(true);
    expect(isDockItemInScene(imageItem, [{ url: 'https://x/other.png' }])).toBe(false);
  });

  it('matches a model by assetUrl and a head piece by proceduralId', () => {
    expect(isDockItemInScene(modelItem, [{ assetUrl: 'https://x/crown.glb' }])).toBe(true);
    expect(isDockItemInScene(procItem, [{ proceduralId: 'tiara' }])).toBe(true);
    expect(isDockItemInScene(procItem, [{ proceduralId: 'crown' }])).toBe(false);
  });

  it('ignores null/undefined identity fields rather than matching everything', () => {
    // The trap: a scene object with url:null must not "match" a tile with no url.
    const blank = { id: 'd', label: 'x', family: '2d', previewUrl: null, payload: {} } as never;
    expect(isDockItemInScene(blank, [{ url: null, assetUrl: null, proceduralId: null }])).toBe(false);
  });
});
