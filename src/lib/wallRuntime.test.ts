import { describe, it, expect } from 'vitest';
import {
  BURN_IN_RADIUS_PX,
  MAX_FRAME_DT_S,
  MAX_ROW_ITEMS,
  MOSAIC_VIDEO_CAP,
  WALL_BASE_H,
  WALL_BASE_W,
  WALL_SCALE_MAX,
  WALL_SCALE_MIN,
  advanceOffset,
  autoplayVideoIds,
  boundRowItems,
  burnInOffset,
  clampFrameDelta,
  marqueeMetrics,
  mosaicTileMaxH,
  pollActionFor,
  socketStatusFrom,
  wallScale,
  wrapOffset,
} from './wallRuntime';

/* ── W3: the marquee that died permanently ─────────────────────────── */

describe('wrapOffset', () => {
  it('leaves an in-range offset alone', () => {
    expect(wrapOffset(120, 500)).toBe(120);
  });

  it('wraps a single overshoot exactly as the old subtraction did', () => {
    expect(wrapOffset(520, 500)).toBe(20);
  });

  it('RECOVERS a multi-period overshoot — the bug that blanked the wall', () => {
    // A four-second stall at 60 px/s past a 500 px period is >4 periods out.
    expect(wrapOffset(2520, 500)).toBe(20);
  });

  it('recovers a multi-period NEGATIVE overshoot (right-scrolling rows)', () => {
    expect(wrapOffset(-2520, 500)).toBe(480);
  });

  it('always lands inside [0, halfLen)', () => {
    for (const o of [-99999, -1, 0, 1, 499, 500, 1_000_000.5]) {
      const w = wrapOffset(o, 500);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(500);
    }
  });

  it('degrades to 0 rather than NaN for a degenerate strip', () => {
    expect(wrapOffset(120, 0)).toBe(0);
    expect(wrapOffset(120, -5)).toBe(0);
    expect(wrapOffset(Number.NaN, 500)).toBe(0);
  });
});

