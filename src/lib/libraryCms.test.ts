import { describe, expect, it } from 'vitest';
import {
  cmsCounts, cmsTypeOfKind, defaultCmsQuery, pictureSourceFor, queryCms, tidyEventName,
  type CmsItem, type CmsQuery,
} from './libraryCms';
import type { LibraryCategory } from './libraryTaxonomy';

const cats: LibraryCategory[] = [
  { id: 'h', slug: 'holidays', name: 'Holidays', description: '', parentId: null, sortOrder: 0 },
  { id: 'x', slug: 'christmas', name: 'Christmas', description: '', parentId: 'h', sortOrder: 0 },
  { id: 'g', slug: 'glam', name: 'Glam', description: '', parentId: null, sortOrder: 1 },
];

function item(over: Partial<CmsItem>): CmsItem {
  const id = over.id ?? Math.random().toString(36).slice(2);
  return {
    key: `${over.source ?? 'library'}:${id}`, id, source: 'library', name: 'Thing', kind: '3d_attachment', type: '3d',
    thumb: null, swatch: null, state: 'listed', categoryId: null, categorySuggested: false, keywords: [],
    tags: { occasions: [], colors: [], styles: [] }, createdAt: '2026-11-01T00:00:00Z', linkCount: 0,
    origin: null, version: 1, modelUrl: null, inLibrary: false, ...over,
  };
}

const items: CmsItem[] = [
  item({ id: 'santa', name: 'Santa Claus', kind: 'composite', type: 'scene', categoryId: 'x', keywords: ['santa'], createdAt: '2026-11-10T00:00:00Z', linkCount: 3 }),
  item({ id: 'crown', name: 'Royal Crown', categoryId: 'g', keywords: ['gold'], tags: { occasions: [], colors: ['gold'], styles: [] }, createdAt: '2026-11-05T00:00:00Z', state: 'retired' }),
  item({ id: 'frame', name: 'Gold Frame', kind: 'border', type: 'frame', createdAt: '2026-11-12T00:00:00Z', linkCount: 9 }),
  item({ id: 'b1', source: 'builtin', name: 'Elf Hat', state: null, categoryId: 'x', categorySuggested: true }),
];

// Filter/sort tests run inside one source; the 'all' view has its own tests.
const q = (over: Partial<CmsQuery> = {}): CmsQuery => ({ ...defaultCmsQuery(), source: 'library', ...over });
const ids = (list: CmsItem[]) => list.map((i) => i.id);

describe('queryCms', () => {
  it('shows one source at a time, newest first by default', () => {
    expect(ids(queryCms(items, q(), cats))).toEqual(['frame', 'santa', 'crown']);
    expect(ids(queryCms(items, q({ source: 'builtin' }), cats))).toEqual(['b1']);
  });

  it('opens on everything: library, built-in and event pieces together', () => {
    expect(defaultCmsQuery().source).toBe('all');
    const withEvents = [
      ...items,
      item({ id: 'e1', source: 'event', name: 'Party Hat', createdAt: '2026-11-11T00:00:00Z' }),
      // Already copied into the library: its library row stands for it.
      item({ id: 'e2', source: 'event', name: 'Copied Hat', inLibrary: true }),
    ];
    expect(ids(queryCms(withEvents, { ...defaultCmsQuery() }, cats))).toEqual(['frame', 'e1', 'santa', 'crown', 'b1']);
    expect(ids(queryCms(withEvents, { ...defaultCmsQuery(), source: 'event' }, cats))).toEqual(['e1', 'e2']);
    expect(cmsCounts(withEvents, defaultCmsQuery(), cats).bySource).toEqual({ all: 5, library: 3, builtin: 1, event: 2 });
  });

  it('a top-level category includes its subcategories; none = uncategorised', () => {
    expect(ids(queryCms(items, q({ category: 'h' }), cats))).toEqual(['santa']);
    expect(ids(queryCms(items, q({ category: 'none' }), cats))).toEqual(['frame']);
  });

  it('search matches every word across name, keywords, category and tags', () => {
    expect(ids(queryCms(items, q({ text: 'gold' }), cats))).toEqual(['frame', 'crown']);
    expect(ids(queryCms(items, q({ text: 'gold royal' }), cats))).toEqual(['crown']);
    expect(ids(queryCms(items, q({ text: 'christmas' }), cats))).toEqual(['santa']);
    expect(ids(queryCms(items, q({ text: 'nothing-like-this' }), cats))).toEqual([]);
  });

  it('filters by type, state and keyword; sorts by name and use', () => {
    expect(ids(queryCms(items, q({ types: ['frame', 'scene'] }), cats))).toEqual(['frame', 'santa']);
    expect(ids(queryCms(items, q({ states: ['retired'] }), cats))).toEqual(['crown']);
    expect(ids(queryCms(items, q({ keyword: 'santa' }), cats))).toEqual(['santa']);
    expect(ids(queryCms(items, q({ sort: 'name' }), cats))).toEqual(['frame', 'crown', 'santa']);
    expect(ids(queryCms(items, q({ sort: 'most-used' }), cats))).toEqual(['frame', 'santa', 'crown']);
    expect(ids(queryCms(items, q({ sort: 'oldest' }), cats))).toEqual(['crown', 'santa', 'frame']);
  });
});

