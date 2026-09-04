/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Event Concierge — turns "it's my mum's 60th birthday in March" into a
 * ready-to-create event plan (name, template look, link, date, remote mode).
 *
 * Two brains, one contract:
 *   • `designEvent()` calls the ai-event-designer edge function (Gemini,
 *     server-side key — same pattern as ai.ts).
 *   • When AI is unreachable or unprovisioned it falls back to `localDesign()`,
 *     a pure keyword planner, so the conversational flow ALWAYS works.
 *
 * The plan's fields mirror the New Event wizard state exactly — the chat and
 * the manual wizard drive the same knobs, so hosts can mix both freely.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { slugify } from './slug';
import { ACCENT_SWATCHES, EVENT_TEMPLATES, templateById, type TemplateId } from './eventTemplates';
import { A2UI_VERSION, BEAMWALL_CATALOG_ID, type A2uiMessage } from './a2ui';
import { EMPTY_BRIEF, briefFromPlanRaw, isEmptyBrief, normalizeBrief, type EventBrief } from './eventBrief';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/* ── Wire-turn window (shared by the concierge and the copilot) ─────────
 * ai-event-designer rejects more than 20 turns (index.ts MAX_TURNS) with
 * 400 invalid_body, and both chats persist their transcript — so a long
 * thread used to go permanently "offline". 16 leaves headroom under the
 * server cap. Runs AFTER any merge/empty-drop step (copilot.mergeWireTurns)
 * and after the concierge strips its localOnly nudges. */
export const MAX_WIRE_TURNS = 16;

/**
 * Keep the LAST `MAX_WIRE_TURNS` turns, then drop leading turns until the
 * first is a user turn: Gemini needs strict user/model alternation starting
 * with the user, and tool-result turns are user turns, so cutting on a user
 * boundary keeps alternation intact. The last turn is never touched (the
 * caller always appends the host's latest message last). Returns a copy;
 * a short transcript comes back with identical content.
 */
export function trimWireTurns(turns: ChatMessage[]): ChatMessage[] {
  const out = turns.length > MAX_WIRE_TURNS ? turns.slice(turns.length - MAX_WIRE_TURNS) : turns.slice();
  while (out.length > 0 && out[0].role !== 'user') out.shift();
  return out;
}

/**
 * Fire-and-forget telemetry for an AI-module failure. errorReport imports the
 * supabase client statically, so it is loaded lazily here — the pure planner
 * half of this module (and every node test) never reaches it. Never throws,
 * never rejects: telemetry is not load-bearing.
 */
export function reportAiError(tag: string, err: unknown, context: Record<string, unknown> = {}): void {
  try {
    void import('./errorReport').then(
      ({ reportError }) => reportError(err, { tag, ...context }),
      () => {},
    );
  } catch {
    /* telemetry must never break the caller */
  }
}

/** Everything the concierge can fill in. Nulls mean "not decided yet". */
export interface EventPlan {
  name: string | null;
  templateId: TemplateId;
  remote: boolean;
  /** YYYY-MM-DD or null. */
  date: string | null;
  slug: string | null;
  /** '#RRGGBB' accent override for the template look, or null (client-side
   *  concierge choice — the AI never sets this). */
  accent: string | null;
  /** What the host said about who/mood/colours/avoid (eventBrief.ts), or
   *  null. Opaque to the wizard; written to events.config.brief on create. */
  brief: EventBrief | null;
}

export interface DesignResult {
  reply: string;
  plan: EventPlan;
  /** A2UI v0.9.1 message stream rendering the plan as an interactive card.
   *  Server-streamed when the edge fn provides one; built locally otherwise. */
  a2ui: A2uiMessage[];
  /** Id of the surface the a2ui stream creates (chat renders it inline). */
  surfaceId: string;
  /** 'ai' when the edge function answered; 'local' for the keyword fallback. */
  source: 'ai' | 'local';
  /**
   * Why the AI path failed, when `source` is 'local' because of a failure:
   * the edge fn's error code ('ai_key_invalid' | 'rate_limited' | 'ai_quota' |
   * 'invalid_body' | …), 'network' when the call never got an HTTP answer,
   * 'empty_reply' when it answered with nothing usable. Absent on the AI path.
   * The page renders per-code copy from it (copilot.offlineReplyFor).
   */
  reason?: string;
  /** Which plan fields the planner actively decided this turn. Undecided
   *  fields must not overwrite what the host set by hand (the local keyword
   *  planner defaults templateId/remote when it finds no signal). */
  decided: { template: boolean; remote: boolean };
}

