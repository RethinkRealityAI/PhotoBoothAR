/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The keepsake template registry — the ONE place a template id becomes a
 * component, read by the viewer AND the host's picker.
 *
 * The closed set of ids, their host-facing names and the unknown-id fallback
 * live in the PURE lib/cardTemplates.ts (node-testable, and shared with the
 * copilot tool registry). This file only attaches a component to each id, so
 * the `Record<CardTemplateId, …>` below goes red at typecheck the moment an id
 * is added without a component.
 *
 * Template CHOICE IS HOST-ONLY by design: guests contributing to a card never
 * see a style picker — the host sets the look for everyone, so a keepsake
 * reads as one designed object rather than a per-contributor mix.
 */
import type { ComponentType } from 'react';
import type { CardTemplateProps } from './types';
import Storybook from './Storybook';
import FilmStrip from './FilmStrip';
import Polaroid from './Polaroid';
import Carousel from './Carousel';
import Constellation from './Constellation';
import {
  CARD_TEMPLATE_OPTIONS,
  DEFAULT_CARD_TEMPLATE,
  normalizeCardTemplate,
  type CardTemplateId,
} from '../../../lib/cardTemplates';

export { DEFAULT_CARD_TEMPLATE };

export interface CardTemplateDef {
  id: CardTemplateId;
  name: string;
  /** One line a host can decide from, in their language — not ours. */
  blurb: string;
  Component: ComponentType<CardTemplateProps>;
  /** Wants the whole viewport (a 3D scene), not the centred reading column. */
  fullBleed: boolean;
}

/** Templates whose canvas should run edge to edge. */
const FULL_BLEED: ReadonlySet<CardTemplateId> = new Set<CardTemplateId>(['carousel', 'constellation']);

const COMPONENTS: Record<CardTemplateId, ComponentType<CardTemplateProps>> = {
  storybook: Storybook,
  filmstrip: FilmStrip,
  polaroid: Polaroid,
  carousel: Carousel,
  constellation: Constellation,
};

export const CARD_TEMPLATES: CardTemplateDef[] = CARD_TEMPLATE_OPTIONS.map((o) => ({
  id: o.id,
  name: o.label,
  blurb: o.description,
  Component: COMPONENTS[o.id],
  fullBleed: FULL_BLEED.has(o.id),
}));

/**
 * Resolve a stored template id to a definition. An id from a newer build (or a
 * hand-edited row) falls back to the default rather than rendering nothing —
 * a published keepsake must always open.
 */
export function resolveCardTemplate(id: string | null | undefined): CardTemplateDef {
  const key = normalizeCardTemplate(id);
  return CARD_TEMPLATES.find((t) => t.id === key) ?? CARD_TEMPLATES[0];
}
