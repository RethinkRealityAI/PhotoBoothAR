/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * openingFx — each design's own flourish as its gateway opens.
 *
 * The gateway animation (sceneFrame) is the same machine for every design;
 * this is the part that makes each one feel like itself: petals burst out of
 * the garden gate and flutter down, the winter window's frost melts away,
 * confetti pops for the balloon wall, lanterns rise past the moon gate, gold
 * dust swirls through the gala doors.
 *
 * Pure and deterministic: a design id + seed gives the same particles every
 * time, and `fxPose(kind, particle, seconds)` says where one is at an instant,
 * so the canvas renderer (components/cards/scenes/OpeningFx.tsx) holds no
 * physics of its own and a film render could reuse the same numbers.
 *
 * Coordinates are fractions of the stage (0..1 across, 0..1 down); the burst
 * comes out of the gateway's centre (the iris centre, 450/900 x 760/1600).
 *
 * Reduced motion: no flying particles at all. The frost melt (an opacity
 * dissolve, nothing travels) and a still shimmer of gold are kept.
 */
import type { CardDesignId } from './cardDesigns';

export type FxKind =
  | 'petals'
  | 'hearts'
  | 'confetti'
  | 'sparks'
  | 'fireworks'
  | 'lanterns'
  | 'golddust'
  | 'clouds'
  | 'leaves'
  | 'melt';

export const FX_KINDS: readonly FxKind[] = [
  'petals',
  'hearts',
  'confetti',
  'sparks',
  'fireworks',
  'lanterns',
  'golddust',
  'clouds',
  'leaves',
  'melt',
];

export interface DesignFx {
  /** The main flourish. */
  kind: FxKind;
  /** Optional second layer, played with the first. */
  also?: FxKind;
  colors: readonly string[];
}

/** Every design's flourish (designPacks.test / openingFx.test check coverage). */
export const DESIGN_FX: Record<CardDesignId, DesignFx> = {
  'garden-gate': { kind: 'petals', colors: ['#FFFFFF', '#F6D6E6', '#D9C8FF', '#FFC6DA'] },
  'balloon-bash': { kind: 'confetti', colors: ['#FFD36B', '#FF8F7A', '#9AA4FF', '#C9A8FF', '#FFFFFF'] },
  'gala-night': { kind: 'golddust', colors: ['#F3D58C', '#FFFFFF', '#E8C77A'] },
  owambe: { kind: 'confetti', also: 'golddust', colors: ['#F0B54A', '#FF8A6B', '#3FBF9A', '#FFFFFF'] },
  'city-lights': { kind: 'fireworks', colors: ['#FFD9A0', '#FF8FB1', '#9FD8FF', '#FFFFFF'] },
  'moon-gate': { kind: 'lanterns', colors: ['#FF6B4A', '#F2B65A', '#FF8F5A'] },
  'cloud-nine': { kind: 'clouds', also: 'golddust', colors: ['#FFFFFF', '#FFE3A8', '#FFD7E6'] },
  'grand-hall': { kind: 'golddust', colors: ['#E3C27A', '#FFFFFF', '#F5DFA8'] },
  'island-sunset': { kind: 'leaves', also: 'petals', colors: ['#FF8A7A', '#FFC1A8', '#FFFFFF', '#2F9E6B', '#5CC48A'] },
  'love-notes': { kind: 'hearts', also: 'petals', colors: ['#E0566E', '#F08AA0', '#FFE1D6', '#FFFFFF'] },
  'festival-of-lights': { kind: 'sparks', also: 'petals', colors: ['#FFC93C', '#FFB347', '#FFF4D6', '#FF8A3D'] },
  'crescent-night': { kind: 'lanterns', also: 'golddust', colors: ['#FFE6A8', '#F2C46B', '#7FD1C4'] },
  'golden-hour': { kind: 'golddust', colors: ['#FFE3A3', '#FFF1C4', '#F2C46B'] },
  'jungle-party': { kind: 'confetti', also: 'leaves', colors: ['#FFD23F', '#FF6B6B', '#5ED1C6', '#A98BFF', '#3F9E4E'] },
  'winter-glow': { kind: 'melt', colors: ['#FFFFFF', '#E3EEFF', '#BFD8FF'] },
  'balloon-release': { kind: 'confetti', colors: ['#FFD36B', '#FF8F7A', '#9AA4FF', '#C9A8FF', '#FFFFFF'] },
  showtime: { kind: 'confetti', also: 'golddust', colors: ['#F2C14E', '#FFE7A3', '#B0213A', '#FFFFFF'] },
  'pop-party': { kind: 'confetti', colors: ['#F07B6B', '#5ED1C6', '#FFD36B', '#C9A8FF', '#FFFFFF'] },
  'jewel-box': { kind: 'golddust', also: 'sparks', colors: ['#FFE7A3', '#E4B451', '#FFFFFF', '#F6C1D9'] },
  'deep-blue': { kind: 'golddust', colors: ['#E8FBFF', '#BFF3FF', '#FFFFFF'] },
};

