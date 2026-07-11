import { describe, it, expect } from 'vitest';
import { snapTransform, nudgeTransform } from './snap';

const BASE = { scale: 1, x: 0, y: 0, rotation: 0 };

describe('snapTransform', () => {
  it('snaps x/y to centre (0) when within default threshold', () => {
    const { transform, guides } = snapTransform({ ...BASE, x: 1, y: -1.5 });
    expect(transform.x).toBe(0);
    expect(transform.y).toBe(0);
    expect(guides).toEqual({ v: 0, h: 0 });
  });

  it('does not snap when outside the threshold (guides null, value untouched)', () => {
    const { transform, guides } = snapTransform({ ...BASE, x: 10, y: -10 });
    expect(transform.x).toBe(10);
    expect(transform.y).toBe(-10);
    expect(guides).toEqual({ v: null, h: null });
  });

  it('snaps exactly on a line', () => {
    const { transform, guides } = snapTransform({ ...BASE, x: 25, y: -25 });
    expect(transform.x).toBe(25);
    expect(transform.y).toBe(-25);
    expect(guides).toEqual({ v: 25, h: -25 });
  });

  it('chooses the nearest line when multiple are in range with a wide threshold', () => {
    // 24 is 24 away from 0, 1 away from 25, -49 away from -25 — nearest is 25.
    const { transform, guides } = snapTransform({ ...BASE, x: 24, y: 0 }, { threshold: 30 });
    expect(transform.x).toBe(25);
    expect(guides.v).toBe(25);
  });

  it('never mutates the input transform', () => {
    const input = { ...BASE, x: 1, y: 1 };
    const frozen = { ...input };
    snapTransform(input);
    expect(input).toEqual(frozen);
  });

  it('supports custom threshold and lines', () => {
    const { transform, guides } = snapTransform({ ...BASE, x: 51, y: 0 }, { threshold: 1, lines: [50] });
    expect(transform.x).toBe(50);
    expect(guides.v).toBe(50);
    expect(guides.h).toBeNull(); // 0 not in custom lines list, so y untouched/free
    expect(transform.y).toBe(0);
  });

  it('respects a threshold of 0 (no snapping, even for near-exact values)', () => {
    const { transform, guides } = snapTransform({ ...BASE, x: 0.001 }, { threshold: 0 });
    expect(guides.v).toBeNull();
    expect(transform.x).toBe(0.001);
  });

  it('preserves scale/rotation', () => {
    const { transform } = snapTransform({ scale: 2, x: 0, y: 0, rotation: 45 });
    expect(transform.scale).toBe(2);
    expect(transform.rotation).toBe(45);
  });
});

describe('nudgeTransform', () => {
  it('moves by 0.5% per direction by default', () => {
    expect(nudgeTransform(BASE, 'ArrowUp').y).toBe(-0.5);
    expect(nudgeTransform(BASE, 'ArrowDown').y).toBe(0.5);
    expect(nudgeTransform(BASE, 'ArrowLeft').x).toBe(-0.5);
    expect(nudgeTransform(BASE, 'ArrowRight').x).toBe(0.5);
  });

  it('moves by 2% when big is true', () => {
    expect(nudgeTransform(BASE, 'ArrowUp', true).y).toBe(-2);
    expect(nudgeTransform(BASE, 'ArrowRight', true).x).toBe(2);
  });

  it('clamps to ±100', () => {
    expect(nudgeTransform({ ...BASE, x: 99.8 }, 'ArrowRight', true).x).toBe(100);
    expect(nudgeTransform({ ...BASE, y: -99.8 }, 'ArrowUp', true).y).toBe(-100);
    expect(nudgeTransform({ ...BASE, x: 100 }, 'ArrowRight').x).toBe(100);
    expect(nudgeTransform({ ...BASE, x: -100 }, 'ArrowLeft').x).toBe(-100);
  });

  it('never mutates the input transform', () => {
    const input = { ...BASE, x: 1, y: 1 };
    const frozen = { ...input };
    nudgeTransform(input, 'ArrowUp');
    expect(input).toEqual(frozen);
  });

  it('leaves the other axis and scale/rotation untouched', () => {
    const t = nudgeTransform({ scale: 3, x: 5, y: 5, rotation: 10 }, 'ArrowRight');
    expect(t.y).toBe(5);
    expect(t.scale).toBe(3);
    expect(t.rotation).toBe(10);
  });
});
