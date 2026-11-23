/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * revealUnlock — the maths behind each way of opening a Beamy reveal. Pure:
 * the page turns pointer events into numbers and asks these functions how far
 * along the reader is and whether it has opened. Every unlock also has a
 * one-press "Just show me" fallback on the page (keyboard, switch access, a
 * hurry), so none of these is ever the only way in.
 *
 *   blast  one tap (no maths: the page plays Beamy's blast clip)
 *   melt   hold: charge fills while pressed, drains slowly when let go
 *   shine  hold: same charge, a little longer
 *   tap    count taps to N
 *   turn   accumulate the angle a finger sweeps round a centre (a vault dial)
 *   trace  coverage of Beamy's triangle outline (traceOpen's bins, reused)
 *   rub    coverage of a scratch grid swept by a round brush
 */
import { newTrace, traceProgress, traceStep, type StagePoint, type TraceState } from '../traceOpen';
import type { RevealUnlock } from './revealModel';

export type { StagePoint, TraceState };

/* ------------------------------------------------------------------ */
/* hold (melt, shine)                                                  */
/* ------------------------------------------------------------------ */

/** Full-charge hold time per unlock (ms). */
export const HOLD_FULL_MS: Record<'melt' | 'shine', number> = { melt: 1800, shine: 1400 };
/** Letting go drains the charge this many times slower than it filled. */
export const HOLD_DRAIN_SLOWER = 2.5;

/** Charge after `dtMs` more of holding (pressed) or resting (released). */
export function holdCharge(charge: number, dtMs: number, pressed: boolean, fullMs: number): number {
  const c = Number.isFinite(charge) ? Math.min(1, Math.max(0, charge)) : 0;
  const dt = Number.isFinite(dtMs) ? Math.max(0, Math.min(250, dtMs)) : 0; // a stalled frame never jumps
  const rate = 1 / Math.max(1, fullMs);
  return pressed ? Math.min(1, c + dt * rate) : Math.max(0, c - (dt * rate) / HOLD_DRAIN_SLOWER);
}

/* ------------------------------------------------------------------ */
/* tap                                                                 */
/* ------------------------------------------------------------------ */

export function tapProgress(taps: number, need: number): number {
  if (!(need > 0)) return 1;
  return Math.min(1, Math.max(0, taps) / need);
}

/* ------------------------------------------------------------------ */
/* turn                                                                */
/* ------------------------------------------------------------------ */

/** One and a quarter turns opens it (either direction; a back-and-forth cancels out). */
export const TURN_FULL_RAD = Math.PI * 2 * 1.25;
/** Points nearer the centre than this (fraction of the ring radius) are ignored: the angle is noise there. */
export const TURN_DEAD_ZONE = 0.35;
/** A single step bigger than this (rad) is a jump, not a turn (a second finger, a lift and re-press). */
const TURN_MAX_STEP = 1.1;

export interface TurnState {
  /** Signed radians swept so far. */
  total: number;
  /** Angle of the last accepted point (null after a lift). */
  last: number | null;
}

export function newTurn(): TurnState {
  return { total: 0, last: null };
}

/** Wrap a difference of angles into (-π, π]. */
export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x <= -Math.PI) x += Math.PI * 2;
  if (x > Math.PI) x -= Math.PI * 2;
  return x;
}

export function turnStep(state: TurnState, p: StagePoint, center: StagePoint, ringRadius: number): TurnState {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return state;
  if (Math.hypot(dx, dy) < ringRadius * TURN_DEAD_ZONE) return { total: state.total, last: null };
  const a = Math.atan2(dy, dx);
  if (state.last === null) return { total: state.total, last: a };
  const d = wrapAngle(a - state.last);
  if (Math.abs(d) > TURN_MAX_STEP) return { total: state.total, last: a };
  return { total: state.total + d, last: a };
}

export function turnLift(state: TurnState): TurnState {
  return state.last === null ? state : { total: state.total, last: null };
}

export function turnProgress(state: TurnState): number {
  return Math.min(1, Math.abs(state.total) / TURN_FULL_RAD);
}

/* ------------------------------------------------------------------ */
/* trace: Beamy's outline                                              */
/* ------------------------------------------------------------------ */

export const TRACE_BINS = 42;
/** Share of the outline that opens it. */
export const TRACE_DONE = 0.85;

