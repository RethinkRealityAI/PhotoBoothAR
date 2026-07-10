import { describe, it, expect } from 'vitest';
import {
  uploadsToDockItems,
  experiencesToDockItems,
  filterDockItems,
  isThumbAsset,
  pairThumbnails,
  isTemplate,
  splitTemplates,
  stripTemplateSuffix,
  type DockItem,
} from './assetSources';
import type { StoredAsset } from '../db';
import type { Experience } from '../../types';

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
    const items = uploadsToDockItems([
      asset({ name: `${UUID}-crown.glb`, path: `${UUID}-crown.glb`, url: 'https://cdn/crown.glb' }),
      asset({ name: `${UUID2}-crown.glb.thumb.png`, path: `${UUID2}-crown.glb.thumb.png`, url: 'https://cdn/crown-thumb.png' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].family).toBe('3d');
    expect(items[0].previewUrl).toBe('https://cdn/crown-thumb.png');
  });

  it('leaves previewUrl null when a model has no paired thumbnail', () => {
    const items = uploadsToDockItems([
      asset({ name: `${UUID}-crown.glb`, path: `${UUID}-crown.glb`, url: 'https://cdn/crown.glb' }),
      asset({ name: `${UUID2}-tiara.glb.thumb.png`, path: `${UUID2}-tiara.glb.thumb.png`, url: 'https://cdn/tiara-thumb.png' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].previewUrl).toBeNull();
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
  it('maps a model label to its thumbnail url', () => {
    const map = pairThumbnails([
      asset({ name: `${UUID}-crown.glb`, path: `${UUID}-crown.glb`, url: 'https://cdn/crown.glb' }),
      asset({ name: `${UUID2}-crown.glb.thumb.png`, path: `${UUID2}-crown.glb.thumb.png`, url: 'https://cdn/crown-thumb.png' }),
    ]);
    expect(map.get('crown')).toBe('https://cdn/crown-thumb.png');
  });

  it('ignores non-thumb assets and returns an empty map', () => {
    const map = pairThumbnails([asset({ name: `${UUID}-crown.glb` })]);
    expect(map.size).toBe(0);
  });

  it('does not pair mismatched labels', () => {
    const map = pairThumbnails([
      asset({ name: `${UUID2}-tiara.glb.thumb.png`, path: `${UUID2}-tiara.glb.thumb.png`, url: 'https://cdn/tiara-thumb.png' }),
    ]);
    expect(map.get('crown')).toBeUndefined();
    expect(map.get('tiara')).toBe('https://cdn/tiara-thumb.png');
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
