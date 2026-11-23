import { describe, it, expect } from 'vitest';
import { FRAMED_KB, LEGACY_KB, kenBurnsFor, keyframeContained } from './kenBurns';

describe('kenBurns', () => {
  it('every framed keyframe keeps the whole photo inside its tile', () => {
    // Smallest tile the wall draws a featured photo in (a phone-sized spotlight).
    for (const [w, h] of [[200, 356], [600, 1067], [1080, 1920]]) {
      for (const c of FRAMED_KB) {
        expect(keyframeContained(c.from, w, h)).toBe(true);
        expect(keyframeContained(c.to, w, h)).toBe(true);
      }
    }
  });

  it('the legacy drift is the shipped one (zooms in, so it crops)', () => {
    expect(LEGACY_KB[0]).toEqual({ from: { scale: 1.08, x: -2, y: -2 }, to: { scale: 1.18, x: 2, y: 2 } });
    expect(LEGACY_KB.every((c) => !keyframeContained(c.to, 1080, 1920))).toBe(true);
  });

  it('the framed drift still moves (it is not a still image)', () => {
    for (const c of FRAMED_KB) expect(c.from.scale).not.toBe(c.to.scale);
  });

  it('kenBurnsFor cycles the right set, including negative and large indexes', () => {
    expect(kenBurnsFor(0, false)).toBe(LEGACY_KB[0]);
    expect(kenBurnsFor(5, false)).toBe(LEGACY_KB[1]);
    expect(kenBurnsFor(2, true)).toBe(FRAMED_KB[2]);
    expect(kenBurnsFor(-1, true)).toBe(FRAMED_KB[3]);
    expect(kenBurnsFor(4001, true)).toBe(FRAMED_KB[1]);
  });

  it('a zoom past 1 is never contained, whatever the offset', () => {
    expect(keyframeContained({ scale: 1.01, x: 0, y: 0 }, 1080, 1920)).toBe(false);
    expect(keyframeContained({ scale: 1, x: 1, y: 0 }, 1080, 1920)).toBe(false);
  });
});
