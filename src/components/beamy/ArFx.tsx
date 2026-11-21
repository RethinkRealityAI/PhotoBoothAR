/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ArFx — the AR step's effects (lib/arFx holds the math), on ONE small 2D
 * canvas laid over the AR stage box round Beamy (it never takes a tap).
 * Snow, confetti, hearts and music notes are a few dozen bits at most; stage
 * lights are two soft beams. Sized to the device pixel ratio (capped at 2),
 * and the frame loop only runs while an effect is on and the tab is visible.
 * Reduced motion softens it (lib/arFx: fewer, slower, beams held still).
 */
import { useEffect, useRef } from 'react';
import { FX_COLORS, fxAlpha, fxCount, seedFx, spotBeams, stepFx, type ArFxKind, type FxBit } from '../../lib/arFx';
import { seededRandom } from '../../lib/brandLanding';

/** A heart of radius ~r about the origin (two bezier lobes). */
function heart(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.moveTo(0, r * 0.35);
  ctx.bezierCurveTo(-r * 1.1, -r * 0.35, -r * 0.45, -r * 1.05, 0, -r * 0.45);
  ctx.bezierCurveTo(r * 0.45, -r * 1.05, r * 1.1, -r * 0.35, 0, r * 0.35);
  ctx.closePath();
  ctx.fill();
}

/** A quaver drawn as shapes (no font glyph, so never an emoji): head, stem, flag. */
function note(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.55, r * 0.4, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, r * 0.16);
  ctx.beginPath();
  ctx.moveTo(r * 0.48, -r * 0.1);
  ctx.lineTo(r * 0.48, -r * 1.55);
  ctx.quadraticCurveTo(r * 1.15, -r * 1.2, r * 1.0, -r * 0.6);
  ctx.stroke();
}

export default function ArFx({ kind, reduced, className = '' }: { kind: ArFxKind | null; reduced: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d') ?? null;
    if (cv === null || ctx === null || kind === null) return;
    let w = 0;
    let h = 0;
    let bits: FxBit[] = [];
    let raf = 0;
    let last = 0;
    const rand = seededRandom(kind.length * 97 + 5);
    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bits = seedFx(kind, fxCount(kind, w, h, reduced), w, h, rand);
    };
    const drawBeams = (t: number) => {
      const s = spotBeams(t, reduced);
      ctx.globalCompositeOperation = 'lighter';
      const beam = (x0: number, ang: number, col: string) => {
        const len = h * 1.15;
        const spread = 0.13;
        const dir = x0 < w / 2 ? 1 : -1;
        const a0 = ang * dir;
        const tip = { x: x0, y: -h * 0.04 };
        const g = ctx.createLinearGradient(tip.x, tip.y, tip.x + Math.sin(a0) * len, tip.y + Math.cos(a0) * len);
        g.addColorStop(0, `rgba(${col},${0.55 * s.glow})`);
        g.addColorStop(0.55, `rgba(${col},${0.18 * s.glow})`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x + Math.sin(a0 - spread) * len, tip.y + Math.cos(a0 - spread) * len);
        ctx.lineTo(tip.x + Math.sin(a0 + spread) * len, tip.y + Math.cos(a0 + spread) * len);
        ctx.closePath();
        ctx.fill();
      };
      beam(w * 0.04, s.left, '255,214,150');
      beam(w * 0.96, s.right, '190,200,255');
      // The pool of light at his feet.
      const pool = ctx.createRadialGradient(w / 2, h * 0.9, 0, w / 2, h * 0.9, w * 0.42);
      pool.addColorStop(0, `rgba(255,236,200,${0.32 * s.glow})`);
      pool.addColorStop(1, 'rgba(255,236,200,0)');
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.9, w * 0.42, h * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      if (kind === 'spotlight') { drawBeams(t); return; }
      const cols = FX_COLORS[kind];
      for (const b of bits) {
        const a = fxAlpha(kind, b, h);
        if (a <= 0.01) continue;
        const col = cols[b.hue % cols.length];
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgb(${col})`;
        ctx.strokeStyle = `rgb(${col})`;
        if (kind === 'snow') {
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        if (kind === 'confetti') {
          // A paper strip turning over: its width breathes with the spin.
          ctx.scale(Math.cos(b.rot * 1.7 + b.phase), 1);
          ctx.fillRect(-b.r, -b.r * 0.45, b.r * 2, b.r * 0.9);
        } else if (kind === 'hearts') heart(ctx, b.r);
        else note(ctx, b.r);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };
    const frame = (now: number) => {
      const t = now / 1000;
      stepFx(kind, bits, last === 0 ? 0 : t - last, w, h, t, reduced, rand);
      last = t;
      draw(t);
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      const go = !document.hidden;
      if (go && raf === 0) { last = 0; raf = requestAnimationFrame(frame); }
      if (!go && raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    document.addEventListener('visibilitychange', run);
    run();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', run);
      ctx.clearRect(0, 0, cv.width, cv.height);
    };
  }, [kind, reduced]);

  return <canvas ref={ref} aria-hidden data-fx={kind ?? 'none'} className={`pointer-events-none ${className}`} />;
}
