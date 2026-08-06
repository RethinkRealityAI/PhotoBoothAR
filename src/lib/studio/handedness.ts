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
  // The hints name BOTH jobs — the mannequin you place against and the flip at
  // capture time. Describing only the render left hosts with no idea why the
  // editor's hand changed under them.
  { id: 'auto', label: 'Either', hint: 'Follows whichever hand the camera sees; the editor shows the hand it was built for' },
  { id: 'left', label: 'Left', hint: 'Places and renders on a left hand, whichever hand the guest raises' },
  { id: 'right', label: 'Right', hint: 'Places and renders on a right hand, whichever hand the guest raises' },
];

/**
 * The other hand's PLACEMENT for a piece whose mesh is being mirrored.
 *
 * Mirroring the mesh alone is not enough, and the failure is loud: the mesh
 * flips about its own local plane while the authored offset and rotation stay
 * put, so a gauntlet with a real nudge and a 98° rotation mirrors into a pose
 * beside the hand rather than onto it.
 *
 * The whole placement has to reflect. For a transform T·R about the hand
 * frame's YZ plane, M(T·R)M is: negate the offset's x, and conjugate the
 * rotation by the same reflection — which for a quaternion is (x,−y,−z,w), the
 * identical operation `mirrorHandPose` applies to a tracked pose. Scale is
 * uniform and unaffected.
 *
 * Pure and quaternion-based so it can be tested without three.js; callers
 * convert their Euler in and out.
 */
/**
 * Mirroring is ALL OR NOTHING, and this is the one place that says so.
 *
 * An engraved asset cannot have its mesh mirrored — the decal is carved against
 * the surface it was built for, and reflecting the body under it puts the name
 * on the wrong side. But suppressing only the MESH while the placement still
 * reflects produces the worst of both: an un-mirrored glove flung to the far
 * side of the hand. Whatever blocks one half must block the other.
 *
 * A purpose-built pair GLB is NOT blocked: that sculpt really is the other
 * hand, so its placement still has to reflect to reach the other hand's mount.
 */
export function canMirrorAsset(engravable: boolean): boolean {
  return !engravable;
}

export interface MirrorablePlacement {
  offset: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

/**
 * Reflect an authored placement across the hand's midline.
 *
 * Offset: negate x. Rotation: for a reflection M = diag(−1,1,1), M·R·M applied
 * to an XYZ Euler keeps rx and negates ry and rz — check it on the axes, where
 * the quaternion form (x,−y,−z,w) leaves a pure X turn alone and flips a pure Y
 * or Z turn. Because the reflection distributes over the product, the same holds
 * for the composed Euler and the XYZ order survives.
 *
 * An involution: applying it twice is the identity, which is what lets the
 * studio's gizmo edit a mirrored piece and write the result back unmirrored
 * through this same function.
 */
export function mirrorPlacement<T extends MirrorablePlacement>(p: T): T {
  return {
    ...p,
    offset: { x: p.offset.x === 0 ? 0 : -p.offset.x, y: p.offset.y, z: p.offset.z },
    rotation: {
      x: p.rotation.x,
      y: p.rotation.y === 0 ? 0 : -p.rotation.y,
      z: p.rotation.z === 0 ? 0 : -p.rotation.z,
    },
  };
}

/**
 * Which hand the STUDIO should show while the host places this piece.
 *
 * The tracked views answer this from the camera; the orbit editor has no camera
 * and used to answer it not at all — it drew the vendored RIGHT mannequin for
 * every piece, so a left-handed gauntlet was fitted against the wrong hand and
 * every offset the host tuned was tuned against a mirror image.
 *
 * Note this is defined for hand-AGNOSTIC assets too. A wand's mesh is symmetric,
 * so nothing about the wand changes — but "which hand am I placing this in?" is
 * still a real question the mannequin has to answer, and answering it wrongly is
 * what makes the grip offsets feel backwards.
 */
export function previewHand(
  modelled: ModelledHand | undefined,
  fit: HandFit | undefined,
): ModelledHand {
  const f = fit ?? 'auto';
  if (f === 'left' || f === 'right') return f;
  // 'auto' with nothing tracked: show the hand the asset was built for, and
  // fall back to the right hand, which is both the vendored mannequin's own
  // chirality and the majority-handed default.
  return modelled ?? 'right';
}
