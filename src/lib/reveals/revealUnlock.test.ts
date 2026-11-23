import { describe, expect, it } from 'vitest';
import {
  HOLD_FULL_MS, TURN_FULL_RAD, beamyOutline, beamyTraceProgress, beamyTraceStep, holdCharge,
  newBeamyTrace, newRub, newTurn, rubCoverage, rubProgress, rubStroke, tapProgress, turnLift,
  turnProgress, turnStep, wrapAngle,
} from './revealUnlock';

describe('hold', () => {
  it('fills in the full time and drains slower', () => {
    let c = 0;
    for (let t = 0; t < HOLD_FULL_MS.melt; t += 100) c = holdCharge(c, 100, true, HOLD_FULL_MS.melt);
    expect(c).toBeCloseTo(1, 5);
    const after = holdCharge(1, 100, false, HOLD_FULL_MS.melt);
    expect(after).toBeGreaterThan(1 - 100 / HOLD_FULL_MS.melt);
    expect(holdCharge(0.5, 10_000, true, 1000)).toBeLessThan(0.76); // a stalled frame is capped
    expect(holdCharge(Number.NaN, 100, true, 1000)).toBeCloseTo(0.1);
  });
});

describe('tap', () => {
  it('counts to N', () => {
    expect(tapProgress(2, 4)).toBe(0.5);
    expect(tapProgress(9, 4)).toBe(1);
    expect(tapProgress(0, 0)).toBe(1);
  });
});

describe('turn', () => {
  const c = { x: 0, y: 0 };
  const at = (a: number) => ({ x: Math.cos(a) * 100, y: Math.sin(a) * 100 });

  it('wraps', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });

  it('opens after the full sweep in either direction', () => {
    for (const dir of [1, -1]) {
      let s = newTurn();
      for (let a = 0; Math.abs(a) <= TURN_FULL_RAD + 0.2; a += dir * 0.2) s = turnStep(s, at(a), c, 100);
      expect(turnProgress(s)).toBe(1);
    }
  });

  it('back-and-forth cancels, jumps and the dead zone are ignored', () => {
    let s = newTurn();
    for (let a = 0; a < 2; a += 0.2) s = turnStep(s, at(a), c, 100);
    for (let a = 2; a > 0; a -= 0.2) s = turnStep(s, at(a), c, 100);
    expect(turnProgress(s)).toBeLessThan(0.05);
    s = turnStep(newTurn(), at(0), c, 100);
    s = turnStep(s, at(2.5), c, 100); // a jump
    expect(s.total).toBe(0);
    s = turnStep(s, { x: 5, y: 5 }, c, 100); // dead zone
    expect(s.last).toBeNull();
    expect(turnLift(turnStep(newTurn(), at(1), c, 100)).last).toBeNull();
  });
});

describe('trace', () => {
  it('walking the whole outline completes it; scribbling across the middle does not', () => {
    const outline = beamyOutline(200, 200, 300);
    let s = newBeamyTrace();
    for (const p of outline) s = beamyTraceStep(s, outline, p, 300);
    s = beamyTraceStep(s, outline, outline[0], 300);
    expect(beamyTraceProgress(s)).toBe(1);
    let m = newBeamyTrace();
    for (let y = 120; y < 280; y += 8) m = beamyTraceStep(m, outline, { x: 200, y }, 300);
    expect(beamyTraceProgress(m)).toBeLessThan(0.2);
  });

  it('outline is an apex-up triangle around the centroid', () => {
    const o = beamyOutline(0, 0, 90, 30);
    expect(o).toHaveLength(30);
    expect(o[0]).toEqual({ x: 0, y: -60 });
    expect(Math.max(...o.map((p) => p.y))).toBeCloseTo(30);
  });
});

describe('rub', () => {
  it('a sweep clears cells under the brush and returns the same grid when nothing changes', () => {
    const g = newRub(10, 10);
    const a = rubStroke(g, { x: 0, y: 45 }, { x: 100, y: 45 }, 6, 100, 100);
    expect(rubCoverage(a)).toBeCloseTo(0.1);
    expect(rubStroke(a, { x: 0, y: 45 }, { x: 100, y: 45 }, 6, 100, 100)).toBe(a);
    expect(rubStroke(g, { x: Number.NaN, y: 0 }, { x: 1, y: 1 }, 6, 100, 100)).toBe(g);
  });

  it('progress reaches 1 once enough is cleared', () => {
    let g = newRub(10, 10);
    for (let y = 5; y < 100; y += 10) g = rubStroke(g, { x: 0, y }, { x: 100, y }, 6, 100, 100);
    expect(rubProgress(g)).toBe(1);
  });
});
