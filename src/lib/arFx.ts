/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * arFx — the AR step's effects as pure math (components/beamy/ArFx draws
 * them on one small 2D canvas round Beamy). Each is a photo-booth effect the
 * platform already sells: snowfall (the Christmas pack's "snowfall-glow"),
 * confetti and hearts (the booth's trigger bursts, lib/studio/triggers
 * BurstStyle), plus music notes and stage lights for a party. Sparkle burst
 * stays on the stage (its own motes). Low counts that scale with the box;
 * reduced motion keeps the effect but softens it (fewer, slower, no sweep).
 */

export type ArFxKind = 'snow' | 'confetti' | 'hearts' | 'notes' | 'spotlight';
export const AR_FX_KINDS: readonly ArFxKind[] = ['snow', 'confetti', 'hearts', 'notes', 'spotlight'];

/** One particle, in box px (x right, y down). */
export type FxBit = { x: number; y: number; vx: number; vy: number; r: number; rot: number; vrot: number; phase: number; hue: number };

/** Colours as 'r,g,b' (the booth's own palettes for confetti and hearts). */
export const FX_COLORS: Record<Exclude<ArFxKind, 'spotlight'>, readonly string[]> = {
  snow: ['255,255,255', '226,236,255'],
  confetti: ['255,64,129', '124,77,255', '0,229,255', '255,215,64', '0,230,118', '255,109,64'],
  hearts: ['255,82,133', '255,133,162', '255,45,85'],
  notes: ['255,231,184', '201,204,255', '255,255,255'],
};

/** Reduced motion: the same effect, softer (this share of the count and speed). */
export const SOFT_COUNT = 0.5;
export const SOFT_SPEED = 0.4;

/** How many bits for a w x h box (spotlight draws beams, not bits: 0). */
export function fxCount(kind: ArFxKind, w: number, h: number, reduced: boolean): number {
  if (kind === 'spotlight' || !(w > 0) || !(h > 0)) return 0;
  const area = w * h;
  const per = kind === 'snow' ? 9000 : kind === 'confetti' ? 11000 : 26000;
  const max = kind === 'snow' ? 70 : kind === 'confetti' ? 56 : 22;
  const min = kind === 'snow' ? 24 : kind === 'confetti' ? 20 : 8;
  const n = Math.min(max, Math.max(min, area / per));
  return Math.round(reduced ? n * SOFT_COUNT : n);
}

/**
 * Where a bit starts. Snow and confetti fall through the whole box; hearts
 * and notes rise from round his shoulders (the box's middle third, lower
 * half) and drift out to the sides.
 */
function spawn(kind: ArFxKind, w: number, h: number, rand: () => number, anywhere: boolean): FxBit {
  const s = (lo: number, hi: number) => lo + rand() * (hi - lo);
  if (kind === 'snow' || kind === 'confetti') {
    const r = kind === 'snow' ? s(1.4, 3.8) : s(3.5, 6.5);
    return {
      x: rand() * w,
      y: anywhere ? rand() * h : -r * 2 - rand() * h * 0.2,
      vx: (rand() - 0.5) * (kind === 'snow' ? 12 : 30),
      vy: kind === 'snow' ? 16 + r * 9 + rand() * 8 : s(55, 95),
      r, rot: rand() * Math.PI * 2, vrot: (rand() - 0.5) * (kind === 'confetti' ? 7 : 0), phase: rand() * Math.PI * 2,
      hue: Math.floor(rand() * 64),
    };
  }
  // Hearts / notes: from round his chest, rising and spreading.
  const side = rand() < 0.5 ? -1 : 1;
  return {
    x: w * (0.5 + side * s(0.08, 0.3)),
    y: anywhere ? h * s(0.15, 0.75) : h * s(0.55, 0.72),
    vx: side * s(6, 22),
    vy: -s(26, 46),
    r: kind === 'hearts' ? s(7, 12) : s(8, 12),
    rot: (rand() - 0.5) * 0.5, vrot: 0, phase: rand() * Math.PI * 2,
    hue: Math.floor(rand() * 64),
  };
}

/** The bits for a box (rand: a seeded 0..1 source, so tests are exact). */
export function seedFx(kind: ArFxKind, n: number, w: number, h: number, rand: () => number): FxBit[] {
  return Array.from({ length: n }, () => spawn(kind, w, h, rand, true));
}

/**
 * Advance by dt seconds (clamped; reduced = slower). A bit that leaves the
 * box starts again: snow and confetti at the top, hearts and notes back at
 * his chest. Mutates in place.
 */
export function stepFx(kind: ArFxKind, bits: FxBit[], dt: number, w: number, h: number, t: number, reduced: boolean, rand: () => number): void {
  if (kind === 'spotlight') return;
  const d = Math.min(Math.max(dt, 0), 0.1) * (reduced ? SOFT_SPEED : 1);
  for (let k = 0; k < bits.length; k++) {
    const b = bits[k];
    const sway = kind === 'snow' ? 7 : kind === 'confetti' ? 18 : 10;
    b.x += (b.vx + Math.sin(t * (kind === 'confetti' ? 2.2 : 0.9) + b.phase) * sway) * d;
    b.y += b.vy * d;
    b.rot += b.vrot * d;
    const out = b.y - b.r * 2 > h || b.y + b.r * 2 < 0 || b.x < -b.r * 4 || b.x > w + b.r * 4;
    if (out) bits[k] = spawn(kind, w, h, rand, false);
  }
}

/** A bit's opacity: snow steady, confetti full, hearts and notes fade as they rise. */
export function fxAlpha(kind: ArFxKind, b: FxBit, h: number): number {
  if (kind === 'snow') return 0.45 + Math.min(0.45, b.r * 0.12);
  if (kind === 'confetti') return 0.92;
  // Rising from ~0.7h: full until 0.45h, gone by the top.
  const u = Math.min(1, Math.max(0, b.y / Math.max(1, h * 0.45)));
  return 0.9 * u;
}

/**
 * Stage lights: two beams from the box's top corners swing across him (a
 * slow sweep; reduced motion holds them still, crossed on him). Angles in
 * radians from straight down, positive towards the box's middle.
 */
export function spotBeams(t: number, reduced: boolean): { left: number; right: number; glow: number } {
  if (reduced) return { left: 0.36, right: 0.36, glow: 0.85 };
  return {
    left: 0.36 + Math.sin(t * 0.9) * 0.2,
    right: 0.36 + Math.sin(t * 0.9 + 2.1) * 0.2,
    glow: 0.8 + Math.sin(t * 2.4) * 0.15,
  };
}
