/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The seam that lets a hand-modelled asset flip itself.
 *
 * `HandRig` knows which hand the tracker sees; `Model` (three levels down, and
 * also mounted by three surfaces that do not all go through Overlay3D) is what
 * owns the geometry. Threading handedness through every call site would mean
 * adding a prop to Overlay3D, StudioPreview and Studio3DView and hoping the
 * next surface remembers — the exact drift the shared piece mapper exists to
 * prevent. A context inverts it: HandRig publishes, `Model` and `FxEmitterPoint`
 * subscribe, and a surface that mounts them inside a HandRig gets the behaviour
 * whether or not its author knew about it.
 *
 * OUTSIDE a HandRig the value is null, so head pieces and the studio's orbit
 * view are byte-identical to before this existed.
 *
 * Its own module rather than an export from HandRig.tsx so FaceRig.tsx can
 * import it without a component-to-component cycle.
 */
import { createContext, useContext } from 'react';
import {
  shouldMirrorAsset,
  type HandFit,
  type ModelledHand,
  type TrackedHand,
} from '../../lib/studio/handedness';

export interface HandMirrorValue {
  /** The hand the tracker currently reports (already label-swapped). */
  tracked: TrackedHand;
  /** The host's authored pin for the piece in THIS rig. */
  fit: HandFit;
}

/** Null = not inside a HandRig: nothing may be mirrored. */
export const HandMirrorContext = createContext<HandMirrorValue | null>(null);

/**
 * True when an asset modelled for `modelled` must be mirrored to fit the hand
 * this rig is tracking. Always false outside a HandRig, and always false for a
 * hand-agnostic asset (no `modelledHand` on its template).
 */
export function useHandMirror(modelled: ModelledHand | undefined): boolean {
  const ctx = useContext(HandMirrorContext);
  if (ctx === null) return false;
  return shouldMirrorAsset(modelled, ctx.fit, ctx.tracked);
}