/** How long the flourish plays, from the moment the gateway starts to open. */
export const FX_DURATION_S = 4.4;
/** Where the burst comes from (the iris centre). */
export const FX_ORIGIN = { x: 0.5, y: 760 / 1600 } as const;

export interface FxParticle {
  x0: number;
  y0: number;
  /** Launch velocity, stage fractions per second. */
  vx: number;
  vy: number;
  /** Starting angle (rad) and spin (rad/s). */
  rot: number;
  spin: number;
  /** Size in stage units (1 = 1/100 of the stage's short side). */
  size: number;
  /** Seconds after the flourish starts that this particle appears. */
  delay: number;
  /** Seconds it lives. */
  life: number;
  /** Index into the design's colours. */
  color: number;
  /** Per-particle phase for sway / twinkle. */
  phase: number;
}

export interface FxPose {
  x: number;
  y: number;
  rot: number;
  scale: number;
  alpha: number;
  /** Direction of travel (rad), for streaks and trails. */
  heading: number;
}

/** Deterministic 32-bit PRNG. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COUNTS: Record<FxKind, number> = {
  petals: 46,
  hearts: 30,
  confetti: 90,
  sparks: 70,
  fireworks: 96,
  lanterns: 16,
  golddust: 80,
  clouds: 10,
  leaves: 26,
  melt: 24,
};

/** Kinds that still play under reduced motion (nothing in them travels). */
const STILL_KINDS: ReadonlySet<FxKind> = new Set(['melt', 'golddust']);

