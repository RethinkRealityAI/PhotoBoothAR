/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyFitAdjust — the math behind /admin/home-assets' "Adjust on Beamy"
 * mode: drag a prop on him, pinch or wheel to resize, twist or tap to
 * rotate, nudge in centimetres, undo. Pure, DOM-free, tested in node.
 *
 * Every operation returns a new PropFit (lib/beamyLooks): the SAME object
 * the sliders edit and the homepage renders, so there is one source of truth.
 * Each one clamps only what it changes, to the sliders' own ranges
 * (fitBounds), so the sliders and the adjust mode can never disagree about
 * where a prop may go.
 *
 * DRAG. A fit's anchor `at` lives in his `body` bone's space (metres, +y up,
 * +z toward the viewer at rest). The stage reports, every pointer move, how
 * many screen px one bone unit along each bone axis moves the anchor
 * (ScreenAxes, y down): that projection already carries his turn, his lean
 * and any scale, so dragging needs no knowledge of the camera. A drag then
 * moves the anchor along his up axis and along whichever sideways axis faces
 * the camera more (his left/right from the front, back/forward once he is
 * turned past 45 degrees), solved so the anchor follows the pointer exactly.
 */
import {
  ANCHOR_PRESETS, FIT_AT_MAX, FIT_PAIR_MAX, FIT_PAIR_MIN, FIT_ROLL_MAX, FIT_TILT_MAX, FIT_WIDTH_MAX, FIT_WIDTH_MIN,
  type AnchorId, type PropFit,
} from './homeAssets';

/** How far each slider reaches either side of the anchor preset (metres). */
export const FIT_REACH = 0.12;

export interface FitBounds {
  width: [number, number];
  at: [[number, number], [number, number], [number, number]];
  tilt: [number, number];
  roll: [number, number];
  pair: [number, number];
}

/** The ranges the sliders use for `anchor` (the adjust mode clamps to the same). */
export function fitBounds(anchor: AnchorId): FitBounds {
  const p = ANCHOR_PRESETS[anchor].fit;
  const axis = (i: 0 | 1 | 2): [number, number] => [Math.max(-FIT_AT_MAX, p.at[i] - FIT_REACH), Math.min(FIT_AT_MAX, p.at[i] + FIT_REACH)];
  return {
    width: [Math.max(FIT_WIDTH_MIN, p.width * 0.4), Math.min(FIT_WIDTH_MAX, p.width * 2.2)],
    at: [axis(0), axis(1), axis(2)],
    tilt: [-FIT_TILT_MAX * 0.75, FIT_TILT_MAX * 0.75],
    roll: [-FIT_ROLL_MAX, FIT_ROLL_MAX],
    pair: [Math.max(FIT_PAIR_MIN, 0.15), Math.min(FIT_PAIR_MAX, 0.7)],
  };
}

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
/** Six decimals: no float dust in the saved draft (0.1 μm is far below a pixel). */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

/** A copy of `fit` with `q` applied; a zero tilt or roll is dropped, as normalizeFit stores it. */
function withFit(fit: PropFit, q: Partial<PropFit>): PropFit {
  const n: PropFit = { ...fit, ...q, at: [...(q.at ?? fit.at)] as [number, number, number] };
  if (n.tilt === 0) delete n.tilt;
  if (n.roll === 0) delete n.roll;
  return n;
}

/* ── Drag ───────────────────────────────────────────────────────────── */

export interface Vec2 { x: number; y: number }
/** Screen px (x right, y DOWN) that one bone unit along each of his bone's axes moves the anchor. */
export interface ScreenAxes { x: Vec2; y: Vec2; z: Vec2 }

/**
 * The screen axes for an un-leaned bone under a rig turned `yaw` radians
 * about +y, drawn `pxPerUnit` px per bone unit by a camera looking down -z
 * (the homepage's orthographic stage). The stage measures the real ones;
 * this is the model the tests check them against.
 */
export function axesForYaw(yaw: number, pxPerUnit: number): ScreenAxes {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // World = Ry(yaw)·bone; screen = (world.x, -world.y).
  return { x: { x: pxPerUnit * c, y: 0 }, y: { x: 0, y: -pxPerUnit }, z: { x: pxPerUnit * s, y: 0 } };
}

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;

/** Which bone axis a sideways drag moves: 0 = left/right, 2 = back/forward (whichever faces the camera more). */
export function lateralAxis(a: ScreenAxes): 0 | 2 {
  return Math.abs(cross(a.z, a.y)) > Math.abs(cross(a.x, a.y)) ? 2 : 0;
}

/**
 * The bone-space move that carries the anchor `dx, dy` screen px: `d[0]`
 * along the lateral axis, `d[1]` along his up axis. Null when the view is
 * degenerate (his up axis points at the camera, or the stage is not drawn).
 */
export function solveDrag(a: ScreenAxes, dx: number, dy: number): { axis: 0 | 2; d: [number, number] } | null {
  const axis = lateralAxis(a);
  const L = axis === 0 ? a.x : a.z;
  const det = cross(L, a.y);
  if (!(Math.abs(det) > 1e-9)) return null;
  // [L a.y]·[u v]ᵀ = [dx dy]ᵀ (Cramer).
  return { axis, d: [(dx * a.y.y - dy * a.y.x) / det, (L.x * dy - L.y * dx) / det] };
}

