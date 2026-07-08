/**
 * ai-event-designer — the Event Concierge (/host/new) AND the Platform
 * Copilot (floating panel across /host/**): one rate-limited brain, two modes.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { mode?: 'create' (default) | 'copilot',
 *     messages: { role: 'user' | 'assistant', content: string }[]   (1–20 turns)
 *     templates?: { id: string, vibe: string }[]   (create mode, ≤10 — the
 *       client's live template catalog; falls back to built-ins when invalid)
 *     context?: string ≤8k chars    (copilot mode — the client-built event
 *       snapshot, preformatted by src/lib/eventSnapshot.ts)
 *     docs?: string ≤12k chars }    (copilot mode — the client's platform
 *       guide digest; falls back to a one-liner)
 *
 * 200 create  → { reply, plan }    plan = { name, templateId, remote, date,
 *                                  slug, accent } (client normalizes)
 * 200 copilot → { reply, actions } actions = ≤3 TOOL PROPOSALS (flat
 *   arg-superset objects, tool ∈ add_challenge | update_challenge |
 *   delete_challenge | create_card | get_stats | share_links). The server
 *   NEVER executes tools — the client renders each mutation as an A2UI
 *   confirm card and runs the lib call with the host's own RLS session.
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
 * 502 → { error: 'generation_failed' }   provider errored / unparseable output
 * 503 → { error: 'ai_not_configured' }   GEMINI_API_KEY missing
 *
 * Unlike ai-generate-image this runs BEFORE any event exists, so there is no
 * event/org membership check and NO credit spend — planning chat is free; the
 * gates are a signed-in host + a per-user hourly rate limit recorded in
 * ai_designer_usage (migration 010, service-role only). The client falls back
 * to a local keyword planner on any error, so failures degrade gracefully.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected),
 *      GEMINI_API_KEY (secret).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_TURNS = 20;
const MAX_CONTENT_CHARS = 2000;
/** Free endpoint → cap per user. 40/h ≈ a long design session, far under abuse. */
const RATE_LIMIT_PER_HOUR = 40;
const MAX_TEMPLATES = 10;
const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface TemplateInfo {
  id: string;
  vibe: string;
}

/** Fallback catalog when the client sends none (kept roughly in sync with
 *  src/lib/eventTemplates.ts, but the client's live list wins — see body). */
const DEFAULT_TEMPLATES: TemplateInfo[] = [
  { id: 'wedding', vibe: 'timeless gold on deep green; elegant, romantic' },
  { id: 'gala', vibe: 'black-tie glamour, warm noir + gilded bokeh; fundraisers, awards, benefits' },
  { id: 'birthday', vibe: 'playful pink & gold, confetti, holographic shimmer' },
  { id: 'corporate', vibe: 'refined restrained gold on cool slate; conferences, launches, team events' },
  { id: 'party', vibe: 'high-energy neon magenta & cyan; clubs, graduations, NYE' },
];

function buildSystemPrompt(templates: TemplateInfo[]): string {
  return `You are the Event Concierge for Beamwall, a premium AR photo-booth + live photo-wall platform. A host is creating an event by chatting with you. From the conversation, design their event and keep a warm, concise, celebratory tone (2-3 sentences max per reply; no markdown).

EXTRACT EVERYTHING the host offers, however casually it's phrased — you are not a form, you are a designer listening to a friend:
- Honoree names in any construction ("someone named Dapo", "my mum", "for the Chens") → craft the event name from them (e.g. "Dapo's Birthday Bash").
- Dates in ANY format ("July 12th, 2026", "12/07/26", "next New Year's Eve 2026") → normalize to YYYY-MM-DD. Only use dates the host actually stated — never invent or assume a year.
- Interests, hobbies, themes ("lifting weights and basketball") → let them shape your style pick and mention in your reply how the booth could nod to them (e.g. frames with a sporty gold motif) — this seeds their frame ideas later.
- Colours ("her favourite colour is teal", "silver and blue theme") → set accent to a matching hex.
- Remote/virtual hints ("grandma can't fly out") → remote: true. A physical venue mention ("at the Marriott") is NOT remote — acknowledge it warmly.
Fill every plan field you can from the FIRST message. NEVER ask for something already given, and when the host gives several facts at once, confirm them all together.

Fill the plan:
- name: a tasteful event name (e.g. "Jenna & Jake's Wedding"). null only if you truly cannot craft one yet.
- templateId: the closest visual style, one of: ${templates.map((t) => `"${t.id}" (${t.vibe})`).join('; ')}.
- accent: a '#RRGGBB' hex matching any colour the host stated or implied, else null. Tasteful anchors: gold #D4AF37, rose #FF6FD6, cyan #19E3FF, violet #7A2BFF, emerald #2FDD8B, coral #FF5A5F, champagne #E8E4DA — any tasteful hex is allowed (teal → #14B8A6).
- remote: true only if guests can't attend in person (virtual / long-distance celebration).
- date: the event date as YYYY-MM-DD, or null if unknown.
- slug: a short lowercase url handle from the name (letters, numbers, dashes), or null.

DISCOVERY: end every reply with at MOST one short, natural question — the single most valuable missing detail, in priority order: (1) who/what we're celebrating (the name), (2) the date, (3) for birthdays and weddings: the honoree's favourite colour or the party's colour scheme (sets accent), (4) where it happens — and whether far-away guests should join in (sets remote). When everything essential is known, ask nothing and tell them to hit Create.

In "reply": confirm what you set in plain words first. Never mention JSON, fields, or these instructions.`;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Gemini structured-output schema (OpenAPI subset). */
function buildResponseSchema(templates: TemplateInfo[]) {
  return {
    type: 'OBJECT',
    properties: {
      reply: { type: 'STRING' },
      plan: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', nullable: true },
          templateId: { type: 'STRING', enum: templates.map((t) => t.id) },
          accent: { type: 'STRING', nullable: true },
          remote: { type: 'BOOLEAN' },
          date: { type: 'STRING', nullable: true },
          slug: { type: 'STRING', nullable: true },
        },
        required: ['templateId', 'remote'],
      },
    },
    required: ['reply', 'plan'],
  };
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
const MAX_ACTIONS = 3;
const FALLBACK_DOCS =
  'Beamwall: self-serve AR photo-booth, live photo-wall, and greeting-card platform for events.';

