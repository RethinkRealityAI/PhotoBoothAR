/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * sceneLife — the small moving pieces that make a card design's scene feel
 * alive: birds crossing the sky, hot-air balloons bobbing, party balloons
 * drifting up, mortarboards tossed in the air, fireworks, a shooting star,
 * chimney smoke, flickering lantern light, clouds sliding past the moon.
 *
 * Each piece is a paper cut-out drawn in SVG (components/cards/scenes/
 * SceneLife.tsx) placed in the 900x1600 stage space the scene art uses, and
 * moved by ONE pure function of time, `lifePose`. Pure on purpose: the card
 * (rAF), the keepsake-film intro (a seeked GSAP timeline) and any still for
 * an email all ask the same question — "where is this piece at t?" — and get
 * the same answer.
 *
 * Reduced motion: the pieces still move (the scene must never look broken
 * or frozen), at about half speed and with smaller travel.
 */
import type { CardDesignId } from './cardDesigns';

export type LifeKind =
  | 'bird'
  | 'hotair'
  | 'balloon'
  | 'cloud'
  | 'glint'
  | 'flicker'
  | 'shootingStar'
  | 'firework'
  | 'cap'
  | 'smoke'
  | 'rays'
  | 'shimmer';

export interface LifeProp {
  kind: LifeKind;
  /** Anchor in the 900x1600 stage space. */
  x: number;
  y: number;
  /** Drawing scale (1 = the kind's natural size). */
  size?: number;
  /** Seconds for one cycle of the piece's motion. */
  period?: number;
  /** 0..1 offset into the cycle, so a flock doesn't move in lockstep. */
  phase?: number;
  /** Main colour; the renderer falls back to the design palette. */
  color?: string;
  /** Second colour (stripes, wing tips, string). */
  color2?: string;
  /** Travel direction for crossing pieces: 1 = left→right, -1 = right→left. */
  dir?: 1 | -1;
}

export interface LifePose {
  x: number;
  y: number;
  /** degrees */
  rot: number;
  scale: number;
  opacity: number;
  /** -1..1 — wing beat for birds, otherwise 0. */
  flap: number;
  /** 0..1 — burst growth for fireworks, tail length for a shooting star. */
  grow: number;
}

const TAU = Math.PI * 2;
const STAGE_W = 900;

function frac(n: number): number {
  return n - Math.floor(n);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000 + 0;
}

/** Natural cycle length per kind, seconds. */
export const DEFAULT_PERIOD: Record<LifeKind, number> = {
  bird: 16,
  hotair: 11,
  balloon: 14,
  cloud: 60,
  glint: 2.6,
  flicker: 1.7,
  shootingStar: 9,
  firework: 4.2,
  cap: 5.5,
  smoke: 5,
  rays: 18,
  shimmer: 3.2,
};

/**
 * Where a piece is at `t` seconds. Total: junk input yields a finite pose.
 */
