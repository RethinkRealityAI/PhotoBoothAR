import { describe, it, expect } from 'vitest';
import { ENTITLEMENTS, entitlementsFor } from './plans';
import {
  higherTier, effectiveTier, applyProFloor, resolveFeatures,
  visibleHostNav, visibleStudioTabs, guestCapabilities, diffPlanDefaults,
  FEATURE_KEYS,
} from './features';

const NOW = Date.parse('2026-07-28T12:00:00Z');

describe('tier ordering', () => {
  it('ranks the four tiers', () => {
    expect(higherTier('free', 'deluxe')).toBe('deluxe');
    expect(higherTier('premium', 'essentials')).toBe('premium');
    expect(higherTier('free', 'free')).toBe('free');
  });

  it('an EXPIRED org plan counts as free — a comp must not become permanent', () => {
    expect(effectiveTier('free', 'deluxe', '2026-07-27T12:00:00Z', NOW)).toBe('free');
  });

  it('a live org plan applies', () => {
    expect(effectiveTier('free', 'deluxe', '2026-08-30T12:00:00Z', NOW)).toBe('deluxe');
  });

  it('an org plan with no expiry never lapses', () => {
    expect(effectiveTier('free', 'premium', null, NOW)).toBe('premium');
  });

  it('the event tier still wins when it is the higher of the two', () => {
    expect(effectiveTier('deluxe', 'essentials', null, NOW)).toBe('deluxe');
  });
});

describe('Pro floor — must equal the shipped entitlementsFor()', () => {
  it('matches plans.ts for every tier, so the two cannot drift', () => {
    for (const tier of ['free', 'essentials', 'premium', 'deluxe'] as const) {
      expect(applyProFloor(ENTITLEMENTS[tier]), tier).toEqual(entitlementsFor(tier, true));
    }
  });

  it('watermark is ANDed, not ORed — false is the better value', () => {
    // Free has watermark:true, premium false. Pro must CLEAR it.
    expect(applyProFloor(ENTITLEMENTS.free).watermark).toBe(false);
  });

  it('null (unlimited) beats a number rather than losing to it', () => {
    // free.maxPosts = 25, premium = null → unlimited wins.
    expect(applyProFloor(ENTITLEMENTS.free).maxPosts).toBeNull();
    expect(applyProFloor(ENTITLEMENTS.free).retentionDays).toBe(365);
  });

  it('a deluxe-only extra stays per-event — Pro does not grant the film render', () => {
    expect(applyProFloor(ENTITLEMENTS.free).cardsPremiumRender).toBe(false);
  });
});

describe('resolveFeatures — precedence', () => {
  it('a bare free event is exactly ENTITLEMENTS.free', () => {
    expect(resolveFeatures({ now: NOW })).toEqual(ENTITLEMENTS.free);
  });

  it('an org override grants a paid capability', () => {
    const f = resolveFeatures({ orgOverrides: { aiStudio: true }, now: NOW });
    expect(f.aiStudio).toBe(true);
    expect(f.videoEnabled).toBe(false); // untouched keys still inherit
  });

  it('an event override beats an org override', () => {
    const f = resolveFeatures({
      orgOverrides: { aiStudio: true },
      eventOverrides: { aiStudio: false },
      now: NOW,
    });
    expect(f.aiStudio).toBe(false);
  });

  it('a kill switch beats even a paid org grant', () => {
    const f = resolveFeatures({
      orgOverrides: { aiStudio: true },
      killed: { aiStudio: false },
      now: NOW,
    });
    expect(f.aiStudio).toBe(false);
  });

  it('an override to null (unlimited) is applied, not treated as absent', () => {
    // The bug this pins: `if (v)` would drop null and silently keep the cap.
    const f = resolveFeatures({ orgOverrides: { maxPosts: null }, now: NOW });
    expect(f.maxPosts).toBeNull();
  });

  it('an override to 0 is applied, not treated as absent', () => {
    const f = resolveFeatures({ orgOverrides: { maxPosts: 0 }, now: NOW });
    expect(f.maxPosts).toBe(0);
  });

  it('an override to false is applied, not treated as absent', () => {
    const f = resolveFeatures({ eventTier: 'deluxe', orgOverrides: { aiStudio: false }, now: NOW });
    expect(f.aiStudio).toBe(false);
  });

  it('legacy short-circuits to deluxe WITH the watermark still on', () => {
    const f = resolveFeatures({ legacy: true, eventTier: 'free', now: NOW });
    expect(f).toEqual({ ...ENTITLEMENTS.deluxe, watermark: true });
  });

  it('legacy ignores overrides and kill switches entirely', () => {
    const f = resolveFeatures({
      legacy: true, orgOverrides: { aiStudio: false }, killed: { projectionMode: false }, now: NOW,
    });
    expect(f.aiStudio).toBe(true);
    expect(f.projectionMode).toBe(true);
  });

  it('an expired org plan does not grant anything', () => {
    const f = resolveFeatures({ orgTier: 'deluxe', orgExpiresAt: '2026-07-27T12:00:00Z', now: NOW });
    expect(f).toEqual(ENTITLEMENTS.free);
  });
});

