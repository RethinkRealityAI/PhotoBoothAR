/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Content packs — the starter content an event gets on day one so it never
 * opens with a look and zero missions. One pack per event template, keyed by
 * TemplateId; seeded client-side on create through the existing RLS-scoped
 * `createChallenge` loop (`executeAction(packAction(pack))`), and offered by
 * the copilot through `add_challenge_pack.packId` (zero AI round-trip).
 *
 * PURE registry: generic, tasteful copy — no event branding, no names. Every
 * draft is shaped exactly like the copilot's ChallengeDraft so it round-trips
 * `normalizeActions` with nothing dropped (contentPacks.test.ts proves it).
 */
import type { ChallengeDraft, CopilotAction } from './copilot';
import type { CardTemplateId } from './cardTemplates';
import type { TemplateId } from './eventTemplates';

export interface ContentPack {
  id: TemplateId;
  /** The pack's theme — the confirm card heading and the challenges' group name. */
  theme: string;
  /** A guest-facing line the copy generator may lean on. */
  tagline: string;
  cardTemplate: CardTemplateId;
  /** The keepsake card title seeded beside the pack, from the event name. */
  cardTitle: (eventName: string) => string;
  /** 4-6 missions; 1-2 carry an AI photo check where a visual test is obvious. */
  challenges: ChallengeDraft[];
}

const TWO_PEOPLE = 'The photo shows at least two people';

export const CONTENT_PACKS: Record<TemplateId, ContentPack> = {
  wedding: {
    id: 'wedding',
    theme: 'Wedding reception',
    tagline: 'Every moment, beamed to the wall.',
    cardTemplate: 'storybook',
    cardTitle: (name) => `Wishes for ${name}`,
    challenges: [
      { title: 'First dance floor', emoji: '💃', points: 20, description: 'Catch the couple — or anyone — mid-move on the dance floor.' },
      { title: 'Toast to the couple', emoji: '🥂', points: 15, description: 'Raise a glass together and beam the cheers.', validationPrompt: 'At least two people are visible raising a glass or cup' },
      { title: 'Table crew', emoji: '👯', points: 10, description: 'Everyone at your table in one frame.', validationPrompt: TWO_PEOPLE },
      { title: 'Best dressed', emoji: '✨', points: 15, description: 'Show off the outfit you chose for today.' },
      { title: 'Sweetest moment', emoji: '💕', points: 25, description: 'A hug, a kiss on the cheek, a hand held — capture the tenderness.' },
    ],
  },
  gala: {
    id: 'gala',
    theme: 'Gala evening',
    tagline: 'An evening worth capturing.',
    cardTemplate: 'filmstrip',
    cardTitle: (name) => `Thank you, from ${name}`,
    challenges: [
      { title: 'Red carpet arrival', emoji: '🌟', points: 15, description: 'Strike your arrival pose before you head inside.' },
      { title: 'Table of ten', emoji: '🍽️', points: 10, description: 'Gather your whole table into one shot.', validationPrompt: TWO_PEOPLE },
      { title: 'Black-tie best', emoji: '🎩', points: 15, description: 'Your finest evening look, front and centre.' },
      { title: 'Raise the paddle', emoji: '🙌', points: 25, description: 'Hands up for the cause — show us your support.', validationPrompt: 'At least one person has a hand raised in the air' },
      { title: 'Sparkle close-up', emoji: '💎', points: 20, description: 'Jewellery, cufflinks, a sequin — the detail that shines tonight.' },
    ],
  },
  birthday: {
    id: 'birthday',
    theme: 'Birthday party',
    tagline: 'Make a wish, strike a pose.',
    cardTemplate: 'polaroid',
    cardTitle: (name) => `Birthday wishes — ${name}`,
    challenges: [
      { title: 'Cake moment', emoji: '🎂', points: 25, description: 'You and the cake — candles or crumbs.', validationPrompt: 'A cake or dessert is clearly visible in the photo' },
      { title: 'Party hat parade', emoji: '🥳', points: 10, description: 'Wear anything festive on your head.', validationPrompt: 'Someone in the photo is wearing a party hat or festive headwear' },
      { title: 'Squad shot', emoji: '👯', points: 15, description: 'Round up your crew for one big frame.' },
      { title: 'Birthday hug', emoji: '🤗', points: 20, description: 'Wrap the guest of honour in a hug.' },
      { title: 'Silliest face', emoji: '🤪', points: 10, description: 'Your goofiest expression — no holding back.' },
    ],
  },
  corporate: {
    id: 'corporate',
    theme: 'Team day',
    tagline: 'Capture the team spirit.',
    cardTemplate: 'filmstrip',
    cardTitle: (name) => `Notes from ${name}`,
    challenges: [
      { title: 'Team huddle', emoji: '🤝', points: 15, description: 'Your whole team in one frame.', validationPrompt: TWO_PEOPLE },
      { title: 'Meet someone new', emoji: '👋', points: 20, description: 'Snap a photo with a colleague you met today.' },
      { title: 'Thumbs up for the win', emoji: '👍', points: 10, description: 'Celebrate a highlight with a thumbs up.', validationPrompt: 'At least one person is giving a thumbs up' },
      { title: 'Behind the scenes', emoji: '🎬', points: 15, description: 'The moment before it all comes together.' },
      { title: 'Power pose', emoji: '💪', points: 10, description: 'Your most confident stance.' },
    ],
  },
  party: {
    id: 'party',
    theme: 'Party mode',
    tagline: 'Lights on, cameras up.',
    cardTemplate: 'polaroid',
    cardTitle: (name) => `Memories from ${name}`,
    challenges: [
      { title: 'Dance floor cam', emoji: '🕺', points: 20, description: 'Caught mid-move on the dance floor.' },
      { title: 'Group jump', emoji: '🙌', points: 25, description: 'Everyone in the air at once — or trying.', validationPrompt: 'At least two people are visible and someone is jumping' },
      { title: 'Best outfit', emoji: '👗', points: 15, description: 'Tonight’s look, head to toe.' },
      { title: 'Cheers!', emoji: '🍹', points: 10, description: 'Glasses up with a friend.', validationPrompt: 'At least two people are visible raising a glass or cup' },
      { title: 'Neon glow', emoji: '💡', points: 15, description: 'Find the brightest light in the room and pose in it.' },
    ],
  },
};

/** Registry order = template order; also the `packId` enum the model sees. */
export const PACK_IDS = Object.keys(CONTENT_PACKS) as readonly TemplateId[];

export function packById(id: string | null | undefined): ContentPack | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CONTENT_PACKS, id)
    ? CONTENT_PACKS[id as TemplateId]
    : null;
}

/** The pack for an events.event_type value; 'remote' and anything unknown → party. */
export function packForEventType(eventType: string | null | undefined): ContentPack {
  return packById(eventType) ?? CONTENT_PACKS.party;
}

/** The pack as an `add_challenge_pack` action — the same shape the copilot
 *  executes, so seeding at create and confirming in chat share one path.
 *  Drafts are COPIED: executors and cards must never mutate the registry. */
export function packAction(pack: ContentPack): Extract<CopilotAction, { tool: 'add_challenge_pack' }> {
  return {
    tool: 'add_challenge_pack',
    proposal: { theme: pack.theme, packId: pack.id, challenges: pack.challenges.map((c) => ({ ...c })) },
  };
}
