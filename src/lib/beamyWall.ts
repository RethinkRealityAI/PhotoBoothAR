/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The /beamy hero's live wall — a 3×3 grid whose tiles swap photos over time
 * so it reads as a wall filling up. Pure and seeded (no React, no timers), so
 * the rules hold in node tests:
 *
 *   • one tile changes per step, every SWAP_MIN_MS..SWAP_MAX_MS,
 *   • never the same tile twice in a row,
 *   • never a duplicate photo on the wall at once (the pool keeps spares),
 *   • frozen tiles (the centre while it holds Beamy's selfie, a visitor's
 *     own shot) are never swapped.
 */

export const WALL_COLS = 3;
export const WALL_TILES = WALL_COLS * WALL_COLS;
export const WALL_CENTRE = 4;
export const SWAP_MIN_MS = 1500;
export const SWAP_MAX_MS = 2500;

export interface WallState {
  /** Pool index shown on each tile. */
  tiles: number[];
  /** The tile changed last (never changed twice in a row). */
  last: number | null;
}

export interface Swap { tile: number; image: number; state: WallState; }

/** A seeded first wall: `tiles` distinct pool indices. Needs a spare photo to swap in. */
export function initialWall(pool: number, rand: () => number, tiles = WALL_TILES): WallState {
  if (!Number.isInteger(pool) || pool <= tiles) throw new Error(`the wall needs more than ${tiles} photos, got ${pool}`);
  const order = Array.from({ length: pool }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { tiles: order.slice(0, tiles), last: null };
}

const pick = <T,>(xs: T[], rand: () => number): T => xs[Math.min(xs.length - 1, Math.floor(Math.max(0, rand()) * xs.length))];

/**
 * The next swap: a tile that is neither frozen nor the one changed last, and
 * a photo not already on the wall. Null when no tile may change.
 */
export function nextSwap(s: WallState, pool: number, rand: () => number, frozen: ReadonlySet<number> = new Set()): Swap | null {
  const tiles = s.tiles.map((_, i) => i).filter((i) => !frozen.has(i) && i !== s.last);
  if (tiles.length === 0) return null;
  const onWall = new Set(s.tiles);
  const spare = Array.from({ length: pool }, (_, i) => i).filter((i) => !onWall.has(i));
  if (spare.length === 0) return null;
  const tile = pick(tiles, rand);
  const image = pick(spare, rand);
  const next = s.tiles.slice();
  next[tile] = image;
  return { tile, image, state: { tiles: next, last: tile } };
}

/** Wait before the next swap, in [SWAP_MIN_MS, SWAP_MAX_MS). */
export function swapDelay(rand: () => number): number {
  return SWAP_MIN_MS + Math.min(0.999999, Math.max(0, rand())) * (SWAP_MAX_MS - SWAP_MIN_MS);
}

/** Ring distance of each tile from `from` (0 = itself), for the landing ripple. */
export function rippleRings(from = WALL_CENTRE, cols = WALL_COLS): number[] {
  const fx = from % cols;
  const fy = Math.floor(from / cols);
  return Array.from({ length: cols * cols }, (_, i) => Math.max(Math.abs((i % cols) - fx), Math.abs(Math.floor(i / cols) - fy)));
}

/**
 * Which tiles a visitor's shots occupy, newest first: the centre, then the
 * corners and edges around it, so the newest is always where the beam lands.
 */
export const SHOT_TILES = [WALL_CENTRE, 0, 2, 6, 8, 1, 3, 5, 7] as const;
