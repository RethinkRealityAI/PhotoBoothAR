/**
 * ai-event-designer — the Event Concierge (/host/new), the Platform Copilot
 * (floating panel across /host/**), AND the Studio AI Scene Director: one
 * rate-limited brain, several modes.
 *
 * v16 — credits-aware: the fn now fetches the caller's org credit balance (and
 * the event's free-image allowance when an eventUuid is sent) server-side and
 * injects it — with the real cost table — into the MUTABLE tail of every
 * mode's prompt, so the agent states costs, flags unaffordable generations,
 * and points to Billing instead of proposing spends that will 402.
 *
 * v17 — transport + telemetry: per-mode AGENT PROFILES (./profiles.ts —
 * model, temperature, thinking budget, output cap, timeout; env-overridable
 * via GEMINI_MODEL_<MODE> / GEMINI_THINKING_<MODE> / GEMINI_TEMPERATURE_<MODE>
 * / GEMINI_MAX_TOKENS_<MODE>), a per-attempt AbortSignal timeout with ONE
 * retry on network/abort/5xx (never 4xx/429), and one `agent_turns` row per
 * turn (migration 036 — sizes/tokens/latency/model/proposals/codes/feedback,
 * NO message text; never load-bearing) plus a `feedback` mode for thumbs.
 *
 * v18 — playbook prompts: every system prompt + response schema lives in
 * ./prompt.ts (pure, Deno-free, vitest+tsc-covered), rebuilt as sentence-case
 * `# Section` blocks with a byte-stable static prefix (prompt caching) and a
 * mutable fenced tail; the copilot `# Tools` section is GENERATED from the
 * client's registry (src/lib/copilotTools.ts → ./tools.generated.ts via
 * `npm run gen:agent-tools`; src/lib/copilotTools.drift.test.ts guards it).
 * This fn is now transport only: auth, rate limit, validation, credits,
 * the Gemini call, telemetry.
 *
 * DEPLOY FILES (all five, every time — a missing sibling is an import error
 * that 500s EVERY mode): index.ts · prompt.ts · tools.generated.ts ·
 * profiles.ts · deno.json.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { mode?: 'create' (default) | 'copilot' | 'scene' | 'feedback',
 *     surface?: 'build' | 'platform' | 'studio' | 'concierge'   (any chat mode
 *       — which UI the turn came from; anything else → 'platform'. Recorded in
 *       telemetry AND, in copilot mode, selects the prompt's static
 *       `# Environment` variant: 'build' = the guided build step on the
 *       create-success screen (event selected); everything else = the
 *       floating dashboard assistant. It is also stamped as the first line
 *       inside the fenced CURRENT EVENT block: `Session: surface=… · event
 *       selected=yes|no`.)
 *     lastTurn?: { turnId: number, dropped: number }   (any chat mode, or null
 *       — the client's report on the PREVIOUS turn: how many proposals its
 *       normalizer dropped. Best-effort update of that row, caller-scoped.)
 *     messages: { role: 'user' | 'assistant', content: string }[]   (1–20 turns)
 *     eventUuid?: string   (any mode — events.id; scopes the credits context to
 *       that event's org (membership-verified) + its free-image allowance.
 *       Absent/invalid → falls back to the caller's first org membership.)
 *     templates?: { id: string, vibe: string }[]   (create mode, ≤10 — the
 *       client's live template catalog; falls back to built-ins when invalid)
 *     context?: string ≤8k chars    (copilot mode — the client-built event
 *       snapshot, preformatted by src/lib/eventSnapshot.ts)
 *     docs?: string ≤12k chars      (copilot mode — the client's platform
 *       guide digest; falls back to a one-liner)
 *     shaderCatalog?: { id, params?: {key,min,max,default}[] }[]  (scene mode)
 *     headPieceIds?: string[]        (scene mode — built-in head-piece ids)
 *     sceneContext?: string ≤1200 chars   (scene mode, OPTIONAL — the client's
 *       compact summary of the OPEN DRAFT + the plan proposed last turn, so the
 *       Director can iterate on what exists instead of restarting every turn.
 *       Absent (older clients) → the prompt is byte-identical to before.) }
 *
 *   mode 'feedback' sends NO messages: { turnId: number, feedback: 1 | -1,
 *     note?: string ≤500 } → 200 { ok: true }. Handled after auth but BEFORE
 *     the rate limiter (it spends no ai_designer_usage) — the update is scoped
 *     to the caller's own agent_turns rows.
 *
 * Every chat-mode 200 below also carries `turnId: number | null` — the
 * agent_turns row for this turn (null when the telemetry write failed), which
 * the client echoes back in `lastTurn` and in mode 'feedback'.
 *
 * 200 scene   → { reply, planJson } reply = the director's chat line (always).
 *   planJson = a JSON STRING (client parses + clamps via
 *   src/lib/studio/sceneDirector.ts): { sceneName, frame:{prompt}|null,
 *   shader:{shaderId,params}|null, headPiece:{kind,id?|prompt?}|null } — OR the
 *   empty string "" on pure-ideation turns (the host is asking for advice, not
 *   yet describing a scene to build). Like copilot, the server only PROPOSES —
 *   the client spends credits only when the host accepts each piece.
 *
 * 200 create  → { reply, plan }    plan = { name, templateId, remote, date,
 *                                  slug, accent } (client normalizes)
 * 200 copilot → { reply, actions } actions = ≤MAX_ACTIONS TOOL PROPOSALS (flat
 *   arg-superset objects, tool ∈ the registry in src/lib/copilotTools.ts —
 *   frames, filters, 3D props, challenges, cards, date/name, go-live, stats,
 *   links, plus the two handoffs open_scene_director / contact_support).
 *   The server NEVER executes tools — the client renders each
 *   mutation as an A2UI confirm card and runs the lib call with the host's
 *   own RLS session.
 *   Why proposals instead of native Gemini functionDeclarations: structured
 *   output (responseSchema, which the create plan depends on) and tools are
 *   mutually exclusive on generateContent, and client-side execution forces
 *   a round-trip per tool anyway — proposals are simpler, single-spend, and
 *   preview-first by construction. Revisit if Google lifts the exclusion.
 * 400 → { error: 'invalid_json' | 'invalid_body' }
 * 401 → { error: 'unauthorized' }
 * 429 → { error: 'rate_limited' }        over RATE_LIMIT_PER_HOUR for this user
 *                                        (platform admins are exempt)
 * 500 → { error: 'internal' }
 * 502 → { error: 'generation_failed' }   provider errored / unparseable output /
 *                                        timed out or unreachable after the retry
 * 503 → { error: 'ai_not_configured' }   GEMINI_API_KEY missing
 * 503 → { error: 'ai_key_invalid' }       GEMINI_API_KEY set but rejected by
 *                                          Google (rotated / wrong / restricted)
 * 503 → { error: 'ai_quota' }             plan/billing quota exhausted (429)
 *
 * Unlike ai-generate-image this runs BEFORE any event exists, so there is no
 * event/org membership check and NO credit spend — planning chat is free; the
 * gates are a signed-in host + a per-user hourly rate limit recorded in
 * ai_designer_usage (migration 010, service-role only). The client falls back
 * to a local keyword planner on any error, so failures degrade gracefully.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected),
 *      GEMINI_API_KEY (secret); optional per-mode profile overrides
 *      GEMINI_MODEL_{CREATE,COPILOT,SCENE} / GEMINI_THINKING_* /
 *      GEMINI_TEMPERATURE_* / GEMINI_MAX_TOKENS_* (see ./profiles.ts).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import { type AgentMode, type AgentProfile, resolveProfile } from './profiles.ts';
import {
  type CatalogEntry,
  type CreditsInfo,
  DEFAULT_TEMPLATES,
  FREE_IMAGES_PER_EVENT,
  MAX_ACTIONS,
  type SceneShaderEntry,
  SURFACES,
  type Surface,
  type TemplateInfo,
  buildCopilotPrompt,
  buildCopilotSchema,
  buildCreatePrompt,
  buildResponseSchema,
  buildScenePrompt,
  buildSceneSchema,
  formatCreditsBlock,
} from './prompt.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_TURNS = 20;
const MAX_CONTENT_CHARS = 2000;
/** Free endpoint → cap per user. 40/h ≈ a long design session, far under abuse. */
const RATE_LIMIT_PER_HOUR = 40;
const MAX_TEMPLATES = 10;
const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Env reader handed to resolveProfile (profiles.ts stays runtime-agnostic). */
const envGet = (key: string): string | undefined => Deno.env.get(key);

