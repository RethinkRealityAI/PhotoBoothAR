/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The public-beta pricing stance, in ONE place.
 *
 * While BETA_FREE is true the marketing page says the beta is free, shows the
 * paid plans as what comes AFTER the beta, and every plan button reads "Join
 * the beta free" (all of them go to /signup either way). Flip it to false and
 * the same page goes back to normal selling copy: a per-event pricing heading
 * and a distinct "Choose <plan>" button per tier.
 *
 * MARKETING COPY ONLY. This flag changes no entitlement, price or checkout:
 * beta events still resolve their features through resolve_features_raw like
 * any other event.
 *
 * FLIPPING IT: also edit index.html's static FAQPage JSON-LD (add or drop the
 * "Is Beamwall really free right now?" entry and the "Nothing during the
 * beta — no credit card needed. After the beta: " lead-in of the cost answer;
 * the exact strings are in landingContent.ts). landingContent.test.ts goes red
 * until you do — crawlers read that
 * block without running the app, so it cannot follow this flag by itself.
 *
 * Pure and import-free, so landingContent.ts (whose purity is
 * load-bearing for its node-env test) can read it too.
 */
// Owner decision (2026-11-16): sell paid plans from day one. Flip to true for
// a free-beta stance (see FLIPPING IT above).
export const BETA_FREE = false;

export interface PricingCopy {
  heading: string;
  intro: string;
  /** The button label for one tier card. */
  cta: (tierName: string) => string;
}

export function pricingCopy(beta: boolean): PricingCopy {
  if (beta) {
    return {
      heading: 'Free while we’re in beta',
      intro:
        'Every beta event gets the full booth and live wall free. Paid plans below start when the beta ends — we’ll tell you before anything is charged.',
      cta: () => 'Join the beta free',
    };
  }
  return {
    heading: 'Simple pricing, per event',
    intro:
      'Pay only for the events you host — no subscription required. Start free, upgrade an event whenever you like.',
    // Distinct names per tier: four identical "Get started" buttons gave a
    // screen-reader user a list of links that all read the same.
    cta: (tierName) => (tierName === 'Free' ? 'Start free' : `Choose ${tierName}`),
  };
}
