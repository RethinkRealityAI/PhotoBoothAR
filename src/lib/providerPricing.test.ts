import { describe, it, expect } from 'vitest';
import {
  PROVIDER_LABELS,
  effectiveProvider,
  higgsfieldReady,
  providerBody,
  providerCostLabel,
  providerHint,
  type ImageProvider,
} from './providerPricing';
import type { ProviderKeyStatus } from './providerKeysModel';

/* The four status shapes the picker can be in. `null` is BOTH "still loading"
 * and "the read failed" — the client cannot tell them apart from the value
 * alone, which is why providerHint takes statusFailed separately. */
const BYO: ProviderKeyStatus = { configured: true, keyIdMasked: 'abcd••••••••wxyz', platformAvailable: true };
/** BYO key installed but the platform has none — still 0 credits. */
const BYO_ONLY: ProviderKeyStatus = { configured: true, keyIdMasked: 'abcd••••••••wxyz', platformAvailable: false };
const PLATFORM_ONLY: ProviderKeyStatus = { configured: false, keyIdMasked: null, platformAvailable: true };
const NEITHER: ProviderKeyStatus = { configured: false, keyIdMasked: null, platformAvailable: false };
const STATUS_NULL = null;

const PROVIDERS: ImageProvider[] = ['gemini', 'higgsfield'];

describe('providerCostLabel', () => {
  it('mirrors the server rule for every provider × status combination', () => {
    // Server: cost = isFreeTrial || byoKey ? 0 : { gemini: 1, higgsfield: 2 }.
    // The button states the PAID price; the free-trial allowance is providerHint's.
    const matrix: [ImageProvider, ProviderKeyStatus | null, string][] = [
      ['gemini', BYO, '1 credit'],
      ['gemini', BYO_ONLY, '1 credit'],
      ['gemini', PLATFORM_ONLY, '1 credit'],
      ['gemini', NEITHER, '1 credit'],
      ['gemini', STATUS_NULL, '1 credit'],
      ['higgsfield', BYO, '0 credits'],
      ['higgsfield', BYO_ONLY, '0 credits'],
      ['higgsfield', PLATFORM_ONLY, '2 credits'],
      ['higgsfield', NEITHER, '2 credits'],
      ['higgsfield', STATUS_NULL, '2 credits'],
    ];
    for (const [provider, status, expected] of matrix) {
      expect(providerCostLabel(provider, status)).toBe(expected);
    }
  });

  it('charges nothing for a BYO Higgsfield key — the org pays Higgsfield directly', () => {
    expect(providerCostLabel('higgsfield', BYO)).toBe('0 credits');
  });

  it('charges 2 platform credits when only the PLATFORM key exists', () => {
    expect(providerCostLabel('higgsfield', PLATFORM_ONLY)).toBe('2 credits');
  });

  it('charges 1 credit for Beamwall AI whatever the Higgsfield connection is', () => {
    expect(providerCostLabel('gemini', BYO)).toBe('1 credit');
    expect(providerCostLabel('gemini', STATUS_NULL)).toBe('1 credit');
  });

  it('is independent of the free trial — the allowance is stated in the hint', () => {
    // No freeTrial parameter by design: the button must not say "0 credits" on
    // a generation whose allowance may already be spent by the time it runs.
    expect(providerCostLabel.length).toBe(2);
  });
});

describe('higgsfieldReady / effectiveProvider', () => {
  it('is ready with a BYO key, with the platform key, or with both', () => {
    expect(higgsfieldReady(BYO)).toBe(true);
    expect(higgsfieldReady(BYO_ONLY)).toBe(true);
    expect(higgsfieldReady(PLATFORM_ONLY)).toBe(true);
  });

  it('is NOT ready with no key at all, nor while the status is unknown', () => {
    expect(higgsfieldReady(NEITHER)).toBe(false);
    // Unknown is not "yes": a failed or in-flight read must never paint a
    // connection, which is what left the pill live while gemini was sent (F9).
    expect(higgsfieldReady(STATUS_NULL)).toBe(false);
  });

  it('falls back to gemini whenever Higgsfield is unusable, including status null', () => {
    expect(effectiveProvider('higgsfield', STATUS_NULL)).toBe('gemini');
    expect(effectiveProvider('higgsfield', NEITHER)).toBe('gemini');
    expect(effectiveProvider('higgsfield', BYO)).toBe('higgsfield');
    expect(effectiveProvider('higgsfield', PLATFORM_ONLY)).toBe('higgsfield');
  });

  it('never moves a gemini pick anywhere', () => {
    for (const status of [BYO, BYO_ONLY, PLATFORM_ONLY, NEITHER, STATUS_NULL]) {
      expect(effectiveProvider('gemini', status)).toBe('gemini');
    }
  });

  it('prices what will ACTUALLY run — effective, never the stale pick', () => {
    // A host who picked Higgsfield last session, on an org that lost its key:
    // the button must say 1 credit, because gemini is what the server will bill.
    const effective = effectiveProvider('higgsfield', NEITHER);
    expect(providerCostLabel(effective, NEITHER)).toBe('1 credit');
  });
});

describe('providerBody', () => {
  it('sends nothing at all for the default provider', () => {
    // The gemini request body stays byte-identical to before this control existed.
    expect(providerBody('gemini')).toEqual({});
    expect(Object.keys(providerBody('gemini'))).toHaveLength(0);
  });

  it('names higgsfield explicitly', () => {
    expect(providerBody('higgsfield')).toEqual({ provider: 'higgsfield' });
  });
});

describe('providerHint', () => {
  it('says it is still checking while the status is unknown and the read has not failed', () => {
    for (const freeTrial of [true, false]) {
      expect(providerHint(STATUS_NULL, false, freeTrial)).toBe('Checking your Higgsfield connection…');
    }
  });

  it('says the check FAILED without claiming there is no key', () => {
    for (const freeTrial of [true, false]) {
      expect(providerHint(STATUS_NULL, true, freeTrial)).toContain('Couldn’t check');
    }
  });

  it('is free-trial-independent for a BYO key — 0 credits either way', () => {
    for (const freeTrial of [true, false]) {
      expect(providerHint(BYO, false, freeTrial)).toBe('Uses your connected Higgsfield account — 0 credits.');
      expect(providerHint(BYO_ONLY, false, freeTrial)).toContain('0 credits');
    }
  });

  it('lets the free allowance override the platform price while it lasts', () => {
    // Server: isFreeTrial wins over COSTS, so the copy must too.
    expect(providerHint(PLATFORM_ONLY, false, true)).toBe('Free while this event has free generations left, then 2 credits.');
    expect(providerHint(PLATFORM_ONLY, false, false)).toBe('2 credits.');
  });

  it('says "not connected" only when we KNOW there is no route at all', () => {
    for (const freeTrial of [true, false]) {
      expect(providerHint(NEITHER, false, freeTrial)).toBe('Not connected —');
    }
  });
});

describe('PROVIDER_LABELS', () => {
  it('offers exactly the two providers, default first', () => {
    expect(PROVIDER_LABELS.map((p) => p.id)).toEqual(['gemini', 'higgsfield']);
  });

  it('labels every provider the pricing functions accept', () => {
    for (const p of PROVIDERS) {
      expect(PROVIDER_LABELS.some((l) => l.id === p)).toBe(true);
    }
  });
});
