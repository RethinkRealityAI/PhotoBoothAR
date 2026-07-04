/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Entitlements are the single source of truth for what each plan tier unlocks,
 * and are re-checked server-side in every edge function — so the pure resolution
 * logic (tier normalization + the Pro-subscription floor) MUST stay correct.
 * These tests lock the billing-critical invariants.
 */
import { describe, it, expect } from 'vitest';
import {
  ENTITLEMENTS,
  LEGACY_ENTITLEMENTS,
  entitlementsFor,
  normalizeTier,
} from './entitlements';

describe('normalizeTier', () => {
  it('passes through the four known tiers', () => {
    expect(normalizeTier('free')).toBe('free');
    expect(normalizeTier('essentials')).toBe('essentials');
    expect(normalizeTier('premium')).toBe('premium');
    expect(normalizeTier('deluxe')).toBe('deluxe');
  });

  it('falls back to free for unknown / empty / nullish input', () => {
    expect(normalizeTier('enterprise')).toBe('free');
    expect(normalizeTier('')).toBe('free');
    expect(normalizeTier(null)).toBe('free');
    expect(normalizeTier(undefined)).toBe('free');
  });
});

describe('entitlementsFor — no Pro subscription', () => {
  it('returns the tier entitlements unchanged', () => {
    expect(entitlementsFor('free')).toEqual(ENTITLEMENTS.free);
    expect(entitlementsFor('essentials')).toEqual(ENTITLEMENTS.essentials);
    expect(entitlementsFor('premium')).toEqual(ENTITLEMENTS.premium);
    expect(entitlementsFor('deluxe')).toEqual(ENTITLEMENTS.deluxe);
  });

  it('keeps the free tier gated (video off, watermark on, capped, no AI/cards)', () => {
    const free = entitlementsFor('free');
    expect(free.videoEnabled).toBe(false);
    expect(free.watermark).toBe(true);
    expect(free.maxPosts).toBe(25);
    expect(free.aiStudio).toBe(false);
    expect(free.cardsStandard).toBe(false);
    expect(free.cardsPremiumRender).toBe(false);
    expect(free.retentionDays).toBe(7);
  });

  it('reserves the MP4 keepsake render (cardsPremiumRender) for deluxe only', () => {
    expect(ENTITLEMENTS.premium.cardsPremiumRender).toBe(false);
    expect(ENTITLEMENTS.deluxe.cardsPremiumRender).toBe(true);
  });
});

describe('entitlementsFor — Pro subscription floor', () => {
  it('lifts a free event to at least premium-level entitlements', () => {
    const freePro = entitlementsFor('free', true);
    expect(freePro.videoEnabled).toBe(true);
    expect(freePro.watermark).toBe(false);
    expect(freePro.maxPosts).toBeNull(); // unlimited beats the 25 cap
    expect(freePro.aiStudio).toBe(true);
    expect(freePro.cardsStandard).toBe(true);
    expect(freePro.retentionDays).toBe(365); // max(7, 365)
  });

  it('does NOT grant the deluxe-only MP4 render via the premium floor', () => {
    expect(entitlementsFor('free', true).cardsPremiumRender).toBe(false);
    expect(entitlementsFor('essentials', true).cardsPremiumRender).toBe(false);
    expect(entitlementsFor('premium', true).cardsPremiumRender).toBe(false);
  });

  it('preserves deluxe-only extras (takes the better of the two)', () => {
    expect(entitlementsFor('deluxe', true).cardsPremiumRender).toBe(true);
  });

  it('always drops the watermark under Pro, at every tier', () => {
    for (const tier of ['free', 'essentials', 'premium', 'deluxe'] as const) {
      expect(entitlementsFor(tier, true).watermark).toBe(false);
    }
  });

  it('never lowers a higher tier below its own entitlements', () => {
    // deluxe already unlimited + all-on; the floor must not regress it.
    expect(entitlementsFor('deluxe', true)).toEqual(ENTITLEMENTS.deluxe);
  });
});

describe('LEGACY_ENTITLEMENTS', () => {
  it('unlocks everything (deluxe-level) but always keeps the event signature watermark', () => {
    expect(LEGACY_ENTITLEMENTS.watermark).toBe(true);
    expect(LEGACY_ENTITLEMENTS.videoEnabled).toBe(true);
    expect(LEGACY_ENTITLEMENTS.maxPosts).toBeNull();
    expect(LEGACY_ENTITLEMENTS.aiStudio).toBe(true);
    expect(LEGACY_ENTITLEMENTS.cardsStandard).toBe(true);
    expect(LEGACY_ENTITLEMENTS.cardsPremiumRender).toBe(true);
  });
});
