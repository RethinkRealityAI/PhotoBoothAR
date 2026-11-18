import { describe, expect, it } from 'vitest';
import {
  FOCUS, GLIDE_AFTER, GLIDE_BEFORE, GUTTER_SCALE, REVEAL_FALLBACK_MS, STOPS, directBeamy, facingYaw, followStep, mustRevealNow,
  pageProgress, settledAt, stopIndex, type DirectorInput, type StopAnchor,
} from './beamyScroll';

const VP = 900;
const band = { top: 150, bottom: VP - 20 };

/** A desktop-ish page: sections 1000px tall, Beamy's feet 600px into each. */
function page(n: number, sides = STOPS.map((s) => s.side)): StopAnchor[] {
  return Array.from({ length: n }, (_, i) => {
    const side = sides[i % sides.length];
    const x = side === 'left' ? 300 : side === 'right' ? 1100 : 700;
    return { top: i * 1000, bottom: (i + 1) * 1000, feet: { x, y: i * 1000 + 600 }, heightPx: 260, side, docked: false };
  });
}
const input = (stops: StopAnchor[], scrollY: number, over: Partial<DirectorInput> = {}): DirectorInput => ({
  stops, scrollY, vpH: VP, dockY: band.bottom, band, ...over,
});

describe('stops', () => {
  it('alternate sides and never repeat a presenting action back to back', () => {
    expect(STOPS[0]).toMatchObject({ id: 'hero', side: 'centre', presenting: 'intro' });
    for (let i = 1; i < STOPS.length; i++) {
      expect(STOPS[i].presenting, STOPS[i].id).not.toBe(STOPS[i - 1].presenting);
      if (STOPS[i].side !== 'centre' && STOPS[i - 1].side !== 'centre') expect(STOPS[i].side, STOPS[i].id).not.toBe(STOPS[i - 1].side);
    }
    expect(new Set(STOPS.map((s) => s.id)).size).toBe(STOPS.length);
    expect(stopIndex('try')).toBeGreaterThan(stopIndex('pick'));
    expect(STOPS[STOPS.length - 1].id).toBe('start');
  });
  it('faces the content side', () => {
    expect(facingYaw('left')).toBeGreaterThan(0);
    expect(facingYaw('right')).toBeLessThan(0);
    expect(facingYaw('centre')).toBe(0);
  });
});

describe('directBeamy', () => {
  const stops = page(4);
  it('rides with the anchor while settled', () => {
    // Focus line well inside section 0, before the first glide window.
    const a = directBeamy(input(stops, 0));
    const b = directBeamy(input(stops, 40));
    expect(a.active).toBe(0);
    expect(a.travelling).toBe(false);
    expect(a.x).toBe(stops[0].feet.x);
    expect(a.y - b.y).toBeCloseTo(40, 5);
  });
  it('stays inside the band when the anchor leaves the screen', () => {
    for (let s = 0; s < 4000; s += 37) {
      const t = directBeamy(input(stops, s));
      expect(t.y - t.heightPx).toBeGreaterThanOrEqual(band.top - 1e-6);
      expect(t.y).toBeLessThanOrEqual(band.bottom + 1e-6);
    }
  });
  it('glides across the boundary window and lands on the next anchor', () => {
    const edge = stops[1].top;
    const start = edge - VP * GLIDE_BEFORE - VP * FOCUS;
    const end = edge + VP * GLIDE_AFTER - VP * FOCUS;
    const before = directBeamy(input(stops, start - 1));
    const mid = directBeamy(input(stops, (start + end) / 2));
    const after = directBeamy(input(stops, end + 1));
    expect(before.active).toBe(0);
    expect(before.travelling).toBe(false);
    expect(mid.travelling).toBe(true);
    expect(mid.heading).toBe(Math.sign(stops[1].feet.x - stops[0].feet.x));
    expect(Math.abs(mid.yaw)).toBeGreaterThan(Math.abs(facingYaw(stops[1].side)));
    expect(after.active).toBe(1);
    expect(after.x).toBe(stops[1].feet.x);
    expect(after.yaw).toBe(facingYaw(stops[1].side));
  });
  it('crosses the page in the gutter between sections, smaller, never over either section', () => {
    const edge = stops[1].top;
    const start = edge - VP * GLIDE_BEFORE - VP * FOCUS;
    const end = edge + VP * GLIDE_AFTER - VP * FOCUS;
    const scroll = (start + end) / 2;
    const mid = directBeamy(input(stops, scroll));
    const boundary = edge - scroll;
    expect(mid.heightPx).toBeCloseTo(((stops[0].heightPx + stops[1].heightPx) / 2) * GUTTER_SCALE, 5);
    // His middle sits on the boundary: he spans the gap, not the copy either side.
    expect(mid.y - mid.heightPx / 2).toBeCloseTo(boundary, 5);
    // While he is still well across, he is already down in the gap.
    for (const k of [0.4, 0.6]) {
      const t = directBeamy(input(stops, start + (end - start) * k));
      expect(Math.abs(t.y - t.heightPx / 2 - (edge - (start + (end - start) * k))), `k ${k}`).toBeLessThan(t.heightPx * 0.25);
    }
  });
  it('moves continuously (no jumps) for a fine scroll sweep', () => {
    let prev = directBeamy(input(stops, 0));
    for (let s = 1; s < 3200; s += 1) {
      const t = directBeamy(input(stops, s));
      expect(Math.hypot(t.x - prev.x, t.y - prev.y), `scroll ${s}`).toBeLessThan(12);
      prev = t;
    }
  });
  it('reports progress through the active section', () => {
    const t = directBeamy(input(stops, 2000 + 500 - VP * FOCUS));
    expect(t.active).toBe(2);
    expect(t.progress).toBeCloseTo(0.5, 2);
  });
  it('waits mid-screen with no stops measured yet', () => {
    expect(directBeamy(input([], 0)).presence).toBe(1);
  });
});

