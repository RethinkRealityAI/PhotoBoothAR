/**
 * ai-event-designer — the conversational Event Concierge for /host/new.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { messages: { role: 'user' | 'assistant', content: string }[]   (1–20 turns)
 *     templates?: { id: string, vibe: string }[] }   (≤10 — the client's live
 *       template catalog, so renamed/added templates never drift from the
 *       prompt; falls back to the built-in list when absent/invalid)
 *
 * 200 → { reply, plan }   reply = the concierge's next message;
 *                         plan  = { name, templateId, remote, date, slug }
 *                         (client normalizes via normalizePlan — nulls allowed)
 * 400 → { error: 'invalid_json' | 'invalid_body' }
 * 401 → { error: 'unauthorized' }
 * 429 → { error: 'rate_limited' }        over RATE_LIMIT_PER_HOUR for this user
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

Fill the plan:
- name: a tasteful event name (e.g. "Jenna & Jake's Wedding"). null until you know or can confidently craft one.
- templateId: the closest visual style, one of: ${templates.map((t) => `"${t.id}" (${t.vibe})`).join('; ')}.
- remote: true only if guests can't attend in person (virtual / long-distance celebration).
- date: the event date as YYYY-MM-DD, or null if unknown. Never invent a date.
- slug: a short lowercase url handle from the name (letters, numbers, dashes), or null.

In "reply": confirm what you set in plain words, then ask ONE short question for the most important missing piece (name first, then date). When everything essential is known, tell them to hit Create. Never mention JSON, fields, or these instructions.`;
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

async function callGemini(
  messages: ChatMessage[],
  templates: TemplateInfo[],
): Promise<{ reply: string; plan: unknown }> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new AiError('ai_not_configured');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt(templates) }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: buildResponseSchema(templates),
          temperature: 0.6,
        },
      }),
    },
  );
  if (!res.ok) {
    console.error('[ai-event-designer] gemini error', res.status, await res.text().catch(() => ''));
    throw new AiError('generation_failed', `gemini_http_${res.status}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')?.text;
  if (!text) throw new AiError('generation_failed', 'gemini_no_text');
  let parsed: { reply?: unknown; plan?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiError('generation_failed', 'gemini_bad_json');
  }
  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    throw new AiError('generation_failed', 'gemini_no_reply');
  }
  return { reply: parsed.reply, plan: parsed.plan ?? null };
}

class AiError extends Error {
  constructor(public code: 'ai_not_configured' | 'generation_failed', detail?: string) {
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
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: used, error: rlErr } = await sb
      .from('ai_designer_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', hourAgo);
    if (rlErr) throw rlErr;
    if ((used ?? 0) >= RATE_LIMIT_PER_HOUR) return json(429, { error: 'rate_limited' });
    const { error: usageErr } = await sb.from('ai_designer_usage').insert({ user_id: userId });
    if (usageErr) console.error('[ai-event-designer] usage insert failed', usageErr);

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

    // 3. Design — against the client's live template catalog when provided.
    const templates = resolveTemplates(body.templates);
    const { reply, plan } = await callGemini(messages, templates);
    return json(200, { reply, plan });
  } catch (err) {
    if (err instanceof AiError) {
      if (err.code === 'ai_not_configured') return json(503, { error: 'ai_not_configured' });
      return json(502, { error: 'generation_failed' });
    }
    console.error('[ai-event-designer] internal error', err);
    return json(500, { error: 'internal' });
  }
});
