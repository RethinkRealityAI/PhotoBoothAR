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
import { EVENT_TEMPLATES, templateById, type TemplateId } from './eventTemplates';
import { A2UI_VERSION, BASIC_CATALOG_ID, type A2uiMessage } from './a2ui';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Everything the concierge can fill in. Nulls mean "not decided yet". */
export interface EventPlan {
  name: string | null;
  templateId: TemplateId;
  remote: boolean;
  /** YYYY-MM-DD or null. */
  date: string | null;
  slug: string | null;
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

export function extractName(text: string, templateId: TemplateId | null): string | null {
  // Real quote marks only — a straight apostrophe also appears in "It's" and
  // "Jake's", where treating it as a quote captured garbage between two
  // unrelated apostrophes.
  const quoted = text.match(/["“”]([^"“”]{3,60})["“”]/);
  if (quoted) return quoted[1].trim();
  // No /i flag: the leading [A-Z] must stay a real capital ("my sister's
  // birthday" is not a name); occasion words tolerate either case inline.
  const owned = text.match(
    /\b([A-Z][A-Za-z'’-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'’-]+)?)['’]s\s+(?:\d{1,3}(?:st|nd|rd|th)\s+)?([Ww]edding|[Bb]irthday|[Gg]ala|[Bb]ash|[Pp]arty|[Cc]elebration|[Aa]nniversary|[Gg]raduation|[Qq]uincea\w*)\b/,
  );
  if (owned) {
    const person = owned[1].replace(/\s+and\s+/, ' & ');
    const occasion = owned[2][0].toUpperCase() + owned[2].slice(1).toLowerCase();
    return `${person}'s ${occasion}`;
  }
  const who = text.match(
    /\b(?:for|celebrating)\s+(?:my\s+)?([A-Z][A-Za-z'’-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'’-]+)?)/,
  );
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

export function detectRemote(text: string): boolean {
  return /\b(remote|virtual|online|zoom|livestream|live[- ]stream|long[- ]distance|can'?t\s+(attend|be\s+there)|far\s+away|overseas)\b/i.test(text);
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
  for (const text of userTexts) {
    templateId = inferTemplate(text) ?? templateId;
    date = extractDate(text) ?? date;
    if (detectRemote(text)) remote = true;
  }
  // Name needs the final template for its label, so resolve it second.
  for (const text of userTexts) {
    name = extractName(text, templateId) ?? name;
  }

  const tpl = templateById(templateId ?? undefined) ?? EVENT_TEMPLATES.find((t) => t.id === 'party')!;
  const plan: EventPlan = {
    name,
    templateId: tpl.id,
    remote,
    date,
    slug: name ? slugify(name) : null,
  };

  const bits: string[] = [];
  bits.push(`I set you up with the ${tpl.emoji} ${tpl.label} look — ${tpl.blurb.toLowerCase()}`);
  if (name) bits.push(`I'm calling it “${name}”.`);
  if (date) bits.push(`Date noted: ${date}.`);
  if (remote) bits.push('Since guests join from afar, I flagged it as a remote celebration.');
  bits.push(
    name
      ? 'Review everything on the right — tweak anything, then create your event!'
      : 'What should we call the event? You can also just type a name in the form.',
  );
  return { reply: bits.join(' '), plan, decided: { template: templateId !== null, remote } };
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
  return {
    name,
    templateId,
    remote: r.remote === true,
    date,
    slug: slugRaw ? slugify(slugRaw) : null,
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
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: BASIC_CATALOG_ID } },
    {
      version: A2UI_VERSION,
      updateDataModel: { surfaceId, path: '/', value: { plan: { ...plan } } },
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
            children: ['heading', 'nameField', 'styleChoice', 'dateField', 'remoteCheck', 'slugField', 'divider', 'actions'],
          },
          { id: 'heading', component: 'Text', text: 'Your event, so far', variant: 'h4' },
          { id: 'nameField', component: 'TextField', label: 'Event name', value: { path: '/plan/name' } },
          { id: 'styleChoice', component: 'ChoicePicker', label: 'Style', options: styleOptions, value: { path: '/plan/templateId' } },
          { id: 'dateField', component: 'DateTimeInput', label: 'Date', enableDate: true, enableTime: false, value: { path: '/plan/date' } },
          { id: 'remoteCheck', component: 'CheckBox', label: 'Remote / virtual celebration', value: { path: '/plan/remote' } },
          { id: 'slugField', component: 'TextField', label: 'Guest link (/e/…)', value: { path: '/plan/slug' } },
          { id: 'divider', component: 'Divider', axis: 'horizontal' },
          { id: 'actions', component: 'Row', justify: 'end', children: ['confirmBtn'] },
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

export async function designEvent(messages: ChatMessage[]): Promise<DesignResult> {
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
  const localFallback = (): DesignResult => {
    const local = localDesign(messages);
    return withUi(local.reply, local.plan, 'local', local.decided);
  };

  try {
    // Lazy import: creating the supabase client needs VITE_ env vars, which the
    // node test env doesn't have — the planner half of this module stays pure.
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.functions.invoke('ai-event-designer', {
      body: { messages },
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          console.warn('[eventDesigner] edge fn error, using local planner:', res.error);
        } catch { /* body unreadable — fall through to local */ }
      }
      return localFallback();
    }
    const res = (data ?? {}) as { reply?: string; plan?: unknown; a2ui?: unknown };
    if (typeof res.reply !== 'string' || !res.reply) {
      return localFallback();
    }
    // The AI sees the whole conversation and always takes a position on
    // template + remote, so both count as decided.
    return withUi(res.reply, normalizePlan(res.plan), 'ai', { template: true, remote: true }, res.a2ui);
  } catch (e) {
    console.warn('[eventDesigner] designEvent failed, using local planner', e);
    return localFallback();
  }
}
