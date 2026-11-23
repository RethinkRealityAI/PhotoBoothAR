/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 'beam' — Beamwall's own opening for the album page (/r/:slug), the default
 * keepsake reveal. A lazy chunk (RecapReveal.tsx). The card reveals' rules
 * (src/components/cards/reveals/types.ts) are the bar it is held to.
 *
 *   • IDLE (as long as the guest likes): deep night in the keepsake theme's
 *     colours, motes of light drifting up, the page's faint diagonal beam
 *     breathing, and the night's prints stacked in the middle, sealed by a
 *     band of light with a glowing seal. The event's name sits exactly where
 *     the album's heading will be. One real <button> ("Open the album",
 *     ≥48px) — the whole stage is a tap target too, and Enter/Space open it.
 *   • THE TAP: a shaft of light drops onto the seal, it flares and splits in
 *     two, the band slides away both ways and throws out motes, one wide beam
 *     sweeps the screen, and the prints fan out of the stack and land on the
 *     album hero's own prints — measured from the album mounted (inert)
 *     underneath, same tilts, same stacking — so the page's cross-fade is one
 *     picture dissolving into itself. Then onDone, once. 3.4 s.
 *   • REDUCED MOTION: the same story, never skipped: the strike fades in
 *     instead of dropping, the seal's halves part a little, the sweep is a
 *     wash that does not travel, the prints glide with no overshoot, a third
 *     of the particles (lib/recapReveal beamBeats/beamBudget).
 *
 * Costs: GSAP on transform/opacity, one 2D canvas for the motes. No WebGL, so
 * it plays on any phone and never competes with anything for a GPU context.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import type { Post } from '../../types';
import PostImage from '../../components/ui/PostImage';
import { burstMotes } from '../../lib/cardReveal';
import {
  HERO_PRINTS,
  beamBeats,
  beamBudget,
  fallbackHeroBoxes,
  fanTiming,
  heroPrintTilt,
  heroPrintZ,
  stackPose,
  type Box,
} from '../../lib/recapReveal';
import { K_PRIMARY } from './recapStyles';

/** Where the album's hero will be, measured from the album underneath. */
export interface HeroLanding {
  prints: Box[];
  eyebrow: Box | null;
  title: Box | null;
}

export interface BeamRevealProps {
  /** The album's title: the event's name. */
  title: string;
  /** The line above it (the night's date when the eyebrow would repeat the title). */
  eyebrow: string;
  /** "24 moments inside". */
  line: string;
  /** The album, newest first; the first HERO_PRINTS are the stack. */
  photos: readonly Post[];
  reducedMotion: boolean;
  /** Measure the album's hero now (null when it cannot be measured). */
  measure: () => HeroLanding | null;
  /** The album is on screen under the landed prints — hand over. Called once. */
  onDone: () => void;
}

/** The hero prints' corner radius (RecapHero: rounded-2xl). */
const HERO_RADIUS_PX = 16;
/** Room kept clear at the bottom for the line and the Open button. */
const FOOT_PX = 132;

interface Geo {
  vw: number;
  vh: number;
  stackW: number;
  stackH: number;
  cx: number;
  cy: number;
  targets: Box[];
  eyebrow: Box | null;
  title: Box | null;
}

function computeGeo(vw: number, vh: number, landing: HeroLanding | null, n: number): Geo {
  const titleBottom = landing?.title ? landing.title.y + landing.title.h : vh * 0.26;
  const top = titleBottom + 28;
  const room = Math.max(160, vh - FOOT_PX - top - 16);
  const stackW = Math.round(Math.max(118, Math.min(200, vw * 0.42, room * 0.72)));
  const stackH = Math.round((stackW * 4) / 3);
  const cy = Math.round(top + Math.max(stackH / 2 + 12, (vh - FOOT_PX - top) / 2));
  const measured = landing !== null && landing.prints.length === n ? landing.prints : null;
  return {
    vw,
    vh,
    stackW,
    stackH,
    cx: Math.round(vw / 2),
    cy,
    targets: measured ?? fallbackHeroBoxes(vw, vh, n),
    eyebrow: landing?.eyebrow ?? null,
    title: landing?.title ?? null,
  };
}

