/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The album's opening moment — one per keepsake theme intro (beam, curtain,
 * confetti, petals, fade), ~2.2s, then the overlay lifts off the page.
 *
 * WHAT IT IS ALLOWED TO COST.
 *   • It is an OVERLAY (position: fixed) above an album that is already laid
 *     out underneath, so lifting it shifts nothing.
 *   • Motion is GSAP on transform / opacity / clip-path; confetti is one small
 *     2D canvas (no WebGL — the card reveals' three.js scenes are a lazy chunk
 *     for a reason, and an album needs none of it).
 *   • A tap anywhere (or the Skip button, or Escape) ends it at once.
 *   • It can NEVER keep the album hidden: a wall-clock fail-safe ends it even
 *     if a tween never completes, and any throw while building the timeline
 *     ends it immediately.
 *
 * The parent decides WHETHER it plays (once per visit via sessionStorage, and
 * never under prefers-reduced-motion — the album's markup already IS the final
 * state, so declining to mount this is the whole reduced-motion path).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import type { KeepsakeThemeOption } from '../../lib/keepsakeSettings';
import type { Post } from '../../types';
import PostImage from '../../components/ui/PostImage';

/** Wall-clock ceiling: the overlay is gone by now whatever GSAP did. */
const INTRO_FAILSAFE_MS = 3600;
const OUT_S = 0.55;

type IntroKind = KeepsakeThemeOption['intro'];

