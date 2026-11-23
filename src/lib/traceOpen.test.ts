import { describe, expect, it } from 'vitest';
import {
  nearestBin,
  newTrace,
  rimOutline,
  traceComplete,
  tracedPath,
  traceHint,
  traceLift,
  traceProgress,
  traceStep,
  TRACE_BINS,
  TRACE_COMPLETE,
  type StagePoint,
  type TraceState,
} from './traceOpen';
import type { IrisShape } from './cardDesigns';

const SHAPES: IrisShape[] = ['circle', 'arch', 'heart'];

/** Run a finger along the given outline points. */
function drag(state: TraceState, outline: StagePoint[], pts: StagePoint[]): TraceState {
  let s = state;
  for (const p of pts) s = traceStep(s, outline, p);
  return traceLift(s);
}

/** A finger path round the rim from bin a to bin b (inclusive), sampled every `every` bins, nudged off the line. */
function along(outline: StagePoint[], a: number, b: number, every = 1, nudge = 20): StagePoint[] {
  const out: StagePoint[] = [];
  for (let i = a; i <= b; i += every) {
    const q = outline[i % outline.length];
    out.push({ x: q.x + nudge, y: q.y - nudge / 2 });
  }
  return out;
}

describe('rimOutline', () => {
  for (const shape of SHAPES) {
    it(`${shape}: evenly spaced points, all on the stage`, () => {
      const o = rimOutline(shape);
      expect(o).toHaveLength(TRACE_BINS);
      const lens = o.map((p, i) => Math.hypot(o[(i + 1) % o.length].x - p.x, o[(i + 1) % o.length].y - p.y));
      const mean = lens.reduce((x, y) => x + y, 0) / lens.length;
      for (const l of lens) {
        // Chords of equal ARC length: only corners (arch) shorten them a little.
        expect(l).toBeGreaterThan(mean * 0.6);
        expect(l).toBeLessThan(mean * 1.25);
      }
      for (const p of o) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(900);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(1600);
      }
    });
  }

  it('is empty for a zero radius', () => {
    expect(rimOutline('circle', 0)).toEqual([]);
  });
});

describe('tracing', () => {
  for (const shape of SHAPES) {
    const o = rimOutline(shape);

    it(`${shape}: a full lap opens it, in either direction, from anywhere`, () => {
      const cw = drag(newTrace(), o, along(o, 7, 7 + TRACE_BINS));
      expect(traceComplete(cw)).toBe(true);
      const ccw = drag(newTrace(), o, along(o, 20, 20 + TRACE_BINS).reverse());
      expect(traceComplete(ccw)).toBe(true);
    });

    it(`${shape}: half a lap does not`, () => {
      const half = drag(newTrace(), o, along(o, 0, TRACE_BINS / 2));
      expect(traceProgress(half)).toBeGreaterThan(0.4);
      expect(traceComplete(half)).toBe(false);
    });

    it(`${shape}: a fast finger that skips a few bins between events still counts them`, () => {
      const fast = drag(newTrace(), o, along(o, 0, TRACE_BINS, 4));
      expect(traceComplete(fast)).toBe(true);
    });

    it(`${shape}: lifting and carrying on keeps what was traced`, () => {
      let s = drag(newTrace(), o, along(o, 0, 26));
      expect(traceComplete(s)).toBe(false);
      s = drag(s, o, along(o, 27, TRACE_BINS));
      expect(traceComplete(s)).toBe(true);
    });
  }

  // The rim sits 294 stage units out; 140 on each axis keeps the scribble (max 198) clear of the tolerance band.
  it('scribbling across the middle never opens it', () => {
    const o = rimOutline('circle');
    const pts: StagePoint[] = [];
    for (let k = 0; k < 400; k++) pts.push({ x: 450 + Math.sin(k * 0.7) * 140, y: 760 + Math.cos(k * 1.3) * 140 });
    expect(traceProgress(drag(newTrace(), o, pts))).toBe(0);
  });

  it('jumping straight across the shape does not fill the far side', () => {
    const o = rimOutline('circle');
    // Touch bin 0, then the opposite bin: the gap is far too long to fill.
    const s = drag(newTrace(), o, [o[0], o[TRACE_BINS / 2]]);
    expect(traceProgress(s)).toBeCloseTo(2 / TRACE_BINS, 5);
  });

  it('ignores points off the rim and non-finite input, without mutating state', () => {
    const o = rimOutline('heart');
    const s0 = newTrace();
    const s1 = traceStep(s0, o, { x: 5, y: 5 });
    expect(s1).toBe(s0);
    const s2 = traceStep(s0, o, { x: NaN, y: 100 });
    expect(s2).toBe(s0);
    const s3 = traceStep(s0, o, o[3]);
    expect(s0.covered.some(Boolean)).toBe(false);
    expect(s3.covered[3] || s3.covered[2]).toBe(true);
  });

  it('nearestBin respects the tolerance', () => {
    const o = rimOutline('circle');
    expect(nearestBin(o, { x: o[0].x + 50, y: o[0].y })).not.toBeNull();
    expect(nearestBin(o, { x: o[0].x + 200, y: o[0].y })).toBeNull();
  });

  it('a mismatched state is returned untouched', () => {
    const o = rimOutline('circle');
    const wrong = newTrace(10);
    expect(traceStep(wrong, o, o[0])).toBe(wrong);
  });

  it('the opening threshold is forgiving but not trivial', () => {
    expect(TRACE_COMPLETE).toBeGreaterThanOrEqual(0.75);
    expect(TRACE_COMPLETE).toBeLessThan(1);
  });
});

describe('tracedPath', () => {
  const o = rimOutline('circle');

  it('is empty before anything is traced', () => {
    expect(tracedPath(o, newTrace())).toBe('');
  });

  it('a run that wraps past bin 0 stays one stroke', () => {
    const s: TraceState = { covered: o.map((_, i) => i >= 44 || i <= 3), last: null };
    const d = tracedPath(o, s);
    expect(d.match(/M/g)).toHaveLength(1);
  });

  it('two separate runs are two strokes; a full lap is closed', () => {
    const two: TraceState = { covered: o.map((_, i) => (i >= 2 && i <= 6) || (i >= 20 && i <= 24)), last: null };
    expect(tracedPath(o, two).match(/M/g)).toHaveLength(2);
    const all: TraceState = { covered: o.map(() => true), last: null };
    expect(tracedPath(o, all).endsWith('Z')).toBe(true);
  });
});

describe('traceHint', () => {
  it('names the shape', () => {
    expect(traceHint('heart')).toMatch(/heart/);
    expect(traceHint('arch')).toMatch(/arch/);
    expect(traceHint('circle')).toMatch(/circle/);
  });
});
