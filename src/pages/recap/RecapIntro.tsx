/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The keepsake THEME's character as the album settles in — the theme's
 * `intro` kind (beam, curtain, confetti, petals, fade), ~2 s, played once the
 * tap-to-open reveal has handed off (or at once when the host chose no
 * reveal).
 *
 * WHY IT IS NO LONGER AN OPENING. This used to be a 2.2 s auto-playing
 * overlay that covered the album. The album now opens on a tap
 * (RecapReveal.tsx), and two opening moments back to back would be one too
 * many — so the theme keeps its character here instead: petals drift down
 * after a midnight-bloom album opens, confetti bursts over a confetti album,
 * a warm curtain of light parts on golden hour. It is pure decoration:
 *   • transparent, `pointer-events: none`, above the album — the page is
 *     usable from its first frame and nothing waits for it;
 *   • GSAP on transform/opacity; confetti is one small 2D canvas (no WebGL);
 *   • a wall-clock fail-safe unmounts it even if a tween never completes,
 *     and any throw while building the timeline unmounts it at once.
 * lib/recapReveal.ts `settleKind` decides whether it plays (never the beam
 * twice, and only a soft glow under reduced motion).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { RECAP_SETTLE_FAILSAFE_MS, type SettleKind } from '../../lib/recapReveal';

