/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform Copilot core — wire client for ai-event-designer's copilot mode,
 * the action-proposal normalizer (the REAL gate on model output), and the
 * client-side tool executors that run with the host's own RLS session.
 *
 * KEY FACT (verified live): challenges / experiences / cards are ALL keyed
 * by events.slug — executors take the slug; the uuid exists in ctx only for
 * future config-level tools.
 *
 * Pure except the executors + askCopilot (which lazy-import supabase-touching
 * modules) — normalizeActions/mergeWireTurns are node-tested.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { parseNaturalDate, reportAiError, trimWireTurns, type ChatMessage } from './eventDesigner';
import { COPILOT_TOOLS, TOOL_NAMES } from './copilotTools';
import { PLATFORM_GUIDE } from './platformGuide';
import type { EventSnapshot } from './eventSnapshot';
import { FILTER_SHADERS } from './shaders';
import { HEAD_PIECE_MAP, HEAD_PIECES } from './headPieces';
import { BORDER_MAP, GENERIC_FRAMES, GENERIC_FRAME_IDS } from './borders';
import { normalizeValidation } from './challengeValidation';
import { normalizeLettering, type LetteringSpec } from './assetPrompt';
import { PROP_TARGET_CM } from './studio/bustFit';
import { CARD_TEMPLATE_IDS, type CardTemplateId } from './cardTemplates';
import { packById } from './contentPacks';
import { BRIEF_CAPS, mergeBrief, type BriefPatch, type EventBrief } from './eventBrief';
import type { TemplateId } from './eventTemplates';

/** The wire-turn window lives beside ChatMessage (eventDesigner.ts) because
 *  both chats share it; re-exported here so copilot callers need one import. */
export { MAX_WIRE_TURNS, trimWireTurns } from './eventDesigner';

/* ── Action types (post-normalization) ───────────────────────────────── */

/**
 * Which image provider generates a frame. Same union as ai.ts
 * GenerateImageOpts.provider — 'gemini' is the platform's own path (1 credit),
 * 'higgsfield' costs 2 platform credits, or nothing at all when the org brought
 * its own Higgsfield key (see providerKeys.ts).
 */
export type FrameProvider = 'gemini' | 'higgsfield';

/**
 * Coerce an untrusted provider value. ABSENT stays absent, so a proposal the
 * model made without naming a provider is byte-identical to before this option
 * existed. A PRESENT but unrecognised value normalizes to 'gemini' rather than
 * dropping the action — a hallucinated provider name must cost the host a
 * provider choice, never the frame they asked for.
 */
function frameProvider(v: unknown): FrameProvider | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'higgsfield' ? 'higgsfield' : 'gemini';
}

export interface ChallengeDraft {
  title: string;
  emoji: string;
  points: number;
  description: string;
  /** Optional AI photo-check: what the guest's photo must contain to count. */
  validationPrompt?: string;
}

/** `update_brief`'s proposal: every field optional, absent = unchanged. Lists
 *  travel as delimited STRINGS ("Maya, Sam") so the confirm card can edit them
 *  in a text box; mergeBrief splits them. */
export type BriefFieldsPatch = Partial<Record<'occasion' | 'honorees' | 'palette' | 'tone' | 'avoid' | 'notes', string>>;

export type CopilotAction =
  | { tool: 'add_challenge'; proposal: ChallengeDraft }
  /** `packId` names a registry pack (contentPacks.ts) the challenges came from
   *  or should come from; absent on a model-authored pack. */
  | { tool: 'add_challenge_pack'; proposal: { theme: string; packId?: TemplateId; challenges: ChallengeDraft[] } }
  | { tool: 'update_challenge'; proposal: { challengeId: string; title?: string; emoji?: string; points?: number; active?: boolean } }
  | { tool: 'delete_challenge'; proposal: { challengeId: string } }
  | { tool: 'create_card'; proposal: { cardTitle: string; recipientName: string; cardTemplate: CardTemplateId; deadline: string } }
  | { tool: 'update_brief'; proposal: BriefFieldsPatch }
  // Experience-building tools (Event Concierge post-create build phase).
  | { tool: 'generate_frame'; proposal: { prompt: string; lettering?: LetteringSpec; provider?: FrameProvider } }
  | { tool: 'add_frame'; proposal: { borderId: string } }
  | { tool: 'set_filter'; proposal: { shaderId: string } }
  | { tool: 'add_head_piece'; proposal: { source: 'builtin'; pieceId: string } | { source: 'generate'; prompt: string } }
  | { tool: 'set_default_experience'; proposal: { experienceId: string } }
  | { tool: 'set_event_date'; proposal: { date: string } }
  | { tool: 'rename_event'; proposal: { name: string } }
  | { tool: 'go_live' }
  | { tool: 'test_experience' }
  | { tool: 'get_stats' }
  | { tool: 'share_links' }
  // Handoff tools: executeAction returns `handoff` and the chat acts on it
  // (navigates / opens the support dialog) — nothing runs in this module.
  | { tool: 'open_scene_director'; proposal: { brief: string } }
  | { tool: 'contact_support'; proposal: { summary: string } };

/** Proposals per turn the normalizer executes; the rest are `over_cap`. The
 *  prompt's Routing rule keeps at most ONE spending tool per turn, last. */
export const MAX_ACTIONS = 5;
const HANDOFF_BRIEF_MIN = 6;
const HANDOFF_TEXT_MAX = 600;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The filter ids the model may pick from (the same list the studio Director
 *  is given). 'none' is excluded — an empty filter is never worth an action. */
const FILTER_IDS = new Set(FILTER_SHADERS.map((s) => s.id).filter((id) => id !== 'none'));

const str = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const points = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(1000, Math.max(0, Math.round(n))) : 10;
};

