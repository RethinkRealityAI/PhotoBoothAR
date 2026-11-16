/**
 * The money rules of ai-generate-image (supabase/functions/ai-generate-image/
 * jobPolicy.ts) — imported straight from the edge sibling so CI tests the
 * code that deploys. tsconfig excludes supabase/, so this import is ALSO what
 * type-checks that file.
 */
import { describe, it, expect } from 'vitest';
import {
  retryEligibility,
  parseRetryOf,
  parseVariants,
  grantedVariants,
  requestCost,
  partialRefund,
  pickImagePart,
  imageFormat,
  attemptTimeout,
  consumesFreeSlot,
  RETRY_WINDOW_MS,
  MAX_VARIANTS,
  VARIANT_NUDGES,
  VARIANT_PRICING,
  type RetryOriginal,
} from '../../supabase/functions/ai-generate-image/jobPolicy.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const EVENT = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const ctx = { eventUuid: EVENT, orgId: ORG, provider: 'gemini', kind: 'border', nowMs: NOW };

function original(over: Partial<RetryOriginal> = {}): RetryOriginal {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    org_id: ORG,
    event_id: EVENT,
    kind: 'image',
    provider: 'gemini',
    status: 'succeeded',
    created_at: new Date(NOW - 60_000).toISOString(),
    input: { kind: 'border', layout: 'classic-border' },
    ...over,
  };
}

describe('retryEligibility — a free retry cannot be faked', () => {
  it('accepts a recent, succeeded, never-retried frame of the same event, org and provider', () => {
    expect(retryEligibility(original(), ctx)).toEqual({ ok: true });
  });

  it.each([
    ['not_found', null],
    ['wrong_event', original({ event_id: '99999999-9999-4999-8999-999999999999' })],
    ['wrong_event', original({ org_id: '99999999-9999-4999-8999-999999999999' })],
    ['not_a_frame', original({ input: { kind: '2d_filter' } })],
    ['not_a_frame', original({ kind: 'model3d' })],
    ['not_succeeded', original({ status: 'failed' })],
    ['not_succeeded', original({ status: 'running' })],
    ['not_succeeded', original({ status: 'refunded' })],
    ['too_old', original({ created_at: new Date(NOW - RETRY_WINDOW_MS - 1).toISOString() })],
    ['too_old', original({ created_at: 'garbage' })],
    ['too_old', original({ created_at: new Date(NOW + 10 * 60_000).toISOString() })],
    ['provider_mismatch', original({ provider: 'higgsfield' })],
    ['is_a_retry', original({ input: { kind: 'border', retryOf: 'x' } })],
    ['already_retried', original({ input: { kind: 'border', retriedBy: 'y' } })],
  ] as const)('rejects %s', (reason, orig) => {
    expect(retryEligibility(orig, ctx)).toEqual({ ok: false, reason });
  });

  it('a gemini frame cannot be retried for free on the dearer provider', () => {
    expect(retryEligibility(original(), { ...ctx, provider: 'higgsfield' })).toEqual({ ok: false, reason: 'provider_mismatch' });
  });

  it('a retry request for a sticker is not a frame retry', () => {
    expect(retryEligibility(original(), { ...ctx, kind: '2d_filter' })).toEqual({ ok: false, reason: 'not_a_frame' });
  });

  it('parseRetryOf accepts only a uuid, never throwing on junk', () => {
    expect(parseRetryOf(' 33333333-3333-4333-8333-333333333333 ')).toBe('33333333-3333-4333-8333-333333333333');
    expect(parseRetryOf("1' or '1'='1")).toBe(null);
    expect(parseRetryOf(42)).toBe(null);
    expect(parseRetryOf(undefined)).toBe(null);
  });
});

describe('free-trial accounting', () => {
  it('a free retry, a failed and a refunded job never consume a slot', () => {
    expect(consumesFreeSlot({ kind: 'image', status: 'succeeded', input: {} })).toBe(true);
    expect(consumesFreeSlot({ kind: 'image', status: 'running', input: null })).toBe(true);
    expect(consumesFreeSlot({ kind: 'image', status: 'succeeded', input: { retryOf: 'abc' } })).toBe(false);
    expect(consumesFreeSlot({ kind: 'image', status: 'failed', input: {} })).toBe(false);
    expect(consumesFreeSlot({ kind: 'image', status: 'refunded', input: {} })).toBe(false);
    expect(consumesFreeSlot({ kind: 'model3d', status: 'succeeded', input: {} })).toBe(false);
  });

  it('the bound: an original + its one retry = ONE slot / one charge, and the retry cannot be retried', () => {
    const orig = original();
    const retry = { kind: 'image', status: 'succeeded', input: { kind: 'border', retryOf: orig.id } };
    expect([orig, retry].filter((j) => consumesFreeSlot(j)).length).toBe(1);
    expect(retryEligibility({ ...orig, id: 'r', input: retry.input }, ctx)).toEqual({ ok: false, reason: 'is_a_retry' });
  });
});

