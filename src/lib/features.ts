/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Feature flags: the browser's half.
 *
 * READ THIS FIRST — the DATABASE is the authority, not this file.
 * `public.resolve_features_raw` (migration 028) resolves the four layers, and
 * every edge function that gates a paid capability calls it. What lives here is
 * (a) the types, (b) an OPTIMISTIC local resolve so the booth does not flash a
 * watermark for 200ms while the RPC lands, and (c) the pure selectors that
 * decide which nav items and tabs exist.
 *
 * That is deliberately not a fifth mirror of ENTITLEMENTS. A mirror is two
 * authorities that can disagree about the money; this is one authority plus a
 * prediction that can only ever be wrong ON SCREEN, never on the server. If the
 * two ever disagree, the server wins and the screen corrects itself.
 *
 * The selectors are the other load-bearing piece: HostLayout, EventStudio, the
 * guest booth AND the admin live preview all read them, so the preview cannot
 * drift from what the app actually renders. There is no second code path.
 */
import type { Entitlements, PlanTier } from './plans';
import { ENTITLEMENTS } from './plans';

/** Every flag key. Same set as the `feature_flags` table seeded by 027. */
export type FeatureKey = keyof Entitlements;

export type FeatureSet = Entitlements;

export const FEATURE_KEYS: FeatureKey[] = [
  'maxPosts', 'videoEnabled', 'watermark', 'aiStudio',
  'cardsStandard', 'cardsPremiumRender', 'projectionMode', 'retentionDays',
];

const TIER_RANK: Record<PlanTier, number> = { free: 0, essentials: 1, premium: 2, deluxe: 3 };

export function higherTier(a: PlanTier, b: PlanTier): PlanTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/**
 * The effective tier for an event: the better of the event's own tier and the
 * org's, where an EXPIRED org plan counts as free.
 *
 * The expiry check is the whole reason org plans carry one. Without it a 30-day
 * comp silently becomes a permanent free upgrade, and nobody notices until the
 * revenue does.
 */
export function effectiveTier(
  eventTier: PlanTier,
  orgTier: PlanTier,
  orgExpiresAt: string | null,
  now: number = Date.now(),
): PlanTier {
  let org = orgTier;
  if (orgExpiresAt !== null && orgExpiresAt !== '') {
    const t = Date.parse(orgExpiresAt);
    if (!Number.isNaN(t) && t <= now) org = 'free';
  }
  return higherTier(eventTier, org);
}

/**
 * An active Pro subscription raises each capability to premium's.
 *
 * Written out field by field rather than looped, exactly as plans.ts
 * entitlementsFor does — the two traps live here and are worth seeing:
 * `watermark` is ANDed because false is the better value, and a null
 * (unlimited) number beats any number instead of losing to it.
 */
