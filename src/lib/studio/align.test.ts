/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  OVERLAY_SIZE_PCT,
  SAFE_AREA_PCT,
  ROTATION_SNAP_ANGLES,
  OFFSET_CM_LIMIT,
  halfExtentPct,
  alignTransform,
  snapRotation,
  stepRotation,
  peerSnapLines,
  nudgeOffset3D,
} from './align';
import { OVERLAY_POSITION, OVERLAY_ROTATION } from './controlSpecs';
import type { Transform2D } from '../../types';

const t = (p: Partial<Transform2D> = {}): Transform2D => ({ scale: 1, x: 0, y: 0, rotation: 0, ...p });

describe('halfExtentPct', () => {
  it('uses the rendered box size per overlay kind', () => {
    expect(halfExtentPct('border', 1)).toBe(50);
    expect(halfExtentPct('2d_filter', 1)).toBe(30);
  });

  it('scales with the transform', () => {
    expect(halfExtentPct('2d_filter', 0.5)).toBe(15);
    expect(halfExtentPct('border', 2)).toBe(100);
  });

  it('treats a non-finite scale as 1 rather than producing NaN', () => {
    expect(halfExtentPct('border', NaN)).toBe(50);
  });
});

describe('alignTransform', () => {
  it('centres on each axis without touching the other', () => {
    expect(alignTransform(t({ x: 12, y: -7 }), 'centerH', '2d_filter')).toEqual(t({ x: 0, y: -7 }));
    expect(alignTransform(t({ x: 12, y: -7 }), 'centerV', '2d_filter')).toEqual(t({ x: 12, y: 0 }));
    expect(alignTransform(t({ x: 12, y: -7 }), 'center', '2d_filter')).toEqual(t({ x: 0, y: 0 }));
  });

  it('places a sticker flush against the safe area', () => {
    // 50 - 4 (safe area) - 30 (half of a 60% sticker) = 16
    expect(alignTransform(t(), 'left', '2d_filter').x).toBe(-16);
    expect(alignTransform(t(), 'right', '2d_filter').x).toBe(16);
    expect(alignTransform(t(), 'top', '2d_filter').y).toBe(-16);
    expect(alignTransform(t(), 'bottom', '2d_filter').y).toBe(16);
  });

  it('pins a full-bleed frame to centre instead of pushing it off-screen', () => {
    // A 100% frame at scale 1 already fills the viewport: 50 - 4 - 50 < 0 → 0.
    expect(alignTransform(t(), 'left', 'border').x).toBe(0);
    expect(alignTransform(t(), 'right', 'border').x).toBe(0);
  });

  it('accounts for scale when computing the edge', () => {
    // half = 60 * 0.5 / 2 = 15 → edge = 50 - 4 - 15 = 31
    expect(alignTransform(t({ scale: 0.5 }), 'left', '2d_filter').x).toBe(-31);
  });

  it('honours a custom safe area', () => {
    expect(alignTransform(t(), 'left', '2d_filter', { safeArea: 0 }).x).toBe(-20);
  });

  it('never exceeds the position slider bounds', () => {
    for (const action of ['left', 'right', 'top', 'bottom'] as const) {
      const r = alignTransform(t({ scale: 0.1 }), action, '2d_filter');
      expect(r.x).toBeGreaterThanOrEqual(OVERLAY_POSITION.min);
      expect(r.x).toBeLessThanOrEqual(OVERLAY_POSITION.max);
      expect(r.y).toBeGreaterThanOrEqual(OVERLAY_POSITION.min);
      expect(r.y).toBeLessThanOrEqual(OVERLAY_POSITION.max);
    }
  });

  it('never mutates its input', () => {
    const src = t({ x: 5 });
    alignTransform(src, 'left', '2d_filter');
    expect(src.x).toBe(5);
  });

  it('preserves scale and rotation', () => {
    const r = alignTransform(t({ scale: 1.4, rotation: 33 }), 'center', 'border');
    expect(r.scale).toBe(1.4);
    expect(r.rotation).toBe(33);
  });
});

describe('snapRotation', () => {
  it('snaps a near-cardinal angle', () => {
    expect(snapRotation(88)).toBe(90);
    expect(snapRotation(-2)).toBe(0);
    expect(snapRotation(47)).toBe(45);
  });

  it('leaves a deliberate off-angle alone', () => {
    expect(snapRotation(70)).toBe(70);
    expect(snapRotation(22)).toBe(22);
  });

  it('respects a custom tolerance', () => {
    expect(snapRotation(70, 25)).toBe(90);
    expect(snapRotation(88, 1)).toBe(88);
  });

  it('snaps both extremes of the range', () => {
    expect(snapRotation(179)).toBe(180);
    expect(snapRotation(-179)).toBe(-180);
  });

  it('returns the minimum for non-finite input rather than propagating NaN', () => {
    expect(snapRotation(NaN)).toBe(OVERLAY_ROTATION.min);
  });

  it('only ever returns declared snap angles or the input', () => {
    for (let d = -180; d <= 180; d += 1) {
      const r = snapRotation(d);
      expect(r === d || (ROTATION_SNAP_ANGLES as readonly number[]).includes(r)).toBe(true);
    }
  });
});

