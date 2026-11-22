/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * liveGates — gateways drawn piece by piece in code, so every piece moves.
 *
 * The painted designs open as whole images (a door swings, a wall slides).
 * A live gate is made of separate pieces the opening animates one by one:
 *
 *   balloons  a wall of balloons; hold the seal and they let go one by one
 *             from the middle out, bobbing and drifting up and away
 *   curtains  red velvet stage curtains; pull them apart and they gather to
 *             the sides, their folds bunching, the pelmet lifting away
 *
 * Pure: pieces are generated from a seed, and `livePose` says where a piece
 * is at opening-timeline time `t` (the same 0..1 as sceneFrame), so the
 * component (components/cards/scenes/LiveGate.tsx), the rasteriser that
 * writes the design's still gate.webp (scripts/render-vector-art.mjs) and
 * the tests all read the same numbers. Stage space: 900 x 1600.
 */

export type LiveGateKind = 'balloons' | 'curtains';
export const LIVE_GATE_KINDS: readonly LiveGateKind[] = ['balloons', 'curtains'];
/** One fixed seed: the still gate.webp and the live gate are the same arrangement. */
export const LIVE_SEED = 'live';

const W = 900;
const H = 1600;
const CX = 450;
const CY = 760;

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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Lighten (f > 0) or darken (f < 0) a #RRGGBB colour. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const out = f >= 0 ? v + (255 - v) * f : v * (1 + f);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

export interface LivePiece {
  /** Stable key (also the DOM data attribute). */
  key: string;
  /** Home position in stage units. */
  x: number;
  y: number;
  /** Inner SVG, drawn around (0,0). Empty for pieces whose shape is a pose `d`. */
  body: string;
  /** 0..1, distance of the home from the gateway centre (for staggering). */
  dist: number;
  /** Per-piece randomness, 0..1. */
  rand: number;
  /** Per-piece phase, radians. */
  phase: number;
}

export interface LivePose {
  /** SVG transform for the piece's group. */
  transform: string;
  opacity: number;
  /** For shape-shifting pieces (curtains): the outline right now. */
  d?: string;
}

export const BALLOON_COLORS = ['#F07B6B', '#7C83D6', '#FFD36B', '#C9A8FF', '#FFFFFF', '#5ED1C6', '#FF9EC4'] as const;
const BALLOON_WALL = '#FBE7D6';

function balloonBody(ci: number, r: number): string {
  const ry = r * 1.16;
  const c = BALLOON_COLORS[ci];
  const knot = shade(c, -0.25);
  return (
    `<path d="M0 ${r1(ry + 2)} C 14 ${r1(ry + 50)} -14 ${r1(ry + 95)} 6 ${r1(ry + 150)}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2"/>` +
    `<path d="M-8 ${r1(ry + 12)} L0 ${r1(ry - 2)} L8 ${r1(ry + 12)} Z" fill="${knot}"/>` +
    `<ellipse rx="${r1(r)}" ry="${r1(ry)}" fill="url(#lg-b${ci})"/>` +
    `<ellipse cx="${r1(-r * 0.36)}" cy="${r1(-ry * 0.42)}" rx="${r1(r * 0.16)}" ry="${r1(ry * 0.27)}" transform="rotate(-24 ${r1(-r * 0.36)} ${r1(-ry * 0.42)})" fill="rgba(255,255,255,0.6)"/>`
  );
}

/** Every piece of a live gate, back to front. */
export function livePieces(kind: LiveGateKind, seed = 'live'): LivePiece[] {
  const rand = mulberry32(hash(`${kind}|${seed}`));
  if (kind === 'curtains') {
    return ['left', 'right', 'valance'].map((key, i) => ({
      key,
      x: 0,
      y: 0,
      body: '',
      dist: key === 'valance' ? 1 : 0,
      rand: rand(),
      phase: i * 1.7,
    }));
  }
  const out: LivePiece[] = [];
  let i = 0;
  for (let row = 0, y = -20; y < H + 80; row++, y += 112) {
    for (let x = row % 2 ? -10 : 50; x < W + 60; x += 120) {
      const jx = (rand() - 0.5) * 40;
      const jy = (rand() - 0.5) * 36;
      const r = 60 + rand() * 18;
      const ci = Math.floor(rand() * BALLOON_COLORS.length) % BALLOON_COLORS.length;
      const hx = x + jx;
      const hy = y + jy;
      out.push({
        key: `b${i++}`,
        x: hx,
        y: hy,
        body: balloonBody(ci, r),
        dist: Math.min(1, Math.hypot(hx - CX, (hy - CY) * 0.62) / 640),
        rand: rand(),
        phase: rand() * Math.PI * 2,
      });
    }
  }
  // Smaller balloons sit further back.
  return out.sort((a, b) => a.rand - b.rand);
}

