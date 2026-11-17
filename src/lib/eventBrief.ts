/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Event brief — the ONE shared memory of "who, what mood, which colours, what
 * to avoid" that the concierge captures at create, the Platform Copilot
 * honours on every turn (it rides inside the event snapshot), the Scene
 * Director reads as one line, and the guest-copy generator writes from.
 * Stored in `events.config.brief` (uuid-keyed jsonb — no migration).
 *
 * PURE: no React, no supabase. Every host-authored string passes through
 * `fenceSafe`, so a brief can never open a new line or forge a fence marker
 * inside the prompt's fenced event block. The module cycle with
 * eventSnapshot (it renders `formatBrief`) is safe: both sides only export
 * hoisted function declarations and call them at request time.
 */
import { fenceSafe } from './eventSnapshot';

export interface EventBrief {
  /** "Maya's 40th", "charity gala", "company summit" — '' when unknown. */
  occasion: string;
  /** Guests of honour, named ONLY by the host — never invented by a model. */
  honorees: string[];
  /** Free text: "gold and navy", "soft blush". */
  palette: string;
  /** Free text: "elegant", "playful and loud". */
  tone: string;
  /** Things the host does not want proposed ("balloons", "puns"). */
  avoid: string[];
  notes: string;
  /** ISO timestamp of the last merge, or null on a brief nobody stamped. */
  updatedAt: string | null;
}

/** Per-field caps, plus the TOTAL (sum of every string after fenceSafe) the
 *  snapshot budget assumes — MAX_SNAPSHOT_CHARS is sized against it. */
export const BRIEF_CAPS = {
  occasion: 80,
  honoree: 40,
  honorees: 6,
  palette: 120,
  tone: 120,
  avoidItem: 40,
  avoid: 8,
  notes: 240,
  total: 600,
} as const;

/** The one-line Scene Director form never exceeds this (client cap 1100 on
 *  sceneContext leaves room for the draft line after it). */
export const SCENE_BRIEF_MAX = 240;

export const EMPTY_BRIEF: EventBrief = {
  occasion: '', honorees: [], palette: '', tone: '', avoid: [], notes: '', updatedAt: null,
};

/** A partial update: absent = unchanged, null or '' = cleared. Lists accept a
 *  delimited string ("Maya, Sam and Ade") because the copilot's confirm card
 *  edits them in a plain text box. */
export type BriefPatch = Partial<{
  occasion: string | null;
  honorees: string | string[] | null;
  palette: string | null;
  tone: string | null;
  avoid: string | string[] | null;
  notes: string | null;
}>;

/** Delimiters a host uses between names / avoid-items: comma, semicolon,
 *  newline, ampersand, plus, or the word "and". */
const LIST_SPLIT = /\s*(?:,|;|\r?\n|&|\+|\band\b)\s*/i;

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? fenceSafe(v).slice(0, max).trim() : '';
}

