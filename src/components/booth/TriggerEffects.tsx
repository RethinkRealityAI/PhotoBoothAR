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
 * `prefers-reduced-motion` swaps every style for a single subtle sparkle pop.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { BurstStyle } from '../../lib/studio/triggers';

export interface TriggerEffectsHandle {
  /** Spawn a burst of the given style (no-op if the canvas isn't ready). */
  fire: (style: BurstStyle) => void;
  /** The live canvas element, for capture compositing (null before mount). */
  readonly canvas: HTMLCanvasElement | null;
}

const W = 720;
const H = 1280;
const MAX_PARTICLES = 120;

type ParticleKind = 'rect' | 'heart' | 'dot' | 'spark';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;      // seconds remaining
  maxLife: number;
  size: number;
  rot: number;
  vrot: number;
  gravity: number;   // px/s²
  color: string;     // 'r,g,b'
  kind: ParticleKind;
  additive: boolean; // 'lighter' composite (glow) vs 'source-over'
  trail: boolean;    // draw a short motion streak (fireworks)
}

const CONFETTI_COLORS = ['255,64,129', '124,77,255', '0,229,255', '255,215,64', '0,230,118', '255,109,64'];
const HEART_COLORS = ['255,82,133', '255,133,162', '255,45,85'];
const FIREWORK_COLORS = ['255,225,150', '255,170,90', '120,220,255', '255,120,200'];

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
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

const TriggerEffects = forwardRef<TriggerEffectsHandle, { className?: string }>(function TriggerEffects(
  { className },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);
  const lastRef = useRef(0);

  const spawn = (p: Particle) => {
    const list = particlesRef.current;
    if (list.length >= MAX_PARTICLES) return; // cap — drop the overflow
    list.push(p);
  };

  const reducedMotion = (): boolean => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  };

  const burst = (style: BurstStyle) => {
    // Reduced motion: one small, gentle sparkle pop for ANY style — no flurry.
    if (reducedMotion()) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        spawn({
          x: W / 2 + Math.cos(a) * rand(4, 30), y: H * 0.42 + Math.sin(a) * rand(4, 30),
          vx: Math.cos(a) * rand(4, 18), vy: Math.sin(a) * rand(4, 18),
          life: rand(0.5, 0.8), maxLife: 0.8, size: rand(3, 6), rot: 0, vrot: 0,
          gravity: 0, color: '255,240,190', kind: 'spark', additive: true, trail: false,
        });
      }
      return;
    }

    if (style === 'confetti') {
      for (let i = 0; i < 46; i++) {
        const a = rand(-Math.PI * 0.85, -Math.PI * 0.15); // up-and-out arc
        const sp = rand(260, 620);
        spawn({
          x: W / 2 + rand(-40, 40), y: H * 0.5,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(1.4, 2.4), maxLife: 2.4, size: rand(8, 15),
          rot: rand(0, Math.PI), vrot: rand(-9, 9), gravity: 780,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], kind: 'rect', additive: false, trail: false,
        });
      }
    } else if (style === 'hearts') {
      for (let i = 0; i < 18; i++) {
        spawn({
          x: W / 2 + rand(-150, 150), y: H * 0.62 + rand(-20, 60),
          vx: rand(-40, 40), vy: rand(-150, -260),
          life: rand(1.6, 2.6), maxLife: 2.6, size: rand(22, 40),
          rot: 0, vrot: rand(-1.2, 1.2), gravity: 60,
          color: HEART_COLORS[i % HEART_COLORS.length], kind: 'heart', additive: false, trail: false,
        });
      }
    } else if (style === 'sparkles') {
      for (let i = 0; i < 34; i++) {
        spawn({
          x: W / 2 + rand(-220, 220), y: H * 0.45 + rand(-260, 260),
          vx: rand(-40, 40), vy: rand(-40, 40),
          life: rand(0.7, 1.5), maxLife: 1.5, size: rand(3, 9),
          rot: 0, vrot: 0, gravity: 0,
          color: Math.random() > 0.5 ? '255,236,170' : '255,250,232', kind: 'spark', additive: true, trail: false,
        });
      }
    } else {
      // fireworks — a couple of radial bursts with trailing streaks.
      const bursts = 2;
      for (let b = 0; b < bursts; b++) {
        const cx = W / 2 + rand(-140, 140);
        const cy = H * rand(0.3, 0.5);
        const col = FIREWORK_COLORS[b % FIREWORK_COLORS.length];
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * Math.PI * 2 + rand(-0.1, 0.1);
          const sp = rand(180, 420);
          spawn({
            x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: rand(0.9, 1.6), maxLife: 1.6, size: rand(2.5, 5),
            rot: 0, vrot: 0, gravity: 210, color: col, kind: 'dot', additive: true, trail: true,
          });
        }
      }
    }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, W, H);
    for (const p of particlesRef.current) {
      const fade = Math.min(1, p.life / (p.maxLife * 0.6)); // fade over the last 60% of life
      ctx.save();
      ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      if (p.kind === 'rect') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = fade;
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
      } else if (p.kind === 'heart') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = fade;
        ctx.fillStyle = `rgb(${p.color})`;
        heartPath(ctx, p.size);
        ctx.fill();
      } else if (p.kind === 'dot') {
        if (p.trail) {
          ctx.globalAlpha = fade * 0.5;
          ctx.strokeStyle = `rgba(${p.color},${fade * 0.5})`;
          ctx.lineWidth = p.size * 0.8;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
        }
        ctx.globalAlpha = fade;
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // spark — soft twinkling core + 4-point glint
        const tw = 0.55 + 0.45 * Math.sin(p.life * 18 + p.x);
        const a = fade * tw;
        const r = p.size * (0.7 + tw * 0.6);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2);
        g.addColorStop(0, `rgba(${p.color},${a})`);
        g.addColorStop(0.4, `rgba(${p.color},${a * 0.35})`);
        g.addColorStop(1, `rgba(${p.color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${p.color},${a * 0.9})`;
        ctx.lineWidth = 1.2;
        const gl = r * 2.4;
        ctx.beginPath();
        ctx.moveTo(p.x - gl, p.y); ctx.lineTo(p.x + gl, p.y);
        ctx.moveTo(p.x, p.y - gl); ctx.lineTo(p.x, p.y + gl);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  const tick = (now: number) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) { runningRef.current = false; return; }
    const dt = Math.min(Math.max((now - lastRef.current) / 1000, 0.001), 0.05);
    lastRef.current = now;

    const list = particlesRef.current;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      list[w++] = p; // compact live particles in place (no per-frame allocation)
    }
    list.length = w;

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
      burst(style);
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
