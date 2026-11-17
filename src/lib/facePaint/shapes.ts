/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canvas primitives for the face-paint painter. Everything takes the narrow
 * `PaintContext` (the subset of CanvasRenderingContext2D the painter uses) so
 * the node suite can drive the real code with a recorded-calls fake.
 */
import type { Pt } from './features';

export type PaintContext = Pick<
  CanvasRenderingContext2D,
  | 'save' | 'restore' | 'translate' | 'rotate' | 'scale'
  | 'beginPath' | 'closePath' | 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo'
  | 'arc' | 'ellipse' | 'rect' | 'fill' | 'stroke' | 'clip' | 'fillRect' | 'clearRect' | 'drawImage'
  | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineCap' | 'lineJoin' | 'globalAlpha'
  | 'globalCompositeOperation' | 'shadowBlur' | 'shadowColor'
>;

/** Deterministic PRNG (mulberry32). Designs never call Math.random. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pigment edge: a same-colour shadow halo softens every fill the way a sponge
 * edge does. Canvas shadows ignore the transform, so the blur is in texture px.
 * (ctx.filter would be the obvious tool, but iOS Safari's 2D canvas has no
 * `filter` — the booth's main audience.)
 */
export function soft(ctx: PaintContext, color: string, px: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = px;
}

export function hard(ctx: PaintContext): void {
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0)';
}

export function angleOf(a: Pt, b: Pt): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Heart centred on (0,0), point DOWN, width ≈ 2s. */
export function heartPath(ctx: PaintContext, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.95);
  ctx.bezierCurveTo(-s * 1.25, s * 0.1, -s * 1.05, -s * 1.05, 0, -s * 0.45);
  ctx.bezierCurveTo(s * 1.05, -s * 1.05, s * 1.25, s * 0.1, 0, s * 0.95);
  ctx.closePath();
}

/** n-point star centred on (0,0), first point UP. */
export function starPath(ctx: PaintContext, outer: number, inner: number, points = 5): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Tapered brush stroke from `a` (full width `w`) to a point at `b`. */
export function taperPath(ctx: PaintContext, a: Pt, b: Pt, w: number, bend = 0.15): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mx = a.x + dx * 0.5 + nx * len * bend;
  const my = a.y + dy * 0.5 + ny * len * bend;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * w * 0.5, a.y + ny * w * 0.5);
  ctx.quadraticCurveTo(mx + nx * w * 0.25, my + ny * w * 0.25, b.x, b.y);
  ctx.quadraticCurveTo(mx - nx * w * 0.25, my - ny * w * 0.25, a.x - nx * w * 0.5, a.y - ny * w * 0.5);
  ctx.closePath();
}

export function ellipseAt(ctx: PaintContext, c: Pt, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
}

export function dot(ctx: PaintContext, c: Pt, r: number): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.max(0.01, r), 0, Math.PI * 2);
}

/* ── curves + seasonal shapes ────────────────────────────────────────── */

/** `n + 1` evenly-stepped points on a quadratic Bézier a → (c) → b. */
export function quadPts(a: Pt, c: Pt, b: Pt, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  return out;
}

/** `n + 1` evenly-stepped points on a cubic Bézier a → (c1, c2) → b. */
export function cubicPts(a: Pt, c1: Pt, c2: Pt, b: Pt, n = 32): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
    out.push({ x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x, y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y });
  }
  return out;
}

/** Cumulative arc length along a polyline (out[0] = 0). */
export function arcLengths(pts: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return out;
}

/** Unit normal (left of travel) at each point of a polyline. */
export function polyNormals(pts: Pt[]): Pt[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  });
}

/**
 * A filled brush ribbon along a centreline: `width(t, s, len)` is the FULL
 * width at arc-length fraction t (s = arc length in px, len = total), so a
 * design can taper a swirl or round off a candy cane's ends. Closed path.
 */
