/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure layer-ordering maths for the studio's Layers panel.
 *
 * The panel used to render THREE FIXED BUCKETS (frame · stickers · 3D) while
 * REORDER_OBJECT swapped adjacent indices in the flat `objects` array. Those two
 * models disagree: pressing "move up" on the sticker adjacent to the frame
 * changed real paint order and moved NOTHING in the visible list, so the host
 * pressed a button and saw no result. state.ts even documented the mismatch.
 *
 * The fix is one flat list rendered in true paint order. `objects` is
 * BOTTOM-FIRST (objects[last] paints last / on top), and a layers panel reads
 * top-first, so every helper here is about that one reversal — kept pure and
 * tested so the panel and the reducer can never drift apart again.
 */
import type { StudioObject } from './state';

/** One row of the flat layers list, top-most first. */
export interface LayerRow<T = StudioObject> {
  object: T;
  /** Index into the bottom-first `objects` array. */
  index: number;
  /** Index into the top-first display list (0 = top-most). */
  row: number;
  /** True when this row paints above everything else. */
  isTop: boolean;
  /** True when this row paints below everything else. */
  isBottom: boolean;
}

/** Array index (bottom-first) → display row (top-first), and back. */
export function indexToRow(index: number, count: number): number {
  return count - 1 - index;
}
export function rowToIndex(row: number, count: number): number {
  return count - 1 - row;
}

/**
 * The flat, top-first rows the Layers panel renders. Row 0 is the object that
 * paints LAST (on top of everything); the final row paints first (underneath).
 */
export function layerRows<T>(objects: readonly T[]): LayerRow<T>[] {
  const n = objects.length;
  const rows: LayerRow<T>[] = [];
  for (let row = 0; row < n; row++) {
    const index = rowToIndex(row, n);
    rows.push({ object: objects[index], index, row, isTop: row === 0, isBottom: row === n - 1 });
  }
  return rows;
}

/**
 * Move the object at `fromIndex` so it sits at `toIndex` in the bottom-first
 * array (a splice-move, not a swap — dragging row 0 to row 4 must land it there,
 * not trade places with whatever sat at 4). Returns the SAME array reference
 * when nothing would change, so React can skip the re-render.
 */
export function moveByIndex<T>(objects: readonly T[], fromIndex: number, toIndex: number): T[] {
  const n = objects.length;
  if (fromIndex < 0 || fromIndex >= n) return objects as T[];
  const clamped = Math.min(n - 1, Math.max(0, toIndex));
  if (clamped === fromIndex) return objects as T[];
  const next = objects.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clamped, 0, moved);
  return next;
}

/**
 * The ARRAY index one display-step away from `row`. The Layers panel's up/down
 * buttons dispatch MOVE_OBJECT with this, so "up" always means "up in the list
 * I am looking at" — the direction word is resolved here, once, instead of every
 * caller having to remember that the array runs the other way.
 */
export function stepTargetIndex(row: number, count: number, dir: 'up' | 'down'): number {
  const targetRow = dir === 'up' ? row - 1 : row + 1;
  return rowToIndex(Math.min(count - 1, Math.max(0, targetRow)), count);
}

/**
 * Drag-and-drop target maths for the top-first list. `fromRow` is the row being
 * dragged, `toRow` the row it is hovering. Returns the bottom-first array index
 * the dragged object should end at — which is simply the mirrored row, because
 * a splice-move preserves everything else's relative order.
 */
export function dropIndexForRow(fromRow: number, toRow: number, count: number): { fromIndex: number; toIndex: number } {
  const clampRow = (r: number) => Math.min(count - 1, Math.max(0, r));
  return {
    fromIndex: rowToIndex(clampRow(fromRow), count),
    toIndex: rowToIndex(clampRow(toRow), count),
  };
}

/**
 * Which row a pointer at `clientY` is over, given each row's measured top/height.
 * Returns null when the list is empty. Rows shorter than 1px are ignored (a
 * collapsing row mid-animation must not become an unreachable drop target).
 */
export function rowAtPointer(rects: readonly { top: number; height: number }[], clientY: number): number | null {
  if (rects.length === 0) return null;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.height < 1) continue;
    if (clientY < r.top + r.height) return i;
  }
  return rects.length - 1;
}

/**
 * A short, plain-language description of what a row's position means in the
 * booth, so the list is self-explaining rather than requiring the host to infer
 * paint order from row position.
 */
export function paintOrderHint(row: number, count: number): string {
  if (count <= 1) return 'The only layer';
  if (row === 0) return 'Paints on top of everything';
  if (row === count - 1) return 'Paints underneath everything';
  return `Paints over ${count - 1 - row} layer${count - 1 - row === 1 ? '' : 's'}`;
}
