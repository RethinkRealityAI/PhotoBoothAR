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
import type { ChatMessage } from './eventDesigner';
import { PLATFORM_GUIDE } from './platformGuide';
import type { EventSnapshot } from './eventSnapshot';

/* ── Action types (post-normalization) ───────────────────────────────── */

export interface ChallengeDraft {
  title: string;
  emoji: string;
  points: number;
  description: string;
}

export type CopilotAction =
  | { tool: 'add_challenge'; proposal: ChallengeDraft }
  | { tool: 'add_challenge_pack'; proposal: { theme: string; challenges: ChallengeDraft[] } }
  | { tool: 'update_challenge'; proposal: { challengeId: string; title?: string; emoji?: string; points?: number; active?: boolean } }
  | { tool: 'delete_challenge'; proposal: { challengeId: string } }
  | { tool: 'create_card'; proposal: { cardTitle: string; recipientName: string; cardTemplate: 'storybook' | 'filmstrip'; deadline: string } }
  | { tool: 'get_stats' }
  | { tool: 'share_links' };

const MAX_ACTIONS = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  return { title, emoji: str(a.emoji, 8) || '⭐', points: points(a.points), description };
}

/**
 * Validate raw model actions into executable ones. Strict on ids: update /
 * delete proposals must reference a challengeId that exists in the snapshot
 * (kills hallucinated ids). Unknown tools and missing required args drop the
 * action silently — the reply text still renders.
 */
export function normalizeActions(raw: unknown, snapshot: EventSnapshot | null): CopilotAction[] {
  if (!Array.isArray(raw)) return [];
  const knownIds = new Set((snapshot?.challenges ?? []).map((c) => c.id));
  const out: CopilotAction[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ACTIONS) break;
    const a = (item ?? {}) as Record<string, unknown>;
    switch (a.tool) {
      case 'add_challenge': {
        const draft = challengeDraft(a);
        if (!draft) break;
        out.push({ tool: 'add_challenge', proposal: draft });
        break;
      }
      case 'add_challenge_pack': {
        const drafts = (Array.isArray(a.challenges) ? a.challenges : [])
          .map(challengeDraft)
          .filter((c): c is ChallengeDraft => c !== null)
          .slice(0, 6);
        if (drafts.length === 0) break;
        out.push({
          tool: 'add_challenge_pack',
          proposal: { theme: str(a.theme, 80) || 'Challenge pack', challenges: drafts },
        });
        break;
      }
      case 'update_challenge': {
        const challengeId = str(a.challengeId, 64);
        if (!challengeId || !knownIds.has(challengeId)) break;
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
        if (!challengeId || !knownIds.has(challengeId)) break;
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
            cardTemplate: a.cardTemplate === 'filmstrip' ? 'filmstrip' : 'storybook',
            deadline: DATE_RE.test(str(a.deadline, 10)) ? str(a.deadline, 10) : '',
          },
        });
        break;
      }
      case 'get_stats':
      case 'share_links':
        out.push({ tool: a.tool });
        break;
      default:
        break; // unknown tool — dropped
    }
  }
  return out;
}

/** Gemini requires strict user/model alternation; tool-result turns are sent
 *  as user turns, so consecutive user turns must merge before the wire. */
export function mergeWireTurns(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
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
  /** events.id — for config-level operations (unused by v1 tools). */
  eventUuid: string;
  origin: string;
}

export interface ExecResult {
  ok: boolean;
  /** One-line outcome fed back to the model as a [tool_result] turn. */
  summary: string;
  /** create_card success payload — the chat renders it as a QR link card. */
  card?: { title: string; contributeUrl: string; viewerUrl: string };
}

