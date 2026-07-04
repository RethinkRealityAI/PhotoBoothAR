/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Entitlements — the single source of truth for what each plan tier unlocks.
 *
 * Per-event packages (event_plans / events.plan_tier) set the event's tier;
 * an org-level Pro subscription upgrades every event of the org to at least
 * premium-level entitlements (deluxe extras stay per-event).
 *
 * The webhook edge function keeps a mirrored snapshot of this table
 * (supabase/functions/stripe-webhook/index.ts — keep the two in sync) so each
 * purchased event_plans row records the features it bought.
 */
import { useEffect, useState } from 'react';
import { useEvent } from '../events/EventContext';
import { eventOrgHasActivePro } from './host';

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

/**
 * Entitlements for the current event (must render inside <EventProvider>).
 *
 * - Coded/legacy events (source === 'code') → LEGACY_ENTITLEMENTS: watermark
 *   always on, nothing gated. This covers all VITE_EVENT builds.
 * - DB events → events.plan_tier, upgraded by THIS EVENT's org's active Pro
 *   subscription (scoped to the event's org, not the viewer's own). RLS only
 *   exposes subscriptions to signed-in members of that org, so anonymous
 *   guests and members of other orgs resolve false — the Pro floor never
 *   leaks onto a foreign event (helper caches per event-uuid).
 */
export function useEntitlements(): Entitlements {
  const { planTier, source, eventUuid } = useEvent();
  const [hasPro, setHasPro] = useState(false);

  useEffect(() => {
    if (source === 'code' || !eventUuid) return;
    let alive = true;
    eventOrgHasActivePro(eventUuid).then((v) => { if (alive) setHasPro(v); });
    return () => { alive = false; };
  }, [source, eventUuid]);

  if (source === 'code') return LEGACY_ENTITLEMENTS;
  return entitlementsFor(normalizeTier(planTier), hasPro);
}
