import { describe, it, expect } from 'vitest';
import { formatCents, formatCount, formatDate, auditActionLabel, auditMetaSummary } from './adminFormat';

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

describe('auditActionLabel', () => {
  it('reads as English, not as a database enum', () => {
    expect(auditActionLabel('set_event_status')).toBe('Set event status');
    expect(auditActionLabel('adjust_credits')).toBe('Adjust credits');
    expect(auditActionLabel('remove-admin')).toBe('Remove admin');
  });
  it('handles an action nobody has taught it about', () => {
    // Derived, not looked up: an action added to admin-api next week reads
    // correctly the day it ships instead of showing the raw enum.
    expect(auditActionLabel('freeze_the_moon')).toBe('Freeze the moon');
  });
  it('em dash for nothing', () => {
    expect(auditActionLabel(null)).toBe('—');
    expect(auditActionLabel('')).toBe('—');
    expect(auditActionLabel('   ')).toBe('—');
  });
});

describe('auditMetaSummary', () => {
  it('reads the detail out of the braces', () => {
    expect(auditMetaSummary({ delta: 25, reason: 'goodwill' })).toBe('delta 25 · reason goodwill');
    expect(auditMetaSummary({ status: 'live' })).toBe('status live');
  });
  it('keeps a zero, which is data, not absence', () => {
    expect(auditMetaSummary({ delta: 0 })).toBe('delta 0');
    expect(auditMetaSummary({ comped: false })).toBe('comped false');
  });
  it('drops only null and undefined', () => {
    expect(auditMetaSummary({ a: null, b: undefined, c: 1 })).toBe('c 1');
  });
  it('falls back to compact JSON for a nested value rather than dropping it', () => {
    expect(auditMetaSummary({ ref: { id: 7 } })).toBe('ref {"id":7}');
  });
  it('is empty for no meta at all', () => {
    expect(auditMetaSummary(null)).toBe('');
    expect(auditMetaSummary(undefined)).toBe('');
    expect(auditMetaSummary({})).toBe('');
  });
});