/* ── Local fallback planner (pure — unit-tested) ─────────────────────── */

const TEMPLATE_KEYWORDS: Record<TemplateId, RegExp> = {
  wedding: /\b(wedding|marriage|married|bride|groom|engagement|engaged|anniversary|vows|nikah|reception)\b/i,
  gala: /\b(gala|fundraiser|charity|black[ -]?tie|awards?|benefit|ball|banquet)\b/i,
  birthday: /\b(birthday|b[- ]?day|turns?\s+\d{1,3}|sweet\s*16|quincea|(\d{1,3})(st|nd|rd|th)\s+(birthday|bash))\b/i,
  corporate: /\b(corporate|company|conference|summit|product\s+launch|offsite|town\s*hall|team\s+(event|building)|networking|expo)\b/i,
  party: /\b(party|club|dance|neon|rave|new\s+year|nye|celebration|fiesta|house\s*warming|housewarming|graduation|prom)\b/i,
};

/** Scan order matters: specific occasions beat the generic "party" (a
 *  "birthday party" is a birthday). Returns null when nothing matches. */
export function inferTemplate(text: string): TemplateId | null {
  const order: TemplateId[] = ['wedding', 'gala', 'birthday', 'corporate', 'party'];
  for (const id of order) {
    if (TEMPLATE_KEYWORDS[id].test(text)) return id;
  }
  return null;
}

/** A quoted "Event Name", a "Jenna and Jake's wedding" possessive, or a
 *  "for Jenna and Jake" mention built into a name with the occasion label.
 *  Null when none is present. */
/** Capitalized non-person words that follow "for/celebrating" in prose —
 *  holidays and seasons must not become possessive event names. */
const NON_PERSON_WORDS =
  /^(Christmas|Easter|Halloween|Thanksgiving|New|Eid|Diwali|Hanukkah|Valentine|Ramadan|Summer|Winter|Spring|Autumn)$/;

// No /i flag: the leading [A-Z] must stay a real capital ("my sister's
// birthday" is not a name); occasion words tolerate either case inline.
const OWNED_RE =
  /\b([A-Z][A-Za-z'’-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'’-]+)?)['’]s\s+(?:\d{1,3}(?:st|nd|rd|th)\s+)?([Ww]edding|[Bb]irthday|[Gg]ala|[Bb]ash|[Pp]arty|[Cc]elebration|[Aa]nniversary|[Gg]raduation|[Qq]uincea\w*)\b/;
const WHO_RE =
  /\b(?:for|celebrating|named|called)\s+(?:my\s+|someone\s+named\s+)?([A-Z][A-Za-z'’-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'’-]+)?)/;

