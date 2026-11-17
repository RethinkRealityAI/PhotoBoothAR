/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Manager-token maths.
 *
 * Split out of host.ts purely so it can be tested: host.ts imports the shared
 * supabase client at module load, and the test suite runs in a node env with no
 * browser and no client. Nothing here touches the network, the DOM, or crypto —
 * the caller draws the random bytes and hands them in.
 */

/** The token alphabet — 62 characters, unchanged since the first mint.
 *  Deliberately no punctuation: staff read these off a phone screen and type
 *  them into another one. */
export const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Characters per token — unchanged. 24 chars of a 62-symbol alphabet is
 *  ~142 bits, so the rejection fix below is about correctness, not about
 *  rescuing a token that was ever brute-forceable. */
export const TOKEN_LENGTH = 24;

/**
 * Map random bytes onto alphabet characters, DISCARDING the bytes that cannot
 * be mapped without bias.
 *
 * The naive `alphabet[byte % 62]` spreads 256 byte values over 62 letters, and
 * 256 = 4×62 + 8. The leftover 8 values (248…255) fold back onto the FIRST 8
 * letters, so those letters turn up 5 times per 256 bytes while the other 54
 * turn up 4 — a 25% edge on an eighth of the alphabet. Rejection sampling is
 * the standard fix: accept only the bytes below the largest multiple of the
 * alphabet size (248 here), and throw the rest away rather than folding them.
 *
 * Bytes are 0…255 — never negative — so JS `%` truncation-vs-flooring (which
 * would make -1 % 62 === -1, not 61) cannot bite here.
 *
 * Returns only the ACCEPTED characters, in input order, so the result is
 * usually shorter than `bytes`. Callers loop until they have enough.
 *
 * @throws RangeError if the alphabet cannot be sampled from one byte.
 */
export function mapBytesToChars(bytes: ArrayLike<number>, alphabet: string): string {
  const n = alphabet.length;
  if (n < 1 || n > 256) {
    throw new RangeError(`token alphabet must hold 1-256 characters, got ${n}`);
  }
  // Largest multiple of n that fits in a byte: 248 for n = 62; 256 for n = 256
  // (256 % 256 === 0), i.e. nothing is rejected when the alphabet is exact.
  const ceiling = 256 - (256 % n);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b >= ceiling) continue; // biased tail — discarded, never folded
    out += alphabet[b % n];
  }
  return out;
}
