/**
 * Burst particles for gesture triggers (smile → confetti, brow raise →
 * fireworks …). PURE: no DOM, no Math.random — the caller passes `rand` so the
 * shapes are testable. TriggerEffects.tsx owns the canvas, the loop and drawing.
 *
 * Space is the trigger canvas's fixed 720×1280 (the stage's 9:16).
 *
 * These are deliberately LOUD. Phone test (Nov 2026): the old bursts were small
 * enough that guests could not tell a trigger had fired, and fireworks read as
 * "sparkle". A burst is content the guest asked for with their face, so it is
 * NOT downgraded for prefers-reduced-motion (the same call as the landing films
 * and the Frame entrances; the owner's own phone reports Reduce Motion, and the
 * old reduced path turned every style into the same faint sparkle pop).
 */
import type { BurstStyle } from './studio/triggers';

export const FX_W = 720;
export const FX_H = 1280;
/** Hard cap on live particles (a burst landing mid-burst drops the overflow). */
export const FX_MAX_PARTICLES = 700;

export type FxKind = 'rect' | 'heart' | 'dot' | 'spark' | 'rocket' | 'flash';

export interface FxParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds remaining. */
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  vrot: number;
  /** px/s². */
  gravity: number;
  /** Velocity kept per second (1 = no drag). */
  drag: number;
  /** 'r,g,b'. */
  color: string;
  kind: FxKind;
  /** 'lighter' composite (glow) vs 'source-over'. */
  additive: boolean;
  /** Draw a motion streak behind it. */
  trail: boolean;
  /** Seconds before it appears (staggered rockets / shells). */
  delay: number;
  /** Twinkle on/off as it fades (firework glitter). */
  flicker: boolean;
  /** A rocket bursts into a shell of this colour when its life ends. */
  shell?: string;
}

export type Rand = () => number;

const CONFETTI = ['255,64,129', '124,77,255', '0,229,255', '255,215,64', '0,230,118', '255,109,64', '255,255,255'];
const HEARTS = ['255,62,120', '255,120,160', '255,30,80', '255,170,200'];
const SHELLS = ['255,214,120', '255,90,130', '120,210,255', '170,120,255', '120,255,170', '255,150,70'];

const r = (rand: Rand, a: number, b: number) => a + rand() * (b - a);

function base(p: Partial<FxParticle> & Pick<FxParticle, 'x' | 'y' | 'kind' | 'color'>): FxParticle {
  return {
    vx: 0, vy: 0, life: 1, maxLife: 1, size: 4, rot: 0, vrot: 0, gravity: 0, drag: 1,
    additive: false, trail: false, delay: 0, flicker: false, ...p,
  };
}

/** Two cannons from the bottom corners plus a pop from the middle. */
function confetti(rand: Rand): FxParticle[] {
  const out: FxParticle[] = [];
  const cannons = [
    { x: 30, y: FX_H * 0.92, a0: -Math.PI * 0.42, a1: -Math.PI * 0.22 },
    { x: FX_W - 30, y: FX_H * 0.92, a0: -Math.PI * 0.78, a1: -Math.PI * 0.58 },
  ];
  for (const c of cannons) {
    for (let i = 0; i < 70; i++) {
      const a = r(rand, c.a0, c.a1);
      const sp = r(rand, 900, 1500);
      out.push(base({
        x: c.x + r(rand, -10, 10), y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: r(rand, 2.4, 3.4), maxLife: 3.4, size: r(rand, 14, 24), rot: r(rand, 0, Math.PI), vrot: r(rand, -12, 12),
        gravity: 900, drag: 0.35, color: CONFETTI[i % CONFETTI.length], kind: 'rect',
      }));
    }
  }
  for (let i = 0; i < 40; i++) {
    const a = r(rand, -Math.PI, 0);
    const sp = r(rand, 400, 900);
    out.push(base({
      x: FX_W / 2, y: FX_H * 0.45, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: r(rand, 2, 3), maxLife: 3, size: r(rand, 12, 20), rot: r(rand, 0, Math.PI), vrot: r(rand, -12, 12),
      gravity: 800, drag: 0.4, color: CONFETTI[i % CONFETTI.length], kind: 'rect', delay: 0.08,
    }));
  }
  return out;
}

/** A rising cloud of big hearts from the bottom half, with a soft pink flash. */
function hearts(rand: Rand): FxParticle[] {
  const out: FxParticle[] = [base({ x: FX_W / 2, y: FX_H * 0.55, kind: 'flash', color: '255,90,140', size: 520, life: 0.6, maxLife: 0.6, additive: true })];
  for (let i = 0; i < 36; i++) {
    out.push(base({
      x: r(rand, 40, FX_W - 40), y: FX_H + r(rand, 0, 120), vx: r(rand, -60, 60), vy: r(rand, -520, -880),
      life: r(rand, 2.2, 3.2), maxLife: 3.2, size: r(rand, 34, 70), vrot: r(rand, -1.4, 1.4), gravity: 90, drag: 0.7,
      color: HEARTS[i % HEARTS.length], kind: 'heart', delay: r(rand, 0, 0.5),
    }));
  }
  return out;
}

