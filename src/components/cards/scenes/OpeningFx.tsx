/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OpeningFx — draws a design's flourish (lib/openingFx.ts) as its gateway
 * opens: petals, hearts, confetti, sparks, fireworks, lanterns, gold dust,
 * parting clouds, tropical leaves, or the winter window's frost melting away.
 *
 * One 2D canvas over the stage, one rAF loop that runs only while the
 * flourish plays (FX_DURATION_S) and then clears itself and stops. All
 * motion comes from the pure `fxPose` / `frostAt`, so this file only paints.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { CardDesign } from '../../../lib/cardDesigns';
import {
  DESIGN_FX,
  frostLevel,
  frostMeltAt,
  frostNoise,
  fxParticles,
  fxPose,
  FX_DURATION_S,
  MELT_COLS,
  MELT_ROWS,
  type FxKind,
  type FxParticle,
  type FxPose,
} from '../../../lib/openingFx';

export interface OpeningFxProps {
  design: CardDesign;
  seed: string;
  reducedMotion: boolean;
  /** Flips true the moment the gateway starts to open. */
  playing: boolean;
}

interface Layer {
  kind: FxKind;
  parts: FxParticle[];
}

/** Lightweight hex → rgba. */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function heartPath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.5, -s * 1.15, 0, -s * 0.5);
  ctx.bezierCurveTo(s * 0.5, -s * 1.15, s * 1.1, -s * 0.35, 0, s * 0.35);
  ctx.closePath();
}

function star4(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.12, -s * 0.12, s, 0);
  ctx.quadraticCurveTo(s * 0.12, s * 0.12, 0, s);
  ctx.quadraticCurveTo(-s * 0.12, s * 0.12, -s, 0);
  ctx.quadraticCurveTo(-s * 0.12, -s * 0.12, 0, -s);
  ctx.closePath();
}

