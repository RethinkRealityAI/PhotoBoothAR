/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cardRibbon — the pure maths behind the 'ribbon' card reveal
 * (components/cards/reveals/RibbonReveal.tsx).
 *
 * Everything the reveal draws is generated here as SVG path data in stage
 * pixels, so the component is only wiring: the letterpress linework (an
 * arched, scalloped frame, rosettes and curling vines), the satin band, the
 * bow's loops and swallowtail tails, the drag-to-pull physics and the
 * palette the card face and satin are painted in.
 *
 * PURE: no React, no DOM — every function is deterministic and node-testable.
 * Path builders never emit NaN: degenerate sizes clamp to a minimum.
 */
import { contrastRatio, normalizeHex } from './themeDerive';

export interface Pt {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Number + path formatting                                            */
/* ------------------------------------------------------------------ */

const f = (n: number): string => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0');
const pt = (p: Pt): string => `${f(p.x)} ${f(p.y)}`;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Smooth closed/open polyline → quadratic-midpoint path (no corners). */
export function smoothPath(points: readonly Pt[], closed = false): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M${pt(points[0])}L${pt(points[1])}`;
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  if (closed) {
    const n = points.length;
    let d = `M${pt(mid(points[n - 1], points[0]))}`;
    for (let i = 0; i < n; i += 1) {
      d += `Q${pt(points[i])} ${pt(mid(points[i], points[(i + 1) % n]))}`;
    }
    return `${d}Z`;
  }
  let d = `M${pt(points[0])}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    d += `Q${pt(points[i])} ${pt(mid(points[i], points[i + 1]))}`;
  }
  return `${d}L${pt(points[points.length - 1])}`;
}

function polyline(points: readonly Pt[], closed = false): string {
  if (points.length === 0) return '';
  return `M${points.map(pt).join('L')}${closed ? 'Z' : ''}`;
}

function cubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt((normalizeHex(hex) ?? '#000000').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear mix of two '#RRGGBB' colours, t=0 → a, t=1 → b. Invalid input reads as black. */
export function mixHex(a: string, b: string, t: number): string {
  const k = clamp(Number.isFinite(t) ? t : 0, 0, 1);
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(ar + (br - ar) * k)}${h(ag + (bg - ag) * k)}${h(ab + (bb - ab) * k)}`.toUpperCase();
}

/**
 * Move `surface` away from `ink` (darker under light ink, lighter under dark
 * ink) in small steps until the pair reaches `min` contrast. Pure white or
 * black always ends the walk, so this terminates and never returns junk.
 */
export function ensureInkContrast(surface: string, ink: string, min = 4.5): string {
  const inkIsLight = contrastRatio(ink, '#000000') > contrastRatio(ink, '#FFFFFF');
  const toward = inkIsLight ? '#0B0A26' : '#FFFFFF';
  let s = normalizeHex(surface) ?? '#33318A';
  for (let i = 0; i < 24 && contrastRatio(s, ink) < min; i += 1) s = mixHex(s, toward, 0.12);
  return s;
}

export interface RibbonColors {
  /** The card face (letterpress paper). AA against `ink`. */
  face: string;
  /** A lighter and a deeper stop of the face, for the pearlescent wash. */
  faceLight: string;
  faceDeep: string;
  /** Title ink (palette fg). */
  ink: string;
  /** Embossed line highlight / shadow. */
  emboss: string;
  embossShadow: string;
  /** Satin: base, the bright crest of a fold, the trough of a fold. */
  satin: string;
  satinLight: string;
  satinDeep: string;
  /** Warm light that glints along the linework on untie. */
  warm: string;
  accent: string;
}

export const WARM_CORE = '#FFC56B';

/** The reveal's colours, all derived from the card palette (look-aware). */
export function ribbonColors(palette: { bg: string; fg: string; accent: string }): RibbonColors {
  const bg = normalizeHex(palette.bg) ?? '#33318A';
  const fg = normalizeHex(palette.fg) ?? '#FFFFFF';
  const accent = normalizeHex(palette.accent) ?? '#D4D6FF';
  const face = ensureInkContrast(mixHex(bg, accent, 0.26), fg, 4.5);
  return {
    face,
    faceLight: mixHex(face, accent, 0.32),
    faceDeep: mixHex(face, '#0B0A26', 0.3),
    ink: fg,
    emboss: mixHex(face, '#FFFFFF', 0.42),
    embossShadow: mixHex(face, '#05041A', 0.6),
    satin: mixHex(accent, '#FFFFFF', 0.35),
    // a breath of the warm core in the crest of each fold: pearl silk, not plastic
    satinLight: mixHex(mixHex(accent, '#FFFFFF', 0.85), WARM_CORE, 0.07),
    satinDeep: mixHex(accent, bg, 0.55),
    warm: WARM_CORE,
    accent,
  };
}

/* ------------------------------------------------------------------ */
/* Letterpress linework                                                */
/* ------------------------------------------------------------------ */

/**
 * The arched frame outline as a dense closed polyline: straight sides,
 * rounded bottom corners, a tall ogee arch with a fine point at the top.
 * Points run clockwise from the bottom-left corner.
 */
export function archFramePoints(w: number, h: number, inset: number): Pt[] {
  const W = Math.max(w, 60);
  const H = Math.max(h, 120);
  const x0 = inset;
  const x1 = W - inset;
  const yb = H - inset;
  const cx = W / 2;
  const span = x1 - x0;
  const archH = Math.min(span * 0.62, (H - 2 * inset) * 0.3);
  const yt = inset;
  const ys = yt + archH; // shoulder
  const r = Math.min(span * 0.08, 28);
  const out: Pt[] = [];
  const SEG = 28;
  // bottom-left corner → up the left side
  for (let i = 0; i <= 6; i += 1) {
    const a = Math.PI / 2 + (i / 6) * (Math.PI / 2);
    out.push({ x: x0 + r + Math.cos(a) * r, y: yb - r + Math.sin(a) * r });
  }
  out.push({ x: x0, y: ys });
  // left half of the ogee arch: bulge out, then sweep in to the point
  const l0: Pt = { x: x0, y: ys };
  const l1: Pt = { x: x0, y: ys - archH * 0.62 };
  const l2: Pt = { x: cx - span * 0.16, y: yt + archH * 0.3 };
  const l3: Pt = { x: cx, y: yt };
  for (let i = 1; i <= SEG; i += 1) out.push(cubic(l0, l1, l2, l3, i / SEG));
  const r0: Pt = { x: cx, y: yt };
  const r1: Pt = { x: cx + span * 0.16, y: yt + archH * 0.3 };
  const r2: Pt = { x: x1, y: ys - archH * 0.62 };
  const r3: Pt = { x: x1, y: ys };
  for (let i = 1; i <= SEG; i += 1) out.push(cubic(r0, r1, r2, r3, i / SEG));
  // down the right side → bottom-right corner
  for (let i = 0; i <= 6; i += 1) {
    const a = (i / 6) * (Math.PI / 2);
    out.push({ x: x1 - r + Math.cos(a) * r, y: yb - r + Math.sin(a) * r });
  }
  return out;
}

export function archFramePath(w: number, h: number, inset: number): string {
  return polyline(archFramePoints(w, h, inset), true);
}

/** Total length of a closed polyline. */
export function polylineLength(points: readonly Pt[], closed = true): number {
  let len = 0;
  const n = points.length;
  for (let i = 0; i < (closed ? n : n - 1); i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/** `count` points evenly spaced by arc length along a closed polyline. */
export function resampleClosed(points: readonly Pt[], count: number): Pt[] {
  const n = points.length;
  if (n < 2 || count < 1) return [];
  const total = polylineLength(points, true);
  const step = total / count;
  const out: Pt[] = [];
  let seg = 0;
  let segStart = 0; // arc length at points[seg]
  for (let k = 0; k < count; k += 1) {
    const target = k * step;
    for (;;) {
      const a = points[seg % n];
      const b = points[(seg + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (segStart + len >= target || seg >= n * 2) {
        const t = len > 0 ? (target - segStart) / len : 0;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        break;
      }
      segStart += len;
      seg += 1;
    }
  }
  return out;
}

/**
 * A scalloped border: semicircular bumps between evenly spaced points on the
 * frame, bulging OUTWARD (the frame runs clockwise, so outward = sweep 0).
 */
export function scallopPath(frame: readonly Pt[], spacing: number): { d: string; pearls: Pt[] } {
  const count = Math.max(8, Math.round(polylineLength(frame) / Math.max(spacing, 4)));
  const pts = resampleClosed(frame, count);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let d = `M${pt(pts[0])}`;
  const pearls: Pt[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const r = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    d += `A${f(r)} ${f(r)} 0 0 0 ${pt(b)}`;
    // pearl just inside each joint
    const dx = cx - a.x;
    const dy = cy - a.y;
    const dl = Math.hypot(dx, dy) || 1;
    pearls.push({ x: a.x + (dx / dl) * r * 0.9, y: a.y + (dy / dl) * r * 0.9 });
  }
  return { d: `${d}Z`, pearls };
}

/** A layered rosette: `petals` teardrop petals per ring, two rings, and a bud. */
export function rosettePath(cx: number, cy: number, r: number, petals = 8): string {
  const R = Math.max(r, 2);
  const n = Math.max(4, Math.round(petals));
  let d = '';
  const ring = (radius: number, rot: number, width: number) => {
    for (let i = 0; i < n; i += 1) {
      const a = rot + (i / n) * Math.PI * 2;
      const tip = { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
      const la = a - width;
      const ra = a + width;
      const c1 = { x: cx + Math.cos(la) * radius * 0.95, y: cy + Math.sin(la) * radius * 0.95 };
      const c2 = { x: cx + Math.cos(ra) * radius * 0.95, y: cy + Math.sin(ra) * radius * 0.95 };
      const base = { x: cx + Math.cos(a) * radius * 0.18, y: cy + Math.sin(a) * radius * 0.18 };
      d += `M${pt(base)}Q${pt(c1)} ${pt(tip)}Q${pt(c2)} ${pt(base)}Z`;
    }
  };
  ring(R, -Math.PI / 2, 0.42);
  ring(R * 0.62, -Math.PI / 2 + Math.PI / n, 0.5);
  const b = R * 0.2;
  d += `M${f(cx - b)} ${f(cy)}A${f(b)} ${f(b)} 0 1 0 ${f(cx + b)} ${f(cy)}A${f(b)} ${f(b)} 0 1 0 ${f(cx - b)} ${f(cy)}Z`;
  return d;
}

/** A leaf: a pointed ellipse along `angle`, with a centre vein. */
export function leafPath(x: number, y: number, angle: number, size: number): string {
  const s = Math.max(size, 1);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const tip = { x: x + ca * s, y: y + sa * s };
  const nx = -sa * s * 0.34;
  const ny = ca * s * 0.34;
  const m = { x: x + ca * s * 0.5, y: y + sa * s * 0.5 };
  return `M${pt({ x, y })}Q${pt({ x: m.x + nx, y: m.y + ny })} ${pt(tip)}Q${pt({ x: m.x - nx, y: m.y - ny })} ${pt({ x, y })}Z`;
}

/**
 * A curling vine (a decaying spiral) from (x, y) heading `angle`, curling
 * clockwise when `dir` = 1. Returns the stroke path plus leaf anchors.
 */
export function vine(
  x: number,
  y: number,
  angle: number,
  length: number,
  dir: 1 | -1,
): { d: string; leaves: { x: number; y: number; angle: number }[]; end: Pt } {
  const steps = 26;
  const pts: Pt[] = [{ x, y }];
  let a = angle;
  let px = x;
  let py = y;
  const leaves: { x: number; y: number; angle: number }[] = [];
  const L = Math.max(length, 4);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const seg = (L / steps) * (1 - t * 0.55);
    a += dir * (0.05 + t * t * 0.32);
    px += Math.cos(a) * seg;
    py += Math.sin(a) * seg;
    pts.push({ x: px, y: py });
    if (i % 6 === 3 && i < steps - 2) {
      leaves.push({ x: px, y: py, angle: a - dir * 1.0 });
    }
  }
  return { d: smoothPath(pts), leaves, end: { x: px, y: py } };
}

export interface Filigree {
  /** Stroked linework (vines, frame lines). */
  strokes: string[];
  /** Filled linework (rosettes, leaves, pearls). */
  fills: string[];
}

/**
 * A symmetric floral cluster centred on (cx, cy): a rosette with two vines
 * curling out to each side, leaves and small buds. `scale` ≈ cluster width/2.
 */
export function floralCluster(cx: number, cy: number, scale: number, flip = false): Filigree {
  const s = Math.max(scale, 8);
  const strokes: string[] = [];
  const fills: string[] = [];
  const up = flip ? 1 : -1;
  fills.push(rosettePath(cx, cy, s * 0.22, 8));
  for (const side of [-1, 1] as const) {
    const start = { x: cx + side * s * 0.2, y: cy };
    const heading = side === 1 ? up * 0.35 : Math.PI - up * 0.35;
    const v = vine(start.x, start.y, heading, s * 1.05, (side === 1 ? (flip ? 1 : -1) : flip ? -1 : 1) as 1 | -1);
    strokes.push(v.d);
    for (const lf of v.leaves) fills.push(leafPath(lf.x, lf.y, lf.angle, s * 0.16));
    const v2 = vine(start.x, start.y, side === 1 ? -up * 0.55 : Math.PI + up * 0.55, s * 0.62, (side === 1 ? (flip ? -1 : 1) : flip ? 1 : -1) as 1 | -1);
    strokes.push(v2.d);
    for (const lf of v2.leaves) fills.push(leafPath(lf.x, lf.y, lf.angle, s * 0.13));
    fills.push(rosettePath(v.end.x, v.end.y, s * 0.06, 6));
    fills.push(rosettePath(cx + side * s * 0.62, cy + up * s * 0.34, s * 0.1, 7));
  }
  return { strokes, fills };
}

/**
 * A trailing vine running down one side of the frame: a slow wave with
 * alternating leaves and seed pearls, the filler that makes letterpress read
 * as intricate rather than sparse.
 */
export function pendant(x: number, y0: number, y1: number, dir: 1 | -1): Filigree {
  const strokes: string[] = [];
  const fills: string[] = [];
  const len = (y1 - y0) * dir;
  if (!(len > 30)) return { strokes, fills };
  const dot = (cx: number, cy: number, r: number) =>
    `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
  // a string of beads that grow toward the drop
  const n = Math.max(3, Math.floor(len / 11));
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    fills.push(dot(x, y0 + dir * t * len * 0.78, 1.1 + t * 1.3));
  }
  // a small rosette two thirds down, then the teardrop
  fills.push(rosettePath(x, y0 + dir * len * 0.42, 7, 6));
  const ty = y0 + dir * len * 0.9;
  const r = 6;
  fills.push(`M${f(x)} ${f(ty - dir * r * 1.9)}Q${f(x + r * 1.2)} ${f(ty)} ${f(x)} ${f(ty + dir * r)}Q${f(x - r * 1.2)} ${f(ty)} ${f(x)} ${f(ty - dir * r * 1.9)}Z`);
  // leaf pairs flanking the rosette
  for (const side of [-1, 1] as const) {
    fills.push(leafPath(x + side * 6, y0 + dir * len * 0.42, (dir === 1 ? Math.PI / 2 : -Math.PI / 2) - side * 1.1 * dir, 12));
  }
  return { strokes, fills };
}

