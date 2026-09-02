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
const { invokeMock, reportMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), reportMock: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: invokeMock } } }));
// askCopilot's error branch lazy-imports ./errorReport (which imports the
// supabase client statically) — mocked so the tag it sends is observable.
vi.mock('./errorReport', () => ({ reportError: reportMock }));

const snapshot = {
  eventUuid: 'u-1', slug: 'daps-35th', name: "Dapo's 35th", status: 'live',
  planTier: 'deluxe', eventType: 'birthday', failed: false, postCount: 3, showChallenges: true,
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
  reportMock.mockReset();
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

describe('askCopilot reports silently-dropped proposals', () => {
  it('surfaces the rejected count so the chat can contradict the reply prose', async () => {
    // The model claims it bumped a challenge, naming an id no longer in the
    // snapshot. The action is (correctly) refused — but the prose still says
    // it happened, so the count has to come back with it.
    invokeMock.mockResolvedValue({
      data: {
        reply: 'Done — that challenge is worth 30 points now.',
        actions: [{ tool: 'update_challenge', challengeId: 'ch-ghost', points: 30 }],
      },
      error: null,
    });
    const res = await askCopilot(messages, snapshot);
    expect(res.actions).toEqual([]);
    expect(res.dropped).toBe(1);
  });

  it('is 0 on a clean turn and on every offline path', async () => {
    invokeMock.mockResolvedValue({ data: { reply: 'Sure.', actions: [] }, error: null });
    expect((await askCopilot(messages, snapshot)).dropped).toBe(0);
    expect((await askWithError('rate_limited')).dropped).toBe(0);
  });
});

describe('askCopilot turn window (server MAX_TURNS = 20)', () => {
  beforeEach(() => {
    invokeMock.mockResolvedValue({ data: { reply: 'ok', actions: [] }, error: null });
  });

  it('sends at most 16 merged turns, user-first and user-last, for a 41-turn thread', async () => {
    const thread: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      thread.push({ role: 'user', content: `q${i}` });
      thread.push({ role: 'assistant', content: `a${i}` });
    }
    thread.push({ role: 'user', content: 'latest' });
    await askCopilot(thread, snapshot);
    const [, { body }] = invokeMock.mock.calls[0] as [string, { body: { messages: ChatMessage[] } }];
    expect(body.messages.length).toBeLessThanOrEqual(16);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'latest' });
    for (let i = 1; i < body.messages.length; i++) {
      expect(body.messages[i].role).not.toBe(body.messages[i - 1].role);
    }
  });

  it('leaves a short thread as-is', async () => {
    await askCopilot(messages, snapshot);
    const [, { body }] = invokeMock.mock.calls[0] as [string, { body: { messages: ChatMessage[] } }];
    expect(body.messages).toEqual(messages);
  });
});

describe('askCopilot droppedReasons + telemetry', () => {
  it('carries the per-proposal reasons alongside the count', async () => {
    invokeMock.mockResolvedValue({
      data: { reply: 'Done.', actions: [{ tool: 'update_challenge', challengeId: 'ch-ghost', points: 30 }, { tool: 'nope' }] },
      error: null,
    });
    const res = await askCopilot(messages, snapshot);
    expect(res.dropped).toBe(2);
    expect(res.droppedReasons).toEqual([
      { tool: 'update_challenge', reason: 'unknown_id' },
      { tool: 'nope', reason: 'unknown_tool' },
    ]);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('is an empty array on every offline path', async () => {
    expect((await askWithError('rate_limited')).droppedReasons).toEqual([]);
    invokeMock.mockResolvedValue({ data: { reply: '' }, error: null });
    expect((await askCopilot(messages, snapshot)).droppedReasons).toEqual([]);
  });

  it('reports an edge-fn error with a mode+code tag, without blocking the reply', async () => {
    const res = await askWithError('ai_quota');
    expect(res.source).toBe('offline');
    // The lazy import resolves on a microtask after the reply is returned.
    await new Promise((r) => setTimeout(r, 0));
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(reportMock.mock.calls[0][1]).toMatchObject({ tag: 'ai_event_designer:copilot:ai_quota', reason: 'ai_quota' });
  });

  it('tags a transport failure as network', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('fetch failed') });
    await askCopilot(messages, snapshot);
    await new Promise((r) => setTimeout(r, 0));
    expect(reportMock.mock.calls[0][1]).toMatchObject({ tag: 'ai_event_designer:copilot:network' });
  });
});