/** The particles for one flourish layer. `scale` thins a secondary layer. */
export function fxParticles(kind: FxKind, seed: string, reducedMotion = false, scale = 1, colorCount = 4): FxParticle[] {
  if (reducedMotion && !STILL_KINDS.has(kind)) return [];
  const rand = mulberry32(hash(`${kind}|${seed}`));
  const n = Math.max(0, Math.round(COUNTS[kind] * scale * (reducedMotion ? 0.4 : 1)));
  const colors = Math.max(1, Math.floor(colorCount));
  const out: FxParticle[] = [];
  for (let i = 0; i < n; i++) {
    const r1 = rand();
    const r2 = rand();
    const r3 = rand();
    const r4 = rand();
    const r5 = rand();
    const ang = r1 * Math.PI * 2;
    const base: FxParticle = {
      x0: FX_ORIGIN.x,
      y0: FX_ORIGIN.y,
      vx: 0,
      vy: 0,
      rot: r3 * Math.PI * 2,
      spin: (r4 - 0.5) * 6,
      size: 1,
      delay: 0,
      life: 2.6,
      color: Math.floor(r5 * colors) % colors,
      phase: r2 * Math.PI * 2,
    };
    switch (kind) {
      case 'petals':
      case 'hearts':
      case 'leaves': {
        const sp = 0.45 + r2 * 0.75;
        base.vx = Math.cos(ang) * sp * 0.75;
        base.vy = Math.sin(ang) * sp * 0.5 - 0.12;
        base.size = kind === 'hearts' ? 2.2 + r4 * 1.8 : kind === 'leaves' ? 2.6 + r4 * 1.6 : 1.6 + r4 * 1.4;
        base.delay = 0.15 + r3 * 0.35;
        base.life = 2.4 + r4 * 0.9;
        base.spin = (r4 - 0.5) * (kind === 'hearts' ? 1.2 : 5);
        break;
      }
      case 'confetti': {
        const sp = 0.6 + r2 * 1.0;
        const a = -Math.PI / 2 + (r1 - 0.5) * Math.PI * 1.5; // mostly up and out
        base.vx = Math.cos(a) * sp * 0.7;
        base.vy = Math.sin(a) * sp * 0.7;
        base.size = 1.5 + r4 * 1.1;
        base.delay = 0.12 + r3 * 0.25;
        base.life = 2.4 + r4 * 0.9;
        base.spin = (r4 - 0.5) * 14;
        break;
      }
      case 'sparks': {
        const sp = 0.35 + r2 * 0.6;
        const a = -Math.PI / 2 + (r1 - 0.5) * Math.PI * 1.6;
        base.vx = Math.cos(a) * sp * 0.6;
        base.vy = Math.sin(a) * sp * 0.6;
        base.size = 0.5 + r4 * 0.6;
        base.delay = 0.1 + r3 * 0.9;
        base.life = 1.0 + r4 * 0.9;
        break;
      }
      case 'fireworks': {
        // Three bursts up in the sky, one after another.
        const b = i % 3;
        const centres = [
          { x: 0.28, y: 0.2 },
          { x: 0.72, y: 0.16 },
          { x: 0.5, y: 0.3 },
        ];
        const c = centres[b];
        const ring = 0.22 + r2 * 0.14;
        base.x0 = c.x;
        base.y0 = c.y;
        base.vx = Math.cos(ang) * ring * 0.62;
        base.vy = Math.sin(ang) * ring * 0.62 * (9 / 16);
        base.size = 0.55 + r4 * 0.45;
        base.delay = 0.2 + b * 0.55 + r3 * 0.05;
        base.life = 1.4 + r4 * 0.5;
        base.color = b % colors;
        break;
      }
      case 'lanterns': {
        base.x0 = 0.08 + r1 * 0.84;
        base.y0 = 1.06 + r2 * 0.08;
        base.vx = (r3 - 0.5) * 0.02;
        base.vy = -(0.16 + r4 * 0.1);
        base.size = 2.4 + r4 * 1.8;
        base.delay = r3 * 1.4;
        base.life = 3.4;
        base.spin = 0;
        break;
      }
      case 'golddust': {
        base.vx = 0.18 + r2 * 0.32; // spiral radius growth
        base.vy = 0;
        base.rot = ang;
        base.spin = (r4 > 0.5 ? 1 : -1) * (1.2 + r3 * 1.4); // orbit speed
        base.size = 0.8 + r4 * 1.0;
        base.delay = 0.05 + r3 * 0.5;
        base.life = 2.2 + r4 * 1.2;
        break;
      }
      case 'clouds': {
        const side = i % 2 === 0 ? -1 : 1;
        base.x0 = 0.5 + side * (0.02 + r1 * 0.1);
        base.y0 = 0.2 + r2 * 0.6;
        base.vx = side * (0.3 + r3 * 0.25);
        base.vy = (r4 - 0.5) * 0.04;
        base.size = 14 + r4 * 10;
        base.delay = r3 * 0.2;
        base.life = 2.4;
        base.spin = 0;
        break;
      }
      case 'melt': {
        // Melt water: drops that slide down the glass as the frost goes.
        base.x0 = 0.06 + r1 * 0.88;
        base.y0 = 0.05 + r2 * 0.5;
        base.vx = 0;
        base.vy = 0.05 + r3 * 0.08;
        base.size = 0.6 + r4 * 0.6;
        base.delay = 0.3 + r3 * 0.9;
        base.life = 1.8 + r4 * 0.8;
        base.spin = 0;
        break;
      }
    }
    // Nothing outlives the flourish: the renderer stops at FX_DURATION_S.
    base.life = Math.max(0.2, Math.min(base.life, FX_DURATION_S - base.delay));
    out.push(base);
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fade in fast, hold, fade out over the last part of the life. */
function envelope(age: number, life: number, inS = 0.12, outShare = 0.35): number {
  if (age < 0 || age > life) return 0;
  const fin = clamp01(age / inS);
  const fout = clamp01((life - age) / (life * outShare));
  return Math.min(fin, fout);
}

/** Position under drag (k per second) and gravity g: closed form, no stepping. */
function ballistic(v: number, k: number, g: number, t: number): number {
  // dv/dt = -k v + g  →  x(t) = (v - g/k)(1 - e^{-kt})/k + g t / k
  const e = 1 - Math.exp(-k * t);
  return ((v - g / k) * e) / k + (g * t) / k;
}

/** Where one particle is `seconds` after the flourish started, or null if not visible. */
export function fxPose(kind: FxKind, p: FxParticle, seconds: number): FxPose | null {
  if (!Number.isFinite(seconds)) return null;
  const age = seconds - p.delay;
  if (age < 0 || age > p.life) return null;
  let x = p.x0;
  let y = p.y0;
  let rot = p.rot + p.spin * age;
  let scale = 1;
  let alpha = envelope(age, p.life);
  let heading = Math.atan2(p.vy, p.vx);
  switch (kind) {
    case 'petals':
    case 'hearts':
    case 'leaves': {
      const k = 2.4;
      const g = kind === 'hearts' ? 0.06 : 0.14;
      x += ballistic(p.vx, k, 0, age) + Math.sin(age * 2.6 + p.phase) * 0.018 * clamp01(age);
      y += ballistic(p.vy, k, g, age);
      scale = 0.4 + 0.6 * clamp01(age / 0.35);
      if (kind === 'hearts') rot = Math.sin(age * 2 + p.phase) * 0.35;
      break;
    }
    case 'confetti': {
      x += ballistic(p.vx, 1.6, 0, age) + Math.sin(age * 4 + p.phase) * 0.01;
      y += ballistic(p.vy, 1.6, 0.55, age);
      scale = 0.5 + 0.5 * clamp01(age / 0.2);
      break;
    }
    case 'sparks': {
      const vx = p.vx * Math.exp(-1.2 * age);
      const vy = p.vy * Math.exp(-1.2 * age) + 0.2 * age;
      x += ballistic(p.vx, 1.2, 0, age);
      y += ballistic(p.vy, 1.2, 0.2, age);
      heading = Math.atan2(vy, vx);
      alpha *= 0.65 + 0.35 * Math.sin(age * 30 + p.phase);
      break;
    }
    case 'fireworks': {
      const vx = p.vx * Math.exp(-2.6 * age);
      const vy = p.vy * Math.exp(-2.6 * age) + 0.08 * age;
      x += ballistic(p.vx, 2.6, 0, age);
      y += ballistic(p.vy, 2.6, 0.08, age);
      heading = Math.atan2(vy, vx);
      alpha = envelope(age, p.life, 0.04, 0.5) * (age > p.life * 0.6 ? 0.7 + 0.3 * Math.sin(age * 40 + p.phase) : 1);
      break;
    }
    case 'lanterns': {
      x += p.vx * age + Math.sin(age * 1.1 + p.phase) * 0.012;
      y += p.vy * age;
      rot = Math.sin(age * 1.3 + p.phase) * 0.08;
      alpha = envelope(age, p.life, 0.5, 0.25);
      break;
    }
    case 'golddust': {
      const r = p.vx * (1 - Math.exp(-1.6 * age));
      const a = p.rot + p.spin * age;
      x += Math.cos(a) * r;
      y += Math.sin(a) * r * (9 / 16) - 0.02 * age;
      rot = a;
      alpha *= 0.55 + 0.45 * Math.sin(age * 9 + p.phase);
      break;
    }
    case 'clouds': {
      x += ballistic(p.vx, 0.9, 0, age);
      y += p.vy * age;
      scale = 0.7 + 0.5 * clamp01(age / p.life);
      alpha = envelope(age, p.life, 0.2, 0.55) * 0.9;
      break;
    }
    case 'melt': {
      // Drops start still (beading), then run.
      const run = Math.max(0, age - 0.35);
      y += p.vy * run * run * 2.2;
      scale = 0.6 + 0.4 * clamp01(age / 0.35);
      alpha = envelope(age, p.life, 0.3, 0.4) * 0.85;
      heading = Math.PI / 2;
      break;
    }
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, rot, scale, alpha: clamp01(alpha), heading };
}

/* ------------------------------------------------------------------ */
/* The frost melt (winter)                                             */
/* ------------------------------------------------------------------ */

/** Frost grid size: coarse on purpose, the canvas scales it up smoothly. */
export const MELT_COLS = 36;
export const MELT_ROWS = 64;
/** The frost is gone by this many seconds. */
export const MELT_S = 2.6;

/** Smooth value noise in 0..1 for a frost cell (deterministic per seed). */
export function frostNoise(col: number, row: number, seed: number): number {
  const cell = (cx: number, cy: number) => {
    const h = hash(`${cx},${cy},${seed}`);
    return (h % 10007) / 10007;
  };
  // Two octaves of bilinear value noise.
  const oct = (s: number) => {
    const fx = col / s;
    const fy = row / s;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = cell(x0 + s * 31, y0);
    const b = cell(x0 + 1 + s * 31, y0);
    const c = cell(x0 + s * 31, y0 + 1);
    const d = cell(x0 + 1 + s * 31, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return clamp01(oct(7) * 0.65 + oct(3) * 0.35);
}

/**
 * How much frost is left on a cell at `seconds` (0 = clear glass, 1 = full
 * frost). The melt starts in the middle (where the warm light pours through)
 * and spreads to the edges, with the noise giving it a ragged, crystalline
 * edge instead of a clean wipe.
 */
export function frostAt(col: number, row: number, seconds: number, seed: number): number {
  return frostLevel(frostMeltAt(col, row, seed), seconds);
}

/** When a cell melts (seconds): further out and "thicker" frost melts later. */
export function frostMeltAt(col: number, row: number, seed: number): number {
  const dx = (col + 0.5) / MELT_COLS - FX_ORIGIN.x;
  const dy = ((row + 0.5) / MELT_ROWS - FX_ORIGIN.y) * (16 / 9);
  const dist = Math.min(1, Math.hypot(dx, dy) / 1.05); // 0 centre .. 1 far corner
  const n = frostNoise(col, row, seed);
  return (0.15 + dist * 0.55 + n * 0.3) * MELT_S;
}

/** Frost left on a cell that melts at `meltAt`, `seconds` into the flourish. */
export function frostLevel(meltAt: number, seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  if (seconds <= 0) return 1;
  if (seconds >= MELT_S) return 0;
  return clamp01((meltAt - seconds) / (0.22 * MELT_S));
}

/* ------------------------------------------------------------------ */
/* Gate dissolves: the gateway itself turns into the theme              */
/* ------------------------------------------------------------------ */

/**
 * Some designs do not swing or slide their gate open: the gate itself turns
 * into the occasion and is carried away, like the winter window's frost.
 *
 *   shatter  the gate breaks into pieces from the middle out; each piece
 *            becomes a petal / a scrap of confetti / a fleck of gold as it flies
 *   burn     the gate burns away from the middle out behind a glowing edge,
 *            like a lamp-lit paper lantern or a sunset catching the drapes
 */
export type DissolveStyle = 'shatter' | 'burn';

export interface DesignDissolve {
  style: DissolveStyle;
  /** shatter: what each piece becomes. */
  into?: FxKind;
  /** burn: the colour of the glowing edge. */
  edge?: string;
}

export const DESIGN_DISSOLVE: Partial<Record<CardDesignId, DesignDissolve>> = {
  'garden-gate': { style: 'shatter', into: 'petals' },
  'balloon-bash': { style: 'shatter', into: 'confetti' },
  'grand-hall': { style: 'shatter', into: 'golddust' },
  'festival-of-lights': { style: 'burn', edge: '#FF9A3C' },
  'golden-hour': { style: 'burn', edge: '#FFD27A' },
};

export const SHATTER_COLS = 12;
export const SHATTER_ROWS = 22;
/** The last piece lets go by this many seconds. */
export const SHATTER_SPREAD_S = 0.95;
/** Seconds a piece flies. */
export const SHATTER_LIFE_S = 1.7;

export interface ShatterTile {
  col: number;
  row: number;
  /** Centre, stage fractions. */
  cx: number;
  cy: number;
  delay: number;
  vx: number;
  vy: number;
  spin: number;
  /** Index into the design's flourish colours. */
  color: number;
}

export function shatterTiles(seed: string, colorCount = 4): ShatterTile[] {
  const rand = mulberry32(hash(`shatter|${seed}`));
  const colors = Math.max(1, Math.floor(colorCount));
  const out: ShatterTile[] = [];
  for (let row = 0; row < SHATTER_ROWS; row++) {
    for (let col = 0; col < SHATTER_COLS; col++) {
      const cx = (col + 0.5) / SHATTER_COLS;
      const cy = (row + 0.5) / SHATTER_ROWS;
      const dx = cx - FX_ORIGIN.x;
      const dy = (cy - FX_ORIGIN.y) * (16 / 9);
      const dist = Math.min(1, Math.hypot(dx, dy) / 1.05);
      const len = Math.hypot(dx, dy) || 1;
      const r1 = rand();
      const r2 = rand();
      const r3 = rand();
      const sp = 0.22 + r1 * 0.38;
      out.push({
        col,
        row,
        cx,
        cy,
        delay: Math.min(1, dist * 0.75 + r2 * 0.25) * SHATTER_SPREAD_S,
        vx: (dx / len) * sp,
        vy: ((dy / len) * sp * 9) / 16 - 0.12,
        spin: (r3 - 0.5) * 8,
        color: Math.floor(rand() * colors) % colors,
      });
    }
  }
  return out;
}

export interface ShatterPose {
  /** Offset from the tile's home, stage fractions. */
  dx: number;
  dy: number;
  rot: number;
  /** Size of the piece relative to its tile. */
  scale: number;
  alpha: number;
  /** 0 = still a piece of the gate, 1 = fully the theme's particle. */
  morph: number;
}

/** Where a piece is `seconds` after the dissolve began; null once it is gone. */
export function shatterPose(t: ShatterTile, seconds: number): ShatterPose | null {
  if (!Number.isFinite(seconds)) return null;
  const age = seconds - t.delay;
  if (age < 0) return { dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1, morph: 0 };
  if (age > SHATTER_LIFE_S) return null;
  return {
    dx: ballistic(t.vx, 1.6, 0, age),
    dy: ballistic(t.vy, 1.6, 0.3, age),
    rot: t.spin * age,
    scale: 1 - 0.6 * clamp01(age / 0.5),
    alpha: 1 - clamp01((age - SHATTER_LIFE_S * 0.5) / (SHATTER_LIFE_S * 0.5)),
    morph: clamp01(age / 0.4),
  };
}

/** The burn: seconds to clear the gate, and when each cell of the melt grid goes. */
export const BURN_S = 2.1;

export function burnAt(col: number, row: number, seed: number): number {
  return (frostMeltAt(col, row, seed) / MELT_S) * BURN_S;
}

/** Gate left on a cell (1 = untouched, 0 = burnt away). */
export function burnLevel(at: number, seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  if (seconds <= 0) return 1;
  if (seconds >= BURN_S) return 0;
  return clamp01((at - seconds) / (0.16 * BURN_S));
}

/** The glowing edge: brightest where the gate is just going, nothing on clear or untouched paper. */
export function burnEdge(level: number): number {
  if (!(level > 0) || level >= 1) return 0;
  return Math.sin(Math.PI * Math.min(1, level * 1.6)) ** 2;
}