/** Shared <defs> the pieces' bodies refer to. */
export function liveDefs(kind: LiveGateKind): string {
  if (kind === 'balloons') {
    return BALLOON_COLORS.map(
      (c, i) =>
        `<radialGradient id="lg-b${i}" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="${shade(c, 0.45)}"/><stop offset="0.45" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.32)}"/></radialGradient>`,
    ).join('');
  }
  // Velvet: the folds are stops of a gradient across the curtain's own box,
  // so as a curtain narrows its folds bunch up with it.
  const folds = 11;
  let stops = '';
  for (let k = 0; k <= folds * 2; k++) {
    const o = k / (folds * 2);
    const c = k % 2 === 0 ? '#5E0B18' : '#B0213A';
    stops += `<stop offset="${o.toFixed(3)}" stop-color="${c}"/>`;
  }
  return (
    `<linearGradient id="lg-velvet" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>` +
    `<linearGradient id="lg-velvet-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="0.25" stop-color="#000" stop-opacity="0"/><stop offset="0.85" stop-color="#000" stop-opacity="0.1"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient>` +
    `<linearGradient id="lg-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset="0.5" stop-color="#E2B04F"/><stop offset="1" stop-color="#A9761F"/></linearGradient>`
  );
}

/* ------------------------------------------------------------------ */
/* Poses                                                               */
/* ------------------------------------------------------------------ */

/** How open the gate is at timeline t (same curve sceneFrame uses for slides and doors). */
export function liveOpen(t: number): number {
  return easeInOut(seg(Number.isFinite(t) ? t : 1, 0, 0.55));
}

/** The left curtain's outline at openness `o` (the right one is its mirror). */
export function curtainPath(o: number, timeS = 0, side: 'left' | 'right' = 'left'): string {
  const g = Number.isFinite(o) ? clamp01(o) : 1;
  const ts = Number.isFinite(timeS) ? timeS : 0;
  const top = 150;
  const bottom = H + 30;
  const inner = 470 - g * 350; // the leading edge travels to the side
  const tie = g * 110; // gathered at the tie-back: the edge bows outward mid-height
  const ripple = (1 - g) * 5;
  const pts: Array<[number, number]> = [[-30, top], [inner, top]];
  const n = 18;
  for (let i = 1; i <= n; i++) {
    const y = top + ((bottom - top) * i) / n;
    const k = Math.sin((Math.PI * (y - top)) / (bottom - top));
    const x = inner - tie * k ** 1.5 + Math.sin(y / 85 + ts * 1.4) * ripple;
    pts.push([x, y]);
  }
  pts.push([-30, bottom]);
  const map = (x: number) => (side === 'left' ? x : W - x);
  return `M${pts.map(([x, y]) => `${r1(map(x))} ${r1(y)}`).join(' L')} Z`;
}

/**
 * Where a piece is at opening time `t` (0..1). `charge` (0..1) is the held
 * seal before the gate gives; `timeS` drives the idle life (balloons bob,
 * velvet ripples); reduced motion stills both.
 */
