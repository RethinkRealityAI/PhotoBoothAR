import { describe, expect, it } from 'vitest';
import { CARD_DESIGN_IDS, cardDesign, sceneFrame } from './cardDesigns';
import {
  gestureFor,
  holdDrain,
  holdProgress,
  holdT,
  HOLD_CRACK_T,
  HOLD_MS,
  OPEN_HINT,
  pullOpens,
  pullProgress,
  pullSettle,
  pullT,
  PULL_MAX_T,
  boltProgress,
  boltRelease,
  blendVelocity,
  BOLT_CLICK_AT,
  turnCoast,
  TURN_MAX_SPIN,
  BOLTS,
  BOLT_TRAVEL,
  popAt,
  popsLeft,
  popTargets,
  POP_OPEN_AT,
  turnDelta,
  turnProgress,
  turnT,
  TURN_CRACK_T,
  TURN_FULL,
} from './openGesture';
import { livePieces } from './liveGates';

describe('every design asks to be opened its own way', () => {
  it('has a hint for every design and no strays', () => {
    expect(Object.keys(OPEN_HINT).sort()).toEqual([...CARD_DESIGN_IDS].sort());
  });

  for (const id of CARD_DESIGN_IDS) {
    it(`${id}: the hint matches the gesture`, () => {
      const g = gestureFor(id);
      const hint = OPEN_HINT[id].toLowerCase();
      if (g === 'trace') expect(hint).toMatch(/^trace /);
      if (g === 'hold') expect(hint).toMatch(/^hold /);
      if (g === 'pull') expect(hint).toMatch(/^(pull|part) /);
      if (g === 'pop') expect(hint).toMatch(/^pop /);
      if (g === 'bolts') expect(hint).toMatch(/^slide /);
      if (g === 'turn') expect(hint).toMatch(/^turn /);
    });
  }

  it('window shapes trace, drapes pull, doors and lifting walls hold, unless the design asks for its own', () => {
    for (const id of CARD_DESIGN_IDS) {
      const d = cardDesign(id);
      const kind = d.gateway.kind;
      expect(gestureFor(id)).toBe(d.gesture ?? (kind === 'iris' ? 'trace' : kind === 'slide' ? 'pull' : 'hold'));
    }
  });

  it('the special mechanics sit on gates that can carry them', () => {
    for (const id of CARD_DESIGN_IDS) {
      const d = cardDesign(id);
      if (d.gesture === 'pop') expect(d.live).toBe('balloons');
      if (d.gesture === 'bolts') expect(d.gateway.kind).toBe('doors');
      if (d.gesture === 'turn') expect(d.gateway.kind).toBe('iris');
    }
  });
});

describe('hold', () => {
  it('fills over HOLD_MS and clamps', () => {
    expect(holdProgress(0)).toBe(0);
    expect(holdProgress(HOLD_MS / 2)).toBeCloseTo(0.5, 5);
    expect(holdProgress(HOLD_MS * 3)).toBe(1);
    expect(holdProgress(NaN)).toBe(0);
    expect(holdProgress(-20)).toBe(0);
  });

  it('drains back twice as fast when let go', () => {
    expect(holdDrain(0.8, 0)).toBe(0.8);
    expect(holdDrain(0.8, HOLD_MS / 4)).toBeCloseTo(0.3, 5);
    expect(holdDrain(0.8, HOLD_MS)).toBe(0);
    expect(holdDrain(NaN, 10)).toBe(0);
  });

  it('cracks the gate only a little, and grows smoothly', () => {
    expect(holdT(0)).toBe(0);
    expect(holdT(1)).toBe(HOLD_CRACK_T);
    expect(holdT(0.5)).toBeLessThan(HOLD_CRACK_T / 2);
    expect(HOLD_CRACK_T).toBeLessThan(0.1);
  });
});

describe('pull', () => {
  it('counts distance either way, ignores bad input', () => {
    expect(pullProgress(60, 400)).toBeCloseTo(0.5, 5);
    expect(pullProgress(-60, 400)).toBeCloseTo(0.5, 5);
    expect(pullProgress(1000, 400)).toBe(1);
    expect(pullProgress(50, 0)).toBe(0);
    expect(pullProgress(NaN, 400)).toBe(0);
  });

  it('opens past halfway only', () => {
    expect(pullOpens(0.49)).toBe(false);
    expect(pullOpens(0.5)).toBe(true);
    expect(pullOpens(NaN)).toBe(false);
  });

  it('the gate follows the finger: its travel grows in step with the pull', () => {
    const open = (p: number) => sceneFrame('slide', pullT(p)).slidePct;
    // Equal steps of pull give roughly equal steps of travel (no lag-then-lurch).
    const a = open(0.25) - open(0);
    const b = open(1) - open(0.75);
    expect(a).toBeGreaterThan(0);
    expect(b / a).toBeGreaterThan(0.7);
    expect(b / a).toBeLessThan(1.4);
  });

  it('maps onto the opening timeline and settles back to closed', () => {
    expect(pullT(1)).toBe(PULL_MAX_T);
    expect(pullT(2)).toBe(PULL_MAX_T);
    expect(pullSettle(0.4, 0)).toBe(0.4);
    expect(pullSettle(0.4, 100)).toBeLessThan(0.4);
    expect(pullSettle(0.4, 10_000)).toBe(0);
  });
});