const TITLE_MAX = 60;

/**
 * A model that dumps the host's whole sentence into `title` produces an ugly,
 * unusable card. Salvage: keep a short leading fragment as the title and move
 * the full text into the description (when it doesn't already have one).
 */
function splitLongTitle(rawTitle: string, rawDescription: string): { title: string; description: string } {
  if (rawTitle.length <= TITLE_MAX) return { title: rawTitle, description: rawDescription };
  const shortened = rawTitle.slice(0, TITLE_MAX).replace(/\s+\S*$/, '').replace(/[,;:.\s]+$/, '');
  return {
    title: shortened || rawTitle.slice(0, TITLE_MAX),
    description: rawDescription || rawTitle,
  };
}

/** One challenge draft from untrusted model output; null when unusable. */
function challengeDraft(raw: unknown): ChallengeDraft | null {
  const a = (raw ?? {}) as Record<string, unknown>;
  const rawTitle = str(a.title, 200);
  if (!rawTitle) return null;
  const { title, description } = splitLongTitle(rawTitle, str(a.description, 300));
  const validationPrompt = str(a.validationPrompt, 500);
  return {
    title, emoji: str(a.emoji, 8) || '⭐', points: points(a.points), description,
    ...(validationPrompt ? { validationPrompt } : {}),
  };
}

/** Build a challenge's stored validation config from a draft's optional
 *  validationPrompt (present → enabled). Shared by add_challenge + pack. */
function draftValidation(d: ChallengeDraft) {
  return normalizeValidation({ enabled: !!d.validationPrompt, prompt: d.validationPrompt ?? '' });
}

export interface NormalizedActions {
  actions: CopilotAction[];
  /**
   * How many proposals this gate EXAMINED and rejected (unknown tool, missing
   * required arg, hallucinated or unknown-to-the-snapshot id). The model's prose
   * almost always promises them ("done — I've bumped that challenge to 30"), so
   * a silent drop makes the assistant a liar; the chat owes the host one line
   * saying it could not act. Items never reached because of MAX_ACTIONS are not
   * counted here — they were not judged invalid.
   */
  dropped: number;
  /**
   * WHY each proposal did not run, in input order — including the ones the
   * MAX_ACTIONS cap cut ('over_cap', which `dropped` deliberately excludes).
   * `tool` is the raw tool name the model sent (unknown tools included) so a
   * telemetry row or a debug line can name it.
   */
  droppedReasons: DroppedReason[];
}

export interface DroppedReason {
  tool: string;
  reason: 'unknown_tool' | 'invalid_args' | 'over_cap' | 'unknown_id';
}

/**
 * Validate raw model actions into executable ones. Strict on ids: update /
 * delete proposals must reference a challengeId that exists in the snapshot
 * (kills hallucinated ids). Unknown tools and missing required args drop the
 * action — the reply text still renders, and `dropped` counts them so the
 * caller can say so out loud.
 */