export function livePose(kind: LiveGateKind, p: LivePiece, t: number, charge = 0, timeS = 0, reducedMotion = false): LivePose {
  const tt = Number.isFinite(t) ? clamp01(t) : 1;
  const c = Number.isFinite(charge) ? clamp01(charge) : 0;
  const idle = reducedMotion || !Number.isFinite(timeS) ? 0 : timeS;
  if (kind === 'curtains') {
    const o = liveOpen(tt);
    if (p.key === 'valance') {
      const lift = easeInOut(seg(tt, 0.28, 0.62));
      return { transform: `translate(0 ${r1(-lift * 300)})`, opacity: 1 };
    }
    return { transform: '', opacity: 1, d: curtainPath(o, idle, p.key === 'right' ? 'right' : 'left') };
  }
  // Balloons: let go from the middle out across the first ~60% of the opening.
  const u = seg(tt, 0, 0.62);
  const delay = Math.min(0.55, p.dist * 0.42 + p.rand * 0.13);
  const a = u <= delay ? 0 : (u - delay) / (1 - delay);
  const bob = Math.sin(idle * 1.3 + p.phase) * (3 + c * 7) + (c > 0 ? Math.sin(idle * 9 + p.phase) * c * 3 : 0);
  // Enough to carry every balloon, string and all, past the top of the frame.
  const rise = a * a * (p.y + 420 + p.rand * 500);
  const drift = (p.rand - 0.5) * 2;
  const x = p.x + Math.sin(a * 5 + p.phase) * 28 * a + drift * 140 * a;
  const y = p.y + bob - rise;
  const rot = Math.sin(a * 4 + p.phase) * 10 * a + drift * 14 * a + Math.sin(idle * 0.9 + p.phase) * 2;
  const scale = 1 - 0.22 * a;
  return { transform: `translate(${r1(x)} ${r1(y)}) rotate(${r1(rot)}) scale(${scale.toFixed(3)})`, opacity: 1 };
}

/** The wall behind the balloons: there while closed, gone as they let go. */
export function liveBaseOpacity(kind: LiveGateKind, t: number): number {
  if (kind !== 'balloons') return 0;
  return 1 - seg(Number.isFinite(t) ? t : 1, 0.02, 0.2);
}

/** The whole gate as one SVG string at time t (used for the still gate.webp and the film). */
export function liveGateSvg(kind: LiveGateKind, t = 0, seed = 'live'): string {
  const pieces = livePieces(kind, seed);
  let body = '';
  if (kind === 'balloons') {
    body += `<rect width="${W}" height="${H}" fill="${BALLOON_WALL}" opacity="${liveBaseOpacity(kind, t)}"/>`;
    for (const p of pieces) {
      const q = livePose(kind, p, t, 0, 0, true);
      body += `<g transform="${q.transform}">${p.body}</g>`;
    }
  } else {
    for (const p of pieces) {
      const q = livePose(kind, p, t, 0, 0, true);
      if (p.key === 'valance') body += `<g transform="${q.transform}">${valanceSvg()}</g>`;
      else body += curtainSvg(q.d ?? '');
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${liveDefs(kind)}</defs>${body}</svg>`;
}

/** One curtain: velvet folds, top-and-bottom shading, a gold fringe along the edge. */
export function curtainSvg(d: string): string {
  return (
    `<path d="${d}" fill="url(#lg-velvet)"/>` +
    `<path d="${d}" fill="url(#lg-velvet-shade)"/>` +
    `<path d="${d}" fill="none" stroke="#3A040C" stroke-opacity="0.5" stroke-width="3"/>`
  );
}

/** The pelmet: a scalloped velvet band with gold trim and tassels. */
export function valanceSvg(): string {
  let scallops = `M0 0 L${W} 0 L${W} 150`;
  const n = 6;
  for (let i = n; i > 0; i--) {
    const x1 = (W * (i - 1)) / n;
    const xm = (W * (i - 0.5)) / n;
    scallops += ` Q${r1(xm)} 225 ${r1(x1)} 150`;
  }
  scallops += ' Z';
  let tassels = '';
  for (let i = 1; i < n; i++) {
    const x = (W * i) / n;
    tassels += `<path d="M${x} 150 L${x} 190" stroke="url(#lg-gold)" stroke-width="4"/><path d="M${x - 9} 190 Q${x} 178 ${x + 9} 190 L${x + 6} 228 L${x - 6} 228 Z" fill="url(#lg-gold)"/>`;
  }
  return (
    `<path d="${scallops}" fill="url(#lg-velvet)"/>` +
    `<path d="${scallops}" fill="url(#lg-velvet-shade)"/>` +
    `<rect x="0" y="0" width="${W}" height="34" fill="url(#lg-gold)"/>` +
    `<path d="${scallops.replace(/^M0 0 L900 0 L900 150/, 'M900 150').replace(/ Z$/, '')}" fill="none" stroke="url(#lg-gold)" stroke-width="7"/>` +
    tassels
  );
}
