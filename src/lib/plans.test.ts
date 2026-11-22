import { describe, it, expect } from 'vitest';
import {
  ENTITLEMENTS, LEGACY_ENTITLEMENTS, VIDEO_CLIP_BYTE_BUDGET, FAIR_USE_LINE,
  formatPostCap, formatRetention, formatVideoLength, videoBitsPerSecondFor, VIDEO_MAX_BPS_HD,
} from './plans';

describe('plan copy formatters', () => {
  it('describes an unlimited cap without a number', () => {
    expect(formatPostCap(null)).toBe('Unlimited photos & videos');
  });

  it('describes a finite cap', () => {
    expect(formatPostCap(500)).toBe('Up to 500 photos & videos');
  });

  it('omits video on a tier that does not include it', () => {
    // The cap counts posts, but saying "& videos" on a tier without video
    // would advertise something it does not grant.
    expect(formatPostCap(25, false)).toBe('Up to 25 photos');
  });

  it('names video on Free, which records it since 2026-11-19', () => {
    expect(ENTITLEMENTS.free.videoEnabled).toBe(true);
    expect(formatPostCap(ENTITLEMENTS.free.maxPosts, ENTITLEMENTS.free.videoEnabled)).toBe(
      'Up to 25 photos & videos',
    );
  });

  it('names video on the paid tiers, whose cap covers both', () => {
    expect(
      formatPostCap(ENTITLEMENTS.essentials.maxPosts, ENTITLEMENTS.essentials.videoEnabled),
    ).toBe('Up to 500 photos & videos');
  });

  it('describes indefinite retention', () => {
    expect(formatRetention(null)).toBe('Photos kept forever');
  });

  it('describes finite retention', () => {
    expect(formatRetention(90)).toBe('Photos kept for 90 days');
    expect(formatRetention(7)).toBe('Photos kept for 7 days');
  });

  it('reads whole years as years', () => {
    expect(formatRetention(365)).toBe('Photos kept for 1 year');
    expect(formatRetention(730)).toBe('Photos kept for 2 years');
    expect(formatRetention(400)).toBe('Photos kept for 400 days');
  });

  it('describes clip length', () => {
    expect(formatVideoLength(60)).toBe('60-second video clips');
  });

  it('states the fair-use line with the real backstop number', () => {
    expect(FAIR_USE_LINE).toContain('2,000 new shots a day per event');
  });
});

describe('video clip length tiers (owner decision 2026-11-19)', () => {
  it('steps 30 → 30 → 60 → 90 seconds', () => {
    expect(ENTITLEMENTS.free.videoMaxSec).toBe(30);
    expect(ENTITLEMENTS.essentials.videoMaxSec).toBe(30);
    expect(ENTITLEMENTS.premium.videoMaxSec).toBe(60);
    expect(ENTITLEMENTS.deluxe.videoMaxSec).toBe(90);
  });

  it('keeps Deluxe media for 2 years and legacy sites unchanged', () => {
    expect(ENTITLEMENTS.deluxe.retentionDays).toBe(730);
    expect(LEGACY_ENTITLEMENTS.videoMaxSec).toBe(30);
    expect(LEGACY_ENTITLEMENTS.retentionDays).toBe(365);
  });

  it('records a 30 s clip at the old 5 Mbps (legacy byte-identical)', () => {
    expect(videoBitsPerSecondFor(30)).toBe(5_000_000);
  });

  it('fits every tier\'s longest clip inside the 25 MB posts-bucket limit', () => {
    const BUCKET_LIMIT = 25 * 1024 * 1024;
    for (const e of Object.values(ENTITLEMENTS)) {
      const bytes = ((videoBitsPerSecondFor(e.videoMaxSec) + 128_000) * e.videoMaxSec) / 8;
      expect(bytes).toBeLessThanOrEqual(VIDEO_CLIP_BYTE_BUDGET);
      expect(VIDEO_CLIP_BYTE_BUDGET).toBeLessThan(BUCKET_LIMIT);
    }
    expect(videoBitsPerSecondFor(90)).toBeGreaterThan(2_000_000); // still watchable
  });

  it('1080p clips get the higher ceiling and still fit the 25 MB bucket', () => {
    expect(videoBitsPerSecondFor(30, VIDEO_MAX_BPS_HD)).toBe(VIDEO_MAX_BPS_HD);
    for (const e of Object.values(ENTITLEMENTS)) {
      const bps = videoBitsPerSecondFor(e.videoMaxSec, VIDEO_MAX_BPS_HD);
      expect(((bps + 128_000) * e.videoMaxSec) / 8).toBeLessThanOrEqual(VIDEO_CLIP_BYTE_BUDGET);
    }
  });

  it('falls back to 30 s on a nonsense length instead of dividing by zero', () => {
    expect(videoBitsPerSecondFor(0)).toBe(5_000_000);
    expect(videoBitsPerSecondFor(Number.NaN)).toBe(5_000_000);
  });
});

// Imported from ./plans, not ./entitlements: the latter pulls in the Supabase
// client, whose createClient throws when env vars are absent — which is exactly
// how CI runs.
describe('entitlements the pricing page relies on', () => {
  it('does not include greeting cards on essentials', () => {
    // The landing page advertised a "Video guestbook" on Essentials; cards are
    // a premium-and-up feature, so that copy was selling something the tier
    // does not grant.
    expect(ENTITLEMENTS.essentials.cardsStandard).toBe(false);
    expect(ENTITLEMENTS.premium.cardsStandard).toBe(true);
  });

  it('expires free-tier photos in a week', () => {
    // The number the landing table has to disclose.
    expect(ENTITLEMENTS.free.retentionDays).toBe(7);
  });
});