export function normalizeActionsResult(raw: unknown, snapshot: EventSnapshot | null): NormalizedActions {
  if (!Array.isArray(raw)) return { actions: [], dropped: 0, droppedReasons: [] };
  const knownIds = new Set((snapshot?.challenges ?? []).map((c) => c.id));
  const expIds = new Set((snapshot?.experiences ?? []).map((e) => e.id));
  const out: CopilotAction[] = [];
  let dropped = 0;
  const droppedReasons: DroppedReason[] = [];
  for (const item of raw) {
    const a = (item ?? {}) as Record<string, unknown>;
    const toolName = str(a.tool, 40) || '?';
    if (out.length >= MAX_ACTIONS) {
      droppedReasons.push({ tool: toolName, reason: 'over_cap' });
      continue;
    }
    const before = out.length;
    // Every drop site below is "missing/invalid argument" unless a case says
    // the argument was present but named an id we do not know.
    let reason: DroppedReason['reason'] = 'invalid_args';
    switch (a.tool) {
      case 'add_challenge': {
        const draft = challengeDraft(a);
        if (!draft) break;
        out.push({ tool: 'add_challenge', proposal: draft });
        break;
      }
      case 'add_challenge_pack': {
        // A known packId with no challenges expands from the registry (zero
        // AI-authored content); model-authored challenges win when present.
        const pack = packById(str(a.packId, 20));
        const authored = (Array.isArray(a.challenges) ? a.challenges : [])
          .map(challengeDraft)
          .filter((c): c is ChallengeDraft => c !== null)
          .slice(0, 6);
        const drafts = authored.length > 0 ? authored : pack ? pack.challenges.map((c) => ({ ...c })) : [];
        if (drafts.length === 0) break;
        out.push({
          tool: 'add_challenge_pack',
          proposal: {
            theme: str(a.theme, 80) || pack?.theme || 'Challenge pack',
            ...(pack ? { packId: pack.id } : {}),
            challenges: drafts,
          },
        });
        break;
      }
      case 'update_challenge': {
        const challengeId = str(a.challengeId, 64);
        if (!challengeId) break;
        if (!knownIds.has(challengeId)) { reason = 'unknown_id'; break; }
        const proposal: Extract<CopilotAction, { tool: 'update_challenge' }>['proposal'] = { challengeId };
        if (str(a.title)) proposal.title = str(a.title);
        if (str(a.emoji, 8)) proposal.emoji = str(a.emoji, 8);
        if (a.points !== null && a.points !== undefined) proposal.points = points(a.points);
        if (typeof a.active === 'boolean') proposal.active = a.active;
        out.push({ tool: 'update_challenge', proposal });
        break;
      }
      case 'delete_challenge': {
        const challengeId = str(a.challengeId, 64);
        if (!challengeId) break;
        if (!knownIds.has(challengeId)) { reason = 'unknown_id'; break; }
        out.push({ tool: 'delete_challenge', proposal: { challengeId } });
        break;
      }
      case 'create_card': {
        const cardTitle = str(a.cardTitle);
        if (!cardTitle) break;
        out.push({
          tool: 'create_card',
          proposal: {
            cardTitle,
            recipientName: str(a.recipientName, 80),
            cardTemplate: cardTemplate(a.cardTemplate),
            deadline: isoDate(a.deadline) ?? '',
          },
        });
        break;
      }
      case 'generate_frame': {
        const prompt = str(a.prompt, 500);
        if (!prompt) break;
        // Lettering is optional and independently validated: a hallucinated
        // style/placement id (or a 60-character "name") drops SILENTLY back to
        // a frame with no words on it rather than killing the whole proposal —
        // the same handling validationPrompt gets on add_challenge.
        const lettering = normalizeLettering(a.lettering);
        // Same forgiving handling for the provider (see frameProvider).
        const provider = frameProvider(a.provider);
        out.push({
          tool: 'generate_frame',
          proposal: {
            prompt,
            ...(lettering ? { lettering } : {}),
            ...(provider ? { provider } : {}),
          },
        });
        break;
      }
      case 'add_frame': {
        // Only the generic (no event-locked text) built-ins may be added as-is.
        const borderId = str(a.borderId, 40);
        if (!borderId) break;
        if (!GENERIC_FRAME_IDS.has(borderId)) { reason = 'unknown_id'; break; }
        out.push({ tool: 'add_frame', proposal: { borderId } });
        break;
      }
      case 'set_event_date': {
        const date = isoDate(a.date);
        if (date === null) break;
        out.push({ tool: 'set_event_date', proposal: { date } });
        break;
      }
      case 'rename_event': {
        const name = str(a.name, 80);
        if (!name) break;
        out.push({ tool: 'rename_event', proposal: { name } });
        break;
      }
      case 'update_brief': {
        const patch = briefFields(a);
        if (Object.keys(patch).length === 0) break; // nothing to change
        out.push({ tool: 'update_brief', proposal: patch });
        break;
      }
      case 'set_filter': {
        const shaderId = str(a.shaderId, 40);
        if (!shaderId) break;
        if (!FILTER_IDS.has(shaderId)) { reason = 'unknown_id'; break; }
        out.push({ tool: 'set_filter', proposal: { shaderId } });
        break;
      }
      case 'add_head_piece': {
        const prompt = str(a.prompt, 300);
        if (a.source === 'generate') {
          if (!prompt) break;
          out.push({ tool: 'add_head_piece', proposal: { source: 'generate', prompt } });
          break;
        }
        const pieceId = str(a.pieceId, 40);
        if (pieceId && HEAD_PIECE_MAP[pieceId]) {
          out.push({ tool: 'add_head_piece', proposal: { source: 'builtin', pieceId } });
        } else if (prompt) {
          // Hallucinated/absent pieceId but a usable prompt → degrade to a
          // generate proposal instead of silently dropping the host's request
          // (mirrors sceneDirector.ts's forgiving coercion).
          out.push({ tool: 'add_head_piece', proposal: { source: 'generate', prompt } });
        } else if (pieceId) {
          reason = 'unknown_id';
        }
        break;
      }
      case 'set_default_experience': {
        const experienceId = str(a.experienceId, 64);
        if (!experienceId) break;
        if (!expIds.has(experienceId)) { reason = 'unknown_id'; break; }
        out.push({ tool: 'set_default_experience', proposal: { experienceId } });
        break;
      }
      case 'go_live':
      case 'test_experience':
      case 'get_stats':
      case 'share_links':
        out.push({ tool: a.tool });
        break;
      case 'open_scene_director': {
        const brief = str(a.brief, HANDOFF_TEXT_MAX);
        if (brief.length < HANDOFF_BRIEF_MIN) break;
        out.push({ tool: 'open_scene_director', proposal: { brief } });
        break;
      }
      case 'contact_support': {
        const summary = str(a.summary, HANDOFF_TEXT_MAX);
        if (!summary) break;
        out.push({ tool: 'contact_support', proposal: { summary } });
        break;
      }
      default:
        reason = 'unknown_tool';
        break; // unknown tool — dropped
    }
    if (out.length === before) {
      dropped++;
      droppedReasons.push({ tool: toolName, reason });
    }
  }
  return { actions: out, dropped, droppedReasons };
}

/** The stored card template for an untrusted value; unknown → storybook
 *  (the default the cards table falls back to), never a dropped card. */
function cardTemplate(v: unknown): CardTemplateId {
  return (CARD_TEMPLATE_IDS as readonly string[]).includes(typeof v === 'string' ? v : '')
    ? (v as CardTemplateId)
    : 'storybook';
}

/** The present, non-empty brief fields of a raw proposal, each capped like
 *  the brief itself (lists are strings here — mergeBrief splits them). */
