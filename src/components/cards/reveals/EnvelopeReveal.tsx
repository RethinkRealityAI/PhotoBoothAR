/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 'envelope' reveal — a letterpress envelope sealed with wax; a beam of light
 * breaks the seal and the card condenses out of the glow. Contract: ./types.ts.
 *
 * NO WebGL: CSS 3D transforms + GSAP, so it runs on a mid-range phone.
 *
 *   • FULL-BLEED on a phone (the envelope IS the screen); on wider screens a
 *     phone-proportioned envelope stands exactly where the template's cover
 *     will appear (lib/cardReveal.ts envelopeStage).
 *   • Four flaps meet at the seal. Their paper is ONE procedural SVG
 *     (lib/cardRevealOrnament.ts: filigree sprays, curls, beaded seams,
 *     scalloped border, a medallion) rasterised once with an emboss filter,
 *     shown through each flap's clip-path over that flap's own facet colour.
 *   • Idle: a band of light travels along the embossed lines (a CSS mask of
 *     the same linework), pulses of light run down the seams into the seal,
 *     the wax seal breathes, and a soft sheen follows the finger.
 *   • The tap (the seal is a real <button>; the whole envelope is also a tap
 *     target): a beam strikes down onto the seal, the wax cracks in two, light
 *     surges along the seams and BLASTS out as the flaps swing away (bloom,
 *     rays, motes), and the card condenses out of the glow, growing onto the
 *     cover's rectangle with the title — then onDone.
 *   • Reduced motion: the same story with a fade-in beam, flaps that turn less
 *     far and slower, no rays spin, fewer motes, and a card that grows from
 *     nearly full size.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import gsap from 'gsap';
import type { CardRevealProps } from './types';
import { cardMonogram } from '../../../lib/cardPresentation';
import { burstMotes, envelopeBeats, envelopeStage, mixHex, type EnvelopeStage } from '../../../lib/cardReveal';
import { envelopeArtSvg, envelopeMaskSvg, envelopeOrnament, svgDataUrl } from '../../../lib/cardRevealOrnament';

/** Brand v2 warm core (#FFC56B) — the light inside the envelope. */
const CORE_RGB = '255, 197, 107';
const CORE_HEX = '#FFC56B';

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** A wax blob: a circle with a slow irregular rim, smoothed (viewBox centred on 0). */
function waxBlobPath(r: number): string {
  const n = 40;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + 0.035 * Math.sin(a * 7 + 0.4) + 0.022 * Math.sin(a * 13 + 1.7) + 0.012 * Math.sin(a * 23));
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const f = (v: number) => Math.round(v * 100) / 100;
  const mid = (i: number) => {
    const p = pts[i % n];
    const q = pts[(i + 1) % n];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  };
  const m0 = mid(0);
  let d = `M${f(m0[0])} ${f(m0[1])}`;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    const m = mid(i);
    d += `Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`;
  }
  return `${d}Z`;
}

/** The jagged crack down the seal, as the two halves' clip-paths. */
const CRACK = ['52% 0', '46% 18%', '55% 36%', '47% 55%', '54% 74%', '48% 100%'];
const CRACK_LEFT = `polygon(0 0, ${CRACK.join(', ')}, 0 100%)`;
const CRACK_RIGHT = `polygon(100% 0, ${CRACK.join(', ')}, 100% 100%)`;

