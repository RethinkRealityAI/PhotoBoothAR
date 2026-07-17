/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallSpotlight — pure helpers for the wall's Featured Spotlight rotation.
 *
 * Slot cadence: photo → photo → photo → CTA-card, repeating. The CTA slot
 * itself rotates through the enabled card kinds (join QR / leaderboard
 * snippet / active challenge). When no CTA kind is enabled every slot is a
 * photo. Photo picks are random over the newest ≤60 posts, avoiding a
 * recently-shown id set that resets once exhausted.
 */

/** CTA card kinds the 4th spotlight slot can rotate through. */
export type CtaKind = 'qr' | 'leaderboard' | 'challenge';

export interface SpotlightSlot {
  kind: 'photo' | 'cta';
  /** Which CTA card to show (set only when kind === 'cta'). */
  cta?: CtaKind;
}

/** How many posts back from the newest a photo pick may reach. */
export const PHOTO_POOL_LIMIT = 60;

/** Every 4th slot (ticks 3, 7, 11, …) is a CTA card. */
const CTA_EVERY = 4;

/**
 * CTA kinds enabled by the wall settings, in rotation order.
 * `hasChallenges` should already reflect "at least one active challenge".
 */
export function enabledCtaKinds(flags: {
  showQR: boolean;
  showLeaderboard: boolean;
  hasChallenges: boolean;
}): CtaKind[] {
  const kinds: CtaKind[] = [];
  if (flags.showQR) kinds.push('qr');
  if (flags.showLeaderboard) kinds.push('leaderboard');
  if (flags.hasChallenges) kinds.push('challenge');
  return kinds;
}

/**
 * The slot for spotlight number `tick` (0-based, monotonically increasing).
 * Cycles photo·photo·photo·CTA; the CTA card advances through `ctaKinds`
 * once per CTA slot. With no enabled CTA kinds, every slot is a photo.
 */
export function slotForTick(tick: number, ctaKinds: CtaKind[]): SpotlightSlot {
  if (ctaKinds.length === 0 || tick % CTA_EVERY !== CTA_EVERY - 1) {
    return { kind: 'photo' };
  }
  const ctaIndex = Math.floor(tick / CTA_EVERY) % ctaKinds.length;
  return { kind: 'cta', cta: ctaKinds[ctaIndex] };
}

export interface PhotoPick<T> {
  /** The chosen post, or null when there is nothing to show. */
  post: T | null;
  /** True when the recently-shown set was exhausted — caller should clear it. */
  resetRecent: boolean;
}

/**
 * Pick a random post from the newest ≤PHOTO_POOL_LIMIT, avoiding ids in
 * `recent`. When every pool post is recent, signals `resetRecent` and picks
 * from the full pool again. `rand` returns [0,1) (injectable for tests).
 */
export function pickSpotlightPost<T extends { id: string }>(
  posts: readonly T[],
  recent: ReadonlySet<string>,
  rand: () => number = Math.random,
): PhotoPick<T> {
  const pool = posts.slice(0, PHOTO_POOL_LIMIT);
  if (pool.length === 0) return { post: null, resetRecent: false };
  const fresh = pool.filter((p) => !recent.has(p.id));
  const exhausted = fresh.length === 0;
  const candidates = exhausted ? pool : fresh;
  const index = Math.min(candidates.length - 1, Math.floor(rand() * candidates.length));
  return { post: candidates[index], resetRecent: exhausted };
}
