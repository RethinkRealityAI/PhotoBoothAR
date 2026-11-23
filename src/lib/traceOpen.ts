/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * traceOpen — "trace the shape to open" for the window-shaped (iris) designs.
 *
 * The closed gate shows its carved rim (moon gate circle, arch window, heart).
 * Instead of a tap, the recipient runs a finger round that rim; once most of
 * it is traced, the opening plays. Everything here is pure and in the
 * 900x1600 stage space the opener draws in, so the component only converts
 * the pointer into stage coordinates and asks these functions what happened.
 *
 * Progress is COVERAGE, not order: the rim is cut into equal-length bins and
 * a bin lights when the finger passes close to it. Either direction works,
 * starting anywhere works, and a slip off the line costs nothing. A fast
 * finger skips bins between two pointer events, so a short jump between two
 * on-line points fills the bins in between (but never a long cross-shape
 * chord, or scribbling across the middle would open it).
 */
import { type IrisShape } from './cardDesigns';

export interface StagePoint {
  x: number;
  y: number;
}

/** The rim radius the closed gate shows (SceneOpener draws its rim here). */
export const TRACE_RIM_R = 0.16;
/** Equal-length pieces of the rim. */
export const TRACE_BINS = 48;
/** How close (stage units, 900 wide) the finger must pass to light a bin. */
export const TRACE_TOLERANCE = 78;
/** Share of the rim that opens the gate — forgiving, a finger is not a pen. */
export const TRACE_COMPLETE = 0.86;
/** Largest bin jump between two pointer events that still fills the gap. */
const MAX_GAP_BINS = 5;

const CX = 450;
const CY = 760;
const DIAG = Math.hypot(900, 1600);

/** Dense, ordered points round the shape (same geometry as irisPath). */
function densePoints(shape: IrisShape, r: number, n = 720): StagePoint[] {
  const R = Math.max(0, r) * DIAG;
  const pts: StagePoint[] = [];
  if (shape === 'heart') {
    const open = Math.max(0, Math.min(1, (Math.max(0, r) - 0.16) / 0.46));
    const k = R * (0.05 + 0.03 * open);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({
        x: CX + 16 * Math.sin(a) ** 3 * k,
        y: CY - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * k,
      });
    }
    return pts;
  }
  if (shape === 'arch') {
    const hw = R * 0.66;
    const h = R * 2.05;
    const top = CY - h / 2 + hw;
    const bottom = CY + h / 2;
    // Corners in order: up the left side, over the arch, down the right, along the sill.
    const side = bottom - top;
    const arc = Math.PI * hw;
    const sill = 2 * hw;
    const total = 2 * side + arc + sill;
    for (let i = 0; i < n; i++) {
      let s = (i / n) * total;
      if (s < side) {
        pts.push({ x: CX - hw, y: bottom - s });
        continue;
      }
      s -= side;
      if (s < arc) {
        const a = Math.PI - s / hw; // from the left (pi) over the top to the right (0)
        pts.push({ x: CX + hw * Math.cos(a), y: top - hw * Math.sin(a) });
        continue;
      }
      s -= arc;
      if (s < side) {
        pts.push({ x: CX + hw, y: top + s });
        continue;
      }
      s -= side;
      pts.push({ x: CX + hw - s, y: bottom });
    }
    return pts;
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) });
  }
  return pts;
}

/**
 * `bins` points spaced evenly by ARC LENGTH round the rim (the heart's
 * parameter bunches up at the tip, so equal parameter steps would make some
 * bins far longer than others). Bin i is the stretch from point i to i+1.
 */
