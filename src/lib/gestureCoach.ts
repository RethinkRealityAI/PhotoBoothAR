/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What the booth's "Try this" pop-up says when a guest picks a Look that
 * reacts to a face expression or a hand gesture — PURE (no React, no DOM), so
 * the copy is tested beside the trigger vocabulary it describes.
 *
 * One row per gesture the Look listens for: what to DO ("Open your mouth"),
 * what HAPPENS ("Hearts burst out"), and a glyph. The booth used to show one
 * small pill for five seconds once per camera session ("Smile for a surprise"),
 * which never named the result and never re-appeared when the guest switched
 * to a second gesture Look.
 */
import {
  BEAM_STYLE_LABELS,
  isHandSource,
  type TriggerAction,
  type TriggerConfig,
  type TriggerSource,
} from './studio/triggers';

export interface CoachStep {
  source: TriggerSource;
  /** Emoji shown large on the card. */
  glyph: string;
  /** The instruction, imperative and short. */
  doThis: string;
  /** What the guest gets for it. */
  result: string;
}

export interface GestureCoach {
  /** Changes exactly when the gestures or their results change (the booth
   *  shows the card again for a different Look, not for the same one). */
  key: string;
  title: string;
  steps: CoachStep[];
  /** The Look needs a hand in view (the hand tracker only sees what is shown). */
  needsHand: boolean;
}

export const COACH_DO: Record<TriggerSource, string> = {
  smile: 'Smile big',
  mouthOpen: 'Open your mouth wide',
  wink: 'Give a wink',
  browRaise: 'Raise your eyebrows',
  fistClench: 'Make a fist',
  palmOpen: 'Show an open palm',
  pinch: 'Pinch your fingers',
  peaceSign: 'Throw a peace sign',
  handToTemple: 'Touch your temple',
};

export const COACH_GLYPH: Record<TriggerSource, string> = {
  smile: '😄',
  mouthOpen: '😮',
  wink: '😉',
  browRaise: '🤨',
  fistClench: '✊',
  palmOpen: '🖐️',
  pinch: '🤏',
  peaceSign: '✌️',
  handToTemple: '🫡',
};

const BURST_RESULT: Record<string, string> = {
  confetti: 'Confetti pops',
  hearts: 'Hearts burst out',
  sparkles: 'Sparkles fly',
  fireworks: 'Fireworks go off',
};

const ANIMATE_RESULT: Record<string, string> = {
  shake: 'Your prop shakes',
  pulse: 'Your prop pulses',
  spin: 'Your prop spins',
  pop: 'Your prop pops',
};

/** The result line for one action (pure). */
export function coachResult(a: TriggerAction): string {
  switch (a.type) {
    case 'burst': return BURST_RESULT[a.style] ?? 'Something magic happens';
    case 'beam': return `Fire ${articleFor(BEAM_STYLE_LABELS[a.style] ?? 'energy blast')}`;
    case 'reveal': return 'A surprise appears';
    case 'filterPulse': return 'The colours flash';
    case 'animate': return ANIMATE_RESULT[a.preset] ?? 'Your prop moves';
  }
}

function articleFor(label: string): string {
  const l = label.toLowerCase();
  return /^[aeiou]/.test(l) ? `an ${l}` : `a ${l}`;
}

/** Most gestures a card lists; more would be a wall of text on a phone. */
export const COACH_MAX_STEPS = 3;

/**
 * The pop-up for a scene's triggers, or null when the scene reacts to nothing.
 * One row per SOURCE (the first action authored for it wins), in authored
 * order, capped at COACH_MAX_STEPS.
 */
/**
 * `hands: false` drops hand gestures: a guest booth that does not run the hand
 * tracker (handPose.GUEST_HAND_TRACKING) must never ask for a gesture it
 * cannot see.
 */
export function gestureCoachFor(triggers: readonly TriggerConfig[], opts: { hands?: boolean } = {}): GestureCoach | null {
  const hands = opts.hands ?? true;
  const steps: CoachStep[] = [];
  const seen = new Set<TriggerSource>();
  for (const t of triggers) {
    if (seen.has(t.source)) continue;
    if (!hands && isHandSource(t.source)) continue;
    seen.add(t.source);
    steps.push({ source: t.source, glyph: COACH_GLYPH[t.source], doThis: COACH_DO[t.source], result: coachResult(t.action) });
  }
  if (steps.length === 0) return null;
  const shown = steps.slice(0, COACH_MAX_STEPS);
  const needsHand = shown.some((s) => isHandSource(s.source));
  const allHand = shown.every((s) => isHandSource(s.source));
  return {
    key: shown.map((s) => `${s.source}>${s.result}`).join('|'),
    title: shown.length > 1 ? 'This Look reacts to you' : allHand ? 'Try this gesture' : 'Try this',
    steps: shown,
    needsHand,
  };
}

/** How long the card stays up on its own, ms (tap dismisses sooner). */
export const COACH_VISIBLE_MS = 5200;
