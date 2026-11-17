import { describe, it, expect } from 'vitest';
import { TEXT_SIZE_KEY, readTextSize, writeTextSize, type TextSizeStore } from './textSize';

function memStore(): TextSizeStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}

describe('textSize', () => {
  it('round-trips under the fixed key and defaults to md', () => {
    const store = memStore();
    expect(readTextSize(store)).toBe('md');
    expect(writeTextSize(store, 'lg')).toBe(true);
    expect(store.map.get(TEXT_SIZE_KEY)).toBe('lg');
    expect(readTextSize(store)).toBe('lg');
    writeTextSize(store, 'md');
    expect(readTextSize(store)).toBe('md');
  });

  it('treats garbage as md and never throws when storage throws or is absent', () => {
    const store = memStore();
    store.map.set(TEXT_SIZE_KEY, 'huge');
    expect(readTextSize(store)).toBe('md');
    const throwing: TextSizeStore = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceeded'); },
    };
    expect(readTextSize(throwing)).toBe('md');
    expect(writeTextSize(throwing, 'lg')).toBe(false);
    expect(readTextSize(null)).toBe('md');
    expect(writeTextSize(undefined, 'lg')).toBe(false);
  });
});
