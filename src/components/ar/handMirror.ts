/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The seam that lets a hand-modelled asset flip itself.
 *
 * `HandRig` knows which hand it is drawing on; `Model` (three levels down, and
 * also mounted by three surfaces that do not all go through Overlay3D) is what
 * owns the geometry. Threading handedness through every call site would mean
 * adding a prop to Overlay3D, StudioPreview and Studio3DView and hoping the
 * next surface remembers — the exact drift the shared piece mapper exists to
 * prevent. A context inverts it: HandRig publishes, `Model`, `HandPlacement`
 * and `FxEmitterPoint` subscribe, and a surface that mounts them inside a
 * HandRig gets the behaviour whether or not its author knew about it.
 *
 * The published hand is the APPARENT one (lib/studio/handedness.ts
 * `apparentHand`): the hand as it is DRAWN, which in a mirrored selfie is the
 * other one. Every chiral decision keys on it, because the rig's frame is the
 * anatomical frame of the drawn hand.
 *
 * OUTSIDE a HandRig the value is null, so head pieces and the studio's orbit
 * view are byte-identical to before this existed.
 *
 * Its own module rather than an export from HandRig.tsx so FaceRig.tsx can
 * import it without a component-to-component cycle.
 */
import { createContext, useContext } from 'react';
import {
  resolveHandRender,
  shouldMirrorAsset,
  type HandFit,
  type HandRender,
  type ModelledHand,
  type TrackedHand,
} from '../../lib/studio/handedness';

export interface HandMirrorValue {
  /** The hand this rig is drawing on, AS DRAWN (already label-swapped, and
   *  swapped again for a mirrored feed). */
  tracked: TrackedHand;
  /** The host's authored pin for the piece in THIS rig. */
  fit: HandFit;
}

/** Null = not inside a HandRig: nothing may be mirrored. */
export const HandMirrorContext = createContext<HandMirrorValue | null>(null);

/**
 * True when an asset must be mirrored because this rig is drawing it on the
 * other hand than it was placed on. Always false outside a HandRig.
 */
export function useHandMirror(modelled: ModelledHand | undefined, engravable = false): boolean {
  const ctx = useContext(HandMirrorContext);
  if (ctx === null) return false;
  return shouldMirrorAsset(modelled, ctx.fit, ctx.tracked, engravable);
}

const OUTSIDE: HandRender = { hand: null, reflectPlacement: false, mirrorMesh: false, anchorHand: null };

/**
 * The full render decision for a piece in this rig — which frame it is in,
 * whether its authored placement reflects, whether its mesh does. Outside a
 * HandRig nothing reflects.
 */
export function useHandRender(modelled: ModelledHand | undefined, engravable = false): HandRender {
  const ctx = useContext(HandMirrorContext);
  if (ctx === null) return OUTSIDE;
  return resolveHandRender(modelled, ctx.fit, ctx.tracked, engravable);
}