/** Tiny seeded PRNG so petals/confetti fall the same way on every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export default function RecapIntro({
  kind,
  eyebrow,
  title,
  photos,
  onLift,
  onDone,
}: {
  kind: IntroKind;
  eyebrow: string;
  title: string;
  /** The album, newest first; the first three appear in the intro. */
  photos: readonly Post[];
  /** The overlay has started to fade off (the page may start arriving). */
  onLift?: () => void;
  onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onLiftRef = useRef(onLift);
  onLiftRef.current = onLift;
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const prints = photos.filter((p) => p.media_type !== 'video').slice(0, 3);

  const finish = (fast: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    tlRef.current?.kill();
    onLiftRef.current?.();
    const root = rootRef.current;
    if (root === null || fast) {
      onDoneRef.current();
      return;
    }
    try {
      gsap.to(root, { opacity: 0, duration: OUT_S, ease: 'power2.out', onComplete: () => onDoneRef.current() });
    } catch {
      onDoneRef.current();
    }
  };

  // Fail-safe + keyboard skip.
  useEffect(() => {
    const t = setTimeout(() => finish(true), INTRO_FAILSAFE_MS + OUT_S * 1000);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(false); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    let stopConfetti = () => {};
    let ctx: gsap.Context | null = null;
    try {
      ctx = gsap.context(() => {
        const tl = gsap.timeline({ onComplete: () => finish(false) });
        tlRef.current = tl;
        const words = '[data-intro-line]';
        const prints = '[data-intro-print]';
        if (kind === 'beam') {
          gsap.set(words, { opacity: 0, clipPath: 'inset(0 100% 0 0)' });
          gsap.set(prints, { opacity: 0, clipPath: 'inset(0 100% 0 0)', scale: 1.06 });
          // The beam is bright from its first frame and sweeps at an even
          // pace, so whatever moment you look, it is ON screen; the prints and
          // the name resolve left-to-right in its wake.
          tl.fromTo('[data-beam]', { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'none' }, 0)
            .fromTo('[data-beam]', { xPercent: -130 }, { xPercent: 330, duration: 1.7, ease: 'power1.inOut', immediateRender: false }, 0)
            .to('[data-beam]', { opacity: 0, duration: 0.35 }, 1.5)
            .fromTo('[data-beam-flare]', { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 1.1, ease: 'power1.inOut' }, 0.2)
            .to('[data-beam-flare]', { opacity: 0, duration: 0.5 }, 1.4)
            .to(prints, { opacity: 1, clipPath: 'inset(0 0% 0 0)', scale: 1, duration: 0.8, stagger: 0.14, ease: 'power2.out' }, 0.45)
            .to(words, { opacity: 1, clipPath: 'inset(0 0% 0 0)', duration: 0.8, stagger: 0.12, ease: 'power2.out' }, 0.7)
            .to({}, { duration: 0.45 });
        } else if (kind === 'curtain') {
          gsap.set([words, prints], { opacity: 0, y: 14 });
          tl.to('[data-curtain="l"]', { xPercent: -102, duration: 1.5, ease: 'power2.inOut' }, 0.4)
            .to('[data-curtain="r"]', { xPercent: 102, duration: 1.5, ease: 'power2.inOut' }, 0.4)
            .to('[data-curtain-tie]', { opacity: 0, duration: 0.3 }, 0.35)
            .to(prints, { opacity: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' }, 0.8)
            .to(words, { opacity: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' }, 0.95)
            .to({}, { duration: 0.35 });
        } else if (kind === 'confetti') {
          gsap.set([words, prints], { opacity: 0, scale: 0.85 });
          tl.to(prints, { opacity: 1, scale: 1, duration: 0.55, stagger: 0.07, ease: 'back.out(1.8)' }, 0.25)
            .to(words, { opacity: 1, scale: 1, duration: 0.55, stagger: 0.07, ease: 'back.out(1.8)' }, 0.35)
            .to({}, { duration: 1.4 });
          stopConfetti = runConfetti(canvasRef.current, root);
        } else if (kind === 'petals') {
          gsap.set([words, prints], { opacity: 0, y: -10 });
          const rand = rng(7);
          gsap.utils.toArray<HTMLElement>('[data-petal]').forEach((el, i) => {
            const x0 = rand() * 100;
            tl.fromTo(el,
              { left: `${x0}%`, yPercent: 0, y: -40, rotation: rand() * 360, opacity: 0.95 },
              { y: () => window.innerHeight + 60, x: (rand() - 0.5) * 140, rotation: `+=${180 + rand() * 260}`, duration: 1.8 + rand() * 0.8, ease: 'sine.in' },
              rand() * 0.6 + (i % 3) * 0.05,
            );
          });
          tl.to(prints, { opacity: 1, y: 0, duration: 0.9, stagger: 0.1, ease: 'sine.out' }, 0.35)
            .to(words, { opacity: 1, y: 0, duration: 0.9, stagger: 0.1, ease: 'sine.out' }, 0.5);
        } else {
          gsap.set([words, prints], { opacity: 0 });
          tl.fromTo('[data-fade-glow]', { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 1.4, ease: 'sine.out' }, 0)
            .to(prints, { opacity: 1, duration: 0.9, stagger: 0.12, ease: 'sine.out' }, 0.2)
            .to(words, { opacity: 1, duration: 0.9, stagger: 0.12, ease: 'sine.out' }, 0.35)
            .to({}, { duration: 0.6 });
        }
      }, root);
    } catch (e) {
      console.error('[recap] intro failed; showing the album', e);
      finish(true);
    }
    return () => { stopConfetti(); ctx?.revert(); };
  }, [kind]);

  const petals = kind === 'petals' ? Array.from({ length: 22 }, (_, i) => i) : [];

  return (
    <div
      ref={rootRef}
      data-recap-intro={kind}
      onClick={() => finish(false)}
      className="fixed inset-0 z-[80] flex cursor-pointer items-center justify-center overflow-hidden bg-[color:var(--k-bg)]"
      role="presentation"
    >
      {/* Ambient wash so the stage is never flat black. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(70% 55% at 50% 45%, rgba(var(--k-accent-rgb),0.22), transparent 70%), radial-gradient(60% 40% at 50% 100%, rgba(var(--k-glow-rgb),0.12), transparent 70%)' }}
      />

      {kind === 'beam' && (
        <>
          <div
            data-beam
            aria-hidden
            className="pointer-events-none absolute -top-1/4 left-0 h-[150%] w-[34vw] min-w-[170px] -rotate-[14deg]"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(var(--k-accent-rgb),0.35) 22%, rgba(var(--k-accent-rgb),0.85) 40%, rgba(255,255,255,1) 50%, rgba(var(--k-glow-rgb),0.85) 60%, rgba(var(--k-glow-rgb),0.3) 78%, transparent)',
              filter: 'blur(8px)',
              mixBlendMode: 'screen',
            }}
          />
          <div
            data-beam-flare
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-1/2 h-px origin-left"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(var(--k-glow-rgb),0.9), rgba(255,255,255,0.9), transparent)', boxShadow: '0 0 24px 4px rgba(var(--k-accent-rgb),0.6)' }}
          />
        </>
      )}

      {kind === 'curtain' && (
        <>
          {(['l', 'r'] as const).map((side) => (
            <div
              key={side}
              data-curtain={side}
              aria-hidden
              className={`pointer-events-none absolute inset-y-0 z-20 w-1/2 ${side === 'l' ? 'left-0' : 'right-0'}`}
              style={{
                background: `repeating-linear-gradient(90deg, rgba(0,0,0,0.28) 0 6px, rgba(255,255,255,0.05) 14px, rgba(0,0,0,0.22) 26px), linear-gradient(${side === 'l' ? '90deg' : '270deg'}, var(--k-surface), rgba(var(--k-accent-rgb),0.55))`,
                boxShadow: side === 'l' ? 'inset -18px 0 30px -12px rgba(0,0,0,0.55)' : 'inset 18px 0 30px -12px rgba(0,0,0,0.55)',
              }}
            />
          ))}
          <div data-curtain-tie aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-30 w-[3px] -translate-x-1/2 bg-[color:var(--k-glow)] shadow-[0_0_24px_6px_rgba(var(--k-glow-rgb),0.6)]" />
        </>
      )}

      {kind === 'confetti' && <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-20 h-full w-full" />}

      {petals.map((i) => (
        <span
          key={i}
          data-petal
          aria-hidden
          className="pointer-events-none absolute top-0 z-20 block h-4 w-3 rounded-[80%_0_80%_0]"
          style={{ background: i % 3 === 0 ? 'var(--k-glow)' : 'var(--k-accent)', opacity: 0, boxShadow: '0 0 12px rgba(var(--k-accent-rgb),0.45)' }}
        />
      ))}

      {kind === 'fade' && (
        <div data-fade-glow aria-hidden className="pointer-events-none absolute h-[60vmin] w-[60vmin] rounded-full bg-[rgba(var(--k-glow-rgb),0.35)] blur-3xl" />
      )}

      <div className="relative z-10 flex max-w-xl flex-col items-center gap-5 px-6 text-center">
        {prints.length > 0 && (
          <ul className="flex items-end justify-center -space-x-4" aria-hidden>
            {prints.map((p, i) => (
              <li
                key={p.id}
                data-intro-print
                className="w-20 overflow-hidden rounded-xl border border-[color:var(--k-line)] shadow-[0_20px_40px_-20px_var(--k-shadow)] sm:w-28"
                style={{ aspectRatio: '3 / 4', transform: `rotate(${[-7, 0, 6][i]}deg)`, zIndex: i === 1 ? 2 : 1 }}
              >
                <PostImage src={p.image_url} alt="" displayWidth={160} eager className="h-full w-full object-cover" />
              </li>
            ))}
          </ul>
        )}
        <p data-intro-line className="font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-accent-text)]">{eyebrow}</p>
        <h1 data-intro-line className="font-serif italic text-4xl leading-[1.05] text-[color:var(--k-ink)] sm:text-6xl">{title}</h1>
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); finish(false); }}
        className="absolute bottom-6 right-5 z-40 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[color:var(--k-line)] bg-[rgba(var(--k-surface-rgb),0.6)] px-5 font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-ink)] backdrop-blur"
      >
        Skip
      </button>
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
