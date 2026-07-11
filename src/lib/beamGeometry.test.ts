import { describe, it, expect } from 'vitest';
import { centerOf, beamPath, polaroidTilt, type Rect } from './beamGeometry';

describe('centerOf', () => {
  it('returns the geometric centre of a rect', () => {
    expect(centerOf({ left: 10, top: 20, width: 40, height: 60 })).toEqual({ x: 30, y: 50 });
  });

  it('handles a zero-size rect (a point)', () => {
    expect(centerOf({ left: 5, top: 7, width: 0, height: 0 })).toEqual({ x: 5, y: 7 });
  });
});

describe('beamPath', () => {
  const from: Rect = { left: 0, top: 0, width: 10, height: 10 }; // centre (5, 5)

  it('computes a horizontal path (angle 0)', () => {
    const to: Rect = { left: 100, top: 0, width: 10, height: 10 }; // centre (105, 5)
    const p = beamPath(from, to);
    expect(p.x).toBe(5);
    expect(p.y).toBe(5);
    expect(p.length).toBeCloseTo(100, 6);
    expect(p.angleDeg).toBeCloseTo(0, 6);
  });

  it('computes a vertical (downward) path (angle 90)', () => {
    const to: Rect = { left: 0, top: 100, width: 10, height: 10 }; // centre (5, 105)
    const p = beamPath(from, to);
    expect(p.length).toBeCloseTo(100, 6);
    expect(p.angleDeg).toBeCloseTo(90, 6);
  });

  it('computes a diagonal path (angle 45, length 110√2)', () => {
    const d: Rect = { left: 0, top: 0, width: 20, height: 20 }; // centre (10, 10)
    const to: Rect = { left: 110, top: 110, width: 20, height: 20 }; // centre (120, 120)
    const p = beamPath(d, to);
    expect(p.x).toBe(10);
    expect(p.y).toBe(10);
    expect(p.length).toBeCloseTo(Math.hypot(110, 110), 6); // 155.563…
    expect(p.angleDeg).toBeCloseTo(45, 6);
  });

  it('guards a zero-length path (coincident centres → length 0, angle 0)', () => {
    const p = beamPath(from, { ...from });
    expect(p.length).toBe(0);
    expect(p.angleDeg).toBe(0);
    expect(p.x).toBe(5);
    expect(p.y).toBe(5);
    expect(Number.isNaN(p.angleDeg)).toBe(false);
  });
});

describe('polaroidTilt', () => {
  it('is deterministic for a given index', () => {
    for (const i of [0, 1, 3, 7, 42]) {
      expect(polaroidTilt(i)).toBe(polaroidTilt(i));
    }
  });

  it('stays within [-6, 6] degrees', () => {
    for (let i = 0; i < 40; i++) {
      const t = polaroidTilt(i);
      expect(t).toBeGreaterThanOrEqual(-6);
      expect(t).toBeLessThanOrEqual(6);
    }
  });

  it('never repeats between adjacent indices', () => {
    for (let i = 0; i < 40; i++) {
      expect(polaroidTilt(i)).not.toBe(polaroidTilt(i + 1));
    }
  });

  it('has a non-trivial magnitude (never dead flat)', () => {
    for (let i = 0; i < 40; i++) {
      expect(Math.abs(polaroidTilt(i))).toBeGreaterThanOrEqual(1.5);
    }
  });
});
