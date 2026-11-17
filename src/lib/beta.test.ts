import { describe, it, expect } from 'vitest';
import { BETA_FREE, pricingCopy } from './beta';
import { DEFAULT_LANDING_CONTENT } from './landingContent';

describe('beta pricing stance', () => {
  it('beta copy: free heading, one honest CTA for every tier', () => {
    const c = pricingCopy(true);
    expect(c.heading).toMatch(/beta/i);
    expect(c.intro).toMatch(/before anything is charged/);
    for (const t of ['Free', 'Essentials', 'Premium', 'Deluxe']) expect(c.cta(t)).toBe('Join the beta free');
  });

  it('flipped off: normal selling copy with a distinct CTA per tier', () => {
    const c = pricingCopy(false);
    expect(c.heading).not.toMatch(/beta/i);
    expect(c.intro).not.toMatch(/beta/i);
    const ctas = ['Free', 'Essentials', 'Premium', 'Deluxe'].map(c.cta);
    expect(ctas).toEqual(['Start free', 'Choose Essentials', 'Choose Premium', 'Choose Deluxe']);
    expect(new Set(ctas).size).toBe(ctas.length);
  });

  it('the landing defaults follow the flag (badge + the beta FAQ)', () => {
    const hasBetaFaq = DEFAULT_LANDING_CONTENT.faqs.some((f) => /really free/i.test(f.q));
    expect(hasBetaFaq).toBe(BETA_FREE);
    expect(/beta/i.test(DEFAULT_LANDING_CONTENT.hero.badge)).toBe(BETA_FREE);
  });
});
