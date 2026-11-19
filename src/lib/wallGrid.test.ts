import { describe, expect, it } from 'vitest';
import { createGrid, gridRotationMs, rotateGrid, syncGrid, type GridState } from './wallGrid';

const ids = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Deterministic PRNG so the long-run properties are reproducible. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function onScreen(s: GridState) {
  return s.cells.filter((c): c is string => c !== null);
}

function expectNoDuplicates(s: GridState) {
  const shown = onScreen(s);
  expect(new Set(shown).size).toBe(shown.length);
}

describe('createGrid', () => {
  it('fills cells with the newest posts in order', () => {
    const s = createGrid(ids(20), 9);
    expect(s.cells).toEqual(ids(9));
    expect(s.lastCell).toBeNull();
  });

  it('leaves cells empty when there are fewer posts than cells', () => {
    const s = createGrid(ids(3), 9);
    expect(s.cells.slice(0, 3)).toEqual(['p0', 'p1', 'p2']);
    expect(s.cells.slice(3).every((c) => c === null)).toBe(true);
  });

  it('never seeds a duplicate even from a list that repeats an id', () => {
    const s = createGrid(['a', 'b', 'a', 'c'], 4);
    expectNoDuplicates(s);
    expect(s.cells).toEqual(['a', 'b', 'c', null]);
  });
});

describe('rotateGrid', () => {
  it('does nothing when every post is already on screen', () => {
    const s = createGrid(ids(9), 9);
    const r = rotateGrid(s, ids(9), { random: () => 0.5 });
    expect(r.change).toBeNull();
    expect(r.state).toBe(s);
  });

  it('changes exactly one cell per step and never the same cell twice in a row', () => {
    const all = ids(40);
    let s = createGrid(all, 16);
    const rnd = seeded(7);
    let last: number | null = null;
    for (let step = 0; step < 600; step += 1) {
      const before = [...s.cells];
      const r = rotateGrid(s, all, { random: rnd });
      expect(r.change).not.toBeNull();
      const diff = r.state.cells.filter((c, i) => c !== before[i]).length;
      expect(diff).toBe(1);
      expect(r.change!.cell).not.toBe(last);
      last = r.change!.cell;
      s = r.state;
      expectNoDuplicates(s);
    }
  });

  it('is fair: every post gets shown, never-shown posts first', () => {
    const all = ids(30);
    let s = createGrid(all, 9);
    const shown = new Set(onScreen(s));
    // 21 off-screen posts → 21 steps bring every one of them in.
    for (let step = 0; step < 21; step += 1) {
      const r = rotateGrid(s, all, { random: seeded(step) });
      expect(shown.has(r.change!.id!)).toBe(false);
      shown.add(r.change!.id!);
      s = r.state;
    }
    expect(shown.size).toBe(30);
  });

  it('never rotates a protected post out', () => {
    const all = ids(30);
    let s = createGrid(all, 9);
    const protect = new Set(['p0', 'p4']);
    const rnd = seeded(3);
    for (let step = 0; step < 200; step += 1) {
      s = rotateGrid(s, all, { random: rnd, protect }).state;
      expect(s.cells).toContain('p0');
      expect(s.cells).toContain('p4');
    }
  });

  it('returns no change when every eligible tile is protected', () => {
    const all = ids(5);
    const s = createGrid(all, 4);
    const r = rotateGrid(s, all, { protect: new Set(['p0', 'p1', 'p2', 'p3']) });
    expect(r.change).toBeNull();
  });

  it('survives a hostile random source', () => {
    const all = ids(20);
    const s = createGrid(all, 9);
    for (const v of [NaN, -1, 1, 5]) {
      const r = rotateGrid(s, all, { random: () => v });
      expect(r.change).not.toBeNull();
      expect(r.change!.cell).toBeGreaterThanOrEqual(0);
      expect(r.change!.cell).toBeLessThan(9);
    }
  });
});

