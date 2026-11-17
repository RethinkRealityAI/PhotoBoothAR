/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { registryNote, REGISTRY_CAP } from './registryNote';

describe('registryNote', () => {
  it('says nothing about an empty list — the screen has its own empty copy', () => {
    expect(registryNote(0, 'promo code')).toBe('');
    expect(registryNote(-1, 'promo code')).toBe('');
  });

  it('counts, and gets the singular right', () => {
    expect(registryNote(1, 'platform admin')).toBe('1 platform admin.');
    expect(registryNote(12, 'platform admin')).toBe('12 platform admins.');
  });

  it('never states a capped count as a total', () => {
    const note = registryNote(REGISTRY_CAP, 'promo code');
    expect(note).toContain('Showing the first');
    expect(note).toContain('there may be more');
    // The failure this guards: "500 promo codes." reads as "that is all of them"
    // when 500 is only as far as the server was willing to count.
    expect(note).not.toBe(`${REGISTRY_CAP} promo codes.`);
  });

  it('treats one under the cap as a plain, complete count', () => {
    expect(registryNote(REGISTRY_CAP - 1, 'product')).toBe(`${REGISTRY_CAP - 1} products.`);
  });

  it('takes an explicit cap, so a screen with a smaller one can say so', () => {
    expect(registryNote(10, 'flag', 10)).toContain('Showing the first 10 flags');
    expect(registryNote(9, 'flag', 10)).toBe('9 flags.');
  });
});