export function ribbonPath(ctx: PaintContext, pts: Pt[], width: (t: number, s: number, len: number) => number): void {
  const L = arcLengths(pts);
  const len = L[L.length - 1] || 1;
  const N = polyNormals(pts);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const w = width(L[i] / len, L[i], len) / 2;
    const x = pts[i].x + N[i].x * w;
    const y = pts[i].y + N[i].y * w;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const w = width(L[i] / len, L[i], len) / 2;
    ctx.lineTo(pts[i].x - N[i].x * w, pts[i].y - N[i].y * w);
  }
  ctx.closePath();
}

/** Width profile for `ribbonPath`: constant `w`, with round (semicircular) ends. */
export function roundEnds(w: number): (t: number, s: number, len: number) => number {
  return (_t, s, len) => {
    const d = Math.min(s, len - s);
    const r = w / 2;
    if (d >= r) return w;
    const k = 1 - (r - d) / r;
    return w * Math.sqrt(Math.max(0, k * (2 - k)));
  };
}

/** Points along a polyline (open), for strokes: moveTo + lineTo, not closed. */
export function polylinePath(ctx: PaintContext, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

/**
 * Archimedean curl: from `r0` at angle `a0` winding `turns` toward `r1`,
 * `dir` = +1 clockwise on screen (canvas y down), −1 counter-clockwise.
 */
export function spiralPts(c: Pt, r0: number, r1: number, a0: number, turns: number, dir: 1 | -1, n = 40): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + dir * t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}

/**
 * A crisp six-armed snowflake centred on (0,0), radius `r`, as OPEN segments
 * for `stroke()` (round caps make the arm tips): each arm carries `branches`
 * pairs of side twigs at ±60°, longest nearest the centre, like a real
 * dendrite. Arm 0 points UP.
 */
export function snowflakePath(ctx: PaintContext, r: number, branches = 2): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    ctx.moveTo(0, 0);
    ctx.lineTo(ux * r, uy * r);
    for (let b = 0; b < branches; b++) {
      const at = 0.38 + (b * 0.5) / Math.max(1, branches);
      const twig = r * (0.34 - b * 0.12);
      const px = ux * r * at;
      const py = uy * r * at;
      for (const s of [-1, 1]) {
        const ta = a + s * (Math.PI / 3);
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ta) * twig, py + Math.sin(ta) * twig);
      }
    }
  }
}

/**
 * A soft, sponge-blended blob (blush, frost wash): `layers` concentric
 * ellipses at low alpha build a radial falloff — no gradients, which keeps the
 * painter on the narrow PaintContext the node suite can record.
 */
export function softBlob(ctx: PaintContext, c: Pt, rx: number, ry: number, color: string, alpha: number, layers = 8, rot = 0): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha / layers;
  for (let i = 0; i < layers; i++) {
    const k = 1 - i / layers;
    ellipseAt(ctx, c, rx * k, ry * k, rot);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A holly leaf centred on (0,0), long axis along +x, length 2·len, max
 * half-width `wid`: `spines` spiny points a side joined by scalloped dips.
 */
export function hollyLeafPath(ctx: PaintContext, len: number, wid: number, spines = 4): void {
  const w = (t: number) => wid * Math.sqrt(Math.max(0, 1 - t * t));
  ctx.beginPath();
  ctx.moveTo(-len, 0);
  // Upper edge (y < 0) tip to tip, then the lower edge back.
  for (const side of [-1, 1]) {
    for (let i = 1; i <= spines + 1; i++) {
      const k = side === -1 ? i : spines + 1 - i;
      const t = -1 + (2 * k) / (spines + 1);
      const tm = -1 + (2 * (side === -1 ? k - 0.5 : k + 0.5)) / (spines + 1);
      ctx.quadraticCurveTo(tm * len, side * w(tm) * 0.5, t * len, side * w(t) * 1.1);
    }
  }
  ctx.closePath();
}
