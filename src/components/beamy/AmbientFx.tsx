/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AmbientFx — the hero's ambient decor: soft snow for Christmas looks,
 * slow glints for party looks (lib/ambientFx holds the math). One small 2D
 * canvas, a few dozen motes at most, sized to the device pixel ratio
 * (capped at 2). It never takes a tap (pointer-events none), draws nothing
 * under reduced motion, and stops its frame loop whenever it is off screen
 * or the tab is hidden.
 */
import { useEffect, useRef } from 'react';
import { ambientCount, moteAlpha, seedMotes, stepMotes, type AmbientKind, type Mote } from '../../lib/ambientFx';
import { seededRandom } from '../../lib/brandLanding';

export default function AmbientFx({ kind, reduced, className = '' }: { kind: AmbientKind; reduced: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d') ?? null;
    if (cv === null || ctx === null || reduced) return;
    let w = 0;
    let h = 0;
    let motes: Mote[] = [];
    let raf = 0;
    let last = 0;
    let seen = true;
    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      motes = seedMotes(kind, ambientCount(kind, w, h, false), w, h, seededRandom(kind === 'snow' ? 11 : 23));
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        const a = moteAlpha(kind, m, t);
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        if (kind === 'snow') {
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // A four-point glint: two thin crossed strokes and a warm core.
          ctx.strokeStyle = '#FFE7B8';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(m.x - m.r, m.y); ctx.lineTo(m.x + m.r, m.y);
          ctx.moveTo(m.x, m.y - m.r); ctx.lineTo(m.x, m.y + m.r);
          ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(m.x, m.y, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };
    const frame = (now: number) => {
      const t = now / 1000;
      stepMotes(kind, motes, last === 0 ? 0 : t - last, w, h, t);
      last = t;
      draw(t);
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      const go = seen && !document.hidden;
      if (go && raf === 0) { last = 0; raf = requestAnimationFrame(frame); }
      if (!go && raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    const io = new IntersectionObserver((es) => { seen = es.some((e) => e.isIntersecting); run(); });
    io.observe(cv);
    document.addEventListener('visibilitychange', run);
    run();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', run);
      ctx.clearRect(0, 0, cv.width, cv.height);
    };
  }, [kind, reduced]);

  if (reduced) return null;
  return <canvas ref={ref} aria-hidden className={`pointer-events-none ${className}`} />;
}
