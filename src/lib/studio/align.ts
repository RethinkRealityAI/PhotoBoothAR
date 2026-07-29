/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Precision-editing maths for the studio: alignment, edge/safe-area placement,
 * rotation snapping, peer-object snap lines and 3D keyboard nudging.
 *
 * Every 2D control in the studio was a slider stepping 0.5% (position) or 1°
 * (rotation) — a host could not type "rotate 90" or "x = 0", and snapping only
 * caught an object's own centre against three fixed lines. These helpers are the
 * pure half of the fix; bounds still come from controlSpecs.ts, which stays the
 * single source of limits (nothing here declares a new min/max for a control
 * that already has one).
 *
 * COORDINATE CONTRACT (booth Transform2D, see StageCanvas / StudioStage):
 *   x/y are percentages of the frame from its CENTRE, so 0,0 is centred.
 *   An overlay's rendered box is `sizePct` of the frame on each axis, scaled by
 *   transform.scale — 100% for a frame ('border'), 60% for a sticker
 *   ('2d_filter'). Its half-extent is therefore (sizePct * scale) / 2 percent,
 *   which is what turns "flush left" into a concrete x.
 */
import type { Transform2D } from '../../types';
import { OVERLAY_POSITION, OVERLAY_ROTATION, clampToSpec } from './controlSpecs';

/** Rendered box size, as a percent of the frame, per overlay sub-kind. */
export const OVERLAY_SIZE_PCT: Record<'border' | '2d_filter', number> = {
  border: 100,
  '2d_filter': 60,
};

/** Half the rendered extent of an overlay, in frame-percent. */
export function halfExtentPct(kind: 'border' | '2d_filter', scale: number): number {
  const size = OVERLAY_SIZE_PCT[kind] ?? 100;
  return (size * (Number.isFinite(scale) ? scale : 1)) / 2;
}

export type AlignAction =
  | 'centerH'
  | 'centerV'
  | 'center'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom';

/**
 * Safe-area inset (frame-percent) kept between an edge-aligned overlay and the
 * frame edge. Guest phones crop a little and the booth chrome sits in the
 * corners, so "flush" means "flush to the safe area", not to the pixel edge.
 */
export const SAFE_AREA_PCT = 4;

/**
 * Apply an alignment to a transform. Pure; never mutates. Results are clamped
 * through OVERLAY_POSITION so an alignment can never place an object outside the
 * range its own slider allows.
 */
export function alignTransform(
  t: Transform2D,
  action: AlignAction,
  kind: 'border' | '2d_filter',
  opts: { safeArea?: number } = {},
): Transform2D {
  const inset = opts.safeArea ?? SAFE_AREA_PCT;
  const half = halfExtentPct(kind, t.scale);
  // Normalize the signed zero clamping can produce: -0 is numerically 0 but
  // compares unequal under Object.is, which would make "is this at its default"
  // checks (SliderRow's reset affordance) read false for a centred object.
  const z = (v: number) => (v === 0 ? 0 : v);
  // Distance from centre to a flush-against-the-safe-area position. Negative
  // when the object is wider than the frame — an oversized frame's "edge" is
  // outside the viewport, so pin it to centre rather than pushing it further out.
  const edge = Math.max(0, 50 - inset - half);
  switch (action) {
    case 'centerH':
      return { ...t, x: 0 };
    case 'centerV':
      return { ...t, y: 0 };
    case 'center':
      return { ...t, x: 0, y: 0 };
    case 'left':
      return { ...t, x: z(clampToSpec(-edge, OVERLAY_POSITION)) };
    case 'right':
      return { ...t, x: z(clampToSpec(edge, OVERLAY_POSITION)) };
    case 'top':
      return { ...t, y: z(clampToSpec(-edge, OVERLAY_POSITION)) };
    case 'bottom':
      return { ...t, y: z(clampToSpec(edge, OVERLAY_POSITION)) };
  }
}

/* — Rotation snapping ------------------------------------------------------ */

/** The angles rotation snaps to, in degrees, across OVERLAY_ROTATION's range. */
export const ROTATION_SNAP_ANGLES = [-180, -135, -90, -45, 0, 45, 90, 135, 180] as const;

/** Default snap tolerance in degrees — wide enough to catch a slider drag. */
export const ROTATION_SNAP_TOLERANCE = 6;

