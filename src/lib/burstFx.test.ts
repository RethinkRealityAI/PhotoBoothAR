import { describe, it, expect } from 'vitest';
import { burstParticles, stepParticles, addParticles, FX_MAX_PARTICLES, FX_W, FX_H, type FxParticle } from './burstFx';

/** Deterministic rand (LCG) so shapes are reproducible. */
function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function simulate(list: FxParticle[], seconds: number, rand = seeded(7)): void {
  for (let t = 0; t < seconds; t += 1 / 60) addParticles(list, stepParticles(list, 1 / 60, rand));
}

describe('burstParticles', () => {
  it('every style is loud: dozens of particles, not a handful', () => {
    for (const style of ['confetti', 'hearts', 'sparkles', 'fireworks'] as const) {
      const n = burstParticles(style, seeded()).length;
      expect(n, style).toBeGreaterThanOrEqual(style === 'fireworks' ? 4 : 36);
    }
    expect(burstParticles('confetti', seeded()).length).toBeGreaterThanOrEqual(150);
  });

  it('confetti flies from the bottom corners across the frame', () => {
    const ps = burstParticles('confetti', seeded());
    expect(ps.some((p) => p.x < FX_W * 0.1 && p.vx > 0 && p.vy < 0)).toBe(true);
    expect(ps.some((p) => p.x > FX_W * 0.9 && p.vx < 0 && p.vy < 0)).toBe(true);
  });

  it('fireworks are rockets that climb and burst into shells (not sparkle)', () => {
    const list = burstParticles('fireworks', seeded());
    expect(list.every((p) => p.kind === 'rocket' && p.shell !== undefined && p.vy < 0)).toBe(true);
    expect(new Set(list.map((p) => p.delay)).size).toBe(list.length); // staggered fuses
    let peak = 0;
    let shells = 0;
    const rand = seeded(3);
    for (let t = 0; t < 2.5; t += 1 / 60) {
      const born = stepParticles(list, 1 / 60, rand);
      if (born.length) {
        shells += 1;
        // Each shell bursts in the upper part of the frame, as a ring of stars.
        expect(born[1].y).toBeLessThan(FX_H * 0.5);
        expect(born.filter((p) => p.kind === 'dot' && p.trail).length).toBeGreaterThanOrEqual(48);
      }
      addParticles(list, born);
      peak = Math.max(peak, list.length);
    }
    expect(shells).toBe(4);
    expect(peak).toBeGreaterThan(200);
    expect(peak).toBeLessThanOrEqual(FX_MAX_PARTICLES);
  });

  it('every burst dies out (the loop idles again)', () => {
    for (const style of ['confetti', 'hearts', 'sparkles', 'fireworks'] as const) {
      const list = burstParticles(style, seeded());
      simulate(list, 6);
      expect(list.length, style).toBe(0);
    }
  });

  it('the cap holds when bursts land on top of each other', () => {
    const list: FxParticle[] = [];
    for (let i = 0; i < 8; i++) addParticles(list, burstParticles('confetti', seeded(i)));
    expect(list.length).toBe(FX_MAX_PARTICLES);
  });
});
