import { describe, expect, it } from 'vitest';
import {
  FIT_REACH, NUDGE_COARSE, NUDGE_FINE, ROT_COARSE, UNDO_MAX, axesForYaw, degrees, dragFit, fitBounds, fitsEqual, lateralAxis,
  nudgeFit, offsetCm, pinchFactor, pushUndo, resizeFit, rotateFit, sizePercent, solveDrag, spaceFit, twistRoll, wheelFactor,
  type ScreenAxes,
} from './beamyFitAdjust';
import { ANCHOR_IDS, ANCHOR_PRESETS, FIT_ROLL_MAX, normalizeFit, presetFit, type PropFit } from './homeAssets';

/** Where the anchor lands on screen after a bone-space move (the forward model). */
function project(a: ScreenAxes, d: [number, number, number]) {
  return { x: a.x.x * d[0] + a.y.x * d[1] + a.z.x * d[2], y: a.x.y * d[0] + a.y.y * d[1] + a.z.y * d[2] };
}
const moved = (from: PropFit, to: PropFit): [number, number, number] => [to.at[0] - from.at[0], to.at[1] - from.at[1], to.at[2] - from.at[2]];

describe('beamyFitAdjust: drag', () => {
  const S = 400; // px per bone metre (a 240px-tall Beamy: 0.6 m model)

  it('from the front, right is his +x (not mirrored) and up is his +y', () => {
    const a = axesForYaw(0, S);
    const f0 = presetFit('crown');
    const right = dragFit(f0, a, 20, 0, 'crown');
    expect(right.at[0]).toBeCloseTo(f0.at[0] + 20 / S, 6);
    expect(right.at[1]).toBe(f0.at[1]);
    expect(right.at[2]).toBe(f0.at[2]);
    // Screen y points down: dragging UP (negative dy) raises the prop.
    const up = dragFit(f0, a, 0, -16, 'crown');
    expect(up.at[1]).toBeCloseTo(f0.at[1] + 16 / S, 6);
    expect(up.at[0]).toBe(f0.at[0]);
  });

  it('the anchor follows the pointer exactly at every turn the preview offers', () => {
    for (const yaw of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const a = axesForYaw(yaw, S);
      const f0 = presetFit('glasses');
      const f = dragFit(f0, a, 12, -7, 'glasses');
      const p = project(a, moved(f0, f));
      // Within 0.005 px (fits are stored to the micrometre: 0.0004 px here).
      expect(p.x).toBeCloseTo(12, 2);
      expect(p.y).toBeCloseTo(-7, 2);
    }
  });

  it('turned past 45 degrees, a sideways drag moves him back/forward instead of exploding along x', () => {
    expect(lateralAxis(axesForYaw(0.45, S))).toBe(0);
    expect(lateralAxis(axesForYaw(0.9, S))).toBe(2);
    expect(lateralAxis(axesForYaw(-0.9, S))).toBe(2);
    const f0 = presetFit('crown');
    // Turned toward the viewer's right, his front (+z) faces right: dragging right brings it forward.
    const f = dragFit(f0, axesForYaw(0.9, S), 10, 0, 'crown');
    expect(f.at[2]).toBeGreaterThan(f0.at[2]);
    expect(f.at[0]).toBe(f0.at[0]);
    const g = dragFit(f0, axesForYaw(-0.9, S), 10, 0, 'crown');
    expect(g.at[2]).toBeLessThan(f0.at[2]);
  });

  it('follows the pointer when the stage draws his bone mirrored or leaned (it measures, it never assumes)', () => {
    const mirrored: ScreenAxes = { x: { x: -S, y: 0 }, y: { x: 0, y: -S }, z: { x: 0, y: 0 } };
    const f0 = presetFit('crown');
    expect(dragFit(f0, mirrored, 10, 0, 'crown').at[0]).toBeCloseTo(f0.at[0] - 10 / S, 6);
    const lean = 0.2;
    const leaned: ScreenAxes = {
      x: { x: S * Math.cos(lean), y: -S * Math.sin(lean) },
      y: { x: S * Math.sin(lean), y: -S * Math.cos(lean) },
      z: { x: 0, y: 0 },
    };
    const f = dragFit(f0, leaned, 9, 5, 'crown');
    const p = project(leaned, moved(f0, f));
    expect(p.x).toBeCloseTo(9, 2);
    expect(p.y).toBeCloseTo(5, 2);
  });

  it('a degenerate view (nothing drawn yet) leaves the fit alone', () => {
    const zero: ScreenAxes = { x: { x: 0, y: 0 }, y: { x: 0, y: 0 }, z: { x: 0, y: 0 } };
    expect(solveDrag(zero, 5, 5)).toBeNull();
    const f0 = presetFit('hat');
    expect(dragFit(f0, zero, 5, 5, 'hat')).toBe(f0);
  });

  it('clamps to the sliders\' own range around the anchor', () => {
    const f0 = presetFit('neck');
    const far = dragFit(f0, axesForYaw(0, S), 10_000, -10_000, 'neck');
    expect(far.at[0]).toBeCloseTo(ANCHOR_PRESETS.neck.fit.at[0] + FIT_REACH, 9);
    expect(far.at[1]).toBeCloseTo(ANCHOR_PRESETS.neck.fit.at[1] + FIT_REACH, 9);
    expect(fitBounds('neck').at[1]).toEqual([ANCHOR_PRESETS.neck.fit.at[1] - FIT_REACH, ANCHOR_PRESETS.neck.fit.at[1] + FIT_REACH]);
  });
});

