/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamGeometry — pure, node-testable geometry for the landing showcase's
 * "beam strike": the light column + flying photo that travel from the phone
 * screen to a live-wall tile when a guest beams a shot.
 *
 * Everything here is deliberately DOM-free (takes plain {left,top,width,height}
 * rects, returns plain numbers) so the choreography maths can be unit-tested in
 * vitest's node environment, with the React overlay in InteractiveShowcase.tsx
 * consuming the results. No Math.random — the polaroid tilt is deterministic so
 * a given wall shot always lands at the same angle across re-renders/StrictMode.
 */

/** A screen-space rectangle (already resolved into the scene root's frame). */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Geometric centre of a rect. */
export function centerOf(r: Rect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * The beam segment from `centerOf(from)` to `centerOf(to)`:
 *  • `x`, `y`     — the origin point (from-centre); anchor a left-origin,
 *                   horizontally-drawn div here.
 *  • `length`     — Euclidean distance to the to-centre (the div's width).
 *  • `angleDeg`   — rotation in degrees for that left-anchored horizontal div
 *                   so its far end reaches the to-centre (CSS `rotate()`).
 *
 * Zero-length guard: coincident centres yield length 0 and angle 0 (no NaN,
 * no arbitrary rotation), so the caller can cleanly skip drawing a beam.
 */
export function beamPath(
  from: Rect,
  to: Rect,
): { x: number; y: number; length: number; angleDeg: number } {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: a.x, y: a.y, length: 0, angleDeg: 0 };
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { x: a.x, y: a.y, length, angleDeg };
}

/**
 * Deterministic polaroid tilt in [-6, 6] degrees for the shot at `index` on the
 * wall. The magnitude walks a stable hash (the classic sine-fract pattern, so
 * it is pure and reproducible), while the sign alternates with the index's
 * parity — that guarantees `polaroidTilt(i) !== polaroidTilt(i + 1)` for every
 * adjacent pair (opposite signs, magnitude never below 1.5) so consecutive
 * polaroids always lean opposite ways and never share an angle.
 */
export function polaroidTilt(index: number): number {
  const hash = Math.abs(Math.sin(index * 12.9898 + 1) * 43758.5453);
  const frac = hash - Math.floor(hash); // [0, 1)
  const magnitude = 1.5 + frac * 4.5; // [1.5, 6)
  const sign = index % 2 === 0 ? 1 : -1;
  // Round to 2dp for stable, jitter-free CSS values.
  return Math.round(sign * magnitude * 100) / 100;
}
