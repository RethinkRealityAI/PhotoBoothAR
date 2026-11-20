/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cardPapercut — the pure maths behind the 'papercut' card reveal
 * (components/cards/reveals/PapercutReveal.tsx): a pop-up paper diorama of
 * cut-paper pieces (stars and a moon, three rolling hill layers with trees
 * and flowers, clouds, hot-air balloons, bunting, a grass edge) plus the
 * confetti of paper bits that bursts when the card rises.
 *
 * DETERMINISTIC by design: everything is seeded from the card title through
 * FNV-1a → mulberry32 (lib/brandLanding.ts seededRandom), never Math.random,
 * so a card always opens onto the same little world and tests can pin it.
 *
 * Coordinates are a DESIGN SPACE 1000 units wide and `1000 × aspect` tall
 * (aspect = stage height / width), so the renderer can lay every piece out
 * in percentages and the scene fits any phone or desktop stage without
 * stretching a circle into an ellipse.
 *
 * PURE: no React, no DOM.
 */
import { seededRandom } from './brandLanding';
import { mixHex } from './cardRibbon';
import { normalizeHex } from './themeDerive';

export const DESIGN_W = 1000;

/**
 * Extra paper past each side edge on the full-width pieces (hills, grass,
 * bunting), in design units. Parallax moves the nearest layers ~25 px and the
 * pop-up swells them ~8 %, so the cut edge must never come into view.
 */
export const OVERHANG = 120;

/** FNV-1a 32-bit — turns a title into a seed. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const f = (n: number): string => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0');

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

export interface PaperPalette {
  skyTop: string;
  skyLow: string;
  /** far → near */
  hills: [string, string, string];
  grass: string;
  tree: string;
  paper: string;
  paperShade: string;
  gold: string;
  peach: string;
  lilac: string;
  /** Bunting / balloon / confetti rotation. */
  festive: string[];
}

export const PAPER_GOLD = '#FFC56B';

/** Every colour is derived from the card palette, plus paper white and the warm core. */
export function papercutPalette(palette: { bg: string; accent: string }): PaperPalette {
  const bg = normalizeHex(palette.bg) ?? '#33318A';
  const accent = normalizeHex(palette.accent) ?? '#D4D6FF';
  const paper = mixHex(accent, '#FFFFFF', 0.82);
  const peach = mixHex(PAPER_GOLD, accent, 0.42);
  const lilac = mixHex(accent, bg, 0.28);
  return {
    skyTop: mixHex(bg, '#0B0A26', 0.3),
    skyLow: mixHex(bg, accent, 0.22),
    // value carries the depth: far hills sink into the dusk, near ones lighten toward paper
    hills: [mixHex(bg, accent, 0.42), mixHex(bg, accent, 0.64), mixHex(accent, '#FFFFFF', 0.12)],
    grass: mixHex(accent, '#FFFFFF', 0.7),
    tree: mixHex(bg, accent, 0.8),
    paper,
    paperShade: mixHex(accent, bg, 0.45),
    gold: PAPER_GOLD,
    peach,
    lilac,
    festive: [PAPER_GOLD, paper, lilac, peach],
  };
}

/* ------------------------------------------------------------------ */
/* Shape primitives (local coordinates)                                */
/* ------------------------------------------------------------------ */

export function starPath(cx: number, cy: number, r: number, rot = 0, points = 5): string {
  const n = Math.max(3, Math.round(points));
  let d = '';
  for (let i = 0; i < n * 2; i += 1) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 === 0 ? r : r * 0.45;
    d += `${i === 0 ? 'M' : 'L'}${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`;
  }
  return `${d}Z`;
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
}

/** A crescent moon: a disc minus an offset disc, as one even-odd-free path. */
export function moonPath(cx: number, cy: number, r: number): string {
  const ir = r * 0.86;
  // outer arc (left, large) then a smaller arc back (bites the disc)
  const top = { x: cx + r * 0.36, y: cy - r * 0.93 };
  const bottom = { x: cx + r * 0.58, y: cy + r * 0.81 };
  return `M${f(top.x)} ${f(top.y)}A${f(r)} ${f(r)} 0 1 0 ${f(bottom.x)} ${f(bottom.y)}A${f(ir)} ${f(ir)} 0 0 1 ${f(top.x)} ${f(top.y)}Z`;
}

