/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The keepsake template registry — ONE list, read by both sides.
 *
 * The viewer used to pick a component with an inline ternary and the host's
 * create form listed the same ids again in a hand-written <select>; adding a
 * third template meant editing both and hoping they agreed. Everything that
 * needs to know "which keepsake styles exist" now reads this file.
 *
 * Template CHOICE IS HOST-ONLY by design: guests contributing to a card never
 * see a style picker — the host sets the look for everyone, so a keepsake
 * reads as one designed object rather than a per-contributor mix.
 */
import type { ComponentType } from 'react';
import type { CardTemplateProps } from './types';
import Storybook from './Storybook';
import FilmStrip from './FilmStrip';

export interface CardTemplateDef {
  id: string;
  name: string;
  /** One line a host can decide from, in their language — not ours. */
  blurb: string;
  Component: ComponentType<CardTemplateProps>;
}

export const CARD_TEMPLATES: CardTemplateDef[] = [
  {
    id: 'storybook',
    name: 'Storybook',
    blurb: 'Turns page by page like a keepsake book — one message per spread.',
    Component: Storybook,
  },
  {
    id: 'filmstrip',
    name: 'Film strip',
    blurb: 'A cinematic reel of frames, closer to a photo gallery.',
    Component: FilmStrip,
  },
];

/** The style a new keepsake gets when nobody has chosen one. */
export const DEFAULT_CARD_TEMPLATE = 'storybook';

export const CARD_TEMPLATE_MAP: Record<string, CardTemplateDef> = Object.fromEntries(
  CARD_TEMPLATES.map((t) => [t.id, t]),
);

/**
 * Resolve a stored template id to a definition. An id from an older build (or a
 * hand-edited row) falls back to the default rather than rendering nothing —
 * a published keepsake must always open.
 */
export function resolveCardTemplate(id: string | null | undefined): CardTemplateDef {
  return (id && CARD_TEMPLATE_MAP[id]) || CARD_TEMPLATE_MAP[DEFAULT_CARD_TEMPLATE];
}
