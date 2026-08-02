/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  KEY_FIELD_MAX,
  maskKeyId,
  normalizeProviderKeyStatus,
  splitCombinedKey,
  validateKeyInput,
} from './providerKeysModel';

describe('maskKeyId', () => {
  it('masks a short id entirely — showing most of it is not a mask', () => {
    expect(maskKeyId('abc123')).toBe('••••••');
    expect(maskKeyId('12345678')).toBe('••••••••');
  });

  it('keeps the first and last four of a long id, with a fixed-width middle', () => {
    expect(maskKeyId('hfk_ABCDEFGHIJKLMNOP')).toBe('hfk_••••••••MNOP');
    // Fixed width: two ids of different lengths mask to the same length, so the
    // mask does not leak how long the key is.
    expect(maskKeyId('hfk_ABCDEFGHIJKLMNOP').length).toBe(
      maskKeyId('hfk_ABCDEFGHIJKLMNOPQRSTUVWXYZ').length,
    );
  });

  it('never leaks the middle of the id and returns "" for nothing', () => {
    expect(maskKeyId('hfk_SECRETMIDDLE_9999')).not.toContain('SECRETMIDDLE');
    expect(maskKeyId('   ')).toBe('');
    expect(maskKeyId('')).toBe('');
  });
});

describe('splitCombinedKey', () => {
  it('splits an id:secret paste on the FIRST colon', () => {
    expect(splitCombinedKey('abc:def')).toEqual({ keyId: 'abc', keySecret: 'def' });
    // A secret containing colons must survive intact.
    expect(splitCombinedKey('abc:de:f:g')).toEqual({ keyId: 'abc', keySecret: 'de:f:g' });
  });

  it('trims the pasted line and both halves', () => {
    expect(splitCombinedKey('  abc : def  ')).toEqual({ keyId: 'abc', keySecret: 'def' });
  });

  it('returns null when it is not a pair', () => {
    expect(splitCombinedKey('abc')).toBeNull();
    expect(splitCombinedKey(':def')).toBeNull();
    expect(splitCombinedKey('abc:')).toBeNull();
    expect(splitCombinedKey('abc:   ')).toBeNull();
    expect(splitCombinedKey('')).toBeNull();
  });
});

describe('validateKeyInput', () => {
  it('accepts a plausible pair', () => {
    expect(validateKeyInput('hfk_abc123', 'sk_live_9f8e7d')).toBeNull();
  });

  it('asks for whichever half is missing, treating whitespace as missing', () => {
    expect(validateKeyInput('', 'secret')).toBe('Paste your key id.');
    expect(validateKeyInput('   ', 'secret')).toBe('Paste your key id.');
    expect(validateKeyInput('id', '')).toBe('Paste your key secret.');
    expect(validateKeyInput('id', '\n\t ')).toBe('Paste your key secret.');
  });

  it('rejects an over-long paste on either half', () => {
    const long = 'a'.repeat(KEY_FIELD_MAX + 1);
    expect(validateKeyInput(long, 'secret')).toMatch(/longer than 200/);
    expect(validateKeyInput('id', long)).toMatch(/longer than 200/);
    // Exactly at the limit is fine — the boundary is inclusive.
    expect(validateKeyInput('a'.repeat(KEY_FIELD_MAX), 'secret')).toBeNull();
  });

  it('rejects internal whitespace (a wrapped copy-paste)', () => {
    expect(validateKeyInput('hfk abc', 'secret')).toMatch(/spaces or line breaks/);
    expect(validateKeyInput('id', 'sk_live\n9f8e')).toMatch(/spaces or line breaks/);
  });

  it('does NOT enforce a prefix or format — the provider is the authority', () => {
    expect(validateKeyInput('whatever-new-format-2030', 'x')).toBeNull();
  });
});

describe('normalizeProviderKeyStatus', () => {
  it('decodes a full payload', () => {
    expect(
      normalizeProviderKeyStatus({
        configured: true,
        keyIdMasked: 'hfk_••••••••MNOP',
        platformAvailable: true,
        status: 'valid',
      }),
    ).toEqual({
      configured: true,
      keyIdMasked: 'hfk_••••••••MNOP',
      platformAvailable: true,
      status: 'valid',
    });
  });

  it('degrades a malformed 200 to "no key, no platform key" instead of inventing one', () => {
    expect(normalizeProviderKeyStatus(null)).toEqual({
      configured: false,
      keyIdMasked: null,
      platformAvailable: false,
    });
    expect(normalizeProviderKeyStatus({ configured: 'yes', platformAvailable: 1 })).toEqual({
      configured: false,
      keyIdMasked: null,
      platformAvailable: false,
    });
  });

  it('treats an empty masked id as absent and drops an unknown status', () => {
    const s = normalizeProviderKeyStatus({ configured: true, keyIdMasked: '  ', status: 'pending' });
    expect(s.keyIdMasked).toBeNull();
    expect('status' in s).toBe(false);
    expect(s.configured).toBe(true);
  });
});
