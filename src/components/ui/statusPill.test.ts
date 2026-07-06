import { describe, it, expect } from 'vitest';
import { statusTone, pillClass } from './statusPill';

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
});