/** The little Beamwall mark on the seal: a ray of light and its spark. */
function BeamMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <path d="M6 26 L22 10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
      <path d="M22 4 L23.6 8.4 L28 10 L23.6 11.6 L22 16 L20.4 11.6 L16 10 L20.4 8.4 Z" fill="currentColor" />
    </svg>
  );
}

export default function BeamReveal({ title, eyebrow, line, photos, reducedMotion, measure, onDone }: BeamRevealProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const openBtnRef = useRef<HTMLButtonElement | null>(null);
  const openedRef = useRef(false);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const openCtx = useRef<gsap.Context | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);

  const prints = useMemo(() => photos.slice(0, HERO_PRINTS), [photos]);
  const n = prints.length;
  const rm = reducedMotion;

  // Measure the screen AND the album's hero. Frozen once opened: the flight
  // is computed from these numbers.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const run = () => {
      if (openedRef.current) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      let landing: HeroLanding | null = null;
      try {
        landing = measure();
      } catch {
        landing = null;
      }
      setGeo(computeGeo(Math.round(r.width), Math.round(r.height), landing, n));
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    // The album's serif may land after first paint and re-wrap the heading.
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) run(); }).catch(() => {});
    return () => { alive = false; ro.disconnect(); };
  }, [measure, n]);

  const motes = useMemo(
    () => (geo ? burstMotes(beamBudget(rm, geo.vw).burstMotes, Math.min(geo.vw, geo.vh) * 0.42, 23) : []),
    [geo, rm],
  );

  // Focus the Open button so Enter/Space work at once, without painting a
  // focus ring on load (a keyboard user who tabs still gets one).
  useEffect(() => {
    const el = openBtnRef.current;
    if (el === null || openedRef.current) return;
    const opts: FocusOptions & { focusVisible?: boolean } = { preventScroll: true, focusVisible: false };
    el.focus(opts);
  }, [geo !== null]);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  // ── Idle: the stack in place, the seal breathing, the beam breathing ──
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null || geo === null || openedRef.current) return;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);
      q('[data-bm-print]').forEach((el, i) => {
        const t = geo.targets[i];
        if (t === undefined) return;
        const pose = stackPose(i);
        gsap.set(el, {
          x: geo.cx + pose.x - (t.x + t.w / 2),
          y: geo.cy + pose.y - (t.y + t.h / 2),
          rotation: pose.rot,
          scale: 1,
          transformOrigin: '50% 50%',
        });
      });
      gsap.fromTo(q('[data-bm-float]'), { opacity: 0, y: rm ? 0 : 18 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out' });
      gsap.fromTo(q('[data-bm-foot]'), { opacity: 0 }, { opacity: 1, duration: 0.8, delay: 0.5 });
      gsap.fromTo(q('[data-bm-head]'), { opacity: 0 }, { opacity: 1, duration: 0.9, delay: 0.15 });
      // The stack floats.
      gsap.to(q('[data-bm-bob]'), { y: rm ? -2 : -6, rotation: rm ? 0 : 0.6, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      // The band's light travels, the seal breathes, the room's beam breathes.
      gsap.fromTo(q('[data-bm-band-shine]'), { xPercent: -120 }, { xPercent: 220, duration: rm ? 4.2 : 2.6, ease: 'sine.inOut', repeat: -1, repeatDelay: rm ? 1.6 : 0.9 });
      gsap.to(q('[data-bm-seal-halo]'), { scale: rm ? 1.06 : 1.18, opacity: 0.95, duration: 1.8, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      gsap.to(q('[data-bm-room-beam]'), { opacity: 0.85, duration: 3.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    }, root);
    return () => ctx.revert();
  }, [geo, rm]);

  // ── Motes: one 2D canvas, drifting up, twinkling ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (canvas === null || root === null || geo === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { vw: w, vh: h } = geo;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(root);
    const colors = ['--k-accent', '--k-glow', '--k-ink']
      .map((k) => css.getPropertyValue(k).trim())
      .filter((c) => c !== '');
    // Deterministic sky: the same motes on every visit.
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const count = beamBudget(rm, w).idleMotes;
    const speed = rm ? 0.35 : 1;
    const parts = Array.from({ length: count }, (_, i) => ({
      x: rand() * w,
      y: rand() * h,
      r: 0.6 + rand() * 1.8,
      vy: (6 + rand() * 16) * speed,
      sway: 6 + rand() * 14,
      phase: rand() * Math.PI * 2,
      c: colors.length > 0 ? colors[i % colors.length] : '#ffffff',
    }));
    let id = 0;
    let last = performance.now();
    const t0 = last;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const age = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.y -= p.vy * dt;
        if (p.y < -8) {
          p.y = h + 8;
          p.x = rand() * w;
        }
        const x = p.x + Math.sin(age * 0.5 * speed + p.phase) * p.sway;
        const tw = rm ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(age * 1.7 + p.phase * 3));
        ctx.globalAlpha = 0.75 * tw;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        if (p.r > 1.7) {
          ctx.globalAlpha = 0.12 * tw;
          ctx.beginPath();
          ctx.arc(x, p.y, p.r * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [geo, rm]);

  // ── The tap ──
  const open = useCallback(() => {
    const root = rootRef.current;
    if (openedRef.current || root === null || geo === null) return;
    openedRef.current = true;
    const B = beamBeats(rm);
    try {
      openCtx.current = gsap.context(() => {
        const q = gsap.utils.selector(root);
        const tl = gsap.timeline({ onComplete: finish });

        // 1. The button leaves; the stack stops floating and draws a breath.
        tl.to(q('[data-bm-foot]'), { opacity: 0, y: rm ? 0 : 10, duration: B.arm.dur, ease: 'power1.in' }, B.arm.at);
        tl.to(q('[data-bm-bob]'), { y: 0, rotation: 0, overwrite: true, duration: B.arm.dur, ease: 'power2.out' }, B.arm.at);
        tl.to(q('[data-bm-stack-breath]'), { scale: rm ? 0.99 : 0.965, duration: B.arm.dur + B.strike.dur * 0.6, ease: 'power2.in' }, B.arm.at);

        // 2. A shaft of light drops onto the seal.
        if (rm) {
          tl.fromTo(q('[data-bm-strike]'), { opacity: 0, scaleY: 1 }, { opacity: 0.8, duration: B.strike.dur, ease: 'sine.inOut' }, B.strike.at);
        } else {
          tl.fromTo(q('[data-bm-strike]'), { opacity: 1, scaleY: 0 }, { scaleY: 1, duration: B.strike.dur, ease: 'expo.in' }, B.strike.at);
        }
        tl.to(q('[data-bm-strike]'), { opacity: 0, duration: 0.5, ease: 'power1.out' }, B.flash.at + 0.08);

        // 3. The seal flares and splits; the band slides off both ways.
        tl.fromTo(
          q('[data-bm-flash]'),
          { opacity: 0, scale: 0.2 },
          { opacity: rm ? 0.7 : 1, scale: rm ? 1.4 : 2.6, duration: B.flash.dur * 0.45, ease: 'power2.out' },
          B.flash.at,
        );
        tl.to(q('[data-bm-flash]'), { opacity: 0, duration: B.flash.dur * 0.55, ease: 'power1.in' }, B.flash.at + B.flash.dur * 0.45);
        tl.to(q('[data-bm-seal-whole]'), { opacity: 0, duration: 0.08 }, B.seal.at);
        // The halo goes with the seal (overwrite: it was breathing on a loop).
        tl.to(q('[data-bm-seal-halo]'), { opacity: 0, scale: rm ? 1.1 : 1.7, overwrite: true, duration: B.seal.dur, ease: 'power2.out' }, B.seal.at);
        tl.set(q('[data-bm-seal-half]'), { opacity: 1 }, B.seal.at);
        tl.to(q('[data-bm-seal-half="l"]'), { x: rm ? -14 : -70, y: rm ? 0 : 26, rotation: rm ? -6 : -38, opacity: 0, duration: B.seal.dur, ease: 'power2.out' }, B.seal.at);
        tl.to(q('[data-bm-seal-half="r"]'), { x: rm ? 14 : 70, y: rm ? 0 : 26, rotation: rm ? 6 : 38, opacity: 0, duration: B.seal.dur, ease: 'power2.out' }, B.seal.at);
        tl.to(q('[data-bm-band="l"]'), { xPercent: rm ? -18 : -70, opacity: 0, duration: B.seal.dur, ease: 'power3.out' }, B.seal.at);
        tl.to(q('[data-bm-band="r"]'), { xPercent: rm ? 18 : 70, opacity: 0, duration: B.seal.dur, ease: 'power3.out' }, B.seal.at);
        q('[data-bm-mote]').forEach((el, i) => {
          const m = motes[i];
          if (m === undefined) return;
          tl.fromTo(
            el,
            { x: 0, y: 0, opacity: 1, scale: 1 },
            { x: m.dx, y: m.dy, opacity: 0, scale: 0.4, duration: B.seal.dur * 1.8, ease: 'power3.out' },
            B.seal.at + m.delay,
          );
        });
        tl.to(q('[data-bm-stack-breath]'), { scale: 1, duration: 0.4, ease: 'back.out(2)' }, B.seal.at);

        // 4. One wide beam sweeps the whole screen.
        if (rm) {
          tl.fromTo(q('[data-bm-sweep]'), { opacity: 0, xPercent: 100 }, { opacity: 0.45, duration: B.sweep.dur * 0.4, ease: 'sine.inOut' }, B.sweep.at);
          tl.to(q('[data-bm-sweep]'), { opacity: 0, duration: B.sweep.dur * 0.6, ease: 'sine.inOut' }, B.sweep.at + B.sweep.dur * 0.4);
        } else {
          tl.fromTo(q('[data-bm-sweep]'), { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'none' }, B.sweep.at);
          tl.fromTo(q('[data-bm-sweep]'), { xPercent: -130 }, { xPercent: 330, duration: B.sweep.dur, ease: 'power1.inOut', immediateRender: false }, B.sweep.at);
          tl.to(q('[data-bm-sweep]'), { opacity: 0, duration: 0.35 }, B.sweep.at + B.sweep.dur - 0.35);
        }
        // The heading catches the light as the beam passes.
        // (filter, not text-shadow: GSAP cannot interpolate a var() colour.)
        tl.fromTo(
          q('[data-bm-title]'),
          { filter: 'brightness(1)' },
          { filter: rm ? 'brightness(1.15)' : 'brightness(1.45)', duration: B.title.dur * 0.4, ease: 'sine.out', yoyo: true, repeat: 1 },
          B.title.at,
        );

        // 5. The prints fan out of the stack onto the album's hero.
        const { stagger, each } = fanTiming(B.fan, Math.max(1, n));
        q('[data-bm-print]').forEach((el, i) => {
          const t = geo.targets[i];
          if (t === undefined) return;
          const s = t.w / geo.stackW;
          const at = B.fan.at + i * stagger;
          tl.to(
            el,
            { x: 0, y: 0, rotation: heroPrintTilt(i), scale: s, duration: each, ease: rm ? 'power2.inOut' : 'expo.out' },
            at,
          );
          const photo = el.querySelector('[data-bm-photo]');
          if (photo !== null) {
            tl.to(photo, { borderRadius: HERO_RADIUS_PX / s, duration: each * 0.6, ease: 'power2.out' }, at);
          }
          const frame = el.querySelector('[data-bm-frame]');
          if (frame !== null) tl.to(frame, { opacity: 0, duration: each * 0.3, ease: 'power1.out' }, at);
          const trail = el.querySelector('[data-bm-trail]');
          if (trail !== null) {
            tl.fromTo(trail, { opacity: 0 }, { opacity: rm ? 0.4 : 0.9, duration: each * 0.25 }, at);
            tl.to(trail, { opacity: 0, duration: each * 0.6 }, at + each * 0.3);
          }
        });
        tl.to(q('[data-bm-empty]'), { opacity: 0, scale: rm ? 1 : 1.08, duration: B.fan.dur * 0.6, ease: 'power2.out' }, B.fan.at);

        // 6. The stage light eases to the album page's own light.
        tl.to(q('[data-bm-stage-glow]'), { opacity: 0, duration: B.calm.dur, ease: 'sine.inOut' }, B.calm.at);
        tl.to(q('[data-bm-motes]'), { opacity: 0, duration: B.calm.dur, ease: 'sine.inOut' }, B.calm.at);
        tl.to(q('[data-bm-room-beam]'), { opacity: 0.4, overwrite: true, duration: B.calm.dur, ease: 'sine.inOut' }, B.calm.at);

        // 7. A held beat on the landed album, then hand over.
        tl.to({}, { duration: B.hold.dur }, B.hold.at);
      }, root);
    } catch (e) {
      console.error('[recap] beam reveal failed; showing the album', e);
      finish();
    }
  }, [geo, rm, n, motes, finish]);

  // Enter / Space open it from anywhere on the stage (not from another control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target as HTMLElement | null;
      if (t !== null && t !== document.body && !rootRef.current?.contains(t)) return;
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => () => openCtx.current?.revert(), []);

  const titleStyle = geo?.title
    ? { position: 'absolute' as const, left: geo.title.x, top: geo.title.y, width: geo.title.w }
    : undefined;
  const eyebrowStyle = geo?.eyebrow
    ? { position: 'absolute' as const, left: geo.eyebrow.x, top: geo.eyebrow.y, width: geo.eyebrow.w }
    : undefined;
  const bandW = geo ? geo.stackW + 64 : 0;

  return (
    <div
      ref={rootRef}
      data-recap-reveal="beam"
      onClick={open}
      className="absolute inset-0 cursor-pointer select-none overflow-hidden"
      style={{ background: 'var(--k-bg)' }}
    >
      {/* The room's light — the SAME bloom and diagonal beam the album page
          draws, so the hand-off changes nothing behind the prints. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(90% 55% at 50% -5%, rgba(var(--k-accent-rgb),0.28) 0%, transparent 62%), radial-gradient(70% 45% at 85% 105%, rgba(var(--k-glow-rgb),0.16) 0%, transparent 70%)',
        }}
      />
      <div
        data-bm-room-beam
        aria-hidden
        className="pointer-events-none absolute -top-1/3 left-[58%] h-[160%] w-40 -rotate-[18deg] blur-3xl"
        style={{ opacity: 0.4, background: 'linear-gradient(90deg, transparent, rgba(var(--k-accent-rgb),0.35), rgba(var(--k-glow-rgb),0.25), transparent)' }}
      />
      {geo !== null && (
        <div
          data-bm-stage-glow
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            left: geo.cx - geo.stackW * 1.6,
            top: geo.cy - geo.stackW * 1.6,
            width: geo.stackW * 3.2,
            height: geo.stackW * 3.2,
            background: 'radial-gradient(closest-side, rgba(var(--k-accent-rgb),0.34), rgba(var(--k-glow-rgb),0.10) 55%, transparent)',
          }}
        />
      )}
      <canvas ref={canvasRef} data-bm-motes aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* The heading, exactly where the album's will be. */}
      <div data-bm-head className={`pointer-events-none ${geo?.title ? '' : 'absolute inset-x-4 top-[12%] flex flex-col items-center gap-4 text-center'}`}>
        <p
          className="text-center font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-accent-text)]"
          style={eyebrowStyle}
        >
          {eyebrow}
        </p>
        <h1
          data-bm-title
          className="mx-auto max-w-3xl text-center font-serif italic text-[2.6rem] leading-[1.02] text-[color:var(--k-ink)] sm:text-6xl md:text-7xl"
          style={{ ...titleStyle, textShadow: '0 0 48px rgba(var(--k-accent-rgb),0.35)' }}
        >
          {title}
        </h1>
      </div>

      {geo !== null && (
        <div data-bm-float className="pointer-events-none absolute inset-0">
          <div data-bm-bob className="absolute inset-0" style={{ transformOrigin: `${geo.cx}px ${geo.cy}px` }}>
            <div data-bm-stack-breath className="absolute inset-0" style={{ transformOrigin: `${geo.cx}px ${geo.cy}px` }}>
              {n === 0 && (
                <div
                  data-bm-empty
                  aria-hidden
                  className="absolute flex items-center justify-center rounded-[10px] border border-[color:var(--k-line)] bg-[color:var(--k-surface)] text-[color:var(--k-accent)] shadow-[0_30px_60px_-24px_var(--k-shadow)]"
                  style={{ left: geo.cx - geo.stackW / 2, top: geo.cy - geo.stackH / 2, width: geo.stackW, height: geo.stackH }}
                >
                  <BeamMark className="h-12 w-12 opacity-70" />
                </div>
              )}
              {prints.map((p, i) => {
                const t = geo.targets[i];
                if (t === undefined) return null;
                return (
                  <div
                    key={p.id}
                    data-bm-print
                    aria-hidden
                    className="absolute"
                    style={{
                      left: t.x + t.w / 2 - geo.stackW / 2,
                      top: t.y + t.h / 2 - geo.stackH / 2,
                      width: geo.stackW,
                      height: geo.stackH,
                      zIndex: heroPrintZ(i),
                    }}
                  >
                    {/* The print's paper border — a polaroid while sealed, gone by the time it lands. */}
                    <div
                      data-bm-frame
                      className="absolute -inset-x-[7px] -top-[7px] -bottom-[24px] rounded-[6px] bg-[#f6f3ec] shadow-[0_26px_50px_-20px_var(--k-shadow),0_0_0_1px_rgba(0,0,0,0.06)]"
                    />
                    <div
                      data-bm-trail
                      className="absolute -inset-3 rounded-[22px] opacity-0 blur-xl"
                      style={{ background: 'radial-gradient(closest-side, rgba(var(--k-glow-rgb),0.85), rgba(var(--k-accent-rgb),0.35), transparent)' }}
                    />
                    <div
                      data-bm-photo
                      className="absolute inset-0 overflow-hidden border border-[color:var(--k-line)] bg-black/40"
                      style={{ borderRadius: 3 }}
                    >
                      {p.media_type === 'video' ? (
                        <video src={p.image_url} className="h-full w-full object-cover" preload="metadata" muted playsInline />
                      ) : (
                        <PostImage src={p.image_url} alt="" displayWidth={160} eager draggable={false} className="h-full w-full object-cover" />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* The band of light that seals the stack, in two halves. */}
              {(['l', 'r'] as const).map((side) => (
                <div
                  key={side}
                  data-bm-band={side}
                  aria-hidden
                  className="absolute overflow-hidden"
                  style={{
                    zIndex: 6,
                    top: geo.cy - 9,
                    height: 18,
                    width: bandW / 2,
                    left: side === 'l' ? geo.cx - bandW / 2 : geo.cx,
                    borderRadius: side === 'l' ? '9px 0 0 9px' : '0 9px 9px 0',
                    background: `linear-gradient(${side === 'l' ? '90deg' : '270deg'}, rgba(var(--k-accent-rgb),0) 0%, rgba(var(--k-accent-rgb),0.75) 22%, rgba(var(--k-glow-rgb),0.9) 70%, rgba(255,255,255,0.95) 100%)`,
                    boxShadow: '0 0 22px 2px rgba(var(--k-accent-rgb),0.55)',
                  }}
                >
                  <div
                    data-bm-band-shine
                    className="absolute inset-y-0 left-0 w-1/2"
                    style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)' }}
                  />
                </div>
              ))}

              {/* The seal. */}
              <div className="absolute" style={{ zIndex: 7, left: geo.cx - 30, top: geo.cy - 30, width: 60, height: 60 }}>
                <div
                  data-bm-seal-halo
                  aria-hidden
                  className="absolute -inset-5 rounded-full opacity-70"
                  style={{ background: 'radial-gradient(closest-side, rgba(var(--k-glow-rgb),0.75), rgba(var(--k-accent-rgb),0.25) 60%, transparent)' }}
                />
                <div data-bm-seal-whole aria-hidden className="absolute inset-0">
                  <SealFace />
                </div>
                {(['l', 'r'] as const).map((side) => (
                  <div
                    key={side}
                    data-bm-seal-half={side}
                    aria-hidden
                    className="absolute inset-0 opacity-0"
                    style={{ clipPath: side === 'l' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)' }}
                  >
                    <SealFace />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* The tap: the strike, the flash, the motes, the sweep. */}
          <div
            data-bm-strike
            aria-hidden
            className="absolute opacity-0"
            style={{
              zIndex: 8,
              left: geo.cx - 4,
              top: 0,
              width: 8,
              height: geo.cy,
              transformOrigin: '50% 0%',
              borderRadius: 4,
              background: 'linear-gradient(180deg, rgba(var(--k-accent-rgb),0) 0%, rgba(var(--k-accent-rgb),0.7) 45%, rgba(255,255,255,1) 100%)',
              boxShadow: '0 0 28px 8px rgba(var(--k-accent-rgb),0.55), 0 0 70px 18px rgba(var(--k-glow-rgb),0.25)',
            }}
          />
          <div
            data-bm-flash
            aria-hidden
            className="absolute rounded-full opacity-0"
            style={{
              zIndex: 9,
              left: geo.cx - 110,
              top: geo.cy - 110,
              width: 220,
              height: 220,
              background: 'radial-gradient(closest-side, rgba(255,255,255,1), rgba(var(--k-glow-rgb),0.8) 35%, rgba(var(--k-accent-rgb),0.3) 65%, transparent)',
              mixBlendMode: 'screen',
            }}
          />
          {motes.map((m, i) => (
            <span
              key={i}
              data-bm-mote
              aria-hidden
              className="absolute rounded-full opacity-0"
              style={{
                zIndex: 9,
                left: geo.cx - m.size / 2,
                top: geo.cy - m.size / 2,
                width: m.size,
                height: m.size,
                background: i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? 'var(--k-glow)' : 'var(--k-accent)',
                boxShadow: '0 0 10px 2px rgba(var(--k-glow-rgb),0.7)',
              }}
            />
          ))}
          <div
            data-bm-sweep
            aria-hidden
            className="absolute -top-1/4 left-0 h-[150%] w-[34vw] min-w-[170px] -rotate-[14deg] opacity-0"
            style={{
              zIndex: 10,
              background:
                'linear-gradient(90deg, transparent, rgba(var(--k-accent-rgb),0.30) 22%, rgba(var(--k-accent-rgb),0.7) 40%, rgba(255,255,255,0.9) 50%, rgba(var(--k-glow-rgb),0.7) 60%, rgba(var(--k-glow-rgb),0.25) 78%, transparent)',
              filter: 'blur(10px)',
              mixBlendMode: 'screen',
            }}
          />
        </div>
      )}

      {/* Open. */}
      <div
        data-bm-foot
        className="absolute inset-x-4 flex flex-col items-center gap-3 text-center"
        style={{ bottom: 'max(1.75rem, calc(env(safe-area-inset-bottom) + 1rem))', zIndex: 12 }}
      >
        <p className="font-sans text-[13px] text-[color:var(--k-muted)]">{line}</p>
        <button
          ref={openBtnRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          className={K_PRIMARY}
        >
          Open the album
        </button>
      </div>
    </div>
  );
}

function SealFace() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center rounded-full text-[color:var(--k-glow)]"
      style={{
        background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), transparent 55%), var(--k-surface)',
        boxShadow: 'inset 0 0 0 2px rgba(var(--k-accent-rgb),0.9), inset 0 0 14px rgba(var(--k-accent-rgb),0.6), 0 0 26px 4px rgba(var(--k-accent-rgb),0.5)',
      }}
    >
      <BeamMark className="h-7 w-7" />
    </div>
  );
}