export function sideTrail(x: number, y0: number, y1: number, dir: 1 | -1): Filigree {
  const strokes: string[] = [];
  const fills: string[] = [];
  const len = Math.max(y1 - y0, 0);
  if (len < 20) return { strokes, fills };
  const amp = 5;
  const pts: Pt[] = [];
  const N = Math.max(8, Math.round(len / 14));
  for (let i = 0; i <= N; i += 1) {
    const y = y0 + (i / N) * len;
    pts.push({ x: x + Math.sin((i / N) * len * 0.045) * amp * dir, y });
  }
  strokes.push(smoothPath(pts));
  const gap = 30;
  for (let y = y0 + gap * 0.6, i = 0; y < y1 - gap * 0.4; y += gap, i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const px = x + Math.sin((y - y0) * 0.045) * amp * dir;
    fills.push(leafPath(px, y, Math.PI / 2 + side * 1.05, 11));
    const dx = px + side * 9;
    const r = 1.4;
    fills.push(`M${f(dx - r)} ${f(y - 9)}A${f(r)} ${f(r)} 0 1 0 ${f(dx + r)} ${f(y - 9)}A${f(r)} ${f(r)} 0 1 0 ${f(dx - r)} ${f(y - 9)}Z`);
  }
  return { strokes, fills };
}

