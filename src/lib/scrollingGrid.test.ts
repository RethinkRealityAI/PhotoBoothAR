import { describe, expect, it } from 'vitest';
import { gridScrolls, loopHeight, loopIndexes, wrapOffset } from './scrollingGrid';

describe('scrollingGrid', () => {
  it('scrolls only when there is more than one screen of photos', () => {
    expect(gridScrolls(9, 3)).toBe(false);
    expect(gridScrolls(10, 3)).toBe(true);
    expect(gridScrolls(16, 4)).toBe(false);
    expect(gridScrolls(5, 0)).toBe(false);
  });

  it('pads a loop period to whole rows with the newest photos', () => {
    expect(loopIndexes(10, 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
    expect(loopIndexes(12, 3)).toHaveLength(12);
    expect(loopIndexes(0, 3)).toEqual([]);
  });

  it('measures a period in whole rows', () => {
    expect(loopHeight(12, 3, 200, 10)).toBe(4 * 210);
    expect(loopHeight(0, 3, 200, 10)).toBe(0);
  });

  it('wraps the offset into one period', () => {
    expect(wrapOffset(830, 20, 840)).toBe(10);
    expect(wrapOffset(0, -5, 840)).toBe(835);
    expect(wrapOffset(100, 5, 0)).toBe(0);
  });
});
