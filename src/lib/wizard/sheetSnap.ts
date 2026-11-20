/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Snap points for the wizard's phone options drawer (PreviewSheet). Pure, so
 * the drag maths is unit-tested.
 *
 *   peek: just the drawer's title row — the preview gets the screen
 *   half: preview and options share the screen (where every step opens)
 *   full: options get the screen, with a strip of preview left on top
 */
export type SheetSnap = 'peek' | 'half' | 'full';

/** Collapsed height: the grabber plus the title row. */
export const SHEET_PEEK = 76;
/** How much preview stays visible above a fully open drawer. */
export const SHEET_FULL_GAP = 140;
/** A flick faster than this (px/ms) moves one snap in its direction. */
export const SHEET_FLICK = 0.5;

/** The drawer heights for the room available (top of the step to the footer). */
export function sheetSnaps(avail: number): Record<SheetSnap, number> {
  const room = Math.max(SHEET_PEEK, avail);
  const full = Math.max(SHEET_PEEK, room - SHEET_FULL_GAP);
  const half = Math.min(full, Math.max(SHEET_PEEK, Math.round(room * 0.5)));
  return { peek: SHEET_PEEK, half, full };
}

const ORDER: readonly SheetSnap[] = ['peek', 'half', 'full'];

/** Tapping the handle opens one step at a time; a full drawer drops to half. */
export function nextSnapOnTap(s: SheetSnap): SheetSnap {
  return s === 'peek' ? 'half' : s === 'half' ? 'full' : 'half';
}

/**
 * Where a released drag settles: a flick moves one snap past where the
 * finger let go (in the flick's direction); a slow drag lands on the nearest.
 * `velocity` is px/ms, positive = upward (opening).
 */
export function snapAfterDrag(height: number, velocity: number, snaps: Record<SheetSnap, number>): SheetSnap {
  if (velocity > SHEET_FLICK) return ORDER.find((s) => snaps[s] > height + 1) ?? 'full';
  if (velocity < -SHEET_FLICK) return [...ORDER].reverse().find((s) => snaps[s] < height - 1) ?? 'peek';
  let best: SheetSnap = 'peek';
  for (const s of ORDER) if (Math.abs(snaps[s] - height) < Math.abs(snaps[best] - height)) best = s;
  return best;
}