/** A cut-paper cloud: a flat base with `bumps` round tops along it. */
export function cloudPath(w: number, h: number, bumps: readonly number[]): string {
  const n = Math.max(2, bumps.length);
  const base = h * 0.92;
  const pad = w * 0.06;
  const step = (w - pad * 2) / n;
  let d = `M${f(pad)} ${f(base)}`;
  for (let i = 0; i < n; i += 1) {
    const x1 = pad + (i + 1) * step;
    // middle bumps rise higher than the ends
    const centre = 1 - Math.abs((i + 0.5) / n - 0.5) * 1.2;
    // large-arc bumps (more than a half circle) are what make it puff
    const r = step * Math.min(0.8, Math.max(0.52, (0.5 + centre * 0.22) * (bumps[i] ?? 1)));
    d += `A${f(r)} ${f(r)} 0 1 1 ${f(x1)} ${f(i === n - 1 ? base : base - h * 0.06)}`;
  }
  return `${d}Z`;
}

/* ------------------------------------------------------------------ */
/* The scene                                                           */
/* ------------------------------------------------------------------ */

export interface PaperShape {
  d: string;
  fill: string;
  opacity?: number;
  /** Stroke-only shapes (strings, ropes, ridge highlights). */
  stroke?: string;
  strokeWidth?: number;
}

export type PieceKind = 'stars' | 'hill' | 'cloud' | 'balloon' | 'bunting' | 'grass';

export interface PaperPiece {
  id: string;
  kind: PieceKind;
  /** Box in design units (x, y from the stage's top-left). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Parallax depth: 0 = sky, ~1 = closest to the viewer. */
  depth: number;
  shapes: PaperShape[];
  /** Where it goes when the pop-up opens, in design units (relative). */
  exit: { x: number; y: number; rotate: number };
  /** Tap it and it bounces. */
  boopable: boolean;
}

export interface PapercutScene {
  width: number;
  height: number;
  /** Back to front. */
  pieces: PaperPiece[];
}

function ridgeY(x: number, base: number, amps: readonly number[], freqs: readonly number[], phases: readonly number[]): number {
  let y = base;
  for (let i = 0; i < amps.length; i += 1) y -= amps[i] * Math.sin(x * freqs[i] + phases[i]);
  return y;
}

/**
 * A hill layer: a wavy ridge filled down past the bottom of the box (extra
 * paper below the stage edge, so springing up never shows a gap).
 */
function hillPiece(
  id: string,
  rnd: () => number,
  H: number,
  baseFrac: number,
  amp: number,
  fill: string,
  highlight: string,
  depth: number,
): { piece: PaperPiece; ridge: (x: number) => number } {
  const base = H * baseFrac;
  const amps = [amp * (0.7 + rnd() * 0.5), amp * (0.25 + rnd() * 0.25)];
  const freqs = [(Math.PI * 2 * (0.8 + rnd() * 0.6)) / DESIGN_W, (Math.PI * 2 * (2.2 + rnd() * 1.4)) / DESIGN_W];
  const phases = [rnd() * Math.PI * 2, rnd() * Math.PI * 2];
  const ridge = (x: number) => ridgeY(x, base, amps, freqs, phases);
  const top = base - amp * 1.4;
  const bottom = H + 180; // paper under the stage edge: the pop-up lifts layers ~30 px
  const N = 48;
  const pts: string[] = [];
  for (let i = 0; i <= N; i += 1) {
    const x = -OVERHANG + (i / N) * (DESIGN_W + OVERHANG * 2);
    pts.push(`${f(x + OVERHANG)} ${f(ridge(x) - top)}`);
  }
  const d = `M${pts.join('L')}L${f(DESIGN_W + OVERHANG * 2)} ${f(bottom - top)}L0 ${f(bottom - top)}Z`;
  const edge = `M${pts.join('L')}`;
  return {
    ridge,
    piece: {
      id,
      kind: 'hill',
      x: -OVERHANG,
      y: top,
      w: DESIGN_W + OVERHANG * 2,
      h: bottom - top,
      depth,
      shapes: [
        { d, fill },
        { d: edge, fill: 'none', stroke: highlight, strokeWidth: 3, opacity: 0.6 },
      ],
      exit: { x: 0, y: H * (0.55 + depth * 0.35), rotate: 0 },
      boopable: false,
    },
  };
}

