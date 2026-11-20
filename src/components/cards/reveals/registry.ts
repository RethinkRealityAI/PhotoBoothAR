/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The reveal registry — the ONE place a reveal id becomes a component.
 *
 * The closed set, labels and WebGL needs live in the PURE lib/cardPresentation.ts
 * (node-testable, shared with the host picker). Every reveal is a lazy chunk:
 * the three.js ones are heavy, and a card that opens "straight to the card"
 * should download none of them. `Record<Exclude<CardRevealId,'none'>, …>` goes
 * red at typecheck the moment an id is added without a component.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { CardRevealId } from '../../../lib/cardPresentation';
import type { CardRevealProps } from './types';

type RevealComponent = LazyExoticComponent<ComponentType<CardRevealProps>>;

const REVEALS: Record<Exclude<CardRevealId, 'none'>, RevealComponent> = {
  envelope: lazy(() => import('./EnvelopeReveal')),
  curtain: lazy(() => import('./CurtainReveal')),
  airplane: lazy(() => import('./AirplaneReveal')),
  stardust: lazy(() => import('./StardustReveal')),
};

/** null = no opening moment ('none'). */
export function revealComponent(id: CardRevealId): RevealComponent | null {
  return id === 'none' ? null : REVEALS[id];
}
