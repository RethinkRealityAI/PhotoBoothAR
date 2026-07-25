import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aiErrorRetryable, aiErrorMessage, fetchEventCreditBalance, type AiErrorCode } from './ai';

// ai.ts creates the supabase client at module load — mock it (same pattern as
// eventDesigner.test.ts). fromMock is re-stubbed per fetchEventCreditBalance test.
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: { from: fromMock, functions: { invoke: vi.fn() } },
}));

/**
 * Every member of AiErrorCode and how it should behave. This is a
 * `Record<AiErrorCode, ...>`, so adding a code to the union without classifying
 * it here is a COMPILE error — the old pair of loose arrays could silently miss
 * a new member and the "covers the whole union" test would still pass.
 */
const COVERAGE: Record<AiErrorCode, 'retryable' | 'hard'> = {
  invalid_json: 'retryable',
  invalid_body: 'retryable',
  event_not_found: 'retryable',
  job_not_found: 'retryable',
  generation_failed: 'retryable',
  ai_quota: 'retryable',
  rate_limited: 'retryable',
  internal: 'retryable',
  network: 'retryable',
  ai_key_invalid: 'hard',
  ai_not_configured: 'hard',
  // Retrying re-runs the same stored prompt, which the provider already refused.
  content_blocked: 'hard',
  insufficient_credits: 'hard',
  upgrade_required: 'hard',
  unauthorized: 'hard',
  forbidden: 'hard',
};

const CODES = Object.keys(COVERAGE) as AiErrorCode[];
const RETRYABLE = CODES.filter((c) => COVERAGE[c] === 'retryable');
const NOT_RETRYABLE = CODES.filter((c) => COVERAGE[c] === 'hard');

describe('aiErrorRetryable', () => {
  it.each(RETRYABLE)('%s is retryable', (code) => {
    expect(aiErrorRetryable(code)).toBe(true);
  });

  it.each(NOT_RETRYABLE)('%s is NOT retryable (hard failure — no "try again")', (code) => {
    expect(aiErrorRetryable(code)).toBe(false);
  });

  it('the truth table covers the whole AiErrorCode union', () => {
    // Exhaustiveness is enforced by COVERAGE being a Record<AiErrorCode, …>;
    // this guards the split itself (no code in both halves, none dropped).
    expect(new Set(CODES).size).toBe(CODES.length);
    expect(RETRYABLE.length + NOT_RETRYABLE.length).toBe(CODES.length);
  });
});

describe('aiErrorMessage', () => {
  it.each([...RETRYABLE, ...NOT_RETRYABLE])('%s produces non-empty copy', (code) => {
    expect(aiErrorMessage(code).length).toBeGreaterThan(0);
  });

  it('ai_key_invalid and ai_not_configured share the customer-safe copy', () => {
    expect(aiErrorMessage('ai_key_invalid')).toBe(aiErrorMessage('ai_not_configured'));
  });

  it('customer-facing copy never leaks operator jargon', () => {
    for (const code of [...RETRYABLE, ...NOT_RETRYABLE]) {
      const msg = aiErrorMessage(code);
      expect(msg).not.toMatch(/GEMINI|API key|Supabase|Google|billing enabled/i);
    }
  });

  it('rate_limited explains the hourly limit and invites a later retry', () => {
    expect(aiErrorMessage('rate_limited')).toMatch(/hourly AI limit/i);
    expect(aiErrorMessage('rate_limited')).toMatch(/try again/i);
  });

  it('ai_key_invalid warns that retrying will not help (matches non-retryable)', () => {
    expect(aiErrorMessage('ai_key_invalid')).toMatch(/Retrying won.t help/i);
  });
});

describe('fetchEventCreditBalance', () => {
  /** One supabase query-builder chain resolving .maybeSingle() to `result`. */
  function chain(result: { data?: unknown; error?: unknown }) {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
        }),
      }),
    };
  }
  /** Route the events / credit_balances queries to canned results. */
  function stub(eventRes: { data?: unknown; error?: unknown }, balanceRes: { data?: unknown; error?: unknown }) {
    fromMock.mockImplementation((table: string) =>
      table === 'events' ? chain(eventRes) : chain(balanceRes));
  }

  beforeEach(() => {
    fromMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the balance of the EVENT org', async () => {
    stub({ data: { org_id: 'org-1' } }, { data: { balance: 42 } });
    await expect(fetchEventCreditBalance('u-1')).resolves.toBe(42);
  });

  it('a real balance of 0 returns 0, not null (zero is data)', async () => {
    stub({ data: { org_id: 'org-1' } }, { data: { balance: 0 } });
    await expect(fetchEventCreditBalance('u-1')).resolves.toBe(0);
  });

  it('returns null when the event query fails', async () => {
    stub({ error: { message: 'boom' } }, { data: { balance: 42 } });
    await expect(fetchEventCreditBalance('u-1')).resolves.toBeNull();
  });

  it('returns null when the event has no org_id', async () => {
    stub({ data: { org_id: null } }, { data: { balance: 42 } });
    await expect(fetchEventCreditBalance('u-1')).resolves.toBeNull();
  });

  it('returns null when there is no balance row', async () => {
    stub({ data: { org_id: 'org-1' } }, { data: null });
    await expect(fetchEventCreditBalance('u-1')).resolves.toBeNull();
  });

  it('returns null when the balance query fails', async () => {
    stub({ data: { org_id: 'org-1' } }, { error: { message: 'boom' } });
    await expect(fetchEventCreditBalance('u-1')).resolves.toBeNull();
  });

  it('returns null when balance is not a number', async () => {
    stub({ data: { org_id: 'org-1' } }, { data: { balance: 'lots' } });
    await expect(fetchEventCreditBalance('u-1')).resolves.toBeNull();
  });

  it('returns null (never throws) when the client throws synchronously', async () => {
    fromMock.mockImplementation(() => { throw new Error('client exploded'); });
    await expect(fetchEventCreditBalance('u-1')).resolves.toBeNull();
  });
});