function balloonPiece(id: string, x: number, y: number, size: number, colors: [string, string], pal: PaperPalette, depth: number, side: -1 | 1): PaperPiece {
  const w = size;
  const h = size * 1.42;
  const cx = w / 2;
  const er = w * 0.46; // envelope radius
  const ey = er + 2;
  // envelope: round top, tapering to the throat
  const throatY = ey + er * 1.32;
  const tw = w * 0.13;
  const env = `M${f(cx - tw)} ${f(throatY)}C${f(cx - er * 1.05)} ${f(ey + er * 0.7)} ${f(cx - er * 1.1)} ${f(ey - er * 0.2)} ${f(cx - er)} ${f(ey)}A${f(er)} ${f(er)} 0 0 1 ${f(cx + er)} ${f(ey)}C${f(cx + er * 1.1)} ${f(ey - er * 0.2)} ${f(cx + er * 1.05)} ${f(ey + er * 0.7)} ${f(cx + tw)} ${f(throatY)}Z`;
  // two lens-shaped gores, the classic stripes
  const gore = (k: number) => {
    const gx = cx + k * er * 0.48;
    return `M${f(cx + k * tw * 0.5)} ${f(throatY)}Q${f(gx + k * er * 0.18)} ${f(ey)} ${f(cx + k * er * 0.1)} ${f(ey - er + 1)}Q${f(gx - k * er * 0.38)} ${f(ey)} ${f(cx + k * tw * 0.5)} ${f(throatY)}Z`;
  };
  const basketY = h - w * 0.2;
  const bw = w * 0.22;
  const ropes = `M${f(cx - tw)} ${f(throatY)}L${f(cx - bw / 2)} ${f(basketY)}M${f(cx + tw)} ${f(throatY)}L${f(cx + bw / 2)} ${f(basketY)}`;
  const basket = `M${f(cx - bw / 2)} ${f(basketY)}h${f(bw)}l${f(-bw * 0.1)} ${f(w * 0.15)}h${f(-bw * 0.8)}Z`;
  const shine = `M${f(cx - er * 0.62)} ${f(ey - er * 0.15)}Q${f(cx - er * 0.6)} ${f(ey - er * 0.72)} ${f(cx - er * 0.12)} ${f(ey - er * 0.86)}Q${f(cx - er * 0.48)} ${f(ey - er * 0.58)} ${f(cx - er * 0.62)} ${f(ey - er * 0.15)}Z`;
  return {
    id,
    kind: 'balloon',
    x: x - w / 2,
    y,
    w,
    h,
    depth,
    shapes: [
      { d: env, fill: colors[0] },
      { d: gore(-1), fill: colors[1] },
      { d: gore(1), fill: colors[1] },
      { d: shine, fill: pal.paper, opacity: 0.45 },
      { d: ropes, fill: 'none', stroke: pal.paperShade, strokeWidth: 2 },
      { d: basket, fill: pal.peach },
    ],
    exit: { x: side * 140, y: -(y + h + 400), rotate: side * 8 },
    boopable: true,
  };
}

