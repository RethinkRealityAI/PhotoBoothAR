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

export type CopilotAction =
  | { tool: 'add_challenge'; proposal: { title: string; emoji: string; points: number; description: string } }
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
        const title = str(a.title);
        if (!title) break;
        out.push({
          tool: 'add_challenge',
          proposal: {
            title,
            emoji: str(a.emoji, 8) || '⭐',
            points: points(a.points),
            description: str(a.description, 300),
          },
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
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          console.warn('[copilot] edge fn error:', res.error);
        } catch { /* body unreadable */ }
      }
      return { reply: OFFLINE_REPLY, actions: [], source: 'offline' };
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