/** The whole embossed face: frame lines, scallops, pearls and floral clusters. */
export interface FaceArt {
  frameOuter: string;
  frameInner: string;
  scallops: string;
  pearls: Pt[];
  /** A dotted inner arch, like a perforation line in the press. */
  dots: Pt[];
  filigree: Filigree;
}

export function ribbonFaceArt(w: number, h: number): FaceArt {
  const W = Math.max(w, 120);
  const H = Math.max(h, 200);
  const inset = clamp(W * 0.06, 14, 30);
  const outer = archFramePoints(W, H, inset);
  const innerInset = inset + clamp(W * 0.035, 9, 16);
  const scallop = scallopPath(archFramePoints(W, H, inset - clamp(W * 0.018, 5, 9)), clamp(W * 0.034, 10, 16));
  const dotFrame = archFramePoints(W, H, innerInset + 9);
  const dots = resampleClosed(dotFrame, Math.round(polylineLength(dotFrame) / 9));
  const cx = W / 2;
  const archH = Math.min((W - innerInset * 2) * 0.62, (H - innerInset * 2) * 0.3);
  const topY = innerInset + archH * 0.62;
  const s = clamp(W * 0.3, 60, 150);
  const a = floralCluster(cx, topY, s, false);
  const b = floralCluster(cx, H - innerInset - s * 0.55, s, true);
  const trailX = innerInset + 24;
  const trailTop = innerInset + archH + 24;
  const trailBottom = H - innerInset - s * 1.15;
  const c = sideTrail(trailX, trailTop, trailBottom, 1);
  const d = sideTrail(W - trailX, trailTop, trailBottom, -1);
  // two small rosettes where each trail begins
  const e = floralCluster(trailX + 4, trailTop - 6, s * 0.3, false);
  const g = floralCluster(W - trailX - 4, trailTop - 6, s * 0.3, false);
  // beaded pendants hanging toward the ribbon from the top and rising from the bottom
  const midY = H * 0.5;
  const p1 = pendant(cx, topY + s * 0.32, midY - clamp(H * 0.1, 64, 96) * 0.5 - s * 0.62, 1);
  const p2 = pendant(cx, H - innerInset - s * 0.9, midY + clamp(W * 0.2, 66, 108) * 2.15, -1);
  const parts = [a, b, c, d, e, g, p1, p2];
  return {
    frameOuter: polyline(outer, true),
    frameInner: polyline(archFramePoints(W, H, innerInset), true),
    scallops: scallop.d,
    pearls: scallop.pearls,
    dots,
    filigree: {
      strokes: parts.flatMap((p) => p.strokes),
      fills: parts.flatMap((p) => p.fills),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Satin band + bow                                                    */
/* ------------------------------------------------------------------ */

/**
 * The ribbon band across the card: full stage width plus overhang, centred on
 * `cy`, `bh` tall, GATHERED toward the knot at `knotX` (pinch 0..1 narrows the
 * band there, the way satin bunches under a bow).
 */
export function bandPath(w: number, cy: number, bh: number, knotX: number, pinch: number): string {
  const W = Math.max(w, 40);
  const half = Math.max(bh, 4) / 2;
  const p = clamp(pinch, 0, 0.9);
  const sigma = Math.max(bh * 1.1, 10);
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  const N = 40;
  for (let i = 0; i <= N; i += 1) {
    const x = -W * 0.1 + (i / N) * W * 1.2;
    const g = Math.exp(-((x - knotX) ** 2) / (2 * sigma * sigma));
    const k = 1 - p * g;
    // a soft sag in the satin either side of the knot
    const sag = Math.sin((i / N) * Math.PI * 2) * half * 0.04;
    top.push({ x, y: cy - half * k + sag });
    bottom.push({ x, y: cy + half * k + sag });
  }
  return `${polyline(top)}L${bottom.reverse().map(pt).join('L')}Z`;
}

/** Fold crease lines radiating from the knot into the band (satin bunching). */
export function bandCreases(knotX: number, cy: number, bh: number): string[] {
  const out: string[] = [];
  const half = bh / 2;
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i += 1) {
      const off = (i - 1) * half * 0.42;
      const len = bh * (1.5 + i * 0.35);
      const a: Pt = { x: knotX + side * bh * 0.28, y: cy + off * 0.4 };
      const c: Pt = { x: knotX + side * len * 0.55, y: cy + off * 0.9 };
      const b: Pt = { x: knotX + side * len, y: cy + off * 1.05 };
      out.push(`M${pt(a)}Q${pt(c)} ${pt(b)}`);
    }
  }
  return out;
}

/**
 * One bow loop, knot at the origin, `s` = loop size. `loosen` 0..1 shrinks
 * the loop into the knot (untying). side -1 = left, 1 = right.
 */
export function bowLoopPath(side: -1 | 1, s: number, loosen: number): string {
  const P = loopSpace(side, s, loosen);
  return (
    `M${pt(P(0, -0.15))}` +
    `C${pt(P(0.34, -0.58))} ${pt(P(1.08, -0.84))} ${pt(P(1.56, -0.54))}` +
    `C${pt(P(1.8, -0.38))} ${pt(P(1.76, 0.0))} ${pt(P(1.46, 0.1))}` +
    `C${pt(P(1.02, 0.24))} ${pt(P(0.46, 0.15))} ${pt(P(0, 0.15))}Z`
  );
}

/** Scale/droop a loop's unit coordinates as the bow loosens (knot at origin). */
function loopSpace(side: -1 | 1, s: number, loosen: number): (x: number, y: number) => Pt {
  const S = Math.max(s, 4);
  const l = clamp(loosen, 0, 1);
  const k = 1 - l * 0.82;
  const droop = l * 0.35; // a loosening loop sags as it gives
  return (x: number, y: number) => ({ x: side * x * S * k, y: (y * (1 - l * 0.5) + x * droop * 0.4) * S * k });
}

/** The darker back of the satin, visible where the loop turns over near the knot. */
export function bowLoopInnerPath(side: -1 | 1, s: number, loosen: number): string {
  const P = loopSpace(side, s, loosen);
  return (
    `M${pt(P(0.12, -0.08))}` +
    `C${pt(P(0.46, -0.46))} ${pt(P(1.08, -0.64))} ${pt(P(1.5, -0.44))}` +
    `C${pt(P(1.12, -0.36))} ${pt(P(0.62, -0.16))} ${pt(P(0.16, 0.04))}Z`
  );
}

/** Soft fold lines running down each loop (satin never lies flat). */
export function bowLoopFolds(side: -1 | 1, s: number, loosen: number): string {
  const P = loopSpace(side, s, loosen);
  return (
    `M${pt(P(0.2, -0.02))}Q${pt(P(0.8, -0.2))} ${pt(P(1.5, -0.12))}` +
    `M${pt(P(0.22, 0.08))}Q${pt(P(0.8, 0.02))} ${pt(P(1.32, 0.06))}`
  );
}

/** Where a tail's tip rests (knot at origin), before anyone pulls it. */
export function tailRestTip(side: -1 | 1, s: number): Pt {
  const S = Math.max(s, 4);
  return { x: side * S * 1.02, y: S * 1.9 };
}

/**
 * A satin tail from the knot to `tip`, with a gentle S-twist and a
 * swallowtail (V-notch) cut at the end. `width` ≈ 0.42 s.
 */
export function tailPath(side: -1 | 1, s: number, tip: Pt, width?: number): string {
  const S = Math.max(s, 4);
  const w = Math.max(width ?? S * 0.42, 2);
  const start: Pt = { x: side * S * 0.08, y: S * 0.12 };
  const dx = tip.x - start.x;
  const dy = tip.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  // a twist: the centreline bows one way then the other
  const N = 18;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const bow = Math.sin(t * Math.PI) * len * 0.08 * side;
    const cxp = start.x + dx * t + nx * bow;
    const cyp = start.y + dy * t + ny * bow;
    // narrow at the knot, full width after the first fifth, slight twist pinch mid-way
    const ww = (w / 2) * Math.min(1, 0.45 + t * 3) * (1 - 0.22 * Math.exp(-((t - 0.55) ** 2) / 0.01));
    left.push({ x: cxp + nx * ww, y: cyp + ny * ww });
    right.push({ x: cxp - nx * ww, y: cyp - ny * ww });
  }
  const notch: Pt = { x: tip.x - ux * w * 0.42, y: tip.y - uy * w * 0.42 };
  // the V cut: left corner sits a little further along than the right
  const rc = { x: right[N].x - ux * w * 0.12, y: right[N].y - uy * w * 0.12 };
  return `${polyline(left)}L${pt(notch)}L${pt(rc)}L${right.slice(0, N).reverse().map(pt).join('L')}Z`;
}

