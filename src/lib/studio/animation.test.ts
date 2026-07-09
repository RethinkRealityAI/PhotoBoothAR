import { describe, it, expect } from 'vitest';
import { animateTransform2D, animate3D } from './animation';
import type { Transform2D } from '../../types';

const BASE: Transform2D = { scale: 1, x: 5, y: -3, rotation: 12 };

describe('animateTransform2D', () => {
  it('none returns the base unchanged (same reference)', () => {
    const result = animateTransform2D(BASE, 'none', 4.2);
    expect(result).toBe(BASE);
  });

  it('float bobs y within ~1.2% amplitude and is zero at t=0', () => {
    expect(animateTransform2D(BASE, 'float', 0).y).toBeCloseTo(BASE.y, 6);
    for (let t = 0; t <= 4; t += 0.1) {
      const r = animateTransform2D(BASE, 'float', t);
      expect(Math.abs(r.y - BASE.y)).toBeLessThanOrEqual(1.2 + 1e-9);
      // Only y should move; other fields carry through unchanged.
      expect(r.x).toBe(BASE.x);
      expect(r.scale).toBe(BASE.scale);
      expect(r.rotation).toBe(BASE.rotation);
    }
  });

  it('float period sanity: peaks at quarter period of 0.5Hz (t=0.5s)', () => {
    const r = animateTransform2D(BASE, 'float', 0.5);
    expect(r.y).toBeCloseTo(BASE.y + 1.2, 6);
  });

  it('pulse scales within ±4% and is base at t=0', () => {
    expect(animateTransform2D(BASE, 'pulse', 0).scale).toBeCloseTo(BASE.scale, 6);
    for (let t = 0; t <= 4; t += 0.1) {
      const r = animateTransform2D(BASE, 'pulse', t);
      expect(r.scale).toBeGreaterThanOrEqual(BASE.scale * 0.96 - 1e-9);
      expect(r.scale).toBeLessThanOrEqual(BASE.scale * 1.04 + 1e-9);
    }
  });

  it('pulse period sanity: peaks at quarter period of 0.8Hz (t=0.3125s)', () => {
    const r = animateTransform2D(BASE, 'pulse', 0.3125);
    expect(r.scale).toBeCloseTo(BASE.scale * 1.04, 6);
  });

  it('spin rotates at 20deg/s and wraps into [-180, 180]', () => {
    expect(animateTransform2D(BASE, 'spin', 0).rotation).toBeCloseTo(BASE.rotation, 6);
    const r1 = animateTransform2D(BASE, 'spin', 1);
    expect(r1.rotation).toBeCloseTo(BASE.rotation + 20, 6);

    // BASE.rotation=12, raw at t=9 -> 12 + 180 = 192 -> wraps to -168.
    const r9 = animateTransform2D(BASE, 'spin', 9);
    expect(r9.rotation).toBeCloseTo(-168, 6);

    for (let t = 0; t <= 20; t += 0.25) {
      const r = animateTransform2D(BASE, 'spin', t);
      expect(r.rotation).toBeGreaterThanOrEqual(-180 - 1e-9);
      expect(r.rotation).toBeLessThanOrEqual(180 + 1e-9);
    }
  });
});

describe('animate3D', () => {
  it('none is the identity transform', () => {
    const r = animate3D('none', 3.7);
    expect(r.position).toEqual([0, 0, 0]);
    expect(r.rotationY).toBe(0);
    expect(r.scaleMul).toBe(1);
  });

  it('float bobs y within ±0.6cm and is zero at t=0', () => {
    expect(animate3D('float', 0).position[1]).toBeCloseTo(0, 6);
    for (let t = 0; t <= 4; t += 0.1) {
      const r = animate3D('float', t);
      expect(Math.abs(r.position[1])).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(r.position[0]).toBe(0);
      expect(r.position[2]).toBe(0);
      expect(r.rotationY).toBe(0);
      expect(r.scaleMul).toBe(1);
    }
  });

  it('float period sanity: peaks at quarter period of 0.5Hz (t=0.5s)', () => {
    expect(animate3D('float', 0.5).position[1]).toBeCloseTo(0.6, 6);
  });

  it('pulse scaleMul within ±4% and is 1 at t=0', () => {
    expect(animate3D('pulse', 0).scaleMul).toBeCloseTo(1, 6);
    for (let t = 0; t <= 4; t += 0.1) {
      const r = animate3D('pulse', t);
      expect(r.scaleMul).toBeGreaterThanOrEqual(0.96 - 1e-9);
      expect(r.scaleMul).toBeLessThanOrEqual(1.04 + 1e-9);
    }
  });

  it('spin rotates rotationY at 0.6 rad/s, unbounded/linear', () => {
    expect(animate3D('spin', 0).rotationY).toBe(0);
    expect(animate3D('spin', 2).rotationY).toBeCloseTo(1.2, 6);
    expect(animate3D('spin', 10).rotationY).toBeCloseTo(6, 6);
  });
});
