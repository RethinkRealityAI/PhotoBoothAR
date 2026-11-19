/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallGrid — the scheduler behind the live wall's N×N grid layout. Pure (no
 * React, no DOM, no timers) so every rule the room can see is unit-tested:
 *
 *   - NO DUPLICATES: a post is in at most one cell at any moment.
 *   - CALM: rotation changes ONE cell per step, and never the same cell twice
 *     in a row (a flicker in one corner reads as a glitch, not as life).
 *   - FAIR: the post brought in is the one that has been off screen longest
 *     (never-shown first), so over an evening every guest gets their turn
 *     instead of the newest twenty hogging the wall.
 *   - ARRIVALS WIN: a genuinely new post (newer than anything seen before)
 *     takes a cell immediately — empty first, else the one whose photo has
 *     been up longest — so the arrival ceremony always has a real tile to
 *     land in. Older rows a full reconcile backfills are NOT arrivals; they
 *     just join the rotation.
 *   - PROTECTED: ids the caller marks (fresh arrivals, mid-ceremony tiles) are
 *     never rotated out.
 *
 * Ids are passed newest first, exactly as the wall's `posts` array is ordered.
 */

export interface GridState {
  /** One entry per cell, row-major; null = nothing to show there yet. */
  cells: (string | null)[];
  /** The cell the last step changed — never the next rotation's target. */
  lastCell: number | null;
  /** Monotonic step counter (not wall-clock time). */
  tick: number;
  /** id → the tick it last entered or left the screen. */
  lastShown: Record<string, number>;
  /** Every id this grid has ever been told about. */
  seen: Record<string, true>;
}

export type GridChangeReason = 'arrival' | 'rotate' | 'fill' | 'removed';

export interface GridChange {
  cell: number;
  id: string | null;
  reason: GridChangeReason;
}

/** How often the grid swaps one tile, by grid size. Bigger walls have more
 *  tiles to visit, so they turn a little faster — still one at a time. */
export function gridRotationMs(gridSize: number): number {
  if (gridSize <= 3) return 5200;
  if (gridSize === 4) return 4200;
  return 3400;
}

/** A fresh grid: the newest posts fill the cells in order, nothing counts as an arrival. */
export function createGrid(ids: readonly string[], cellCount: number): GridState {
  const n = Math.max(0, Math.floor(cellCount));
  const cells: (string | null)[] = Array.from({ length: n }, () => null);
  const seen: Record<string, true> = {};
  const lastShown: Record<string, number> = {};
  const unique = dedupe(ids);
  for (const id of unique) seen[id] = true;
  for (let i = 0; i < n && i < unique.length; i += 1) {
    cells[i] = unique[i];
    lastShown[unique[i]] = 0;
  }
  return { cells, lastCell: null, tick: 1, lastShown, seen };
}

function dedupe(ids: readonly string[]): string[] {
  const out: string[] = [];
  const s = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || s.has(id)) continue;
    s.add(id);
    out.push(id);
  }
  return out;
}

function shownAt(state: GridState, id: string): number {
  const v = state.lastShown[id];
  return v === undefined ? -Infinity : v;
}

/** Off-screen ids, least recently shown first (never-shown first; ties → newer first). */
function offScreenByStaleness(state: GridState, ids: readonly string[], onScreen: ReadonlySet<string>): string[] {
  const order = new Map<string, number>();
  ids.forEach((id, i) => { if (!order.has(id)) order.set(id, i); });
  return [...order.keys()]
    .filter((id) => !onScreen.has(id))
    .sort((a, b) => shownAt(state, a) - shownAt(state, b) || (order.get(a)! - order.get(b)!));
}

/**
 * Reconcile the grid with the current post list: resize, drop removed posts,
 * place arrivals, fill holes. Returns the new state and what changed (the
 * caller highlights 'arrival' cells).
 */
