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
import { ENTITLEMENTS, LEGACY_ENTITLEMENTS } from './plans';

/** Every flag key. Same set as the `feature_flags` table seeded by 027. */
export type FeatureKey = keyof Entitlements;

export type FeatureSet = Entitlements;

export const FEATURE_KEYS: FeatureKey[] = [
  'maxPosts', 'videoEnabled', 'videoMaxSec', 'watermark', 'aiStudio',
  'cardsStandard', 'cardsPremiumRender', 'projectionMode', 'retentionDays',
  'studio',
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
    videoMaxSec: Math.max(base.videoMaxSec, pro.videoMaxSec),
    watermark: base.watermark && pro.watermark,
    aiStudio: base.aiStudio || pro.aiStudio,
    cardsStandard: base.cardsStandard || pro.cardsStandard,
    cardsPremiumRender: base.cardsPremiumRender || pro.cardsPremiumRender,
    projectionMode: base.projectionMode || pro.projectionMode,
    retentionDays: maxN(base.retentionDays, pro.retentionDays),
    studio: base.studio || pro.studio,
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
  if (patch.videoMaxSec !== undefined) out.videoMaxSec = patch.videoMaxSec;
  if (patch.watermark !== undefined) out.watermark = patch.watermark;
  if (patch.aiStudio !== undefined) out.aiStudio = patch.aiStudio;
  if (patch.cardsStandard !== undefined) out.cardsStandard = patch.cardsStandard;
  if (patch.cardsPremiumRender !== undefined) out.cardsPremiumRender = patch.cardsPremiumRender;
  if (patch.projectionMode !== undefined) out.projectionMode = patch.projectionMode;
  if (patch.retentionDays !== undefined) out.retentionDays = patch.retentionDays;
  if (patch.studio !== undefined) out.studio = patch.studio;
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
    // The frozen legacy sites have always had the whole studio. NOTE the DB's
    // legacy layer (028) copies deluxe's plan defaults, where studio is false
    // after 039 — so the platform studio special-cases legacy slugs itself
    // (studioAccess.ts) instead of trusting the resolver for them.
    // LEGACY_ENTITLEMENTS is deluxe + watermark + studio, but pinned to the
    // 30-second clips and 365-day retention those sites were built against.
    return { ...LEGACY_ENTITLEMENTS };
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

export interface StudioTabContext {
  /** A remote (virtual) celebration: keepsake cards ARE the event, so the
   *  Cards tab stays reachable even before the plan can publish one — hiding
   *  it would strand the host on an event with nothing to do. */
  remote?: boolean;
}

/** Studio tabs, in display order. `cards` disappears without cardsStandard
 *  (except on a remote event) — this is the pairing the preview's guarantee is
 *  tested on. `studio` and `assets` disappear without the Studio add-on; the
 *  Experiences tab (shown to hosts as "Frames & filters") never does, because
 *  picking from the shared library is what a host without the add-on does. */
export function visibleStudioTabs(f: FeatureSet, ctx: StudioTabContext = {}): StudioTabKey[] {
  const tabs: StudioTabKey[] = ['dashboard'];
  if (f.studio) tabs.push('studio');
  tabs.push('experiences');
  if (f.studio) tabs.push('assets');
  tabs.push('wall', 'challenges');
  if (f.cardsStandard || ctx.remote === true) tabs.push('cards');
  tabs.push('share');
  return tabs;
}

/** Where an event's studio index lands: a remote celebration opens on Cards
 *  only when its plan can actually publish one — otherwise the first thing a
 *  free host met after creating it was a paywall. */
export function studioHomeTab(f: FeatureSet, ctx: StudioTabContext = {}): 'dashboard' | 'cards' {
  return ctx.remote === true && f.cardsStandard ? 'cards' : 'dashboard';
}

/**
 * May this viewer open the creative Studio for this event?
 *
 * This is a SALES gate, not a security boundary — every paid capability is
 * enforced server-side by the resolver — so every unknown answers YES:
 * a resolver read that failed (`features === null`) fails OPEN, a platform
 * admin always gets in, and the three frozen legacy slugs keep the studio they
 * have always had (the DB's legacy layer copies deluxe's defaults, which say
 * false after 039, so the resolver cannot be trusted for them on this key).
 */
export function studioAllowed(input: {
  features: FeatureSet | null;
  isPlatformAdmin: boolean;
  legacySlug: boolean;
}): boolean {
  if (input.isPlatformAdmin || input.legacySlug) return true;
  if (input.features === null) return true;
  return input.features.studio;
}

/**
 * The browser's reading of a resolver answer (`event_features` / `org_features`,
 * migration 028) — a jsonb object of flag key → value.
 *
 * TOTAL: anything malformed falls back per key rather than throwing, because
 * this decides what a host can see and a bad cell must not blank their screen.
 *
 * THE ROLLOUT RULE: a MISSING `studio` key means TRUE. Until migration 039
 * inserts the `studio` row, the resolver simply does not return the key, and
 * every host must keep the Studio exactly as today — so absence is "not rolled
 * out", never "not entitled". The other keys fall back to `fallback` (default
 * ENTITLEMENTS.free, the most conservative plan) when absent or mistyped.
 */
export function normalizeResolvedFeatures(
  raw: unknown,
  fallback: FeatureSet = ENTITLEMENTS.free,
): FeatureSet {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const bool = (k: keyof FeatureSet, dflt: boolean): boolean =>
    (typeof src[k] === 'boolean' ? (src[k] as boolean) : dflt);
  // null is a real value (unlimited), so only a non-number/non-null falls back.
  const num = (k: keyof FeatureSet, dflt: number | null): number | null => {
    const v = src[k];
    if (v === null) return null;
    return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  };
  const posInt = (k: keyof FeatureSet, dflt: number): number => {
    const v = src[k];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
  };
  return {
    maxPosts: num('maxPosts', fallback.maxPosts),
    videoEnabled: bool('videoEnabled', fallback.videoEnabled),
    // A clip length must be a real positive number; null/absent (a resolver
    // from before migration 043) falls back rather than meaning "unlimited".
    videoMaxSec: posInt('videoMaxSec', fallback.videoMaxSec),
    watermark: bool('watermark', fallback.watermark),
    aiStudio: bool('aiStudio', fallback.aiStudio),
    cardsStandard: bool('cardsStandard', fallback.cardsStandard),
    cardsPremiumRender: bool('cardsPremiumRender', fallback.cardsPremiumRender),
    projectionMode: bool('projectionMode', fallback.projectionMode),
    retentionDays: num('retentionDays', fallback.retentionDays),
    studio: bool('studio', true),
  };
}

export interface GuestCapabilities {
  photo: boolean;
  video: boolean;
  /** Longest clip, in seconds (only meaningful when `video`). */
  videoMaxSec: number;
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
    videoMaxSec: f.videoMaxSec,
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
    case 'videoEnabled': return 'Video capture is turned off for this event.';
    case 'aiStudio': return 'AI frames and 3D props are on paid plans.';
    case 'cardsStandard': return 'Keepsake cards are on Premium and above.';
    case 'cardsPremiumRender': return 'The keepsake film render (coming soon) is on Deluxe.';
    case 'watermark': return 'Paid plans remove the Beamwall signature.';
    case 'studio': return 'The Studio is an add-on for teams and large organisations.';
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