function cloudPiece(id: string, rnd: () => number, x: number, y: number, w: number, fill: string, depth: number): PaperPiece {
  const h = w * (0.42 + rnd() * 0.1);
  const n = 3 + Math.floor(rnd() * 2);
  const bumps = Array.from({ length: n }, () => 0.85 + rnd() * 0.5);
  const side: -1 | 1 = x + w / 2 < DESIGN_W / 2 ? -1 : 1;
  return {
    id,
    kind: 'cloud',
    x,
    y,
    w,
    h,
    depth,
    shapes: [{ d: cloudPath(w, h, bumps), fill }],
    exit: { x: side * (DESIGN_W * 0.9 + w), y: -40 - rnd() * 60, rotate: side * (4 + rnd() * 6) },
    boopable: true,
  };
}

function buntingPiece(id: string, side: -1 | 1, pal: PaperPalette, rnd: () => number, H: number): PaperPiece {
  const w = DESIGN_W / 2 + OVERHANG;
  const h = Math.min(H * 0.2, 300);
  const x0 = side === -1 ? -OVERHANG : DESIGN_W / 2;
  // a garland sagging to its lowest point at the centre of the stage
  // (hung a little low, so the corners stay clear for the experience's Skip button)
  const sag = (gx: number) => 118 + 80 * (1 - ((gx - DESIGN_W / 2) / (DESIGN_W / 2 + OVERHANG)) ** 2);
  const shapes: PaperShape[] = [];
  const pts: string[] = [];
  for (let i = 0; i <= 20; i += 1) {
    const gx = x0 + (i / 20) * w;
    pts.push(`${f(gx - x0)} ${f(sag(gx))}`);
  }
  shapes.push({ d: `M${pts.join('L')}`, fill: 'none', stroke: pal.paper, strokeWidth: 2.5, opacity: 0.85 });
  const count = 7;
  const off = Math.floor(rnd() * pal.festive.length);
  for (let i = 0; i < count; i += 1) {
    const gx = x0 + ((i + 0.5) / count) * w;
    const lx = gx - x0;
    const y1 = sag(gx - 26);
    const y2 = sag(gx + 26);
    const ym = (y1 + y2) / 2;
    const flag = `M${f(lx - 26)} ${f(y1)}L${f(lx + 26)} ${f(y2)}L${f(lx + 2)} ${f(ym + 62)}Z`;
    shapes.push({ d: flag, fill: pal.festive[(i + off + (side === 1 ? count : 0)) % pal.festive.length] });
  }
  return {
    id,
    kind: 'bunting',
    x: x0,
    y: 0,
    w,
    h,
    depth: 1,
    shapes,
    exit: { x: side * 620, y: -260, rotate: side * 22 },
    boopable: false,
  };
}

/**
 * The whole diorama for a card, back to front. `aspect` = stage h / w
 * (clamped to a sane portrait/landscape range).
 */