/**
 * Resolve the caller's credit context server-side (service role). Event-scoped
 * when a valid eventUuid arrives AND the caller is a member of that event's
 * org — the org ai-generate-image actually charges; otherwise the caller's
 * first org membership. Best-effort: any failure degrades to "unknown"
 * (no credits block) — billing awareness must never break the chat.
 */
async function fetchCreditsInfo(
  sb: ReturnType<typeof createClient>,
  userId: string,
  eventUuid: string | null,
): Promise<CreditsInfo> {
  try {
    let orgId: string | null = null;
    let freeImagesLeft: number | null = null;
    if (eventUuid) {
      const { data: ev } = await sb.from('events').select('id, org_id').eq('id', eventUuid).maybeSingle();
      if (ev?.org_id) {
        const { data: member } = await sb
          .from('org_members')
          .select('org_id')
          .eq('org_id', ev.org_id as string)
          .eq('user_id', userId)
          .maybeSingle();
        if (member) {
          orgId = ev.org_id as string;
          const { count } = await sb
            .from('ai_jobs')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', eventUuid)
            .eq('kind', 'image')
            .neq('status', 'failed');
          freeImagesLeft = Math.max(0, FREE_IMAGES_PER_EVENT - (count ?? 0));
        }
      }
    }
    if (orgId === null) {
      const { data: mem } = await sb
        .from('org_members')
        .select('org_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
      orgId = (mem?.org_id as string | undefined) ?? null;
    }
    if (orgId === null) return { balance: null, freeImagesLeft, orgId: null };
    const { data: bal } = await sb
      .from('credit_balances')
      .select('balance')
      .eq('org_id', orgId)
      .maybeSingle();
    return {
      balance: typeof bal?.balance === 'number' ? bal.balance : null,
      freeImagesLeft,
      orgId,
    };
  } catch (e) {
    console.error('[ai-event-designer] credits fetch failed', e);
    return { balance: null, freeImagesLeft: null, orgId: null };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The client's template catalog when valid, else the built-in default. */
function resolveTemplates(raw: unknown): TemplateInfo[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TEMPLATES) {
    return DEFAULT_TEMPLATES;
  }
  const out: TemplateInfo[] = [];
  for (const t of raw) {
    const id = (t as Record<string, unknown>)?.id;
    const vibe = (t as Record<string, unknown>)?.vibe;
    if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) return DEFAULT_TEMPLATES;
    if (typeof vibe !== 'string' || !vibe.trim() || vibe.length > 160) return DEFAULT_TEMPLATES;
    out.push({ id, vibe: vibe.trim() });
  }
  return out;
}

/* ── Copilot mode (tool PROPOSALS — see header) ─────────────────────── */

const MAX_CONTEXT_CHARS = 8000;
const MAX_DOCS_CHARS = 12000;
const FALLBACK_DOCS =
  'Beamwall: self-serve AR photo-booth, live photo-wall, and greeting-card platform for events.';

/** Validate a client-sent {id,name}[] catalog (filters / head pieces) into the
 *  prompt list. Anything malformed is dropped — the client normalizer is the
 *  authoritative gate on whatever the model ends up proposing. */
function resolveCatalog(raw: unknown, max: number): CatalogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CatalogEntry[] = [];
  for (const e of raw.slice(0, max)) {
    const id = (e as Record<string, unknown>)?.id;
    const name = (e as Record<string, unknown>)?.name;
    if (typeof id === 'string' && id && typeof name === 'string' && name) {
      out.push({ id: id.slice(0, 40), name: name.slice(0, 60) });
    }
  }
  return out;
}