describe('syncGrid', () => {
  it('places a new arrival in an empty cell first', () => {
    const s = createGrid(ids(3), 9);
    const r = syncGrid(s, ['new', ...ids(3)], 9);
    expect(r.changes).toEqual([{ cell: 3, id: 'new', reason: 'arrival' }]);
    expectNoDuplicates(r.state);
  });

  it('on a full wall, the arrival replaces the longest-shown, unprotected photo', () => {
    const all = ids(20);
    let s = createGrid(all, 9);
    // Rotate a few times so lastShown differs across cells.
    const rnd = seeded(11);
    for (let i = 0; i < 5; i += 1) s = rotateGrid(s, all, { random: rnd }).state;
    const keep = s.cells[0]!;
    const oldest = s.cells
      .map((id, cell) => ({ id: id!, cell }))
      .filter((c) => c.id !== keep && c.cell !== s.lastCell)
      .sort((a, b) => (s.lastShown[a.id] ?? -1) - (s.lastShown[b.id] ?? -1))[0];
    const r = syncGrid(s, ['new', ...all], 9, new Set([keep]));
    const arrival = r.changes.find((c) => c.reason === 'arrival')!;
    expect(arrival.id).toBe('new');
    expect(r.state.cells[arrival.cell]).toBe('new');
    expect(r.state.cells).toContain(keep);
    expect(s.lastShown[s.cells[arrival.cell]!]).toBe(s.lastShown[oldest.id]);
    expectNoDuplicates(r.state);
  });

  it('a rush bigger than the wall keeps the NEWEST arrivals on screen', () => {
    const s = createGrid(ids(9), 9);
    const rush = ids(12, 'n');
    const r = syncGrid(s, [...rush, ...ids(9)], 9);
    const arrived = r.changes.filter((c) => c.reason === 'arrival').map((c) => c.id);
    expect(arrived).toHaveLength(9);
    expect(new Set(arrived)).toEqual(new Set(rush.slice(0, 9)));
    expectNoDuplicates(r.state);
  });

  it('backfilled OLDER posts from a reconcile are not arrivals', () => {
    const s = createGrid(ids(9), 9);
    const r = syncGrid(s, [...ids(9), 'old1', 'old2'], 9);
    expect(r.changes.filter((c) => c.reason === 'arrival')).toHaveLength(0);
    // …but they are in the rotation.
    const next = rotateGrid(r.state, [...ids(9), 'old1', 'old2'], { random: () => 0 });
    expect(['old1', 'old2']).toContain(next.change!.id);
  });

  it('a removed post leaves at once and its hole is filled from off screen', () => {
    const all = ids(12);
    const s = createGrid(all, 9);
    const remaining = all.filter((id) => id !== 'p4');
    const r = syncGrid(s, remaining, 9);
    expect(r.state.cells).not.toContain('p4');
    expect(r.changes.some((c) => c.reason === 'removed' && c.cell === 4)).toBe(true);
    expect(r.state.cells[4]).not.toBeNull();
    expectNoDuplicates(r.state);
  });

  it('a removal with nothing off screen leaves an empty cell', () => {
    const s = createGrid(ids(9), 9);
    const r = syncGrid(s, ids(9).filter((id) => id !== 'p2'), 9);
    expect(r.state.cells[2]).toBeNull();
  });

  it('a grid-size change re-seeds without inventing arrivals', () => {
    const all = ids(30);
    const s = createGrid(all, 9);
    const r = syncGrid(s, all, 25);
    expect(r.changes).toEqual([]);
    expect(r.state.cells).toHaveLength(25);
    expectNoDuplicates(r.state);
    const after = syncGrid(r.state, all, 25);
    expect(after.changes.filter((c) => c.reason === 'arrival')).toHaveLength(0);
  });

  it('is idempotent for an unchanged list', () => {
    const s = createGrid(ids(20), 16);
    const r = syncGrid(s, ids(20), 16);
    expect(r.changes).toEqual([]);
    expect(r.state.cells).toEqual(s.cells);
  });

  it('first posts on an empty wall arrive', () => {
    const s = createGrid([], 9);
    const r = syncGrid(s, ['a'], 9);
    expect(r.changes).toEqual([{ cell: 0, id: 'a', reason: 'arrival' }]);
  });

  it('holds the invariants across a long mixed run', () => {
    let all = ids(10);
    let s = createGrid(all, 16);
    const rnd = seeded(99);
    let n = 0;
    for (let step = 0; step < 400; step += 1) {
      const roll = rnd();
      if (roll < 0.15) {
        all = [`a${n++}`, ...all];
        s = syncGrid(s, all, 16).state;
      } else if (roll < 0.2 && all.length > 2) {
        all = all.filter((_, i) => i !== Math.floor(rnd() * all.length));
        s = syncGrid(s, all, 16).state;
      } else {
        s = rotateGrid(s, all, { random: rnd }).state;
      }
      expectNoDuplicates(s);
      for (const id of onScreen(s)) expect(all).toContain(id);
      // Never an empty cell while a post is waiting off screen.
      if (all.length >= 16) expect(s.cells.every((c) => c !== null)).toBe(true);
    }
  });
});

describe('gridRotationMs', () => {
  it('turns bigger walls a little faster, always calm', () => {
    expect(gridRotationMs(3)).toBeGreaterThan(gridRotationMs(4));
    expect(gridRotationMs(4)).toBeGreaterThan(gridRotationMs(5));
    expect(gridRotationMs(5)).toBeGreaterThanOrEqual(3000);
  });
});