/**
 * Beamy is a rounded crystal triangle, apex up. The outline the reader traces
 * is that triangle around him: `cx, cy` is its centroid, `size` its height
 * (px). Bins are equal-length so every edge counts the same.
 */
export function beamyOutline(cx: number, cy: number, size: number, bins = TRACE_BINS): StagePoint[] {
  const h = Math.max(1, size);
  const half = h / Math.sqrt(3); // equilateral: side = 2h/√3
  const corners: StagePoint[] = [
    { x: cx, y: cy - (2 / 3) * h },
    { x: cx + half, y: cy + h / 3 },
    { x: cx - half, y: cy + h / 3 },
  ];
  const side = 2 * half;
  const total = side * 3;
  const out: StagePoint[] = [];
  for (let k = 0; k < bins; k++) {
    const s = (k / bins) * total;
    const edge = Math.min(2, Math.floor(s / side));
    const t = (s - edge * side) / side;
    const a = corners[edge];
    const b = corners[(edge + 1) % 3];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

export function newBeamyTrace(bins = TRACE_BINS): TraceState {
  return newTrace(bins);
}

/** Tolerance scales with the outline so a phone and a desktop feel the same. */
export function beamyTraceStep(state: TraceState, outline: readonly StagePoint[], p: StagePoint, size: number): TraceState {
  return traceStep(state, outline, p, Math.max(18, size * 0.16));
}

export function beamyTraceProgress(state: TraceState): number {
  return Math.min(1, traceProgress(state) / TRACE_DONE);
}

/* ------------------------------------------------------------------ */
/* rub: a scratch card                                                 */
/* ------------------------------------------------------------------ */

export const RUB_COLS = 24;
export const RUB_ROWS = 16;
/** Share of the card that must be cleared before the rest falls away. */
export const RUB_DONE = 0.55;

export interface RubGrid {
  cols: number;
  rows: number;
  cleared: readonly boolean[];
}

export function newRub(cols = RUB_COLS, rows = RUB_ROWS): RubGrid {
  return { cols, rows, cleared: Array.from({ length: cols * rows }, () => false) };
}

/**
 * Sweep a round brush (radius `r`, card px) from `a` to `b` over a `w`×`h`
 * card: every cell whose centre the brush passes over is cleared. Returns the
 * input itself when nothing changed (cheap equality for React state).
 */
export function rubStroke(grid: RubGrid, a: StagePoint, b: StagePoint, r: number, w: number, h: number): RubGrid {
  if (!(w > 0 && h > 0 && r > 0)) return grid;
  const pts = [a, b];
  if (pts.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) return grid;
  const cw = w / grid.cols;
  const ch = h / grid.rows;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let next: boolean[] | null = null;
  const minC = Math.max(0, Math.floor((Math.min(a.x, b.x) - r) / cw));
  const maxC = Math.min(grid.cols - 1, Math.floor((Math.max(a.x, b.x) + r) / cw));
  const minR = Math.max(0, Math.floor((Math.min(a.y, b.y) - r) / ch));
  const maxR = Math.min(grid.rows - 1, Math.floor((Math.max(a.y, b.y) + r) / ch));
  for (let row = minR; row <= maxR; row++) {
    for (let col = minC; col <= maxC; col++) {
      const i = row * grid.cols + col;
      if (grid.cleared[i]) continue;
      const px = (col + 0.5) * cw;
      const py = (row + 0.5) * ch;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
      if (Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t)) <= r) {
        if (next === null) next = grid.cleared.slice();
        next[i] = true;
      }
    }
  }
  return next === null ? grid : { cols: grid.cols, rows: grid.rows, cleared: next };
}

export function rubCoverage(grid: RubGrid): number {
  if (grid.cleared.length === 0) return 1;
  let c = 0;
  for (const v of grid.cleared) if (v) c++;
  return c / grid.cleared.length;
}

export function rubProgress(grid: RubGrid): number {
  return Math.min(1, rubCoverage(grid) / RUB_DONE);
}

/* ------------------------------------------------------------------ */
/* shared                                                              */
/* ------------------------------------------------------------------ */

/** Past this progress Beamy says his `cheer` line (once). */
export const CHEER_AT = 0.4;

/** Whether an unlock is a press-and-hold (the page shows a charge ring). */
export function isHoldUnlock(u: RevealUnlock): u is 'melt' | 'shine' {
  return u === 'melt' || u === 'shine';
}