function briefFields(a: Record<string, unknown>): BriefFieldsPatch {
  const caps: Record<keyof BriefFieldsPatch, number> = {
    occasion: BRIEF_CAPS.occasion,
    honorees: BRIEF_CAPS.honorees * (BRIEF_CAPS.honoree + 2),
    palette: BRIEF_CAPS.palette,
    tone: BRIEF_CAPS.tone,
    avoid: BRIEF_CAPS.avoid * (BRIEF_CAPS.avoidItem + 2),
    notes: BRIEF_CAPS.notes,
  };
  const out: BriefFieldsPatch = {};
  for (const key of Object.keys(caps) as (keyof BriefFieldsPatch)[]) {
    const v = str(a[key], caps[key]);
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Strip the confirm card's per-row `include` flags from a pack proposal:
 * rows the host unticked are DROPPED, and the key is removed from the rest.
 * Must run BEFORE normalizeActions — challengeDraft keeps only the keys it
 * knows, so an `include: false` row would otherwise be silently kept.
 * Non-pack proposals (no `challenges` array) pass through untouched.
 */
export function applyIncludeFlags(proposal: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(proposal.challenges)) return proposal;
  const challenges = proposal.challenges
    .filter((c) => !(c !== null && typeof c === 'object' && (c as Record<string, unknown>).include === false))
    .map((c) => {
      if (c === null || typeof c !== 'object') return c;
      const { include: _include, ...rest } = c as Record<string, unknown>;
      return rest;
    });
  return { ...proposal, challenges };
}

/**
 * A date argument as YYYY-MM-DD. Strict ISO wins; otherwise the natural-
 * language parser the concierge already uses ("July 12 2026") gets a turn,
 * so a host-phrased date is normalised instead of dropped. null = unusable.
 */
function isoDate(v: unknown): string | null {
  const raw = str(v, 80);
  if (DATE_RE.test(raw)) return raw;
  return raw ? parseNaturalDate(raw) : null;
}

/** Actions only. `*Result` sibling convention — no existing caller changes. */
export function normalizeActions(raw: unknown, snapshot: EventSnapshot | null): CopilotAction[] {
  return normalizeActionsResult(raw, snapshot).actions;
}

/**
 * Prepare a transcript for the wire.
 *
 * 1. EMPTY turns are dropped. The chat stores a client-rendered card as an
 *    assistant turn with no prose (CopilotChat's addSurface: `content: ''`),
 *    and ai-event-designer rejects ANY blank turn with 400 invalid_body
 *    (index.ts: `!content.trim()`). Because the transcript is persisted in
 *    sessionStorage, one surface-only turn used to break EVERY later send —
 *    the thread fell into the offline reply and never recovered. Merging alone
 *    could not catch it: an empty turn adjacent to a real assistant turn was
 *    absorbed, but a non-adjacent one (card right after a [tool_result] user
 *    turn, or a quick-action card at the top of a thread) survived.
 * 2. Gemini requires strict user/model alternation; tool-result turns are sent
 *    as user turns, so consecutive same-role turns merge.
 */
export function mergeWireTurns(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (!m.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      out.push({ ...m });
    }
  }
  return out;
}

/* ── Executors (client-side, RLS-scoped) ─────────────────────────────── */

export interface CopilotCtx {
  /** events.slug — the content-table partition key (challenges/cards/etc). */
  slug: string;
  /** events.id — for config-level operations (update_brief, the booth default mirror). */
  eventUuid: string;
  origin: string;
  /** The event's current brief (snapshot meta), the base `update_brief` merges
   *  onto. Absent/null = start from an empty brief. */
  brief?: EventBrief | null;
}

/** Why a tool did not do what was asked — the machine-readable half of a
 *  [tool_result] turn, so the model can choose between "re-read the event
 *  data and try once more" and "say it plainly and offer support". */
export type ToolResultCode =
  | 'no_event'    // no event selected — ask the host to pick one
  | 'invalid'     // the proposal cannot run as given (unusable args, wrong phase)
  | 'unknown_id'  // an id the event does not have
  | 'rls_denied'  // Postgres refused the write (permission / row-level security)
  | 'network'     // the request never got an answer
  | 'not_found'   // the row is gone (or hidden) — zero rows matched
  | 'timeout'     // the call was aborted for time
  | 'gap'         // the confirm card is missing a required field (proposalGaps)
  | 'unknown';

export interface ExecResult {
  ok: boolean;
  /** One-line outcome fed back to the model as a [tool_result] turn. */
  summary: string;
  /** Set on EVERY ok:false result (see ToolResultCode). */
  code?: ToolResultCode;
  /** Whether the same proposal is worth one more try as-is. */
  retryable?: boolean;
  /** create_card success payload — the chat renders it as a QR link card. */
  card?: { title: string; contributeUrl: string; viewerUrl: string };
  /** go_live success → the event's new lifecycle status ('live'). */
  status?: string;
  /** Handoff tools: nothing ran here — the chat navigates / opens the dialog. */
  handoff?: { kind: 'scene_director'; brief: string } | { kind: 'support'; summary: string };
}

/** Classify a thrown/returned error into a ToolResultCode. Supabase/PostgREST
 *  errors carry `code` (42501 = insufficient_privilege, PGRST116 = zero rows
 *  for a single-object request); fetch failures are TypeErrors. */
