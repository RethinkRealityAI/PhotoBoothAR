/**
 * ai-event-designer — the Event Concierge (/host/new), the Platform Copilot
 * (floating panel across /host/**), AND the Studio AI Scene Director: one
 * rate-limited brain, several modes.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { mode?: 'create' (default) | 'copilot' | 'scene',
 *     messages: { role: 'user' | 'assistant', content: string }[]   (1–20 turns)
 *     templates?: { id: string, vibe: string }[]   (create mode, ≤10 — the
 *       client's live template catalog; falls back to built-ins when invalid)
 *     context?: string ≤8k chars    (copilot mode — the client-built event
 *       snapshot, preformatted by src/lib/eventSnapshot.ts)
 *     docs?: string ≤12k chars      (copilot mode — the client's platform
 *       guide digest; falls back to a one-liner)
 *     shaderCatalog?: { id, params?: {key,min,max,default}[] }[]  (scene mode)
 *     headPieceIds?: string[] }      (scene mode — built-in head-piece ids)
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
 * 200 copilot → { reply, actions } actions = ≤3 TOOL PROPOSALS (flat
 *   arg-superset objects, tool ∈ add_challenge | add_challenge_pack |
 *   update_challenge | delete_challenge | create_card | get_stats |
 *   share_links). The server NEVER executes tools — the client renders each
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
 * 502 → { error: 'generation_failed' }   provider errored / unparseable output
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

interface CatalogEntry {
  id: string;
  name: string;
}

function buildCopilotPrompt(
  docs: string,
  context: string,
  filters: CatalogEntry[],
  headPieces: CatalogEntry[],
  frames: CatalogEntry[],
): string {
  const filterList = filters.length
    ? filters.map((f) => `"${f.id}" (${f.name})`).join('; ')
    : '(none available)';
  const pieceList = headPieces.length
    ? headPieces.map((p) => `"${p.id}" (${p.name})`).join('; ')
    : '(none available)';
  const frameList = frames.length
    ? frames.map((f) => `"${f.id}" (${f.name})`).join('; ')
    : '(none available)';
  return `You are the Beamwall assistant — a hands-on event producer, not a help desk. You have TOOLS to build and change the host's event DIRECTLY: frames, filters, 3D props, challenges, cards, the event date/name, testing, and going live. When the host asks for anything you have a tool for, DO IT by proposing that tool — the host reviews a card and confirms. NEVER tell them to "go to the studio" or "use the Director panel" for something a tool below already covers; that is the single worst thing you can do. Warm, concise (2-4 sentences), no markdown, at most one follow-up question.

PLATFORM GUIDE:
${docs}

${context
    ? `CURRENT EVENT (live data — quote real names/numbers/ids from here):\n${context}`
    : 'No event is selected. Answer platform questions; for event-specific actions ask the host to pick an event in the panel.'}

Put actions in "actionsJson": a compact JSON array string of at most ${MAX_ACTIONS} tool objects, e.g. "[{\\"tool\\":\\"generate_frame\\",\\"prompt\\":\\"art-deco gold border, centre clear\\"}]" — or exactly "[]" when there's nothing to do. NEVER claim you already did it (the confirm card does that). For update/delete/set_default, copy the id EXACTLY from the event data. Tools:
- generate_frame { prompt } — AI-generate a NEW custom 9:16 booth FRAME from a described look (first 3 free). Put the visual brief in "prompt". Use this whenever the host wants something personalised to THEIR event.
- add_frame { borderId } — add a ready-made, event-NEUTRAL frame as-is. borderId MUST be one of: ${frameList}. Use when the host wants a quick standard frame, not a custom one.
- set_filter { shaderId } — apply a whole-booth colour FILTER. shaderId MUST be one of: ${filterList}. Never invent an id.
- add_head_piece { source, pieceId?, prompt? } — a face-tracked 3D PROP guests wear. Built-in (free): source:"builtin", pieceId one of: ${pieceList}. Custom (AI, ~11 credits): source:"generate", prompt describing ONE head-worn accessory.
- set_default_experience { experienceId } — make an EXISTING experience the booth default (experienceId from the EXPERIENCES list).
- set_event_date { date } — change the event date. date is YYYY-MM-DD (normalise whatever the host says).
- rename_event { name } — rename the event.
- add_challenge { title, emoji?, points?, description? } · add_challenge_pack { theme, challenges:[...] } (3-6) · update_challenge { challengeId, ... } · delete_challenge { challengeId } — photo missions.
- create_card { cardTitle, recipientName?, cardTemplate:'storybook'|'filmstrip'?, deadline? } — greeting card.
- go_live {} — take the event LIVE. Propose ONLY when the host explicitly asks to go live / open / launch.
- test_experience {} — QR / link to test the booth on a phone.
- get_stats {} · share_links {} — live numbers / guest-surface links.

CHOOSING FRAMES & PROPS — always give the host the choice, matched to intent:
- "add / recommend a frame" → offer BOTH: generate a custom one (generate_frame) AND/OR a ready-made (add_frame). If they describe a look or want it personalised → generate_frame. If they just want something quick/standard → add_frame.
- "make one like <a built-in>" or "use <X> as a template/base" → generate_frame with a prompt that describes THAT style, re-themed for this event (the built-ins carry other events' names/text, so a personalised generate is usually better than adding them as-is).
- Same logic for 3D props: built-in (add_head_piece source:builtin) for speed, source:"generate" for custom or "like <X>".
- You may propose up to ${MAX_ACTIONS} at once (e.g. a frame AND a filter) when the host asks for a coordinated look.

EXTRACTING ARGUMENTS — never dump the host's whole sentence into one field:
- title/cardTitle: a short punchy NAME you write (2-6 words). description: the guest instruction as a full sentence. points/deadline: only if the host stated them.
- If a request is genuinely AMBIGUOUS, propose NOTHING ("[]") and ask ONE short clarifying question instead.
Only for something you truly have NO tool for (fine 3D placement, billing, branding uploads) do you briefly point to the right studio tab. Otherwise, act. Never invent event data.`;
}

/**
 * IMPORTANT: actions ride inside a JSON-encoded STRING field, not a schema
 * ARRAY. Verified live (2026-07-07): any ARRAY-of-OBJECT in responseSchema
 * makes gemini-2.5-flash constrained decoding HANG indefinitely (the fn then
 * times out as a 502), while {reply, actionsJson STRING} answers in ~2s.
 * The client-side normalizer treats the parsed JSON as untrusted anyway.
 */
