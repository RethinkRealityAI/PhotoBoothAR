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

/** A cartoon cloud puff centred on (0,0), width ≈ 2·s, flat-ish bottom. */
export function cloudPath(ctx: PaintContext, s: number): void {
  ctx.beginPath();
  ctx.moveTo(-s, s * 0.3);
  ctx.arc(-s * 0.55, 0, s * 0.45, Math.PI * 0.75, Math.PI * 1.6);
  ctx.arc(0, -s * 0.2, s * 0.55, Math.PI * 1.15, Math.PI * 1.9);
  ctx.arc(s * 0.6, 0.02 * s, s * 0.42, Math.PI * 1.4, Math.PI * 2.25);
  ctx.lineTo(-s, s * 0.3);
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
