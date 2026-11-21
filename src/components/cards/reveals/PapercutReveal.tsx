/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 'papercut' reveal — a pop-up paper diorama. Contract: ./types.ts.
 * Tier STANDARD: SVG + CSS transforms + GSAP, no WebGL.
 *
 * The world (lib/cardPapercut.ts) is seeded from the card title: stars and a
 * paper moon, three hill layers with trees and flowers, clouds, two hot-air
 * balloons, bunting and a grass edge — each piece its own absolutely placed
 * element with a static drop shadow, so the layers read as real cut paper
 * and every per-frame write is a compositor-only `transform`.
 *
 * Idle: the layers drift in parallax with the pointer (desktop) or the
 * phone's tilt (DeviceOrientation; iOS asks permission only from inside a
 * tap — the first tap anywhere on the scene, or Open), and sway by
 * themselves when neither is available. Clouds and balloons are boopable:
 * tap one and it bounces.
 *
 * Open: the pieces spring up in depth back-to-front like a pop-up book
 * catching its folds, then part — clouds out to the sides, balloons up and
 * away, the bunting lifts off, the hills drop — while a column of warm light
 * rises from the fold, and the card (glass, the title in the display face)
 * rides up it into a burst of paper confetti → onDone (≈3.6 s).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { followStep, papercutConfetti, papercutPalette, papercutScene, tiltToParallax, type PaperPiece } from '../../../lib/cardPapercut';
import type { CardRevealProps } from './types';

interface Size {
  w: number;
  h: number;
}

/** Per-piece animation offsets in px (composed with parallax in the rAF loop). */
interface PieceAnim {
  x: number;
  y: number;
  r: number;
  s: number;
  sy: number;
  o: number;
}

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export default function PapercutReveal({ card, palette, reducedMotion, noun, onDone }: CardRevealProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pal = useMemo(() => papercutPalette({ bg: palette.bg, accent: palette.accent }), [palette.bg, palette.accent]);

  return (
    <div className="absolute inset-0 overflow-hidden" data-reveal="papercut">
      <div
        className="pointer-events-none absolute inset-0 hidden md:block"
        style={{ background: `radial-gradient(40% 60% at 50% 50%, rgba(${palette.accentRgb},0.18) 0%, transparent 70%)` }}
        aria-hidden
      />
      <div
        ref={stageRef}
        className="absolute inset-0 overflow-hidden md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(88vh,860px)] md:aspect-[9/18] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[34px] md:shadow-[0_40px_120px_rgba(5,4,26,0.55),0_0_0_1px_rgba(255,255,255,0.10)]"
        style={{
          background: `radial-gradient(80% 38% at 50% 64%, rgba(255,197,107,0.16) 0%, transparent 70%), linear-gradient(180deg, ${pal.skyTop} 0%, ${pal.skyLow} 78%)`,
        }}
      >
        {size && (
          <PapercutStage
            size={size}
            title={card.title}
            pal={pal}
            fg={palette.fg}
            accentRgb={palette.accentRgb}
            accent={palette.accent}
            bg={palette.bg}
            reducedMotion={reducedMotion}
            noun={noun}
            onDone={onDone}
          />
        )}
      </div>
    </div>
  );
}

interface StageProps {
  size: Size;
  title: string;
  pal: ReturnType<typeof papercutPalette>;
  fg: string;
  accent: string;
  bg: string;
  accentRgb: string;
  reducedMotion: boolean;
  noun?: 'card' | 'album';
  onDone: () => void;
}

function pieceShadow(p: PaperPiece): string {
  const d = p.depth;
  return `drop-shadow(0 ${(3 + d * 9).toFixed(1)}px ${(4 + d * 9).toFixed(1)}px rgba(5,4,26,${(0.24 + d * 0.16).toFixed(2)}))`;
}

