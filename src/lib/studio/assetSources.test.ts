import { describe, it, expect } from 'vitest';
import { uploadsToDockItems, experiencesToDockItems, filterDockItems, type DockItem } from './assetSources';
import type { StoredAsset } from '../db';
import type { Experience } from '../../types';

const UUID = '11111111-2222-3333-4444-555555555555';

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