/* ------------------------------------------------------------------ */
/* Pull physics                                                        */
/* ------------------------------------------------------------------ */

/** iOS-style rubber band: grows ever slower past nothing, approaches `limit`. */
export function rubberBand(distance: number, limit: number, c = 0.55): number {
  if (!Number.isFinite(distance) || distance <= 0 || limit <= 0) return 0;
  return (1 - 1 / ((distance * c) / limit + 1)) * limit;
}

export interface PullState {
  /** The tail tip, knot at origin. */
  tip: Pt;
  /** 0..1 — how close the pull is to untying the bow. */
  progress: number;
  /** How much the loops should already have loosened (0..~0.35). */
  loosen: number;
}

/** Pixels of pull (in the tail's own direction) that unties the bow. */
export function untieThreshold(s: number): number {
  return clamp(Math.max(s, 4) * 1.15, 56, 140);
}

/**
 * Drag physics for the tail: the tip follows the finger with a rubber band
 * (satin stretches, it does not teleport). Progress counts only the part of
 * the drag that pulls AWAY from the knot, so wiggling in place never unties.
 */
export function ribbonPull(side: -1 | 1, s: number, drag: Pt): PullState {
  const rest = tailRestTip(side, s);
  const dist = Math.hypot(drag.x, drag.y);
  const limit = Math.max(s, 4) * 1.6;
  const k = dist > 0 ? rubberBand(dist, limit) / dist : 0;
  const tip = { x: rest.x + drag.x * k, y: rest.y + drag.y * k };
  const rl = Math.hypot(rest.x, rest.y) || 1;
  const along = (drag.x * rest.x + drag.y * rest.y) / rl;
  // a sideways pull counts too (that is how you untie a bow), at a discount
  const across = Math.abs((drag.x * -rest.y + drag.y * rest.x) / rl);
  const effective = Math.max(0, along) + across * 0.6;
  const progress = clamp(effective / untieThreshold(s), 0, 1);
  return { tip, progress, loosen: progress * 0.35 };
}

