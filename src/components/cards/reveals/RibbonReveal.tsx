/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 'ribbon' reveal — a letterpress card face tied with a wide satin ribbon.
 * Contract: ./types.ts. Tier STANDARD: SVG + CSS transforms + GSAP, no WebGL.
 *
 * The face is procedural SVG (lib/cardRibbon.ts): an arched, scalloped frame,
 * rosettes and curling vines, run through ONE static emboss filter
 * (feSpecularLighting highlight + offset shadow), so the expensive raster
 * happens once. Everything that moves while idle lives OUTSIDE filtered
 * groups: a light shimmer masked by the same linework (one pass every few
 * seconds, nothing repaints between passes), a satin sheen clipped to the
 * band, and a pearlescent wash that only ever changes `transform`.
 *
 * Interaction: drag either tail (the tip follows the finger with a rubber
 * band and the loops start to give), pull far enough and the bow unties by
 * itself. A tap on the bow, the "Untie" button, or Enter/Space on it does the
 * same. After the gesture: the loops shrink into the knot and the tails slide
 * through it, the band slips off the side it was pulled toward, warm light
 * runs out along the embossed lines from the knot, and the face lifts a
 * touch and settles on the title → onDone (≈3.7 s).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import gsap from 'gsap';
import {
  bandCreases,
  bandPath,
  bowLoopFolds,
  bowLoopInnerPath,
  bowLoopPath,
  clamp,
  glintMotes,
  ribbonColors,
  ribbonFaceArt,
  ribbonPull,
  slideDirection,
  tailPath,
  tailRestTip,
  type Pt,
} from '../../../lib/cardRibbon';
import { cardMonogram } from '../../../lib/cardPresentation';
import type { CardRevealProps } from './types';

interface Size {
  w: number;
  h: number;
}

/** Layout derived from the stage size — one place, so draw() and JSX agree. */
function layoutFor({ w, h }: Size) {
  const bh = clamp(h * 0.1, 64, 96); // band height
  const s = clamp(w * 0.2, 66, 108); // bow size
  return { bh, s, knotX: w / 2, cy: Math.round(h * 0.5) };
}

const IDLE_SHIMMER_MS = 6200; // one shimmer pass, then rest (no repaint while resting)
const SHIMMER_PASS_MS = 2300;