describe('variants', () => {
  it('parses 1..3 and clamps junk', () => {
    expect(parseVariants(2)).toBe(2);
    expect(parseVariants(9)).toBe(MAX_VARIANTS);
    expect(parseVariants(0)).toBe(1);
    expect(parseVariants(2.5)).toBe(1);
    expect(parseVariants('3')).toBe(1);
    expect(parseVariants(undefined)).toBe(1);
  });

  it('a free trial or a retry gets exactly one take', () => {
    expect(grantedVariants(3, { freeTrial: true, retry: false })).toBe(1);
    expect(grantedVariants(3, { freeTrial: false, retry: true })).toBe(1);
    expect(grantedVariants(3, { freeTrial: false, retry: false })).toBe(3);
  });

  it('charges per the pricing switch, never on a zero-cost request', () => {
    expect(VARIANT_PRICING).toBe('per_variant');
    expect(requestCost(1, 3, { zero: false })).toBe(3);
    expect(requestCost(2, 3, { zero: false, pricing: 'per_request' })).toBe(2);
    expect(requestCost(1, 3, { zero: true })).toBe(0);
  });

  it('refunds failed takes under per_variant only', () => {
    expect(partialRefund(1, 2, { zero: false })).toBe(2);
    expect(partialRefund(1, 2, { zero: false, pricing: 'per_request' })).toBe(0);
    expect(partialRefund(1, 2, { zero: true })).toBe(0);
    expect(partialRefund(1, 0, { zero: false })).toBe(0);
  });

  it('one nudge per take, the first take un-nudged', () => {
    expect(VARIANT_NUDGES).toHaveLength(MAX_VARIANTS);
    expect(VARIANT_NUDGES[0]).toBe('');
    expect(new Set(VARIANT_NUDGES).size).toBe(MAX_VARIANTS);
  });
});

describe('pickImagePart', () => {
  const img = (data: string, thought?: boolean) => ({ inlineData: { mimeType: 'image/png', data }, ...(thought ? { thought } : {}) });

  it('takes the LAST non-thought image (a thinking model emits drafts first)', () => {
    expect(pickImagePart([img('draft', true), { text: 'ok' }, img('final')])?.inlineData?.data).toBe('final');
    expect(pickImagePart([img('a'), img('b')])?.inlineData?.data).toBe('b');
  });

  it('falls back to a thought image rather than nothing, and handles empty', () => {
    expect(pickImagePart([img('only', true)])?.inlineData?.data).toBe('only');
    expect(pickImagePart([{ text: 'no image' }])).toBe(null);
    expect(pickImagePart(undefined)).toBe(null);
    expect(pickImagePart([{ inlineData: { data: '' } }])).toBe(null);
  });
});

describe('imageFormat — sniffed from the bytes', () => {
  const pad = (head: number[]) => new Uint8Array([...head, ...new Array(16).fill(0)]);
  it('png / jpeg / webp, and null for an HTML error page', () => {
    expect(imageFormat(pad([0x89, 0x50, 0x4e, 0x47]))).toEqual({ contentType: 'image/png', ext: 'png' });
    expect(imageFormat(pad([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ contentType: 'image/jpeg', ext: 'jpg' });
    const webp = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(imageFormat(webp)).toEqual({ contentType: 'image/webp', ext: 'webp' });
    expect(imageFormat(new TextEncoder().encode('<!doctype html><html>…</html>'))).toBe(null);
    expect(imageFormat(new Uint8Array(3))).toBe(null);
  });
});

describe('attemptTimeout', () => {
  it('caps an attempt by the remaining budget and the per-model cap; null when spent', () => {
    expect(attemptTimeout(100_000, 0, 55_000)).toBe(55_000);
    expect(attemptTimeout(100_000, 60_000, 55_000)).toBe(40_000);
    expect(attemptTimeout(100_000, 98_000)).toBe(null);
  });
});
