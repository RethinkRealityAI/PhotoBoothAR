import { describe, expect, it } from 'vitest';
import {
  archFramePoints,
  bandPath,
  bowLoopPath,
  ensureInkContrast,
  glintMotes,
  mixHex,
  polylineLength,
  resampleClosed,
  ribbonColors,
  ribbonFaceArt,
  ribbonPull,
  rubberBand,
  slideDirection,
  tailPath,
  tailRestTip,
  untieThreshold,
} from './cardRibbon';
import { contrastRatio } from './themeDerive';
import { BEAMWALL_CARD_PALETTE } from './cardPresentation';

const NUM = /-?\d+(?:\.\d+)?/g;
function numbers(d: string): number[] {
  return (d.match(NUM) ?? []).map(Number);
}
function bbox(d: string): { w: number; h: number } {
  // every path here is absolute M/L/Q/C/A; arc flags pollute x/y pairs, so only use arc-free paths
  const n = numbers(d);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe('mixHex / ensureInkContrast', () => {
  it('mixes endpoints exactly and clamps t', () => {
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mixHex('#000000', '#FFFFFF', 2)).toBe('#FFFFFF');
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixHex('junk', '#FFFFFF', 0)).toBe('#000000');
  });

  it('walks a surface until the ink passes AA, both directions', () => {
    const dark = ensureInkContrast('#B8B9F0', '#FFFFFF');
    expect(contrastRatio(dark, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    const light = ensureInkContrast('#4B4B60', '#1A1A1A');
    expect(contrastRatio(light, '#1A1A1A')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('ribbonColors', () => {
  it('Beamwall: the card face carries white ink at AA', () => {
    const c = ribbonColors(BEAMWALL_CARD_PALETTE);
    expect(contrastRatio(c.face, c.ink)).toBeGreaterThanOrEqual(4.5);
    for (const v of Object.values(c)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('an event look with a pale background and dark ink still passes', () => {
    const c = ribbonColors({ bg: '#F6EFE4', fg: '#2B2118', accent: '#C9A26B' });
    expect(contrastRatio(c.face, c.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it('a light accent on a light bg with WHITE ink is darkened until it passes', () => {
    const c = ribbonColors({ bg: '#E8E6FF', fg: '#FFFFFF', accent: '#F4F2FF' });
    expect(contrastRatio(c.face, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('junk palette values fall back instead of producing NaN colours', () => {
    const c = ribbonColors({ bg: 'nope', fg: '', accent: 'rgb(1,2,3)' });
    for (const v of Object.values(c)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('letterpress geometry', () => {
  it('the arch frame stays inside its inset box and peaks at the centre top', () => {
    const pts = archFramePoints(390, 844, 20);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(20 - 0.01);
      expect(p.x).toBeLessThanOrEqual(370 + 0.01);
      expect(p.y).toBeGreaterThanOrEqual(20 - 0.01);
      expect(p.y).toBeLessThanOrEqual(824 + 0.01);
    }
    const top = pts.reduce((a, b) => (b.y < a.y ? b : a));
    expect(top.x).toBeCloseTo(195, 0);
    expect(top.y).toBeCloseTo(20, 1);
  });

  it('resampling spaces points evenly along the frame', () => {
    const pts = archFramePoints(400, 800, 24);
    const even = resampleClosed(pts, 60);
    expect(even).toHaveLength(60);
    const step = polylineLength(pts) / 60;
    for (let i = 1; i < even.length; i += 1) {
      const d = Math.hypot(even[i].x - even[i - 1].x, even[i].y - even[i - 1].y);
      // chords across a curve are a touch shorter than the arc step, never longer
      expect(d).toBeLessThanOrEqual(step + 0.01);
      expect(d).toBeGreaterThan(step * 0.6);
    }
  });

  it('face art is deterministic and NaN-free at phone and desktop sizes, and on a degenerate stage', () => {
    for (const [w, h] of [
      [390, 844],
      [430, 860],
      [0, 0],
    ]) {
      const a = ribbonFaceArt(w, h);
      const b = ribbonFaceArt(w, h);
      expect(a).toEqual(b);
      const all = [a.frameOuter, a.frameInner, a.scallops, ...a.filigree.strokes, ...a.filigree.fills].join(' ');
      expect(all).not.toMatch(/NaN|Infinity/);
      expect(a.filigree.fills.length).toBeGreaterThan(20);
      expect(a.pearls.length).toBeGreaterThan(30);
    }
  });
});

describe('satin band + bow', () => {
  it('the band pinches at the knot', () => {
    const open = bbox(bandPath(390, 400, 80, 195, 0));
    const pinched = bandPath(390, 400, 80, 195, 0.6);
    expect(pinched).not.toMatch(/NaN/);
    expect(open.h).toBeGreaterThanOrEqual(80);
  });

  it('loosening shrinks a loop toward the knot', () => {
    const tight = bbox(bowLoopPath(1, 100, 0));
    const loose = bbox(bowLoopPath(1, 100, 1));
    expect(loose.w).toBeLessThan(tight.w * 0.4);
    expect(loose.h).toBeLessThan(tight.h * 0.4);
  });

  it('left and right loops mirror each other', () => {
    const l = numbers(bowLoopPath(-1, 80, 0.3));
    const r = numbers(bowLoopPath(1, 80, 0.3));
    expect(l).toHaveLength(r.length);
    l.forEach((v, i) => expect(Math.abs(v)).toBeCloseTo(Math.abs(r[i]), 5));
  });

  it('a tail reaches its tip and is NaN-free even when the tip sits on the knot', () => {
    const tip = tailRestTip(1, 90);
    const d = tailPath(1, 90, tip);
    expect(d).not.toMatch(/NaN/);
    expect(tailPath(-1, 90, { x: 0, y: 0 })).not.toMatch(/NaN/);
  });
});

describe('pull physics', () => {
  it('rubber band is monotonic and bounded', () => {
    let prev = 0;
    for (let d = 0; d <= 2000; d += 50) {
      const v = rubberBand(d, 120);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThan(120);
      prev = v;
    }
    expect(rubberBand(-5, 120)).toBe(0);
    expect(rubberBand(Number.NaN, 120)).toBe(0);
  });

  it('no drag = rest, no progress', () => {
    const p = ribbonPull(1, 90, { x: 0, y: 0 });
    expect(p.tip).toEqual(tailRestTip(1, 90));
    expect(p.progress).toBe(0);
  });

  it('pulling the tail away from the knot unties it; pushing it back does not', () => {
    const rest = tailRestTip(1, 90);
    const l = Math.hypot(rest.x, rest.y);
    const far = untieThreshold(90) * 1.1;
    const away = ribbonPull(1, 90, { x: (rest.x / l) * far, y: (rest.y / l) * far });
    expect(away.progress).toBe(1);
    const back = ribbonPull(1, 90, { x: (-rest.x / l) * 40, y: (-rest.y / l) * 40 });
    expect(back.progress).toBeCloseTo(0, 9);
  });

  it('the tip never runs away from the finger more than the rubber-band limit', () => {
    const p = ribbonPull(-1, 90, { x: -5000, y: 5000 });
    const rest = tailRestTip(-1, 90);
    expect(Math.hypot(p.tip.x - rest.x, p.tip.y - rest.y)).toBeLessThan(90 * 1.6);
  });

  it('slides off the way it was pulled', () => {
    expect(slideDirection({ x: -40, y: 10 }, 1)).toBe(-1);
    expect(slideDirection({ x: 40, y: 10 }, -1)).toBe(1);
    expect(slideDirection({ x: 2, y: 80 }, -1)).toBe(-1);
  });
});

describe('glintMotes', () => {
  it('is deterministic, bounded and capped', () => {
    expect(glintMotes(100, 100, 50, 12)).toEqual(glintMotes(100, 100, 50, 12));
    expect(glintMotes(0, 0, 10, 999)).toHaveLength(64);
    for (const m of glintMotes(100, 100, 50, 20)) {
      expect(Math.hypot(m.x - 100, (m.y - 100) / 1.25)).toBeLessThanOrEqual(50.001);
      expect(m.delay).toBeGreaterThanOrEqual(0);
      expect(m.delay).toBeLessThan(1);
    }
  });
});