export async function executeAction(action: CopilotAction, ctx: CopilotCtx): Promise<ExecResult> {
  try {
    switch (action.tool) {
      case 'add_challenge': {
        const { createChallenge } = await import('./db');
        const p = action.proposal;
        const row = await createChallenge(ctx.slug, {
          title: p.title, emoji: p.emoji, points: points(p.points), description: p.description || null, active: true,
        });
        return row
          ? { ok: true, summary: `Challenge "${row.title}" added (id ${row.id}).` }
          : { ok: false, summary: 'Adding the challenge failed.' };
      }
      case 'add_challenge_pack': {
        const { createChallenge } = await import('./db');
        // Card edits pass through the surface data model — re-validate each
        // entry rather than trusting the array shape survived intact.
        const drafts = (Array.isArray(action.proposal.challenges) ? action.proposal.challenges : [])
          .map(challengeDraft)
          .filter((c): c is ChallengeDraft => c !== null);
        if (drafts.length === 0) return { ok: false, summary: 'The pack had no usable challenges.' };
        let added = 0;
        for (const d of drafts) {
          const row = await createChallenge(ctx.slug, {
            title: d.title, emoji: d.emoji, points: points(d.points), description: d.description || null, active: true,
          });
          if (row) added++;
        }
        return added > 0
          ? { ok: true, summary: `Added ${added} of ${drafts.length} "${action.proposal.theme}" challenges.` }
          : { ok: false, summary: 'Adding the challenge pack failed.' };
      }
      case 'update_challenge': {
        const { updateChallenge } = await import('./db');
        const { challengeId, ...patch } = action.proposal;
        const ok = await updateChallenge(ctx.slug, challengeId, { ...patch, ...(patch.points !== undefined ? { points: points(patch.points) } : {}) });
        return { ok, summary: ok ? `Challenge ${challengeId} updated.` : 'Updating the challenge failed.' };
      }
      case 'delete_challenge': {
        const { deleteChallenge } = await import('./db');
        const ok = await deleteChallenge(ctx.slug, action.proposal.challengeId);
        return { ok, summary: ok ? `Challenge ${action.proposal.challengeId} deleted.` : 'Deleting the challenge failed.' };
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
        if (!card) return { ok: false, summary: 'Creating the card failed.' };
        const cUrl = contributeUrl(card, ctx.origin);
        const vUrl = `${ctx.origin}${viewerPath(card.public_id)}`;
        return {
          ok: true,
          summary: `Card "${card.title}" created. Contribute: ${cUrl} · view: ${vUrl}`,
          card: { title: card.title, contributeUrl: cUrl, viewerUrl: vUrl },
        };
      }
      default:
        return { ok: false, summary: 'Nothing to execute.' };
    }
  } catch (e) {
    console.error('[copilot] executeAction', action.tool, e);
    return { ok: false, summary: `${action.tool} failed unexpectedly.` };
  }
}

/* ── Wire client ─────────────────────────────────────────────────────── */

export interface CopilotResult {
  reply: string;
  actions: CopilotAction[];
  source: 'ai' | 'offline';
}

const OFFLINE_REPLY =
  'I can’t reach the AI service right now, so I can answer from the built-in guide only: ' +
  'use the studio tabs for changes (Challenges, Cards, Share), and try me again in a moment.';

/** Turn the edge fn's error code into an honest, owner-actionable message —
 *  a rejected key is a config problem, not a flaky connection. */
function offlineReplyFor(reason?: string): string {
  switch (reason) {
    case 'ai_not_configured':
    case 'ai_key_invalid':
      return 'The AI isn’t reachable because its API key is missing or being rejected by Google. ' +
        'A platform admin needs to set a valid GEMINI_API_KEY in the Supabase secrets. ' +
        'Until then I can still point you to the studio tabs (Challenges, Cards, Share).';
    case 'rate_limited':
      return 'You’ve hit the hourly AI limit — give it a few minutes and ask me again.';
    case 'ai_quota':
      return 'The AI plan’s quota is exhausted right now. Try again later, or check billing in Google AI Studio.';
    default:
      return OFFLINE_REPLY;
  }
}

export async function askCopilot(
  messages: ChatMessage[],
  snapshot: EventSnapshot | null,
): Promise<CopilotResult> {
  try {
    const { supabase } = await import('./supabase');
    const { formatSnapshot } = await import('./eventSnapshot');
    const { data, error } = await supabase.functions.invoke('ai-event-designer', {
      body: {
        mode: 'copilot',
        messages: mergeWireTurns(messages),
        context: snapshot ? formatSnapshot(snapshot) : '',
        docs: PLATFORM_GUIDE,
      },
    });
    if (error) {
      let reason: string | undefined;
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          reason = res.error;
          console.warn('[copilot] edge fn error:', reason);
        } catch { /* body unreadable */ }
      }
      return { reply: offlineReplyFor(reason), actions: [], source: 'offline' };
    }
    const res = (data ?? {}) as { reply?: string; actions?: unknown };
    if (typeof res.reply !== 'string' || !res.reply) {
      return { reply: OFFLINE_REPLY, actions: [], source: 'offline' };
    }
    return { reply: res.reply, actions: normalizeActions(res.actions, snapshot), source: 'ai' };
  } catch (e) {
    console.warn('[copilot] askCopilot failed', e);
    return { reply: OFFLINE_REPLY, actions: [], source: 'offline' };
  }
}
