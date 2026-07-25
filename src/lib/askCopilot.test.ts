import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { askCopilot } from './copilot';
import type { EventSnapshot } from './eventSnapshot';
import type { ChatMessage } from './eventDesigner';

// askCopilot lazy-imports ./supabase — mock it (same pattern as
// eventDesigner.test.ts; vi.mock intercepts dynamic imports too) so the
// gate-0 offline-reply mapping and the eventUuid credits passthrough are
// testable without a live client. normalizeActions/mergeWireTurns have their
// own coverage in copilot.test.ts.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: invokeMock } } }));

const snapshot = {
  eventUuid: 'u-1', slug: 'daps-35th', name: "Dapo's 35th", status: 'live',
  planTier: 'deluxe', eventType: 'birthday', postCount: 3, showChallenges: true,
  challenges: [], experiences: [], cards: [],
} satisfies EventSnapshot;

const messages: ChatMessage[] = [{ role: 'user', content: 'add a challenge' }];

/** The edge fn's non-2xx error shape: FunctionsHttpError wrapping a Response. */
function httpError(body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status: 503 }));
}

async function askWithError(code: string) {
  invokeMock.mockResolvedValue({ data: null, error: httpError({ error: code }) });
  return askCopilot(messages, snapshot);
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('askCopilot offline replies (customer-safe copy)', () => {
  it('ai_key_invalid gets customer copy with zero operator jargon', async () => {
    const res = await askWithError('ai_key_invalid');
    expect(res.source).toBe('offline');
    expect(res.actions).toEqual([]);
    expect(res.reply).toMatch(/temporarily unavailable/i);
    expect(res.reply).not.toMatch(/GEMINI|API key|Supabase|Google/i);
  });

  it('ai_not_configured shares the same customer-safe reply', async () => {
    const invalid = await askWithError('ai_key_invalid');
    const unconfigured = await askWithError('ai_not_configured');
    expect(unconfigured.reply).toBe(invalid.reply);
  });

  it('rate_limited explains the hourly limit', async () => {
    const res = await askWithError('rate_limited');
    expect(res.source).toBe('offline');
    expect(res.reply).toMatch(/hourly AI limit/i);
  });

  it('ai_quota says over-capacity without provider-billing detail', async () => {
    const res = await askWithError('ai_quota');
    expect(res.reply).toMatch(/over capacity/i);
    expect(res.reply).not.toMatch(/Google|billing|quota/i);
  });

  it('an unrecognized code falls back to the generic offline reply', async () => {
    const res = await askWithError('internal');
    expect(res.source).toBe('offline');
    expect(res.reply).toMatch(/built-in guide/i);
  });

  it('a non-HTTP (network) error also falls back to the generic offline reply', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('fetch failed') });
    const res = await askCopilot(messages, snapshot);
    expect(res.source).toBe('offline');
    expect(res.reply).toMatch(/built-in guide/i);
  });

  it('an empty reply from the fn is treated as offline, not surfaced blank', async () => {
    invokeMock.mockResolvedValue({ data: { reply: '' }, error: null });
    const res = await askCopilot(messages, snapshot);
    expect(res.source).toBe('offline');
    expect(res.reply.length).toBeGreaterThan(0);
  });
});

describe('askCopilot request body (credits awareness)', () => {
  beforeEach(() => {
    invokeMock.mockResolvedValue({ data: { reply: 'Done!', actions: [] }, error: null });
  });

  it('sends the snapshot eventUuid so the fn can inject the org balance', async () => {
    const res = await askCopilot(messages, snapshot);
    expect(res).toMatchObject({ reply: 'Done!', source: 'ai', actions: [] });
    const [name, { body }] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(name).toBe('ai-event-designer');
    expect(body.mode).toBe('copilot');
    expect(body.eventUuid).toBe('u-1');
  });

  it('omits eventUuid entirely when there is no snapshot', async () => {
    await askCopilot(messages, null);
    const [, { body }] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect('eventUuid' in body).toBe(false);
    expect(body.context).toBe('');
  });
});