function buildCopilotSchema() {
  return {
    type: 'OBJECT',
    properties: {
      reply: { type: 'STRING' },
      actionsJson: { type: 'STRING' },
    },
    required: ['reply', 'actionsJson'],
  };
}

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

interface SceneShaderEntry {
  id: string;
  params?: { key: string; min: number; max: number; default: number }[];
}

function buildScenePrompt(shaders: SceneShaderEntry[], headPieceIds: string[]): string {
  const shaderList = shaders
    .map((s) => {
      const params = (s.params ?? []).map((p) => `${p.key} ${p.min}..${p.max}`).join(', ');
      return `- ${s.id}${params ? ` (params: ${params})` : ''}`;
    })
    .join('\n') || '- (none available)';
  const pieceList = headPieceIds.map((id) => `- ${id}`).join('\n') || '- (none available)';
  return `You are the Beamwall Scene Director — a skilled immersive-assets creator working at the host's side, like a talented colleague. You design coordinated photo-booth "scenes": a decorative frame, a camera filter, and a 3D head piece that read as one look. Be warm, expert, and concise — NOT chatty. Give concrete, specific help; never generic filler.

Always fill "reply" (no markdown; at most 3 sentences — unless you are listing concrete suggestions, where a short list is fine):
- If the host is ASKING for advice or thinking out loud (e.g. "what colours suit a gala?", "what vibe for a 40th?"), give a real, specific recommendation — name actual colours, motifs, or materials — plus at most one short question to move forward. Do NOT build a scene yet: set "planJson" to an empty string "".
- If the host DESCRIBES a look, occasion, or vibe to build (or greenlights an idea you proposed), design the scene AND return it in "planJson".

"planJson" (ONLY when you are designing a scene) is a JSON STRING (not an object) with EXACTLY this shape:
{"sceneName":"2-4 word name","frame":{"prompt":"<detailed prompt for a 9:16 decorative BORDER that frames a portrait, transparent centre>"} or null,"shader":{"shaderId":"<one id from FILTER EFFECTS>","params":{<only that shader's params, each within its range>}} or null,"headPiece":{"kind":"procedural","id":"<one id from HEAD PIECES>"} or {"kind":"generate","prompt":"<text-to-3D prompt for a single head-worn accessory>"} or null}

RULES (when a plan is present):
- Pick shaderId ONLY from the FILTER EFFECTS list; pick a procedural head-piece id ONLY from the HEAD PIECES list. Never invent an id.
- Use headPiece "generate" ONLY when no listed procedural piece fits the theme.
- Any element that doesn't suit the scene can be null, but include at least ONE non-null element.
- Keep the frame prompt about a border/frame, not a full-scene photo — the guest's face fills the centre.

FILTER EFFECTS:
${shaderList}

HEAD PIECES:
${pieceList}`;
}