export function papercutScene(seed: string, aspect: number, palette: { bg: string; accent: string }): PapercutScene {
  const pal = papercutPalette(palette);
  const a = Number.isFinite(aspect) ? Math.min(2.6, Math.max(0.9, aspect)) : 2;
  const H = Math.round(DESIGN_W * a);
  const rnd = seededRandom(hashSeed(seed === '' ? 'beamwall' : seed));
  const pieces: PaperPiece[] = [];

  // — sky: stars + a crescent moon (one piece, far back)
  const skyH = H * 0.6;
  const starShapes: PaperShape[] = [];
  const mx = 180 + rnd() * 640;
  const my = 150 + rnd() * skyH * 0.25;
  starShapes.push({ d: moonPath(mx, my, 46), fill: pal.paper, opacity: 0.95 });
  for (let i = 0; i < 18; i += 1) {
    const sx = 40 + rnd() * (DESIGN_W - 80);
    const sy = 140 + rnd() * (skyH - 160);
    if (Math.hypot(sx - mx, sy - my) < 90) continue;
    const big = rnd() < 0.3;
    starShapes.push({
      d: starPath(sx, sy, big ? 14 + rnd() * 6 : 6 + rnd() * 5, rnd() * Math.PI),
      fill: rnd() < 0.4 ? pal.gold : pal.paper,
      opacity: big ? 1 : 0.85,
    });
  }
  pieces.push({
    id: 'stars',
    kind: 'stars',
    x: 0,
    y: 0,
    w: DESIGN_W,
    h: skyH,
    depth: 0.12,
    shapes: starShapes,
    exit: { x: 0, y: -skyH * 0.06, rotate: 0 },
    boopable: false,
  });

  // — far hills, back clouds, a small balloon
  const far = hillPiece('hill-far', rnd, H, 0.62, 46, pal.hills[0], pal.paper, 0.28);
  pieces.push(cloudPiece('cloud-1', rnd, 40 + rnd() * 160, H * 0.2 + rnd() * H * 0.06, 230 + rnd() * 60, mixHex(pal.paper, pal.skyLow, 0.35), 0.36));
  pieces.push(cloudPiece('cloud-2', rnd, 600 + rnd() * 160, H * 0.3 + rnd() * H * 0.05, 200 + rnd() * 60, mixHex(pal.paper, pal.skyLow, 0.35), 0.38));
  pieces.push(far.piece);
  pieces.push(balloonPiece('balloon-small', 190 + rnd() * 90, H * 0.37 + rnd() * H * 0.04, 92, [pal.lilac, pal.paper], pal, 0.46, -1));

  // — mid hills with paper trees on the ridge
  const mid = hillPiece('hill-mid', rnd, H, 0.71, 40, pal.hills[1], pal.paper, 0.6);
  const trees: PaperShape[] = [];
  const treeCount = 5;
  for (let i = 0; i < treeCount; i += 1) {
    const tx = 60 + ((i + rnd() * 0.6) / treeCount) * (DESIGN_W - 120);
    const ty = mid.ridge(tx) - mid.piece.y;
    const s = 26 + rnd() * 18;
    if (rnd() < 0.5) {
      trees.push({ d: `M${f(tx - 3)} ${f(ty + 6)}h6v${f(-s * 0.9)}h-6Z`, fill: pal.paperShade });
      trees.push({ d: circlePath(tx, ty - s * 1.05, s * 0.55), fill: pal.tree });
    } else {
      trees.push({
        d: `M${f(tx)} ${f(ty - s * 1.9)}L${f(tx + s * 0.55)} ${f(ty - s * 0.7)}L${f(tx + s * 0.32)} ${f(ty - s * 0.7)}L${f(tx + s * 0.7)} ${f(ty + 4)}L${f(tx - s * 0.7)} ${f(ty + 4)}L${f(tx - s * 0.32)} ${f(ty - s * 0.7)}L${f(tx - s * 0.55)} ${f(ty - s * 0.7)}Z`,
        fill: pal.tree,
      });
    }
  }
  // trees sit behind the ridge highlight, in front of the hill fill
  mid.piece.shapes = [mid.piece.shapes[0], ...trees, mid.piece.shapes[1]];
  pieces.push(mid.piece);

  // — the hero balloon, front clouds
  pieces.push(balloonPiece('balloon', 600 + rnd() * 140, H * 0.16 + rnd() * H * 0.05, 168, [pal.gold, pal.peach], pal, 0.62, 1));
  pieces.push(cloudPiece('cloud-3', rnd, -40 + rnd() * 60, H * 0.47 + rnd() * H * 0.04, 260 + rnd() * 50, pal.paper, 0.72));
  pieces.push(cloudPiece('cloud-4', rnd, 700 + rnd() * 80, H * 0.52 + rnd() * H * 0.03, 220 + rnd() * 50, pal.paper, 0.74));

  // — near hills dotted with paper flowers
  const near = hillPiece('hill-near', rnd, H, 0.81, 34, pal.hills[2], pal.paper, 0.86);
  const flowers: PaperShape[] = [];
  for (let i = 0; i < 9; i += 1) {
    const fx = 30 + rnd() * (DESIGN_W - 60);
    const fy = near.ridge(fx) - near.piece.y + 26 + rnd() * 70;
    const r = 7 + rnd() * 5;
    flowers.push({ d: starPath(fx, fy, r * 1.4, rnd(), 5), fill: rnd() < 0.5 ? pal.paper : pal.gold, opacity: 0.95 });
    flowers.push({ d: circlePath(fx, fy, r * 0.42), fill: pal.peach });
  }
  near.piece.shapes = [near.piece.shapes[0], ...flowers, near.piece.shapes[1]];
  pieces.push(near.piece);

  // — the frame of the diorama: bunting across the top, a grass edge below
  pieces.push(buntingPiece('bunting-left', -1, pal, rnd, H));
  pieces.push(buntingPiece('bunting-right', 1, pal, rnd, H));
  const gTop = H * 0.935;
  const gH = H - gTop + 180;
  // a fringe of cut grass blades, each a slightly different height and lean
  const gW = DESIGN_W + OVERHANG * 2;
  let grass = `M0 ${f(gH)}L0 40`;
  const blades = 42;
  for (let i = 0; i < blades; i += 1) {
    const x0 = (i / blades) * gW;
    const x1 = ((i + 1) / blades) * gW;
    const tip = 4 + rnd() * 26;
    const lean = (rnd() - 0.5) * 12;
    grass += `L${f((x0 + x1) / 2 + lean)} ${f(tip)}L${f(x1)} 40`;
  }
  grass += `L${f(gW)} ${f(gH)}Z`;
  pieces.push({
    id: 'grass',
    kind: 'grass',
    x: -OVERHANG,
    y: gTop,
    w: gW,
    h: gH,
    depth: 1.12,
    shapes: [{ d: grass, fill: pal.grass }],
    exit: { x: 0, y: gH + 260, rotate: 0 },
    boopable: false,
  });

  return { width: DESIGN_W, height: H, pieces };
}

