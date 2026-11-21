import { describe, expect, it } from 'vitest';
import { SHEET_FULL_GAP, SHEET_PEEK, nextSnapOnTap, sheetSnaps, snapAfterDrag } from './sheetSnap';

describe('phone options drawer', () => {
  const snaps = sheetSnaps(620);
  it('splits the room: peek, half, and full leaves preview on top', () => {
    expect(snaps).toEqual({ peek: SHEET_PEEK, half: 310, full: 620 - SHEET_FULL_GAP });
    // A tiny screen never inverts the order.
    const tiny = sheetSnaps(100);
    expect(tiny.peek).toBeLessThanOrEqual(tiny.half);
    expect(tiny.half).toBeLessThanOrEqual(tiny.full);
  });
  it('a tap opens one step at a time; full drops back to half', () => {
    expect(nextSnapOnTap('peek')).toBe('half');
    expect(nextSnapOnTap('half')).toBe('full');
    expect(nextSnapOnTap('full')).toBe('half');
  });
  it('a slow drag lands on the nearest snap', () => {
    expect(snapAfterDrag(100, 0, snaps)).toBe('peek');
    expect(snapAfterDrag(300, 0.1, snaps)).toBe('half');
    expect(snapAfterDrag(460, -0.1, snaps)).toBe('full');
  });
  it('a flick goes one snap further in its direction', () => {
    expect(snapAfterDrag(120, 1.2, snaps)).toBe('half');
    expect(snapAfterDrag(330, 1.2, snaps)).toBe('full');
    expect(snapAfterDrag(300, -1.2, snaps)).toBe('peek');
    expect(snapAfterDrag(470, -1.2, snaps)).toBe('half');
    expect(snapAfterDrag(snaps.full, 2, snaps)).toBe('full');
    expect(snapAfterDrag(SHEET_PEEK, -2, snaps)).toBe('peek');
  });
});
