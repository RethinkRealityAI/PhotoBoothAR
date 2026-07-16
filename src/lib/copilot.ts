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
import { FILTER_SHADERS } from './shaders';
import { HEAD_PIECE_MAP, HEAD_PIECES } from './headPieces';
import { BORDER_MAP, GENERIC_FRAMES, GENERIC_FRAME_IDS } from './borders';
import { normalizeValidation } from './challengeValidation';

/* ── Action types (post-normalization) ───────────────────────────────── */

export interface ChallengeDraft {
  title: string;
  emoji: string;
  points: number;
  description: string;
  /** Optional AI photo-check: what the guest's photo must contain to count. */
  validationPrompt?: string;
}

export type CopilotAction =
  | { tool: 'add_challenge'; proposal: ChallengeDraft }
  | { tool: 'add_challenge_pack'; proposal: { theme: string; challenges: ChallengeDraft[] } }
  | { tool: 'update_challenge'; proposal: { challengeId: string; title?: string; emoji?: string; points?: number; active?: boolean } }
  | { tool: 'delete_challenge'; proposal: { challengeId: string } }
  | { tool: 'create_card'; proposal: { cardTitle: string; recipientName: string; cardTemplate: 'storybook' | 'filmstrip'; deadline: string } }
  // Experience-building tools (Event Concierge post-create build phase).
  | { tool: 'generate_frame'; proposal: { prompt: string } }
  | { tool: 'add_frame'; proposal: { borderId: string } }
  | { tool: 'set_filter'; proposal: { shaderId: string } }
  | { tool: 'add_head_piece'; proposal: { source: 'builtin'; pieceId: string } | { source: 'generate'; prompt: string } }
  | { tool: 'set_default_experience'; proposal: { experienceId: string } }
  | { tool: 'set_event_date'; proposal: { date: string } }
  | { tool: 'rename_event'; proposal: { name: string } }
  | { tool: 'go_live' }
  | { tool: 'test_experience' }
  | { tool: 'get_stats' }
  | { tool: 'share_links' };

const MAX_ACTIONS = 3;
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

/**
 * Validate raw model actions into executable ones. Strict on ids: update /
 * delete proposals must reference a challengeId that exists in the snapshot
 * (kills hallucinated ids). Unknown tools and missing required args drop the
 * action silently — the reply text still renders.
 */
export function normalizeActions(raw: unknown, snapshot: EventSnapshot | null): CopilotAction[] {
  if (!Array.isArray(raw)) return [];
  const knownIds = new Set((snapshot?.challenges ?? []).map((c) => c.id));
  const expIds = new Set((snapshot?.experiences ?? []).map((e) => e.id));
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
      case 'generate_frame': {
        const prompt = str(a.prompt, 500);
        if (!prompt) break;
        out.push({ tool: 'generate_frame', proposal: { prompt } });
        break;
      }
      case 'add_frame': {
        // Only the generic (no event-locked text) built-ins may be added as-is.
        const borderId = str(a.borderId, 40);
        if (!borderId || !GENERIC_FRAME_IDS.has(borderId)) break;
        out.push({ tool: 'add_frame', proposal: { borderId } });
        break;
      }
      case 'set_event_date': {
        const date = str(a.date, 10);
        if (!DATE_RE.test(date)) break;
        out.push({ tool: 'set_event_date', proposal: { date } });
        break;
      }
      case 'rename_event': {
        const name = str(a.name, 80);
        if (!name) break;
        out.push({ tool: 'rename_event', proposal: { name } });
        break;
      }
      case 'set_filter': {
        const shaderId = str(a.shaderId, 40);
        if (!shaderId || !FILTER_IDS.has(shaderId)) break;
        out.push({ tool: 'set_filter', proposal: { shaderId } });
        break;
      }
      case 'add_head_piece': {
        if (a.source === 'generate') {
          const prompt = str(a.prompt, 300);
          if (!prompt) break;
          out.push({ tool: 'add_head_piece', proposal: { source: 'generate', prompt } });
        } else {
          const pieceId = str(a.pieceId, 40);
          if (!pieceId || !HEAD_PIECE_MAP[pieceId]) break;
          out.push({ tool: 'add_head_piece', proposal: { source: 'builtin', pieceId } });
        }
        break;
      }
      case 'set_default_experience': {
        const experienceId = str(a.experienceId, 64);
        if (!experienceId || !expIds.has(experienceId)) break;
        out.push({ tool: 'set_default_experience', proposal: { experienceId } });
        break;
      }
      case 'go_live':
      case 'test_experience':
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
  /** go_live success → the event's new lifecycle status ('live'). */
  status?: string;
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
  return publishAndPin(ctx, experienceId, fitScale ?? undefined, 'piece');
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
    const { error: pubErr } = await supabase
      .from('experiences')
      .update(patch)
      .eq('id', experienceId)
      .eq('event_id', ctx.slug);
    if (pubErr) {
      return { ok: false, summary: `The ${noun} was generated but could not be published — publish it from your studio Library.` };
    }
    const pinned = await pinDefault(ctx, experienceId);
    return pinned
      ? { ok: true, summary: `Your ${noun} is live and set as the booth default.` }
      : { ok: true, summary: `Your ${noun} is published, but setting it as the booth default failed — set it in the studio Library.` };
  } catch (e) {
    console.error('[copilot] publishAndPin', kind, e);
    return { ok: false, summary: `Applying the ${noun} failed unexpectedly.` };
  }
}

