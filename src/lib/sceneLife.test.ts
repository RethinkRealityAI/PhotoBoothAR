import { describe, expect, it } from 'vitest';
import { CARD_DESIGN_IDS } from './cardDesigns';
import { DESIGN_LIFE, designLife, lifePose, type LifeKind, type LifeProp } from './sceneLife';

const KINDS: LifeKind[] = ['bird', 'hotair', 'balloon', 'cloud', 'glint', 'flicker', 'shootingStar', 'firework', 'cap', 'smoke', 'rays', 'shimmer'];
const finite = (p: ReturnType<typeof lifePose>) =>
  [p.x, p.y, p.rot, p.scale, p.opacity, p.flap, p.grow].every(Number.isFinite);

describe('sceneLife — the moving pieces of each design', () => {
  it('gives every design at least two living pieces', () => {
    for (const id of CARD_DESIGN_IDS) expect(designLife(id).length, id).toBeGreaterThanOrEqual(2);
    expect(Object.keys(DESIGN_LIFE).sort()).toEqual([...CARD_DESIGN_IDS].sort());
  });

  it('returns a finite pose with opacity in 0..1 for every kind, at any time, even on junk input', () => {
    for (const kind of KINDS) {
      const prop: LifeProp = { kind, x: 400, y: 600 };
      for (const t of [0, 0.37, 1, 3.3, 12.9, 61, 1e6, -5, Number.NaN]) {
        for (const rm of [false, true]) {
          const p = lifePose(prop, t, rm);
          expect(finite(p), `${kind}@${t}`).toBe(true);
          expect(p.opacity).toBeGreaterThanOrEqual(0);
          expect(p.opacity).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is deterministic: the card and the film see the same piece in the same place', () => {
    for (const id of CARD_DESIGN_IDS) {
      for (const prop of designLife(id)) expect(lifePose(prop, 4.2)).toEqual(lifePose(prop, 4.2));
    }
  });

  it('keeps moving under reduced motion, just less', () => {
    const bird: LifeProp = { kind: 'bird', x: 0, y: 300 };
    const full = Math.abs(lifePose(bird, 3).x - lifePose(bird, 0).x);
    const soft = Math.abs(lifePose(bird, 3, true).x - lifePose(bird, 0, true).x);
    expect(soft).toBeGreaterThan(0);
    expect(soft).toBeLessThan(full);
  });

  it('lets fireworks and shooting stars go dark between bursts', () => {
    const fw: LifeProp = { kind: 'firework', x: 0, y: 0, period: 4 };
    const star: LifeProp = { kind: 'shootingStar', x: 0, y: 0, period: 10 };
    expect(lifePose(fw, 3.5).opacity).toBe(0);
    expect(lifePose(star, 5).opacity).toBe(0);
    expect(lifePose(fw, 0.6).opacity).toBeGreaterThan(0.5);
  });
});
