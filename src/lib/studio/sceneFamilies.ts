/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * sceneFamilies — which TRACKER a 3D object rides: the head rig or the hand rig.
 *
 * Four surfaces asked this question four slightly different ways, and two of
 * them disagreed: Studio3DView split on `isHandAnchorId(o.handAnchor)` while
 * StudioStage split on `o.handAnchor !== undefined`, so an object carrying an
 * unrecognised anchor id counted as a HEAD piece in the renderer and a HAND
 * piece in the tracker-warmup and status chip — the studio would download the
 * 7.8MB hand landmarker for a scene with nothing to put on a hand, and report
 * "show your hand" for a piece drawn on the head.
 *
 * One predicate, one meaning: an object is hand-anchored only when its anchor is
 * an id HAND_ANCHORS actually defines, because that is the only case HandRig can
 * render. draftMapping already normalises stored layers through the same guard,
 * so nothing persisted can reach here with an unknown id.
 */
import { isHandAnchorId } from '../handPose';

export type SceneFamily = 'head' | 'hand';

/** The minimum an object must expose to be sorted — keeps this usable from the
 *  studio draft, the booth's piece list and the persistence layer alike. */
export interface FamilyMember {
  handAnchor?: string;
}

export function objectFamily(o: FamilyMember): SceneFamily {
  return isHandAnchorId(o.handAnchor) ? 'hand' : 'head';
}

export function isHandObject(o: FamilyMember): boolean {
  return objectFamily(o) === 'hand';
}

/** Both subsets in one pass, each keeping the input's order. */
export function splitByFamily<T extends FamilyMember>(objects: readonly T[]): { head: T[]; hand: T[] } {
  const head: T[] = [];
  const hand: T[] = [];
  for (const o of objects) (isHandObject(o) ? hand : head).push(o);
  return { head, hand };
}

export interface FamilyPresence {
  hasHead: boolean;
  hasHand: boolean;
  /** Both families in one scene — the only case that needs a focus switch. */
  both: boolean;
  /** No 3D objects at all: the orbit view still shows the head to place onto. */
  empty: boolean;
}

export function familyPresence(objects: readonly FamilyMember[]): FamilyPresence {
  let hasHead = false;
  let hasHand = false;
  for (const o of objects) {
    if (isHandObject(o)) hasHand = true;
    else hasHead = true;
    if (hasHead && hasHand) break;
  }
  return { hasHead, hasHand, both: hasHead && hasHand, empty: objects.length === 0 };
}

/**
 * Which mannequins the orbit view should render. An empty scene falls back to
 * the head: it is the thing a host places their first piece onto, and an empty
 * void reads as a broken view.
 */
export function orbitMannequins(objects: readonly FamilyMember[]): { head: boolean; hand: boolean } {
  const p = familyPresence(objects);
  return { head: p.hasHead || p.empty, hand: p.hasHand };
}

/**
 * The family the orbit camera should frame, given what the scene contains and
 * which family the host last asked for. A stale preference (they deleted the
 * only wand) must not leave the camera pointed at a mannequin that is no longer
 * rendered, so the presence check always wins.
 */
export function resolveFocus(objects: readonly FamilyMember[], preferred: SceneFamily | null): SceneFamily {
  const shown = orbitMannequins(objects);
  if (preferred === 'hand' && shown.hand) return 'hand';
  if (preferred === 'head' && shown.head) return 'head';
  return shown.head ? 'head' : 'hand';
}
