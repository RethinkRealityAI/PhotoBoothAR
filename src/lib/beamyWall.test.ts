import { describe, expect, it } from 'vitest';
import {
  SHOT_TILES, SWAP_MAX_MS, SWAP_MIN_MS, WALL_CENTRE, WALL_TILES, initialWall, nextSwap, rippleRings, swapDelay,
} from './beamyWall';
import { seededRandom } from './brandLanding';

describe('beamyWall', () => {
  it('starts with nine distinct photos and refuses a pool with no spare', () => {
    const s = initialWall(13, seededRandom(7));
    expect(s.tiles).toHaveLength(WALL_TILES);
    expect(new Set(s.tiles).size).toBe(WALL_TILES);
    for (const i of s.tiles) expect(i >= 0 && i < 13).toBe(true);
    expect(() => initialWall(9, seededRandom(1))).toThrow();
    expect(() => initialWall(4.5, seededRandom(1))).toThrow();
  });

  it('never repeats a tile, never shows a duplicate, never touches a frozen tile', () => {
    for (const seed of [1, 2, 99, 12345]) {
      const rand = seededRandom(seed);
      let s = initialWall(13, rand);
      const frozen = new Set([WALL_CENTRE]);
      let prev: number | null = null;
      for (let step = 0; step < 2000; step++) {
        const r = nextSwap(s, 13, rand, step % 300 < 150 ? frozen : new Set());
        expect(r).not.toBeNull();
        if (r === null) return;
        expect(r.tile).not.toBe(prev);
        if (step % 300 < 150) expect(r.tile).not.toBe(WALL_CENTRE);
        expect(s.tiles).not.toContain(r.image);
        expect(new Set(r.state.tiles).size).toBe(WALL_TILES);
        expect(r.state.tiles.filter((x, i) => x !== s.tiles[i])).toEqual([r.image]);
        prev = r.tile;
        s = r.state;
      }
    }
  });

  it('is deterministic for a seed', () => {
    const run = (seed: number) => {
      const rand = seededRandom(seed);
      let s = initialWall(13, rand);
      const out: number[] = [];
      for (let i = 0; i < 40; i++) { const r = nextSwap(s, 13, rand); if (r === null) break; out.push(r.tile, r.image); s = r.state; }
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('returns null when every tile is frozen or just changed', () => {
    const s = { tiles: [0, 1, 2, 3, 4, 5, 6, 7, 8], last: 8 };
    expect(nextSwap(s, 13, seededRandom(3), new Set([0, 1, 2, 3, 4, 5, 6, 7]))).toBeNull();
    expect(nextSwap(s, 9, seededRandom(3))).toBeNull();
  });

  it('waits 1.5 to 2.5 seconds between swaps', () => {
    const rand = seededRandom(5);
    for (let i = 0; i < 500; i++) {
      const d = swapDelay(rand);
      expect(d).toBeGreaterThanOrEqual(SWAP_MIN_MS);
      expect(d).toBeLessThan(SWAP_MAX_MS);
    }
    expect(swapDelay(() => 1)).toBeLessThan(SWAP_MAX_MS);
    expect(swapDelay(() => -1)).toBe(SWAP_MIN_MS);
  });

  it('rings the ripple out from the centre', () => {
    expect(rippleRings()).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    expect(rippleRings(0)).toEqual([0, 1, 2, 1, 1, 2, 2, 2, 2]);
  });

  it('puts the newest shot in the centre and covers every tile once', () => {
    expect(SHOT_TILES[0]).toBe(WALL_CENTRE);
    expect([...SHOT_TILES].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
