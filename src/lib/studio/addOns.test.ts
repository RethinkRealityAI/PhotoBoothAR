import { describe, expect, it } from 'vitest';
import { ADD_ONS } from './addOns';

describe('ADD_ONS registry', () => {
  it('has unique ids and complete copy', () => {
    const ids = ADD_ONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ADD_ONS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.blurb.length).toBeGreaterThan(0);
      expect(a.icon.length).toBeGreaterThan(0);
      for (const hex of a.swatch) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
