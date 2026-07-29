import { describe, it, expect } from 'vitest';
import {
  BURST_MAX,
  MAX_PENDING,
  SOLO_MS,
  BURST_MAX_MS,
  beamOriginRect,
  burstCells,
  burstColumns,
  burstLandingRect,
  ceremonyDurationMs,
  ceremonyIds,
  ceremonyLabel,
  emptyArrivalQueue,
  enqueueArrival,
  finishCeremony,
  spotlightIdFor,
  startNextCeremony,
  type ArrivalQueueState,
  type WallArrival,
} from './wallArrivals';

function arrival(id: string, guestName: string | null = null): WallArrival {
  return { id, guestName, imageUrl: `https://cdn.example/${id}.jpg`, mediaType: 'image' };
}

function enqueueAll(state: ArrivalQueueState, ids: string[]): ArrivalQueueState {
  return ids.reduce((s, id) => enqueueArrival(s, arrival(id)), state);
}

describe('enqueueArrival — queueing', () => {
  it('appends in arrival order', () => {
    const s = enqueueAll(emptyArrivalQueue(), ['a', 'b', 'c']);
    expect(s.pending.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores an id already waiting (realtime re-delivery)', () => {
    const s = enqueueAll(emptyArrivalQueue(), ['a', 'a']);
    expect(s.pending).toHaveLength(1);
  });

  it('ignores an id already on screen (approve-after-insert double path)', () => {
    const playing = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a']));
    const s = enqueueArrival(playing, arrival('a'));
    expect(s.pending).toHaveLength(0);
  });

  it('returns the SAME state object for a duplicate, so React skips the render', () => {
    const s = enqueueAll(emptyArrivalQueue(), ['a']);
    expect(enqueueArrival(s, arrival('a'))).toBe(s);
  });

  it('does not mutate the input state', () => {
    const before = enqueueAll(emptyArrivalQueue(), ['a']);
    enqueueArrival(before, arrival('b'));
    expect(before.pending.map((a) => a.id)).toEqual(['a']);
  });
});

describe('enqueueArrival — the bound', () => {
  const ids = Array.from({ length: MAX_PENDING + 5 }, (_, i) => `p${i}`);

  it('never grows past MAX_PENDING', () => {
    const s = enqueueAll(emptyArrivalQueue(), ids);
    expect(s.pending).toHaveLength(MAX_PENDING);
  });

  it('evicts the OLDEST, keeping the newest arrivals', () => {
    const s = enqueueAll(emptyArrivalQueue(), ids);
    expect(s.pending[0].id).toBe('p5');
    expect(s.pending[s.pending.length - 1].id).toBe(`p${MAX_PENDING + 4}`);
  });

  it('counts every eviction so the ceremony can still report them', () => {
    const s = enqueueAll(emptyArrivalQueue(), ids);
    expect(s.dropped).toBe(5);
  });
});

describe('startNextCeremony — the coalescing threshold', () => {
  it('one waiting arrival plays SOLO', () => {
    const s = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a']));
    expect(s.playing?.kind).toBe('solo');
    expect(s.playing?.arrivals.map((a) => a.id)).toEqual(['a']);
    expect(s.playing?.durationMs).toBe(SOLO_MS);
  });

  it('two waiting arrivals coalesce into ONE burst instead of two beams', () => {
    const s = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a', 'b']));
    expect(s.playing?.kind).toBe('burst');
    expect(s.playing?.arrivals.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('drains the ENTIRE backlog into one ceremony — never a queue of bursts', () => {
    const s = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));
    expect(s.pending).toHaveLength(0);
    expect(s.playing?.arrivals).toHaveLength(BURST_MAX);
    expect(s.playing?.overflow).toBe(2);
  });

  it('draws the NEWEST BURST_MAX, in arrival order', () => {
    const s = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));
    expect(s.playing?.arrivals.map((a) => a.id)).toEqual(['c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('folds evicted arrivals into the same overflow count', () => {
    const ids = Array.from({ length: MAX_PENDING + 3 }, (_, i) => `p${i}`);
    const s = startNextCeremony(enqueueAll(emptyArrivalQueue(), ids));
    // 3 evicted + (MAX_PENDING - BURST_MAX) held back from drawing
    expect(s.playing?.overflow).toBe(3 + MAX_PENDING - BURST_MAX);
    expect(s.dropped).toBe(0);
  });

  it('is a no-op while a ceremony is on screen', () => {
    const playing = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a']));
    const withMore = enqueueAll(playing, ['b', 'c']);
    expect(startNextCeremony(withMore)).toBe(withMore);
    expect(withMore.pending.map((a) => a.id)).toEqual(['b', 'c']);
  });

  it('is a no-op with nothing waiting', () => {
    const s = emptyArrivalQueue();
    expect(startNextCeremony(s)).toBe(s);
  });

  it('mints a fresh key per ceremony so the overlay always remounts', () => {
    const first = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a']));
    const second = startNextCeremony(enqueueAll(finishCeremony(first), ['a2']));
    expect(first.playing?.key).not.toBe(second.playing?.key);
  });
});

describe('drain order', () => {
  it('serialises: nothing starts until the previous ceremony finishes', () => {
    let s = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a']));
    s = enqueueAll(s, ['b']);
    expect(startNextCeremony(s).playing?.arrivals.map((a) => a.id)).toEqual(['a']);
    s = finishCeremony(s);
    expect(s.playing).toBeNull();
    s = startNextCeremony(s);
    expect(s.playing?.arrivals.map((a) => a.id)).toEqual(['b']);
  });

  it('plays solos strictly first-in-first-out at a calm rate', () => {
    let s = emptyArrivalQueue();
    const seen: string[] = [];
    for (const id of ['a', 'b', 'c']) {
      s = enqueueArrival(s, arrival(id));
      s = startNextCeremony(s);
      seen.push(...(s.playing?.arrivals ?? []).map((a) => a.id));
      s = finishCeremony(s);
    }
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('finishCeremony on an empty stage is a no-op', () => {
    const s = emptyArrivalQueue();
    expect(finishCeremony(s)).toBe(s);
  });
});

describe('ceremonyDurationMs', () => {
  it('is the solo length for 0 or 1 photos', () => {
    expect(ceremonyDurationMs(0)).toBe(SOLO_MS);
    expect(ceremonyDurationMs(1)).toBe(SOLO_MS);
  });

  it('grows with photo count but is capped', () => {
    expect(ceremonyDurationMs(2)).toBeGreaterThan(ceremonyDurationMs(1));
    expect(ceremonyDurationMs(50)).toBeLessThanOrEqual(BURST_MAX_MS);
  });
});

describe('spotlightIdFor / ceremonyIds / ceremonyLabel', () => {
  it('hands the spotlight the newest photo of the ceremony, not just the last insert', () => {
    const s = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a', 'b', 'c']));
    expect(spotlightIdFor(s.playing)).toBe('c');
  });

  it('has no spotlight id with no ceremony', () => {
    expect(spotlightIdFor(null)).toBeNull();
  });

  it('reports every id the ceremony is carrying', () => {
    const s = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a', 'b']));
    expect(ceremonyIds(s.playing)).toEqual(new Set(['a', 'b']));
    expect(ceremonyIds(null).size).toBe(0);
  });

  it('names the guest on a solo', () => {
    const s = startNextCeremony(enqueueArrival(emptyArrivalQueue(), arrival('a', 'Amara')));
    expect(ceremonyLabel(s.playing!)).toBe('Amara just shared a moment');
  });

  it('falls back gracefully for an anonymous solo, including a blank name', () => {
    const blank = startNextCeremony(enqueueArrival(emptyArrivalQueue(), arrival('a', '   ')));
    expect(ceremonyLabel(blank.playing!)).toBe('A new moment has arrived');
  });

  it('counts drawn AND overflowed photos in the burst headline', () => {
    const s = startNextCeremony(enqueueAll(emptyArrivalQueue(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));
    expect(ceremonyLabel(s.playing!)).toBe('8 moments just landed');
  });
});

describe('beamOriginRect', () => {
  const tile = { left: 900, top: 300, width: 360, height: 640 };

  it('starts fully below the bottom edge so the photo flies IN', () => {
    const r = beamOriginRect(tile, 1440, 900);
    expect(r.top).toBeGreaterThanOrEqual(900);
  });

  it('is horizontally centred', () => {
    const r = beamOriginRect(tile, 1440, 900);
    expect(r.left + r.width / 2).toBeCloseTo(720, 6);
  });

  it('keeps the destination aspect so the dissolve is not distorted', () => {
    const r = beamOriginRect(tile, 1440, 900);
    expect(r.width / r.height).toBeCloseTo(360 / 640, 4);
  });

  it('never collapses to zero area, even for a degenerate tile', () => {
    const r = beamOriginRect({ left: 0, top: 0, width: 0, height: 0 }, 1440, 900);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

describe('burst composite geometry', () => {
  it('keeps the grid squarish as the count grows', () => {
    expect(burstColumns(1)).toBe(1);
    expect(burstColumns(2)).toBe(2);
    expect(burstColumns(4)).toBe(2);
    expect(burstColumns(6)).toBe(3);
  });

  it('produces exactly one cell per photo', () => {
    expect(burstCells(5, 600, 800)).toHaveLength(5);
  });

  it('tiles the composite without overlap in reading order', () => {
    const cells = burstCells(4, 600, 800);
    expect(cells[0].left).toBe(0);
    expect(cells[1].left).toBe(300);
    expect(cells[2].top).toBe(400);
    expect(cells[0].width).toBe(300);
  });

  it('CENTRES a final partial row — an empty corner cell reads as a failed load', () => {
    // 5 photos in a 3-wide grid: row 2 holds 2 cells, centred rather than
    // left-aligned with a hole on the right.
    const cells = burstCells(5, 600, 800);
    expect(cells[3].left).toBe(100); // (3-2)*200/2
    expect(cells[4].left).toBe(300);
    expect(cells[3].top).toBe(400);
  });

  it('leaves a full final row untouched', () => {
    const cells = burstCells(6, 600, 800);
    expect(cells[3].left).toBe(0);
  });

  it('applies padding inside each cell', () => {
    const [c] = burstCells(4, 600, 800, 6);
    expect(c.left).toBe(6);
    expect(c.width).toBe(288);
  });

  it('returns nothing for a zero count or zero canvas', () => {
    expect(burstCells(0, 600, 800)).toEqual([]);
    expect(burstCells(4, 0, 800)).toEqual([]);
  });

  it('lands the composite centred and inside the viewport', () => {
    const r = burstLandingRect(6, 1440, 900);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(1440);
    expect(r.top + r.height).toBeLessThanOrEqual(900);
  });

  it('stays inside a narrow phone viewport too', () => {
    const r = burstLandingRect(6, 390, 844);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(390);
  });
});