export function toolResultCode(e: unknown): { code: ToolResultCode; retryable: boolean } {
  const err = (e ?? {}) as { code?: unknown; message?: unknown; name?: unknown; status?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  const message = typeof err.message === 'string' ? err.message : '';
  const name = typeof err.name === 'string' ? err.name : '';
  if (code === '42501' || /permission denied|row-level security|violates row-level/i.test(message) || err.status === 403) {
    return { code: 'rls_denied', retryable: false };
  }
  if (code === 'PGRST116' || err.status === 404) return { code: 'not_found', retryable: false };
  if (name === 'AbortError' || name === 'TimeoutError' || /timed? ?out/i.test(message)) {
    return { code: 'timeout', retryable: true };
  }
  if (e instanceof TypeError || /fetch|network|Failed to fetch|Load failed/i.test(message)) {
    return { code: 'network', retryable: true };
  }
  return { code: 'unknown', retryable: true };
}

/** A failed ExecResult with its code attached, in one expression. */
function fail(summary: string, code: ToolResultCode, retryable: boolean): ExecResult {
  return { ok: false, summary, code, retryable };
}

/**
 * The [tool_result] turn the model reads. Machine-readable prefix, then the
 * human summary after ' — '; the chat shows only the summary (toolResultSummary).
 *   "[tool_result] tool=add_challenge ok=false code=rls_denied retryable=false — <summary>"
 */
export function formatToolResult(
  tool: string,
  r: { ok: boolean; code?: string; retryable?: boolean; summary: string },
): string {
  const parts = [`tool=${tool}`, `ok=${r.ok ? 'true' : 'false'}`];
  if (r.code !== undefined) parts.push(`code=${r.code}`);
  if (r.retryable !== undefined) parts.push(`retryable=${r.retryable ? 'true' : 'false'}`);
  return `[tool_result] ${parts.join(' ')} — ${r.summary}`;
}

/** The host-readable part of a [tool_result] turn: everything after the first
 *  ' — ', or the content without its `[tool_result] ` prefix when there is no
 *  dash (older, hand-written turns persisted in sessionStorage). */
export function toolResultSummary(content: string): string {
  const dash = content.indexOf(' — ');
  if (dash >= 0) return content.slice(dash + 3);
  return content.startsWith('[tool_result] ') ? content.slice('[tool_result] '.length) : content;
}

/**
 * Pin an experience as the booth default. The booth reads
 * `wallSettings.defaultExperienceId ?? eventConfig.defaultExperienceId`
 * (Booth.tsx), so the AUTHORITATIVE store is app_settings 'wall' (by slug);
 * we also mirror into events.config (by uuid) for parity with FrameStudio and
 * to override any `builtin:*` id the template seeded there. Best-effort: the
 * events.config write returns the real health signal (same RLS as the wall
 * upsert), so we surface that.
 */
async function pinDefault(ctx: CopilotCtx, experienceId: string): Promise<boolean> {
  const [{ setWallSettings }, { updateEventConfig }] = await Promise.all([import('./db'), import('./host')]);
  await setWallSettings(ctx.slug, { defaultExperienceId: experienceId });
  return updateEventConfig(ctx.eventUuid, { defaultExperienceId: experienceId });
}

/**
 * Apply a generated FRAME the host approved: publish the (server-created,
 * unpublished) experience and pin it as the booth default. NEVER re-generates
 * (no credit spend). Publish-only: the chat has no placement UI, so the booth
 * uses the default (identity) transform — writing config here is avoided so the
 * row's own config (e.g. the chroma-key `transparent` flag) is never clobbered,
 * which mattered on the refresh path where the caller has no config to spread.
 */
export async function applyGeneratedFrame(ctx: CopilotCtx, experienceId: string): Promise<ExecResult> {
  return publishAndPin(ctx, experienceId, undefined, 'frame');
}

/**
 * Apply a generated 3D PROP the host approved: publish + pin. `fitScale` (from
 * the browser-side GLB measure) is baked into config.anchor.scale so a raw
 * Meshy model — which renders ~1cm at scale 1 — sits at head size in the booth,
 * exactly as the studio Director's measure-then-add does. NEVER re-generates.
 */
export async function applyGeneratedPiece(
  ctx: CopilotCtx,
  experienceId: string,
  fitScale: number | null,
): Promise<ExecResult> {
  // An unmeasurable GLB (null fit) must NOT fall through to the implicit
  // scale 1 — a raw ~1-unit Meshy model renders ~1cm in head space, an
  // invisible speck. Assume ~1 unit and bake PROP_TARGET_CM so the prop
  // lands at head size; the host can fine-tune in the studio 3D editor.
  return publishAndPin(ctx, experienceId, fitScale ?? PROP_TARGET_CM, 'piece');
}

/** Shared publish + pin. When `fitScale` is given, read the row's config and
 *  override anchor.scale (preserving every other config key). */
async function publishAndPin(
  ctx: CopilotCtx,
  experienceId: string,
  fitScale: number | undefined,
  kind: 'frame' | 'piece',
): Promise<ExecResult> {
  const noun = kind === 'frame' ? 'frame' : '3D prop';
  try {
    const { supabase } = await import('./supabase');
    const patch: Record<string, unknown> = { is_published: true };
    if (fitScale !== undefined) {
      const { data } = await supabase.from('experiences').select('config').eq('id', experienceId).maybeSingle();
      const config = (data?.config ?? {}) as Record<string, unknown>;
      const anchor = (config.anchor ?? {}) as Record<string, unknown>;
      patch.config = { ...config, anchor: { ...anchor, scale: fitScale } };
    }
    // `.select('id')` is load-bearing: without it PostgREST answers a matched-
    // NOTHING update with 204 and no error, so a row hidden by RLS or already
    // deleted reported "your frame is live" while nothing had changed.
    const { data: updated, error: pubErr } = await supabase
      .from('experiences')
      .update(patch)
      .eq('id', experienceId)
      .eq('event_id', ctx.slug)
      .select('id');
    if (pubErr || !updated || updated.length === 0) {
      const why = pubErr ? toolResultCode(pubErr) : { code: 'not_found' as const, retryable: false };
      return fail(`The ${noun} was generated but could not be published — publish it from your studio Library.`, why.code, why.retryable);
    }
    const pinned = await pinDefault(ctx, experienceId);
    return pinned
      ? { ok: true, summary: `Your ${noun} is live and set as the booth default.` }
      : { ok: true, summary: `Your ${noun} is published, but setting it as the booth default failed — set it in the studio Library.` };
  } catch (e) {
    console.error('[copilot] publishAndPin', kind, e);
    const why = toolResultCode(e);
    return fail(`Applying the ${noun} failed unexpectedly.`, why.code, why.retryable);
  }
}

/** Host-facing name for each tool, for the card heading and the one line a
 *  host reads when something breaks. Derived from the registry, and typed over
 *  the whole union so a new tool cannot ship label-less. */
export const TOOL_LABELS: Record<CopilotAction['tool'], string> = Object.fromEntries(
  TOOL_NAMES.map((n) => [n, COPILOT_TOOLS[n].label]),
) as Record<CopilotAction['tool'], string>;

export async function executeAction(action: CopilotAction, ctx: CopilotCtx): Promise<ExecResult> {
  // Every copilot tool acts on a specific event. With no event selected, ctx.slug
  // (and eventUuid) are empty, and any write hits the tenant RLS wall — an INSERT
  // with event_id='' gives event_org('')=null → is_org_member(null)=false → 403
  // "new row violates row-level security policy". Bail early with a clear message
  // instead of a bare "…failed". (The floating panel leaves no event selected for
  // hosts with more than one event until they pick one.)
  if (!ctx.slug) {
    return fail('I’m not pointed at an event yet — pick one in the panel above and I’ll set it up right away.', 'no_event', false);
  }
  try {
    switch (action.tool) {
      case 'add_challenge': {
        const { createChallenge } = await import('./db');
        const p = action.proposal;
        const row = await createChallenge(ctx.slug, {
          title: p.title, emoji: p.emoji, points: points(p.points), description: p.description || null, active: true,
          validation: draftValidation(p),
        });
        // The row id used to ride along here. This summary is rendered to the
        // HOST as a chip, and a bare uuid means nothing to them; the model does
        // not need it either, because onMutated() re-reads the snapshot and the
        // new challenge arrives there with its id attached.
        return row
          ? { ok: true, summary: `Challenge "${row.title}" added${p.validationPrompt ? ' with an AI photo check' : ''}.` }
          : fail('Adding the challenge failed.', 'unknown', true);
      }
      case 'add_challenge_pack': {
        const { createChallenge } = await import('./db');
        // Card edits pass through the surface data model — re-validate each
        // entry rather than trusting the array shape survived intact.
        const drafts = (Array.isArray(action.proposal.challenges) ? action.proposal.challenges : [])
          .map(challengeDraft)
          .filter((c): c is ChallengeDraft => c !== null);
        if (drafts.length === 0) return fail('The pack had no usable challenges.', 'invalid', false);
        let added = 0;
        for (const d of drafts) {
          const row = await createChallenge(ctx.slug, {
            title: d.title, emoji: d.emoji, points: points(d.points), description: d.description || null, active: true,
            validation: draftValidation(d),
          });
          if (row) added++;
        }
        return added > 0
          ? { ok: true, summary: `Added ${added} of ${drafts.length} "${action.proposal.theme}" challenges.` }
          : fail('Adding the challenge pack failed.', 'unknown', true);
      }
      case 'update_challenge': {
        const { updateChallenge } = await import('./db');
        const { challengeId, ...patch } = action.proposal;
        const ok = await updateChallenge(ctx.slug, challengeId, { ...patch, ...(patch.points !== undefined ? { points: points(patch.points) } : {}) });
        // Name it when the patch renames it; otherwise stay generic. The raw
        // uuid that used to be here is our vocabulary, not the host's.
        const named = patch.title ? `“${patch.title}”` : 'that challenge';
        // db.updateChallenge folds "zero rows matched" and a refused write into
        // one boolean, so the code cannot be more specific than unknown here.
        return ok ? { ok: true, summary: `Updated ${named}.` } : fail(`Updating ${named} failed.`, 'unknown', true);
      }
      case 'delete_challenge': {
        const { deleteChallenge } = await import('./db');
        const ok = await deleteChallenge(ctx.slug, action.proposal.challengeId);
        return ok ? { ok: true, summary: 'Challenge deleted.' } : fail('Deleting the challenge failed.', 'unknown', true);
      }
      case 'create_card': {
        const { createCard, contributeUrl, viewerPath } = await import('./cards');
        const p = action.proposal;
        const card = await createCard(ctx.slug, {
          title: p.cardTitle,
          recipientName: p.recipientName || undefined,
          template: p.cardTemplate,
          deadline: p.deadline || undefined,
        });
        if (!card) return fail('Creating the card failed.', 'unknown', true);
        const cUrl = contributeUrl(card, ctx.origin);
        const vUrl = `${ctx.origin}${viewerPath(card.public_id)}`;
        return {
          ok: true,
          summary: `Card "${card.title}" created. Contribute: ${cUrl} · view: ${vUrl}`,
          card: { title: card.title, contributeUrl: cUrl, viewerUrl: vUrl },
        };
      }
      case 'set_filter': {
        const { buildFilterExperienceDraft } = await import('./studio/copilotExperience');
        const { createExperience } = await import('./db');
        const draft = buildFilterExperienceDraft(action.proposal.shaderId);
        if (!draft) return fail('That filter isn’t available.', 'unknown_id', false);
        const exp = await createExperience(ctx.slug, draft);
        if (!exp) return fail('Adding the filter failed.', 'unknown', true);
        const pinned = await pinDefault(ctx, exp.id);
        return {
          ok: true,
          summary: `Filter "${exp.name}" added${pinned ? ' and set as the booth default' : ' (set it as the booth default in the studio Library)'}.`,
        };
      }
      case 'add_head_piece': {
        // Generated pieces run through the async preview card, not here.
        if (action.proposal.source !== 'builtin') {
          return fail('That 3D piece needs generating first.', 'invalid', false);
        }
        const { buildHeadPieceExperienceDraft } = await import('./studio/copilotExperience');
        const { createExperience } = await import('./db');
        const draft = buildHeadPieceExperienceDraft(action.proposal.pieceId);
        if (!draft) return fail('That 3D piece isn’t available.', 'unknown_id', false);
        const exp = await createExperience(ctx.slug, draft);
        if (!exp) return fail('Adding the 3D piece failed.', 'unknown', true);
        const pinned = await pinDefault(ctx, exp.id);
        return {
          ok: true,
          summary: `3D piece "${exp.name}" added${pinned ? ' and set as the booth default' : ' (set it as the booth default in the studio Library)'}.`,
        };
      }
      case 'add_frame': {
        const border = BORDER_MAP[action.proposal.borderId];
        if (!border || !GENERIC_FRAME_IDS.has(border.id)) return fail('That frame isn’t available.', 'unknown_id', false);
        const { uploadAsset, createExperience } = await import('./db');
        const url = await uploadAsset(ctx.slug, new Blob([border.svg], { type: 'image/svg+xml' }), `${border.id}.svg`);
        if (!url) return fail('Adding the frame failed.', 'unknown', true);
        const exp = await createExperience(ctx.slug, {
          name: border.name, kind: border.kind, asset_url: url,
          config: {}, is_published: true, featured: true, sort_order: 0,
        });
        if (!exp) return fail('Adding the frame failed.', 'unknown', true);
        const pinned = await pinDefault(ctx, exp.id);
        return {
          ok: true,
          summary: `Frame "${border.name}" added${pinned ? ' and set as the booth default' : ' (set it as the booth default in the studio Library)'}.`,
        };
      }
      case 'set_default_experience': {
        const ok = await pinDefault(ctx, action.proposal.experienceId);
        return ok ? { ok: true, summary: 'Booth default updated.' } : fail('Setting the booth default failed.', 'unknown', true);
      }
      case 'set_event_date': {
        const { updateEventDate } = await import('./host');
        const ok = await updateEventDate(ctx.eventUuid, action.proposal.date);
        return ok
          ? { ok: true, summary: `Event date set to ${action.proposal.date}.` }
          : fail('Updating the date failed.', 'unknown', true);
      }
      case 'rename_event': {
        const { updateEventName } = await import('./host');
        const ok = await updateEventName(ctx.eventUuid, action.proposal.name);
        return ok
          ? { ok: true, summary: `Event renamed to "${action.proposal.name}".` }
          : fail('Renaming the event failed.', 'unknown', true);
      }
      case 'update_brief': {
        const { updateEventConfig } = await import('./host');
        const patch: BriefPatch = action.proposal;
        const changed = Object.keys(patch);
        if (changed.length === 0) return fail('Nothing to change in the brief.', 'invalid', false);
        const brief = mergeBrief(ctx.brief ?? null, patch, new Date().toISOString());
        const ok = await updateEventConfig(ctx.eventUuid, { brief });
        return ok
          ? { ok: true, summary: `Brief updated (${changed.join(', ')}).` }
          : fail('Updating the brief failed.', 'unknown', true);
      }
      case 'go_live': {
        // The ONE go-live path (host.goLive): flips status, then generates the
        // guest copy once, fire-and-forget — same as every go-live button.
        const { goLive } = await import('./host');
        const ok = await goLive(ctx.eventUuid);
        return ok
          ? { ok: true, summary: 'Your event is LIVE — guests can now take pictures and post to the wall.', status: 'live' }
          : fail('Going live failed — try again in a moment.', 'unknown', true);
      }
      // Handoffs: no navigation and no dialog here — the chat reads `handoff`
      // and does the UI part with the plumbing it already has.
      case 'open_scene_director':
        return { ok: true, summary: 'Opening the Scene Director…', handoff: { kind: 'scene_director', brief: action.proposal.brief } };
      case 'contact_support':
        return { ok: true, summary: 'Opening support…', handoff: { kind: 'support', summary: action.proposal.summary } };
      default:
        return fail('Nothing to execute.', 'invalid', false);
    }
  } catch (e) {
    console.error('[copilot] executeAction', action.tool, e);
    // The raw tool id ("add_challenge_pack failed unexpectedly") is our internal
    // vocabulary. The operator still gets it above, in the console.
    const why = toolResultCode(e);
    return fail(`“${TOOL_LABELS[action.tool]}” failed unexpectedly — try again in a moment.`, why.code, why.retryable);
  }
}

/* ── Wire client ─────────────────────────────────────────────────────── */

export interface CopilotResult {
  reply: string;
  actions: CopilotAction[];
  source: 'ai' | 'offline';
  /** Proposals the normalizer rejected (see NormalizedActions.dropped). The
   *  reply prose usually claims they happened, so the chat must say otherwise. */
  dropped: number;
  /** Per-proposal reasons, cap cuts included (see NormalizedActions.droppedReasons). */
  droppedReasons: DroppedReason[];
  /** The server's agent_turns row for this reply — the handle thumbs feedback
   *  and the next turn's `lastTurn` refer to. null on every offline path and
   *  when an older server sends none. */
  turnId: number | null;
  /** true when the caller's AbortSignal stopped the turn: reply is '', nothing
   *  was reported as an error, and the chat should say "Stopped." itself. The
   *  server still completes the turn and logs it (no streaming to cancel). */
  aborted?: boolean;
}

/** Which chat surface is asking — the server picks its static prompt
 *  variant by it. 'build' = the post-create build phase (/host/new). */
export type CopilotSurface = 'build' | 'platform';

export interface AskCopilotOptions {
  surface?: CopilotSurface;
  /** The previous assistant turn's server id + how many of its proposals the
   *  normalizer dropped, so telemetry can stamp the drop count on THAT row.
   *  Omitted from the wire when null/absent. */
  lastTurn?: { turnId: number; dropped: number } | null;
  /** Cancel the in-flight request (a Stop button). supabase-js ≥2.108 passes
   *  it to fetch; an aborted call resolves with `aborted: true`. */
  signal?: AbortSignal;
}

const OFFLINE_REPLY =
  'I can’t reach the AI service right now, so I can answer from the built-in guide only: ' +
  'use the studio tabs for changes (Challenges, Cards, Share), and try me again in a moment.';

/** Turn the edge fn's error code into an honest, CUSTOMER-SAFE message.
 *  The technical cause (rejected key, provider quota) is a platform config
 *  problem — it goes to console.error for the operator, never into chat.
 *  Exported so the concierge page renders the same copy from
 *  DesignResult.reason instead of one flat "offline" line. */
export function offlineReplyFor(reason?: string): string {
  switch (reason) {
    case 'ai_not_configured':
    case 'ai_key_invalid':
      return 'Our AI service is temporarily unavailable — all the manual tools still work. ' +
        'Use the studio tabs (Challenges, Cards, Share) to make changes yourself, and I’ll be back once service is restored.';
    case 'rate_limited':
      return 'You’ve hit the hourly AI limit — give it a few minutes and ask me again.';
    case 'ai_quota':
      return 'Our AI service is over capacity right now — try me again in a little while. All the manual tools still work in the meantime.';
    // Surface-neutral wording: these two also render inside the concierge's
    // note on /host/new, where "use the studio tabs" would be the wrong advice.
    case 'network':
      return 'I couldn’t reach our AI service just now — check your connection and try again in a moment.';
    case 'invalid_body':
      return 'That message was too long for me — try a shorter one.';
    default:
      return OFFLINE_REPLY;
  }
}

export async function askCopilot(
  messages: ChatMessage[],
  snapshot: EventSnapshot | null,
  opts: AskCopilotOptions = {},
): Promise<CopilotResult> {
  const offline = (reply: string): CopilotResult =>
    ({ reply, actions: [], source: 'offline', dropped: 0, droppedReasons: [], turnId: null });
  const aborted = (): CopilotResult => ({ ...offline(''), aborted: true });
  if (opts.signal?.aborted) return aborted();
  try {
    const { supabase } = await import('./supabase');
    const { formatSnapshot } = await import('./eventSnapshot');
    const { data, error } = await supabase.functions.invoke('ai-event-designer', {
      ...(opts.signal ? { signal: opts.signal } : {}),
      body: {
        mode: 'copilot',
        // Which chat is asking (static prompt variant server-side). Older
        // servers ignore it; `lastTurn` rides only when the chat has one.
        surface: opts.surface ?? 'platform',
        ...(opts.lastTurn ? { lastTurn: opts.lastTurn } : {}),
        // Merge first (alternation + empty-turn drop), THEN window: the trim
        // cuts on a user boundary, which only holds on merged turns.
        messages: trimWireTurns(mergeWireTurns(messages)),
        context: snapshot ? formatSnapshot(snapshot) : '',
        // Credits awareness: the fn resolves this event's org balance + free-image
        // allowance server-side and injects it into the model context.
        ...(snapshot?.eventUuid ? { eventUuid: snapshot.eventUuid } : {}),
        docs: PLATFORM_GUIDE,
        // The live catalogs ride along so the model proposes only real ids
        // (the client normalizer still validates and drops anything invalid).
        filters: FILTER_SHADERS.filter((s) => s.id !== 'none').map((s) => ({ id: s.id, name: s.name })),
        headPieces: HEAD_PIECES.map((p) => ({ id: p.id, name: p.name })),
        frames: GENERIC_FRAMES,
      },
    });
    if (error) {
      // The host pressed Stop: not an outage, not telemetry — just done.
      if (opts.signal?.aborted) return aborted();
      let reason: string | undefined;
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          reason = res.error;
          // Operator detail stays in the console — the chat gets customer copy.
          console.error('[copilot] ai-event-designer error:', reason,
            reason === 'ai_key_invalid' || reason === 'ai_not_configured'
              ? '(GEMINI_API_KEY missing/rejected — fix in Supabase secrets)'
              : '');
        } catch { /* body unreadable */ }
      }
      reportAiError(`ai_event_designer:copilot:${reason ?? 'network'}`, error, { reason: reason ?? 'network' });
      return offline(offlineReplyFor(reason));
    }
    const res = (data ?? {}) as { reply?: string; actions?: unknown; turnId?: unknown };
    if (typeof res.reply !== 'string' || !res.reply) {
      return offline(OFFLINE_REPLY);
    }
    const { actions, dropped, droppedReasons } = normalizeActionsResult(res.actions, snapshot);
    // Absent on servers older than the telemetry deploy — tolerate, never assume.
    const turnId = typeof res.turnId === 'number' && Number.isFinite(res.turnId) ? res.turnId : null;
    return { reply: res.reply, actions, source: 'ai', dropped, droppedReasons, turnId };
  } catch (e) {
    if (opts.signal?.aborted) return aborted();
    console.warn('[copilot] askCopilot failed', e);
    reportAiError('ai_event_designer:copilot:network', e, { reason: 'network' });
    return offline(OFFLINE_REPLY);
  }
}

/**
 * Thumbs up/down on an assistant turn → agent_turns.feedback (server
 * mode:'feedback'; auth required, not rate-limited). Never throws: false on
 * any failure so the chat can revert its optimistic mark quietly.
 */
export async function sendFeedback(turnId: number, feedback: 1 | -1, note?: string): Promise<boolean> {
  try {
    const { supabase } = await import('./supabase');
    const { error } = await supabase.functions.invoke('ai-event-designer', {
      body: {
        mode: 'feedback',
        turnId,
        feedback,
        ...(note ? { note: note.slice(0, 500) } : {}),
      },
    });
    if (error) {
      console.warn('[copilot] sendFeedback failed', error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[copilot] sendFeedback failed', e);
    return false;
  }
}
