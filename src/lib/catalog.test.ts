import { describe, it, expect } from 'vitest';
import { builtinShaderExperiences, builtinBorderExperiences, builtinHeadPieceExperiences, buildCatalog, pick } from './catalog';
import { hopeGala } from '../events/hope-gala/config';
import { getEventConfig } from '../events/registry';
import { BUILTIN_BORDERS } from './borders';
import { FILTER_SHADERS } from './shaders';
import type { Experience } from '../types';
import type { EventARContent } from '../events/types';

// Hope Gala is pinned to its own built-ins (8 shaders / 8 borders /
// 4 head-pieces). These counts must stay fixed even when other events add AR
// effects to the shared registries.
describe('builtin catalog (hope-gala pinned)', () => {
  it('includes Hope Gala\'s 8 pinned shaders', () => {
    expect(builtinShaderExperiences(hopeGala.arContent).length).toBe(8);
  });
  it('includes Hope Gala\'s 8 pinned borders', () => {
    expect(builtinBorderExperiences(hopeGala.arContent).length).toBe(8);
  });
  it('includes Hope Gala\'s 4 pinned head-pieces', () => {
    expect(builtinHeadPieceExperiences(hopeGala.arContent).length).toBe(4);
  });
  it('keeps the legacy placement unless the caller is a platform event', () => {
    const all = { headPieceIds: [] } as unknown as typeof hopeGala.arContent;
    const offsetOf = (list: Experience[], id: string) => list.find((e) => e.id === id)?.config?.anchor?.offset;
    const legacy = builtinHeadPieceExperiences(all);
    const platform = builtinHeadPieceExperiences(all, true);
    expect(offsetOf(legacy, 'builtin:3d:neon-shades')).toEqual({ x: 0, y: 1.4, z: 1.2 });
    expect(offsetOf(platform, 'builtin:3d:neon-shades')).toEqual({ x: 0, y: 0.15, z: 1.2 });
    expect(offsetOf(legacy, 'builtin:3d:royal-crown')).toEqual({ x: 0, y: -1.0, z: -0.6 });
    // A piece with no platform correction is identical on both.
    expect(offsetOf(platform, 'builtin:3d:queen-tiara')).toEqual(offsetOf(legacy, 'builtin:3d:queen-tiara'));
  });
});

describe('pick allow-list', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('returns all when ids is empty or undefined', () => {
    expect(pick(items, undefined)).toHaveLength(3);
    expect(pick(items, [])).toHaveLength(3);
  });
  it('returns only matching ids, preserving order', () => {
    expect(pick(items, ['c', 'a']).map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('returns the very same array when nothing is seasonal (no copy, no reorder)', () => {
    expect(pick(items, [])).toBe(items);
    expect(pick(items, undefined)).toBe(items);
  });
  it('an empty list never includes an opt-in seasonal item; a list naming it does', () => {
    const mixed = [{ id: 'a' }, { id: 'x', seasonal: 'christmas' }, { id: 'b' }];
    expect(pick(mixed, []).map((x) => x.id)).toEqual(['a', 'b']);
    expect(pick(mixed, undefined).map((x) => x.id)).toEqual(['a', 'b']);
    expect(pick(mixed, ['x', 'a']).map((x) => x.id)).toEqual(['a', 'x']);
  });
});

describe('seasonal (Christmas) looks are opt-in', () => {
  const seasonalBorders = BUILTIN_BORDERS.filter((b) => b.seasonal !== undefined).map((b) => `builtin:border:${b.id}`);
  const seasonalShaders = FILTER_SHADERS.filter((s) => s.seasonal !== undefined).map((s) => `builtin:shader:${s.id}`);
  const seasonalIds = [...seasonalBorders, ...seasonalShaders];

  it('the registries really carry seasonal looks (guards the tests below from passing vacuously)', () => {
    expect(seasonalBorders.length).toBeGreaterThanOrEqual(5);
    expect(seasonalShaders).toContain('builtin:shader:snowfall-glow');
  });

  it('an event with empty / missing allow-lists (a live platform event) gains none of them', () => {
    for (const ar of [{} as EventARContent, { borderIds: [], shaderIds: [] } as EventARContent]) {
      const ids = buildCatalog(ar, [], undefined, [], true).map((e) => e.id);
      for (const id of seasonalIds) expect(ids, id).not.toContain(id);
      // ...and still shows every always-available built-in, exactly as before.
      expect(ids).toContain('builtin:border:frame-classic-gold');
      expect(ids).toContain('builtin:shader:champagne-sparkle');
    }
  });

  it('an allow-list that names them puts them in the booth', () => {
    const ar = { borderIds: ['xmas-lights', 'dw-corners'], shaderIds: ['snowfall-glow'] } as EventARContent;
    const ids = buildCatalog(ar, [], undefined, [], true).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['builtin:border:xmas-lights', 'builtin:border:dw-corners', 'builtin:shader:snowfall-glow']));
  });

  it('frozen legacy events name none of them, so their catalogs are unchanged', () => {
    for (const slug of ['hope-gala', 'jenna-jake', 'detola-wuyi']) {
      const ids = buildCatalog(getEventConfig(slug).arContent, [], undefined, []).map((e) => e.id);
      for (const id of seasonalIds) expect(ids, `${slug} ${id}`).not.toContain(id);
    }
  });
});

function exp(id: string, over: Partial<Experience> = {}): Experience {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    name: id,
    kind: 'border',
    asset_url: null,
    thumbnail_url: null,
    config: {},
    is_published: true,
    featured: false,
    sort_order: 0,
    ...over,
  };
}

describe('buildCatalog linked globals', () => {
  const ar = hopeGala.arContent;

  it('behaves identically when the 4th arg is omitted', () => {
    const custom = [exp('c1')];
    expect(buildCatalog(ar, custom)).toEqual(buildCatalog(ar, custom, undefined, []));
  });

  it('appends published linked globals after custom, before builtins', () => {
    const custom = [exp('c1', { sort_order: 1 })];
    const globals = [exp('g2', { is_global: true, sort_order: 2 }), exp('g1', { is_global: true, sort_order: 1 })];
    const out = buildCatalog(ar, custom, undefined, globals);
    expect(out[0].id).toBe('c1');
    expect(out[1].id).toBe('g1'); // sorted by sort_order
    expect(out[2].id).toBe('g2');
    expect(out[3].id.startsWith('builtin:')).toBe(true);
  });

  it('drops unpublished globals and dedupes against custom by id', () => {
    const custom = [exp('dup')];
    const globals = [exp('dup', { is_global: true }), exp('gh', { is_global: true, is_published: false })];
    const out = buildCatalog(ar, custom, undefined, globals);
    expect(out.filter((e) => e.id === 'dup')).toHaveLength(1);
    expect(out.some((e) => e.id === 'gh')).toBe(false);
  });
});
