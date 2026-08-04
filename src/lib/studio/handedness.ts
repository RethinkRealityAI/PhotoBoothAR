/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WHICH HAND — the decision that turns one modelled asset into a pair.
 *
 * A gauntlet, a glove or a watch is modelled for exactly ONE hand. Worn on the
 * other one it reads instantly wrong: the thumb cut-out on the wrong side, the
 * plating facing the body. `mirrorGeometryX` can flip the mesh, but only if
 * something decides WHEN to flip it. That is this module, and it is pure so the
 * rule can be tested without a tracker, a camera or a GPU.
 *
 * Two inputs:
 *
 * - `modelled` — the hand the GLB was authored for, declared on the template.
 *   ABSENT means hand-AGNOSTIC (a wand, a ball, a torch: symmetric enough that
 *   flipping it changes nothing) and NOTHING is ever mirrored. That is also
 *   every descriptor written before this field existed, so old assets render
 *   byte-identically.
 *
 * - `fit` — the host's authored choice on the object: pin it to one hand, or
 *   'auto' to follow whichever hand the tracker actually sees.
 *
 * ## Why 'auto' is not the only mode
 *
 * MediaPipe reports handedness for a MIRRORED image; the booth feeds it raw
 * frames, so `handRig` swaps the label. That swap is reasoned-from-source, not
 * measured on a phone — and if it is backwards, an auto-only design mirrors the
 * gauntlet on precisely the wrong hand, with no way out but a code change.
 * A pin is deterministic: it never consults the tracker at all, so it is
 * correct even if the label is not.
 */

/** The hand a GLB was modelled for. Absent on a template = hand-agnostic. */
export type ModelledHand = 'left' | 'right';

/** The host's authored choice for an object. Absent = 'auto'. */
export type HandFit = 'auto' | 'left' | 'right';

/** What the tracker currently sees (handRig's already-swapped label), or null. */
export type TrackedHand = 'Left' | 'Right' | null;

const FITS: ReadonlySet<string> = new Set(['auto', 'left', 'right']);

/** Validate a stored/authored fit. Anything unrecognised degrades to 'auto'. */
export function normalizeHandFit(raw: unknown): HandFit {
  return typeof raw === 'string' && FITS.has(raw) ? (raw as HandFit) : 'auto';
}

const MODELLED: ReadonlySet<string> = new Set(['left', 'right']);

/** Validate a template's declared hand; anything else means hand-agnostic. */
export function normalizeModelledHand(raw: unknown): ModelledHand | undefined {
  return typeof raw === 'string' && MODELLED.has(raw) ? (raw as ModelledHand) : undefined;
}

/**
 * The hand this asset should END UP fitting, or null when there is nothing to
 * decide from (agnostic asset, or 'auto' with no hand in frame).
 */
export function targetHand(
  modelled: ModelledHand | undefined,
  fit: HandFit | undefined,
  tracked: TrackedHand,
): ModelledHand | null {
  if (modelled === undefined) return null; // agnostic: never flipped
  const f = fit ?? 'auto';
  if (f === 'left' || f === 'right') return f;
  if (tracked === 'Left') return 'left';
  if (tracked === 'Right') return 'right';
  // 'auto' with no hand yet: hold the modelled orientation rather than guessing.
  // Flipping on acquisition is a one-frame change the guest reads as the prop
  // settling; flipping the WRONG way and back is what looks broken.
  return null;
}

/**
 * True when the mesh must be mirrored through its YZ plane to fit the target
 * hand. False for every agnostic asset and every already-correct hand, which is
 * the overwhelmingly common case and costs nothing.
 */
export function shouldMirrorAsset(
  modelled: ModelledHand | undefined,
  fit: HandFit | undefined,
  tracked: TrackedHand,
): boolean {
  const target = targetHand(modelled, fit, tracked);
  return target !== null && target !== modelled;
}

/** Chip copy for the Properties control, in authoring order. */
export const HAND_FIT_OPTIONS: readonly { id: HandFit; label: string; hint: string }[] = [
  { id: 'auto', label: 'Either', hint: 'Flips to match whichever hand the camera sees' },
  { id: 'left', label: 'Left', hint: 'Always fits a left hand' },
  { id: 'right', label: 'Right', hint: 'Always fits a right hand' },
];