export function applyProFloor(base: FeatureSet): FeatureSet {
  const pro = ENTITLEMENTS.premium;
  const maxN = (a: number | null, b: number | null) =>
    (a === null || b === null ? null : Math.max(a, b));
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
 * The keys a patch actually sets.
 *
 * Spreading the patch directly would let an explicit `undefined` overwrite a
 * real value, and a truthiness filter would drop `null` (unlimited), `0` and
 * `false` — all of which are real values here, not absence.
 */
function definedOnly(patch: Partial<FeatureSet>): Partial<FeatureSet> {
  const out: Partial<FeatureSet> = {};
  if (patch.maxPosts !== undefined) out.maxPosts = patch.maxPosts;
  if (patch.videoEnabled !== undefined) out.videoEnabled = patch.videoEnabled;
  if (patch.watermark !== undefined) out.watermark = patch.watermark;
  if (patch.aiStudio !== undefined) out.aiStudio = patch.aiStudio;
  if (patch.cardsStandard !== undefined) out.cardsStandard = patch.cardsStandard;
  if (patch.cardsPremiumRender !== undefined) out.cardsPremiumRender = patch.cardsPremiumRender;
  if (patch.projectionMode !== undefined) out.projectionMode = patch.projectionMode;
  if (patch.retentionDays !== undefined) out.retentionDays = patch.retentionDays;
  return out;
}

export interface ResolveInput {
  eventTier?: PlanTier;
  orgTier?: PlanTier;
  orgExpiresAt?: string | null;
  hasProSubscription?: boolean;
  /** Legacy coded events are never gated and always watermarked. */
  legacy?: boolean;
  /** Absent key = inherit. */
  orgOverrides?: Partial<FeatureSet>;
  eventOverrides?: Partial<FeatureSet>;
  /** Global kill switches: key → forced value. Beats everything else. */
  killed?: Partial<FeatureSet>;
  now?: number;
}

/**
 * The optimistic local resolve. Mirrors the precedence in migration 028:
 * kill switch → legacy → plan default → Pro floor → org → event.
 */
export function resolveFeatures(input: ResolveInput): FeatureSet {
  if (input.legacy === true) {
    return { ...ENTITLEMENTS.deluxe, watermark: true };
  }

  const tier = effectiveTier(
    input.eventTier ?? 'free',
    input.orgTier ?? 'free',
    input.orgExpiresAt ?? null,
    input.now ?? Date.now(),
  );

  let out: FeatureSet = { ...ENTITLEMENTS[tier] };
  if (input.hasProSubscription === true) out = applyProFloor(out);

  // An absent key means inherit; see definedOnly for why this is not a spread.
  if (input.orgOverrides !== undefined) out = { ...out, ...definedOnly(input.orgOverrides) };
  if (input.eventOverrides !== undefined) out = { ...out, ...definedOnly(input.eventOverrides) };
  // Last, so the ops valve outranks even a paid grant.
  if (input.killed !== undefined) out = { ...out, ...definedOnly(input.killed) };

  return out;
}

/* ------------------------------------------------------------------ */
/* Selectors — the app AND the admin preview both read these           */
/* ------------------------------------------------------------------ */

export type HostNavKey = 'events' | 'concierge' | 'billing' | 'support';
export type StudioTabKey =
  | 'dashboard' | 'studio' | 'experiences' | 'assets'
  | 'wall' | 'challenges' | 'cards' | 'share';

/** Host rail destinations. None are flag-gated today — support and billing are
 *  always reachable, because hiding the way to pay or the way to complain is
 *  never the right product decision. Present so the preview has one source. */
export function visibleHostNav(_f: FeatureSet): HostNavKey[] {
  return ['events', 'concierge', 'billing', 'support'];
}

/** Studio tabs. `cards` disappears without cardsStandard — this is the pairing
 *  the preview's guarantee is tested on. */
export function visibleStudioTabs(f: FeatureSet): StudioTabKey[] {
  const tabs: StudioTabKey[] = ['dashboard', 'studio', 'experiences', 'assets', 'wall', 'challenges'];
  if (f.cardsStandard) tabs.push('cards');
  tabs.push('share');
  return tabs;
}

export interface GuestCapabilities {
  photo: boolean;
  video: boolean;
  watermark: boolean;
  challenges: boolean;
  cards: boolean;
  aiFrames: boolean;
  projection: boolean;
  /** null = unlimited. */
  postCap: number | null;
  retentionDays: number | null;
}

export function guestCapabilities(f: FeatureSet): GuestCapabilities {
  return {
    photo: true, // never gated: a booth that cannot take a photo is not a booth
    video: f.videoEnabled,
    watermark: f.watermark,
    challenges: true,
    cards: f.cardsStandard,
    aiFrames: f.aiStudio,
    projection: f.projectionMode,
    postCap: f.maxPosts,
    retentionDays: f.retentionDays,
  };
}

/** Why a capability is unavailable, in the customer's words. */
export function lockedReason(key: FeatureKey): string {
  switch (key) {
    case 'videoEnabled': return 'Video capture is on paid plans.';
    case 'aiStudio': return 'AI frames and 3D props are on paid plans.';
    case 'cardsStandard': return 'Keepsake cards are on Premium and above.';
    case 'cardsPremiumRender': return 'The rendered keepsake film is on Deluxe.';
    case 'watermark': return 'Paid plans remove the Beamwall signature.';
    default: return 'This is on a higher plan.';
  }
}

/**
 * Which shipped defaults disagree with the live DB defaults.
 *
 * The bundle can only be wrong on screen, but silent disagreement still rots:
 * this is what /admin/features shows as a banner so drift is visible rather
 * than discovered. Returns `tier.flag` strings.
 */
export function diffPlanDefaults(
  shipped: Record<PlanTier, FeatureSet>,
  live: Partial<Record<PlanTier, Partial<FeatureSet>>>,
): string[] {
  const out: string[] = [];
  for (const tier of Object.keys(shipped) as PlanTier[]) {
    const liveTier = live[tier];
    if (liveTier === undefined) continue;
    for (const k of FEATURE_KEYS) {
      const a = shipped[tier][k];
      const b = liveTier[k];
      if (b === undefined) continue;
      if (a !== b) out.push(`${tier}.${k}`);
    }
  }
  return out;
}
