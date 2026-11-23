import { describe, expect, it } from 'vitest';
import { tabIndexForKey } from './tabKeys';

describe('tabIndexForKey', () => {
  it('steps right and left, wrapping at the ends', () => {
    expect(tabIndexForKey('ArrowRight', 0, 3)).toBe(1);
    expect(tabIndexForKey('ArrowRight', 2, 3)).toBe(0);
    expect(tabIndexForKey('ArrowLeft', 0, 3)).toBe(2);
    expect(tabIndexForKey('ArrowLeft', 2, 3)).toBe(1);
  });

  it('jumps to the first and last tab', () => {
    expect(tabIndexForKey('Home', 2, 5)).toBe(0);
    expect(tabIndexForKey('End', 0, 5)).toBe(4);
  });

  it('ignores keys that do not move tabs', () => {
    expect(tabIndexForKey('Enter', 1, 3)).toBeNull();
    expect(tabIndexForKey('ArrowDown', 1, 3)).toBeNull();
    expect(tabIndexForKey('a', 1, 3)).toBeNull();
  });

  it('has nowhere to go without tabs, and clamps an out-of-range start', () => {
    expect(tabIndexForKey('ArrowRight', 0, 0)).toBeNull();
    expect(tabIndexForKey('ArrowRight', -1, 3)).toBe(1);
    expect(tabIndexForKey('ArrowLeft', 9, 3)).toBe(1);
  });
});