export function rimOutline(shape: IrisShape, r = TRACE_RIM_R, bins = TRACE_BINS): StagePoint[] {
  const dense = densePoints(shape, r);
  if (dense.length === 0 || bins < 3) return [];
  const cum: number[] = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];
  const out: StagePoint[] = [];
  let j = 0;
  for (let k = 0; k < bins; k++) {
    const target = (k / bins) * total;
    while (j < dense.length - 1 && cum[j + 1] < target) j++;
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    const seg = cum[j + 1] - cum[j];
    const t = seg > 0 ? (target - cum[j]) / seg : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

export interface TraceState {
  /** One flag per bin: has the finger passed along it. */
  covered: readonly boolean[];
  /** The bin the finger was last on (null after a lift or when off the line). */
  last: number | null;
}

export function newTrace(bins = TRACE_BINS): TraceState {
  return { covered: Array.from({ length: bins }, () => false), last: null };
}

/** Distance from p to the segment a-b. */
function segDist(p: StagePoint, a: StagePoint, b: StagePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** The bin nearest p, if p is within `tolerance` of the rim. */
export function nearestBin(outline: readonly StagePoint[], p: StagePoint, tolerance = TRACE_TOLERANCE): number | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  let best: number | null = null;
  let bestD = tolerance;
  for (let i = 0; i < outline.length; i++) {
    const d = segDist(p, outline[i], outline[(i + 1) % outline.length]);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Feed one pointer position; returns the next state (the input is not mutated). */
export function traceStep(
  state: TraceState,
  outline: readonly StagePoint[],
  p: StagePoint,
  tolerance = TRACE_TOLERANCE,
): TraceState {
  const n = outline.length;
  if (n === 0 || state.covered.length !== n) return state;
  const bin = nearestBin(outline, p, tolerance);
  if (bin === null) return state.last === null ? state : { covered: state.covered, last: null };
  const covered = state.covered.slice();
  covered[bin] = true;
  if (state.last !== null && state.last !== bin) {
    // Walk the shorter way round from the last bin, if it is a short hop.
    const fwd = (bin - state.last + n) % n;
    const back = (state.last - bin + n) % n;
    const steps = Math.min(fwd, back);
    if (steps <= MAX_GAP_BINS) {
      const dir = fwd <= back ? 1 : -1;
      for (let s = 1; s < steps; s++) covered[(state.last + dir * s + n) % n] = true;
    }
  }
  return { covered, last: bin };
}

/** The finger lifted: keep what was traced, forget where it was. */
export function traceLift(state: TraceState): TraceState {
  return state.last === null ? state : { covered: state.covered, last: null };
}

export function traceProgress(state: TraceState): number {
  const n = state.covered.length;
  if (n === 0) return 0;
  let c = 0;
  for (const v of state.covered) if (v) c++;
  return c / n;
}

export function traceComplete(state: TraceState, threshold = TRACE_COMPLETE): boolean {
  return traceProgress(state) >= threshold;
}

/** SVG path of the traced stretches only (one subpath per run of lit bins). */
export function tracedPath(outline: readonly StagePoint[], state: TraceState): string {
  const n = outline.length;
  if (n === 0 || state.covered.length !== n) return '';
  const fmt = (q: StagePoint) => `${Math.round(q.x * 10) / 10} ${Math.round(q.y * 10) / 10}`;
  if (state.covered.every(Boolean)) {
    return `M${outline.map(fmt).join(' L')} Z`;
  }
  // Start just after an unlit bin so a run that wraps past bin 0 stays whole.
  const start = state.covered.findIndex((v) => !v);
  let d = '';
  let open = false;
  for (let s = 1; s <= n; s++) {
    const i = (start + s) % n;
    if (state.covered[i]) {
      if (!open) {
        d += `M${fmt(outline[i])} `;
        open = true;
      }
      d += `L${fmt(outline[(i + 1) % n])} `;
    } else {
      open = false;
    }
  }
  return d.trim();
}

/** What the hint calls the shape. */
export function traceHint(shape: IrisShape): string {
  if (shape === 'heart') return 'Trace the heart to open';
  if (shape === 'arch') return 'Trace the arch to open';
  return 'Trace the circle to open';
}
