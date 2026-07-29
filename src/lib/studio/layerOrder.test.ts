/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  indexToRow,
  rowToIndex,
  layerRows,
  moveByIndex,
  stepTargetIndex,
  dropIndexForRow,
  rowAtPointer,
  paintOrderHint,
} from './layerOrder';

const objs = (...ids: string[]) => ids.map((id) => ({ id }));

describe('indexToRow / rowToIndex', () => {
  it('mirrors bottom-first array indices onto top-first rows', () => {
    expect(indexToRow(0, 4)).toBe(3);
    expect(indexToRow(3, 4)).toBe(0);
    expect(rowToIndex(0, 4)).toBe(3);
    expect(rowToIndex(3, 4)).toBe(0);
  });

  it('is its own inverse', () => {
    for (const n of [1, 2, 5, 21]) {
      for (let i = 0; i < n; i++) expect(rowToIndex(indexToRow(i, n), n)).toBe(i);
    }
  });
});

describe('layerRows', () => {
  it('returns the top-most (last-painted) object first', () => {
    const rows = layerRows(objs('a', 'b', 'c'));
    expect(rows.map((r) => r.object.id)).toEqual(['c', 'b', 'a']);
    expect(rows.map((r) => r.index)).toEqual([2, 1, 0]);
    expect(rows.map((r) => r.row)).toEqual([0, 1, 2]);
  });

  it('flags the top and bottom rows', () => {
    const rows = layerRows(objs('a', 'b', 'c'));
    expect(rows[0].isTop).toBe(true);
    expect(rows[0].isBottom).toBe(false);
    expect(rows[2].isBottom).toBe(true);
    expect(rows[1].isTop).toBe(false);
    expect(rows[1].isBottom).toBe(false);
  });

  it('marks the single row as both top and bottom', () => {
    const rows = layerRows(objs('only'));
    expect(rows[0].isTop).toBe(true);
    expect(rows[0].isBottom).toBe(true);
  });

  it('returns nothing for an empty scene', () => {
    expect(layerRows([])).toEqual([]);
  });
});

describe('moveByIndex', () => {
  it('splice-moves rather than swapping', () => {
    // 'a' to the end must shift b,c,d down by one — a swap would give d,b,c,a.
    expect(moveByIndex(objs('a', 'b', 'c', 'd'), 0, 3).map((o) => o.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('moves backwards too', () => {
    expect(moveByIndex(objs('a', 'b', 'c', 'd'), 3, 1).map((o) => o.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('clamps an out-of-range target instead of dropping the object', () => {
    const src = objs('a', 'b', 'c');
    expect(moveByIndex(src, 0, 99).map((o) => o.id)).toEqual(['b', 'c', 'a']);
    expect(moveByIndex(src, 2, -5).map((o) => o.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns the SAME reference for a no-op move', () => {
    const src = objs('a', 'b', 'c');
    expect(moveByIndex(src, 1, 1)).toBe(src);
    expect(moveByIndex(src, -1, 0)).toBe(src);
    expect(moveByIndex(src, 7, 0)).toBe(src);
  });

  it('never mutates the input', () => {
    const src = objs('a', 'b', 'c');
    moveByIndex(src, 0, 2);
    expect(src.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('stepTargetIndex', () => {
  it('resolves "up in the list" to the array index above it', () => {
    // 4 layers, list rows 0..3 = array indices 3..0. Row 2 stepping up = row 1 = index 2.
    expect(stepTargetIndex(2, 4, 'up')).toBe(2);
    expect(stepTargetIndex(2, 4, 'down')).toBe(0);
  });

  it('clamps at the top and bottom of the list', () => {
    expect(stepTargetIndex(0, 4, 'up')).toBe(3);   // already top → stays
    expect(stepTargetIndex(3, 4, 'down')).toBe(0); // already bottom → stays
  });

  it('drives a MOVE_OBJECT that actually moves the row in the list', () => {
    // objects a,b,c (bottom-first) → rows c,b,a. Moving row 1 ('b') up must
    // put 'b' at the top of the LIST, i.e. the end of the array.
    const src = objs('a', 'b', 'c');
    const rows = layerRows(src);
    const b = rows[1];
    const moved = moveByIndex(src, b.index, stepTargetIndex(b.row, src.length, 'up'));
    expect(layerRows(moved).map((r) => r.object.id)).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op through moveByIndex when already at the end of the list', () => {
    const src = objs('a', 'b', 'c');
    const top = layerRows(src)[0];
    expect(moveByIndex(src, top.index, stepTargetIndex(top.row, src.length, 'up'))).toBe(src);
  });
});

describe('dropIndexForRow', () => {
  it('mirrors display rows onto array indices', () => {
    expect(dropIndexForRow(0, 2, 4)).toEqual({ fromIndex: 3, toIndex: 1 });
  });

  it('clamps rows outside the list', () => {
    expect(dropIndexForRow(-3, 99, 3)).toEqual({ fromIndex: 2, toIndex: 0 });
  });

  it('dragging the top row to the bottom lands the object at array index 0', () => {
    const src = objs('a', 'b', 'c');
    const { fromIndex, toIndex } = dropIndexForRow(0, 2, 3);
    expect(moveByIndex(src, fromIndex, toIndex).map((o) => o.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('rowAtPointer', () => {
  const rects = [
    { top: 100, height: 40 },
    { top: 140, height: 40 },
    { top: 180, height: 40 },
  ];

  it('finds the row under the pointer', () => {
    expect(rowAtPointer(rects, 110)).toBe(0);
    expect(rowAtPointer(rects, 150)).toBe(1);
    expect(rowAtPointer(rects, 190)).toBe(2);
  });

  it('clamps above the first and below the last row', () => {
    expect(rowAtPointer(rects, -500)).toBe(0);
    expect(rowAtPointer(rects, 9999)).toBe(2);
  });

  it('returns null for an empty list', () => {
    expect(rowAtPointer([], 100)).toBeNull();
  });

  it('skips zero-height rows (mid-animation) instead of trapping the drop', () => {
    const collapsing = [
      { top: 100, height: 0 },
      { top: 100, height: 40 },
    ];
    expect(rowAtPointer(collapsing, 110)).toBe(1);
  });
});

describe('paintOrderHint', () => {
  it('describes the top, middle and bottom honestly', () => {
    expect(paintOrderHint(0, 3)).toBe('Paints on top of everything');
    expect(paintOrderHint(2, 3)).toBe('Paints underneath everything');
    expect(paintOrderHint(1, 3)).toBe('Paints over 1 layer');
    expect(paintOrderHint(1, 4)).toBe('Paints over 2 layers');
  });

  it('says something sensible for a one-layer scene', () => {
    expect(paintOrderHint(0, 1)).toBe('The only layer');
  });
});
