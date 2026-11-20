import { describe, it, expect } from 'vitest';
import { ENTITLEMENTS, LEGACY_ENTITLEMENTS, entitlementsFor } from './plans';
import {
  higherTier, effectiveTier, applyProFloor, resolveFeatures,
  visibleHostNav, visibleStudioTabs, guestCapabilities, diffPlanDefaults,
  normalizeResolvedFeatures, studioHomeTab, lockedReason, studioAllowed,
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
    expect(f.watermark).toBe(true); // untouched keys still inherit
    expect(f.cardsStandard).toBe(false);
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

  it('legacy short-circuits to deluxe WITH the watermark still on (and the whole studio)', () => {
    const f = resolveFeatures({ legacy: true, eventTier: 'free', now: NOW });
    // Pinned to the 30 s clips and 365-day retention the frozen sites were
    // built against, not deluxe's newer 90 s / 730 days.
    expect(f).toEqual({ ...ENTITLEMENTS.deluxe, watermark: true, studio: true, videoMaxSec: 30, retentionDays: 365 });
    expect(f).toEqual(LEGACY_ENTITLEMENTS);
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
    expect(free.video).toBe(true);       // Free records video since 2026-11-19
    expect(free.videoMaxSec).toBe(30);
    expect(free.watermark).toBe(true);
    expect(free.postCap).toBe(25);
    const deluxe = guestCapabilities(ENTITLEMENTS.deluxe);
    expect(deluxe.video).toBe(true);
    expect(deluxe.videoMaxSec).toBe(90);
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

/** Everything on, i.e. what a fully-entitled host with the add-on sees. */
const ALL_ON = { ...ENTITLEMENTS.deluxe, studio: true };

/** The tab row as it shipped before the Studio became an add-on. */
const ORIGINAL_TABS = ['dashboard', 'studio', 'experiences', 'assets', 'wall', 'challenges', 'cards', 'share'];

describe('the Studio add-on flag', () => {
  it('is false on every plan — it is granted per organisation, never by tier', () => {
    for (const tier of ['free', 'essentials', 'premium', 'deluxe'] as const) {
      expect(ENTITLEMENTS[tier].studio, tier).toBe(false);
    }
  });

  it('Pro does not include it', () => {
    expect(applyProFloor(ENTITLEMENTS.free).studio).toBe(false);
    expect(entitlementsFor('free', true).studio).toBe(false);
  });

  it('an org override grants it, an event override can take it back', () => {
    expect(resolveFeatures({ orgOverrides: { studio: true }, now: NOW }).studio).toBe(true);
    expect(resolveFeatures({
      orgOverrides: { studio: true }, eventOverrides: { studio: false }, now: NOW,
    }).studio).toBe(false);
  });

  it('studio=false hides exactly the Studio and Assets tabs', () => {
    const tabs = visibleStudioTabs({ ...ALL_ON, studio: false });
    expect(tabs).not.toContain('studio');
    expect(tabs).not.toContain('assets');
    expect(tabs).toEqual(['dashboard', 'experiences', 'wall', 'challenges', 'cards', 'share']);
  });

  it('studio=true restores the original eight tabs in the original order', () => {
    expect(visibleStudioTabs(ALL_ON)).toEqual(ORIGINAL_TABS);
  });

  it('the frames & filters picker (experiences) is never gated away', () => {
    expect(visibleStudioTabs({ ...ENTITLEMENTS.free, studio: false })).toContain('experiences');
  });

  it('has a customer-facing locked reason', () => {
    expect(lockedReason('studio')).toMatch(/add-on/);
  });
});

describe('remote events and the Cards tab', () => {
  it('a remote event keeps Cards even before its plan can publish one', () => {
    expect(visibleStudioTabs(ENTITLEMENTS.free, { remote: true })).toContain('cards');
    expect(visibleStudioTabs(ENTITLEMENTS.free)).not.toContain('cards');
  });

  it('a remote event lands on Cards only when the plan can publish', () => {
    expect(studioHomeTab(ENTITLEMENTS.premium, { remote: true })).toBe('cards');
    expect(studioHomeTab(ENTITLEMENTS.free, { remote: true })).toBe('dashboard');
    expect(studioHomeTab(ENTITLEMENTS.premium)).toBe('dashboard');
  });
});

describe('normalizeResolvedFeatures — reading the DB resolver in the browser', () => {
  it('a MISSING studio key means true, so nothing changes before migration 039 lands', () => {
    // Exactly what event_features returns today: the eight 027 keys, no studio.
    const before039 = {
      maxPosts: 25, videoEnabled: false, watermark: true, aiStudio: false,
      cardsStandard: false, cardsPremiumRender: false, projectionMode: true, retentionDays: 7,
    };
    const f = normalizeResolvedFeatures(before039);
    expect(f.studio).toBe(true);
    expect(visibleStudioTabs(f)).toContain('studio');
    expect(visibleStudioTabs(f)).toContain('assets');
  });

  it('an explicit false is respected, an explicit true too', () => {
    expect(normalizeResolvedFeatures({ studio: false }).studio).toBe(false);
    expect(normalizeResolvedFeatures({ studio: true }).studio).toBe(true);
  });

  it('a mistyped studio value is treated as absent (true), never as false', () => {
    expect(normalizeResolvedFeatures({ studio: 'false' }).studio).toBe(true);
    expect(normalizeResolvedFeatures({ studio: null }).studio).toBe(true);
  });

  it('round-trips a full resolver answer', () => {
    expect(normalizeResolvedFeatures({ ...ENTITLEMENTS.premium, studio: false }))
      .toEqual({ ...ENTITLEMENTS.premium, studio: false });
  });

  it('keeps null (unlimited) and 0 as real values', () => {
    const f = normalizeResolvedFeatures({ maxPosts: null, retentionDays: 0 });
    expect(f.maxPosts).toBeNull();
    expect(f.retentionDays).toBe(0);
  });

  it('is total: garbage input yields the fallback plan with studio on', () => {
    for (const raw of [null, undefined, 'x', 42, [], [true]]) {
      expect(normalizeResolvedFeatures(raw)).toEqual({ ...ENTITLEMENTS.free, studio: true });
    }
  });

  it('falls back per key to the supplied plan', () => {
    const f = normalizeResolvedFeatures({ videoEnabled: 'yes' }, ENTITLEMENTS.deluxe);
    expect(f.videoEnabled).toBe(true);
    expect(f.cardsStandard).toBe(true);
  });
});

describe('studioAllowed — a sales gate that fails OPEN', () => {
  const off = { ...ENTITLEMENTS.free, studio: false };
  const on = { ...ENTITLEMENTS.free, studio: true };
  it('follows the resolved flag for a regular host', () => {
    expect(studioAllowed({ features: off, isPlatformAdmin: false, legacySlug: false })).toBe(false);
    expect(studioAllowed({ features: on, isPlatformAdmin: false, legacySlug: false })).toBe(true);
  });
  it('a failed resolver read lets the host in', () => {
    expect(studioAllowed({ features: null, isPlatformAdmin: false, legacySlug: false })).toBe(true);
  });
  it('platform admins and legacy slugs always get in', () => {
    expect(studioAllowed({ features: off, isPlatformAdmin: true, legacySlug: false })).toBe(true);
    expect(studioAllowed({ features: off, isPlatformAdmin: false, legacySlug: true })).toBe(true);
  });
  it('before 039 (no studio key) a regular host keeps the studio', () => {
    const { studio: _omit, ...before039 } = ENTITLEMENTS.free;
    expect('studio' in before039).toBe(false);
    const f = normalizeResolvedFeatures(before039);
    expect(studioAllowed({ features: f, isPlatformAdmin: false, legacySlug: false })).toBe(true);
  });
});
