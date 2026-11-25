/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Surprise me" — one tap dresses the guest in a random look that actually
 * works together. Pure (the RNG is injected), so every rule below is tested.
 *
 * The rules are the booth's own slot rules (lib/lookStrip):
 *   · one frame + one prop + one face paint + one effect — a prop and a paint
 *     wear together (Paint got its own slot, bf1abff);
 *   · a COMBINED scene (kind 'composite') is a whole look led by its frame:
 *     Booth.handleSelectFrame puts its 3D piece in the prop slot and its
 *     ambient shader in the effect slot, so a surprise never stacks another
 *     prop on it, and leaves the effect alone when the scene brings one;
 *   · the standing "3D" Frame tiles (lib/world/worldLooks) are never picked —
 *     each one leaves the selfie booth for the back camera and the room, which
 *     is not something a guest asked for when they tapped "Surprise me".
 *
 * A surprise REPLACES the whole combination: every slot it does not fill is
 * cleared, so the result is exactly what was picked. It never hands back the
 * combination that is already on.
 */
import type { DeckSelection } from './boothDeck';
import type { LookAction, LookItem } from './lookStrip';
import { WORLD_LOOK_PREFIX } from './world/worldLooks';

/** Fewer looks than this is not much of a surprise — the tile hides. */
export const SURPRISE_MIN_LOOKS = 3;

/** How often a surprise also adds an effect over the frame and face look. */
const EFFECT_CHANCE = 0.4;
/** How many draws before concluding nothing new can be made. */
const MAX_TRIES = 24;

export interface Surprise {
  /** Applied in order through lookStrip.runLookAction: frame first. */
  actions: LookAction[];
  /** The looks put on, in slot order — what the name pill announces. */
  picks: LookItem[];
  /** The selection the actions produce (for "is this new?"). */
  result: DeckSelection;
}

/** The looks a surprise may choose from: everything but the room-mode tiles. */
export function surprisePool(strip: readonly LookItem[]): LookItem[] {
  return strip.filter((i) => !i.exp.id.startsWith(WORLD_LOOK_PREFIX));
}

/** Show the tile? Enough looks, and not while the booth is in room mode. */
export function canSurprise(strip: readonly LookItem[], sel: DeckSelection): boolean {
  if ((sel.attachmentId ?? '').startsWith(WORLD_LOOK_PREFIX)) return false;
  return surprisePool(strip).length >= SURPRISE_MIN_LOOKS;
}

function pick<T>(list: readonly T[], rng: () => number): T {
  // Clamped: an rng returning exactly 1 must not index past the end.
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function sameSelection(a: DeckSelection, b: DeckSelection): boolean {
  return a.frameId === b.frameId
    && a.attachmentId === b.attachmentId
    && (a.paintId ?? null) === (b.paintId ?? null)
    && a.effectId === b.effectId;
}

function draw(pool: readonly LookItem[], rng: () => number): Surprise | null {
  const frames = pool.filter((i) => i.category === 'frame');
  const props = pool.filter((i) => i.category === 'prop');
  const paints = pool.filter((i) => i.category === 'paint');
  const effects = pool.filter((i) => i.category === 'effect' && i.shaderId !== null);

  // The frame is the hero of a photo: always one when the event has any.
  const frame = frames.length > 0 ? pick(frames, rng) : null;
  const scene = frame !== null && frame.exp.kind === 'composite';
  const sceneShader = scene ? (frame!.exp.config?.ambientShader?.shaderId ?? null) : null;

  // The face: a prop, a paint, both, or (rarely, only with a frame) neither.
  const faceChoices: ('prop' | 'paint' | 'both' | 'none')[] = [];
  if (props.length > 0 && !scene) faceChoices.push('prop');
  if (paints.length > 0) faceChoices.push('paint');
  if (props.length > 0 && paints.length > 0 && !scene) faceChoices.push('both');
  if (frame !== null && faceChoices.length > 0 && faceChoices.length < 3) faceChoices.push('none');
  const face = faceChoices.length > 0 ? pick(faceChoices, rng) : 'none';
  const prop = face === 'prop' || face === 'both' ? pick(props, rng) : null;
  const paint = face === 'paint' || face === 'both' ? pick(paints, rng) : null;

  // An effect sometimes — always when nothing else was picked.
  let effect: LookItem | null = null;
  if (sceneShader === null && effects.length > 0) {
    const nothingElse = frame === null && prop === null && paint === null;
    if (nothingElse || rng() < EFFECT_CHANCE) effect = pick(effects, rng);
  }

  if (frame === null && prop === null && paint === null && effect === null) return null;

  const actions: LookAction[] = [{ category: 'frame', exp: frame?.exp ?? null }];
  if (!scene) actions.push({ category: 'prop', exp: prop?.exp ?? null });
  actions.push({ category: 'paint', exp: paint?.exp ?? null });
  if (sceneShader === null) {
    actions.push(effect !== null
      ? { category: 'effect', shaderId: effect.shaderId!, exp: effect.exp }
      : { category: 'effect', shaderId: 'none', exp: null });
  }

  return {
    actions,
    picks: [frame, prop, paint, effect].filter((i): i is LookItem => i !== null),
    result: {
      frameId: frame?.exp.id ?? null,
      attachmentId: scene ? frame!.exp.id : (prop?.exp.id ?? null),
      paintId: paint?.exp.id ?? null,
      effectId: sceneShader ?? effect?.shaderId ?? 'none',
    },
  };
}

/**
 * A random compatible look that differs from what is on now, or null when the
 * strip cannot make one (too few looks, or every draw repeats the current).
 */
export function pickSurprise(
  strip: readonly LookItem[],
  rng: () => number,
  current: DeckSelection,
): Surprise | null {
  if (!canSurprise(strip, current)) return null;
  const pool = surprisePool(strip);
  for (let t = 0; t < MAX_TRIES; t++) {
    const s = draw(pool, rng);
    if (s !== null && !sameSelection(s.result, current)) return s;
  }
  return null;
}

/** What the name pill says after a surprise: "Confetti + Tiara". */
export function surpriseAnnouncement(s: Surprise, labelOf: (item: LookItem) => string = (i) => i.title): string {
  return s.picks.map(labelOf).join(' + ');
}