/** Tiny seeded PRNG so petals/confetti fall the same way on every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export default function RecapIntro({ kind, onDone }: { kind: SettleKind; onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  };

  // Fail-safe: gone by now whatever GSAP did.
  useEffect(() => {
    const t = setTimeout(finish, RECAP_SETTLE_FAILSAFE_MS);
    return () => clearTimeout(t);
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    let stopConfetti = () => {};
    let ctx: gsap.Context | null = null;
    try {
      ctx = gsap.context(() => {
        const tl = gsap.timeline({ onComplete: finish });
        if (kind === 'beam') {
          // One soft sweep of the theme's light across the settled page.
          tl.fromTo('[data-settle-beam]', { opacity: 0 }, { opacity: 0.55, duration: 0.25, ease: 'none' }, 0)
            .fromTo('[data-settle-beam]', { xPercent: -130 }, { xPercent: 330, duration: 1.6, ease: 'power1.inOut', immediateRender: false }, 0)
            .to('[data-settle-beam]', { opacity: 0, duration: 0.4 }, 1.25);
        } else if (kind === 'curtain') {
          // A warm curtain of LIGHT (not cloth — the page is already open)
          // parting from the centre seam.
          tl.fromTo('[data-settle-curtain="l"]', { xPercent: 0, opacity: 0.9 }, { xPercent: -100, opacity: 0, duration: 1.6, ease: 'power2.inOut' }, 0)
            .fromTo('[data-settle-curtain="r"]', { xPercent: 0, opacity: 0.9 }, { xPercent: 100, opacity: 0, duration: 1.6, ease: 'power2.inOut' }, 0)
            .fromTo('[data-settle-seam]', { opacity: 1, scaleY: 1 }, { opacity: 0, scaleY: 1.2, duration: 0.7, ease: 'power1.out' }, 0.05);
        } else if (kind === 'confetti') {
          tl.to({}, { duration: 2.3 });
          stopConfetti = runConfetti(canvasRef.current, root);
        } else if (kind === 'petals') {
          const rand = rng(7);
          gsap.utils.toArray<HTMLElement>('[data-petal]').forEach((el, i) => {
            const x0 = rand() * 100;
            tl.fromTo(
              el,
              { left: `${x0}%`, y: -40, rotation: rand() * 360, opacity: 0.95 },
              { y: () => window.innerHeight + 60, x: (rand() - 0.5) * 140, rotation: `+=${180 + rand() * 260}`, duration: 1.8 + rand() * 0.8, ease: 'sine.in' },
              rand() * 0.6 + (i % 3) * 0.05,
            );
          });
        } else {
          tl.fromTo('[data-fade-glow]', { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.9, ease: 'sine.out' }, 0)
            .to('[data-fade-glow]', { opacity: 0, duration: 1.0, ease: 'sine.in' }, 0.9);
        }
      }, root);
    } catch (e) {
      console.error('[recap] theme settle failed', e);
      finish();
    }
    return () => { stopConfetti(); ctx?.revert(); };
  }, [kind]);

  const petals = kind === 'petals' ? Array.from({ length: 22 }, (_, i) => i) : [];

  return (
    <div
      ref={rootRef}
      data-recap-settle={kind}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
    >
      {kind === 'beam' && (
        <div
          data-settle-beam
          className="absolute -top-1/4 left-0 h-[150%] w-[34vw] min-w-[170px] -rotate-[14deg] opacity-0"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(var(--k-accent-rgb),0.25) 25%, rgba(var(--k-accent-rgb),0.55) 42%, rgba(255,255,255,0.6) 50%, rgba(var(--k-glow-rgb),0.5) 58%, transparent)',
            filter: 'blur(14px)',
            mixBlendMode: 'screen',
          }}
        />
      )}

      {kind === 'curtain' && (
        <>
          {(['l', 'r'] as const).map((side) => (
            <div
              key={side}
              data-settle-curtain={side}
              className={`absolute inset-y-0 w-1/2 ${side === 'l' ? 'left-0' : 'right-0'}`}
              style={{
                background: `linear-gradient(${side === 'l' ? '270deg' : '90deg'}, rgba(var(--k-glow-rgb),0.38), rgba(var(--k-accent-rgb),0.12) 45%, transparent)`,
                mixBlendMode: 'screen',
              }}
            />
          ))}
          <div data-settle-seam className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-[color:var(--k-glow)] shadow-[0_0_24px_6px_rgba(var(--k-glow-rgb),0.6)]" />
        </>
      )}

      {kind === 'confetti' && <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />}

      {petals.map((i) => (
        <span
          key={i}
          data-petal
          className="absolute top-0 block h-4 w-3 rounded-[80%_0_80%_0]"
          style={{ background: i % 3 === 0 ? 'var(--k-glow)' : 'var(--k-accent)', opacity: 0, boxShadow: '0 0 12px rgba(var(--k-accent-rgb),0.45)' }}
        />
      ))}

      {kind === 'fade' && (
        <div
          data-fade-glow
          className="absolute left-1/2 top-[22%] h-[60vmin] w-[60vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(var(--k-glow-rgb),0.28)] opacity-0 blur-3xl"
        />
      )}
    </div>
  );
}

/** One burst of confetti on a 2D canvas, ~2.2s. Returns a stop function. */
function runConfetti(canvas: HTMLCanvasElement | null, root: HTMLElement): () => void {
  if (canvas === null) return () => {};
  const ctx = canvas.getContext('2d');
  if (ctx === null) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = root.clientWidth;
  const h = root.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(root);
  const colors = [css.getPropertyValue('--k-accent'), css.getPropertyValue('--k-glow'), css.getPropertyValue('--k-ink'), '#7ee0ff', '#ff8fd1']
    .map((c) => c.trim()).filter((c) => c !== '');
  const rand = rng(42);
  const n = w < 500 ? 90 : 140;
  const parts = Array.from({ length: n }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (rand() - 0.5) * 0.7;
    const speed = (0.9 + rand() * 0.9) * Math.max(h, 600) * 1.25;
    return {
      x: fromLeft ? w * 0.08 : w * 0.92,
      y: h * 0.95,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: rand() * Math.PI,
      vr: (rand() - 0.5) * 12,
      s: 5 + rand() * 6,
      c: colors[i % colors.length],
    };
  });
  const g = Math.max(h, 600) * 1.6;
  const t0 = performance.now();
  let last = t0;
  let id = 0;
  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    const age = (now - t0) / 1000;
    for (const p of parts) {
      p.vy += g * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1.6) / 0.6);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (age < 2.3) id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}