/** `start` moved by a drag of `dx, dy` px (from where the drag began), clamped to the sliders' range. */
export function dragFit(start: PropFit, a: ScreenAxes, dx: number, dy: number, anchor: AnchorId): PropFit {
  const s = solveDrag(a, dx, dy);
  if (s === null) return start;
  const b = fitBounds(anchor).at;
  const at: [number, number, number] = [start.at[0], start.at[1], start.at[2]];
  at[s.axis] = tidy(clamp(at[s.axis] + s.d[0], b[s.axis]));
  at[1] = tidy(clamp(at[1] + s.d[1], b[1]));
  return withFit(start, { at });
}

/* ── Nudge, size, rotation, spacing ─────────────────────────────────── */

export type NudgeDir = 'left' | 'right' | 'up' | 'down' | 'back' | 'forward';
/** Nudge steps (metres): fine = the sliders' step, coarse = 1 cm. */
export const NUDGE_FINE = 0.002;
export const NUDGE_COARSE = 0.01;

const NUDGE: Record<NudgeDir, [0 | 1 | 2, 1 | -1]> = {
  left: [0, -1], right: [0, 1], down: [1, -1], up: [1, 1], back: [2, -1], forward: [2, 1],
};

/** One nudge along his own axes: left/right (x), up/down (y), back/forward (z, + toward the viewer). */
export function nudgeFit(fit: PropFit, dir: NudgeDir, step: number, anchor: AnchorId): PropFit {
  const [i, sign] = NUDGE[dir];
  const at: [number, number, number] = [fit.at[0], fit.at[1], fit.at[2]];
  at[i] = tidy(clamp(at[i] + sign * step, fitBounds(anchor).at[i]));
  return withFit(fit, { at });
}

/** Size steps: a multiplier per tap. */
export const SIZE_FINE = 1.02;
export const SIZE_COARSE = 1.1;

/** `fit` `factor` times as wide (about its anchor), clamped to the size slider's range. */
export function resizeFit(fit: PropFit, factor: number, anchor: AnchorId): PropFit {
  if (!(factor > 0) || !Number.isFinite(factor)) return fit;
  return withFit(fit, { width: tidy(clamp(fit.width * factor, fitBounds(anchor).width)) });
}

/** The size slider's readout: percent of the anchor preset's width. */
export function sizePercent(fit: PropFit, anchor: AnchorId): number {
  return Math.round((fit.width / ANCHOR_PRESETS[anchor].fit.width) * 100);
}

/** A mouse wheel notch as a size factor (up = bigger), damped and bounded per event. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  if (!Number.isFinite(px)) return 1;
  return Math.min(1.25, Math.max(0.8, Math.exp(-px * 0.0015)));
}

/** Two pointers that were `d0` apart and are now `d1`: the size factor (1 when either is too small). */
export function pinchFactor(d0: number, d1: number): number {
  if (!(d0 > 8) || !(d1 > 0)) return 1;
  return d1 / d0;
}

/** Rotation steps (radians): 1 degree fine, 5 coarse. */
export const ROT_FINE = Math.PI / 180;
export const ROT_COARSE = (5 * Math.PI) / 180;

/** `fit` tilted forward (tilt) or turned in his face's plane (roll) by `delta` radians, clamped. */
export function rotateFit(fit: PropFit, which: 'tilt' | 'roll', delta: number, anchor: AnchorId): PropFit {
  const b = fitBounds(anchor)[which];
  return withFit(fit, { [which]: tidy(clamp((fit[which] ?? 0) + delta, b)) });
}

/**
 * Two pointers' angle change as a roll delta. Screen y points down, so a
 * clockwise twist is a growing angle; roll is counterclockwise-positive as
 * you look at him (about +z, toward the viewer): the sign flips.
 */
export function twistRoll(a0: Vec2, b0: Vec2, a1: Vec2, b1: Vec2): number {
  const t0 = Math.atan2(b0.y - a0.y, b0.x - a0.x);
  const t1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
  let d = t1 - t0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return -d;
}

/** An earring pair's spacing changed by `delta` metres (a no-op for anything else). */
export function spaceFit(fit: PropFit, delta: number, anchor: AnchorId): PropFit {
  if (fit.pair === undefined) return fit;
  return withFit(fit, { pair: tidy(clamp(fit.pair + delta, fitBounds(anchor).pair)) });
}

/* ── Undo ───────────────────────────────────────────────────────────── */

export function fitsEqual(a: PropFit, b: PropFit): boolean {
  return a.width === b.width && a.align === b.align && a.at[0] === b.at[0] && a.at[1] === b.at[1] && a.at[2] === b.at[2]
    && (a.tilt ?? 0) === (b.tilt ?? 0) && (a.roll ?? 0) === (b.roll ?? 0) && a.pair === b.pair;
}

export const UNDO_MAX = 60;

/** The undo stack after leaving `fit` (unchanged when it equals the top; the oldest drop past UNDO_MAX). */
export function pushUndo(past: readonly PropFit[], fit: PropFit): PropFit[] {
  const top = past[past.length - 1];
  if (top !== undefined && fitsEqual(top, fit)) return past.slice();
  return [...past, fit].slice(-UNDO_MAX);
}

/** Signed centimetres from the preset along axis `i`, for a readout ("+1.4 cm"). */
export function offsetCm(fit: PropFit, anchor: AnchorId, i: 0 | 1 | 2): string {
  const v = (fit.at[i] - ANCHOR_PRESETS[anchor].fit.at[i]) * 100;
  const r = Math.abs(v) < 0.05 ? 0 : v;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)} cm`;
}

export const degrees = (rad: number | undefined) => Math.round(((rad ?? 0) * 180) / Math.PI);