/** Which way the band slides off: the direction of the pull, else right. */
export function slideDirection(drag: Pt, side: -1 | 1): -1 | 1 {
  if (Math.abs(drag.x) > 6) return drag.x > 0 ? 1 : -1;
  return side;
}

/* ------------------------------------------------------------------ */
/* Glint motes                                                         */
/* ------------------------------------------------------------------ */

export interface Mote {
  x: number;
  y: number;
  r: number;
  delay: number;
  drift: number;
}

/** Deterministic motes around the knot for the warm-light glint (no Math.random). */
export function glintMotes(cx: number, cy: number, spread: number, count: number): Mote[] {
  const out: Mote[] = [];
  const n = clamp(Math.round(count), 0, 64);
  for (let i = 0; i < n; i += 1) {
    // golden-angle spiral: even coverage, fully deterministic
    const a = i * 2.39996323;
    const rr = spread * Math.sqrt((i + 0.5) / Math.max(n, 1));
    out.push({
      x: cx + Math.cos(a) * rr,
      y: cy + Math.sin(a) * rr * 1.25,
      r: 1.2 + ((i * 7) % 5) * 0.45,
      delay: ((i * 37) % 100) / 100,
      drift: 18 + ((i * 13) % 7) * 6,
    });
  }
  return out;
}