function WaxSeal({
  r,
  wax,
  monogram,
  idSuffix,
}: {
  r: number;
  wax: string;
  monogram: string;
  idSuffix: string;
}) {
  const box = r * 1.1;
  const fid = `wax-${idSuffix}`;
  const deep = mixHex(wax, '#5a2e00', 0.42);
  const rim = mixHex(wax, '#ffffff', 0.35);
  const recess = mixHex(wax, '#8a4a10', 0.14);
  const size = monogram.length > 1 ? r * 0.62 : r * 0.84;
  return (
    <svg
      viewBox={`${-box} ${-box} ${box * 2} ${box * 2}`}
      width="100%"
      height="100%"
      aria-hidden
      style={{ overflow: 'visible', display: 'block' }}
    >
      <defs>
        <filter id={fid} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation={r * 0.07} result="b" />
          <feSpecularLighting
            in="b"
            surfaceScale={r * 0.14}
            specularConstant="1.25"
            specularExponent="10"
            lightingColor="#fff4e2"
            result="s"
          >
            <fePointLight x={-r * 0.7} y={-r * 1.0} z={r * 2.4} />
          </feSpecularLighting>
          <feComposite in="s" in2="SourceAlpha" operator="in" result="si" />
          <feComposite in="SourceGraphic" in2="si" operator="arithmetic" k1="0" k2="1" k3="0.6" k4="0" />
        </filter>
        <filter id={`${fid}-sh`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={r * 0.07} />
        </filter>
        <clipPath id={`${fid}-clip`}>
          <circle r={r * 0.72} />
        </clipPath>
      </defs>
      {/* Soft shadow the wax casts on the paper. */}
      <path
        d={waxBlobPath(r)}
        transform={`translate(${r * 0.04} ${r * 0.12})`}
        fill="rgba(10, 8, 40, 0.5)"
        filter={`url(#${fid}-sh)`}
      />
      <g filter={`url(#${fid})`}>
        <path d={waxBlobPath(r)} fill={wax} stroke={deep} strokeOpacity={0.35} strokeWidth={r * 0.035} />
        {/* The stamped recess: a touch darker, its upper-left wall in shadow,
            its lower-right lip catching light. */}
        <circle r={r * 0.72} fill={recess} />
        <circle r={r * 0.72} fill="none" stroke={deep} strokeOpacity={0.4} strokeWidth={r * 0.07} transform={`translate(${-r * 0.02} ${-r * 0.03})`} clipPath={`url(#${fid}-clip)`} />
        <circle r={r * 0.745} fill="none" stroke={rim} strokeOpacity={0.6} strokeWidth={r * 0.025} transform={`translate(${r * 0.012} ${r * 0.018})`} />
      </g>
      {/* Debossed monogram: a light lip below, the cut letter above. */}
      <text
        x={r * 0.02}
        y={r * 0.03}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Bricolage Grotesque Variable', 'Bricolage Grotesque', system-ui, sans-serif"
        fontWeight={600}
        fontSize={size}
        fill={rim}
        fillOpacity={0.7}
      >
        {monogram}
      </text>
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Bricolage Grotesque Variable', 'Bricolage Grotesque', system-ui, sans-serif"
        fontWeight={600}
        fontSize={size}
        fill={deep}
        fillOpacity={0.82}
      >
        {monogram}
      </text>
    </svg>
  );
}

type Flap = 'left' | 'right' | 'bottom' | 'top';
const FLAPS: Flap[] = ['left', 'right', 'bottom', 'top'];

export default function EnvelopeReveal({ card, palette, look, reducedMotion, onDone }: CardRevealProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openedRef = useRef(false);
  const doneRef = useRef(false);
  const openCtx = useRef<gsap.Context | null>(null);
  const [opened, setOpened] = useState(false);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // Measure the CONTAINER (the host preview is smaller than the window).
  // Frozen once opened: the choreography is computed from these numbers.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      if (openedRef.current) return;
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w <= 0 || h <= 0) return;
      setBox((b) => (b !== null && b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo: EnvelopeStage | null = useMemo(() => (box ? envelopeStage(box.w, box.h) : null), [box]);

  const warmHex = look === 'beamwall' ? CORE_HEX : palette.accent;
  const warmRgb = look === 'beamwall' ? CORE_RGB : palette.accentRgb;
  const monogram = cardMonogram(card.recipientName, card.title);
  // Honey wax: the warm core, a notch deeper so it reads as a solid, not a light.
  const wax = mixHex(warmHex, '#b8691f', 0.42);
  const sealRef = useRef<HTMLButtonElement | null>(null);

  // Focus the seal so Enter/Space opens it at once — without painting a focus
  // ring over the wax on load (autoFocus matches :focus-visible in Chrome).
  // A keyboard user who tabs still gets the ring.
  useEffect(() => {
    const el = sealRef.current;
    if (!el || openedRef.current) return;
    const opts: FocusOptions & { focusVisible?: boolean } = { preventScroll: true, focusVisible: false };
    el.focus(opts);
  }, [geo]);

  const paper = useMemo(() => {
    const base = palette.bg;
    return {
      top: mixHex(base, '#ffffff', 0.27),
      bottom: mixHex(base, '#ffffff', 0.22),
      side: mixHex(base, '#ffffff', 0.17),
      shadowRgb: hexToRgb(mixHex(base, '#000000', 0.6)),
    };
  }, [palette.bg]);

  const art = useMemo(() => {
    if (!geo) return null;
    const o = envelopeOrnament({ w: geo.stage.w, h: geo.stage.h, meet: geo.meet, sealR: geo.sealR });
    return {
      art: svgDataUrl(envelopeArtSvg(o, geo.stage.w, geo.stage.h, paper.shadowRgb)),
      mask: svgDataUrl(envelopeMaskSvg(o, geo.stage.w, geo.stage.h)),
      seams: o.seams,
    };
  }, [geo, paper.shadowRgb]);

  const motes = useMemo(
    () => (geo ? burstMotes(reducedMotion ? 10 : 26, Math.min(geo.stage.w, geo.stage.h) * 0.55, 11) : []),
    [geo, reducedMotion],
  );

  // ── Idle: shimmer along the linework, pulses down the seams, the seal breathes ──
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !geo || openedRef.current) return;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);
      // Arrival: the envelope settles in from a breath of light.
      gsap.fromTo(q('[data-env-stage]'), { opacity: 0, scale: reducedMotion ? 1 : 1.03 }, { opacity: 1, scale: 1, duration: 0.9, ease: 'power2.out' });
      gsap.fromTo(q('[data-env-seal]'), { opacity: 0, scale: reducedMotion ? 0.96 : 0.7 }, { opacity: 1, scale: 1, duration: reducedMotion ? 0.8 : 1.0, delay: 0.25, ease: reducedMotion ? 'power2.out' : 'back.out(1.6)' });
      gsap.fromTo(q('[data-env-hint]'), { opacity: 0 }, { opacity: 1, duration: 0.8, delay: 1.6 });

      // A band of light sweeps along the embossed lines.
      gsap.fromTo(
        q('[data-env-shimmer-band]'),
        { xPercent: -100 },
        { xPercent: 260, duration: reducedMotion ? 6 : 3.6, ease: 'sine.inOut', repeat: -1, repeatDelay: reducedMotion ? 2.4 : 1.4 },
      );
      // The seal's halo breathes.
      gsap.fromTo(
        q('[data-env-halo]'),
        { opacity: 0.45, scale: 0.92 },
        { opacity: 0.95, scale: 1.08, duration: 1.7, ease: 'sine.inOut', repeat: -1, yoyo: true },
      );
      // Energy runs down the seams into the seal (not under reduced motion).
      if (!reducedMotion) {
        q('[data-env-dash]').forEach((el, i) => {
          const len = Number(el.getAttribute('data-len') ?? '0');
          gsap.fromTo(
            el,
            { attr: { 'stroke-dashoffset': 80 } },
            { attr: { 'stroke-dashoffset': -len }, duration: 2.1, ease: 'power1.in', repeat: -1, repeatDelay: 1.6, delay: 0.9 + i * 0.28 },
          );
        });
      }
    }, root);
    return () => ctx.revert();
  }, [geo, reducedMotion]);

  useEffect(
    () => () => {
      openCtx.current?.revert();
      openCtx.current = null;
    },
    [],
  );

  // Sheen follows the finger (a Beamwall touch: the paper catches YOUR light).
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (openedRef.current) return;
    const root = rootRef.current;
    const glow = root?.querySelector<HTMLElement>('[data-env-pointer]');
    if (!root || !glow) return;
    const r = root.getBoundingClientRect();
    gsap.to(glow, { x: e.clientX - r.left, y: e.clientY - r.top, opacity: 1, duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
  }, []);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  const open = useCallback(() => {
    const root = rootRef.current;
    if (openedRef.current || !root || !geo) return;
    openedRef.current = true;
    setOpened(true);
    const B = envelopeBeats(reducedMotion);
    const rm = reducedMotion;
    const { stage, meet, sealR, card: cardRect } = geo;
    const H = stage.h;

    openCtx.current = gsap.context(() => {
      const q = gsap.utils.selector(root);
      gsap.killTweensOf(q('[data-env-dash], [data-env-shimmer-band], [data-env-halo]'));
      const tl = gsap.timeline({ onComplete: finish });

      tl.to(q('[data-env-hint], [data-env-pointer]'), { opacity: 0, duration: 0.25 }, 0);

      // 1. The beam strikes the seal from above.
      const beam = q('[data-env-beam]');
      if (rm) {
        tl.fromTo(beam, { opacity: 0, scaleY: 1 }, { opacity: 1, duration: 0.25, ease: 'sine.out' }, 0);
      } else {
        tl.fromTo(beam, { opacity: 1, scaleY: 0 }, { scaleY: 1, duration: 0.22, ease: 'power3.in' }, 0);
      }
      tl.to(beam, { opacity: 0, duration: 0.45, ease: 'power2.out' }, 0.26);
      tl.fromTo(q('[data-env-beam-core]'), { scaleX: 1 }, { scaleX: rm ? 1.6 : 3.2, duration: 0.3, ease: 'power2.out' }, 0.18);

      // 2. The wax flares and cracks in two.
      tl.to(q('[data-env-halo]'), { opacity: 1, scale: rm ? 1.3 : 1.9, duration: 0.25, ease: 'power2.out' }, 0.16);
      tl.to(q('[data-env-halo]'), { opacity: 0, duration: 0.5, ease: 'power1.in' }, 0.45);
      tl.fromTo(q('[data-env-flash]'), { opacity: 0.95, scale: 0.3 }, { opacity: 0, scale: rm ? 2 : 3.6, duration: B.seal.dur, ease: 'power2.out' }, 0.2);
      tl.set(q('[data-env-whole]'), { opacity: 0 }, 0.22);
      tl.set(q('[data-env-half]'), { opacity: 1 }, 0.22);
      tl.to(q('[data-env-half="l"]'), { x: -sealR * (rm ? 0.25 : 0.7), y: sealR * (rm ? 0.1 : 0.45), rotation: rm ? -8 : -26, opacity: 0, duration: B.seal.dur, ease: 'power2.out' }, 0.22);
      tl.to(q('[data-env-half="r"]'), { x: sealR * (rm ? 0.25 : 0.7), y: sealR * (rm ? 0.1 : 0.45), rotation: rm ? 8 : 26, opacity: 0, duration: B.seal.dur, ease: 'power2.out' }, 0.22);

      // 3. Light surges along the seams, then the linework goes quiet.
      tl.to(q('[data-env-seam-glow]'), { attr: { 'stroke-width': rm ? 8 : 14 }, opacity: 1, duration: B.seams.dur, ease: 'power2.out' }, B.seams.at);
      tl.to(q('[data-env-seam-core]'), { opacity: 1, attr: { 'stroke-width': 2.4 }, duration: B.seams.dur, ease: 'power2.out' }, B.seams.at);
      tl.to(q('[data-env-seams], [data-env-shimmer]'), { opacity: 0, duration: 0.5, ease: 'power1.in' }, B.topFlap.at + 0.35);

      // 4. The flaps swing away; light blooms out of the opening.
      const turn = rm ? 80 : 96;
      const persp = Math.round(H * 1.5);
      const flap = (sel: string, vars: gsap.TweenVars, beat: { at: number; dur: number }) => {
        tl.to(q(sel), { ...vars, transformPerspective: persp, duration: beat.dur, ease: rm ? 'sine.inOut' : 'power2.inOut' }, beat.at);
        tl.to(q(sel), { opacity: 0, duration: beat.dur * 0.4, ease: 'power1.in' }, beat.at + beat.dur * 0.5);
      };
      // They fold AWAY into depth (tips going back), so the gap at the seams
      // opens at once and the light pours through it; swinging toward the
      // viewer instead balloons the flaps over the very light we want seen.
      flap('[data-env-flap="top"]', { rotationX: -turn, transformOrigin: '50% 0%' }, B.topFlap);
      flap('[data-env-flap="left"]', { rotationY: turn, transformOrigin: '0% 50%' }, B.sideFlaps);
      flap('[data-env-flap="right"]', { rotationY: -turn, transformOrigin: '100% 50%' }, B.sideFlaps);
      flap('[data-env-flap="bottom"]', { rotationX: turn, transformOrigin: '50% 100%' }, B.bottomFlap);
      tl.to(q('[data-env-frame]'), { opacity: 0, duration: 0.5 }, B.bottomFlap.at + B.bottomFlap.dur * 0.5);

      tl.fromTo(q('[data-env-bloom]'), { opacity: 0, scale: 0.05 }, { opacity: 1, scale: 1, duration: B.bloom.dur, ease: rm ? 'power2.out' : 'expo.out' }, B.bloom.at);
      tl.fromTo(q('[data-env-rays]'), { opacity: 0, rotation: 0 }, { opacity: rm ? 0.45 : 0.85, duration: 0.6, ease: 'power2.out' }, B.bloom.at + 0.1);
      if (!rm) tl.to(q('[data-env-rays]'), { rotation: 28, duration: B.calm.at + B.calm.dur - B.bloom.at, ease: 'none' }, B.bloom.at);

      // 5. Motes drift out of the glow.
      q('[data-env-mote]').forEach((el, i) => {
        const m = motes[i];
        if (!m) return;
        const t0 = B.motes.at + m.delay * (rm ? 2 : 4);
        tl.fromTo(el, { x: 0, y: 0, opacity: 0, scale: 0.4 }, { x: m.dx, y: m.dy, opacity: 1, scale: 1, duration: B.motes.dur * 0.35, ease: 'power3.out' }, t0);
        tl.to(el, { y: m.dy - (rm ? 30 : 80), x: m.dx * 1.15, opacity: 0, duration: B.motes.dur * 0.6, ease: 'sine.in' }, t0 + B.motes.dur * 0.35);
      });

      // 6. The card condenses out of the glow onto the cover's rectangle.
      const cardEl = q('[data-env-card]');
      const dx = stage.x + meet.x - (cardRect.x + cardRect.w / 2);
      const dy = stage.y + meet.y - (cardRect.y + cardRect.h / 2);
      tl.fromTo(
        cardEl,
        { x: rm ? 0 : dx, y: rm ? 0 : dy, scale: rm ? 0.88 : 0.06, opacity: 0 },
        { x: 0, y: 0, scale: 1, duration: B.card.dur, ease: rm ? 'power2.out' : 'expo.out' },
        B.card.at,
      );
      tl.to(cardEl, { opacity: 1, duration: B.card.dur * 0.3, ease: 'power1.out' }, B.card.at);
      tl.fromTo(q('[data-env-card-light]'), { opacity: 1 }, { opacity: 0, duration: B.card.dur * 0.6, ease: 'power2.inOut' }, B.card.at + B.card.dur * 0.2);
      tl.fromTo(q('[data-env-title]'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' }, B.card.at + B.card.dur * 0.5);

      // 7. The light settles to an ambient wash; hold on the finished card.
      tl.to(q('[data-env-bloom]'), { opacity: 0.26, scale: 1.25, duration: B.calm.dur, ease: 'sine.inOut' }, B.calm.at);
      tl.to(q('[data-env-rays]'), { opacity: 0, duration: B.calm.dur, ease: 'sine.inOut' }, B.calm.at);
      tl.to({}, { duration: B.hold.dur }, B.hold.at);
    }, root);
  }, [geo, reducedMotion, motes, finish]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (!geo || !art) {
    return <div ref={rootRef} className="absolute inset-0" data-reveal="envelope" />;
  }

  const { stage, meet, sealR, card: cardRect, fullBleed } = geo;
  const sealX = stage.x + meet.x;
  const sealY = stage.y + meet.y;
  const bloomD = Math.hypot(Math.max(stage.w, box?.w ?? 0), Math.max(stage.h, box?.h ?? 0)) * 1.6;
  const poly: Record<Flap, string> = {
    top: `polygon(0 0, 100% 0, ${meet.x}px ${meet.y}px)`,
    bottom: `polygon(0 100%, 100% 100%, ${meet.x}px ${meet.y}px)`,
    left: `polygon(0 0, ${meet.x}px ${meet.y}px, 0 100%)`,
    right: `polygon(100% 0, ${meet.x}px ${meet.y}px, 100% 100%)`,
  };
  // Pearlescent facets: each flap catches the light from a different angle.
  const sheen: Record<Flap, string> = {
    top: 'linear-gradient(172deg, rgba(255,255,255,0.13) 0%, rgba(255,214,236,0.07) 38%, rgba(186,206,255,0.06) 70%, rgba(255,232,200,0.10) 100%)',
    bottom: 'linear-gradient(8deg, rgba(10,8,40,0.10) 0%, rgba(186,206,255,0.07) 40%, rgba(255,214,236,0.06) 75%, rgba(255,255,255,0.05) 100%)',
    left: 'linear-gradient(100deg, rgba(10,8,40,0.12) 0%, rgba(255,214,236,0.06) 55%, rgba(255,255,255,0.08) 100%)',
    right: 'linear-gradient(260deg, rgba(10,8,40,0.14) 0%, rgba(186,206,255,0.07) 55%, rgba(255,255,255,0.06) 100%)',
  };
  const facet: Record<Flap, string> = { top: paper.top, bottom: paper.bottom, left: paper.side, right: paper.side };
  const lift: Record<Flap, string | undefined> = {
    // A crisp contact shadow (the sheet's thickness) plus a soft cast one.
    top: `drop-shadow(0 1.5px 0.5px rgba(${paper.shadowRgb}, 0.55)) drop-shadow(0 ${Math.round(sealR * 0.12)}px ${Math.round(sealR * 0.22)}px rgba(${paper.shadowRgb}, 0.5))`,
    bottom: `drop-shadow(0 -1.5px 0.5px rgba(${paper.shadowRgb}, 0.45)) drop-shadow(0 -4px 9px rgba(${paper.shadowRgb}, 0.38))`,
    left: undefined,
    right: undefined,
  };
  // The cut edge of a heavy sheet: a pale bevel along each folded flap's free edges.
  const edgePts: Partial<Record<Flap, string>> = {
    top: `0,0 ${meet.x},${meet.y} ${stage.w},0`,
    bottom: `0,${stage.h} ${meet.x},${meet.y} ${stage.w},${stage.h}`,
  };
  const edgeTint = mixHex(paper.top, '#ffffff', 0.55);

  const stageStyle: CSSProperties = {
    left: stage.x,
    top: stage.y,
    width: stage.w,
    height: stage.h,
    borderRadius: fullBleed ? 0 : 28,
    boxShadow: fullBleed ? undefined : '0 30px 90px -20px rgba(8, 6, 40, 0.65)',
  };

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden select-none"
      data-reveal="envelope"
      onPointerMove={onPointerMove}
    >
      <h1 className="sr-only">{card.title}</h1>

      {/* The light inside the envelope (behind the paper). */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          data-env-bloom
          className="absolute rounded-full"
          style={{
            left: sealX - bloomD / 2,
            top: sealY - bloomD / 2,
            width: bloomD,
            height: bloomD,
            opacity: 0,
            background: `radial-gradient(circle, rgba(255,252,244,1) 0%, rgba(${warmRgb},0.95) 9%, rgba(${palette.accentRgb},0.55) 24%, rgba(${palette.accentRgb},0.16) 42%, rgba(${palette.accentRgb},0) 62%)`,
          }}
        />
        <div
          data-env-rays
          className="absolute rounded-full"
          style={{
            left: sealX - bloomD / 2,
            top: sealY - bloomD / 2,
            width: bloomD,
            height: bloomD,
            opacity: 0,
            background: `repeating-conic-gradient(from 0deg, rgba(${warmRgb},0) 0deg 5deg, rgba(255,236,200,0.5) 7deg, rgba(${warmRgb},0) 9.5deg 17deg)`,
            WebkitMaskImage: 'radial-gradient(circle, #000 0%, #000 8%, transparent 48%)',
            maskImage: 'radial-gradient(circle, #000 0%, #000 8%, transparent 48%)',
            mixBlendMode: 'screen',
          }}
        />
      </div>

      {/* The envelope. */}
      <div
        data-env-stage
        className="absolute cursor-pointer"
        style={stageStyle}
        onClick={open}
        aria-hidden
      >
        <div data-env-frame className="absolute inset-0" style={{ borderRadius: 'inherit', overflow: fullBleed ? undefined : 'hidden' }}>
          {FLAPS.map((f) => (
            <div
              key={f}
              data-env-flap={f}
              className="absolute inset-0"
              style={{ filter: lift[f], willChange: 'transform', backfaceVisibility: 'hidden' }}
            >
              <div
                className="absolute inset-0"
                style={{
                  clipPath: poly[f],
                  backgroundColor: facet[f],
                  backgroundImage: `url("${art.art}"), ${sheen[f]}`,
                  backgroundSize: `${stage.w}px ${stage.h}px, 100% 100%`,
                  backgroundRepeat: 'no-repeat',
                }}
              />
              {edgePts[f] !== undefined && (
                <svg className="pointer-events-none absolute inset-0" width={stage.w} height={stage.h} aria-hidden>
                  <polyline points={edgePts[f]} fill="none" stroke={edgeTint} strokeOpacity={0.75} strokeWidth={2.2} strokeLinejoin="round" />
                  <polyline points={edgePts[f]} fill="none" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={0.8} strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}

          {/* Light follows the finger. */}
          <div
            data-env-pointer
            className="pointer-events-none absolute rounded-full"
            style={{
              left: -stage.w * 0.45,
              top: -stage.w * 0.45,
              width: stage.w * 0.9,
              height: stage.w * 0.9,
              opacity: 0,
              background: 'radial-gradient(circle, rgba(255,250,240,0.20) 0%, rgba(255,250,240,0.07) 35%, rgba(255,250,240,0) 65%)',
              transform: `translate(${stage.w * 0.3}px, ${stage.h * 0.25}px)`,
              mixBlendMode: 'screen',
            }}
          />

          {/* A band of light travelling along the embossed lines. */}
          <div
            data-env-shimmer
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{
              WebkitMaskImage: `url("${art.mask}")`,
              maskImage: `url("${art.mask}")`,
              WebkitMaskSize: `${stage.w}px ${stage.h}px`,
              maskSize: `${stage.w}px ${stage.h}px`,
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
            }}
          >
            <div
              data-env-shimmer-band
              className="absolute"
              style={{
                top: '-50%',
                left: 0,
                width: '45%',
                height: '200%',
                transform: 'rotate(18deg)',
                background: `linear-gradient(90deg, rgba(${warmRgb},0) 0%, rgba(255,240,214,${reducedMotion ? 0.45 : 0.8}) 50%, rgba(${warmRgb},0) 100%)`,
              }}
            />
          </div>

          {/* Seams: a standing glow and pulses of light running into the seal. */}
          <svg
            data-env-seams
            className="pointer-events-none absolute inset-0"
            width={stage.w}
            height={stage.h}
            viewBox={`0 0 ${stage.w} ${stage.h}`}
          >
            {art.seams.map(([x1, y1, x2, y2], i) => {
              const len = Math.round(Math.hypot(x2 - x1, y2 - y1));
              return (
                <g key={i}>
                  <line data-env-seam-glow x1={x1} y1={y1} x2={x2} y2={y2} stroke={`rgb(${warmRgb})`} strokeOpacity={0.22} strokeWidth={5} strokeLinecap="round" />
                  <line data-env-seam-core x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff7e8" strokeOpacity={0.4} strokeWidth={1} />
                  {!reducedMotion && (
                    <line
                      data-env-dash
                      data-len={len}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="#fff8ec"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeDasharray={`80 ${len + 80}`}
                      strokeDashoffset={80}
                      style={{ filter: `drop-shadow(0 0 4px rgba(${warmRgb},0.9))` }}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* The beam that breaks the seal. */}
      <div
        data-env-beam
        className="pointer-events-none absolute"
        aria-hidden
        style={{ left: sealX - 30, top: 0, width: 60, height: sealY, opacity: 0, transformOrigin: '50% 0%' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(90deg, rgba(${warmRgb},0) 0%, rgba(${warmRgb},0.35) 50%, rgba(${warmRgb},0) 100%)`, filter: 'blur(6px)' }}
        />
        <div
          data-env-beam-core
          className="absolute"
          style={{ left: 28, top: 0, width: 4, height: '100%', borderRadius: 2, background: '#fffaf0', boxShadow: `0 0 12px 3px rgba(${warmRgb},0.9)` }}
        />
      </div>

      {/* Light motes and the flash where the seal breaks. */}
      <div className="pointer-events-none absolute" style={{ left: sealX, top: sealY }} aria-hidden>
        <div
          data-env-flash
          className="absolute rounded-full"
          style={{
            left: -sealR * 1.4,
            top: -sealR * 1.4,
            width: sealR * 2.8,
            height: sealR * 2.8,
            opacity: 0,
            background: `radial-gradient(circle, rgba(255,252,244,0.95) 0%, rgba(${warmRgb},0.6) 35%, rgba(${warmRgb},0) 70%)`,
          }}
        />
        {motes.map((m, i) => (
          <span
            key={i}
            data-env-mote
            className="absolute rounded-full"
            style={{
              left: -m.size / 2,
              top: -m.size / 2,
              width: m.size,
              height: m.size,
              opacity: 0,
              background: i % 3 === 0 ? '#ffffff' : `rgb(${warmRgb})`,
              boxShadow: `0 0 ${m.size * 2}px ${m.size * 0.6}px rgba(${warmRgb},0.75)`,
            }}
          />
        ))}
      </div>

      {/* The wax seal — THE tap target. */}
      <div
        data-env-seal
        className="absolute"
        style={{ left: sealX - sealR, top: sealY - sealR, width: sealR * 2, height: sealR * 2 }}
      >
        <div
          data-env-halo
          className="pointer-events-none absolute rounded-full"
          aria-hidden
          style={{
            left: -sealR * 0.9,
            top: -sealR * 0.9,
            width: sealR * 3.8,
            height: sealR * 3.8,
            background: `radial-gradient(circle, rgba(${warmRgb},0.55) 0%, rgba(${warmRgb},0.22) 38%, rgba(${warmRgb},0) 68%)`,
          }}
        />
        <button
          type="button"
          onClick={open}
          disabled={opened}
          ref={sealRef}
          aria-label="Open your card"
          className="absolute inset-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent disabled:cursor-default"
          style={{ background: 'transparent', WebkitTapHighlightColor: 'transparent' }}
        >
          {/* Whole at rest (two clipped halves would show a hairline seam);
              the halves take over the instant it cracks. */}
          <span data-env-whole className="absolute inset-0">
            <WaxSeal r={sealR} wax={wax} monogram={monogram} idSuffix={`${uid}w`} />
          </span>
          <span data-env-half="l" className="absolute inset-0" style={{ clipPath: CRACK_LEFT, opacity: 0 }}>
            <WaxSeal r={sealR} wax={wax} monogram={monogram} idSuffix={`${uid}l`} />
          </span>
          <span data-env-half="r" className="absolute inset-0" style={{ clipPath: CRACK_RIGHT, opacity: 0 }}>
            <WaxSeal r={sealR} wax={wax} monogram={monogram} idSuffix={`${uid}r`} />
          </span>
        </button>
      </div>

      <p
        data-env-hint
        className="pointer-events-none absolute left-0 right-0 text-center text-[13px] tracking-wide"
        style={{ top: sealY + sealR * 1.75, color: 'rgba(255,255,255,0.86)', textShadow: '0 1px 8px rgba(10,8,40,0.55)', opacity: 0 }}
        aria-hidden
      >
        Tap the seal to open
      </p>

      {/* The card that condenses out of the glow — ends on the cover's rect. */}
      <div
        data-env-card
        className="pointer-events-none absolute overflow-hidden text-center"
        aria-hidden
        style={{
          left: cardRect.x,
          top: cardRect.y,
          width: cardRect.w,
          height: cardRect.h,
          opacity: 0,
          borderRadius: '1.8rem',
          background: 'rgba(255,255,255,0.07)',
          WebkitBackdropFilter: 'blur(18px) saturate(130%)',
          backdropFilter: 'blur(18px) saturate(130%)',
          boxShadow:
            `inset 1px 1px 0 rgba(255,255,255,0.36), inset -1px -1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(${palette.accentRgb},0.18), 0 24px 90px rgba(0,0,0,0.45)`,
        }}
      >
        {/* The cover sets its title a little above centre (~45%). */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-center px-7" style={{ height: '90%' }}>
          <p data-env-title className="font-serif text-4xl leading-tight" style={{ color: palette.fg, opacity: 0 }}>
            {card.title}
          </p>
        </div>
        <div
          data-env-card-light
          className="absolute inset-0"
          style={{ background: `radial-gradient(90% 70% at 50% 45%, rgba(255,252,246,0.92) 0%, rgba(255,240,214,0.55) 40%, rgba(${warmRgb},0.18) 75%, rgba(${warmRgb},0) 100%)` }}
        />
      </div>
    </div>
  );
}