function PapercutStage({ size, title, pal, fg, accent, bg, accentRgb, reducedMotion, noun, onDone }: StageProps) {
  const { w, h } = size;
  const scene = useMemo(() => papercutScene(title, h / w, { bg, accent }), [title, h, w, bg, accent]);
  const k = w / scene.width; // px per design unit
  const confetti = useMemo(
    () => papercutConfetti(title, reducedMotion ? 16 : 44, [...pal.festive, pal.paper], Math.min(w, h) * 0.62),
    [title, reducedMotion, pal, w, h],
  );

  const pieceEls = useRef<(HTMLDivElement | null)[]>([]);
  const anims = useRef<PieceAnim[]>([]);
  if (anims.current.length !== scene.pieces.length) {
    anims.current = scene.pieces.map(() => ({ x: 0, y: 0, r: 0, s: 1, sy: 1, o: 1 }));
  }
  const cardRef = useRef<HTMLDivElement | null>(null);
  const beamRef = useRef<HTMLDivElement | null>(null);
  const confettiRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);

  const done = useRef(false);
  const opening = useRef(false);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  /** Parallax target in [-1, 1]² and when it last came from a real input. */
  const target = useRef({ x: 0, y: 0, at: -1e9 });
  const tiltAsked = useRef(false);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    setCoarse(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
  }, []);

  /* ---------------- inputs: pointer + tilt ---------------- */

  const onOrientation = useCallback((e: DeviceOrientationEvent) => {
    if (e.beta === null && e.gamma === null) return;
    const t = tiltToParallax(e.beta, e.gamma);
    target.current = { x: t.x, y: t.y, at: performance.now() };
  }, []);

  useEffect(() => {
    if (reducedMotion) return; // no tilt / pointer parallax under Reduce Motion
    const stage = pieceEls.current[0]?.parentElement ?? null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; // phones steer with tilt; a finger drag would fight it
      const r = stage?.getBoundingClientRect();
      if (!r) return;
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = ((e.clientY - r.top) / r.height) * 2 - 1;
      target.current = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), at: performance.now() };
    };
    window.addEventListener('pointermove', onMove);
    // Where no permission is needed (Android, desktop with sensors), listen now.
    const Ctor = (typeof window.DeviceOrientationEvent === 'function' ? window.DeviceOrientationEvent : null) as OrientationCtor | null;
    const needsPermission = Ctor !== null && typeof Ctor.requestPermission === 'function';
    if (Ctor !== null && !needsPermission) window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [reducedMotion, onOrientation]);

  /** iOS: ask for motion access — only ever from inside a tap handler. */
  const askTilt = useCallback(() => {
    if (tiltAsked.current || reducedMotion) return;
    tiltAsked.current = true;
    const Ctor = (typeof window.DeviceOrientationEvent === 'function' ? window.DeviceOrientationEvent : null) as OrientationCtor | null;
    if (Ctor === null || typeof Ctor.requestPermission !== 'function') return;
    Ctor.requestPermission()
      .then((state) => {
        if (state === 'granted') window.addEventListener('deviceorientation', onOrientation);
      })
      .catch(() => {
        // Denied or unsupported: the scene keeps its automatic sway.
      });
  }, [reducedMotion, onOrientation]);

  /* ---------------- the frame loop ---------------- */

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    const cur = { x: 0, y: 0 };
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const t = (now - t0) / 1000;
      let tx = 0;
      let ty = 0;
      if (!reducedMotion) {
        const live = now - target.current.at < 2500;
        if (live) {
          tx = target.current.x;
          ty = target.current.y;
        } else {
          // nobody is steering: a slow, breathing sway
          tx = Math.sin(t * 0.45) * 0.55;
          ty = Math.cos(t * 0.33) * 0.3;
        }
      }
      cur.x = followStep(cur.x, tx, dt, 160);
      cur.y = followStep(cur.y, ty, dt, 160);
      const pieces = scene.pieces;
      for (let i = 0; i < pieces.length; i += 1) {
        const el = pieceEls.current[i];
        const a = anims.current[i];
        if (!el || !a) continue;
        const p = pieces[i];
        const px = -cur.x * p.depth * 22;
        const py = -cur.y * p.depth * 14;
        let bob = 0;
        if (p.kind === 'balloon') bob = Math.sin(t * 1.1 + i) * (reducedMotion ? 2 : 7);
        else if (p.kind === 'cloud') bob = Math.sin(t * 0.6 + i * 1.7) * (reducedMotion ? 0 : 3);
        el.style.transform = `translate3d(${(px + a.x).toFixed(2)}px, ${(py + a.y + bob).toFixed(2)}px, 0) rotate(${a.r.toFixed(2)}deg) scale(${a.s.toFixed(4)}, ${(a.s * a.sy).toFixed(4)})`;
        el.style.opacity = a.o.toFixed(3);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scene, reducedMotion]);

  // Release every tween on unmount (Replay mounts a fresh reveal).
  useEffect(
    () => () => {
      tlRef.current?.kill();
      tlRef.current = null;
      gsap.killTweensOf(anims.current);
    },
    [],
  );

  /* ---------------- boop ---------------- */

  const boop = (i: number) => {
    askTilt();
    if (opening.current) return;
    const a = anims.current[i];
    if (!a) return;
    gsap.killTweensOf(a);
    const big = !reducedMotion;
    gsap.fromTo(
      a,
      { s: 1, y: 0, r: 0 },
      {
        keyframes: [
          { s: big ? 1.14 : 1.05, y: big ? -18 : -6, r: big ? (i % 2 === 0 ? -6 : 6) : 0, duration: 0.14, ease: 'power2.out' },
          { s: 1, y: 0, r: 0, duration: big ? 0.9 : 0.4, ease: big ? 'elastic.out(1.1, 0.35)' : 'power2.out' },
        ],
      },
    );
  };

  /* ---------------- open ---------------- */

  const open = useCallback(() => {
    askTilt();
    if (opening.current) return;
    opening.current = true;
    const rm = reducedMotion;
    const tl = gsap.timeline({
      onComplete: () => {
        if (done.current) return;
        done.current = true;
        onDone();
      },
    });
    tlRef.current = tl;
    const pieces = scene.pieces;
    gsap.killTweensOf(anims.current);

    tl.to(controlsRef.current, { autoAlpha: 0, y: 10, duration: 0.3, ease: 'power2.out' }, 0);

    // 1 — pop up: back to front, each piece springs up in depth
    pieces.forEach((p, i) => {
      const a = anims.current[i];
      const stand = p.kind === 'hill' || p.kind === 'grass';
      tl.to(
        a,
        {
          keyframes: [
            {
              s: 1 + p.depth * (rm ? 0.02 : 0.07),
              sy: stand ? (rm ? 1.04 : 1.16) : 1,
              y: -p.depth * (rm ? 6 : 26),
              duration: 0.26,
              ease: 'power2.out',
            },
            {
              s: 1 + p.depth * (rm ? 0.015 : 0.05),
              sy: 1,
              y: -p.depth * (rm ? 4 : 10),
              duration: rm ? 0.35 : 0.6,
              ease: rm ? 'power2.out' : 'elastic.out(1.05, 0.42)',
            },
          ],
        },
        i * 0.045,
      );
    });

    // 2 — part: front pieces leave first, everything clears the stage
    const partAt = rm ? 0.75 : 0.95;
    [...pieces.keys()].reverse().forEach((i, order) => {
      const p = pieces[i];
      const a = anims.current[i];
      const fade = p.kind === 'stars';
      tl.to(
        a,
        {
          x: p.exit.x * k,
          y: p.exit.y * k,
          r: p.exit.rotate,
          s: fade ? 1.08 : a.s,
          o: fade ? 0.55 : 1, // the paper stars stay behind the card, dimmed
          duration: rm ? 0.9 : 1.15,
          ease: p.kind === 'balloon' ? 'power1.in' : 'power3.in',
        },
        partAt + order * 0.04,
      );
    });

    // 3 — a column of warm light rises from the fold, and the card rides up it
    tl.fromTo(beamRef.current, { autoAlpha: 0, scaleY: 0, scaleX: 0.5 }, { autoAlpha: 1, scaleY: 1, scaleX: 1, duration: 0.8, ease: 'power2.out' }, partAt + 0.15);
    tl.to(beamRef.current, { autoAlpha: 0, scaleX: rm ? 1.3 : 2.4, duration: 1.0, ease: 'power2.in' }, partAt + 1.0);
    tl.fromTo(
      glowRef.current,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.9, ease: 'power2.out' },
      partAt + 0.3,
    );
    tl.fromTo(
      cardRef.current,
      { autoAlpha: 0, y: h * (rm ? 0.12 : 0.42), scale: rm ? 0.94 : 0.78, rotateX: rm ? 0 : 24 },
      { autoAlpha: 1, y: 0, scale: 1, rotateX: 0, duration: rm ? 0.9 : 1.15, ease: rm ? 'power2.out' : 'back.out(1.35)' },
      partAt + 0.35,
    );

    // 4 — paper confetti bursts from behind the card and flutters down
    const bits = confettiRef.current ? Array.from(confettiRef.current.children) : [];
    const burstAt = partAt + (rm ? 0.9 : 1.05);
    bits.forEach((el, i) => {
      const c = confetti[i];
      if (!c) return;
      tl.fromTo(
        el,
        { x: 0, y: 0, rotation: 0, autoAlpha: 0, scale: 0.4 },
        {
          keyframes: [
            { x: c.dx, y: c.dy, rotation: c.spin * 0.4, autoAlpha: 1, scale: 1, duration: 0.55, ease: 'power3.out' },
            { x: c.dx * 1.15, y: c.dy + c.fall, rotation: c.spin, autoAlpha: 0, duration: rm ? 0.9 : 1.4, ease: 'sine.in' },
          ],
        },
        burstAt + c.delay,
      );
    });

    tl.to({}, { duration: 0.2 }, partAt + 2.45); // let the card sit before handing over
  }, [askTilt, reducedMotion, scene, k, h, confetti, onDone]);

  /* ---------------- render ---------------- */

  const titleSize = Math.max(28, Math.min(40, w * 0.092));
  const cardW = Math.min(w * 0.84, 360);

  return (
    <>
      {/* paper diorama */}
      <div className="absolute inset-0" onPointerDown={askTilt} style={{ perspective: 900 }}>
        {scene.pieces.map((p, i) => (
          <div
            key={p.id}
            ref={(el) => {
              pieceEls.current[i] = el;
            }}
            className="absolute will-change-transform"
            style={{
              left: `${(p.x / scene.width) * 100}%`,
              top: `${(p.y / scene.height) * 100}%`,
              width: `${(p.w / scene.width) * 100}%`,
              height: `${(p.h / scene.height) * 100}%`,
              filter: pieceShadow(p),
              transformOrigin: p.kind === 'hill' || p.kind === 'grass' ? '50% 100%' : '50% 50%',
              pointerEvents: p.boopable ? 'auto' : 'none',
              cursor: p.boopable ? 'pointer' : undefined,
              touchAction: 'manipulation',
            }}
            onPointerDown={p.boopable ? () => boop(i) : undefined}
            data-boop={p.boopable ? p.id : undefined}
            aria-hidden
          >
            <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${p.w} ${p.h}`} preserveAspectRatio="none" focusable="false">
              {p.shapes.map((sh, j) =>
                sh.stroke ? (
                  <path
                    key={j}
                    d={sh.d}
                    fill="none"
                    stroke={sh.stroke}
                    strokeWidth={sh.strokeWidth ?? 2}
                    strokeOpacity={sh.opacity ?? 1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <path key={j} d={sh.d} fill={sh.fill} fillOpacity={sh.opacity ?? 1} />
                ),
              )}
            </svg>
          </div>
        ))}
        {/* paper grain over everything: static, multiplied in once */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.10] mix-blend-multiply" aria-hidden focusable="false">
          <filter id="pc-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#pc-grain)" />
        </svg>
      </div>

      {/* the light the card rides up on */}
      <div
        ref={glowRef}
        className="pointer-events-none absolute inset-0 opacity-0"
        style={{ background: `radial-gradient(70% 45% at 50% 55%, rgba(${accentRgb},0.32) 0%, transparent 70%)` }}
        aria-hidden
      />
      <div
        ref={beamRef}
        className="pointer-events-none absolute bottom-0 left-1/2 h-full w-[46%] -translate-x-1/2 opacity-0"
        style={{
          transformOrigin: '50% 100%',
          background:
            'radial-gradient(50% 100% at 50% 100%, rgba(255,255,255,0.95) 0%, rgba(255,197,107,0.7) 16%, rgba(255,197,107,0.22) 40%, transparent 72%)',
          mixBlendMode: 'screen',
        }}
        aria-hidden
      />

      {/* confetti origin = card centre */}
      <div ref={confettiRef} className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
        {confetti.map((c, i) => (
          <span
            key={i}
            className="absolute opacity-0"
            style={{
              left: -c.size / 2,
              top: -c.size / 2,
              width: c.size,
              height: c.shape === 'rect' ? c.size * 0.55 : c.size,
              background: c.color,
              borderRadius: c.shape === 'circle' ? '50%' : 2,
              clipPath:
                c.shape === 'triangle'
                  ? 'polygon(50% 0, 100% 100%, 0 100%)'
                  : c.shape === 'star'
                    ? 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)'
                    : undefined,
              boxShadow: c.shape === 'rect' || c.shape === 'circle' ? '0 2px 3px rgba(5,4,26,0.25)' : undefined,
            }}
          />
        ))}
      </div>

      {/* the card */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6" style={{ perspective: 900 }}>
        <div
          ref={cardRef}
          className="relative flex flex-col items-center rounded-[28px] border px-7 py-9 text-center opacity-0 backdrop-blur-xl"
          style={{
            width: cardW,
            color: fg,
            borderColor: 'rgba(255,255,255,0.32)',
            backgroundColor: 'rgba(255,255,255,0.14)',
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 24px 70px rgba(5,4,26,0.45), 0 0 80px rgba(${accentRgb},0.25)`,
            transformOrigin: '50% 100%',
          }}
        >
          <svg width="44" height="30" viewBox="0 0 44 30" className="mb-4" aria-hidden focusable="false">
            <path d="M22 1l3.4 7.6 8.3.9-6.2 5.6 1.8 8.1L22 19l-7.3 4.2 1.8-8.1-6.2-5.6 8.3-.9z" fill={pal.gold} />
            <circle cx="5" cy="20" r="2.6" fill={pal.paper} />
            <circle cx="39" cy="20" r="2.6" fill={pal.paper} />
          </svg>
          <h1 className="font-serif font-semibold leading-[1.08] text-balance" style={{ fontSize: titleSize }}>
            {title}
          </h1>
          <span className="mt-5 block h-px w-14 bg-white/40" aria-hidden />
        </div>
      </div>

      <div ref={controlsRef} className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
        {!reducedMotion && (
          <p
            className="rounded-full px-3 py-1 text-[13px] font-medium shadow-[0_2px_8px_rgba(5,4,26,0.18)]"
            style={{ color: '#1B1A45', backgroundColor: 'rgba(255,255,255,0.72)' }}
          >
            {coarse ? 'Tilt your phone to look around' : 'Move around to look closer'}
          </p>
        )}
        <button
          type="button"
          onClick={open}
          autoFocus
          aria-label={`Open the ${noun ?? 'card'}`}
          className="min-h-[44px] min-w-[132px] rounded-full px-7 text-sm font-semibold shadow-[0_8px_0_rgba(5,4,26,0.18),0_14px_30px_rgba(5,4,26,0.3)] transition active:translate-y-[2px] active:shadow-[0_5px_0_rgba(5,4,26,0.18),0_10px_24px_rgba(5,4,26,0.3)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4"
          style={{ backgroundColor: pal.paper, color: '#1B1A45', outlineColor: 'rgba(27,26,69,0.6)' }}
        >
          Open
        </button>
      </div>
    </>
  );
}
