import { describe, it, expect } from 'vitest';
import {
  detectSwipe, isDoubleTap, cycleIndex, isCrampedLandscape,
  SWIPE_MIN_PX, SWIPE_MAX_MS, DOUBLE_TAP_MS, DOUBLE_TAP_PX, CRAMPED_LANDSCAPE_MAX_H,
} from './boothGestures';

const at = (x: number, y: number, t: number) => ({ x, y, t });

describe('detectSwipe', () => {
  it('reports left for a leftward flick', () => {
    expect(detectSwipe(at(300, 400, 0), at(300 - SWIPE_MIN_PX - 10, 405, 180))).toBe('left');
  });

  it('reports right for a rightward flick', () => {
    expect(detectSwipe(at(100, 400, 0), at(100 + SWIPE_MIN_PX + 10, 398, 180))).toBe('right');
  });

  it('ignores a tap', () => {
    expect(detectSwipe(at(200, 400, 0), at(202, 401, 60))).toBeNull();
  });

  it('ignores travel below the distance threshold', () => {
    expect(detectSwipe(at(200, 400, 0), at(200 + SWIPE_MIN_PX - 1, 400, 100))).toBeNull();
  });

  it('ignores a vertical drag so the page can still scroll', () => {
    expect(detectSwipe(at(200, 100, 0), at(260, 400, 200))).toBeNull();
  });

  it('ignores a slow drag', () => {
    expect(detectSwipe(at(200, 400, 0), at(20, 400, SWIPE_MAX_MS + 1))).toBeNull();
  });

  it('accepts a diagonal that is still mostly horizontal', () => {
    expect(detectSwipe(at(300, 400, 0), at(180, 430, 200))).toBe('left');
  });
});

describe('isDoubleTap', () => {
  it('is false for the very first tap', () => {
    expect(isDoubleTap(null, at(10, 10, 0))).toBe(false);
  });

  it('is false for the first tap even at t=0 (0 is a real timestamp)', () => {
    // The null sentinel exists precisely so a t=0 first tap is not mistaken
    // for "already tapped at time zero".
    expect(isDoubleTap(null, at(10, 10, 0))).toBe(false);
    expect(isDoubleTap(at(10, 10, 0), at(12, 12, 100))).toBe(true);
  });

  it('is true for two quick taps in the same place', () => {
    expect(isDoubleTap(at(120, 300, 1000), at(126, 304, 1000 + DOUBLE_TAP_MS - 20))).toBe(true);
  });

  it('is false when the taps are too far apart in time', () => {
    expect(isDoubleTap(at(120, 300, 1000), at(120, 300, 1000 + DOUBLE_TAP_MS + 1))).toBe(false);
  });

  it('is false when the taps are too far apart in space', () => {
    expect(isDoubleTap(at(120, 300, 1000), at(120 + DOUBLE_TAP_PX + 5, 300, 1050))).toBe(false);
  });
});

describe('cycleIndex', () => {
  it('steps forward on a left swipe', () => {
    expect(cycleIndex(0, 3, 'left')).toBe(1);
    expect(cycleIndex(1, 3, 'left')).toBe(2);
  });

  it('wraps past the last filter back to "none" (-1)', () => {
    expect(cycleIndex(2, 3, 'left')).toBe(-1);
  });

  it('steps back from "none" to the last filter', () => {
    expect(cycleIndex(-1, 3, 'right')).toBe(2);
  });

  it('steps forward from "none" to the first filter', () => {
    expect(cycleIndex(-1, 3, 'left')).toBe(0);
  });

  it('steps backward and wraps symmetrically', () => {
    expect(cycleIndex(0, 3, 'right')).toBe(-1);
    expect(cycleIndex(2, 3, 'right')).toBe(1);
  });

  it('returns -1 for an empty list rather than NaN', () => {
    expect(cycleIndex(0, 0, 'left')).toBe(-1);
    expect(cycleIndex(-1, 0, 'right')).toBe(-1);
  });

  it('round-trips: left then right returns to the start, for every slot', () => {
    for (let i = -1; i < 5; i += 1) {
      expect(cycleIndex(cycleIndex(i, 5, 'left'), 5, 'right')).toBe(i);
    }
  });
});

describe('isCrampedLandscape', () => {
  it('is true for a phone held sideways', () => {
    expect(isCrampedLandscape(844, 390)).toBe(true);
    expect(isCrampedLandscape(640, 360)).toBe(true);
  });

  it('is false for a phone held upright', () => {
    expect(isCrampedLandscape(390, 844)).toBe(false);
    expect(isCrampedLandscape(430, 932)).toBe(false);
  });

  it('is false for a tablet or desktop in landscape — they have the height', () => {
    expect(isCrampedLandscape(1024, 768)).toBe(false);
    expect(isCrampedLandscape(1440, 900)).toBe(false);
  });

  it('is false exactly one pixel above the threshold', () => {
    expect(isCrampedLandscape(1200, CRAMPED_LANDSCAPE_MAX_H + 1)).toBe(false);
    expect(isCrampedLandscape(1200, CRAMPED_LANDSCAPE_MAX_H)).toBe(true);
  });

  it('is false for a zero-size viewport (pre-layout measurement)', () => {
    expect(isCrampedLandscape(0, 0)).toBe(false);
  });
});
