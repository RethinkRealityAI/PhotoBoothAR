/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What a confirm card is still missing before it may be acted on.
 *
 * Two different holes this closes.
 *
 * 1. The confirm card's fields are two-way bound and host-editable, so what the
 *    model proposed is not what gets confirmed. A host who clears the title and
 *    presses "Add challenge" used to get `normalizeActions` dropping the action
 *    and the flat message "That didn't look valid, so nothing changed" — true,
 *    but it never says which box is empty.
 *
 * 2. The GENERATION cards (`generate_frame`, `add_head_piece` with
 *    source 'generate') skip `normalizeActions` entirely on confirm, because
 *    they kick off an async job instead of executing a mutation. So an empty or
 *    two-word brief went straight to the provider, and the host paid for
 *    whatever average thing the model invented to fill the silence.
 *
 * Required gaps MIRROR `normalizeActions`'s hard requirements — nothing extra,
 * or we would block proposals the executor would happily have run. Quality gaps
 * come from assetBrief.ts and are deliberately NOT hard: a host who knows they
 * want "a gold frame" should be asked once and then believed, not argued with.
 * The caller enforces that distinction (`required` below).
 *
 * Pure, so the card, the confirm handler and the tests all reason from one
 * source. No React, no supabase.
 */
import { frameBriefGaps, pieceBriefGaps, type BriefGap } from './assetBrief';
import { COPILOT_TOOLS, type ToolParam, type ToolSpec } from './copilotTools';
import { packById } from './contentPacks';

export interface ProposalGap extends BriefGap {
  /**
   * true  → the action cannot run at all without this (empty title, no id).
   * false → it would run, but the result is likely to disappoint. Ask once,
   *         then let the host through on the next press.
   */
  required: boolean;
}

/** ISO date, the same shape `normalizeActions` accepts for set_event_date. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function filled(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function need(id: string, question: string, example: string): ProposalGap[] {
  return [{ id, question, example, required: true }];
}

/**
 * Gap ids are the host-facing vocabulary the chat and its tests key on; where
 * a parameter's wire name differs from that id, this map keeps the id stable.
 */
const GAP_IDS: Record<string, string> = {
  challengeId: 'challenge',
  borderId: 'frame',
  shaderId: 'filter',
  experienceId: 'experience',
  pieceId: 'piece',
};

function present(p: ToolParam, v: unknown): boolean {
  if (p.type === 'array') return Array.isArray(v) && v.length > 0;
  return filled(v);
}

/** One gap per REQUIRED registry parameter the proposal leaves empty. */
function requiredParamGaps(tool: string, proposal: Record<string, unknown>): ProposalGap[] {
  const spec = (COPILOT_TOOLS as Record<string, ToolSpec>)[tool];
  if (!spec) return [];
  const out: ProposalGap[] = [];
  for (const [name, p] of Object.entries(spec.params)) {
    if (!p.required || present(p, proposal[name])) continue;
    out.push({
      id: GAP_IDS[name] ?? name,
      question: p.ask?.question ?? p.description,
      example: p.ask?.example ?? p.example,
      required: true,
    });
  }
  return out;
}

/** The registry's ask for one parameter, as a required gap. */
function needParam(tool: keyof typeof COPILOT_TOOLS, name: string): ProposalGap[] {
  const p = (COPILOT_TOOLS[tool].params as Record<string, ToolParam>)[name];
  return need(GAP_IDS[name] ?? name, p.ask?.question ?? p.description, p.ask?.example ?? p.example);
}

/**
 * A brief's quality gaps, promoted to `required` only when the brief is
 * effectively absent. assetBrief reports that case as `detail` — under three
 * meaningful words — and `normalizeActions` would reject an empty prompt
 * anyway, so treating it as hard costs the host nothing they could have had.
 */
function briefGaps(gaps: BriefGap[]): ProposalGap[] {
  return gaps.map((g) => ({ ...g, required: g.id === 'detail' }));
}

/**
 * Everything the confirm handler needs before it may execute `tool`, given the
 * proposal as it stands in the card RIGHT NOW. Empty array = good to go.
 *
 * Unknown tools return [] — read-only tools (get_stats, share_links,
 * test_experience) and no-argument tools (go_live) have nothing to require, and
 * inventing a requirement for a tool we don't know about would dead-end it.
 */
export function proposalGaps(tool: string, proposal: Record<string, unknown>): ProposalGap[] {
  switch (tool) {
    // The date must already be in the ISO shape normalizeActions accepts —
    // a present-but-unparsed date is as much a gap as an empty one.
    case 'set_event_date':
      return typeof proposal.date === 'string' && DATE_RE.test(proposal.date.trim()) ? []
        : needParam('set_event_date', 'date');

    // Spending tools: an empty brief is a hard gap, and a brief too vague to be
    // worth a credit is a soft one — that judgement lives in assetBrief.ts.
    case 'generate_frame':
      return briefGaps(frameBriefGaps(typeof proposal.prompt === 'string' ? proposal.prompt : ''));

    case 'add_head_piece':
      if (proposal.source === 'generate') {
        return briefGaps(pieceBriefGaps(typeof proposal.prompt === 'string' ? proposal.prompt : ''));
      }
      return filled(proposal.pieceId) ? [] : needParam('add_head_piece', 'pieceId');

    // A known packId is a complete pack (the normalizer expands it); otherwise
    // the challenges must be there — the registry marks them optional only
    // because of packId.
    case 'add_challenge_pack':
      if (packById(typeof proposal.packId === 'string' ? proposal.packId : null)) return [];
      return Array.isArray(proposal.challenges) && proposal.challenges.length > 0 ? []
        : needParam('add_challenge_pack', 'challenges');

    // Every field is optional, but ALL of them blank is nothing to record.
    case 'update_brief':
      return (['occasion', 'honorees', 'palette', 'tone', 'avoid', 'notes'] as const).some((k) => filled(proposal[k])) ? []
        : need('brief', 'What should I note about the event?', 'the palette is gold and navy, and please avoid balloons');

    // Every other tool: its REQUIRED registry parameters, nothing more. An
    // unknown tool has no registry entry and so returns [] (see the doc above).
    default:
      return requiredParamGaps(tool, proposal);
  }
}

/** Gaps that make the action impossible, as opposed to merely disappointing. */
export function requiredGaps(gaps: ProposalGap[]): ProposalGap[] {
  return gaps.filter((g) => g.required);
}

/**
 * The chat message to send instead of acting. Asks for what is missing in the
 * host's own terms, with an example — people answer examples far more readily
 * than they answer field names. Capped at two questions: a message listing five
 * reads as a form and gets abandoned.
 *
 * `spending` tightens the opening, because the honest reason we stop a
 * generation is that the host is about to pay for it. `again` is the second
 * press on a soft gap: we have asked, so we say we are going ahead.
 */
export function gapPrompt(
  gaps: ProposalGap[],
  opts: { spending?: boolean; canProceed?: boolean } = {},
): string {
  if (gaps.length === 0) return '';
  const questions = gaps
    .slice(0, 2)
    .map((g) => `${g.question} (e.g. ${g.example})`)
    .join(' And ');
  const lead = opts.spending
    ? 'Before I spend anything on this — '
    : 'One more thing before I can do that — ';
  const tail = opts.canProceed
    ? ' Edit the card above and I’ll use it, or press the button again to go ahead as-is.'
    : ' Edit the card above, or just tell me here.';
  return `${lead}${questions}.${tail}`;
}