describe('phone dock', () => {
  const stops = page(3).map((s, i) => ({ ...s, docked: i > 0, heightPx: i > 0 ? 130 : 200 }));
  it('stands docked stops on the dock line', () => {
    const t = directBeamy(input(stops, 2600));
    expect(t.active).toBe(2);
    expect(t.y).toBe(band.bottom);
  });
  it('dissolves between the in-flow hero and the dock, and is whole at both ends', () => {
    const edge = stops[1].top;
    const start = edge - VP * GLIDE_BEFORE - VP * FOCUS;
    const end = edge + VP * GLIDE_AFTER - VP * FOCUS;
    expect(directBeamy(input(stops, start)).presence).toBe(1);
    expect(directBeamy(input(stops, (start + end) / 2)).presence).toBe(0);
    expect(directBeamy(input(stops, end)).presence).toBe(1);
  });
  it('slides along the dock between docked stops without dissolving', () => {
    const edge = stops[2].top;
    const mid = edge - VP * FOCUS + (VP * (GLIDE_AFTER - GLIDE_BEFORE)) / 2;
    expect(directBeamy(input(stops, mid)).presence).toBe(1);
  });
});

describe('settledAt', () => {
  it('maps document feet to the viewport', () => {
    const s: StopAnchor = { top: 0, bottom: 1000, feet: { x: 10, y: 700 }, heightPx: 100, side: 'left', docked: false };
    expect(settledAt(s, { scrollY: 100, dockY: 880, band: { top: 0, bottom: 900 } })).toEqual({ x: 10, y: 600 });
  });
});

describe('followStep', () => {
  it('approaches the target and never exceeds the speed cap', () => {
    let p = { x: 0, y: 0 };
    const target = { x: 2000, y: 0 };
    for (let i = 0; i < 30; i++) {
      const n = followStep(p, target, 1 / 60, 900);
      expect(Math.hypot(n.x - p.x, n.y - p.y)).toBeLessThanOrEqual(900 / 60 + 1e-9);
      expect(n.x).toBeGreaterThan(p.x);
      p = n;
    }
    let q = { x: 0, y: 0 };
    for (let i = 0; i < 600; i++) q = followStep(q, { x: 50, y: 20 }, 1 / 60, 900);
    expect(q.x).toBeCloseTo(50, 3);
    expect(q.y).toBeCloseTo(20, 3);
  });
});

describe('reveals and progress', () => {
  it('never strands content', () => {
    expect(mustRevealNow({ active: true, progress: 0.1, sinceEnterMs: 100, modelReady: true })).toBe(false);
    expect(mustRevealNow({ active: false, progress: 0.1, sinceEnterMs: 100, modelReady: true })).toBe(true);
    expect(mustRevealNow({ active: true, progress: 0.8, sinceEnterMs: 100, modelReady: true })).toBe(true);
    expect(mustRevealNow({ active: true, progress: 0.1, sinceEnterMs: REVEAL_FALLBACK_MS + 1, modelReady: true })).toBe(true);
    expect(mustRevealNow({ active: true, progress: 0, sinceEnterMs: 0, modelReady: false })).toBe(true);
  });
  it('clamps page progress', () => {
    expect(pageProgress(-10, 5000, 900)).toBe(0);
    expect(pageProgress(4100, 5000, 900)).toBe(1);
    expect(pageProgress(2050, 5000, 900)).toBeCloseTo(0.5, 5);
  });
});
