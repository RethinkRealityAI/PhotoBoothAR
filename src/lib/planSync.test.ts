import { describe, it, expect } from 'vitest';
import { planChange, expiryWarning, formatAmount, lookupKey, type StripeAction } from './planSync';
import type { PlanTier } from './plans';

const TIERS: PlanTier[] = ['free', 'essentials', 'premium', 'deluxe'];

describe('planChange — an admin screen may never create a charge', () => {
  it('never returns a charge-creating action, for ANY transition', () => {
    // The rule this module exists for, asserted exhaustively rather than by
    // reading the branches. 'checkout_link' hands the operator a link to send;
    // it does not bill anyone.
    const allowed: StripeAction[] = ['none', 'metadata', 'cancel_at_period_end', 'checkout_link'];
    for (const current of TIERS) {
      for (const next of TIERS) {
        for (const sub of [true, false]) {
          const out = planChange({ current, next, hasActiveSubscription: sub });
          expect(allowed, `${current}->${next} sub=${sub}`).toContain(out.stripeAction);
        }
      }
    }
  });

  it('an upgrade with no subscription offers a link and says nobody was charged', () => {
    const out = planChange({ current: 'free', next: 'premium', hasActiveSubscription: false });
    expect(out.stripeAction).toBe('checkout_link');
    expect(out.warning).toMatch(/no card is charged/i);
  });

  it('an upgrade on top of a live subscription is a comp, not a proration', () => {
    const out = planChange({ current: 'essentials', next: 'deluxe', hasActiveSubscription: true });
    expect(out.stripeAction).toBe('metadata');
    expect(out.warning).toMatch(/not charged the difference/i);
  });

  it('a downgrade with a live subscription cancels at period end, and says so', () => {
    const out = planChange({ current: 'premium', next: 'free', hasActiveSubscription: true });
    expect(out.stripeAction).toBe('cancel_at_period_end');
    // The operator must know this is not a refund before they press the button.
    expect(out.warning).toMatch(/does not refund/i);
    expect(out.warning).toMatch(/keep Pro until then/i);
  });

  it('a downgrade with no subscription just writes metadata', () => {
    expect(planChange({ current: 'premium', next: 'free', hasActiveSubscription: false }).stripeAction)
      .toBe('metadata');
  });

  it('a no-op change does nothing in Stripe unless there is a subscription to relabel', () => {
    expect(planChange({ current: 'premium', next: 'premium', hasActiveSubscription: false }).stripeAction)
      .toBe('none');
    expect(planChange({ current: 'premium', next: 'premium', hasActiveSubscription: true }).stripeAction)
      .toBe('metadata');
  });

  it('always reports the tier it was asked for — the DB is authoritative', () => {
    for (const next of TIERS) {
      expect(planChange({ current: 'free', next, hasActiveSubscription: false }).tier).toBe(next);
    }
  });
});

describe('expiryWarning', () => {
  it('warns when a paid comp has no end date', () => {
    expect(expiryWarning('deluxe', null)).toMatch(/stays until somebody removes it/i);
    expect(expiryWarning('premium', '')).not.toBeNull();
  });
  it('is silent for a dated comp, and for free', () => {
    expect(expiryWarning('deluxe', '2026-09-01T00:00:00Z')).toBeNull();
    expect(expiryWarning('free', null)).toBeNull();
  });
});

describe('formatAmount — integer cents in, money out', () => {
  it('formats whole and part dollars', () => {
    expect(formatAmount(4900)).toBe('$49.00');
    expect(formatAmount(500)).toBe('$5.00');
    expect(formatAmount(16900)).toBe('$169.00');
  });
  it('formats zero rather than blanking it', () => {
    expect(formatAmount(0)).toBe('$0.00');
  });
});

describe('lookupKey', () => {
  it('passes our stable ids through unchanged, so provisioning stays idempotent', () => {
    expect(lookupKey('event_package.premium')).toBe('event_package.premium');
    expect(lookupKey('credit_pack.120')).toBe('credit_pack.120');
  });
  it('strips anything Stripe would reject', () => {
    expect(lookupKey('weird key/with:stuff')).toBe('weird_key_with_stuff');
  });
});