/* ── Scene Director mode (coordinated frame + filter + 3D piece) ─────── */

/** Scene-mode client context cap (draft + last plan summary). */
const MAX_SCENE_CONTEXT_CHARS = 1200;

/* ── Shared Gemini call (structured output; prompt+schema per mode) ──── */
/* Generation settings live in ./profiles.ts (AGENT_PROFILES + env overrides),
 * including WHY create/copilot run with thinking OFF and scene with a budget. */

/** Token accounting from Gemini's `usageMetadata` (null when absent). */
interface GeminiUsage {
  promptTokens: number | null;
  outputTokens: number | null;
  /** Prompt tokens served from the implicit cache — the byte-stable prefix pays off here. */
  cachedTokens: number | null;
  thoughtsTokens: number | null;
}

interface GeminiResult {
  parsed: Record<string, unknown>;
  usage: GeminiUsage | null;
  model: string;
  /** 1 on a clean call; 2 when the single transient retry ran. */
  attempts: number;
  latencyMs: number;
}

/** Transient transport failures worth ONE retry: a network-level TypeError
 *  (DNS/reset/refused) or an abort from AbortSignal.timeout. HTTP statuses are
 *  decided separately (5xx only — never 4xx/429, which would double-count quota). */
function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** A host-supplied photo (invitation / mood board / venue) for vision analysis. */
interface InputImage {
  data: string;      // base64 (no data: prefix)
  mimeType: string;  // image/png | image/jpeg | image/webp | image/heic
}

