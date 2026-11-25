import { describe, expect, it } from 'vitest';
import { findDecision, mineChipVisible, minePosts, readPostParam, stripPostParam } from './wallFindYours';

const UUID = '3f2b8c1e-9a4d-4c7e-8f00-1b2c3d4e5f60';

describe('readPostParam', () => {
  it('reads a valid id', () => {
    expect(readPostParam(`?post=${UUID}`)).toBe(UUID);
    expect(readPostParam(`?faceEngine=xr8&post=${UUID}`)).toBe(UUID);
  });
  it('ignores missing, empty and malformed values', () => {
    expect(readPostParam('')).toBeNull();
    expect(readPostParam('?post=')).toBeNull();
    expect(readPostParam('?post=%22%5D')).toBeNull();
    expect(readPostParam('?other=1')).toBeNull();
  });
});

describe('stripPostParam', () => {
  it('removes only post and keeps the rest in order', () => {
    expect(stripPostParam(`?post=${UUID}`)).toBe('');
    expect(stripPostParam(`?a=1&post=${UUID}&b=2`)).toBe('?a=1&b=2');
  });
  it('leaves a search without post untouched', () => {
    expect(stripPostParam('?a=1')).toBe('?a=1');
    expect(stripPostParam('')).toBe('');
  });
});

describe('findDecision', () => {
  it('opens as soon as the post is in the list, loaded or not', () => {
    expect(findDecision('x', ['a', 'x'], true, false)).toBe('open');
    expect(findDecision('x', ['x'], false, false)).toBe('open');
  });
  it('waits for the first load', () => {
    expect(findDecision('x', [], false, false)).toBe('wait');
  });
  it('is pending once loaded without it', () => {
    expect(findDecision('x', ['a'], true, false)).toBe('pending');
  });
  it('stays quiet when the load failed', () => {
    expect(findDecision('x', [], false, true)).toBe('drop');
  });
});

describe('Mine filter', () => {
  it('shows only on phones, never while projecting, never with nothing to show', () => {
    expect(mineChipVisible({ width: 390, projecting: false, mineCount: 2 })).toBe(true);
    expect(mineChipVisible({ width: 639, projecting: false, mineCount: 1 })).toBe(true);
    expect(mineChipVisible({ width: 640, projecting: false, mineCount: 2 })).toBe(false);
    expect(mineChipVisible({ width: 1440, projecting: false, mineCount: 2 })).toBe(false);
    expect(mineChipVisible({ width: 390, projecting: true, mineCount: 2 })).toBe(false);
    expect(mineChipVisible({ width: 390, projecting: false, mineCount: 0 })).toBe(false);
  });
  it('keeps wall order', () => {
    const posts = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
    expect(minePosts(posts, new Set(['a', 'c']))).toEqual([{ id: 'c' }, { id: 'a' }]);
    expect(minePosts(posts, new Set())).toEqual([]);
  });
});