describe('selectors — the preview reads the SAME functions the app does', () => {
  it('killing cardsStandard removes the Cards tab', () => {
    // This single assertion is the whole "the preview cannot lie" guarantee:
    // EventStudio and FeaturePreview both render from visibleStudioTabs().
    const on = visibleStudioTabs(resolveFeatures({ eventTier: 'premium' }));
    const off = visibleStudioTabs(resolveFeatures({ eventTier: 'premium', killed: { cardsStandard: false } }));
    expect(on).toContain('cards');
    expect(off).not.toContain('cards');
  });

  it('free loses Cards; deluxe keeps it', () => {
    expect(visibleStudioTabs(ENTITLEMENTS.free)).not.toContain('cards');
    expect(visibleStudioTabs(ENTITLEMENTS.deluxe)).toContain('cards');
  });

  it('share and dashboard are never gated away', () => {
    for (const tier of ['free', 'deluxe'] as const) {
      const tabs = visibleStudioTabs(ENTITLEMENTS[tier]);
      expect(tabs).toContain('dashboard');
      expect(tabs).toContain('share');
    }
  });

  it('support and billing are always reachable — never hide the way to complain or pay', () => {
    const nav = visibleHostNav(ENTITLEMENTS.free);
    expect(nav).toContain('support');
    expect(nav).toContain('billing');
  });

  it('guest capabilities map every entitlement field', () => {
    const free = guestCapabilities(ENTITLEMENTS.free);
    expect(free.photo).toBe(true);      // a booth that cannot photograph is not a booth
    expect(free.video).toBe(false);
    expect(free.watermark).toBe(true);
    expect(free.postCap).toBe(25);
    const deluxe = guestCapabilities(ENTITLEMENTS.deluxe);
    expect(deluxe.video).toBe(true);
    expect(deluxe.postCap).toBeNull();
  });
});

describe('diffPlanDefaults — drift between the shipped bundle and the live DB', () => {
  it('is empty when they agree', () => {
    expect(diffPlanDefaults(ENTITLEMENTS, ENTITLEMENTS)).toEqual([]);
  });

  it('names exactly the mismatched tier.flag', () => {
    const live = { ...ENTITLEMENTS, free: { ...ENTITLEMENTS.free, maxPosts: 50 } };
    expect(diffPlanDefaults(ENTITLEMENTS, live)).toEqual(['free.maxPosts']);
  });

  it('ignores tiers the live side does not report', () => {
    expect(diffPlanDefaults(ENTITLEMENTS, { free: ENTITLEMENTS.free })).toEqual([]);
  });

  it('covers every flag key', () => {
    expect(FEATURE_KEYS).toHaveLength(Object.keys(ENTITLEMENTS.free).length);
  });
});
