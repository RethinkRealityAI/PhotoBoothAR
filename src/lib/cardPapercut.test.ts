import { describe, expect, it } from 'vitest';
import {
  cloudPath,
  DESIGN_W,
  OVERHANG,
  followStep,
  hashSeed,
  moonPath,
  papercutConfetti,
  papercutPalette,
  papercutScene,
  starPath,
  tiltToParallax,
} from './cardPapercut';
import { BEAMWALL_CARD_PALETTE } from './cardPresentation';

const PAL = BEAMWALL_CARD_PALETTE;
const BAD = /NaN|Infinity|undefined/;

describe('hashSeed', () => {
  it('is stable and spreads nearby titles apart', () => {
    expect(hashSeed('Happy birthday, Dapo!')).toBe(hashSeed('Happy birthday, Dapo!'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
    expect(hashSeed('')).toBe(0x811c9dc5);
  });
});

describe('papercutPalette', () => {
  it('derives valid colours from the card palette and junk alike', () => {
    for (const p of [PAL, { bg: '#F6EFE4', accent: '#C9A26B' }, { bg: 'x', accent: '' }]) {
      const c = papercutPalette(p);
      const flat = [c.skyTop, c.skyLow, ...c.hills, c.grass, c.tree, c.paper, c.paperShade, c.gold, c.peach, c.lilac, ...c.festive];
      for (const v of flat) expect(v).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('hills get lighter toward the viewer (cut paper reads as depth)', () => {
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    const { hills } = papercutPalette(PAL);
    expect(lum(hills[0])).toBeLessThan(lum(hills[1]));
    expect(lum(hills[1])).toBeLessThan(lum(hills[2]));
  });
});

describe('shape primitives', () => {
  it('star has 2n vertices and a closed path', () => {
    const d = starPath(0, 0, 10, 0, 5);
    expect((d.match(/[ML]/g) ?? []).length).toBe(10);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('cloud and moon paths are finite', () => {
    expect(cloudPath(200, 90, [1, 1.2, 0.9])).not.toMatch(BAD);
    expect(cloudPath(0, 0, [])).not.toMatch(BAD);
    expect(moonPath(50, 50, 40)).not.toMatch(BAD);
  });
});

describe('papercutScene', () => {
  it('is deterministic for a title and differs between titles', () => {
    const a = papercutScene('Happy birthday, Dapo!', 844 / 390, PAL);
    const b = papercutScene('Happy birthday, Dapo!', 844 / 390, PAL);
    const c = papercutScene('Congratulations, Maya', 844 / 390, PAL);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('has 5-7+ depth layers, sorted back to front, every path finite', () => {
    const s = papercutScene('t', 2.16, PAL);
    const depths = new Set(s.pieces.map((p) => p.depth));
    expect(depths.size).toBeGreaterThanOrEqual(6);
    const kinds = new Set(s.pieces.map((p) => p.kind));
    for (const k of ['stars', 'hill', 'cloud', 'balloon', 'bunting', 'grass']) expect(kinds.has(k as never)).toBe(true);
    for (const p of s.pieces) {
      expect(Number.isFinite(p.x + p.y + p.w + p.h)).toBe(true);
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
      for (const sh of p.shapes) expect(sh.d).not.toMatch(BAD);
    }
    // hills ordered far → near
    const hills = s.pieces.filter((p) => p.kind === 'hill');
    expect(hills.map((h) => h.depth)).toEqual([...hills.map((h) => h.depth)].sort((x, y) => x - y));
  });

  it('pieces stay inside the stage horizontally (bar the paper overhang) and hills run past the bottom', () => {
    const s = papercutScene('overhang', 2, PAL);
    for (const p of s.pieces) {
      if (p.kind === 'cloud') continue; // clouds may peek in from the edge
      expect(p.x).toBeGreaterThanOrEqual(-OVERHANG);
      expect(p.x + p.w).toBeLessThanOrEqual(DESIGN_W + OVERHANG);
    }
    for (const h of s.pieces.filter((p) => p.kind === 'hill' || p.kind === 'grass')) {
      expect(h.y + h.h).toBeGreaterThan(s.height);
      // parallax (≈25 px) + pop-up swell must never expose a cut side edge
      expect(h.x).toBeLessThanOrEqual(-OVERHANG);
      expect(h.x + h.w).toBeGreaterThanOrEqual(DESIGN_W + OVERHANG);
    }
  });

  it('every piece leaves the stage when the pop-up opens', () => {
    const s = papercutScene('exit', 2.16, PAL);
    for (const p of s.pieces) {
      if (p.kind === 'stars') continue; // the sky fades rather than leaves
      const nx = p.x + p.exit.x;
      const ny = p.y + p.exit.y;
      const gone = nx + p.w < 0 || nx > DESIGN_W || ny + p.h < 0 || ny > s.height;
      expect({ id: p.id, gone }).toEqual({ id: p.id, gone: true });
    }
  });

  it('clamps silly aspects instead of producing a degenerate stage', () => {
    expect(papercutScene('x', Number.NaN, PAL).height).toBe(2000);
    expect(papercutScene('x', 50, PAL).height).toBe(2600);
    expect(papercutScene('x', 0.1, PAL).height).toBe(900);
  });

  it('an empty title still makes a scene', () => {
    expect(papercutScene('', 2, PAL).pieces.length).toBeGreaterThan(8);
  });
});

describe('papercutConfetti', () => {
  it('is deterministic, capped and uses the given colours', () => {
    const a = papercutConfetti('t', 30, ['#111111', '#222222'], 200);
    expect(a).toEqual(papercutConfetti('t', 30, ['#111111', '#222222'], 200));
    expect(a).toHaveLength(30);
    expect(papercutConfetti('t', 999, ['#111111'], 200)).toHaveLength(80);
    expect(papercutConfetti('t', Number.NaN, ['#111111'], 200)).toHaveLength(0);
    for (const c of a) {
      expect(['#111111', '#222222']).toContain(c.color);
      expect(Math.hypot(c.dx, c.dy)).toBeLessThanOrEqual(200.001);
      expect(c.size).toBeGreaterThanOrEqual(7);
    }
  });

  it('bursts mostly upward', () => {
    const up = papercutConfetti('up', 60, ['#fff'], 100).filter((c) => c.dy < 0).length;
    expect(up).toBeGreaterThan(40);
  });
});

describe('parallax helpers', () => {
  it('followStep converges, never overshoots, and is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 10; i += 1) a = followStep(a, 1, 16);
    let b = 0;
    for (let i = 0; i < 5; i += 1) b = followStep(b, 1, 32);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeLessThan(1);
    expect(followStep(0, 1, 100000, 140)).toBeLessThanOrEqual(1);
    expect(followStep(Number.NaN, 1, 16)).toBe(0);
  });

  it('tilt maps the held-phone pose to neutral and clamps', () => {
    expect(tiltToParallax(45, 0)).toEqual({ x: 0, y: 0 });
    expect(tiltToParallax(null, null)).toEqual({ x: 0, y: 0 });
    expect(tiltToParallax(170, 90)).toEqual({ x: 1, y: 1 });
    expect(tiltToParallax(-90, -90)).toEqual({ x: -1, y: -1 });
  });
});