export default function RibbonReveal({ card, palette, reducedMotion, onDone }: CardRevealProps) {
  const colors = useMemo(() => ribbonColors(palette), [palette]);
  const monogram = cardMonogram(card.recipientName, card.title);

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

  return (
    <div className="absolute inset-0 overflow-hidden" data-reveal="ribbon">
      {/* desktop halo behind the tall stage; invisible on phones (the stage IS the screen) */}
      <div
        className="pointer-events-none absolute inset-0 hidden md:block"
        style={{ background: `radial-gradient(40% 60% at 50% 50%, rgba(${palette.accentRgb},0.18) 0%, transparent 70%)` }}
        aria-hidden
      />
      <div
        ref={stageRef}
        className="absolute inset-0 overflow-hidden md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(88vh,860px)] md:aspect-[9/18] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[34px] md:shadow-[0_40px_120px_rgba(5,4,26,0.55),0_0_0_1px_rgba(255,255,255,0.10)]"
        style={{ backgroundColor: colors.face }}
      >
        {size && (
          <RibbonStage
            size={size}
            title={card.title}
            monogram={monogram}
            colors={colors}
            accentRgb={palette.accentRgb}
            reducedMotion={reducedMotion}
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
  monogram: string;
  colors: ReturnType<typeof ribbonColors>;
  accentRgb: string;
  reducedMotion: boolean;
  onDone: () => void;
}

function RibbonStage({ size, title, monogram, colors, accentRgb, reducedMotion, onDone }: StageProps) {
  const { w, h } = size;
  const { bh, s, knotX, cy } = layoutFor(size);
  const art = useMemo(() => ribbonFaceArt(w, h), [w, h]);
  const creases = useMemo(() => bandCreases(knotX, cy, bh), [knotX, cy, bh]);
  const motes = useMemo(
    () => glintMotes(knotX, cy, Math.min(w, h) * 0.42, reducedMotion ? 6 : 16),
    [knotX, cy, w, h, reducedMotion],
  );
  const diag = Math.hypot(w, h);

  // DOM handles the animation writes to directly (no React re-render per frame).
  const cardRef = useRef<HTMLDivElement | null>(null);
  const shimmerRef = useRef<SVGRectElement | null>(null);
  const sheenRef = useRef<SVGRectElement | null>(null);
  const pearlRef = useRef<HTMLDivElement | null>(null);
  const bandGroupRef = useRef<SVGGElement | null>(null);
  const bandRef = useRef<SVGPathElement | null>(null);
  const bandClipRef = useRef<SVGPathElement | null>(null);
  const bandShadowRef = useRef<SVGPathElement | null>(null);
  const bowRef = useRef<SVGGElement | null>(null);
  const loopL = useRef<SVGPathElement | null>(null);
  const loopR = useRef<SVGPathElement | null>(null);
  const loopInL = useRef<SVGPathElement | null>(null);
  const loopInR = useRef<SVGPathElement | null>(null);
  const foldL = useRef<SVGPathElement | null>(null);
  const foldR = useRef<SVGPathElement | null>(null);
  const beamRef = useRef<HTMLDivElement | null>(null);
  const hintRef = useRef<HTMLParagraphElement | null>(null);
  /** Where the finger / cursor last was (stage px) and when — the satin's light follows it. */
  const lightRef = useRef<{ x: number; y: number; at: number }>({ x: 0, y: 0, at: -1e9 });
  const tailL = useRef<SVGPathElement | null>(null);
  const tailR = useRef<SVGPathElement | null>(null);
  const knotRef = useRef<SVGGElement | null>(null);
  const glintRef = useRef<SVGCircleElement | null>(null);
  const bloomRef = useRef<HTMLDivElement | null>(null);
  const motesRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const liftGlowRef = useRef<HTMLDivElement | null>(null);

  const done = useRef(false);
  const untying = useRef(false);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const dragRef = useRef<{ id: number; side: -1 | 1; x0: number; y0: number; moved: boolean } | null>(null);
  const lastDrag = useRef<{ side: -1 | 1; drag: Pt }>({ side: 1, drag: { x: 0, y: 0 } });

  /** The whole bow, from a loosen amount and the two tail tips. */
  const drawBow = useCallback(
    (loosen: number, tipLeft: Pt, tipRight: Pt, pinch: number) => {
      loopL.current?.setAttribute('d', bowLoopPath(-1, s, loosen));
      loopR.current?.setAttribute('d', bowLoopPath(1, s, loosen));
      loopInL.current?.setAttribute('d', bowLoopInnerPath(-1, s, loosen));
      loopInR.current?.setAttribute('d', bowLoopInnerPath(1, s, loosen));
      foldL.current?.setAttribute('d', bowLoopFolds(-1, s, loosen));
      foldR.current?.setAttribute('d', bowLoopFolds(1, s, loosen));
      tailL.current?.setAttribute('d', tailPath(-1, s, tipLeft));
      tailR.current?.setAttribute('d', tailPath(1, s, tipRight));
      const band = bandPath(w, cy, bh, knotX, pinch);
      bandRef.current?.setAttribute('d', band);
      bandClipRef.current?.setAttribute('d', band);
      bandShadowRef.current?.setAttribute('d', band);
    },
    [s, w, cy, bh, knotX],
  );

  // First paint of the bow (and on resize, unless it is already untying).
  useLayoutEffect(() => {
    if (untying.current) return;
    drawBow(0, tailRestTip(-1, s), tailRestTip(1, s), 0.55);
  }, [drawBow, s]);

  // Idle: shimmer passes along the linework, satin sheen along the band,
  // pearlescent wash drifting. One rAF loop, transform/attribute writes only.
  useEffect(() => {
    let raf = 0;
    let sheenX = -w * 0.25;
    let pearlX = 0;
    let pearlY = 0;
    const t0 = performance.now();
    const slow = reducedMotion ? 1.6 : 1;
    const tick = (now: number) => {
      const t = (now - t0) / slow;
      // shimmer: a diagonal band crossing the face, then a rest
      const cyc = (t % IDLE_SHIMMER_MS) / SHIMMER_PASS_MS;
      if (shimmerRef.current) {
        const p = Math.min(cyc, 1.05);
        const x = -w * 0.9 + p * (w * 1.8);
        const y = -h * 0.5 + p * h;
        shimmerRef.current.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      }
      // a finger or cursor nearby steers the light; otherwise it drifts by itself
      const light = lightRef.current;
      const follow = clamp(1 - (now - light.at - 1800) / 900, 0, 1); // 1 while recent, eases off after 1.8 s
      if (sheenRef.current && !untying.current) {
        const drift = (((t % 4200) / 4200) * 1.6 - 0.3) * w;
        const target = light.x - w * 0.5; // the 0.5w-wide sheen rect is centred on the finger
        const goal = follow * target + (1 - follow) * drift;
        sheenX = follow > 0 ? sheenX + (goal - sheenX) * 0.18 : goal;
        sheenRef.current.setAttribute('transform', `translate(${sheenX.toFixed(1)} 0)`);
      }
      if (pearlRef.current) {
        const a = (t / 9000) * Math.PI * 2;
        const px = Math.sin(a) * 14 * (1 - follow) + ((light.x / w) * 2 - 1) * -16 * follow;
        const py = Math.cos(a * 0.7) * 10 * (1 - follow) + ((light.y / h) * 2 - 1) * -10 * follow;
        pearlX += (px - pearlX) * 0.08;
        pearlY += (py - pearlY) * 0.08;
        pearlRef.current.style.transform = `translate3d(${pearlX.toFixed(2)}%, ${pearlY.toFixed(2)}%, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [w, h, reducedMotion]);

  // The satin's light follows a finger or cursor anywhere on the stage.
  useEffect(() => {
    const stage = cardRef.current?.parentElement;
    if (!stage) return;
    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      lightRef.current = { x: e.clientX - r.left, y: e.clientY - r.top, at: performance.now() };
    };
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerdown', onMove);
    return () => {
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerdown', onMove);
    };
  }, []);

  // Kill any running timeline on unmount (Replay mounts a fresh reveal).
  useEffect(
    () => () => {
      tlRef.current?.kill();
      tlRef.current = null;
    },
    [],
  );

  const untie = useCallback(() => {
    if (untying.current) return;
    untying.current = true;
    dragRef.current = null;
    const { side, drag } = lastDrag.current;
    const start = ribbonPull(side, s, drag);
    const dir = slideDirection(drag, side);
    const st = {
      loosen: start.loosen,
      pull: 0, // 0 → tails slid through the knot
      pinch: 0.55,
    };
    const restL = tailRestTip(-1, s);
    const restR = tailRestTip(1, s);
    const tipL0 = side === -1 ? start.tip : restL;
    const tipR0 = side === 1 ? start.tip : restR;
    const tipAt = (tip0: Pt, k: number): Pt => ({ x: tip0.x * (1 - k * 0.82), y: tip0.y * (1 - k * 0.82) });
    const redraw = () => drawBow(st.loosen, tipAt(tipL0, st.pull), tipAt(tipR0, st.pull), st.pinch);

    const rm = reducedMotion;
    const tl = gsap.timeline({
      onComplete: () => {
        if (done.current) return;
        done.current = true;
        onDone();
      },
    });
    tlRef.current = tl;

    tl.to([controlsRef.current, hintRef.current], { autoAlpha: 0, y: 8, duration: 0.35, ease: 'power2.out' }, 0);
    // 1 — the bow gives: loops shrink into the knot, tails slide through it
    tl.to(st, { loosen: 1, duration: rm ? 0.8 : 1.0, ease: 'power1.inOut', onUpdate: redraw }, 0);
    tl.to(st, { pull: 1, duration: rm ? 0.8 : 0.95, ease: 'power2.in', onUpdate: redraw }, 0.1);
    tl.to(knotRef.current, { scale: 0.55, autoAlpha: 0, transformOrigin: '50% 50%', duration: 0.35, ease: 'power2.in' }, 0.7);
    tl.to([tailL.current, tailR.current], { autoAlpha: 0, duration: 0.3, ease: 'power1.in' }, 0.78);
    tl.to(st, { pinch: 0, duration: 0.5, ease: 'power2.out', onUpdate: redraw }, 0.7);
    // 2 — the band slips off sideways
    tl.to(
      bandGroupRef.current,
      rm
        ? { x: dir * w * 0.35, autoAlpha: 0, duration: 0.8, ease: 'power2.in' }
        : { x: dir * w * 1.25, y: 14, rotation: dir * 3.5, transformOrigin: '50% 50%', duration: 1.05, ease: 'power2.in' },
      0.95,
    );
    // the Beamwall touch: a line of light is left where the ribbon lay —
    // it draws out from the knot behind the sliding band, then opens up
    tl.fromTo(
      beamRef.current,
      { autoAlpha: 0, scaleX: 0.04, scaleY: 0.35 },
      { autoAlpha: 1, scaleX: 1, scaleY: 1, duration: rm ? 0.8 : 0.9, ease: 'power2.out' },
      1.05,
    );
    tl.to(beamRef.current, { scaleY: rm ? 2 : 5, autoAlpha: 0, duration: 1.1, ease: 'power2.in' }, 1.85);
    // 3 — warm light runs out along the embossed lines from the knot
    const glint = { r: 0, o: 1 };
    tl.to(
      glint,
      {
        r: diag * 0.75,
        duration: rm ? 1.3 : 1.6,
        ease: 'power1.out',
        onUpdate: () => glintRef.current?.setAttribute('r', glint.r.toFixed(1)),
      },
      1.3,
    );
    tl.fromTo(bloomRef.current, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: rm ? 0.55 : 0.9, scale: 1, duration: 0.55, ease: 'power2.out' }, 1.25);
    tl.to(bloomRef.current, { autoAlpha: 0.25, scale: 1.35, duration: 1.2, ease: 'power2.inOut' }, 1.8);
    const moteEls = motesRef.current ? Array.from(motesRef.current.children) : [];
    moteEls.forEach((el, i) => {
      const m = motes[i];
      if (!m) return;
      tl.fromTo(
        el,
        { autoAlpha: 0, y: 0, scale: 0.4 },
        {
          keyframes: [
            { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'power2.out' },
            { autoAlpha: 0, y: -m.drift * (rm ? 0.4 : 1), duration: 1.3, ease: 'sine.inOut' },
          ],
        },
        1.4 + m.delay * 0.6,
      );
    });
    // 4 — the title surfaces, and the face lifts toward the viewer and settles
    tl.fromTo(
      titleRef.current,
      { autoAlpha: 0, y: rm ? 6 : 14, letterSpacing: rm ? '0em' : '0.04em' },
      { autoAlpha: 1, y: 0, letterSpacing: '0em', duration: rm ? 0.8 : 1.0, ease: 'power3.out' },
      1.75,
    );
    if (rm) {
      tl.to(cardRef.current, { scale: 1.012, duration: 0.9, ease: 'sine.inOut' }, 2.2);
    } else {
      tl.to(cardRef.current, { scale: 1.04, y: -6, duration: 0.75, ease: 'power2.out' }, 2.2);
      tl.to(cardRef.current, { scale: 1.018, y: -2, duration: 0.7, ease: 'power2.inOut' }, 2.95);
    }
    tl.fromTo(liftGlowRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7, ease: 'power2.out' }, 2.2);
    tl.to({}, { duration: 0.3 }, 3.65); // a breath on the finished face before handing over
  }, [s, w, diag, drawBow, reducedMotion, onDone, motes]);

  /* ---------------- drag the tail ---------------- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (untying.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const side: -1 | 1 = e.clientX - rect.left < rect.width / 2 ? -1 : 1;
    dragRef.current = { id: e.pointerId, side, x0: e.clientX, y0: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId || untying.current) return;
    const drag = { x: e.clientX - d.x0, y: e.clientY - d.y0 };
    if (Math.hypot(drag.x, drag.y) > 6) d.moved = true;
    const p = ribbonPull(d.side, s, drag);
    lastDrag.current = { side: d.side, drag };
    const rest = tailRestTip(d.side === 1 ? -1 : 1, s);
    drawBow(p.loosen, d.side === -1 ? p.tip : rest, d.side === 1 ? p.tip : rest, 0.55 - p.progress * 0.15);
    if (p.progress >= 1) untie();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (untying.current) return;
    if (!d.moved) {
      untie(); // a tap on the bow is a fine way to untie it too
      return;
    }
    // not far enough: the satin springs back
    const back = { k: 1 };
    const { drag, side } = lastDrag.current;
    gsap.to(back, {
      k: 0,
      duration: reducedMotion ? 0.3 : 0.55,
      ease: reducedMotion ? 'power2.out' : 'elastic.out(1, 0.55)',
      onUpdate: () => {
        if (untying.current) return;
        const p = ribbonPull(side, s, { x: drag.x * back.k, y: drag.y * back.k });
        const rest = tailRestTip(side === 1 ? -1 : 1, s);
        drawBow(p.loosen, side === -1 ? p.tip : rest, side === 1 ? p.tip : rest, 0.55 - p.progress * 0.15);
      },
    });
    lastDrag.current = { side, drag: { x: 0, y: 0 } };
  };

  /* ---------------- render ---------------- */

  const titleSize = clamp(w * 0.105, 30, 46);
  const hitW = s * 2.9;
  const hitTop = cy - s * 1.05;
  const hitH = s * 2.9;

  return (
    <>
      <div ref={cardRef} className="absolute inset-0 will-change-transform" style={{ transformOrigin: '50% 50%' }}>
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} aria-hidden focusable="false">
          <defs>
            <linearGradient id="rb-face" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={colors.faceLight} />
              <stop offset="0.45" stopColor={colors.face} />
              <stop offset="1" stopColor={colors.faceDeep} />
            </linearGradient>
            <radialGradient id="rb-vignette" cx="50%" cy="48%" r="75%">
              <stop offset="0.6" stopColor="#05041A" stopOpacity="0" />
              <stop offset="1" stopColor="#05041A" stopOpacity="0.38" />
            </radialGradient>
            <pattern id="rb-damask" width="26" height="26" patternUnits="userSpaceOnUse">
              <path
                d="M13 6.5Q15.5 10.5 19.5 13Q15.5 15.5 13 19.5Q10.5 15.5 6.5 13Q10.5 10.5 13 6.5Z"
                fill="none"
                stroke="#fff"
                strokeWidth="0.7"
              />
              <circle cx="0" cy="0" r="0.9" fill="#fff" />
              <circle cx="26" cy="0" r="0.9" fill="#fff" />
              <circle cx="0" cy="26" r="0.9" fill="#fff" />
              <circle cx="26" cy="26" r="0.9" fill="#fff" />
            </pattern>
            <clipPath id="rb-arch">
              <path d={art.frameInner} />
            </clipPath>
            {/* the linework, defined once: drawn embossed AND used as the light mask */}
            <g id="rb-art">
              <rect x="0" y="0" width={w} height={h} fill="url(#rb-damask)" clipPath="url(#rb-arch)" opacity="0.32" />
              <path d={art.frameOuter} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
              <path d={art.frameInner} fill="none" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" />
              <path d={art.scallops} fill="none" stroke="#fff" strokeWidth="1.2" />
              {art.pearls.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="1.5" fill="#fff" />
              ))}
              {art.dots.map((p, i) => (
                <circle key={`d${i}`} cx={p.x} cy={p.y} r="0.9" fill="#fff" />
              ))}
              {art.filigree.strokes.map((d, i) => (
                <path key={`s${i}`} d={d} fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
              ))}
              {art.filigree.fills.map((d, i) => (
                <path key={`f${i}`} d={d} fill="#fff" />
              ))}
            </g>
            <filter id="rb-letterpress" x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceAlpha" stdDeviation="0.9" result="bump" />
              <feSpecularLighting
                in="bump"
                surfaceScale="3.2"
                specularConstant="1.25"
                specularExponent="20"
                lightingColor={colors.emboss}
                result="spec"
              >
                <feDistantLight azimuth="225" elevation="48" />
              </feSpecularLighting>
              <feComposite in="spec" in2="bump" operator="in" result="specLine" />
              <feOffset in="bump" dx="0.9" dy="1.3" result="shOff" />
              <feFlood floodColor={colors.embossShadow} floodOpacity="0.7" />
              <feComposite in2="shOff" operator="in" result="shadow" />
              <feFlood floodColor={colors.faceLight} floodOpacity="0.72" />
              <feComposite in2="SourceAlpha" operator="in" result="body" />
              <feMerge>
                <feMergeNode in="shadow" />
                <feMergeNode in="body" />
                <feMergeNode in="specLine" />
              </feMerge>
            </filter>
            <mask id="rb-linemask" maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
              <use href="#rb-art" />
            </mask>
            <linearGradient id="rb-shine" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0.38" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
              <stop offset="0.62" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="rb-glint">
              <stop offset="0" stopColor={colors.warm} stopOpacity="0.25" />
              <stop offset="0.72" stopColor={colors.warm} stopOpacity="0.35" />
              <stop offset="0.9" stopColor={colors.warm} stopOpacity="1" />
              <stop offset="0.97" stopColor={colors.accent} stopOpacity="0.7" />
              <stop offset="1" stopColor={colors.accent} stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect x="0" y="0" width={w} height={h} fill="url(#rb-face)" />
          <use href="#rb-art" filter="url(#rb-letterpress)" />
          {/* idle shimmer: light travelling along the embossed lines */}
          <g mask="url(#rb-linemask)">
            <rect ref={shimmerRef} x={-w * 0.5} y={-h * 0.5} width={w * 2} height={h * 2} fill="url(#rb-shine)" opacity="0.55" />
            <circle ref={glintRef} cx={knotX} cy={cy} r="0" fill="url(#rb-glint)" />
          </g>
          <rect x="0" y="0" width={w} height={h} fill="url(#rb-vignette)" />
        </svg>

        {/* pearlescent wash — transform-only animation, composited */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden mix-blend-soft-light" aria-hidden>
          <div
            ref={pearlRef}
            className="absolute -inset-1/2 will-change-transform"
            style={{
              background: `linear-gradient(118deg, transparent 28%, rgba(${accentRgb},0.5) 40%, rgba(255,255,255,0.55) 47%, rgba(255,197,107,0.32) 53%, rgba(${accentRgb},0.4) 59%, transparent 70%)`,
            }}
          />
        </div>

        <div ref={liftGlowRef} className="pointer-events-none absolute inset-0 opacity-0" aria-hidden
          style={{ background: `radial-gradient(60% 34% at 50% ${((cy / h) * 100).toFixed(1)}%, rgba(255,255,255,0.10) 0%, transparent 70%)` }}
        />

        {/* the card's words, under the ribbon until it slips away */}
        <div
          ref={titleRef}
          className="pointer-events-none absolute inset-x-0 flex flex-col items-center px-10 text-center opacity-0"
          style={{ top: cy, transform: 'translateY(-50%)', color: colors.ink }}
        >
          <span
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-full font-serif text-[18px] leading-none"
            style={{
              boxShadow: `inset 0 0 0 1px ${colors.emboss}, inset 1px 1px 2px ${colors.embossShadow}, 0 1px 0 rgba(255,255,255,0.18)`,
              color: colors.emboss,
              textShadow: `1px 1px 1px ${colors.embossShadow}`,
            }}
            aria-hidden
          >
            {monogram}
          </span>
          <h1
            className="font-serif font-semibold leading-[1.08] text-balance"
            style={{ fontSize: titleSize, textShadow: `0 1px 0 ${colors.embossShadow}, 0 0 28px rgba(${accentRgb},0.35)` }}
          >
            {title}
          </h1>
          <span className="mt-5 block h-px w-16" style={{ backgroundColor: colors.emboss, opacity: 0.6 }} aria-hidden />
        </div>
      </div>

      {/* the ribbon: band, bow, tails */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} aria-hidden focusable="false">
        <defs>
          <linearGradient id="rb-satin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={colors.satinDeep} />
            <stop offset="0.1" stopColor={colors.satin} />
            <stop offset="0.27" stopColor={colors.satinLight} />
            <stop offset="0.42" stopColor={colors.satin} />
            <stop offset="0.56" stopColor={colors.satinDeep} stopOpacity="0.9" />
            <stop offset="0.68" stopColor={colors.satin} />
            <stop offset="0.82" stopColor={colors.satinLight} />
            <stop offset="0.93" stopColor={colors.satin} />
            <stop offset="1" stopColor={colors.satinDeep} />
          </linearGradient>
          {([-1, 1] as const).map((side) => (
            <linearGradient key={side} id={`rb-loop${side}`} x1={side === 1 ? 0 : 1} y1="0.2" x2={side === 1 ? 1 : 0} y2="0.8">
              <stop offset="0" stopColor={colors.satinDeep} />
              <stop offset="0.16" stopColor={colors.satin} />
              <stop offset="0.42" stopColor={colors.satinLight} />
              <stop offset="0.6" stopColor={colors.satin} />
              <stop offset="0.8" stopColor={colors.satinLight} />
              <stop offset="1" stopColor={colors.satinDeep} />
            </linearGradient>
          ))}
          <linearGradient id="rb-loopback" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={colors.satinDeep} stopOpacity="0.95" />
            <stop offset="1" stopColor={colors.satinDeep} stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="rb-knotfold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={colors.satinDeep} />
            <stop offset="0.3" stopColor={colors.satin} />
            <stop offset="0.55" stopColor={colors.satinLight} />
            <stop offset="0.8" stopColor={colors.satin} />
            <stop offset="1" stopColor={colors.satinDeep} />
          </linearGradient>
          <linearGradient id="rb-tail" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={colors.satinDeep} />
            <stop offset="0.25" stopColor={colors.satin} />
            <stop offset="0.45" stopColor={colors.satinLight} />
            <stop offset="0.62" stopColor={colors.satinDeep} />
            <stop offset="0.8" stopColor={colors.satinLight} />
            <stop offset="1" stopColor={colors.satin} />
          </linearGradient>
          <linearGradient id="rb-sheen" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id="rb-bandclip">
            <path ref={bandClipRef} />
          </clipPath>
          <filter id="rb-soft" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id="rb-bowshadow" x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#05041A" floodOpacity="0.45" />
          </filter>
        </defs>

        <g ref={bandGroupRef}>
          <path ref={bandShadowRef} fill="#05041A" opacity="0.4" transform="translate(0 7)" filter="url(#rb-soft)" />
          <path ref={bandRef} fill="url(#rb-satin)" />
          <g clipPath="url(#rb-bandclip)">
            <rect ref={sheenRef} x={-w * 0.25} y={cy - bh} width={w * 0.5} height={bh * 2} fill="url(#rb-sheen)" opacity="0.8" />
            {creases.map((d, i) => (
              <path key={i} d={d} fill="none" stroke={colors.satinDeep} strokeOpacity="0.45" strokeWidth="2.2" strokeLinecap="round" />
            ))}
          </g>
          <g ref={bowRef} transform={`translate(${knotX} ${cy})`} filter="url(#rb-bowshadow)">
            <path ref={tailL} fill="url(#rb-tail)" stroke={colors.satinDeep} strokeOpacity="0.35" strokeWidth="0.8" />
            <path ref={tailR} fill="url(#rb-tail)" stroke={colors.satinDeep} strokeOpacity="0.35" strokeWidth="0.8" />
            <path ref={loopL} fill="url(#rb-loop-1)" stroke={colors.satinDeep} strokeOpacity="0.3" strokeWidth="0.8" />
            <path ref={loopInL} fill="url(#rb-loopback)" opacity="0.55" />
            <path ref={foldL} fill="none" stroke={colors.satinDeep} strokeOpacity="0.28" strokeWidth="1.6" strokeLinecap="round" />
            <path ref={loopR} fill="url(#rb-loop1)" stroke={colors.satinDeep} strokeOpacity="0.3" strokeWidth="0.8" />
            <path ref={loopInR} fill="url(#rb-loopback)" opacity="0.55" />
            <path ref={foldR} fill="none" stroke={colors.satinDeep} strokeOpacity="0.28" strokeWidth="1.6" strokeLinecap="round" />
            <g ref={knotRef}>
              {/* the knot: a gathered wrap of satin, wider at the edges than the waist */}
              <path
                d={`M${-s * 0.24} ${-s * 0.3}Q0 ${-s * 0.2} ${s * 0.24} ${-s * 0.3}Q${s * 0.17} 0 ${s * 0.24} ${s * 0.3}Q0 ${s * 0.21} ${-s * 0.24} ${s * 0.3}Q${-s * 0.17} 0 ${-s * 0.24} ${-s * 0.3}Z`}
                fill="url(#rb-knotfold)"
                stroke={colors.satinDeep}
                strokeOpacity="0.4"
                strokeWidth="0.8"
              />
              <path
                d={`M${-s * 0.14} ${-s * 0.22}Q${-s * 0.08} 0 ${-s * 0.14} ${s * 0.22}M${s * 0.14} ${-s * 0.22}Q${s * 0.08} 0 ${s * 0.14} ${s * 0.22}`}
                fill="none"
                stroke={colors.satinDeep}
                strokeOpacity="0.3"
                strokeWidth="1.2"
              />
              <text
                x="0"
                y={s * 0.075}
                textAnchor="middle"
                fontFamily="'Bricolage Grotesque Variable', system-ui, sans-serif"
                fontWeight="600"
                fontSize={Math.max(12, s * (monogram.length > 1 ? 0.17 : 0.22))}
                fill={colors.satinDeep}
                style={{ letterSpacing: '0.02em' }}
              >
                {monogram}
              </text>
            </g>
          </g>
        </g>
      </svg>

      {/* warm bloom + motes for the untie */}
      <div
        ref={bloomRef}
        className="pointer-events-none absolute opacity-0"
        style={{
          left: knotX - diag * 0.4,
          top: cy - diag * 0.4,
          width: diag * 0.8,
          height: diag * 0.8,
          background: `radial-gradient(closest-side, rgba(255,197,107,0.55) 0%, rgba(255,197,107,0.18) 35%, rgba(${accentRgb},0.10) 60%, transparent 100%)`,
          mixBlendMode: 'screen',
        }}
        aria-hidden
      />
      <div
        ref={beamRef}
        className="pointer-events-none absolute inset-x-0 opacity-0"
        style={{
          top: cy - bh * 0.5,
          height: bh,
          background: `radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(255,197,107,0.85) 14%, rgba(255,197,107,0.35) 34%, rgba(${accentRgb},0.18) 60%, transparent 100%)`,
          mixBlendMode: 'screen',
          transformOrigin: '50% 50%',
        }}
        aria-hidden
      />
      <div ref={motesRef} className="pointer-events-none absolute inset-0" aria-hidden>
        {motes.map((m, i) => (
          <span
            key={i}
            className="absolute rounded-full opacity-0"
            style={{
              left: m.x - m.r,
              top: m.y - m.r,
              width: m.r * 2,
              height: m.r * 2,
              background: i % 3 === 0 ? '#FFFFFF' : '#FFC56B',
              boxShadow: `0 0 ${m.r * 5}px rgba(255,197,107,0.85)`,
            }}
          />
        ))}
      </div>

      {/* drag target over the bow + tails (the visible button below is the accessible path) */}
      <div
        className="absolute cursor-grab touch-none active:cursor-grabbing"
        style={{ left: knotX - hitW / 2, top: hitTop, width: hitW, height: hitH } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-hidden
        data-ribbon-pull
      />

      <p
        ref={hintRef}
        className="pointer-events-none absolute flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium"
        style={{ left: knotX + s * 0.62, top: cy + s * 2.02, color: colors.ink, textShadow: `0 1px 8px ${colors.faceDeep}` }}
      >
        <span aria-hidden className="rb-nudge inline-block">↘</span>
        Pull the ribbon
      </p>
      <div
        ref={controlsRef}
        className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-10"
        style={{ background: `radial-gradient(60% 70% at 50% 75%, ${colors.faceDeep}cc 0%, transparent 100%)` }}
      >
        <button
          type="button"
          onClick={untie}
          autoFocus
          aria-label="Untie the ribbon and open the card"
          className="min-h-[44px] min-w-[132px] rounded-full border px-6 text-sm font-medium backdrop-blur-md transition hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4"
          style={{
            color: colors.ink,
            borderColor: 'rgba(255,255,255,0.28)',
            backgroundColor: 'rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 10px 30px rgba(5,4,26,0.35)',
            outlineColor: 'rgba(255,255,255,0.55)',
          }}
        >
          Untie
        </button>
      </div>
      <style>{`
        .rb-nudge { animation: rb-nudge 1.8s ease-in-out infinite; }
        @keyframes rb-nudge { 0%,100% { transform: translate(0,0); } 50% { transform: translate(3px,3px); } }
        @media (prefers-reduced-motion: reduce) { .rb-nudge { animation: none; } }
      `}</style>
    </>
  );
}
