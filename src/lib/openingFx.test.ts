import { describe, expect, it } from 'vitest';
import { CARD_DESIGN_IDS } from './cardDesigns';
import {
  DESIGN_FX,
  frostAt,
  fxParticles,
  fxPose,
  FX_DURATION_S,
  FX_KINDS,
  MELT_COLS,
  MELT_ROWS,
  MELT_S,
} from './openingFx';

const HEX = /^#[0-9A-F]{6}$/i;

describe('every design has its own flourish', () => {
  it('covers exactly the design library', () => {
    expect(Object.keys(DESIGN_FX).sort()).toEqual([...CARD_DESIGN_IDS].sort());
  });

  for (const id of CARD_DESIGN_IDS) {
    it(`${id}: known kinds and real colours`, () => {
      const fx = DESIGN_FX[id];
      expect(FX_KINDS).toContain(fx.kind);
      if (fx.also) {
        expect(FX_KINDS).toContain(fx.also);
        expect(fx.also).not.toBe(fx.kind);
      }
      expect(fx.colors.length).toBeGreaterThanOrEqual(2);
      for (const c of fx.colors) expect(c).toMatch(HEX);
    });
  }

  it('the themed ones Dapo asked for are themed', () => {
    expect(DESIGN_FX['garden-gate'].kind).toBe('petals');
    expect(DESIGN_FX['winter-glow'].kind).toBe('melt');
    expect(DESIGN_FX['love-notes'].kind).toBe('hearts');
  });
});

describe('fxParticles', () => {
  it('is deterministic per seed and different across seeds', () => {
    const a = fxParticles('petals', 'abc');
    expect(fxParticles('petals', 'abc')).toEqual(a);
    expect(fxParticles('petals', 'abd')).not.toEqual(a);
  });

  it('reduced motion keeps only the kinds where nothing flies', () => {
    for (const kind of FX_KINDS) {
      const n = fxParticles(kind, 's', true).length;
      if (kind === 'melt' || kind === 'golddust') expect(n).toBeGreaterThan(0);
      else expect(n).toBe(0);
    }
  });

  it('a secondary layer is thinner, and colour indexes stay in range', () => {
    expect(fxParticles('petals', 's', false, 0.4).length).toBeLessThan(fxParticles('petals', 's').length);
    for (const p of fxParticles('confetti', 's', false, 1, 3)) {
      expect(p.color).toBeGreaterThanOrEqual(0);
      expect(p.color).toBeLessThan(3);
    }
  });
});

describe('fxPose', () => {
  for (const kind of FX_KINDS) {
    it(`${kind}: finite poses while alive, nothing before it starts or after the flourish`, () => {
      const parts = fxParticles(kind, 'seed');
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) {
        expect(fxPose(kind, p, p.delay - 0.01)).toBeNull();
        expect(p.delay + p.life).toBeLessThanOrEqual(FX_DURATION_S + 1e-9);
        expect(fxPose(kind, p, FX_DURATION_S + 0.01)).toBeNull();
        for (let s = p.delay; s <= p.delay + p.life; s += 0.1) {
          const q = fxPose(kind, p, s);
          if (!q) continue;
          for (const v of [q.x, q.y, q.rot, q.scale, q.alpha, q.heading]) expect(Number.isFinite(v)).toBe(true);
          expect(q.alpha).toBeGreaterThanOrEqual(0);
          expect(q.alpha).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  it('petals burst out of the gateway and fall', () => {
    const parts = fxParticles('petals', 'seed');
    const spread = (s: number) =>
      parts.reduce((m, p) => {
        const q = fxPose('petals', p, p.delay + s);
        return q ? Math.max(m, Math.hypot(q.x - 0.5, q.y - 0.475)) : m;
      }, 0);
    expect(spread(0.8)).toBeGreaterThan(spread(0.05));
    const p = parts[0];
    const early = fxPose('petals', p, p.delay + 0.6)!;
    const late = fxPose('petals', p, p.delay + p.life - 0.05)!;
    expect(late.y).toBeGreaterThan(early.y - 0.05);
  });

  it('lanterns rise', () => {
    const p = fxParticles('lanterns', 'seed')[0];
    const a = fxPose('lanterns', p, p.delay + 0.6)!;
    const b = fxPose('lanterns', p, p.delay + 2.5)!;
    expect(b.y).toBeLessThan(a.y);
  });

  it('rejects non-finite time', () => {
    const p = fxParticles('confetti', 'seed')[0];
    expect(fxPose('confetti', p, NaN)).toBeNull();
  });
});

describe('frost melt', () => {
  const cells = () => {
    const out: Array<[number, number]> = [];
    for (let r = 0; r < MELT_ROWS; r += 3) for (let c = 0; c < MELT_COLS; c += 3) out.push([c, r]);
    return out;
  };
  const left = (s: number) => cells().reduce((m, [c, r]) => m + frostAt(c, r, s, 7), 0) / cells().length;

  it('starts fully frosted and ends clear', () => {
    expect(left(0)).toBe(1);
    expect(left(MELT_S)).toBe(0);
  });

  it('only ever melts (never refreezes)', () => {
    for (const [c, r] of cells()) {
      let prev = 1;
      for (let s = 0; s <= MELT_S; s += 0.05) {
        const f = frostAt(c, r, s, 7);
        expect(f).toBeLessThanOrEqual(prev + 1e-9);
        prev = f;
      }
    }
  });

  it('clears from the middle outwards', () => {
    const mid = frostAt(Math.floor(MELT_COLS / 2), Math.floor(MELT_ROWS * 0.475), MELT_S * 0.45, 7);
    const corner = frostAt(0, 0, MELT_S * 0.45, 7);
    expect(mid).toBeLessThan(corner);
  });
});
