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
} from './openGesture';

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
    });
  }

  it('window shapes trace, drapes pull, doors and lifting walls hold', () => {
    for (const id of CARD_DESIGN_IDS) {
      const kind = cardDesign(id).gateway.kind;
      expect(gestureFor(id)).toBe(kind === 'iris' ? 'trace' : kind === 'slide' ? 'pull' : 'hold');
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
