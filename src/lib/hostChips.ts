/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Greetings, quick-action chips and example prompts for the three host
 * chats — DYNAMIC, from the event type and what the checklist says is still
 * missing, instead of the constants each chat used to hard-code. A chip is
 * data (`ChipRun`), never a closure: the chat maps each kind onto the
 * plumbing it already has (open a card, send a message, run a read-only
 * tool, show the checklist, open the starter pack card).
 *
 * PURE: no React, no supabase.
 */
import type { CopilotAction } from './copilot';
import type { EventSnapshot } from './eventSnapshot';
import type { ChecklistId, ChecklistItem } from './eventChecklist';
import { missingIds } from './eventChecklist';
import { packForEventType } from './contentPacks';
import { FILTER_SHADERS } from './shaders';
import { HEAD_PIECES } from './headPieces';
import type { TemplateId } from './eventTemplates';

export type ChipRun =
  | { kind: 'open'; action: CopilotAction }
  | { kind: 'send'; text: string }
  | { kind: 'readonly'; action: CopilotAction }
  | { kind: 'checklist' }
  | { kind: 'pack'; packId: TemplateId };

export interface Chip {
  id: string;
  label: string;
  run: ChipRun;
}

export type ChipMode = 'build' | 'platform';
export type GreetingMode = 'concierge' | ChipMode;

const DEFAULT_FILTER_ID = FILTER_SHADERS.find((s) => s.id !== 'none')?.id ?? 'none';
const DEFAULT_PIECE_ID = HEAD_PIECES[0]?.id ?? '';

const CONCIERGE_GREETING =
  "Tell me about your event — who or what are we celebrating? I'll design the whole thing: " +
  'the look, the name, the guest link. You can fine-tune every detail afterwards.';

const CONCIERGE_SUGGESTIONS = [
  "Jenna and Jake's wedding on 2026-09-12",
  'A black-tie charity gala in November',
  "My mum's 60th — family joins from abroad",
];

const PLATFORM_GREETING =
  'Ask me anything — how Beamwall works, what’s in your event, or tell me what to change ' +
  '(“add a scavenger-hunt challenge worth 20 points”, “make a card for Grandma”).';

/** One nudge per event type, used when the build greeting has work to suggest. */
const TYPE_NUDGE: Record<string, string> = {
  wedding: 'For a wedding, a signature frame with your names and a first-dance challenge go a long way.',
  gala: 'For a gala, an elegant frame and a table-of-ten challenge get the room posting.',
  birthday: 'For a birthday, a cake-moment challenge and a fun 3D prop are the crowd favourites.',
  corporate: 'For a team event, a team-huddle challenge and a clean branded frame work best.',
  party: 'For a party, a neon filter and a dance-floor challenge set the tone.',
};

const MISSING_WORDS: Partial<Record<ChecklistId, string>> = {
  frame: 'a frame',
  filter: 'a filter',
  prop: 'a 3D prop',
  challenges: 'some challenges',
};

