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
  /**
   * Longest single video clip a guest may record, in seconds. Only meaningful
   * when videoEnabled. Clip length is the plan lever that actually moves cost
   * (videos are ~20% of posts but ~85% of stored bytes), which is why the
   * paid tiers stay "unlimited" on COUNT and differ on length instead.
   * submit-post derives its per-plan byte ceiling from this value.
   */
  videoMaxSec: number;
  /** true → the platform watermark/signature is baked into captures. */
  watermark: boolean;
  aiStudio: boolean;
  cardsStandard: boolean;
  cardsPremiumRender: boolean;
  projectionMode: boolean;
  /** Media retention in days; null = unlimited. */
  retentionDays: number | null;
  /**
   * The creative Studio (and its Assets tab) — an ADD-ON for teams and large
   * organisations, granted per org by override, never by plan. false on every
   * tier here; the live value comes from the DB resolver (migration 039), and
   * a resolver answer WITHOUT this key means "not rolled out yet" = true (see
   * features.ts normalizeResolvedFeatures). Not the same thing as `aiStudio`,
   * which gates AI generation and is unchanged.
   */
  studio: boolean;
}

export const ENTITLEMENTS: Record<PlanTier, Entitlements> = {
  free: {
    maxPosts: 25,
    videoEnabled: true,
    videoMaxSec: 30,
    watermark: true,
    aiStudio: false,
    cardsStandard: false,
    cardsPremiumRender: false,
    projectionMode: true,
    retentionDays: 7,
    studio: false,
  },
  essentials: {
    maxPosts: 500,
    videoEnabled: true,
    videoMaxSec: 30,
    watermark: false,
    aiStudio: true, // basic
    cardsStandard: false,
    cardsPremiumRender: false,
    projectionMode: true,
    retentionDays: 90,
    studio: false,
  },
  premium: {
    maxPosts: null,
    videoEnabled: true,
    videoMaxSec: 60,
    watermark: false,
    aiStudio: true,
    cardsStandard: true,
    cardsPremiumRender: false,
    projectionMode: true,
    retentionDays: 365,
    studio: false,
  },
  deluxe: {
    maxPosts: null,
    videoEnabled: true,
    videoMaxSec: 90,
    watermark: false,
    aiStudio: true,
    cardsStandard: true,
    cardsPremiumRender: true,
    projectionMode: true,
    retentionDays: 730,
    studio: false,
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
  // The frozen sites have always recorded 30-second clips; deluxe's 90 must
  // not reach them, and their media is never purged (retention stays at the
  // pre-2026-11-19 deluxe value they were built against).
  videoMaxSec: 30,
  retentionDays: 365,
  // The frozen sites have always had the full studio; never gated.
  studio: true,
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
    videoMaxSec: Math.max(base.videoMaxSec, pro.videoMaxSec),
    watermark: base.watermark && pro.watermark,
    aiStudio: base.aiStudio || pro.aiStudio,
    cardsStandard: base.cardsStandard || pro.cardsStandard,
    cardsPremiumRender: base.cardsPremiumRender || pro.cardsPremiumRender,
    projectionMode: base.projectionMode || pro.projectionMode,
    retentionDays: maxN(base.retentionDays, pro.retentionDays),
    // Pro does not include the Studio add-on (premium's value is false, so an
    // OR keeps the event's own value) — written out like every other field.
    studio: base.studio || pro.studio,
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

/**
 * "Up to 500 photos & videos" / "Up to 25 photos" / "Unlimited photos & videos".
 *
 * The cap counts POSTS, not photos, so on a tier with video it has to say so —
 * calling it a photo allowance understates what the tier grants. A tier with
 * videoEnabled: false must NOT say "& videos"; hence the second argument
 * rather than one blanket wording. (Free gained video on 2026-11-19.)
 */
export function formatPostCap(maxPosts: number | null, videoEnabled = true): string {
  const what = videoEnabled ? 'photos & videos' : 'photos';
  return maxPosts === null ? `Unlimited ${what}` : `Up to ${maxPosts} ${what}`;
}

/**
 * "Photos kept forever" / "Photos kept for 90 days" / "Photos kept for 1 year".
 * Whole years read as years: "730 days" makes a host do arithmetic before they
 * can see the value.
 */
export function formatRetention(retentionDays: number | null): string {
  if (retentionDays === null) return 'Photos kept forever';
  if (retentionDays >= 365 && retentionDays % 365 === 0) {
    const years = retentionDays / 365;
    return `Photos kept for ${years} year${years === 1 ? '' : 's'}`;
  }
  return `Photos kept for ${retentionDays} days`;
}

/**
 * Every clip must fit the live `posts` bucket's 25 MB per-file limit
 * (storage.buckets.file_size_limit), with headroom for container overhead and
 * MediaRecorder overshooting its target. Longer clips therefore record at a
 * lower bitrate instead of growing the file: a 30 s clip keeps today's 5 Mbps,
 * a 60 s clip records at ~3.2 Mbps and a 90 s clip at ~2.1 Mbps. That also
 * keeps the upload short on crowded venue wifi, which is the real failure mode
 * of long clips.
 */
export const VIDEO_CLIP_BYTE_BUDGET = 24 * 1024 * 1024;
const VIDEO_MAX_BPS = 5_000_000;
const VIDEO_AUDIO_BPS = 128_000;

/** Video bitrate (bits/s) for a clip of up to `videoMaxSec` seconds. */
export function videoBitsPerSecondFor(videoMaxSec: number): number {
  const sec = Number.isFinite(videoMaxSec) && videoMaxSec > 0 ? videoMaxSec : 30;
  const budget = Math.floor((VIDEO_CLIP_BYTE_BUDGET * 8) / sec) - VIDEO_AUDIO_BPS;
  return Math.min(VIDEO_MAX_BPS, budget);
}

/** "30-second video clips". */
export function formatVideoLength(videoMaxSec: number): string {
  return `${videoMaxSec}-second video clips`;
}

/**
 * What "unlimited" means, in one plain sentence. The number is submit-post's
 * EVENT_DAILY_MAX abuse backstop, which applies to every tier already — so the
 * fair-use line promises nothing the server does not do today.
 */
export const FAIR_USE_DAILY_POSTS = 2000;
export const FAIR_USE_LINE =
  `Unlimited means no cap on photos or videos. Fair use is up to ${FAIR_USE_DAILY_POSTS.toLocaleString('en-US')} new shots a day per event.`;
