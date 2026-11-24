import { describe, expect, it } from 'vitest';
import { railStorageKey, readRailCollapsed, writeRailCollapsed, type RailStore } from './railCollapse';

function memStore(): RailStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

const throwing: RailStore = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

describe('railCollapse', () => {
  it('defaults to expanded when nothing is stored', () => {
    expect(readRailCollapsed(memStore(), 'host')).toBe(false);
    expect(readRailCollapsed(null, 'host')).toBe(false);
  });

  it('round-trips per surface without leaking between surfaces', () => {
    const s = memStore();
    expect(writeRailCollapsed(s, 'admin', true)).toBe(true);
    expect(readRailCollapsed(s, 'admin')).toBe(true);
    expect(readRailCollapsed(s, 'host')).toBe(false);
    writeRailCollapsed(s, 'admin', false);
    expect(readRailCollapsed(s, 'admin')).toBe(false);
    expect(s.map.get(railStorageKey('admin'))).toBe('expanded');
  });

  it('reads an unknown stored value as expanded', () => {
    const s = memStore();
    s.map.set(railStorageKey('editor'), 'true');
    expect(readRailCollapsed(s, 'editor')).toBe(false);
  });

  it('survives storage that throws', () => {
    expect(readRailCollapsed(throwing, 'studio-assets')).toBe(false);
    expect(writeRailCollapsed(throwing, 'studio-assets', true)).toBe(false);
    expect(writeRailCollapsed(null, 'studio-assets', true)).toBe(false);
  });

  it('keys are namespaced', () => {
    expect(railStorageKey('library-categories')).toBe('beamwall:rail:library-categories');
  });
});