function joinList(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The first assistant line of a chat. Concierge: today's opener. Build: names
 * the freshly created event and what is still missing. Platform: the general
 * opener plus a starter-pack offer when the event has no challenges.
 */
export function greetingFor(input: {
  mode: GreetingMode;
  eventType?: string | null;
  name?: string | null;
  missing?: ChecklistId[];
}): string {
  const missing = input.missing ?? [];
  const name = input.name?.trim() ?? '';
  if (input.mode === 'concierge') return CONCIERGE_GREETING;
  if (input.mode === 'build') {
    const head = name ? `“${name}” is created — in draft for now.` : 'Your event is created — in draft for now.';
    const live = 'The moment you go live, guests can scan in, take pictures, and beam them to your wall.';
    const todo = missing.map((id) => MISSING_WORDS[id]).filter((w): w is string => Boolean(w));
    const next = todo.length > 0
      ? `Next up: ${joinList(todo)}. ${TYPE_NUDGE[input.eventType ?? ''] ?? ''}`.trim()
      : 'The look and content are in place.';
    return `${head} ${live} ${next} Tap a chip below or just tell me — and I can test it or take you live right here.`;
  }
  const packOffer = missing.includes('challenges')
    ? ' This event has no challenges yet — I can add a starter pack in one tap.'
    : '';
  return `${PLATFORM_GREETING}${packOffer}`;
}

/**
 * Quick-action chips. Missing checklist items come FIRST and done items are
 * dropped; "Go live" appears only while not live; a starter-pack chip appears
 * when the event has no challenges (zero AI round-trip — it opens the pack
 * card straight from the registry).
 */
export function quickChipsFor(input: {
  mode: ChipMode;
  snapshot: EventSnapshot | null;
  checklist: ChecklistItem[];
}): Chip[] {
  const s = input.snapshot;
  if (!s) return [];
  const missing = new Set(missingIds(input.checklist));
  const packId = packForEventType(s.eventType).id;
  const live = s.status === 'live';
  const newChallenge: Chip = {
    id: 'challenge', label: '🏆 Challenge',
    run: { kind: 'open', action: { tool: 'add_challenge', proposal: { title: 'New photo mission', emoji: '⭐', points: 10, description: '' } } },
  };
  const starterPack: Chip = { id: 'pack', label: '🎁 Starter pack', run: { kind: 'pack', packId } };
  const goLive: Chip = { id: 'live', label: '🚀 Go live', run: { kind: 'open', action: { tool: 'go_live' } } };

  if (input.mode === 'build') {
    const chips: Chip[] = [];
    if (missing.has('frame')) {
      chips.push({
        id: 'frame', label: '🖼 Frame',
        run: { kind: 'open', action: { tool: 'generate_frame', proposal: { prompt: `An elegant frame for "${s.name}" — refined ornament hugging the edges, centre fully clear` } } },
      });
    }
    if (missing.has('filter')) {
      chips.push({ id: 'filter', label: '🎨 Filter', run: { kind: 'open', action: { tool: 'set_filter', proposal: { shaderId: DEFAULT_FILTER_ID } } } });
    }
    if (missing.has('prop')) {
      chips.push({ id: 'prop', label: '👑 3D prop', run: { kind: 'open', action: { tool: 'add_head_piece', proposal: { source: 'builtin', pieceId: DEFAULT_PIECE_ID } } } });
    }
    if (missing.has('challenges')) chips.push(starterPack, newChallenge);
    chips.push({ id: 'test', label: '📱 Test', run: { kind: 'readonly', action: { tool: 'test_experience' } } });
    if (!live) chips.push(goLive);
    chips.push(
      { id: 'checklist', label: '📋 Checklist', run: { kind: 'checklist' } },
      { id: 'recommend', label: '✨ Recommend', run: { kind: 'send', text: 'Recommend a frame and a filter that fit this event, and propose them.' } },
    );
    return chips;
  }

  const chips: Chip[] = [];
  if (missing.has('challenges')) chips.push(starterPack);
  chips.push(
    { id: 'stats', label: '📊 Stats', run: { kind: 'readonly', action: { tool: 'get_stats' } } },
    { id: 'share', label: '🔗 Share links', run: { kind: 'readonly', action: { tool: 'share_links' } } },
    { ...newChallenge, label: '🏆 New challenge' },
    {
      id: 'card', label: '💌 New card',
      run: { kind: 'open', action: { tool: 'create_card', proposal: { cardTitle: `Memories for ${s.name}`, recipientName: '', cardTemplate: 'storybook', deadline: '' } } },
    },
  );
  if (!missing.has('challenges')) {
    // AI round-trip on purpose: the model designs a THEMED set from the live
    // event snapshot, then it arrives as one confirm card.
    chips.push({ id: 'pack-ai', label: '🎁 Challenge pack', run: { kind: 'send', text: 'Design a themed pack of 5 photo challenges that fit this event.' } });
  }
  if (!live) chips.push(goLive);
  return chips;
}

const EXAMPLES_BY_TYPE: Record<string, string[]> = {
  wedding: [
    'Add a first-dance challenge worth 20 points',
    'Generate a frame with our names in script lettering',
    'Make a card guests can sign for the couple',
  ],
  gala: [
    'Add a table-of-ten challenge worth 15 points',
    'Generate an art-deco frame in brass and black',
    'Add a 3D masquerade mask to wear',
  ],
  birthday: [
    'Add a cake-moment challenge worth 25 points',
    'Generate a frame that matches my theme',
    'Make me a 3D crown to wear',
  ],
  corporate: [
    'Add a team-huddle challenge worth 15 points',
    'Generate a clean frame with a band for our logo',
    'Set a subtle filter for the whole booth',
  ],
  party: [
    'Add a dance-floor challenge worth 20 points',
    'Set a neon filter for the whole booth',
    'Make me a 3D crown to wear',
  ],
};

const EXAMPLES_GENERIC = [
  'Add a photo challenge worth 20 points',
  'Generate a frame that matches my theme',
  'Make me a 3D crown to wear',
];

/** First-time helper prompts (empty thread only) — each prefills the input. */
export function examplePromptsFor(input: { mode: ChipMode; eventType?: string | null }): string[] {
  return [...(EXAMPLES_BY_TYPE[input.eventType ?? ''] ?? EXAMPLES_GENERIC)];
}

/** The concierge's suggestion chips: today's three plus the deferral. */
export function conciergeSuggestionsFor(): string[] {
  return [...CONCIERGE_SUGGESTIONS, 'Just set it all up for me'];
}