describe('beamyFitAdjust: nudge, size, rotation, spacing', () => {
  it('nudges along his own axes in centimetre steps', () => {
    const f0 = presetFit('crown');
    expect(nudgeFit(f0, 'right', NUDGE_COARSE, 'crown').at).toEqual([0.01, 0.29, 0]);
    expect(nudgeFit(f0, 'left', NUDGE_FINE, 'crown').at).toEqual([-0.002, 0.29, 0]);
    expect(nudgeFit(f0, 'up', NUDGE_COARSE, 'crown').at).toEqual([0, 0.3, 0]);
    expect(nudgeFit(f0, 'down', NUDGE_COARSE, 'crown').at).toEqual([0, 0.28, 0]);
    expect(nudgeFit(f0, 'forward', NUDGE_COARSE, 'crown').at).toEqual([0, 0.29, 0.01]);
    expect(nudgeFit(f0, 'back', NUDGE_COARSE, 'crown').at).toEqual([0, 0.29, -0.01]);
    expect(f0.at).toEqual([0, 0.29, 0]); // never mutated
  });

  it('resizes about the anchor within the size slider range', () => {
    const f0 = presetFit('crown');
    expect(resizeFit(f0, 1.1, 'crown').width).toBeCloseTo(0.44, 9);
    expect(sizePercent(resizeFit(f0, 1.1, 'crown'), 'crown')).toBe(110);
    expect(resizeFit(f0, 100, 'crown').width).toBeCloseTo(fitBounds('crown').width[1], 9);
    expect(resizeFit(f0, 0.001, 'crown').width).toBeCloseTo(fitBounds('crown').width[0], 9);
    expect(resizeFit(f0, Number.NaN, 'crown')).toBe(f0);
    expect(resizeFit(f0, 1.1, 'crown').at).toEqual(f0.at);
  });

  it('wheel up grows, wheel down shrinks, bounded per notch; pinch is the distance ratio', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100000)).toBe(1.25);
    expect(wheelFactor(100000)).toBe(0.8);
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48), 9);
    expect(wheelFactor(Number.NaN)).toBe(1);
    expect(pinchFactor(100, 150)).toBeCloseTo(1.5, 9);
    expect(pinchFactor(2, 150)).toBe(1);
  });

  it('tilts and rolls, dropping a zero like normalizeFit, and clamps', () => {
    const f0 = presetFit('crown');
    const r = rotateFit(f0, 'roll', ROT_COARSE, 'crown');
    expect(degrees(r.roll)).toBe(5);
    expect(rotateFit(r, 'roll', -ROT_COARSE, 'crown').roll).toBeUndefined();
    expect(rotateFit(f0, 'roll', 99, 'crown').roll).toBeCloseTo(FIT_ROLL_MAX, 9);
    const hat = presetFit('hat');
    expect(rotateFit(hat, 'tilt', ROT_COARSE, 'hat').tilt).toBeCloseTo(-0.14 + ROT_COARSE, 6);
    // What the adjust mode writes survives the normalizer unchanged.
    expect(normalizeFit(r)).toEqual(r);
  });

  it('a clockwise twist (y down) rolls him counterclockwise-negative', () => {
    const d = twistRoll({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 10 });
    expect(d).toBeLessThan(0);
    expect(d).toBeCloseTo(-Math.atan2(10, 100), 9);
    // Wraps the short way round.
    expect(twistRoll({ x: 0, y: 0 }, { x: -100, y: 1 }, { x: 0, y: 0 }, { x: -100, y: -1 })).toBeCloseTo(-0.02, 3);
  });

  it('changes only an earring pair\'s spacing', () => {
    const ears = presetFit('ears');
    expect(spaceFit(ears, 0.05, 'ears').pair).toBeCloseTo(0.45, 9);
    expect(spaceFit(ears, 10, 'ears').pair).toBe(fitBounds('ears').pair[1]);
    const crown = presetFit('crown');
    expect(spaceFit(crown, 0.05, 'crown')).toBe(crown);
  });

  it('every operation keeps a preset valid for the normalizer (the draft can store it)', () => {
    for (const id of ANCHOR_IDS) {
      let f = presetFit(id);
      f = nudgeFit(f, 'up', NUDGE_COARSE, id);
      f = resizeFit(f, 1.3, id);
      f = rotateFit(f, 'roll', 0.2, id);
      f = dragFit(f, axesForYaw(0.45, 300), 7, 3, id);
      expect(normalizeFit(f)).toEqual(f);
    }
  });
});