function list(v: unknown, itemMax: number, max: number): string[] {
  const parts = Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : typeof v === 'string' ? v.split(LIST_SPLIT) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const item = text(p, itemMax);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/** Sum of every string the brief carries — what BRIEF_CAPS.total measures. */
export function briefSize(b: EventBrief): number {
  return b.occasion.length + b.palette.length + b.tone.length + b.notes.length
    + b.honorees.reduce((n, h) => n + h.length, 0)
    + b.avoid.reduce((n, a) => n + a.length, 0);
}

/** Shrink to BRIEF_CAPS.total, least-valuable field first: notes, then tone,
 *  palette, the last avoid item, the last honoree, and finally the occasion. */
function fitToTotal(b: EventBrief): EventBrief {
  const out: EventBrief = { ...b, honorees: [...b.honorees], avoid: [...b.avoid] };
  let over = briefSize(out) - BRIEF_CAPS.total;
  const cut = (s: string): string => {
    const take = Math.max(0, s.length - over);
    over -= s.length - take;
    return s.slice(0, take).trimEnd();
  };
  if (over > 0) out.notes = cut(out.notes);
  if (over > 0) out.tone = cut(out.tone);
  if (over > 0) out.palette = cut(out.palette);
  while (over > 0 && out.avoid.length > 0) over -= out.avoid.pop()!.length;
  while (over > 0 && out.honorees.length > 0) over -= out.honorees.pop()!.length;
  if (over > 0) out.occasion = cut(out.occasion);
  return out;
}

/** Coerce an untrusted stored/model value into a safe brief. Garbage → the
 *  empty brief (never null, so callers can spread it without a guard). */
export function normalizeBrief(raw: unknown): EventBrief {
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const updatedAt = typeof r.updatedAt === 'string' && r.updatedAt.trim() ? r.updatedAt.trim().slice(0, 40) : null;
  return fitToTotal({
    occasion: text(r.occasion, BRIEF_CAPS.occasion),
    honorees: list(r.honorees, BRIEF_CAPS.honoree, BRIEF_CAPS.honorees),
    palette: text(r.palette, BRIEF_CAPS.palette),
    tone: text(r.tone, BRIEF_CAPS.tone),
    avoid: list(r.avoid, BRIEF_CAPS.avoidItem, BRIEF_CAPS.avoid),
    notes: text(r.notes, BRIEF_CAPS.notes),
    updatedAt,
  });
}

/** True when no field carries content (updatedAt alone does not count). */
export function isEmptyBrief(b: EventBrief | null | undefined): boolean {
  return !b || briefSize(b) === 0;
}

/**
 * Apply a patch to the current brief. Present keys replace their field (a
 * list patch replaces the whole list — "the honorees are Maya and Sam" is a
 * statement, not an append); absent keys are untouched; `now` stamps
 * updatedAt. Always returns a NEW object.
 */
export function mergeBrief(current: EventBrief | null | undefined, patch: BriefPatch, now: string): EventBrief {
  const base = current ? normalizeBrief(current) : { ...EMPTY_BRIEF };
  const next: Record<string, unknown> = { ...base, honorees: [...base.honorees], avoid: [...base.avoid] };
  for (const key of ['occasion', 'honorees', 'palette', 'tone', 'avoid', 'notes'] as const) {
    if (!(key in patch) || patch[key] === undefined) continue;
    next[key] = patch[key] ?? (key === 'honorees' || key === 'avoid' ? [] : '');
  }
  return { ...normalizeBrief(next), updatedAt: now };
}

/** The `BRIEF:` block the copilot prompt reads (after CARDS in the event
 *  snapshot). Empty brief → '' so the snapshot stays byte-identical. */
export function formatBrief(b: EventBrief | null | undefined): string {
  if (isEmptyBrief(b)) return '';
  const lines = ['BRIEF:'];
  if (b!.occasion) lines.push(`- occasion: ${b!.occasion}`);
  if (b!.honorees.length > 0) lines.push(`- honorees: ${b!.honorees.join(', ')}`);
  if (b!.palette) lines.push(`- palette: ${b!.palette}`);
  if (b!.tone) lines.push(`- tone: ${b!.tone}`);
  if (b!.avoid.length > 0) lines.push(`- avoid: ${b!.avoid.join(', ')}`);
  if (b!.notes) lines.push(`- notes: ${b!.notes}`);
  return lines.join('\n');
}

/** One line (≤ SCENE_BRIEF_MAX) for the Scene Director's sceneContext. '' when empty. */
export function formatSceneBrief(b: EventBrief | null | undefined): string {
  if (isEmptyBrief(b)) return '';
  const parts: string[] = [];
  const who = b!.honorees.length > 0 ? ` for ${b!.honorees.join(' & ')}` : '';
  if (b!.occasion || who) parts.push(`${b!.occasion || 'event'}${who}`);
  if (b!.palette) parts.push(`palette ${b!.palette}`);
  if (b!.tone) parts.push(`tone ${b!.tone}`);
  if (b!.avoid.length > 0) parts.push(`avoid ${b!.avoid.join(', ')}`);
  if (b!.notes) parts.push(b!.notes);
  const line = `Brief: ${parts.join(' · ')}`;
  return line.length > SCENE_BRIEF_MAX ? `${line.slice(0, SCENE_BRIEF_MAX - 1).trimEnd()}…` : line;
}

/**
 * The concierge's `plan.brief` — an object of nullable STRINGS (the create
 * schema has no arrays; honorees/avoid arrive delimited) → a brief, or null
 * when nothing usable was said. `updatedAt` stays null: the create path stamps
 * it when the event row is written.
 */
export function briefFromPlanRaw(raw: unknown): EventBrief | null {
  if (raw === null || typeof raw !== 'object') return null;
  const b = normalizeBrief({ ...(raw as Record<string, unknown>), updatedAt: null });
  return isEmptyBrief(b) ? null : b;
}
