/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TriggerEffects — a transparent, self-contained particle canvas layered over
 * the booth stage. Face triggers (src/lib/studio/triggers.ts) call `fire(style)`
 * imperatively; the RAF loop spawns + integrates particles and idles itself when
 * none remain (zero cost between bursts). No three.js.
 *
 * The canvas element is exposed via the ref so StageCanvas can composite it into
 * CAPTURED photos (an additive optional draw step), so a burst that's on screen
 * at the shutter also lands in the saved image.
 *
 * A fixed 720×1280 internal resolution (the stage's 9:16) keeps particle physics
 * independent of on-screen size; StageCanvas scales it to capture resolution.
 * Burst shapes live in lib/burstFx.ts (pure, tested). They are NOT reduced for
 * prefers-reduced-motion: the guest fires them on purpose (see burstFx.ts).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { BurstStyle } from '../../lib/studio/triggers';
import { FX_W as W, FX_H as H, addParticles, burstParticles, stepParticles, type FxParticle } from '../../lib/burstFx';

export interface TriggerEffectsHandle {
  /** Spawn a burst of the given style (no-op if the canvas isn't ready). */
  fire: (style: BurstStyle) => void;
  /** The live canvas element, for capture compositing (null before mount). */
  readonly canvas: HTMLCanvasElement | null;
}

/** A heart outline centred on (x,y), radius ~s, via two bezier lobes. */
function heartPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(0, s * 0.1, -s * 0.5, -s * 0.25, -s * 0.5, s * 0.02);
  ctx.bezierCurveTo(-s * 0.5, s * 0.32, -s * 0.05, s * 0.55, 0, s * 0.75);
  ctx.bezierCurveTo(s * 0.05, s * 0.55, s * 0.5, s * 0.32, s * 0.5, s * 0.02);
  ctx.bezierCurveTo(s * 0.5, -s * 0.25, 0, s * 0.1, 0, s * 0.35);
  ctx.closePath();
}

/** One soft radial glow per colour, drawn once and stamped with drawImage
 *  (a gradient per particle per frame is what makes phones drop frames). */
const glowCache = new Map<string, HTMLCanvasElement>();
function glow(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${color},1)`);
    grad.addColorStop(0.25, `rgba(${color},0.55)`);
    grad.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  glowCache.set(color, c);
  return c;
}

const TriggerEffects = forwardRef<TriggerEffectsHandle, { className?: string }>(function TriggerEffects(
  { className },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<FxParticle[]>([]);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);
  const lastRef = useRef(0);
  const clockRef = useRef(0);

  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, W, H);
    const t = clockRef.current;
    for (const p of particlesRef.current) {
      if (p.delay > 0) continue;
      let a = Math.min(1, p.life / (p.maxLife * 0.5)); // fade over the last half of life
      if (p.flicker) a *= Math.sin(t * 40 + p.x * 0.7) > -0.2 ? 1 : 0.15;
      if (a <= 0.01) continue;
      ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      ctx.globalAlpha = a;
      if (p.kind === 'rect') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // Flip the short side with the spin so a piece reads as tumbling paper.
        ctx.scale(1, Math.cos(p.rot * 1.7));
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        ctx.restore();
      } else if (p.kind === 'heart') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.shadowColor = `rgba(${p.color},0.7)`;
        ctx.shadowBlur = 14;
        heartPath(ctx, p.size);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'flash') {
        const life = p.life / p.maxLife; // 1 → 0
        const s = p.size * (1.2 - life * 0.6);
        ctx.globalAlpha = life * 0.85;
        ctx.drawImage(glow(p.color), p.x - s / 2, p.y - s / 2, s, s);
      } else {
        // dot / rocket / spark: a streak (if any), a glow, and a white-hot core.
        if (p.trail) {
          const len = p.kind === 'rocket' ? 0.09 : 0.045;
          ctx.strokeStyle = `rgba(${p.color},${a * 0.6})`;
          ctx.lineWidth = p.size * (p.kind === 'rocket' ? 0.9 : 0.7);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * len, p.y - p.vy * len);
          ctx.stroke();
        }
        const gs = p.size * (p.kind === 'spark' ? 5 : 4.5);
        ctx.drawImage(glow(p.color), p.x - gs / 2, p.y - gs / 2, gs, gs);
        if (p.kind === 'spark') {
          const gl = p.size * 2.2;
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(p.x - gl, p.y); ctx.lineTo(p.x + gl, p.y);
          ctx.moveTo(p.x, p.y - gl); ctx.lineTo(p.x, p.y + gl);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgb(255,255,255)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  const tick = (now: number) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) { runningRef.current = false; return; }
    const dt = Math.min(Math.max((now - lastRef.current) / 1000, 0.001), 0.05);
    lastRef.current = now;
    clockRef.current += dt;

    const list = particlesRef.current;
    const born = stepParticles(list, dt, Math.random);
    if (born.length > 0) addParticles(list, born);

    draw(ctx);

    if (list.length > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      runningRef.current = false;
      ctx.clearRect(0, 0, W, H); // leave the canvas fully transparent when idle
    }
  };

  const start = () => {
    if (runningRef.current) return;
    runningRef.current = true;
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  };

  useImperativeHandle(ref, () => ({
    fire(style: BurstStyle) {
      if (!canvasRef.current) return;
      addParticles(particlesRef.current, burstParticles(style, Math.random));
      start();
    },
    get canvas() { return canvasRef.current; },
  }), []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
      particlesRef.current.length = 0;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      aria-hidden="true"
      className={className ?? 'absolute inset-0 w-full h-full pointer-events-none z-30'}
      style={{ display: 'block' }}
    />
  );
});

export default TriggerEffects;
