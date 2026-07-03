import { describe, it, expect } from 'vitest';
import { builtinShaderExperiences, builtinBorderExperiences, builtinHeadPieceExperiences, pick } from './catalog';
import { hopeGala } from '../events/hope-gala/config';

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