export function lifePose(prop: LifeProp, t: number, reducedMotion = false): LifePose {
  const time = Number.isFinite(t) ? Math.max(0, t) : 0;
  const k = reducedMotion ? 0.5 : 1; // speed
  const a = reducedMotion ? 0.6 : 1; // travel
  const period = Math.max(0.5, prop.period ?? DEFAULT_PERIOD[prop.kind]);
  const ph = Number.isFinite(prop.phase) ? (prop.phase as number) : 0;
  const s = prop.size ?? 1;
  const dir = prop.dir ?? 1;
  const u = frac((time * k) / period + ph); // 0..1 through the cycle
  const base: LifePose = { x: prop.x, y: prop.y, rot: 0, scale: s, opacity: 1, flap: 0, grow: 0 };

  switch (prop.kind) {
    case 'bird': {
      // Crosses the sky with a gentle rise and dip, fading at the edges.
      const span = STAGE_W + 260;
      const x = dir === 1 ? -130 + u * span : STAGE_W + 130 - u * span;
      const y = prop.y + Math.sin(u * TAU * 1.5 + ph * 7) * 26 * a - u * 60 * a;
      const flap = Math.sin(time * k * 11 + ph * 20);
      const edge = Math.min(u / 0.08, (1 - u) / 0.08, 1);
      return { ...base, x, y, flap, rot: dir * Math.sin(u * TAU * 1.5 + ph * 7) * 6, opacity: clamp01(edge) };
    }
    case 'hotair': {
      const w = (time * k * TAU) / period;
      return {
        ...base,
        x: prop.x + Math.sin(w + ph * TAU) * 34 * a,
        y: prop.y + Math.sin(w * 1.7 + ph * TAU) * 20 * a,
        rot: Math.sin(w * 1.3 + ph * TAU) * 2.5 * a,
      };
    }
    case 'balloon': {
      // Drifts up from below the frame and out of the top, swaying.
      const y = 1720 - u * 1960;
      const x = prop.x + Math.sin(u * TAU * 1.6 + ph * TAU) * 38 * a;
      const rot = Math.sin(time * k * 1.4 + ph * TAU) * 7 * a;
      return { ...base, x, y, rot };
    }
    case 'cloud': {
      const span = STAGE_W + 500;
      const x = -250 + frac(((prop.x + 250) / span) + u * dir) * span;
      return { ...base, x, y: prop.y + Math.sin(u * TAU * 2) * 6 * a, opacity: 0.92 };
    }
    case 'glint': {
      const tw = Math.abs(Math.sin(u * Math.PI));
      return { ...base, opacity: r3(0.15 + 0.85 * tw), scale: s * (0.55 + 0.45 * tw), rot: u * 90 };
    }
    case 'flicker': {
      const w = time * k * TAU;
      const f = 0.5 * Math.sin(w / period + ph * TAU) + 0.3 * Math.sin(w * 2.3 + ph * 11) + 0.2 * Math.sin(w * 5.1 + ph * 3);
      return { ...base, opacity: r3(0.62 + 0.3 * f), scale: s * (0.94 + 0.08 * f) };
    }
    case 'shootingStar': {
      // A short streak once per cycle; dark the rest of the time.
      const live = 0.14;
      if (u > live) return { ...base, opacity: 0, grow: 0 };
      const p = u / live;
      const travel = 420 * a;
      return {
        ...base,
        x: prop.x + dir * p * travel,
        y: prop.y + p * travel * 0.42,
        rot: dir === 1 ? 23 : 157,
        opacity: r3(Math.sin(p * Math.PI)),
        grow: r3(Math.min(1, p * 2.2)),
      };
    }
    case 'firework': {
      // Bloom, hang, fade; then wait for the next one.
      if (u > 0.62) return { ...base, opacity: 0, grow: 0 };
      const p = u / 0.62;
      const grow = 1 - Math.pow(1 - Math.min(1, p / 0.45), 3);
      return { ...base, grow: r3(grow), opacity: r3(p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55), y: prop.y + p * 26 };
    }
    case 'cap': {
      // Tossed up, spinning, and back down.
      const h = 300 * a;
      return {
        ...base,
        x: prop.x + (u - 0.5) * 90 * dir * a,
        y: prop.y - Math.sin(u * Math.PI) * h,
        rot: u * 540 * dir * a,
        opacity: clamp01(Math.min(u / 0.06, (1 - u) / 0.06, 1)),
      };
    }
    case 'smoke': {
      return {
        ...base,
        x: prop.x + Math.sin(u * 4 + ph * 5) * 12 * a + u * 18,
        y: prop.y - u * 150 * a,
        scale: s * (0.45 + u * 1.3),
        opacity: r3(Math.sin(u * Math.PI) * 0.55),
      };
    }
    case 'rays': {
      const w = (time * k * TAU) / period;
      return { ...base, rot: Math.sin(w + ph * TAU) * 7 * a, opacity: r3(0.3 + 0.16 * Math.sin(w * 2.1 + ph)) };
    }
    case 'shimmer': {
      const tw = Math.abs(Math.sin(u * Math.PI));
      return { ...base, x: prop.x + Math.sin(u * TAU) * 14 * a, opacity: r3(0.1 + 0.75 * tw), scale: s * (0.7 + 0.3 * tw) };
    }
    default:
      return base;
  }
}

