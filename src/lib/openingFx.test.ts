import { describe, expect, it } from 'vitest';
import { CARD_DESIGN_IDS, cardDesign } from './cardDesigns';
import {
  burnAt,
  burnEdge,
  burnLevel,
  BURN_S,
  DESIGN_DISSOLVE,
  shatterPose,
  shatterTiles,
  SHATTER_COLS,
  SHATTER_LIFE_S,
  SHATTER_ROWS,
  SHATTER_SPREAD_S,
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

describe('gate dissolves', () => {
  it('only names real designs, and each style has what it needs', () => {
    for (const [id, d] of Object.entries(DESIGN_DISSOLVE)) {
      expect(CARD_DESIGN_IDS as readonly string[]).toContain(id);
      if (d!.style === 'shatter') expect(FX_KINDS).toContain(d!.into);
      if (d!.style === 'burn') expect(d!.edge).toMatch(HEX);
    }
  });

  it('dissolves only gates that do not need the finger to move them (no trace or pull designs)', () => {
    for (const id of Object.keys(DESIGN_DISSOLVE)) {
      const kind = cardDesign(id as (typeof CARD_DESIGN_IDS)[number]).gateway.kind;
      expect(['doors', 'rise']).toContain(kind);
    }
  });

  it('shatter: whole at first, breaks from the middle out, gone by the end', () => {
    const tiles = shatterTiles('s');
    expect(tiles).toHaveLength(SHATTER_COLS * SHATTER_ROWS);
    for (const t of tiles) expect(shatterPose(t, 0)).toEqual({ dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1, morph: 0 });
    const centre = tiles.reduce((a, b) => (Math.hypot(a.cx - 0.5, a.cy - 0.475) < Math.hypot(b.cx - 0.5, b.cy - 0.475) ? a : b));
    const corner = tiles[0];
    expect(centre.delay).toBeLessThan(corner.delay);
    for (const t of tiles) expect(shatterPose(t, SHATTER_SPREAD_S + SHATTER_LIFE_S + 0.01)).toBeNull();
    expect(SHATTER_SPREAD_S + SHATTER_LIFE_S).toBeLessThanOrEqual(FX_DURATION_S);
  });

  it('shatter: pieces fly outward from the gateway centre', () => {
    for (const t of shatterTiles('s').filter((x) => Math.abs(x.cx - 0.5) > 0.2)) {
      const q = shatterPose(t, t.delay + 0.5)!;
      expect(Math.sign(q.dx)).toBe(Math.sign(t.cx - 0.5));
    }
  });

  it('burn: starts whole, ends clear, never un-burns, and glows only at the edge', () => {
    for (let r = 0; r < MELT_ROWS; r += 4) {
      for (let c = 0; c < MELT_COLS; c += 4) {
        const at = burnAt(c, r, 3);
        expect(burnLevel(at, 0)).toBe(1);
        expect(burnLevel(at, BURN_S)).toBe(0);
        let prev = 1;
        for (let s = 0; s <= BURN_S; s += 0.05) {
          const l = burnLevel(at, s);
          expect(l).toBeLessThanOrEqual(prev + 1e-9);
          prev = l;
        }
      }
    }
    expect(burnEdge(0)).toBe(0);
    expect(burnEdge(1)).toBe(0);
    expect(burnEdge(0.3)).toBeGreaterThan(0.5);
  });
});