/** planJson is OPTIONAL (only 'reply' is required): pure-ideation turns answer
 *  with a reply and no plan. It stays a STRING field — an ARRAY/OBJECT plan
 *  schema hangs gemini-2.5-flash constrained decoding (see buildCopilotSchema). */
function buildSceneSchema() {
  return {
    type: 'OBJECT',
    properties: {
      reply: { type: 'STRING' },
      planJson: { type: 'STRING' },
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
  // Secrets set via the dashboard sometimes arrive wrapped in quotes or with a
  // trailing newline; Google then rejects them as API_KEY_INVALID. Strip both.
  const key = Deno.env.get('GEMINI_API_KEY')?.trim().replace(/^["']|["']$/g, '');
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
    const bodyText = await res.text().catch(() => '');
    console.error('[ai-event-designer] gemini error', res.status, bodyText);
    // A rejected/rotated/missing-billing key fails FAST with 400 API_KEY_INVALID
    // or 401/403 — a CONFIG problem, not a transient generation failure. Report
    // it distinctly so the app can tell the owner the key needs attention
    // instead of a vague "couldn't generate".
    const keyRejected =
      res.status === 401 ||
      res.status === 403 ||
      (res.status === 400 && /API_KEY_INVALID|api key not valid|PERMISSION_DENIED/i.test(bodyText));
    const code = res.status === 429 ? 'ai_quota' : keyRejected ? 'ai_key_invalid' : 'generation_failed';
    throw new AiError(code, `gemini_http_${res.status}`);
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
  constructor(
    public code: 'ai_not_configured' | 'ai_key_invalid' | 'generation_failed' | 'ai_quota',
    detail?: string,
  ) {
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
      // Live filter + head-piece catalogs (client-sent); the client normalizer
      // is the real gate, so an empty/invalid list just narrows the prompt.
      const filters = resolveCatalog(body.filters, 40);
      const headPieces = resolveCatalog(body.headPieces, 24);
      const frames = resolveCatalog(body.frames, 20);
      const parsed = await callGemini(messages, buildCopilotPrompt(docs, context, filters, headPieces, frames), buildCopilotSchema());
      let actions: unknown[] = [];
      try {
        const decoded = JSON.parse(typeof parsed.actionsJson === 'string' ? parsed.actionsJson : '[]');
        if (Array.isArray(decoded)) actions = decoded.slice(0, MAX_ACTIONS);
      } catch { /* malformed actionsJson → no actions; reply still ships */ }
      return json(200, { reply: parsed.reply, actions });
    }

    // 3a-scene. Scene Director — one coordinated frame + filter + 3D piece.
    if (body.mode === 'scene') {
      const shaders = Array.isArray(body.shaderCatalog)
        ? (body.shaderCatalog as SceneShaderEntry[]).filter((s) => s && typeof s.id === 'string').slice(0, 40)
        : [];
      const pieceIds = Array.isArray(body.headPieceIds)
        ? (body.headPieceIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 24)
        : [];
      const parsed = await callGemini(messages, buildScenePrompt(shaders, pieceIds), buildSceneSchema());
      return json(200, { reply: parsed.reply, planJson: typeof parsed.planJson === 'string' ? parsed.planJson : '' });
    }

    // 3b. Create mode — against the client's live template catalog.
    const templates = resolveTemplates(body.templates);
    const parsed = await callGemini(messages, buildSystemPrompt(templates), buildResponseSchema(templates));
    return json(200, { reply: parsed.reply, plan: parsed.plan ?? null });
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