/* ------------------------------------------------------------------ */
/* Confetti                                                            */
/* ------------------------------------------------------------------ */

export type ConfettiShape = 'rect' | 'circle' | 'triangle' | 'star';

export interface ConfettiPiece {
  shape: ConfettiShape;
  color: string;
  /** Size in px (rendered size, not design units). */
  size: number;
  /** Burst vector in px from the origin. */
  dx: number;
  dy: number;
  /** Extra drift while falling, px. */
  fall: number;
  spin: number;
  delay: number;
}

export function papercutConfetti(seed: string, count: number, colors: readonly string[], spread: number): ConfettiPiece[] {
  const n = Math.min(80, Math.max(0, Math.round(Number.isFinite(count) ? count : 0)));
  const rnd = seededRandom(hashSeed(`${seed}#confetti`));
  const shapes: ConfettiShape[] = ['rect', 'circle', 'triangle', 'star'];
  const palette = colors.length > 0 ? colors : ['#FFFFFF'];
  const out: ConfettiPiece[] = [];
  for (let i = 0; i < n; i += 1) {
    // mostly upward fan, so the bits rise then flutter down past the card
    const angle = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.5;
    const dist = spread * (0.45 + rnd() * 0.55);
    out.push({
      shape: shapes[Math.floor(rnd() * shapes.length)],
      color: palette[i % palette.length],
      size: 9 + rnd() * 8,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      fall: spread * (0.5 + rnd() * 0.6),
      spin: (rnd() - 0.5) * 900,
      delay: rnd() * 0.25,
    });
  }
  return out;
}

/** Smooth a parallax target: frame-rate independent exponential follow. */
export function followStep(current: number, target: number, dtMs: number, halfLifeMs = 140): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return 0;
  const dt = Math.max(0, Math.min(dtMs, 100));
  const k = 1 - Math.pow(0.5, dt / Math.max(halfLifeMs, 1));
  return current + (target - current) * k;
}

/**
 * Device tilt → a parallax target in [-1, 1]². gamma = left/right (±90),
 * beta = front/back; a phone is held at ~45° so that is the neutral pose.
 */
export function tiltToParallax(beta: number | null, gamma: number | null): { x: number; y: number } {
  const g = typeof gamma === 'number' && Number.isFinite(gamma) ? gamma : 0;
  const b = typeof beta === 'number' && Number.isFinite(beta) ? beta : 45;
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
  return { x: clamp1(g / 25), y: clamp1((b - 45) / 25) };
}
