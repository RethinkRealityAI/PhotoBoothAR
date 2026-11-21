/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Every package the partnerships hub can put on an `offer` slide.
 *
 * Two kinds of entry, and the split is load-bearing:
 *  - the four SELF-SERVE tiers (`placeholder: false`) mirror the live pricing
 *    on the landing page (src/pages/Landing.tsx TIERS, written against
 *    src/lib/plans.ts ENTITLEMENTS). If those change, change these.
 *  - the SALES-LED offers (Beamwall Signature, Beamwall Partner) carry the
 *    prices Dapo approved as the starting point (`placeholder: false`). Any
 *    future unconfirmed offer goes in with `placeholder: true` and prospects
 *    see its `fallbackPrice` instead (publicOfferPrice()).
 *  - Partner is a licence to build and run Beamwall for clients — the product
 *    has NO partner branding / white-label / resale tier yet; never claim one.
 *    Prospect pages render prices through publicOfferPrice().
 *  - Nigeria has no self-serve checkout: NG clients are invoiced (PayPal /
 *    bank transfer), so there are no NG self-serve tiers.
 *
 * Pure data — no React, no supabase import (node-env tests import this).
 */
import type { Market, Offer } from './salesTypes';

export const OFFERS: Offer[] = [
  // ── Self-serve (live on the site) ────────────────────────────────────────
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    unit: 'to try it',
    blurb: 'Spin up a booth and see the magic.',
    features: [
      '1 live event',
      'Photo booth + live wall',
      'Up to 25 photos & videos',
      'Photos kept for 7 days',
      'A subtle Beamwall credit',
    ],
    placeholder: false,
    fallbackPrice: '$0',
    icp: ['planners', 'brands', 'creators'],
    market: 'na',
  },
  {
    id: 'essentials',
    name: 'Essentials',
    price: '$49',
    unit: 'per event',
    blurb: 'Everything a small celebration needs.',
    features: [
      'Up to 500 photos & videos',
      '30-second video clips',
      'Every frame & effect',
      'No watermark',
      'Photos kept for 90 days',
    ],
    placeholder: false,
    fallbackPrice: '$49',
    icp: ['planners', 'creators'],
    market: 'na',
  },
  {
    id: 'premium',
    name: 'Premium',
    price: '$99',
    unit: 'per event',
    blurb: 'The full experience — most hosts pick this.',
    features: [
      'Unlimited photos & video',
      '60-second video clips',
      'AI event studio',
      'Greeting cards',
      'Photos kept for 1 year',
      'Priority support',
    ],
    placeholder: false,
    fallbackPrice: '$99',
    icp: ['planners', 'brands', 'creators'],
    market: 'na',
  },
  {
    id: 'deluxe',
    name: 'Deluxe',
    price: '$169',
    unit: 'per event',
    blurb: 'Longer clips, two years of photos, every finishing touch.',
    features: [
      'Everything in Premium',
      '90-second video clips',
      'Highlight film (coming soon)',
      'Photos kept for 2 years',
    ],
    placeholder: false,
    fallbackPrice: '$169',
    icp: ['planners', 'brands', 'creators'],
    market: 'na',
  },

  // ── NA · Beamwall Signature — done-for-you, by guest tier ────────────────
  // Approved by Dapo (2026-11-17) as the starting price.
  {
    id: 'signature-150',
    name: 'Signature · up to 150 guests',
    price: '$495',
    unit: 'per event',
    blurb: 'We design and build it all remotely; you get the event links.',
    features: [
      'Custom 2D AR frames and filters',
      'Live photo feed and wall link',
      'Keepsake cards after the event',
      'Event links + Signage Kit, ready to share',
      'Planners: five events for the price of four',
    ],
    placeholder: false,
    fallbackPrice: '$495',
    icp: ['planners', 'brands', 'creators'],
    market: 'na',
  },
  {
    id: 'signature-400',
    name: 'Signature · up to 400 guests',
    price: '$795',
    unit: 'per event',
    blurb: 'Done for you for bigger rooms, from first frame to the keepsakes.',
    features: [
      'Custom 2D frames, 3D AR assets and filters',
      'Challenges, live photo feed and wall link',
      'Keepsake cards (highlight film coming soon)',
      'Event links, Signage Kit and setup guide',
      'Planners: five events for the price of four',
    ],
    placeholder: false,
    fallbackPrice: '$795',
    icp: ['planners', 'brands'],
    market: 'na',
  },
  {
    id: 'signature-custom',
    name: 'Signature · 400+ guests',
    price: 'From $1,495',
    unit: 'quoted per event',
    blurb: 'Conferences, festivals and big shows, scoped with you.',
    features: [
      'Scoped to your run of show',
      'Multiple wall links and booth experiences',
      'Built remotely by us, hosted by your team',
      'Planners: five events for the price of four',
    ],
    placeholder: false,
    fallbackPrice: 'From $1,495',
    icp: ['planners', 'brands'],
    market: 'na',
  },
  // ── NA · Beamwall Partner — studio licence WITH resale rights ────────────
  {
    id: 'partner',
    name: 'Beamwall Partner',
    price: '$499/month or $4,990/year',
    unit: 'studio licence',
    blurb: 'A licence to build and run Beamwall experiences for your clients and set your own price.',
    features: [
      'Studio licence for many events',
      'Build custom frames and filters',
      'Run Beamwall experiences for your clients',
      'You set your own client price',
      'Monthly or annual',
    ],
    placeholder: false,
    fallbackPrice: '$499/month or $4,990/year',
    icp: ['planners', 'brands'],
    market: 'na',
  },

  // ── NG · invoiced (PayPal / bank transfer), never self-serve checkout ────
  // Approved naira prices (volume play, priced below a physical 360-booth
  // rental). Invoiced; quotes valid 14 days.
  {
    id: 'ng-signature-300',
    name: 'Signature · up to 300 guests',
    price: '₦200,000',
    unit: 'per event',
    blurb: 'Every guest becomes the booth. We design and build it; you get the links.',
    features: [
      'Custom frames and filters in your colours',
      'Live photo feed and wall link',
      'Keepsake cards after the event',
      'Event links + Signage Kit, ready to share',
      'Planners: five events for the price of four',
    ],
    placeholder: false,
    fallbackPrice: '₦200,000',
    icp: ['planners', 'brands', 'creators'],
    market: 'ng',
  },
  {
    id: 'ng-signature-700',
    name: 'Signature · up to 700 guests',
    price: '₦350,000',
    unit: 'per event',
    blurb: 'For the big celebrations — the whole hall on the wall.',
    features: [
      'Custom frames, 3D AR assets and challenges',
      'Live photo feed and wall link',
      'Keepsake cards (highlight film coming soon)',
      'Event links, Signage Kit and setup guide',
      'Planners: five events for the price of four',
    ],
    placeholder: false,
    fallbackPrice: '₦350,000',
    icp: ['planners', 'brands'],
    market: 'ng',
  },
  {
    id: 'ng-signature-custom',
    name: 'Signature · 700+ guests & activations',
    price: 'From ₦600,000',
    unit: 'quoted per event',
    blurb: 'Brand activations, concerts and multi-day shows, scoped with you.',
    features: [
      'Scoped to your run of show',
      'Multiple wall links and booth experiences',
      'Your brand on every shot',
      'Planners: five events for the price of four',
    ],
    placeholder: false,
    fallbackPrice: 'From ₦600,000',
    icp: ['planners', 'brands'],
    market: 'ng',
  },
  {
    id: 'ng-partner',
    name: 'Beamwall Partner',
    price: '₦670,000/month',
    unit: 'studio licence, monthly (annual on request)',
    blurb: 'A licence to build and run Beamwall experiences for your clients and set your own price.',
    features: [
      'Studio licence for many events',
      'Build custom frames and filters',
      'Run Beamwall experiences for your clients',
      'You set your own client price',
      'Monthly or annual, invoiced',
    ],
    placeholder: false,
    fallbackPrice: '₦670,000/month',
    icp: ['planners', 'brands'],
    market: 'ng',
  },
];

export function getOffer(id: string): Offer | undefined {
  return OFFERS.find((o) => o.id === id);
}

/** Offers sold in one market. */
export function offersFor(market: Market): Offer[] {
  return OFFERS.filter((o) => o.market === market);
}

/** The USD self-serve checkout tiers (NA only). NG decks must never show these. */
export const SELF_SERVE_OFFER_IDS: readonly string[] = ['free', 'essentials', 'premium', 'deluxe'];