/** Glints all over the frame, twinkling, plus a bright central shimmer. */
function sparkles(rand: Rand): FxParticle[] {
  const out: FxParticle[] = [base({ x: FX_W / 2, y: FX_H * 0.42, kind: 'flash', color: '255,240,190', size: 460, life: 0.5, maxLife: 0.5, additive: true })];
  for (let i = 0; i < 90; i++) {
    out.push(base({
      x: r(rand, 20, FX_W - 20), y: r(rand, 40, FX_H - 40), vx: r(rand, -30, 30), vy: r(rand, -60, 10),
      life: r(rand, 1, 2.2), maxLife: 2.2, size: r(rand, 6, 16), color: rand() > 0.5 ? '255,232,150' : '255,250,235',
      kind: 'spark', additive: true, delay: r(rand, 0, 0.6), flicker: true,
    }));
  }
  return out;
}

/** Rockets climb from the bottom on staggered fuses; each bursts into a shell. */
function fireworks(rand: Rand): FxParticle[] {
  const out: FxParticle[] = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x = FX_W * (0.18 + 0.64 * ((i + r(rand, 0.2, 0.8)) / n));
    const apex = FX_H * r(rand, 0.14, 0.36);
    const t = r(rand, 0.55, 0.75); // flight time
    const g = 260;
    // Launch speed that reaches the apex in t seconds under gravity g.
    const vy = -((FX_H * 0.98 - apex) / t + 0.5 * g * t);
    out.push(base({
      x, y: FX_H * 0.98, vx: r(rand, -40, 40), vy, life: t, maxLife: t, size: 5, gravity: g,
      color: '255,230,180', kind: 'rocket', additive: true, trail: true, delay: i * 0.32 + r(rand, 0, 0.1),
      shell: SHELLS[(i + Math.floor(rand() * SHELLS.length)) % SHELLS.length],
    }));
  }
  return out;
}

/** The burst for one style, in the canvas's 720×1280 space. */
export function burstParticles(style: BurstStyle, rand: Rand): FxParticle[] {
  switch (style) {
    case 'confetti': return confetti(rand);
    case 'hearts': return hearts(rand);
    case 'sparkles': return sparkles(rand);
    case 'fireworks': return fireworks(rand);
  }
}

/** A firework shell: a flash, a round peony of streaking stars, and glitter. */
export function shellParticles(x: number, y: number, color: string, rand: Rand): FxParticle[] {
  const out: FxParticle[] = [base({ x, y, kind: 'flash', color, size: 380, life: 0.35, maxLife: 0.35, additive: true })];
  const stars = 64;
  for (let i = 0; i < stars; i++) {
    const a = (i / stars) * Math.PI * 2 + r(rand, -0.05, 0.05);
    const sp = r(rand, 380, 520);
    out.push(base({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: r(rand, 1.3, 1.9), maxLife: 1.9, size: r(rand, 4, 6.5),
      gravity: 140, drag: 0.25, color, kind: 'dot', additive: true, trail: true,
    }));
  }
  for (let i = 0; i < 26; i++) {
    const a = r(rand, 0, Math.PI * 2);
    const sp = r(rand, 60, 300);
    out.push(base({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: r(rand, 1.4, 2.2), maxLife: 2.2, size: r(rand, 2.5, 4),
      gravity: 120, drag: 0.3, color: '255,245,220', kind: 'dot', additive: true, flicker: true, delay: r(rand, 0.15, 0.4),
    }));
  }
  return out;
}

/**
 * Advance every particle by dt (seconds) in place; returns the new particles a
 * finished rocket spawned. Dead particles are compacted out.
 */
export function stepParticles(list: FxParticle[], dt: number, rand: Rand): FxParticle[] {
  const born: FxParticle[] = [];
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.delay > 0) {
      p.delay -= dt;
      list[w++] = p;
      continue;
    }
    p.life -= dt;
    if (p.life <= 0) {
      if (p.shell !== undefined) born.push(...shellParticles(p.x, p.y, p.shell, rand));
      continue;
    }
    if (p.drag < 1) {
      const k = Math.pow(p.drag, dt);
      p.vx *= k;
      p.vy *= k;
    }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    list[w++] = p;
  }
  list.length = w;
  return born;
}

/** Append respecting the cap; returns how many were dropped. */
export function addParticles(list: FxParticle[], add: readonly FxParticle[]): number {
  const room = Math.max(0, FX_MAX_PARTICLES - list.length);
  for (let i = 0; i < Math.min(room, add.length); i++) list.push(add[i]);
  return Math.max(0, add.length - room);
}