describe('clampFrameDelta', () => {
  it('passes a normal 60 Hz frame through untouched', () => {
    expect(clampFrameDelta(1 / 60)).toBeCloseTo(1 / 60, 6);
  });

  it('caps a four-second stall at one clamp window, not four seconds of scroll', () => {
    expect(clampFrameDelta(4)).toBe(MAX_FRAME_DT_S);
  });

  it('rejects a backwards or non-finite timestamp', () => {
    expect(clampFrameDelta(-1)).toBe(0);
    expect(clampFrameDelta(Number.NaN)).toBe(0);
    expect(clampFrameDelta(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('advanceOffset', () => {
  it('advances left-scrolling rows by speed × dt', () => {
    expect(advanceOffset(0, 1, 60, 0.5, 1000)).toBeCloseTo(3, 6); // dt clamped to 0.05
  });

  it('advances right-scrolling rows into the wrapped upper range', () => {
    expect(advanceOffset(0, -1, 60, 1 / 60, 1000)).toBeCloseTo(999, 6);
  });

  it('a five-minute sleep advances at most ONE clamped frame', () => {
    const after = advanceOffset(0, 1, 60, 300, 1000);
    expect(after).toBeCloseTo(60 * MAX_FRAME_DT_S, 6);
  });

  it('stays on screen across a thousand pathological frames', () => {
    let o = 0;
    for (let i = 0; i < 1000; i += 1) o = advanceOffset(o, 1, 240, 9, 800);
    expect(o).toBeGreaterThanOrEqual(0);
    expect(o).toBeLessThan(800);
  });
});

/* ── W4: poll cadence ──────────────────────────────────────────────── */

describe('pollActionFor', () => {
  it('does nothing at all while the wall is hidden', () => {
    for (const tick of [1, 4, 16]) {
      expect(pollActionFor({ visible: false, status: 'down', tick })).toBe('skip');
    }
  });

  it('with the socket live, most ticks do nothing', () => {
    expect(pollActionFor({ visible: true, status: 'live', tick: 1 })).toBe('skip');
    expect(pollActionFor({ visible: true, status: 'live', tick: 3 })).toBe('skip');
  });

  it('with the socket live, catches up once a minute and reconciles every four', () => {
    expect(pollActionFor({ visible: true, status: 'live', tick: 4 })).toBe('incremental');
    expect(pollActionFor({ visible: true, status: 'live', tick: 8 })).toBe('incremental');
    expect(pollActionFor({ visible: true, status: 'live', tick: 16 })).toBe('full');
  });

  it('with the socket down, polls every tick and reconciles every fourth', () => {
    expect(pollActionFor({ visible: true, status: 'down', tick: 1 })).toBe('incremental');
    expect(pollActionFor({ visible: true, status: 'down', tick: 3 })).toBe('incremental');
    expect(pollActionFor({ visible: true, status: 'down', tick: 4 })).toBe('full');
  });

  it('treats a still-connecting socket like a live one, not a dead one', () => {
    expect(pollActionFor({ visible: true, status: 'connecting', tick: 1 })).toBe('skip');
    expect(pollActionFor({ visible: true, status: 'connecting', tick: 4 })).toBe('incremental');
  });

  it('never fires on tick 0 (the initial fetch already ran)', () => {
    expect(pollActionFor({ visible: true, status: 'down', tick: 0 })).toBe('skip');
  });

  it('is far quieter than the old fixed 20 s full pull', () => {
    let full = 0;
    for (let t = 1; t <= 16; t += 1) {
      if (pollActionFor({ visible: true, status: 'live', tick: t }) === 'full') full += 1;
    }
    expect(full).toBe(1); // one full pull per 4 minutes, was 12
  });
});

describe('socketStatusFrom', () => {
  it('maps SUBSCRIBED to live', () => {
    expect(socketStatusFrom('SUBSCRIBED')).toBe('live');
  });

  it('maps every failure state the channel can report to down', () => {
    for (const s of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
      expect(socketStatusFrom(s)).toBe('down');
    }
  });

  it('treats anything else as still connecting', () => {
    expect(socketStatusFrom('joining')).toBe('connecting');
    expect(socketStatusFrom('')).toBe('connecting');
  });
});

/* ── W5: legibility ────────────────────────────────────────────────── */

describe('wallScale', () => {
  it('is exactly 1 at the design viewport, so the browser view is unchanged', () => {
    expect(wallScale(WALL_BASE_W, WALL_BASE_H)).toBe(1);
  });

  it('scales up on a 4K projector', () => {
    expect(wallScale(3840, 2160)).toBe(WALL_SCALE_MAX);
  });

  it('pushes projection mode further than the windowed view', () => {
    expect(wallScale(3840, 2160, true)).toBeGreaterThan(wallScale(3840, 2160, false));
  });

  it('does not shrink type below the floor on a phone looking at the wall', () => {
    expect(wallScale(390, 844)).toBe(WALL_SCALE_MIN);
  });

  it('follows the SMALLER axis so a wide short window does not overflow', () => {
    expect(wallScale(3840, 900)).toBe(1);
  });

  it('survives a zero or non-finite measurement', () => {
    expect(wallScale(0, 0)).toBe(1);
    expect(wallScale(Number.NaN, 900)).toBe(1);
  });
});

describe('marqueeMetrics', () => {
  it('reproduces today’s card exactly on a 900 px-tall laptop', () => {
    const m = marqueeMetrics(900, 4);
    expect(m).toEqual({ cardH: 290, minCardW: 150, maxCardW: 360, gap: 12 });
  });

  it('more than doubles the card on a 4K projector', () => {
    const m = marqueeMetrics(2160, 4);
    expect(m.cardH).toBeGreaterThan(500);
    expect(m.maxCardW).toBeGreaterThan(600);
  });

  it('keeps four 4K rows inside the screen', () => {
    const m = marqueeMetrics(2160, 4);
    expect(m.cardH * 4 + m.gap * 3).toBeLessThanOrEqual(2160);
  });

  it('never returns a card smaller than the current fixed size', () => {
    for (const h of [200, 600, 844, 900, 1080, 2160, 4320]) {
      expect(marqueeMetrics(h, 4).cardH).toBeGreaterThanOrEqual(290);
    }
  });

  it('survives a zero row count or bad viewport', () => {
    expect(marqueeMetrics(0, 0).cardH).toBe(290);
    expect(marqueeMetrics(Number.NaN, 3).cardH).toBe(290);
  });
});

describe('mosaicTileMaxH', () => {
  it('does NOT cap a laptop or phone — the existing view must not move', () => {
    expect(mosaicTileMaxH(900)).toBe(0);
    expect(mosaicTileMaxH(844)).toBe(0);
    expect(mosaicTileMaxH(1200)).toBe(0);
  });

  it('caps on a 4K projector so more than one row of photos fits', () => {
    const cap = mosaicTileMaxH(2160);
    expect(cap).toBeGreaterThan(0);
    expect(cap * 2).toBeLessThan(2160);
  });

  it('survives a bad measurement', () => {
    expect(mosaicTileMaxH(Number.NaN)).toBe(0);
    expect(mosaicTileMaxH(0)).toBe(0);
  });
});

/* ── W4: caps ──────────────────────────────────────────────────────── */

describe('autoplayVideoIds', () => {
  const posts = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`,
    media_type: i % 2 === 0 ? 'video' : 'image',
  }));

  it('never lets more than `cap` decoders run', () => {
    expect(autoplayVideoIds(posts, MOSAIC_VIDEO_CAP).size).toBe(MOSAIC_VIDEO_CAP);
  });

  it('picks the NEWEST videos (array is newest-first)', () => {
    expect([...autoplayVideoIds(posts, 3)]).toEqual(['p0', 'p2', 'p4']);
  });

  it('ignores images entirely', () => {
    const imagesOnly = posts.filter((p) => p.media_type === 'image');
    expect(autoplayVideoIds(imagesOnly, 4).size).toBe(0);
  });

  it('returns everything it has when under the cap', () => {
    expect(autoplayVideoIds([{ id: 'a', media_type: 'video' }], 4).size).toBe(1);
  });

  it('handles a zero cap and a missing media_type', () => {
    expect(autoplayVideoIds(posts, 0).size).toBe(0);
    expect(autoplayVideoIds([{ id: 'a' }], 4).size).toBe(0);
  });
});

describe('boundRowItems', () => {
  it('caps a runaway row', () => {
    const items = Array.from({ length: 125 }, (_, i) => i);
    expect(boundRowItems(items)).toHaveLength(MAX_ROW_ITEMS);
  });

  it('keeps the newest end of the row', () => {
    expect(boundRowItems([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  });

  it('leaves a short row untouched', () => {
    const items = [1, 2, 3];
    expect(boundRowItems(items, 10)).toBe(items);
  });

  it('bounds the whole marquee well under the old 2000 elements', () => {
    // 4 rows × MAX_ROW_ITEMS × 4 duplicated copies
    expect(4 * MAX_ROW_ITEMS * 4).toBeLessThan(500);
  });
});

/* ── W7: burn-in drift ─────────────────────────────────────────────── */

describe('burnInOffset', () => {
  it('starts centred on x', () => {
    expect(burnInOffset(0).x).toBe(0);
  });

  it('never travels further than the radius', () => {
    for (let s = 0; s < 600; s += 3) {
      const { x, y } = burnInOffset(s);
      expect(Math.abs(x)).toBeLessThanOrEqual(BURN_IN_RADIUS_PX + 0.01);
      expect(Math.abs(y)).toBeLessThanOrEqual(BURN_IN_RADIUS_PX + 0.01);
    }
  });

  it('actually moves — a static "drift" defeats nothing', () => {
    expect(burnInOffset(52).x).not.toBe(burnInOffset(0).x);
  });

  it('survives a non-finite clock', () => {
    expect(burnInOffset(Number.NaN)).toEqual({ x: 0, y: 0 });
  });
});
