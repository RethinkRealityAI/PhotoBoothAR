import { describe, it, expect } from 'vitest';
import { statusTone, pillClass, statusLabel } from './pillStyles';

describe('statusTone — unified status vocabulary', () => {
  it('maps the event lifecycle', () => {
    expect(statusTone('live')).toBe('success');
    expect(statusTone('ended')).toBe('warn');
    expect(statusTone('archived')).toBe('muted');
    expect(statusTone('draft')).toBe('neutral');
  });
  it('maps the greeting-card lifecycle', () => {
    expect(statusTone('collecting')).toBe('info');
    expect(statusTone('published')).toBe('success');
    expect(statusTone('rendered')).toBe('special');
  });
  it('maps admin order / subscription / user states', () => {
    expect(statusTone('paid')).toBe('success');
    expect(statusTone('active')).toBe('success');
    expect(statusTone('refunded')).toBe('warn');
    expect(statusTone('failed')).toBe('warn');
    expect(statusTone('banned')).toBe('muted');
    expect(statusTone('canceled')).toBe('muted');
  });
  it('is case-insensitive and falls back to neutral', () => {
    expect(statusTone('LIVE')).toBe('success');
    expect(statusTone('mystery')).toBe('neutral');
    expect(statusTone('')).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
    expect(statusTone(undefined)).toBe('neutral');
  });
  it('pillClass preserves the exact legacy classes', () => {
    expect(pillClass('live')).toBe('bg-emerald-500/15 text-emerald-400');
    expect(pillClass('ended')).toBe('bg-amber-500/15 text-amber-400');
    expect(pillClass('archived')).toBe('bg-white/[0.05] text-brand-muted/40');
    expect(pillClass('draft')).toBe('bg-white/[0.08] text-brand-muted/70');
    expect(pillClass('rendered')).toBe('bg-purple-500/15 text-purple-300');
    expect(pillClass('collecting')).toBe('bg-sky-500/15 text-sky-300');
    expect(pillClass('unknown')).toBe('bg-white/[0.08] text-brand-muted/70');
  });
  it('gives a disputed charge its own alarming tone, not the unknown grey', () => {
    // A dispute is money being clawed back with a deadline. It had no entry at
    // all, so it rendered identically to a status nobody recognised.
    expect(statusTone('disputed')).toBe('danger');
    expect(statusTone('uncollectible')).toBe('danger');
    expect(pillClass('disputed')).toBe('bg-rose-500/15 text-rose-300');
    expect(pillClass('disputed')).not.toBe(pillClass('mystery'));
  });
});

describe('statusLabel — no database enum reaches an operator raw', () => {
  it('turns separators into spaces', () => {
    expect(statusLabel('past_due')).toBe('past due');
    expect(statusLabel('incomplete_expired')).toBe('incomplete expired');
    expect(statusLabel('one-time')).toBe('one time');
  });
  it('leaves an ordinary status alone', () => {
    expect(statusLabel('live')).toBe('live');
    expect(statusLabel('paid')).toBe('paid');
  });
  it('is empty for nothing, rather than rendering "null"', () => {
    expect(statusLabel(null)).toBe('');
    expect(statusLabel(undefined)).toBe('');
    expect(statusLabel('  ')).toBe('');
  });
});
