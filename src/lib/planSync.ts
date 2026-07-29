/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What an admin plan change is allowed to do to Stripe.
 *
 * The rule this module exists to enforce: an admin screen may never create a
 * charge. A plan change made from the inside is a COMP or a correction — it
 * deliberately grants entitlement without payment — and a control that could
 * bill a customer's saved card from an internal tool is a chargeback generator
 * and an SCA failure waiting to happen. Upgrades therefore produce a Checkout
 * LINK to send the customer, never a charge.
 *
 * `stripeSyncPlan` has no branch that returns a charge-creating action, and its
 * test asserts that directly rather than trusting the reader.
 *
 * The database is authoritative either way: the plan applies whether or not
 * Stripe is reachable, or even configured.
 */
import type { PlanTier } from './plans';

export type StripeAction =
  /** Nothing to do in Stripe. */
  | 'none'
  /** Write beamwall_plan_* onto the Stripe customer so the books stop lying. */
  | 'metadata'
  /** Downgrade with a live subscription: stop the renewal, keep what they paid for. */
  | 'cancel_at_period_end'
  /** Upgrade: hand the operator a Checkout link to send. Charges nothing. */
  | 'checkout_link';

export interface PlanChange {
  tier: PlanTier;
  stripeAction: StripeAction;
  /** Operator-facing consequence, shown in the confirm dialog BEFORE they commit. */
  warning: string | null;
}

const RANK: Record<PlanTier, number> = { free: 0, essentials: 1, premium: 2, deluxe: 3 };

export interface PlanChangeInput {
  current: PlanTier;
  next: PlanTier;
  /** Does the org hold a live Pro subscription right now? */
  hasActiveSubscription: boolean;
  /** Is this a comp/trial (has an expiry) rather than a permanent move? */
  expiresAt?: string | null;
}

export function planChange(input: PlanChangeInput): PlanChange {
  const { current, next, hasActiveSubscription } = input;
  const up = RANK[next] > RANK[current];
  const down = RANK[next] < RANK[current];

  if (!up && !down) {
    return { tier: next, stripeAction: hasActiveSubscription ? 'metadata' : 'none', warning: null };
  }

  if (down) {
    if (hasActiveSubscription) {
      return {
        tier: next,
        stripeAction: 'cancel_at_period_end',
        warning:
          'This customer has a live Pro subscription. Downgrading stops the renewal at the end of the ' +
          'period they have already paid for — it does not refund them, and they keep Pro until then.',
      };
    }
    return {
      tier: next,
      stripeAction: 'metadata',
      warning: 'They lose the higher plan immediately. Nothing is refunded, because nothing was charged here.',
    };
  }

  // Upgrade.
  if (hasActiveSubscription) {
    return {
      tier: next,
      stripeAction: 'metadata',
      warning: 'Applied as a comp on top of their existing subscription. They are not charged the difference.',
    };
  }
  return {
    tier: next,
    stripeAction: 'checkout_link',
    warning:
      'Applied immediately as a comp — no card is charged. To make it a paid plan, send them the ' +
      'Checkout link this produces.',
  };
}

/**
 * A comp with no end date is how a free tier gets created by accident: nobody
 * remembers granting it, and the revenue notices before anyone else does.
 */
export function expiryWarning(tier: PlanTier, expiresAt: string | null): string | null {
  if (tier === 'free') return null;
  if (expiresAt !== null && expiresAt !== '') return null;
  return 'No end date — this plan stays until somebody removes it by hand.';
}

/** Human money, from integer cents. Never floats, never division in the UI.
 *  Locale is PINNED: an unpinned Intl renders USD as "US$49.00" on any
 *  non-en-US machine (en-CA does), so the same catalogue row would read
 *  differently per admin's OS — and the colocated test only passes on en-US. */
export function formatAmount(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** The Stripe `lookup_key` for a catalogue row — our own stable id. */
export function lookupKey(catalogId: string): string {
  return catalogId.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
