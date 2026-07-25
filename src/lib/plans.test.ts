import { describe, it, expect } from 'vitest';
import { ENTITLEMENTS, formatPostCap, formatRetention } from './plans';

describe('plan copy formatters', () => {
  it('describes an unlimited cap without a number', () => {
    expect(formatPostCap(null)).toBe('Unlimited photos');
  });

  it('describes a finite cap', () => {
    expect(formatPostCap(500)).toBe('Up to 500 photos');
  });

  it('describes indefinite retention', () => {
    expect(formatRetention(null)).toBe('Photos kept forever');
  });

  it('describes finite retention', () => {
    expect(formatRetention(90)).toBe('Photos kept for 90 days');
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