/* ------------------------------------------------------------------ */
/* What moves in each design                                           */
/* ------------------------------------------------------------------ */

const flock = (y: number, dir: 1 | -1, phase: number, color?: string, n = 3): LifeProp[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'bird' as const,
    x: 0,
    y: y + (i % 2) * 34 + i * 10,
    size: 0.9 - i * 0.12,
    phase: phase + i * 0.018,
    dir,
    color,
  }));

/**
 * The living pieces of each design, in stage space. Placed against the art in
 * public/card-designs/<id>/back.webp (lanterns on the path, the chandelier,
 * the sea, the chimneys…), and kept sparse: a scene that is busy everywhere
 * stops reading as a scene.
 */
export const DESIGN_LIFE: Record<CardDesignId, readonly LifeProp[]> = {
  'garden-gate': [
    ...flock(300, 1, 0.1, '#3B2F4F'),
    ...flock(430, -1, 0.55, '#3B2F4F', 2),
    { kind: 'flicker', x: 118, y: 1258, size: 1, color: '#FFD58A' },
    { kind: 'flicker', x: 312, y: 1440, size: 0.9, phase: 0.4, color: '#FFD58A' },
    { kind: 'flicker', x: 560, y: 1262, size: 0.9, phase: 0.7, color: '#FFD58A' },
    { kind: 'flicker', x: 690, y: 1385, size: 1, phase: 0.2, color: '#FFD58A' },
  ],
  'balloon-bash': [
    { kind: 'balloon', x: 140, y: 0, size: 1.1, phase: 0, color: '#F07B6B' },
    { kind: 'balloon', x: 760, y: 0, size: 1, phase: 0.3, color: '#7C83D6' },
    { kind: 'balloon', x: 470, y: 0, size: 0.8, phase: 0.62, color: '#F5C84E' },
    { kind: 'balloon', x: 300, y: 0, size: 0.7, phase: 0.83, color: '#C9B3EC' },
  ],
  'gala-night': [
    { kind: 'glint', x: 430, y: 380, size: 1, phase: 0 },
    { kind: 'glint', x: 500, y: 470, size: 0.8, phase: 0.35 },
    { kind: 'glint', x: 395, y: 520, size: 0.7, phase: 0.7 },
    { kind: 'glint', x: 465, y: 590, size: 0.6, phase: 0.5 },
    { kind: 'flicker', x: 330, y: 1000, size: 0.8, color: '#FFD98A' },
    { kind: 'flicker', x: 610, y: 1000, size: 0.8, phase: 0.5, color: '#FFD98A' },
    { kind: 'flicker', x: 455, y: 1090, size: 0.7, phase: 0.25, color: '#FFD98A' },
    { kind: 'rays', x: 450, y: 450, size: 1.4, color: '#FFE3A8' },
  ],
  owambe: [
    { kind: 'rays', x: 450, y: 980, size: 1.5, color: '#FFE0A0' },
    { kind: 'glint', x: 450, y: 600, size: 0.9 },
    { kind: 'glint', x: 410, y: 680, size: 0.6, phase: 0.45 },
    { kind: 'glint', x: 495, y: 660, size: 0.7, phase: 0.75 },
    { kind: 'flicker', x: 450, y: 960, size: 1.4, color: '#FFD38A' },
  ],
  'city-lights': [
    { kind: 'firework', x: 250, y: 420, size: 1, phase: 0, color: '#FFD9A0' },
    { kind: 'firework', x: 660, y: 330, size: 1.2, phase: 0.45, color: '#F2A9C9' },
    { kind: 'firework', x: 470, y: 560, size: 0.8, phase: 0.75, color: '#A9D2FF' },
    { kind: 'shootingStar', x: 120, y: 160, size: 1, phase: 0.2, dir: 1 },
    { kind: 'glint', x: 160, y: 205, size: 0.6, phase: 0.1, color: '#FFE6B0' },
    { kind: 'glint', x: 445, y: 170, size: 0.6, phase: 0.55, color: '#FFE6B0' },
    { kind: 'glint', x: 755, y: 215, size: 0.6, phase: 0.8, color: '#FFE6B0' },
  ],
  'moon-gate': [
    { kind: 'cloud', x: 120, y: 760, size: 1, period: 70, color: '#3E3F82' },
    { kind: 'cloud', x: 640, y: 640, size: 0.8, period: 85, phase: 0.4, color: '#4A4C93' },
    { kind: 'flicker', x: 150, y: 640, size: 1, color: '#FF8A5C' },
    { kind: 'flicker', x: 410, y: 720, size: 0.9, phase: 0.3, color: '#FF8A5C' },
    { kind: 'flicker', x: 610, y: 690, size: 1, phase: 0.6, color: '#FF8A5C' },
    { kind: 'flicker', x: 720, y: 760, size: 0.9, phase: 0.85, color: '#FF8A5C' },
  ],
  'cloud-nine': [
    { kind: 'hotair', x: 160, y: 520, size: 0.9, phase: 0.1, color: '#F2B5C4', color2: '#FFF1D6' },
    { kind: 'hotair', x: 760, y: 900, size: 0.7, phase: 0.6, color: '#B8D9C8', color2: '#FFE7C2' },
    { kind: 'cloud', x: 200, y: 1300, size: 1.3, period: 75, color: '#FBE3EA' },
    { kind: 'cloud', x: 700, y: 1380, size: 1.1, period: 95, phase: 0.5, color: '#F6D6E2' },
  ],
  'grand-hall': [
    { kind: 'cap', x: 300, y: 900, size: 1, phase: 0, dir: 1, color: '#1F2A5A' },
    { kind: 'cap', x: 620, y: 940, size: 0.85, phase: 0.4, dir: -1, color: '#1F2A5A' },
    { kind: 'cap', x: 460, y: 860, size: 0.7, phase: 0.72, dir: 1, color: '#1F2A5A' },
    { kind: 'rays', x: 450, y: 700, size: 1.3, color: '#FFE6B8' },
  ],
  'island-sunset': [
    ...flock(640, -1, 0.05, '#4A2E2A'),
    ...flock(540, 1, 0.5, '#4A2E2A', 2),
    { kind: 'shimmer', x: 450, y: 1110, size: 1.2, color: '#FFE2C4' },
    { kind: 'shimmer', x: 330, y: 1160, size: 0.8, phase: 0.4, color: '#FFE2C4' },
    { kind: 'shimmer', x: 590, y: 1180, size: 0.9, phase: 0.7, color: '#FFE2C4' },
  ],
  'winter-glow': [
    { kind: 'smoke', x: 455, y: 1180, size: 1, phase: 0 },
    { kind: 'smoke', x: 455, y: 1180, size: 1, phase: 0.5 },
    { kind: 'smoke', x: 205, y: 1030, size: 0.8, phase: 0.25 },
    { kind: 'smoke', x: 205, y: 1030, size: 0.8, phase: 0.75 },
    { kind: 'shootingStar', x: 620, y: 130, size: 0.9, phase: 0.55, dir: -1 },
    { kind: 'flicker', x: 470, y: 1270, size: 0.8, color: '#FFC56B' },
    { kind: 'flicker', x: 800, y: 1220, size: 0.7, phase: 0.5, color: '#FFC56B' },
  ],
};

export function designLife(id: CardDesignId): readonly LifeProp[] {
  return DESIGN_LIFE[id] ?? [];
}