function drawParticle(
  ctx: CanvasRenderingContext2D,
  kind: FxKind,
  q: FxPose,
  p: FxParticle,
  colors: readonly string[],
  w: number,
  h: number,
  unit: number,
) {
  const c = colors[p.color % colors.length] ?? '#FFFFFF';
  const s = p.size * unit * q.scale;
  const x = q.x * w;
  const y = q.y * h;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = q.alpha;
  switch (kind) {
    case 'petals': {
      ctx.rotate(q.rot);
      ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(q.rot * 1.4)));
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.5, s * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(-s * 0.35, -s * 0.15, s * 0.6, s * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'hearts': {
      ctx.rotate(q.rot);
      ctx.fillStyle = c;
      heartPath(ctx, s);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(-s * 0.38, -s * 0.48, s * 0.18, s * 0.12, -0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'leaves': {
      ctx.rotate(q.rot);
      ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(q.rot * 1.1)));
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-s * 1.4, 0);
      ctx.quadraticCurveTo(0, -s * 0.9, s * 1.4, 0);
      ctx.quadraticCurveTo(0, s * 0.9, -s * 1.4, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = Math.max(0.6, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(-s * 1.2, 0);
      ctx.lineTo(s * 1.2, 0);
      ctx.stroke();
      break;
    }
    case 'confetti': {
      ctx.rotate(q.rot);
      ctx.scale(1, Math.cos(q.rot * 2.2));
      ctx.fillStyle = c;
      ctx.fillRect(-s * 0.9, -s * 0.5, s * 1.8, s);
      break;
    }
    case 'sparks':
    case 'fireworks': {
      ctx.globalCompositeOperation = 'lighter';
      const len = s * (kind === 'sparks' ? 5 : 7);
      ctx.rotate(q.heading);
      const g = ctx.createLinearGradient(-len, 0, 0, 0);
      g.addColorStop(0, rgba(c, 0));
      g.addColorStop(1, rgba(c, 1));
      ctx.strokeStyle = g;
      ctx.lineCap = 'round';
      ctx.lineWidth = s * 0.9;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'lanterns': {
      ctx.rotate(q.rot);
      const r = s;
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.2);
      glow.addColorStop(0, rgba(c, 0.55));
      glow.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(-r * 3.2, -r * 3.2, r * 6.4, r * 6.4);
      const body = ctx.createLinearGradient(0, -r, 0, r);
      body.addColorStop(0, '#FFF3D6');
      body.addColorStop(1, c);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r);
      ctx.lineTo(r * 0.55, -r);
      ctx.quadraticCurveTo(r * 0.95, 0, r * 0.45, r);
      ctx.lineTo(-r * 0.45, r);
      ctx.quadraticCurveTo(-r * 0.95, 0, -r * 0.55, -r);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,250,230,0.9)';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.55, r * 0.22, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'golddust': {
      ctx.globalCompositeOperation = 'lighter';
      ctx.rotate(q.rot);
      ctx.fillStyle = c;
      star4(ctx, s * 1.6);
      ctx.fill();
      break;
    }
    case 'clouds': {
      const r = s;
      const puff = (dx: number, dy: number, rr: number) => {
        const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, rr);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.75)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(dx, dy, rr, 0, Math.PI * 2);
        ctx.fill();
      };
      puff(-r * 0.7, r * 0.1, r * 0.75);
      puff(r * 0.6, r * 0.15, r * 0.7);
      puff(0, -r * 0.2, r * 0.9);
      break;
    }
    case 'melt': {
      const r = s;
      ctx.fillStyle = 'rgba(225,238,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.7, r * (1 + q.scale * 0.6), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(-r * 0.22, -r * 0.3, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

export default function OpeningFx({ design, seed, reducedMotion, playing }: OpeningFxProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fx = DESIGN_FX[design.id];
  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];
    out.push({ kind: fx.kind, parts: fxParticles(fx.kind, seed, reducedMotion, 1, fx.colors.length) });
    if (fx.also) out.push({ kind: fx.also, parts: fxParticles(fx.also, seed, reducedMotion, 0.4, fx.colors.length) });
    return out;
  }, [fx, seed, reducedMotion]);

  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = rect.width;
    const h = rect.height;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const unit = Math.min(w, h) / 100;

    // The frost: a coarse grid painted into a tiny canvas, scaled up smooth.
    const melt = fx.kind === 'melt';
    let frost: HTMLCanvasElement | null = null;
    let fctx: CanvasRenderingContext2D | null = null;
    let img: ImageData | null = null;
    const noiseSeed = seed.length * 7 + 3;
    const tint: number[] = [];
    const meltAt: number[] = [];
    if (melt) {
      frost = document.createElement('canvas');
      frost.width = MELT_COLS;
      frost.height = MELT_ROWS;
      fctx = frost.getContext('2d');
      img = fctx ? fctx.createImageData(MELT_COLS, MELT_ROWS) : null;
      for (let r = 0; r < MELT_ROWS; r++) {
        for (let c = 0; c < MELT_COLS; c++) {
          tint.push(frostNoise(c * 3, r * 3, noiseSeed + 1));
          meltAt.push(frostMeltAt(c, r, noiseSeed));
        }
      }
    }

    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const s = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      if (melt && fctx && img && frost) {
        const bloom = Math.min(1, s / 0.22); // frost breathes onto the glass first
        const d = img.data;
        let any = false;
        for (let r = 0; r < MELT_ROWS; r++) {
          for (let c = 0; c < MELT_COLS; c++) {
            const i = r * MELT_COLS + c;
            const f = frostLevel(meltAt[i], s) * bloom;
            if (f > 0.002) any = true;
            const k = tint[i];
            d[i * 4] = 226 + k * 29;
            d[i * 4 + 1] = 236 + k * 19;
            d[i * 4 + 2] = 255;
            d[i * 4 + 3] = Math.round(f * (200 + k * 55));
          }
        }
        if (any) {
          fctx.putImageData(img, 0, 0);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(frost, 0, 0, w, h);
          // Crystalline glints on what is left.
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (let r = 2; r < MELT_ROWS; r += 5) {
            for (let c = (r * 3) % 4; c < MELT_COLS; c += 4) {
              const f = frostLevel(meltAt[r * MELT_COLS + c], s) * bloom;
              if (f < 0.35) continue;
              ctx.globalAlpha = f * (0.35 + 0.35 * Math.sin(s * 7 + r + c));
              ctx.fillStyle = '#FFFFFF';
              ctx.translate(((c + 0.5) / MELT_COLS) * w, ((r + 0.5) / MELT_ROWS) * h);
              star4(ctx, unit * 1.1);
              ctx.fill();
              ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
          }
          ctx.restore();
        }
      }
      for (const layer of layers) {
        for (const p of layer.parts) {
          const q = fxPose(layer.kind, p, s);
          if (q && q.alpha > 0.01) drawParticle(ctx, layer.kind, q, p, fx.colors, w, h, unit);
        }
      }
      if (s < FX_DURATION_S) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
    };
  }, [playing, layers, fx, seed]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" data-opening-fx={fx.kind} />;
}