/**
 * Snap a rotation to the nearest cardinal/diagonal angle within `tolerance`.
 * Returns the input unchanged when nothing is close enough, and clamps into
 * OVERLAY_ROTATION so a snap can never exceed the control's own bounds.
 */
export function snapRotation(deg: number, tolerance: number = ROTATION_SNAP_TOLERANCE): number {
  if (!Number.isFinite(deg)) return OVERLAY_ROTATION.min;
  let best = deg;
  let bestD = tolerance;
  for (const angle of ROTATION_SNAP_ANGLES) {
    const d = Math.abs(deg - angle);
    if (d <= bestD) {
      bestD = d;
      best = angle;
    }
  }
  return clampToSpec(best, OVERLAY_ROTATION);
}

/** The next snap angle in a direction — powers the "rotate by 45°" buttons. */
export function stepRotation(deg: number, dir: 1 | -1): number {
  const angles = ROTATION_SNAP_ANGLES;
  if (dir === 1) {
    for (const a of angles) if (a > deg + 0.001) return clampToSpec(a, OVERLAY_ROTATION);
    return clampToSpec(angles[angles.length - 1], OVERLAY_ROTATION);
  }
  for (let i = angles.length - 1; i >= 0; i--) if (angles[i] < deg - 0.001) return clampToSpec(angles[i], OVERLAY_ROTATION);
  return clampToSpec(angles[0], OVERLAY_ROTATION);
}

/* — Peer snap lines -------------------------------------------------------- */

/** A scene object reduced to what snapping needs (keeps this module type-light). */
export interface SnapPeer {
  id: string;
  kind: 'border' | '2d_filter';
  x: number;
  y: number;
  scale: number;
  hidden?: boolean;
}

/**
 * Guide lines contributed by the OTHER objects in the scene: each peer's centre
 * and both of its edges, per axis. That is what turns "snap to three fixed
 * lines" into real object-to-object alignment. Excludes the dragged object and
 * anything hidden (an invisible layer must not pull a visible one).
 *
 * Values are de-duplicated and sorted so the guide overlay is stable frame to
 * frame, and capped so a 20-object scene cannot make snapping quadratic.
 */
export function peerSnapLines(
  peers: readonly SnapPeer[],
  excludeId: string | null,
): { x: number[]; y: number[] } {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const p of peers) {
    if (p.id === excludeId || p.hidden) continue;
    const half = halfExtentPct(p.kind, p.scale);
    for (const [set, v] of [[xs, p.x], [ys, p.y]] as const) {
      set.add(round2(v));
      set.add(round2(v - half));
      set.add(round2(v + half));
    }
  }
  return { x: [...xs].sort(numeric), y: [...ys].sort(numeric) };
}

const numeric = (a: number, b: number) => a - b;
const round2 = (v: number) => Math.round(v * 100) / 100;

/* — 3D keyboard nudge ------------------------------------------------------ */

export interface Vec3 { x: number; y: number; z: number }

/** Nudge steps for a 3D piece's anchor offset, in head-space centimetres. */
export const NUDGE_3D_SMALL = 0.2;
export const NUDGE_3D_BIG = 1;
/** Matches the offset sliders' declared range in PropertiesDock (±20 cm). */
export const OFFSET_CM_LIMIT = 20;

/**
 * Arrow-key nudge for a selected 3D piece's anchor offset. Arrow keys move the
 * piece in the plane the host is looking at — left/right on X, up/down on Y —
 * with Shift for the coarse step. Keyboard nudge previously existed for 2D
 * overlays ONLY, so a selected 3D piece could not be moved by keyboard at all.
 * Never mutates; clamps to the offset sliders' own range.
 */
export function nudgeOffset3D(
  offset: Vec3,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  big?: boolean,
): Vec3 {
  const step = big ? NUDGE_3D_BIG : NUDGE_3D_SMALL;
  const next = { ...offset };
  switch (key) {
    case 'ArrowUp':
      next.y += step;
      break;
    case 'ArrowDown':
      next.y -= step;
      break;
    case 'ArrowLeft':
      next.x -= step;
      break;
    case 'ArrowRight':
      next.x += step;
      break;
  }
  const lim = (v: number) => Math.min(OFFSET_CM_LIMIT, Math.max(-OFFSET_CM_LIMIT, round2(v)));
  return { x: lim(next.x), y: lim(next.y), z: lim(next.z) };
}