describe('cmsCounts', () => {
  it('counts each source, each shelf with its children, types and keywords', () => {
    const c = cmsCounts(items, q(), cats);
    expect(c.bySource).toEqual({ all: 4, library: 3, builtin: 1, event: 0 });
    expect(c.byCategory).toMatchObject({ all: 3, none: 1, h: 1, x: 1, g: 1 });
    expect(c.byType).toMatchObject({ '3d': 1, scene: 1, frame: 1 });
    expect(c.keywords).toEqual([{ keyword: 'gold', count: 1 }, { keyword: 'santa', count: 1 }]);
  });

  it('a shelf count ignores the shelf you are on but honours the type filter', () => {
    const c = cmsCounts(items, q({ category: 'x', types: ['frame'] }), cats);
    expect(c.byCategory.all).toBe(1);
    expect(c.byCategory.none).toBe(1);
    expect(c.byType.scene).toBe(1); // type chips honour the shelf
  });
});

describe('event pieces', () => {
  it('maps kinds to the five types', () => {
    expect(cmsTypeOfKind('border')).toBe('frame');
    expect(cmsTypeOfKind('shader')).toBe('filter');
    expect(cmsTypeOfKind('2d_filter')).toBe('sticker');
    expect(cmsTypeOfKind('composite')).toBe('scene');
    expect(cmsTypeOfKind('3d_attachment')).toBe('3d');
  });

  it('finds a picture source: own model, first 3D layer, first image layer, else none', () => {
    expect(pictureSourceFor({ kind: '3d_attachment', assetUrl: 'https://x/a/ai/uuid', config: {} })).toEqual({ kind: 'glb', url: 'https://x/a/ai/uuid' });
    expect(pictureSourceFor({ kind: '3d_attachment', assetUrl: null, config: {} })).toEqual({ kind: 'none' });
    expect(pictureSourceFor({
      kind: 'composite', assetUrl: 'https://x/a/', config: { layers: [
        { kind: 'border', asset_url: 'https://x/frame.svg' },
        { kind: '3d_attachment', asset_url: 'https://x/prop.glb' },
      ] },
    })).toEqual({ kind: 'glb', url: 'https://x/prop.glb' });
    expect(pictureSourceFor({
      kind: 'composite', assetUrl: 'https://x/a/', config: { layers: [{ kind: 'border', asset_url: 'https://x/frame.png?v=2' }] },
    })).toEqual({ kind: 'image', url: 'https://x/frame.png?v=2' });
    expect(pictureSourceFor({ kind: 'composite', assetUrl: 'https://x/a/', config: { layers: [] } })).toEqual({ kind: 'none' });
  });

  it('tidies prompt-shaped names into a short library name', () => {
    expect(tidyEventName('A sleek, blue cycling helmet with a sub…')).toBe('Sleek blue cycling helmet');
    expect(tidyEventName('A baseball hat in Philadelphia 76ers co…')).toBe('Baseball hat');
    expect(tidyEventName('face mask with swords and pizza')).toBe('Face mask');
    expect(tidyEventName('embroidered cowboy hat')).toBe('Embroidered cowboy hat');
    expect(tidyEventName('Untitled Experience')).toBe('Untitled piece');
    expect(tidyEventName('Hero Visor')).toBe('Hero Visor');
  });
});
