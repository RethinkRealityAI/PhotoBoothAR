import { describe, it, expect } from 'vitest';
import { FILTER_SHADERS } from './shaders';
import { BUILTIN_BORDERS } from './borders';
import { HEAD_PIECES } from './headPieces';
import { builtinShaderExperiences, builtinBorderExperiences, builtinHeadPieceExperiences, pick } from './catalog';

// With the active event = hope-gala (arContent {} = include all), counts are unchanged.
describe('builtin catalog (hope-gala = all)', () => {
  it('includes every built-in shader', () => {
    expect(builtinShaderExperiences().length).toBe(FILTER_SHADERS.length);
  });
  it('includes every built-in border', () => {
    expect(builtinBorderExperiences().length).toBe(BUILTIN_BORDERS.length);
  });
  it('includes every built-in head-piece', () => {
    expect(builtinHeadPieceExperiences().length).toBe(HEAD_PIECES.length);
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