export function syncGrid(
  prev: GridState,
  ids: readonly string[],
  cellCount: number,
  protect: ReadonlySet<string> = new Set(),
): { state: GridState; changes: GridChange[] } {
  const unique = dedupe(ids);
  if (Math.floor(cellCount) !== prev.cells.length) {
    // A new grid size is a new composition — re-seed, but remember what has
    // been seen so nothing on the old wall is mistaken for an arrival.
    const next = createGrid(unique, cellCount);
    next.seen = { ...prev.seen, ...next.seen };
    next.lastShown = { ...prev.lastShown, ...next.lastShown };
    next.tick = prev.tick + 1;
    return { state: next, changes: [] };
  }

  const state: GridState = {
    cells: [...prev.cells],
    lastCell: prev.lastCell,
    tick: prev.tick + 1,
    lastShown: { ...prev.lastShown },
    seen: { ...prev.seen },
  };
  const changes: GridChange[] = [];
  const live = new Set(unique);

  // 1. Posts that were hidden/deleted leave immediately.
  state.cells.forEach((id, cell) => {
    if (id !== null && !live.has(id)) {
      state.cells[cell] = null;
      changes.push({ cell, id: null, reason: 'removed' });
    }
  });

  // 2. Arrivals: unseen ids NEWER than the newest id seen before. Unseen ids
  //    further down the list are backfill from a reconcile, not arrivals.
  const arrivals: string[] = [];
  for (const id of unique) {
    if (prev.seen[id] === true) break;
    arrivals.push(id);
  }
  for (const id of unique) state.seen[id] = true;

  // The newest arrivals win when a rush exceeds the wall.
  const placing = arrivals.slice(0, state.cells.length).reverse(); // oldest first, newest last
  const taken = new Set<number>();
  for (const id of placing) {
    const cell = arrivalCell(state, taken, protect);
    if (cell === null) break;
    const out = state.cells[cell];
    if (out !== null) state.lastShown[out] = state.tick;
    state.cells[cell] = id;
    state.lastShown[id] = state.tick;
    state.lastCell = cell;
    taken.add(cell);
    changes.push({ cell, id, reason: 'arrival' });
  }

  // 3. Holes (from removals, or a wall that had fewer posts than cells).
  const onScreen = new Set(state.cells.filter((c): c is string => c !== null));
  const pool = offScreenByStaleness(state, unique, onScreen);
  state.cells.forEach((id, cell) => {
    if (id !== null || pool.length === 0) return;
    const next = pool.shift()!;
    state.cells[cell] = next;
    state.lastShown[next] = state.tick;
    changes.push({ cell, id: next, reason: 'fill' });
  });

  return { state, changes };
}

/** Where an arrival lands: the first empty cell, else the longest-shown
 *  unprotected photo (avoiding the last-changed cell when there is a choice). */
function arrivalCell(state: GridState, taken: ReadonlySet<number>, protect: ReadonlySet<string>): number | null {
  const free = state.cells.findIndex((id, i) => id === null && !taken.has(i));
  if (free !== -1) return free;
  let best: number | null = null;
  let bestScore = Infinity;
  const consider = (strict: boolean) => {
    state.cells.forEach((id, i) => {
      if (id === null || taken.has(i)) return;
      if (strict && (protect.has(id) || i === state.lastCell)) return;
      const score = shownAt(state, id);
      if (score < bestScore) { bestScore = score; best = i; }
    });
  };
  consider(true);
  if (best === null) consider(false); // every tile protected: the arrival still wins
  return best;
}

/**
 * One calm rotation step: bring in the post that has been off screen longest,
 * into a random unprotected cell that is not the one changed last time.
 * Returns change: null when there is nothing to rotate (every post is
 * already on screen, or every tile is protected).
 */
export function rotateGrid(
  prev: GridState,
  ids: readonly string[],
  opts: { random?: () => number; protect?: ReadonlySet<string> } = {},
): { state: GridState; change: GridChange | null } {
  const random = opts.random ?? Math.random;
  const protect = opts.protect ?? new Set<string>();
  const onScreen = new Set(prev.cells.filter((c): c is string => c !== null));
  const incoming = offScreenByStaleness(prev, dedupe(ids), onScreen)[0];
  if (incoming === undefined) return { state: prev, change: null };

  const eligible: number[] = [];
  prev.cells.forEach((id, i) => {
    if (i === prev.lastCell) return;
    if (id !== null && protect.has(id)) return;
    eligible.push(i);
  });
  if (eligible.length === 0) return { state: prev, change: null };
  // Empty cells first (only possible right after a removal the caller has not synced).
  const empty = eligible.filter((i) => prev.cells[i] === null);
  const from = empty.length > 0 ? empty : eligible;
  const r = random();
  const pick = from[Math.min(from.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * from.length)))];

  const state: GridState = {
    cells: [...prev.cells],
    lastCell: pick,
    tick: prev.tick + 1,
    lastShown: { ...prev.lastShown },
    seen: { ...prev.seen, [incoming]: true },
  };
  const out = state.cells[pick];
  if (out !== null) state.lastShown[out] = state.tick;
  state.cells[pick] = incoming;
  state.lastShown[incoming] = state.tick;
  return { state, change: { cell: pick, id: incoming, reason: 'rotate' } };
}