describe('pop', () => {
  const pieces = livePieces('balloons');
  const targets = popTargets(pieces);

  it('only counts balloons a finger can reach', () => {
    expect(targets.length).toBeGreaterThan(30);
    expect(targets.length).toBeLessThan(pieces.length);
  });

  it('a tap pops the balloons around it, nearest first, never twice', () => {
    const hit = popAt(pieces, new Set(), { x: 450, y: 760 });
    expect(hit.length).toBeGreaterThan(1);
    const d = (i: number) => Math.hypot(pieces[i].x - 450, pieces[i].y - 760);
    for (let k = 1; k < hit.length; k++) expect(d(hit[k])).toBeGreaterThanOrEqual(d(hit[k - 1]));
    expect(popAt(pieces, new Set(hit), { x: 450, y: 760 })).toEqual([]);
    expect(popAt(pieces, new Set(), { x: NaN, y: 0 })).toEqual([]);
  });

  it('opens once most reachable balloons are popped, in a handful of taps', () => {
    const popped = new Set<number>();
    expect(popsLeft(targets, popped)).toBe(Math.ceil(targets.length * POP_OPEN_AT));
    let taps = 0;
    while (popsLeft(targets, popped) > 0 && taps < 60) {
      // Tap on the next balloon still standing.
      const next = targets.find((i) => !popped.has(i))!;
      for (const i of popAt(pieces, popped, pieces[next])) popped.add(i);
      taps++;
    }
    expect(popsLeft(targets, popped)).toBe(0);
    expect(taps).toBeGreaterThanOrEqual(4);
    expect(taps).toBeLessThanOrEqual(16);
  });
});

describe('bolts', () => {
  it('three bolts that alternate, each slid its own way', () => {
    expect(BOLTS).toHaveLength(3);
    expect(BOLTS[0].dir).not.toBe(BOLTS[1].dir);
  });

  it('progress follows the finger only in the bolt\'s direction', () => {
    expect(boltProgress(BOLT_TRAVEL / 2, 1)).toBeCloseTo(0.5, 5);
    expect(boltProgress(-BOLT_TRAVEL / 2, 1)).toBe(0);
    expect(boltProgress(-BOLT_TRAVEL * 3, -1)).toBe(1);
    expect(boltProgress(NaN, 1)).toBe(0);
  });

  it('clicks open past the catch, slides home short of it', () => {
    expect(boltRelease(0.9)).toBe(1);
    expect(boltRelease(0.3)).toBe(0);
    expect(boltRelease(NaN)).toBe(0);
  });

  it('a quick flick opens it without dragging to the catch', () => {
    expect(boltRelease(0.25, 0)).toBe(0);
    expect(boltRelease(0.25, 0.005)).toBe(1);
    // a flick back toward home never opens it
    expect(boltRelease(0.5, -0.02)).toBe(0);
    expect(boltRelease(BOLT_CLICK_AT - 0.01, NaN)).toBe(0);
  });

  it('release speed is smoothed and survives a bad sample', () => {
    const v = blendVelocity(0, 0.1, 20);
    expect(v).toBeCloseTo(0.002, 6);
    expect(blendVelocity(v, 0.1, 0)).toBe(v);
    expect(blendVelocity(NaN, NaN, 16)).toBe(0);
    // a 1ms burst is read as 8ms, not a huge spike
    expect(blendVelocity(0, 0.08, 1)).toBeCloseTo(0.004, 6);
  });
});

describe('turn', () => {
  it('unwraps across the seam at pi', () => {
    expect(turnDelta(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2, 5);
    expect(turnDelta(-3.1, 3.1)).toBeCloseTo(-(2 * Math.PI - 6.2), 5);
    expect(turnDelta(0, 0.5)).toBeCloseTo(0.5, 5);
    expect(turnDelta(NaN, 1)).toBe(0);
  });

  it('either way round counts, and a full turn opens', () => {
    expect(turnProgress(TURN_FULL / 2)).toBeCloseTo(0.5, 5);
    expect(turnProgress(-TURN_FULL / 2)).toBeCloseTo(0.5, 5);
    expect(turnProgress(TURN_FULL * 2)).toBe(1);
    expect(turnProgress(NaN)).toBe(0);
  });

  it('a slow circle of small steps adds up to a turn', () => {
    let acc = 0;
    let prev = Math.atan2(0, 1);
    for (let a = 0.05; a <= 2 * Math.PI; a += 0.05) {
      const next = Math.atan2(Math.sin(a), Math.cos(a));
      acc += turnDelta(prev, next);
      prev = next;
    }
    expect(turnProgress(acc)).toBe(1);
  });

  it('a flicked wheel coasts, slows and stops', () => {
    let spin = 0.012;
    let angle = 0;
    let frames = 0;
    while (spin !== 0 && frames < 600) {
      angle += spin * 16;
      spin = turnCoast(spin, 16);
      frames++;
    }
    expect(spin).toBe(0);
    expect(frames).toBeLessThan(120); // under two seconds
    expect(angle).toBeGreaterThan(2); // a good flick carries over 110 degrees
    expect(Math.abs(turnCoast(1, 0.001))).toBeLessThanOrEqual(TURN_MAX_SPIN);
    expect(turnCoast(NaN, 16)).toBe(0);
    expect(turnCoast(-0.01, 16)).toBeLessThan(0);
  });

  it('cracks the window as the wheel turns', () => {
    expect(turnT(0)).toBe(0);
    expect(turnT(1)).toBeCloseTo(TURN_CRACK_T, 9);
    expect(turnT(0.5)).toBeLessThan(TURN_CRACK_T / 2);
  });
});