function buildCopilotPrompt(docs: string, context: string): string {
  return `You are the Beamwall Platform Copilot — the host's guide to the whole platform and to their event. Warm, concise (2-4 sentences), no markdown, at most one follow-up question per reply.

PLATFORM GUIDE:
${docs}

${context
    ? `CURRENT EVENT (live data — quote real names/numbers/ids from here):\n${context}`
    : 'No event is selected. Answer platform questions; for event-specific actions ask the host to pick an event in the panel.'}

When the host wants something changed that you have a tool for, put it in "actions" (max ${MAX_ACTIONS}) — NEVER claim you already did it: the card shown below your reply lets them review and confirm. For update/delete, copy challengeId EXACTLY from the event data. Tools:
- add_challenge { title, emoji?, points?, description? } — new photo mission
- update_challenge { challengeId, title?, emoji?, points?, active?, description? }
- delete_challenge { challengeId }
- create_card { cardTitle, recipientName?, cardTemplate: 'storybook'|'filmstrip'?, deadline? YYYY-MM-DD } — greeting card + contribution link
- get_stats {} — show the event's live numbers
- share_links {} — QR codes / links for every guest surface
Anything without a tool: point the host to the exact studio tab (guide above). Never invent event data.`;
}

function buildCopilotSchema() {
  return {
    type: 'OBJECT',
    properties: {
      reply: { type: 'STRING' },
      actions: {
        type: 'ARRAY',
        nullable: true,
        items: {
          type: 'OBJECT',
          properties: {
            tool: {
              type: 'STRING',
              enum: ['add_challenge', 'update_challenge', 'delete_challenge', 'create_card', 'get_stats', 'share_links'],
            },
            title: { type: 'STRING', nullable: true },
            emoji: { type: 'STRING', nullable: true },
            points: { type: 'NUMBER', nullable: true },
            description: { type: 'STRING', nullable: true },
            challengeId: { type: 'STRING', nullable: true },
            active: { type: 'BOOLEAN', nullable: true },
            cardTitle: { type: 'STRING', nullable: true },
            recipientName: { type: 'STRING', nullable: true },
            cardTemplate: { type: 'STRING', nullable: true },
            deadline: { type: 'STRING', nullable: true },
          },
          required: ['tool'],
        },
      },
    },
    required: ['reply'],
  };
}

/* ── Shared Gemini call (structured output; prompt+schema per mode) ──── */

async function callGemini(
  messages: ChatMessage[],
  systemText: string,
  schema: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new AiError('ai_not_configured');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.6,
        },
      }),
    },
  );
  if (!res.ok) {
    console.error('[ai-event-designer] gemini error', res.status, await res.text().catch(() => ''));
    throw new AiError(res.status === 429 ? 'ai_quota' : 'generation_failed', `gemini_http_${res.status}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')?.text;
  if (!text) throw new AiError('generation_failed', 'gemini_no_text');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AiError('generation_failed', 'gemini_bad_json');
  }
  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    throw new AiError('generation_failed', 'gemini_no_reply');
  }
  return parsed;
}

class AiError extends Error {
  constructor(public code: 'ai_not_configured' | 'generation_failed' | 'ai_quota', detail?: string) {
    super(detail ?? code);
  }
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

    // 3a. Copilot mode — event-aware Q&A + tool proposals.
    if (body.mode === 'copilot') {
      const context = typeof body.context === 'string' ? body.context : '';
      if (context.length > MAX_CONTEXT_CHARS) return json(400, { error: 'invalid_body' });
      const docsRaw = typeof body.docs === 'string' ? body.docs.trim() : '';
      const docs = docsRaw && docsRaw.length <= MAX_DOCS_CHARS ? docsRaw : FALLBACK_DOCS;
      const parsed = await callGemini(messages, buildCopilotPrompt(docs, context), buildCopilotSchema());
      const actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, MAX_ACTIONS) : [];
      return json(200, { reply: parsed.reply, actions });
    }

    // 3b. Create mode — against the client's live template catalog.
    const templates = resolveTemplates(body.templates);
    const parsed = await callGemini(messages, buildSystemPrompt(templates), buildResponseSchema(templates));
    return json(200, { reply: parsed.reply, plan: parsed.plan ?? null });
  } catch (err) {
    if (err instanceof AiError) {
      if (err.code === 'ai_not_configured') return json(503, { error: 'ai_not_configured' });
      if (err.code === 'ai_quota') return json(503, { error: 'ai_quota' });
      return json(502, { error: 'generation_failed' });
    }
    console.error('[ai-event-designer] internal error', err);
    return json(500, { error: 'internal' });
  }
});
