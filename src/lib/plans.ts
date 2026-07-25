/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Plan tiers, entitlements and the copy that describes them — the pure half of
 * the plan model.
 *
 * Kept free of React and of the Supabase client on purpose: the pricing table,
 * the in-app upgrade card and the tests all need these values, and importing
 * them used to drag in supabase.ts, whose createClient throws without env vars.
 * The hook that resolves entitlements for the *current* event lives in
 * entitlements.ts, which re-exports everything here.
 *
 * The webhook edge function keeps a mirrored snapshot of this table
 * (supabase/functions/stripe-webhook/index.ts — keep the two in sync) so each
 * purchased event_plans row records the features it bought.
 */
export type PlanTier = 'free' | 'essentials' | 'premium' | 'deluxe';

export interface Entitlements {
  /** Max posts per event; null = unlimited. */
  maxPosts: number | null;
  videoEnabled: boolean;
  /** true → the platform watermark/signature is baked into captures. */
  watermark: boolean;
  aiStudio: boolean;
  cardsStandard: boolean;
  cardsPremiumRender: boolean;
  projectionMode: boolean;
  /** Media retention in days; null = unlimited. */
  retentionDays: number | null;
}

export const ENTITLEMENTS: Record<PlanTier, Entitlements> = {
  free: {
    maxPosts: 25,
    videoEnabled: false,
    watermark: true,
    aiStudio: false,
    cardsStandard: false,
    cardsPremiumRender: false,
    projectionMode: true,
    retentionDays: 7,
  },
  essentials: {
    maxPosts: 500,
    videoEnabled: true,
    watermark: false,
    aiStudio: true, // basic
    cardsStandard: false,
    cardsPremiumRender: false,
    projectionMode: true,
    retentionDays: 90,
  },
  premium: {
    maxPosts: null,
    videoEnabled: true,
    watermark: false,
    aiStudio: true,
    cardsStandard: true,
    cardsPremiumRender: false,
    projectionMode: true,
    retentionDays: 365,
  },
  deluxe: {
    maxPosts: null,
    videoEnabled: true,
    watermark: false,
    aiStudio: true,
    cardsStandard: true,
    cardsPremiumRender: true,
    projectionMode: true,
    retentionDays: 365,
  },
};

/**
 * Legacy coded events (hope-gala, jenna-jake, detola-wuyi — and every
 * VITE_EVENT build) are not billed: nothing is gated, and the event signature
 * watermark is ALWAYS drawn, exactly as before the billing system existed.
 */
export const LEGACY_ENTITLEMENTS: Entitlements = {
  ...ENTITLEMENTS.deluxe,
  watermark: true,
};

const TIERS: PlanTier[] = ['free', 'essentials', 'premium', 'deluxe'];

export function normalizeTier(tier: string | null | undefined): PlanTier {
  return TIERS.includes(tier as PlanTier) ? (tier as PlanTier) : 'free';
}

/**
 * Effective entitlements for an event tier. A Pro subscription raises the
 * floor to premium-level: each capability is the better of the event tier's
 * and premium's (so deluxe-only extras like the MP4 render stay per-event).
 */
export function entitlementsFor(tier: PlanTier, hasProSubscription = false): Entitlements {
  const base = ENTITLEMENTS[tier] ?? ENTITLEMENTS.free;
  if (!hasProSubscription) return base;
  const pro = ENTITLEMENTS.premium;
  const maxN = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.max(a, b));
  return {
    maxPosts: maxN(base.maxPosts, pro.maxPosts),
    videoEnabled: base.videoEnabled || pro.videoEnabled,
    watermark: base.watermark && pro.watermark,
    aiStudio: base.aiStudio || pro.aiStudio,
    cardsStandard: base.cardsStandard || pro.cardsStandard,
    cardsPremiumRender: base.cardsPremiumRender || pro.cardsPremiumRender,
    projectionMode: base.projectionMode || pro.projectionMode,
    retentionDays: maxN(base.retentionDays, pro.retentionDays),
  };
}

/* ------------------------------------------------------------------ */
/* Plan-copy formatters                                                */
/* ------------------------------------------------------------------ */
/* The marketing pricing table and the in-app upgrade card described the
 * same plans in different words, and the landing table left retention out
 * entirely — so a prospect could sign up on Free without learning their
 * photos expire in 7 days, then meet "7-day storage" as a headline bullet
 * only after they were inside. Both surfaces now format the same values
 * through these, so the two cannot drift apart again. */

/** "Unlimited photos" / "Up to 500 photos". */
export function formatPostCap(maxPosts: number | null): string {
  return maxPosts === null ? 'Unlimited photos' : `Up to ${maxPosts} photos`;
}

/** "Photos kept forever" / "Photos kept for 90 days". */
export function formatRetention(retentionDays: number | null): string {
  return retentionDays === null ? 'Photos kept forever' : `Photos kept for ${retentionDays} days`;
}
