import { describe, expect, it } from 'vitest';
import { CARD_DESIGN_IDS, cardDesign } from './cardDesigns';
import { curtainPath, liveBaseOpacity, liveGateSvg, livePieces, livePose, LIVE_GATE_KINDS, shade } from './liveGates';

const translate = (s: string) => {
  const m = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(s);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};
const leftEdgeX = (d: string) => Number(/L(-?[\d.]+) 150/.exec(d)![1]);

describe('live gates', () => {
  it('only designs that declare one, and every kind is used', () => {
    const used = CARD_DESIGN_IDS.map((id) => cardDesign(id).live).filter(Boolean);
    expect([...new Set(used)].sort()).toEqual([...LIVE_GATE_KINDS].sort());
  });

  it('pieces are deterministic per seed', () => {
    for (const kind of LIVE_GATE_KINDS) expect(livePieces(kind, 'a')).toEqual(livePieces(kind, 'a'));
    expect(livePieces('balloons', 'a')).not.toEqual(livePieces('balloons', 'b'));
  });

  it('balloons: all held at t=0, let go from the middle out, and gone by the end', () => {
    const ps = livePieces('balloons');
    expect(ps.length).toBeGreaterThan(40);
    for (const p of ps) {
      const q = translate(livePose('balloons', p, 0, 0, 0, true).transform)!;
      expect(q.x).toBeCloseTo(p.x, 0);
      // At rest each balloon sits on its bob (a few px), never released.
      expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(3.06);
    }
    const centre = ps.reduce((a, b) => (a.dist < b.dist ? a : b));
    const edge = ps.reduce((a, b) => (a.dist > b.dist ? a : b));
    const lift = (p: (typeof ps)[number], t: number) => p.y - translate(livePose('balloons', p, t, 0, 0, true).transform)!.y;
    expect(lift(centre, 0.2)).toBeGreaterThan(lift(edge, 0.2));
    for (const p of ps) expect(translate(livePose('balloons', p, 0.62, 0, 0, true).transform)!.y).toBeLessThan(-300);
  });

  it('balloons: the wall behind fades as they let go', () => {
    expect(liveBaseOpacity('balloons', 0)).toBe(1);
    expect(liveBaseOpacity('balloons', 0.3)).toBe(0);
    expect(liveBaseOpacity('curtains', 0)).toBe(0);
  });

  it('curtains: closed meet in the middle, open gather to the sides, and mirror', () => {
    expect(leftEdgeX(curtainPath(0))).toBeGreaterThan(440);
    expect(leftEdgeX(curtainPath(1))).toBeLessThan(150);
    const l = curtainPath(0.4, 0, 'left');
    const r = curtainPath(0.4, 0, 'right');
    expect(900 - leftEdgeX(l)).toBeCloseTo(Number(/L(-?[\d.]+) 150/.exec(r)![1]), 0);
    // Only ever opens as t advances.
    let prev = Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const p = livePieces('curtains').find((x) => x.key === 'left')!;
      const x = leftEdgeX(livePose('curtains', p, t, 0, 0, true).d!);
      expect(x).toBeLessThanOrEqual(prev + 1e-6);
      prev = x;
    }
  });

  it('reduced motion stills the idle life', () => {
    const p = livePieces('balloons')[3];
    expect(livePose('balloons', p, 0, 0, 0, true)).toEqual(livePose('balloons', p, 0, 0, 5.3, true));
  });

  it('non-finite input is safe', () => {
    const p = livePieces('balloons')[0];
    expect(livePose('balloons', p, NaN, NaN, NaN).transform).not.toMatch(/NaN/);
    expect(curtainPath(NaN)).not.toMatch(/NaN/);
  });

  it('renders a whole SVG for the still and the film', () => {
    for (const kind of LIVE_GATE_KINDS) {
      const s = liveGateSvg(kind, 0);
      expect(s.startsWith('<svg')).toBe(true);
      expect(s).not.toMatch(/NaN|undefined/);
    }
    expect(shade('#808080', 0)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
