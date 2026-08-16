import { describe, it, expect } from 'vitest';
import { mapBytesToChars, TOKEN_ALPHABET, TOKEN_LENGTH } from './token';

const ALL_BYTES = Array.from({ length: 256 }, (_, i) => i);

describe('token constants', () => {
  it('are unchanged: 24 characters drawn from the 62-symbol alphabet', () => {
    expect(TOKEN_LENGTH).toBe(24);
    expect(TOKEN_ALPHABET).toHaveLength(62);
    expect(new Set(TOKEN_ALPHABET).size).toBe(62); // no duplicate symbol
  });
});

describe('mapBytesToChars — uniformity', () => {
  it('gives EVERY letter exactly the same weight across the whole byte range', () => {
    // The regression this file exists for: with `alphabet[b % 62]` over all 256
    // bytes, the first 8 letters land 5 times each and the other 54 land 4.
    const out = mapBytesToChars(ALL_BYTES, TOKEN_ALPHABET);
    const counts = new Map<string, number>();
    for (const ch of out) counts.set(ch, (counts.get(ch) ?? 0) + 1);

    expect(counts.size).toBe(62); // every letter reachable
    expect([...counts.values()].every((c) => c === 4)).toBe(true);
    expect(out).toHaveLength(248); // 4 × 62 accepted, 8 rejected
  });

  it('discards the biased tail instead of folding it onto the first letters', () => {
    // 248…255 are the values that used to double-count 'A'…'H'.
    expect(mapBytesToChars([248, 249, 250, 251, 252, 253, 254, 255], TOKEN_ALPHABET)).toBe('');
  });

  it('accepts the last unbiased byte (247) and maps it to the final letter', () => {
    // 247 = 3×62 + 61 → index 61 → the last character of the alphabet.
    expect(mapBytesToChars([247], TOKEN_ALPHABET)).toBe(TOKEN_ALPHABET[61]);
    expect(mapBytesToChars([247], TOKEN_ALPHABET)).toBe('9');
  });
});

describe('mapBytesToChars — mapping', () => {
  it('maps every unbiased byte to the letter at that byte modulo 62', () => {
    // Derived, not hand-typed: byte b < 248 must land on alphabet[b % 62] —
    // which is the whole mapping contract, checked at all 248 accepted values.
    for (let b = 0; b < 248; b += 1) {
      expect(mapBytesToChars([b], TOKEN_ALPHABET)).toBe(TOKEN_ALPHABET[b % 62]);
    }
  });

  it('preserves input order across the alphabet boundaries', () => {
    // 25/26 is the A-Z → a-z boundary, 51/52 the a-z → 0-9 one.
    expect(mapBytesToChars([0, 1, 25, 26, 51, 52, 61], TOKEN_ALPHABET)).toBe('ABZaz09');
  });

  it('only ever emits characters from the given alphabet', () => {
    const out = mapBytesToChars(ALL_BYTES, TOKEN_ALPHABET);
    expect([...out].every((ch) => TOKEN_ALPHABET.includes(ch))).toBe(true);
  });

  it('emits nothing for an empty byte run', () => {
    expect(mapBytesToChars([], TOKEN_ALPHABET)).toBe('');
  });

  it('accepts a Uint8Array as well as a plain array (same result)', () => {
    const bytes = Uint8Array.from([0, 61, 248]);
    expect(mapBytesToChars(bytes, TOKEN_ALPHABET)).toBe(mapBytesToChars([0, 61, 248], TOKEN_ALPHABET));
  });
});

describe('mapBytesToChars — alphabet bounds', () => {
  it('rejects nothing when the alphabet is exactly one byte wide (256)', () => {
    const alphabet256 = ALL_BYTES.map((b) => String.fromCharCode(b)).join('');
    expect(mapBytesToChars(ALL_BYTES, alphabet256)).toHaveLength(256);
  });

  it('stays uniform for a 2-letter alphabet (256 is a multiple of 2 — nothing rejected)', () => {
    const out = mapBytesToChars(ALL_BYTES, 'ab');
    expect(out).toHaveLength(256);
    expect([...out].filter((c) => c === 'a')).toHaveLength(128);
  });

  it('stays uniform for an awkward 3-letter alphabet (255 accepted, 1 rejected)', () => {
    const out = mapBytesToChars(ALL_BYTES, 'abc');
    expect(out).toHaveLength(255); // 256 - (256 % 3) = 255
    for (const ch of 'abc') expect([...out].filter((c) => c === ch)).toHaveLength(85);
  });

  it('throws rather than looping forever on an unusable alphabet', () => {
    // An empty alphabet would make the ceiling NaN, every byte rejected, and
    // the caller's "draw until long enough" loop non-terminating.
    expect(() => mapBytesToChars([1], '')).toThrow(RangeError);
    expect(() => mapBytesToChars([1], 'x'.repeat(257))).toThrow(RangeError);
  });
});
