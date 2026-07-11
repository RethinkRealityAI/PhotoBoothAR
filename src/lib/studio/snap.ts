/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure 2D placement snapping + keyboard nudge for the studio stage.
 * Booth Transform2D semantics: x/y are % of frame size, offset from centre,
 * clamped to -100..100 (see src/lib/studio/dnd.ts, src/types.ts).
 */
import type { Transform2D } from '../../types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SnapOptions {
  /** Max distance (in the same % units as x/y) to snap to a guide line. Default 2.5. */
  threshold?: number;
  /** Guide lines to snap to, in % from centre. Default [0, -25, 25]. */
  lines?: number[];
}

export interface SnapResult {
  transform: Transform2D;
  /** The guide line value snapped to on each axis, or null when free. */
  guides: { v: number | null; h: number | null };
}

const DEFAULT_LINES = [0, -25, 25];
const DEFAULT_THRESHOLD = 2.5;

/** Nearest line to `value` within `threshold`, or null if none is close enough. */
function nearestLine(value: number, lines: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestD = threshold;
  for (const line of lines) {
    const d = Math.abs(value - line);
    if (d <= bestD) {
      bestD = d;
      best = line;
    }
  }
  return best;
}

/** Snap a Transform2D's x/y to the nearest guide line within threshold. Never mutates input. */
export function snapTransform(t: Transform2D, opts?: SnapOptions): SnapResult {
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const lines = opts?.lines ?? DEFAULT_LINES;
  const vLine = nearestLine(t.x, lines, threshold);
  const hLine = nearestLine(t.y, lines, threshold);
  return {
    transform: {
      ...t,
      x: vLine !== null ? vLine : t.x,
      y: hLine !== null ? hLine : t.y,
    },
    guides: { v: vLine, h: hLine },
  };
}

const NUDGE_SMALL = 0.5;
const NUDGE_BIG = 2;

/** Nudge a Transform2D by keyboard arrow key, clamped to ±100. Never mutates input. */
export function nudgeTransform(
  t: Transform2D,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  big?: boolean,
): Transform2D {
  const step = big ? NUDGE_BIG : NUDGE_SMALL;
  let { x, y } = t;
  switch (key) {
    case 'ArrowUp':
      y -= step;
      break;
    case 'ArrowDown':
      y += step;
      break;
    case 'ArrowLeft':
      x -= step;
      break;
    case 'ArrowRight':
      x += step;
      break;
  }
  return { ...t, x: clamp(x, -100, 100), y: clamp(y, -100, 100) };
}
