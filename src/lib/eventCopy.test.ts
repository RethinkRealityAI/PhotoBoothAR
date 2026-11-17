import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { COPY_INPUT_CAPS as SERVER_COPY_INPUT_CAPS } from '../../supabase/functions/ai-event-designer/prompt';
import { COPY_LINE_MAX, COPY_TURN, copyPatch, copyRequestBody, generateEventCopy, normalizeGeneratedCopy } from './eventCopy';

// generateEventCopy lazy-imports ./supabase and ./host — mocked the way
// askCopilot.test.ts / host.test.ts do; ./errorReport too (telemetry tag).
const { maybeSingle, invoke, updateEventConfig, reportError } = vi.hoisted(() => ({
  maybeSingle: vi.fn(), invoke: vi.fn(), updateEventConfig: vi.fn(), reportError: vi.fn(),
}));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    functions: { invoke },
  },
}));
vi.mock('./host', () => ({ updateEventConfig }));
vi.mock('./errorReport', () => ({ reportError }));

const GEN = { tagline: 'Make a wish.', welcomeIntro: 'Welcome to the party.', thankYou: 'Thanks for coming.', keepsakeIntro: 'Here are your moments.' };

beforeEach(() => {
  for (const m of [maybeSingle, invoke, updateEventConfig, reportError]) m.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('normalizeGeneratedCopy', () => {
  it('keeps the four lines, collapses whitespace, caps each at COPY_LINE_MAX, tagline optional', () => {
    const gen = normalizeGeneratedCopy({ ...GEN, welcomeIntro: `  Welcome\n  to   the party. ${'x'.repeat(300)}` });
    expect(gen!.welcomeIntro.startsWith('Welcome to the party. xxx')).toBe(true);
    expect(gen!.welcomeIntro).toHaveLength(COPY_LINE_MAX);
    expect(gen!.tagline).toBe('Make a wish.');
    expect(normalizeGeneratedCopy({ ...GEN, tagline: '' })).toEqual({ welcomeIntro: GEN.welcomeIntro, thankYou: GEN.thankYou, keepsakeIntro: GEN.keepsakeIntro });
  });

  it('a half-generated set is null (never overwrites the template defaults)', () => {
    expect(normalizeGeneratedCopy({ welcomeIntro: 'x', thankYou: 'y' })).toBeNull();
    expect(normalizeGeneratedCopy(null)).toBeNull();
    expect(normalizeGeneratedCopy({ ...GEN, keepsakeIntro: 42 })).toBeNull();
  });
});

describe('copyPatch', () => {
  it('rebuilds the whole copy object (shallow merge upstream), keeps existing keys, stamps generatedAt', () => {
    expect(copyPatch({ fullName: 'E', tagline: 'Template line', eventName: 'E' }, GEN, 'NOW')).toEqual({
      copy: { fullName: 'E', eventName: 'E', ...GEN, generatedAt: 'NOW' },
    });
    expect(copyPatch(null, GEN, 'NOW').copy.generatedAt).toBe('NOW');
  });
});

describe('generateEventCopy', () => {
  const row = (copy: Record<string, unknown>, brief?: unknown) =>
    ({ data: { name: "Maya's 40th", event_type: 'birthday', config: { copy, ...(brief ? { brief } : {}) } }, error: null });

  it('reads the event, sends mode copy with the capped copyInput, writes the merged copy', async () => {
    maybeSingle.mockResolvedValue(row({ fullName: 'M', tagline: 'Let’s celebrate!' }, { occasion: '40th', palette: 'gold' }));
    invoke.mockResolvedValue({ data: { reply: 'ok', copy: GEN, turnId: 9 }, error: null });
    updateEventConfig.mockResolvedValue(true);
    await expect(generateEventCopy('u-1')).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('ai-event-designer', {
      body: { mode: 'copy', eventUuid: 'u-1', messages: [COPY_TURN], copyInput: { name: "Maya's 40th", eventType: 'birthday', brief: 'BRIEF:\n- occasion: 40th\n- palette: gold', tagline: 'Let’s celebrate!' } },
    });
    const [uuid, patch] = updateEventConfig.mock.calls[0] as [string, { copy: Record<string, unknown> }];
    expect(uuid).toBe('u-1');
    expect(patch.copy).toMatchObject({ fullName: 'M', ...GEN });
    expect(typeof patch.copy.generatedAt).toBe('string');
  });

  it('is idempotent: a generatedAt stamp skips the AI call entirely', async () => {
    maybeSingle.mockResolvedValue(row({ generatedAt: '2026-09-01T00:00:00Z' }));
    await expect(generateEventCopy('u-1')).resolves.toEqual({ ok: true, skipped: 'already_generated' });
    expect(invoke).not.toHaveBeenCalled();
    expect(updateEventConfig).not.toHaveBeenCalled();
  });

  it('reports the fn error code, a half reply, a zero-row write and a throw — and never throws itself', async () => {
    maybeSingle.mockResolvedValue(row({}));
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })) });
    await expect(generateEventCopy('u-1')).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    // reportAiError is fire-and-forget (a lazy import) — settle it first.
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tag: 'ai_event_designer:copy:rate_limited' })));

    invoke.mockResolvedValue({ data: { copy: { welcomeIntro: 'only' } }, error: null });
    await expect(generateEventCopy('u-1')).resolves.toEqual({ ok: false, reason: 'empty_reply' });

    invoke.mockResolvedValue({ data: { copy: GEN }, error: null });
    updateEventConfig.mockResolvedValue(false);
    await expect(generateEventCopy('u-1')).resolves.toEqual({ ok: false, reason: 'write_failed' });

    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(generateEventCopy('u-1')).resolves.toEqual({ ok: false, reason: 'read_failed' });

    maybeSingle.mockRejectedValue(new Error('offline'));
    await expect(generateEventCopy('u-1')).resolves.toEqual({ ok: false, reason: 'network' });
  });

  it('brief input never exceeds the server cap, cut on a line boundary', async () => {
    maybeSingle.mockResolvedValue(row({}, { occasion: 'o'.repeat(80), palette: 'p'.repeat(120), tone: 't'.repeat(120), notes: 'n'.repeat(240), honorees: ['h'.repeat(40)] }));
    invoke.mockResolvedValue({ data: { copy: GEN }, error: null });
    updateEventConfig.mockResolvedValue(true);
    await generateEventCopy('u-1');
    const brief = (invoke.mock.calls[0][1] as { body: { copyInput: { brief: string } } }).body.copyInput.brief;
    expect(brief.length).toBeLessThanOrEqual(600);
    expect(brief.startsWith('BRIEF:\n- occasion:')).toBe(true);
    expect(brief.endsWith('\n')).toBe(false);
  });
});

