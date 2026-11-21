import { describe, expect, it } from 'vitest';
import { notFoundAlias } from './notFound';

describe('notFoundAlias', () => {
  it('sends plausible guesses to the real page', () => {
    expect(notFoundAlias('/pricing')).toBe('/?s=pricing');
    expect(notFoundAlias('/legal')).toBe('/terms');
    expect(notFoundAlias('/reset')).toBe('/forgot-password');
    expect(notFoundAlias('/signin')).toBe('/login');
  });

  it('ignores case and a trailing slash', () => {
    expect(notFoundAlias('/Pricing/')).toBe('/?s=pricing');
    expect(notFoundAlias('/LEGAL')).toBe('/terms');
  });

  it('leaves everything else to the not-found page', () => {
    expect(notFoundAlias('/this-does-not-exist')).toBeNull();
    expect(notFoundAlias('/')).toBeNull();
    expect(notFoundAlias('/pricing/extra')).toBeNull();
    expect(notFoundAlias('/constructor')).toBeNull(); // no prototype keys
    expect(notFoundAlias('/__proto__')).toBeNull();
  });
});
