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
    case 'add_challenge':
      return filled(proposal.title) ? []
        : need('title', 'What should the challenge be called?', 'Best dance move');

    case 'add_challenge_pack':
      return Array.isArray(proposal.challenges) && proposal.challenges.length > 0 ? []
        : need('challenges', 'What should the challenges be?', 'a five-challenge pack for a wedding reception');

    case 'update_challenge':
    case 'delete_challenge':
      return filled(proposal.challengeId) ? []
        : need('challenge', 'Which challenge do you mean?', 'the name of the one you want to change');

    case 'create_card':
      return filled(proposal.cardTitle) ? []
        : need('cardTitle', 'What should the card be called?', 'Happy 40th, Maya!');

    case 'add_frame':
      return filled(proposal.borderId) ? []
        : need('frame', 'Which ready-made frame?', 'pick one from the list');

    case 'set_filter':
      return filled(proposal.shaderId) ? []
        : need('filter', 'Which filter?', 'pick one from the list');

    case 'set_default_experience':
      return filled(proposal.experienceId) ? []
        : need('experience', 'Which experience should the booth open with?', 'one of the experiences in your studio');

    case 'rename_event':
      return filled(proposal.name) ? []
        : need('name', 'What should the event be called?', 'Maya & Sam’s Wedding');

    case 'set_event_date':
      return typeof proposal.date === 'string' && DATE_RE.test(proposal.date.trim()) ? []
        : need('date', 'What date is the event?', '2026-09-12');

    // Spending tools: an empty brief is a hard gap, and a brief too vague to be
    // worth a credit is a soft one — that judgement lives in assetBrief.ts.
    case 'generate_frame':
      return briefGaps(frameBriefGaps(typeof proposal.prompt === 'string' ? proposal.prompt : ''));

    case 'add_head_piece':
      if (proposal.source === 'generate') {
        return briefGaps(pieceBriefGaps(typeof proposal.prompt === 'string' ? proposal.prompt : ''));
      }
      return filled(proposal.pieceId) ? []
        : need('piece', 'Which 3D prop?', 'pick one from the list');

    default:
      return [];
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