const MAX_IMAGE_B64 = 7_000_000; // ~5 MB decoded — plenty for a downscaled photo

/** Validate a host-supplied image payload for vision analysis; undefined if bad. */
function resolveImage(raw: unknown): InputImage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const { data, mimeType } = r;
  if (typeof data !== 'string' || !data || data.length > MAX_IMAGE_B64) return undefined;
  if (typeof mimeType !== 'string' || !/^image\/(png|jpe?g|webp|heic|heif)$/i.test(mimeType)) return undefined;
  return { data, mimeType };
}

/** Map chat turns to Gemini contents; attach the image (if any) to the LAST
 *  user turn, image BEFORE text (Google's recommended order for analysis). */
function buildContents(messages: ChatMessage[], image?: InputImage) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }] as Record<string, unknown>[],
  }));
  if (image) {
    for (let i = contents.length - 1; i >= 0; i--) {
      if (contents[i].role === 'user') {
        contents[i].parts = [{ inlineData: { mimeType: image.mimeType, data: image.data } }, ...contents[i].parts];
        break;
      }
    }
  }
  return contents;
}

/** Max attempts per call: the first, plus ONE retry on a transient failure. */
const GEMINI_MAX_ATTEMPTS = 2;

async function callGemini(
  messages: ChatMessage[],
  systemText: string,
  schema: Record<string, unknown>,
  profile: AgentProfile,
  image?: InputImage,
): Promise<GeminiResult> {
  // Secrets set via the dashboard sometimes arrive wrapped in quotes or with a
  // trailing newline; Google then rejects them as API_KEY_INVALID. Strip both.
  const key = Deno.env.get('GEMINI_API_KEY')?.trim().replace(/^["']|["']$/g, '');
  if (!key) throw new AiError('ai_not_configured');

  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    responseSchema: schema,
    temperature: profile.temperature,
    maxOutputTokens: profile.maxOutputTokens,
    thinkingConfig: { thinkingBudget: profile.thinkingBudget },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${profile.model}:generateContent`;
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemText }] },
    contents: buildContents(messages, image),
    generationConfig,
  });

  const started = Date.now();
  const elapsed = () => Date.now() - started;
  // Retry ONCE, and only while the total wall clock is still under 1.5× one
  // attempt's budget — a second full-length attempt after a full-length
  // timeout is the worst case (2× timeoutMs), never more.
  const mayRetry = (attempt: number) =>
    attempt < GEMINI_MAX_ATTEMPTS && elapsed() < profile.timeoutMs * 1.5;
  const fail = (code: AiError['code'], detail: string, attempt: number): AiError => {
    const e = new AiError(code, detail);
    e.attempts = attempt;
    return e;
  };

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: payload,
        signal: AbortSignal.timeout(profile.timeoutMs),
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        console.error('[ai-event-designer] gemini error', res.status, bodyText);
        if (res.status >= 500 && mayRetry(attempt)) {
          console.warn('[ai-event-designer] gemini retry', { attempt, reason: `http_${res.status}`, elapsedMs: elapsed() });
          continue;
        }
        // A rejected/rotated/missing-billing key fails FAST with 400 API_KEY_INVALID
        // or 401/403 — a CONFIG problem, not a transient generation failure. Report
        // it distinctly so the app can tell the owner the key needs attention
        // instead of a vague "couldn't generate".
        const keyRejected =
          res.status === 401 ||
          res.status === 403 ||
          (res.status === 400 && /API_KEY_INVALID|api key not valid|PERMISSION_DENIED/i.test(bodyText));
        const code = res.status === 429 ? 'ai_quota' : keyRejected ? 'ai_key_invalid' : 'generation_failed';
        throw fail(code, `gemini_http_${res.status}`, attempt);
      }
      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: {
          promptTokenCount?: unknown;
          candidatesTokenCount?: unknown;
          cachedContentTokenCount?: unknown;
          thoughtsTokenCount?: unknown;
        };
      };
      const text = body.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')?.text;
      if (!text) throw fail('generation_failed', 'gemini_no_text', attempt);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw fail('generation_failed', 'gemini_bad_json', attempt);
      }
      if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
        throw fail('generation_failed', 'gemini_no_reply', attempt);
      }
      const um = body.usageMetadata;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const usage: GeminiUsage | null = um
        ? {
          promptTokens: num(um.promptTokenCount),
          outputTokens: num(um.candidatesTokenCount),
          cachedTokens: num(um.cachedContentTokenCount),
          thoughtsTokens: num(um.thoughtsTokenCount),
        }
        : null;
      return { parsed, usage, model: profile.model, attempts: attempt, latencyMs: elapsed() };
    } catch (err) {
      if (err instanceof AiError) throw err;
      const abort = isAbortLike(err);
      const network = err instanceof TypeError;
      if ((abort || network) && mayRetry(attempt)) {
        console.warn('[ai-event-designer] gemini retry', { attempt, reason: abort ? 'timeout' : 'network', elapsedMs: elapsed() });
        continue;
      }
      // Final abort → the existing 502 code with a distinct detail (client copy unchanged).
      if (abort) throw fail('generation_failed', 'gemini_timeout', attempt);
      if (network) throw fail('generation_failed', 'gemini_network', attempt);
      throw err;
    }
  }
}

class AiError extends Error {
  /** Attempts the transport made before giving up (telemetry). */
  attempts = 1;
  constructor(
    public code: 'ai_not_configured' | 'ai_key_invalid' | 'generation_failed' | 'ai_quota',
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

/* ── Telemetry: agent_turns (migration 036, service-role only) ────────── */

const ACTIONS_JSON_MAX_BYTES = 8192;
const FEEDBACK_NOTE_MAX_CHARS = 500;
/** Sanity ceiling for lastTurn.dropped (a turn proposes ≤ MAX_ACTIONS). */
const MAX_DROPPED = 100;

/** Cut to at most maxBytes of UTF-8 without splitting a multibyte character
 *  (the column CHECK is octet_length; JS .length counts UTF-16 units). */
function truncateUtf8(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--; // step back off a continuation byte
  return new TextDecoder().decode(bytes.subarray(0, end));
}

function isPosInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

interface TurnBase {
  user_id: string;
  org_id: string | null;
  event_id: string | null;
  mode: AgentMode;
  surface: Surface;
}

/** Insert one agent_turns row. NEVER load-bearing: every failure is logged
 *  and yields null — the chat response must not depend on telemetry. */
async function recordTurn(
  sb: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
): Promise<number | null> {
  try {
    const { data, error } = await sb.from('agent_turns').insert(row).select('id').single();
    if (error) {
      console.error('[ai-event-designer] agent_turns insert failed', error);
      return null;
    }
    const id = (data as { id?: unknown } | null)?.id;
    if (typeof id === 'number' && Number.isSafeInteger(id)) return id;
    if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id); // int8 can serialise as a string
    return null;
  } catch (e) {
    console.error('[ai-event-designer] agent_turns insert failed', e);
    return null;
  }
}

/** Run one Gemini turn and record it whatever the outcome — an error row
 *  carries error_code (the AiError detail, e.g. gemini_timeout) and no
 *  tokens. The throw reaches the handler's error map unchanged. */
async function runTurn(
  sb: ReturnType<typeof createClient>,
  base: TurnBase,
  profile: AgentProfile,
  call: () => Promise<GeminiResult>,
  actionsOf: (parsed: Record<string, unknown>) => string | null,
): Promise<{ result: GeminiResult; turnId: number | null }> {
  const started = Date.now();
  const common = {
    ...base,
    model: profile.model,
    temperature: profile.temperature,
    thinking_budget: profile.thinkingBudget,
    dropped_count: 0,
  };
  let result: GeminiResult;
  try {
    result = await call();
  } catch (err) {
    await recordTurn(sb, {
      ...common,
      latency_ms: Date.now() - started,
      attempts: err instanceof AiError ? err.attempts : 1,
      error_code: err instanceof AiError ? err.message : 'internal',
    });
    throw err;
  }
  const actions = actionsOf(result.parsed);
  const turnId = await recordTurn(sb, {
    ...common,
    model: result.model,
    latency_ms: result.latencyMs,
    attempts: result.attempts,
    prompt_tokens: result.usage?.promptTokens ?? null,
    cached_tokens: result.usage?.cachedTokens ?? null,
    output_tokens: result.usage?.outputTokens ?? null,
    thoughts_tokens: result.usage?.thoughtsTokens ?? null,
    reply_chars: typeof result.parsed.reply === 'string' ? result.parsed.reply.length : null,
    actions_json: actions === null ? null : truncateUtf8(actions, ACTIONS_JSON_MAX_BYTES),
    error_code: null,
  });
  return { result, turnId };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  try {
    // 1. Auth — resolve the caller from their JWT (user-scoped client).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'unauthorized' });
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: 'unauthorized' });
    const userId = userData.user.id;

    // 1b. Rate limit — free endpoint, so cap calls per user per hour
    //     (ai_designer_usage: service-role only, migration 010).
    //     Platform admins are exempt: owner testing must never hit limits.
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // 1c. Feedback mode — a host rating an earlier turn (thumbs + note).
    //     Needs the auth above, but makes no Gemini call and sends no
    //     messages, so it is handled BEFORE the rate limiter (must not spend
    //     ai_designer_usage) and before the conversation validation. The
    //     update is scoped to the caller's OWN rows; a foreign/unknown id
    //     matches nothing and still answers ok (no id-enumeration oracle).
    if (body.mode === 'feedback') {
      const { turnId, feedback, note } = body;
      if (!isPosInt(turnId) || (feedback !== 1 && feedback !== -1)) return json(400, { error: 'invalid_body' });
      if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > FEEDBACK_NOTE_MAX_CHARS)) {
        return json(400, { error: 'invalid_body' });
      }
      const feedbackNote = typeof note === 'string' && note.trim() ? note.trim() : null;
      const { error: fbErr } = await sb
        .from('agent_turns')
        .update({ feedback, feedback_note: feedbackNote })
        .eq('id', turnId)
        .eq('user_id', userId);
      if (fbErr) {
        console.error('[ai-event-designer] feedback update failed', fbErr);
        return json(500, { error: 'internal' });
      }
      return json(200, { ok: true });
    }

    const { data: isAdmin } = await sb.rpc('is_platform_admin', { p_user: userId });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    if (isAdmin !== true) {
      const { count: used, error: rlErr } = await sb
        .from('ai_designer_usage')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', hourAgo);
      if (rlErr) throw rlErr;
      if ((used ?? 0) >= RATE_LIMIT_PER_HOUR) return json(429, { error: 'rate_limited' });
      const { error: usageErr } = await sb.from('ai_designer_usage').insert({ user_id: userId });
      if (usageErr) console.error('[ai-event-designer] usage insert failed', usageErr);
    }

    // 2. Validate the conversation.
    const raw = body.messages;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TURNS) {
      return json(400, { error: 'invalid_body' });
    }
    const messages: ChatMessage[] = [];
    for (const m of raw) {
      const role = (m as Record<string, unknown>)?.role;
      const content = (m as Record<string, unknown>)?.content;
      if (role !== 'user' && role !== 'assistant') return json(400, { error: 'invalid_body' });
      if (typeof content !== 'string' || !content.trim() || content.length > MAX_CONTENT_CHARS) {
        return json(400, { error: 'invalid_body' });
      }
      messages.push({ role, content });
    }
    if (messages[messages.length - 1].role !== 'user') return json(400, { error: 'invalid_body' });
    // Which UI the turn came from (client-declared; unknown → 'platform').
    // Recorded in telemetry and read by the copilot prompt (# Environment
    // variant + the Session line inside the fenced event block).
    const surface: Surface =
      typeof body.surface === 'string' && (SURFACES as readonly string[]).includes(body.surface)
        ? (body.surface as Surface)
        : 'platform';

    // 2b. Credits context (any mode) — event-scoped when the client sends a
    //     valid eventUuid (membership-verified), else the caller's org.
    //     Best-effort: an unknown balance yields an empty block, never an error.
    const eventUuid =
      typeof body.eventUuid === 'string' && UUID_RE.test(body.eventUuid) ? body.eventUuid : null;
    const credits = await fetchCreditsInfo(sb, userId, eventUuid);
    const creditsBlock = formatCreditsBlock(credits);
    const turnBase = { user_id: userId, org_id: credits.orgId, event_id: eventUuid, surface };

    // 2c. The client's report on the PREVIOUS turn — how many of its proposals
    //     the normalizer dropped. Best-effort, scoped to the caller's own row,
    //     applied before the new call. `null` = no previous turn (absent).
    if (body.lastTurn !== undefined && body.lastTurn !== null) {
      const lt = body.lastTurn;
      if (typeof lt !== 'object') return json(400, { error: 'invalid_body' });
      const { turnId, dropped } = lt as Record<string, unknown>;
      if (
        !isPosInt(turnId) ||
        typeof dropped !== 'number' || !Number.isSafeInteger(dropped) || dropped < 0 || dropped > MAX_DROPPED
      ) {
        return json(400, { error: 'invalid_body' });
      }
      const { error: ltErr } = await sb
        .from('agent_turns')
        .update({ dropped_count: dropped })
        .eq('id', turnId)
        .eq('user_id', userId);
      if (ltErr) console.error('[ai-event-designer] dropped_count update failed', ltErr);
    }

    // 3a. Copilot mode — event-aware Q&A + tool proposals.
    if (body.mode === 'copilot') {
      const context = typeof body.context === 'string' ? body.context : '';
      if (context.length > MAX_CONTEXT_CHARS) return json(400, { error: 'invalid_body' });
      const docsRaw = typeof body.docs === 'string' ? body.docs.trim() : '';
      const docs = docsRaw && docsRaw.length <= MAX_DOCS_CHARS ? docsRaw : FALLBACK_DOCS;
      // Live filter + head-piece catalogs (client-sent); the client normalizer
      // is the real gate, so an empty/invalid list just narrows the prompt.
      const filters = resolveCatalog(body.filters, 40);
      const headPieces = resolveCatalog(body.headPieces, 24);
      const frames = resolveCatalog(body.frames, 20);
      // Proposals = structured extraction → low temp + no thinking (cheap, reliable).
      // maxOutputTokens is lifted above the 2048 default: a reply plus an
      // actionsJson STRING carrying a 6-challenge pack (each with a
      // validationPrompt), doubly escaped, can approach 2048 and truncate →
      // invalid JSON → the whole turn falls back to the offline reply.
      const profile = resolveProfile('copilot', envGet);
      const { result: { parsed }, turnId } = await runTurn(
        sb,
        { ...turnBase, mode: 'copilot' },
        profile,
        () => callGemini(messages, buildCopilotPrompt({ surface, docs, context, filters, headPieces, frames }) + creditsBlock, buildCopilotSchema(), profile),
        (p) => (typeof p.actionsJson === 'string' ? p.actionsJson : null),
      );
      let actions: unknown[] = [];
      try {
        const decoded = JSON.parse(typeof parsed.actionsJson === 'string' ? parsed.actionsJson : '[]');
        if (Array.isArray(decoded)) actions = decoded.slice(0, MAX_ACTIONS);
      } catch { /* malformed actionsJson → no actions; reply still ships */ }
      return json(200, { reply: parsed.reply, actions, turnId });
    }

    // 3a-scene. Scene Director — one coordinated frame + filter + 3D piece.
    if (body.mode === 'scene') {
      const shaders = Array.isArray(body.shaderCatalog)
        ? (body.shaderCatalog as SceneShaderEntry[]).filter((s) => s && typeof s.id === 'string').slice(0, 40)
        : [];
      const pieceIds = Array.isArray(body.headPieceIds)
        ? (body.headPieceIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 24)
        : [];
      // OPTIONAL scene context (draft + last plan). Older deployed clients send
      // nothing → '' → the prompt is byte-identical to the pre-context build.
      // Oversized input is TRUNCATED, never rejected: a chatty scene must not
      // turn into a 400 for the host.
      const sceneContext = typeof body.sceneContext === 'string'
        ? body.sceneContext.slice(0, MAX_SCENE_CONTEXT_CHARS)
        : '';
      const profile = resolveProfile('scene', envGet);
      const { result: { parsed }, turnId } = await runTurn(
        sb,
        { ...turnBase, mode: 'scene' },
        profile,
        () => callGemini(messages, buildScenePrompt(shaders, pieceIds, sceneContext) + creditsBlock, buildSceneSchema(), profile),
        (p) => (typeof p.planJson === 'string' ? p.planJson : null),
      );
      return json(200, { reply: parsed.reply, planJson: typeof parsed.planJson === 'string' ? parsed.planJson : '', turnId });
    }

    // 3b. Create mode — against the client's live template catalog. An optional
    //     photo (invitation / mood board / venue) is read by Gemini vision to
    //     seed the plan (colours → accent, occasion → template, names, date).
    const templates = resolveTemplates(body.templates);
    const image = resolveImage(body.image);
    const profile = resolveProfile('create', envGet);
    const { result: { parsed }, turnId } = await runTurn(
      sb,
      { ...turnBase, mode: 'create' },
      profile,
      () => callGemini(messages, buildCreatePrompt(templates, !!image) + creditsBlock, buildResponseSchema(templates), profile, image),
      (p) => JSON.stringify(p.plan ?? null),
    );
    return json(200, { reply: parsed.reply, plan: parsed.plan ?? null, turnId });
  } catch (err) {
    if (err instanceof AiError) {
      if (err.code === 'ai_not_configured') return json(503, { error: 'ai_not_configured' });
      if (err.code === 'ai_key_invalid') return json(503, { error: 'ai_key_invalid' });
      if (err.code === 'ai_quota') return json(503, { error: 'ai_quota' });
      return json(502, { error: 'generation_failed' });
    }
    console.error('[ai-event-designer] internal error', err);
    return json(500, { error: 'internal' });
  }
});