export function extractName(text: string, templateId: TemplateId | null): string | null {
  // Real quote marks only — a straight apostrophe also appears in "It's" and
  // "Jake's", where treating it as a quote captured garbage between two
  // unrelated apostrophes.
  const quoted = text.match(/["“”]([^"“”]{3,60})["“”]/);
  if (quoted) return quoted[1].trim();
  const owned = text.match(OWNED_RE);
  if (owned) {
    const person = owned[1].replace(/\s+and\s+/, ' & ');
    const occasion = owned[2][0].toUpperCase() + owned[2].slice(1).toLowerCase();
    return `${person}'s ${occasion}`;
  }
  const who = text.match(WHO_RE);
  if (who && !NON_PERSON_WORDS.test(who[1])) {
    const label = templateById(templateId ?? undefined)?.label ?? 'Celebration';
    const person = who[1].replace(/\s+and\s+/, ' & ');
    const possessive = person.endsWith('s') ? `${person}'` : `${person}'s`;
    return `${possessive} ${label}`;
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** ISO (2026-09-12) or "September 12, 2026" / "12 September 2026" → YYYY-MM-DD.
 *  Built by string assembly — never `new Date(str)` (UTC-vs-local day shifts). */
export function extractDate(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return iso[0];
    return null;
  }
  const monthName =
    text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/) ??
    text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (monthName) {
    // First form captures (month, day, year); second (day, month, year).
    const monthFirst = /^[A-Za-z]/.test(monthName[1]);
    const monthTok = (monthFirst ? monthName[1] : monthName[2]).slice(0, 3).toLowerCase();
    const day = Number(monthFirst ? monthName[2] : monthName[1]);
    const year = Number(monthName[3]);
    const month = MONTHS[monthTok];
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

/**
 * Natural-language date → YYYY-MM-DD, or null. The copilot normalizer runs
 * this on `set_event_date.date` / `create_card.deadline` AFTER the strict ISO
 * check, so "July 12 2026" lands instead of being dropped. Same parser as the
 * local keyword planner (extractDate) — one behaviour, two entry points.
 */
export function parseNaturalDate(text: string): string | null {
  return extractDate(text);
}

export function detectRemote(text: string): boolean {
  return /\b(remote|virtual|online|zoom|livestream|live[- ]stream|long[- ]distance|can'?t\s+(attend|be\s+there)|far\s+away|overseas)\b/i.test(text);
}

/** "You decide" — the host hands every open choice to the concierge. */
export function detectDeferral(text: string): boolean {
  return /\b(you\s+(decide|choose|pick)|(just\s+)?set\s+it\s+(all\s+)?up(\s+for\s+me)?|surprise\s+me|whatever\s+you\s+think|i\s+don'?t\s+mind|up\s+to\s+you|your\s+call|dealer'?s\s+choice|do\s+it\s+all\s+for\s+me|you\s+take\s+it\s+from\s+here)\b/i.test(text);
}

/* ── Local brief extraction (keyword-level; the AI path does this properly) ── */

const COLOUR_RE = /\b(rose gold|gold|golden|navy|blush|pink|emerald|green|black|white|silver|red|purple|blue|teal|coral|lavender|burgundy|champagne|orange|yellow|ivory|cream)\b/gi;
const TONE_RE = /\b(elegant|classy|playful|fun|loud|wild|warm|cosy|cozy|romantic|minimal|modern|vintage|retro|glam|glamorous|intimate|relaxed|chill|bold|festive|sophisticated|cheeky)\b/gi;
/** "no balloons", "avoid puns", "without confetti" → the thing to avoid. */
const AVOID_RE = /\b(?:no|avoid|without|don'?t want(?: any)?)\s+([a-z][a-z -]{2,30}?)(?=\s*[,.;!?]|\s+(?:and|or|please|though|but)\b|$)/gi;

/** Palette words → an accent hex for fillPlanGaps (first match wins). */
const PALETTE_HEX: [RegExp, string][] = [
  [/rose gold/i, '#B76E79'], [/\bgold(en)?\b/i, '#D4AF37'], [/\bnavy\b/i, '#1F3A5F'], [/\bblush\b|\bpink\b/i, '#F4A6C1'],
  [/\bemerald\b|\bgreen\b/i, '#2E8B57'], [/\bsilver\b/i, '#C0C0C0'], [/\bred\b|\bburgundy\b/i, '#B0223B'],
  [/\bpurple\b|\blavender\b/i, '#7A2BFF'], [/\bblue\b|\bteal\b/i, '#2E6DF6'], [/\bcoral\b|\borange\b/i, '#FF6F61'],
  [/\bchampagne\b|\bcream\b|\bivory\b/i, '#E8D9B5'], [/\byellow\b/i, '#FFD166'],
];

function uniqueMatches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const w = m[1].toLowerCase();
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** The brief the keyword planner can see: occasion from the template match
 *  (with a stated ordinal), honorees from the name patterns, palette/tone
 *  words, and "no X" items. Null when nothing was said. */
export function localBrief(userTexts: string[], templateId: TemplateId | null): EventBrief | null {
  const all = userTexts.join('\n');
  const ordinal = all.match(/\b(\d{1,3})(?:st|nd|rd|th)\b/);
  const occasionWord = templateId ? all.match(TEMPLATE_KEYWORDS[templateId])?.[0]?.toLowerCase() ?? null : null;
  const occasion = occasionWord
    ? (ordinal && templateId === 'birthday' && !occasionWord.includes(ordinal[0]) ? `${ordinal[0]} ${occasionWord}` : occasionWord)
    : '';
  const honorees: string[] = [];
  for (const text of userTexts) {
    const person = text.match(OWNED_RE)?.[1] ?? text.match(WHO_RE)?.[1];
    if (person && !NON_PERSON_WORDS.test(person)) honorees.push(...person.split(/\s+(?:and|&)\s+/));
  }
  const brief = normalizeBrief({
    occasion,
    honorees,
    palette: uniqueMatches(all, COLOUR_RE).join(' and '),
    tone: uniqueMatches(all, TONE_RE).join(', '),
    avoid: uniqueMatches(all, AVOID_RE),
  });
  return isEmptyBrief(brief) ? null : brief;
}

/** Palette text → '#RRGGBB': an explicit hex wins, then the colour the host
 *  MENTIONED FIRST ("navy and gold" → navy), whatever the table order. */
export function accentFromPalette(palette: string): string | null {
  const hex = palette.match(/#[0-9a-fA-F]{6}\b/);
  if (hex) return hex[0].toUpperCase();
  let best: { at: number; value: string } | null = null;
  for (const [re, value] of PALETTE_HEX) {
    const m = re.exec(palette);
    if (m && (best === null || m.index < best.at)) best = { at: m.index, value };
  }
  return best?.value ?? null;
}

function possessive(who: string): string {
  return who.endsWith('s') ? `${who}'` : `${who}'s`;
}

/**
 * "Set it all up for me": decide every still-open field from the brief so
 * the plan is creatable in one press. Name from the honorees + the template
 * label (else "Our Celebration"), template from the occasion, accent from the
 * palette, slug from the name; the date stays as it is (never invented).
 * Pure — the AI path's deferral rule and the concierge's button share it.
 */
export function fillPlanGaps(plan: EventPlan, brief: EventBrief | null): EventPlan {
  const b = brief ?? EMPTY_BRIEF;
  const templateId = (b.occasion ? inferTemplate(b.occasion) : null) ?? plan.templateId;
  const label = templateById(templateId)?.label ?? 'Celebration';
  const name = plan.name ?? (b.honorees.length > 0 ? `${possessive(b.honorees.join(' & '))} ${label}` : 'Our Celebration');
  return {
    ...plan,
    name,
    templateId,
    slug: plan.slug ?? slugify(name),
    accent: plan.accent ?? accentFromPalette(b.palette),
    brief: brief ?? plan.brief,
  };
}

/**
 * Keyword planner over the whole conversation. Later user messages win, so
 * "actually make it a gala" flips the template mid-chat. Always returns a
 * usable plan (template defaults to 'party') plus a friendly reply that asks
 * for whatever is still missing.
 */
export function localDesign(
  messages: ChatMessage[],
): { reply: string; plan: EventPlan; decided: { template: boolean; remote: boolean } } {
  const userTexts = messages.filter((m) => m.role === 'user').map((m) => m.content);
  let templateId: TemplateId | null = null;
  let name: string | null = null;
  let date: string | null = null;
  let remote = false;
  let deferred = false;
  for (const text of userTexts) {
    templateId = inferTemplate(text) ?? templateId;
    date = extractDate(text) ?? date;
    if (detectRemote(text)) remote = true;
    if (detectDeferral(text)) deferred = true;
  }
  // Name needs the final template for its label, so resolve it second.
  for (const text of userTexts) {
    name = extractName(text, templateId) ?? name;
  }
  const brief = localBrief(userTexts, templateId);

  const tpl = templateById(templateId ?? undefined) ?? EVENT_TEMPLATES.find((t) => t.id === 'party')!;
  let plan: EventPlan = {
    name,
    templateId: tpl.id,
    remote,
    date,
    slug: name ? slugify(name) : null,
    accent: null,
    brief,
  };
  // "You decide": fill every open field and ask nothing.
  if (deferred) plan = fillPlanGaps(plan, brief);
  const finalTpl = templateById(plan.templateId) ?? tpl;

  const bits: string[] = [];
  bits.push(`I set you up with the ${finalTpl.emoji} ${finalTpl.label} look — ${finalTpl.blurb.toLowerCase()}`);
  if (plan.name) bits.push(deferred && !name ? `I went with “${plan.name}” as the name.` : `I'm calling it “${plan.name}”.`);
  if (date) bits.push(`Date noted: ${date}.`);
  if (remote) bits.push('Since guests join from afar, I flagged it as a remote celebration.');
  bits.push(
    deferred
      ? 'Everything is filled in — hit Create, or tweak any detail on the right first.'
      : plan.name
        ? 'Review everything on the right — tweak anything, then create your event!'
        : 'What should we call the event? You can also just type a name in the form.',
  );
  return { reply: bits.join(' '), plan, decided: { template: templateId !== null || deferred, remote } };
}

/* ── Plan hygiene (shared by AI + local paths) ───────────────────────── */

/** Coerce whatever came back (AI is probabilistic) into a safe EventPlan. */
export function normalizePlan(raw: unknown): EventPlan {
  const r = (raw ?? {}) as Record<string, unknown>;
  const templateId = templateById(typeof r.templateId === 'string' ? r.templateId : undefined)?.id ?? 'party';
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 80) : null;
  const dateRaw = typeof r.date === 'string' ? r.date : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  const slugRaw = typeof r.slug === 'string' && r.slug.trim() ? r.slug : name;
  const accentRaw = typeof r.accent === 'string' ? r.accent.trim() : '';
  return {
    name,
    templateId,
    remote: r.remote === true,
    date,
    slug: slugRaw ? slugify(slugRaw) : null,
    accent: /^#[0-9a-fA-F]{6}$/.test(accentRaw) ? accentRaw : null,
    brief: briefFromPlanRaw(r.brief),
  };
}

/* ── A2UI plan surface (generative UI) ───────────────────────────────── */

/**
 * Render an EventPlan as an A2UI v0.9.1 message stream: an interactive
 * plan-editor card (name / style / date / remote / link, all two-way bound to
 * the surface data model) with a confirm action that hands the edited plan
 * back to the wizard. Built deterministically from the plan — the same stream
 * shape the edge fn may stream directly in future, so the client pipeline
 * (reducer + renderer) needs no change when that lands.
 */
export function buildPlanSurface(plan: EventPlan, surfaceId: string): A2uiMessage[] {
  const styleOptions = EVENT_TEMPLATES.map((t) => ({ label: `${t.emoji} ${t.label}`, value: t.id }));
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: BEAMWALL_CATALOG_ID } },
    {
      version: A2UI_VERSION,
      // `seedPack` rides in the plan model (default ON — the grandparent who
      // wants it all done is the point; the manager unticks it). The wizard
      // reads it beside the plan; normalizePlan ignores the extra key.
      updateDataModel: { surfaceId, path: '/', value: { plan: { ...plan, seedPack: true } } },
    },
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          {
            id: 'body',
            component: 'Column',
            children: ['heading', 'preview', 'nameField', 'styleChoice', 'accentChoice', 'dateField', 'remoteCheck', 'slugField', 'packCheck', 'divider', 'actions'],
          },
          { id: 'heading', component: 'Text', text: 'Your event, so far', variant: 'h4' },
          // Beamwall custom widget: live look preview bound to the SAME data
          // the fields edit — the card always shows what confirm will apply.
          {
            id: 'preview',
            component: 'TemplatePreview',
            templateId: { path: '/plan/templateId' },
            eventName: { path: '/plan/name' },
            accent: { path: '/plan/accent' },
          },
          {
            id: 'accentChoice',
            component: 'ColorChoice',
            label: 'Accent colour',
            options: [...ACCENT_SWATCHES],
            value: { path: '/plan/accent' },
          },
          { id: 'nameField', component: 'TextField', label: 'Event name', value: { path: '/plan/name' } },
          { id: 'styleChoice', component: 'ChoicePicker', label: 'Style', options: styleOptions, value: { path: '/plan/templateId' } },
          { id: 'dateField', component: 'DateTimeInput', label: 'Date', enableDate: true, enableTime: false, value: { path: '/plan/date' } },
          { id: 'remoteCheck', component: 'CheckBox', label: 'Remote / virtual celebration', value: { path: '/plan/remote' } },
          { id: 'slugField', component: 'TextField', label: 'Guest link (/e/…)', value: { path: '/plan/slug' } },
          { id: 'packCheck', component: 'CheckBox', label: 'Start with a challenge pack + a keepsake card', value: { path: '/plan/seedPack' } },
          { id: 'divider', component: 'Divider', axis: 'horizontal' },
          { id: 'actions', component: 'Row', justify: 'end', children: ['allBtn', 'confirmBtn'] },
          // Deferral: the wizard fills every open field (fillPlanGaps), forces
          // the starter pack on, and creates — no further questions.
          {
            id: 'allBtn',
            component: 'Button',
            variant: 'borderless',
            child: 'allLabel',
            action: { event: { name: 'set_it_all_up', context: { plan: { path: '/plan' } } } },
          },
          { id: 'allLabel', component: 'Text', text: 'Set it all up for me' },
          {
            id: 'confirmBtn',
            component: 'Button',
            variant: 'primary',
            child: 'confirmLabel',
            action: { event: { name: 'confirm_plan', context: { plan: { path: '/plan' } } } },
          },
          { id: 'confirmLabel', component: 'Text', text: 'Use this plan' },
        ],
      },
    },
  ];
}