describe('beamyFitAdjust: undo and readouts', () => {
  it('pushes only real changes, and keeps at most UNDO_MAX', () => {
    const f0 = presetFit('crown');
    let past = pushUndo([], f0);
    expect(past).toHaveLength(1);
    past = pushUndo(past, presetFit('crown'));
    expect(past).toHaveLength(1);
    past = pushUndo(past, nudgeFit(f0, 'up', NUDGE_FINE, 'crown'));
    expect(past).toHaveLength(2);
    let long: PropFit[] = [];
    for (let i = 0; i < UNDO_MAX + 10; i++) long = pushUndo(long, { ...f0, width: 0.2 + i * 0.001 });
    expect(long).toHaveLength(UNDO_MAX);
    expect(long[long.length - 1].width).toBeCloseTo(0.2 + (UNDO_MAX + 9) * 0.001, 9);
  });

  it('compares fits by value, treating a missing tilt/roll as zero', () => {
    expect(fitsEqual(presetFit('crown'), { ...presetFit('crown'), tilt: 0, roll: 0 })).toBe(true);
    expect(fitsEqual(presetFit('crown'), presetFit('hat'))).toBe(false);
  });

  it('reads offsets in signed centimetres from the preset', () => {
    const f = nudgeFit(presetFit('crown'), 'up', NUDGE_COARSE, 'crown');
    expect(offsetCm(f, 'crown', 1)).toBe('+1.0 cm');
    expect(offsetCm(f, 'crown', 0)).toBe('0.0 cm');
    expect(offsetCm(nudgeFit(f, 'left', 0.014, 'crown'), 'crown', 0)).toBe('-1.4 cm');
  });
});
