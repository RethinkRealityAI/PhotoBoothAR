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

import { layerMotion2D, introFieldsOf, introDone, INTRO_MS, INTRO_DELAY_MAX_MS } from './animation';

describe('layerMotion2D (animated Frames)', () => {
  const DONE = Number.POSITIVE_INFINITY;

  it('a plain layer has no motion at all', () => {
    expect(layerMotion2D({}, 3.3, DONE)).toEqual({ dx: 0, dy: 0, rotDeg: 0, scale: 1, alpha: 1 });
  });

  it('matches the old float/pulse/spin exactly once the entrance is over', () => {
    for (const t of [0, 0.31, 0.5, 1.7, 4]) {
      const f = layerMotion2D({ animation: 'float' }, t, DONE);
      expect(BASE.y + f.dy).toBeCloseTo(animateTransform2D(BASE, 'float', t).y, 9);
      const p = layerMotion2D({ animation: 'pulse' }, t, DONE);
      expect(BASE.scale * p.scale).toBeCloseTo(animateTransform2D(BASE, 'pulse', t).scale, 9);
      const s = layerMotion2D({ animation: 'spin' }, t, DONE);
      const deg = ((BASE.rotation + s.rotDeg + 180) % 360 + 360) % 360 - 180;
      expect(Math.abs(deg - animateTransform2D(BASE, 'spin', t).rotation) % 360).toBeCloseTo(0, 6);
    }
  });

  it('is invisible before its stagger, then lands exactly on rest', () => {
    const spec = { intro: 'bloom' as const, introDelayMs: 300 };
    expect(layerMotion2D(spec, 0, 100).alpha).toBe(0);
    const mid = layerMotion2D(spec, 0, 300 + INTRO_MS / 3);
    expect(mid.alpha).toBeGreaterThan(0);
    expect(mid.scale).not.toBe(1);
    expect(layerMotion2D(spec, 0, 300 + INTRO_MS)).toEqual({ dx: 0, dy: 0, rotDeg: 0, scale: 1, alpha: 1 });
    expect(introDone(spec, 300 + INTRO_MS)).toBe(true);
    expect(introDone(spec, 300 + INTRO_MS - 1)).toBe(false);
  });

  it('every entrance starts away from rest and ends at rest', () => {
    for (const intro of ['fade', 'rise', 'drop', 'bloom', 'slideLeft', 'slideRight', 'spinIn'] as const) {
      const early = layerMotion2D({ intro }, 0, INTRO_MS * 0.1);
      const moved = early.alpha < 1 || early.dx !== 0 || early.dy !== 0 || early.rotDeg !== 0 || early.scale !== 1;
      expect(moved).toBe(true);
      expect(layerMotion2D({ intro }, 0, INTRO_MS)).toEqual({ dx: 0, dy: 0, rotDeg: 0, scale: 1, alpha: 1 });
    }
  });

  it('idle presets stay subtle', () => {
    for (let t = 0; t < 6; t += 0.05) {
      expect(Math.abs(layerMotion2D({ animation: 'sway' }, t, DONE).rotDeg)).toBeLessThanOrEqual(3 + 1e-9);
      expect(Math.abs(layerMotion2D({ animation: 'drift' }, t, DONE).dx)).toBeLessThanOrEqual(1.5 + 1e-9);
      const a = layerMotion2D({ animation: 'twinkle' }, t, DONE).alpha;
      expect(a).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('the idle loop fades in during the entrance (no jump at hand-over)', () => {
    const atStart = layerMotion2D({ intro: 'fade', animation: 'float' }, 0.5, 1);
    expect(Math.abs(atStart.dy)).toBeLessThan(0.01);
  });
});

describe('introFieldsOf', () => {
  it('keeps only valid, non-default keys', () => {
    expect(introFieldsOf({})).toEqual({});
    expect(introFieldsOf(null)).toEqual({});
    expect(introFieldsOf({ intro: 'nope', introDelayMs: 200 })).toEqual({});
    expect(introFieldsOf({ intro: 'rise', introDelayMs: 0, pivot: { x: 0.5, y: 0.5 } })).toEqual({ intro: 'rise' });
    expect(introFieldsOf({ intro: 'rise', introDelayMs: 99999, pivot: { x: 2, y: -1 } }))
      .toEqual({ intro: 'rise', introDelayMs: INTRO_DELAY_MAX_MS, pivot: { x: 1, y: 0 } });
    expect(introFieldsOf({ pivot: { x: 0.2, y: 'a' } })).toEqual({});
  });
});
