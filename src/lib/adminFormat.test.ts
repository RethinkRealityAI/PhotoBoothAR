import { describe, it, expect } from 'vitest';
import { formatCents, formatCount, formatDate } from './adminFormat';

describe('formatCents', () => {
  it('formats USD cents', () => {
    expect(formatCents(4900)).toBe('$49.00');
    expect(formatCents(16900, 'usd')).toBe('$169.00');
    expect(formatCents(0)).toBe('$0.00');
  });
  it('returns an em dash for null / undefined / NaN', () => {
    expect(formatCents(null)).toBe('—');
    expect(formatCents(undefined)).toBe('—');
    expect(formatCents(Number.NaN)).toBe('—');
  });
  it('formats a valid non-USD currency', () => {
    expect(formatCents(1000, 'eur')).toContain('10.00');
  });
  it('falls back for a malformed currency code', () => {
    expect(formatCents(1000, 'zz')).toBe('10.00 ZZ');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(0)).toBe('0');
  });
  it('em dash for null', () => {
    expect(formatCount(null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats an ISO date', () => {
    expect(formatDate('2026-07-06T12:00:00Z')).toBe('Jul 6, 2026');
  });
  it('em dash for empty / invalid', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});
