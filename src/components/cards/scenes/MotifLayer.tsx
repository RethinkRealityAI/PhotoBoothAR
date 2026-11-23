/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MotifLayer — the particles that drift over a design's scene (petals,
 * confetti, lanterns, snow…). One 2D canvas, drawn procedurally: no images,
 * no WebGL, so it costs a few hundred bytes and runs on any phone.
 *
 * Budget: DPR capped at 1.5, at most ~42 particles (half under reduced
 * motion), the loop pauses while the tab is hidden and stops on unmount.
 * Seeded PRNG, so the same design scatters the same way every visit.
 */
import { useEffect, useRef } from 'react';
import type { MotifKind } from '../../../lib/cardDesigns';

interface Particle {
  x: number; // 0..1 of width
  y: number; // 0..1 of height
  s: number; // size, px at 1x
  v: number; // speed, fraction of height per second
  a: number; // angle
  w: number; // spin / phase speed
  c: string;
  p: number; // phase
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTS: Record<MotifKind, number> = {
  petals: 26,
  confetti: 42,
  sparkle: 30,
  lanterns: 14,
  snow: 40,
  stars: 34,
  fireflies: 22,
};

/** Falling kinds move down; lanterns and fireflies rise; sparkle/stars stay put. */
const DRIFT: Record<MotifKind, number> = {
  petals: 1, confetti: 1, snow: 1, lanterns: -1, fireflies: -0.35, sparkle: 0, stars: 0,
};

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface MotifLayerProps {
  kind: MotifKind;
  colors: readonly string[];
  seed: string;
  reducedMotion: boolean;
  /** 0..1 — fades the whole layer (the opener brings it in as the scene opens). */
  intensity?: number;
  /** Fewer particles behind a reading card than in the opening moment. */
  density?: number;
  className?: string;
}

export default function MotifLayer({
  kind, colors, seed, reducedMotion, intensity = 1, density = 1, className = '',
}: MotifLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rand = mulberry32(seedFrom(`${seed}|${kind}`));
    const n = Math.max(4, Math.round(COUNTS[kind] * density * (reducedMotion ? 0.5 : 1)));
    const palette = colors.length > 0 ? colors : ['#FFFFFF'];
    const parts: Particle[] = Array.from({ length: n }, () => ({
      x: rand(),
      y: rand(),
      s: 0.6 + rand() * 0.9,
      v: 0.025 + rand() * 0.05,
      a: rand() * Math.PI * 2,
      w: (rand() - 0.5) * 2.4,
      c: palette[Math.floor(rand() * palette.length)],
      p: rand() * Math.PI * 2,
    }));

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const speed = reducedMotion ? 0.45 : 1;
    const drift = DRIFT[kind];
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    // Eased toward the requested intensity, so particles fade in and out
    // instead of popping when a layer is switched on.
    let k = intensityRef.current;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt * speed;
      ctx.clearRect(0, 0, w, h);
      k += (intensityRef.current - k) * Math.min(1, dt * 2.5);
      if (k > 0.001) {
        const unit = Math.min(w, h) / 100; // particle size scales with the stage
        for (const q of parts) {
          q.y += drift * q.v * dt * speed;
          q.a += q.w * dt * speed;
          if (q.y > 1.08) q.y -= 1.16;
          if (q.y < -0.08) q.y += 1.16;
          const sway = drift !== 0 ? Math.sin(clock * 0.9 + q.p) * 0.025 : 0;
          const x = ((q.x + sway + 1) % 1) * w;
          const y = q.y * h;
          const s = q.s * unit;
          ctx.save();
          ctx.translate(x, y);
          ctx.fillStyle = q.c;
          switch (kind) {
            case 'petals': {
              ctx.globalAlpha = 0.85 * k;
              ctx.rotate(q.a);
              ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(q.a * 1.3)));
              ctx.beginPath();
              ctx.ellipse(0, 0, s * 1.5, s * 0.9, 0, 0, Math.PI * 2);
              ctx.fill();
              break;
            }
            case 'confetti': {
              ctx.globalAlpha = 0.95 * k;
              ctx.rotate(q.a);
              ctx.scale(Math.cos(q.a * 2), 1);
              ctx.fillRect(-s * 0.9, -s * 0.45, s * 1.8, s * 0.9);
              break;
            }
            case 'snow': {
              ctx.globalAlpha = (0.55 + 0.35 * q.s) * k;
              ctx.beginPath();
              ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2);
              ctx.fill();
              break;
            }
            case 'lanterns': {
              const flick = 0.75 + 0.25 * Math.sin(clock * 3 + q.p);
              const r = s * 2.2;
              const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3);
              g.addColorStop(0, q.c);
              g.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.globalAlpha = 0.35 * flick * k;
              ctx.fillStyle = g;
              ctx.fillRect(-r * 3, -r * 3, r * 6, r * 6);
              ctx.globalAlpha = 0.95 * k;
              ctx.fillStyle = q.c;
              ctx.beginPath();
              ctx.ellipse(0, 0, r * 0.75, r, 0, 0, Math.PI * 2);
              ctx.fill();
              break;
            }
            case 'fireflies': {
              const pulse = 0.4 + 0.6 * Math.abs(Math.sin(clock * 1.6 + q.p));
              const r = s * 2.4;
              const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
              g.addColorStop(0, q.c);
              g.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.globalAlpha = pulse * k;
              ctx.fillStyle = g;
              ctx.beginPath();
              ctx.arc(Math.sin(clock + q.p) * s * 3, 0, r, 0, Math.PI * 2);
              ctx.fill();
              break;
            }
            default: {
              // sparkle + stars: fixed points that twinkle; sparkle draws a
              // four-point glint, stars a soft dot.
              const tw = 0.25 + 0.75 * Math.abs(Math.sin(clock * (0.8 + q.v * 12) + q.p));
              ctx.globalAlpha = tw * k;
              if (kind === 'sparkle') {
                const r = s * 2.4 * tw;
                ctx.beginPath();
                ctx.moveTo(0, -r);
                ctx.quadraticCurveTo(0, 0, r, 0);
                ctx.quadraticCurveTo(0, 0, 0, r);
                ctx.quadraticCurveTo(0, 0, -r, 0);
                ctx.quadraticCurveTo(0, 0, 0, -r);
                ctx.fill();
              } else {
                ctx.beginPath();
                ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible') {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [kind, colors, seed, reducedMotion, density]);

  return <canvas ref={canvasRef} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}