/**
 * The deployed server's copy-mode gate, pinned to its SOURCE (edge code calls
 * Deno.serve at import, so it is read as text — the studioGate.test idiom).
 * Every turn of ai-event-designer passes the shared `messages` validation
 * BEFORE the copy branch; a copy body without `messages` was a 400 on every
 * go-live (zero mode='copy' agent_turns rows ever). If the server moves the
 * copy branch above that validation, or changes a rule, this goes red.
 */
describe('copy request vs the deployed ai-event-designer validator', () => {
  const SRC = readFileSync(new URL('../../supabase/functions/ai-event-designer/index.ts', import.meta.url), 'utf8');
  const num = (name: string) => Number(new RegExp(`const ${name} = (\\d+);`).exec(SRC)?.[1]);

  it('messages are validated before the copy branch, with the rules the mirror below applies', () => {
    const validate = SRC.indexOf('const raw = body.messages;');
    const copyBranch = SRC.indexOf("if (body.mode === 'copy') {");
    expect(validate).toBeGreaterThan(0);
    expect(copyBranch).toBeGreaterThan(validate);
    expect(SRC).toContain("if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TURNS) {");
    expect(SRC).toContain("if (role !== 'user' && role !== 'assistant') return json(400, { error: 'invalid_body' });");
    expect(SRC).toContain("if (typeof content !== 'string' || !content.trim() || content.length > MAX_CONTENT_CHARS) {");
    expect(SRC).toContain("if (messages[messages.length - 1].role !== 'user') return json(400, { error: 'invalid_body' });");
    expect(SRC).toContain("if (!copyInput || eventUuid === null) return json(400, { error: 'invalid_body' });");
    expect(SRC).toMatch(/typeof body\.eventUuid === 'string' && UUID_RE\.test\(body\.eventUuid\)/);
    expect(num('MAX_TURNS')).toBe(20);
    expect(num('MAX_CONTENT_CHARS')).toBe(2000);
  });

  /** A line-for-line mirror of the source rules asserted above. */
  function serverAccepts(body: Record<string, unknown>): boolean {
    const raw = body.messages;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > num('MAX_TURNS')) return false;
    for (const m of raw) {
      const { role, content } = (m ?? {}) as Record<string, unknown>;
      if (role !== 'user' && role !== 'assistant') return false;
      if (typeof content !== 'string' || !content.trim() || content.length > num('MAX_CONTENT_CHARS')) return false;
    }
    if ((raw[raw.length - 1] as { role: string }).role !== 'user') return false;
    const ci = body.copyInput as Record<string, unknown> | undefined;
    if (!ci || typeof ci !== 'object') return false;
    for (const k of Object.keys(SERVER_COPY_INPUT_CAPS) as (keyof typeof SERVER_COPY_INPUT_CAPS)[]) {
      if (typeof ci[k] !== 'string' || (ci[k] as string).length > SERVER_COPY_INPUT_CAPS[k]) return false;
    }
    if (!(ci.name as string).trim()) return false;
    return typeof body.eventUuid === 'string' && /^[0-9a-f-]{36}$/i.test(body.eventUuid);
  }

  const UUID = '4c989e0b-1354-40c4-bd6c-0afbb1329e7f';
  const INPUT = { name: 'Christmas Office Party', eventType: 'corporate', brief: '', tagline: '' };

  it('the client body passes; the old body (no messages) is the 400 we shipped', () => {
    expect(serverAccepts(copyRequestBody(UUID, INPUT))).toBe(true);
    const { messages: _dropped, ...old } = copyRequestBody(UUID, INPUT);
    expect(serverAccepts(old)).toBe(false);
  });

  it('client caps equal the server caps', () => {
    expect(SERVER_COPY_INPUT_CAPS).toEqual({ name: 80, eventType: 20, brief: 600, tagline: 160 });
    const maxed = { name: 'n'.repeat(80), eventType: 'e'.repeat(20), brief: 'b'.repeat(600), tagline: 't'.repeat(160) };
    expect(serverAccepts(copyRequestBody(UUID, maxed))).toBe(true);
    expect(serverAccepts(copyRequestBody(UUID, { ...maxed, brief: 'b'.repeat(601) }))).toBe(false);
  });
});
