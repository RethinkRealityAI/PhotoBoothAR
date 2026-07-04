import { describe, it, expect } from 'vitest';
import { builtinShaderExperiences, builtinBorderExperiences, builtinHeadPieceExperiences, buildCatalog, pick } from './catalog';
import { hopeGala } from '../events/hope-gala/config';
import type { Experience } from '../types';

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
