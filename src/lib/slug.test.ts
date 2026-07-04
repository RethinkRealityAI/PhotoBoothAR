import { describe, it, expect } from 'vitest';
import { slugify, SLUG_RE, RESERVED_SLUGS } from './slug';

describe('slugify', () => {
  it('lowercases and dashes a plain name', () => {
    expect(slugify('Hope Gala 2026')).toBe('hope-gala-2026');
  });
  it('strips diacritics', () => {
    expect(slugify('Café Fête')).toBe('cafe-fete');
  });
  it('collapses punctuation runs into single dashes and trims edges', () => {
    expect(slugify('  --Jenna & Jake!!  ')).toBe('jenna-jake');
  });
  it('returns empty string when nothing usable remains', () => {
    expect(slugify('')).toBe('');
    expect(slugify('!!! ***')).toBe('');
  });
  it('clamps long names to 63 chars without a trailing dash', () => {
    const s = slugify(`${'a'.repeat(60)} bcdefg`);
    expect(s.length).toBeLessThanOrEqual(63);
    expect(s.endsWith('-')).toBe(false);
    expect(SLUG_RE.test(s)).toBe(true);
  });
  it('produces slugs that satisfy SLUG_RE for typical names', () => {
    for (const name of ['Detola & Wuyi', "Marie's 40th Birthday", 'GALA night']) {
      expect(SLUG_RE.test(slugify(name))).toBe(true);
    }
  });
});

describe('reserved slugs', () => {
  it('includes route words and the coded legacy events', () => {
    for (const s of ['admin', 'host', 'e', 'm', 'wall', 'hope-gala', 'jenna-jake', 'detola-wuyi']) {
      expect(RESERVED_SLUGS.has(s)).toBe(true);
    }
  });
});