/** The surface id an A2UI stream creates, if any. */
export function surfaceIdOf(messages: A2uiMessage[]): string | null {
  for (const m of messages) {
    if (m.createSurface?.surfaceId) return m.createSurface.surfaceId;
  }
  return null;
}

/* ── Edge-function client with local fallback ────────────────────────── */

/** An optional host photo (invitation / mood board / venue) for Gemini vision
 *  to seed the plan from. See src/lib/imageInput.ts. */
export interface DesignImage {
  data: string;
  mimeType: string;
}

export async function designEvent(messages: ChatMessage[], image?: DesignImage): Promise<DesignResult> {
  // One surface per conversation turn, so the chat history keeps every card.
  const sid = `plan_${messages.length}`;
  const withUi = (
    reply: string,
    plan: EventPlan,
    source: 'ai' | 'local',
    decided: DesignResult['decided'],
    serverUi?: unknown,
  ): DesignResult => {
    const streamed = Array.isArray(serverUi)
      ? (serverUi.filter((m) => m && typeof m === 'object') as A2uiMessage[])
      : [];
    const a2ui = streamed.length > 0 ? streamed : buildPlanSurface(plan, sid);
    return { reply, plan, a2ui, surfaceId: surfaceIdOf(a2ui) ?? sid, source, decided };
  };
  const localFallback = (reason: string): DesignResult => {
    const local = localDesign(messages);
    return { ...withUi(local.reply, local.plan, 'local', local.decided), reason };
  };

  try {
    // Lazy import: creating the supabase client needs VITE_ env vars, which the
    // node test env doesn't have — the planner half of this module stays pure.
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.functions.invoke('ai-event-designer', {
      body: {
        // Which chat is asking (server picks its prompt variant; older
        // servers ignore the field).
        surface: 'concierge',
        // The concierge shares the server's turn cap with the copilot.
        messages: trimWireTurns(messages),
        // The live template catalog rides along so the agent's prompt/schema
        // can never drift from the app's real templates (edge fn validates
        // and falls back to its built-in list).
        templates: EVENT_TEMPLATES.map((t) => ({ id: t.id, vibe: `${t.label} — ${t.blurb}` })),
        // A host photo (invitation / mood board / venue) → Gemini vision seeds
        // the plan. Omitted → byte-identical to the text-only request.
        ...(image ? { image } : {}),
      },
    });
    if (error) {
      // Same extraction as copilot.askCopilot: a non-2xx answer carries the
      // fn's error code in its JSON body; anything else never reached HTTP.
      let reason = 'network';
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          if (typeof res.error === 'string' && res.error) reason = res.error;
        } catch { /* body unreadable — keep the transport-level reason */ }
        console.warn('[eventDesigner] edge fn error, using local planner:', reason);
      }
      reportAiError(`ai_event_designer:create:${reason}`, error, { reason });
      return localFallback(reason);
    }
    const res = (data ?? {}) as { reply?: string; plan?: unknown; a2ui?: unknown };
    if (typeof res.reply !== 'string' || !res.reply) {
      return localFallback('empty_reply');
    }
    // The AI sees the whole conversation and always takes a position on
    // template + remote, so both count as decided.
    return withUi(res.reply, normalizePlan(res.plan), 'ai', { template: true, remote: true }, res.a2ui);
  } catch (e) {
    console.warn('[eventDesigner] designEvent failed, using local planner', e);
    reportAiError('ai_event_designer:create:network', e, { reason: 'network' });
    return localFallback('network');
  }
}