export async function executeAction(action: CopilotAction, ctx: CopilotCtx): Promise<ExecResult> {
  // Every copilot tool acts on a specific event. With no event selected, ctx.slug
  // (and eventUuid) are empty, and any write hits the tenant RLS wall — an INSERT
  // with event_id='' gives event_org('')=null → is_org_member(null)=false → 403
  // "new row violates row-level security policy". Bail early with a clear message
  // instead of a bare "…failed". (The floating panel leaves no event selected for
  // hosts with more than one event until they pick one.)
  if (!ctx.slug) {
    return { ok: false, summary: 'I’m not pointed at an event yet — pick one in the panel above and I’ll set it up right away.' };
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
        return row
          ? { ok: true, summary: `Challenge "${row.title}" added (id ${row.id})${p.validationPrompt ? ' with an AI photo check' : ''}.` }
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
            validation: draftValidation(d),
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
      case 'set_filter': {
        const { buildFilterExperienceDraft } = await import('./studio/copilotExperience');
        const { createExperience } = await import('./db');
        const draft = buildFilterExperienceDraft(action.proposal.shaderId);
        if (!draft) return { ok: false, summary: 'That filter isn’t available.' };
        const exp = await createExperience(ctx.slug, draft);
        if (!exp) return { ok: false, summary: 'Adding the filter failed.' };
        const pinned = await pinDefault(ctx, exp.id);
        return {
          ok: true,
          summary: `Filter "${exp.name}" added${pinned ? ' and set as the booth default' : ' (set it as the booth default in the studio Library)'}.`,
        };
      }
      case 'add_head_piece': {
        // Generated pieces run through the async preview card, not here.
        if (action.proposal.source !== 'builtin') {
          return { ok: false, summary: 'That 3D piece needs generating first.' };
        }
        const { buildHeadPieceExperienceDraft } = await import('./studio/copilotExperience');
        const { createExperience } = await import('./db');
        const draft = buildHeadPieceExperienceDraft(action.proposal.pieceId);
        if (!draft) return { ok: false, summary: 'That 3D piece isn’t available.' };
        const exp = await createExperience(ctx.slug, draft);
        if (!exp) return { ok: false, summary: 'Adding the 3D piece failed.' };
        const pinned = await pinDefault(ctx, exp.id);
        return {
          ok: true,
          summary: `3D piece "${exp.name}" added${pinned ? ' and set as the booth default' : ' (set it as the booth default in the studio Library)'}.`,
        };
      }
      case 'add_frame': {
        const border = BORDER_MAP[action.proposal.borderId];
        if (!border || !GENERIC_FRAME_IDS.has(border.id)) return { ok: false, summary: 'That frame isn’t available.' };
        const { uploadAsset, createExperience } = await import('./db');
        const url = await uploadAsset(new Blob([border.svg], { type: 'image/svg+xml' }), `${border.id}.svg`);
        if (!url) return { ok: false, summary: 'Adding the frame failed.' };
        const exp = await createExperience(ctx.slug, {
          name: border.name, kind: border.kind, asset_url: url,
          config: {}, is_published: true, featured: true, sort_order: 0,
        });
        if (!exp) return { ok: false, summary: 'Adding the frame failed.' };
        const pinned = await pinDefault(ctx, exp.id);
        return {
          ok: true,
          summary: `Frame "${border.name}" added${pinned ? ' and set as the booth default' : ' (set it as the booth default in the studio Library)'}.`,
        };
      }
      case 'set_default_experience': {
        const ok = await pinDefault(ctx, action.proposal.experienceId);
        return { ok, summary: ok ? 'Booth default updated.' : 'Setting the booth default failed.' };
      }
      case 'set_event_date': {
        const { updateEventDate } = await import('./host');
        const ok = await updateEventDate(ctx.eventUuid, action.proposal.date);
        return { ok, summary: ok ? `Event date set to ${action.proposal.date}.` : 'Updating the date failed.' };
      }
      case 'rename_event': {
        const { updateEventName } = await import('./host');
        const ok = await updateEventName(ctx.eventUuid, action.proposal.name);
        return { ok, summary: ok ? `Event renamed to "${action.proposal.name}".` : 'Renaming the event failed.' };
      }
      case 'go_live': {
        const { updateEventStatus } = await import('./host');
        const ok = await updateEventStatus(ctx.eventUuid, 'live');
        return ok
          ? { ok: true, summary: 'Your event is LIVE — guests can now take pictures and post to the wall.', status: 'live' }
          : { ok: false, summary: 'Going live failed — try again in a moment.' };
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
        // The live catalogs ride along so the model proposes only real ids
        // (the client normalizer still validates and drops anything invalid).
        filters: FILTER_SHADERS.filter((s) => s.id !== 'none').map((s) => ({ id: s.id, name: s.name })),
        headPieces: HEAD_PIECES.map((p) => ({ id: p.id, name: p.name })),
        frames: GENERIC_FRAMES,
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
