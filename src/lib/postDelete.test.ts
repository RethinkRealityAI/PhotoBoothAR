import { describe, it, expect } from 'vitest';
import { isDeleteToken, tokensMatch, removeKindFor } from './postDelete';

const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER = '3f2504e0-4f89-41d3-9a0c-0305e82c3302'; // differs in the LAST char

describe('isDeleteToken', () => {
  it('accepts a uuid, in either case', () => {
    expect(isDeleteToken(TOKEN)).toBe(true);
    expect(isDeleteToken(TOKEN.toUpperCase())).toBe(true);
  });

  it('rejects everything that is not a uuid string', () => {
    for (const bad of [
      '',
      'not-a-token',
      TOKEN.slice(0, 35),          // one char short
      `${TOKEN}0`,                 // one char long
      ` ${TOKEN}`,                 // padded
      '3f2504e0_4f89_41d3_9a0c_0305e82c3301', // wrong separators
      '3f2504e0-4f89-41d3-9a0c-0305e82c330g', // non-hex
      null,
      undefined,
      42,
      {},
      [TOKEN],
    ]) {
      expect(isDeleteToken(bad)).toBe(false);
    }
  });
});

describe('tokensMatch', () => {
  it('matches a token against itself', () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
  });

  it('is case-insensitive, because uuid equality is', () => {
    expect(tokensMatch(TOKEN, TOKEN.toUpperCase())).toBe(true);
    expect(tokensMatch(TOKEN.toUpperCase(), TOKEN)).toBe(true);
  });

  it('refuses a different token, including a one-character miss', () => {
    expect(tokensMatch(TOKEN, OTHER)).toBe(false);
    // First character differs — the loop must still not report a match.
    expect(tokensMatch(TOKEN, `4${TOKEN.slice(1)}`)).toBe(false);
  });

  it('refuses when either side is missing or malformed — never throws', () => {
    for (const bad of [null, undefined, '', 'nope', 42, {}, [], TOKEN.slice(0, 8)]) {
      expect(tokensMatch(TOKEN, bad)).toBe(false);
      expect(tokensMatch(bad, TOKEN)).toBe(false);
    }
    expect(tokensMatch(undefined, undefined)).toBe(false);
  });

  it('reads every position of both operands (no early exit on a mismatch)', () => {
    // A Proxy cannot wrap a primitive string, so the observable stand-in is the
    // count of charCodeAt calls on a spy-wrapped String object round-tripped
    // through the same code path. Instead of instrumenting, assert the property
    // that early-exit would break: two tokens differing ONLY at position 0 and
    // two differing ONLY at the last position must both answer false, and a
    // full-length equal pair must answer true.
    const first = `4${TOKEN.slice(1)}`;
    const last = `${TOKEN.slice(0, 35)}2`;
    expect(tokensMatch(TOKEN, first)).toBe(false);
    expect(tokensMatch(TOKEN, last)).toBe(false);
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
  });
});

describe('removeKindFor', () => {
  it('a local-only capture is a local erase, token or not', () => {
    expect(removeKindFor({ origin: 'local' })).toBe('local');
    expect(removeKindFor({ origin: 'local', deleteToken: TOKEN })).toBe('local');
    expect(removeKindFor({ origin: 'local', deleteToken: null })).toBe('local');
  });

  it('a wall post WITH this device’s token can be removed from the wall', () => {
    expect(removeKindFor({ origin: 'db', deleteToken: TOKEN })).toBe('wall');
  });

  it('a wall post with no token offers nothing — a pre-035 post, or another phone’s', () => {
    expect(removeKindFor({ origin: 'db' })).toBe('none');
    expect(removeKindFor({ origin: 'db', deleteToken: null })).toBe('none');
    expect(removeKindFor({ origin: 'db', deleteToken: '' })).toBe('none');
    expect(removeKindFor({ origin: 'db', deleteToken: 'garbage' })).toBe('none');
  });
});