describe('stepRotation', () => {
  it('walks to the next snap angle in each direction', () => {
    expect(stepRotation(0, 1)).toBe(45);
    expect(stepRotation(0, -1)).toBe(-45);
    expect(stepRotation(46, 1)).toBe(90);
    expect(stepRotation(44, -1)).toBe(0);
  });

  it('stops at the ends of the range instead of wrapping', () => {
    expect(stepRotation(180, 1)).toBe(180);
    expect(stepRotation(-180, -1)).toBe(-180);
  });

  it('stays within the rotation spec', () => {
    for (const d of [-180, -91, 0, 91, 180]) {
      for (const dir of [1, -1] as const) {
        const r = stepRotation(d, dir);
        expect(r).toBeGreaterThanOrEqual(OVERLAY_ROTATION.min);
        expect(r).toBeLessThanOrEqual(OVERLAY_ROTATION.max);
      }
    }
  });
});

describe('peerSnapLines', () => {
  const peers = [
    { id: 'a', kind: '2d_filter' as const, x: 10, y: 0, scale: 1 },
    { id: 'b', kind: '2d_filter' as const, x: -20, y: 5, scale: 1 },
  ];

  it('offers each peer centre and both edges per axis', () => {
    const { x } = peerSnapLines(peers, 'b');
    expect(x).toEqual([-20, 10, 40]); // 10 ± 30, and 10
  });

  it('excludes the dragged object itself', () => {
    // Only peer 'b' (x=-20, half 30) contributes: -50, -20, 10. The 10 here is
    // b's RIGHT EDGE, not a's centre — a contributes nothing at all.
    const { x } = peerSnapLines(peers, 'a');
    expect(x).toEqual([-50, -20, 10]);
    expect(peerSnapLines([peers[0]], 'a')).toEqual({ x: [], y: [] });
  });

  it('ignores hidden peers — an invisible layer must not pull a visible one', () => {
    const withHidden = [...peers, { id: 'c', kind: '2d_filter' as const, x: 99, y: 99, scale: 1, hidden: true }];
    const { x } = peerSnapLines(withHidden, 'b');
    expect(x).not.toContain(99);
  });

  it('de-duplicates identical lines', () => {
    const dupes = [
      { id: 'a', kind: '2d_filter' as const, x: 0, y: 0, scale: 1 },
      { id: 'b', kind: '2d_filter' as const, x: 0, y: 0, scale: 1 },
    ];
    expect(peerSnapLines(dupes, null).x).toEqual([-30, 0, 30]);
  });

  it('returns empty axes for an empty scene', () => {
    expect(peerSnapLines([], null)).toEqual({ x: [], y: [] });
  });
});

describe('nudgeOffset3D', () => {
  const o = { x: 0, y: 0, z: 0 };

  it('moves on the axis the arrow names', () => {
    expect(nudgeOffset3D(o, 'ArrowUp').y).toBeCloseTo(0.2);
    expect(nudgeOffset3D(o, 'ArrowDown').y).toBeCloseTo(-0.2);
    expect(nudgeOffset3D(o, 'ArrowLeft').x).toBeCloseTo(-0.2);
    expect(nudgeOffset3D(o, 'ArrowRight').x).toBeCloseTo(0.2);
  });

  it('uses the coarse step with shift', () => {
    expect(nudgeOffset3D(o, 'ArrowUp', true).y).toBe(1);
  });

  it('leaves the untouched axes alone', () => {
    const r = nudgeOffset3D({ x: 3, y: 4, z: 5 }, 'ArrowLeft');
    expect(r.y).toBe(4);
    expect(r.z).toBe(5);
  });

  it('clamps to the offset sliders own range', () => {
    expect(nudgeOffset3D({ x: OFFSET_CM_LIMIT, y: 0, z: 0 }, 'ArrowRight').x).toBe(OFFSET_CM_LIMIT);
    expect(nudgeOffset3D({ x: -OFFSET_CM_LIMIT, y: 0, z: 0 }, 'ArrowLeft').x).toBe(-OFFSET_CM_LIMIT);
  });

  it('never mutates its input', () => {
    const src = { x: 1, y: 1, z: 1 };
    nudgeOffset3D(src, 'ArrowUp');
    expect(src).toEqual({ x: 1, y: 1, z: 1 });
  });
});

describe('module invariants', () => {
  it('the size table matches the stage rendering contract', () => {
    expect(OVERLAY_SIZE_PCT.border).toBe(100);
    expect(OVERLAY_SIZE_PCT['2d_filter']).toBe(60);
  });

  it('the safe area is a small positive inset', () => {
    expect(SAFE_AREA_PCT).toBeGreaterThan(0);
    expect(SAFE_AREA_PCT).toBeLessThan(25);
  });
});
