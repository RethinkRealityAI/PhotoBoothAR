/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BoltsLock — "slide the bolts to open" (Jewel box). Three gold bolts lie
 * across the seam of the closed doors; the recipient slides each one aside
 * (alternating ways, the chevrons say which). Past the catch it clicks open
 * with a tick in the hand, short of it it slides home; a quick flick is
 * enough. Each open bolt lets
 * the doors give a hair; the third one opens the box.
 *
 * Drawn in the 900x1600 stage space (lib/openGesture.ts BOLTS), so the bolts
 * line up with the keepers painted in the gate art at every screen size.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { blendVelocity, BOLTS, BOLT_TRAVEL, boltRelease, RELEASE_STALE_MS } from '../../../lib/openGesture';

export interface BoltsLockProps {
  accent: string;
  glow: string;
  disabled: boolean;
  reducedMotion: boolean;
  /** How many bolts are open (the doors give a little per bolt). */
  onOpenCount: (n: number) => void;
  onAllOpen: () => void;
  /** Fades the bolts out as the doors begin to swing. */
  leaving: boolean;
}

const BOLT_W = 220;
const BOLT_H = 46;
const SETTLE_MS = 180;

export default function BoltsLock({ accent, glow, disabled, reducedMotion, onOpenCount, onAllOpen, leaving }: BoltsLockProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const barRefs = useRef<Array<SVGGElement | null>>([]);
  const pos = useRef<number[]>(BOLTS.map(() => 0));
  const drag = useRef<{ i: number; x0: number; p0: number; scale: number; v: number; at: number } | null>(null);
  const [open, setOpen] = useState<boolean[]>(() => BOLTS.map(() => false));
  const openRef = useRef<boolean[]>(BOLTS.map(() => false));
  const [active, setActive] = useState<number | null>(null);
  /** One settle animation per bolt, so letting one go and grabbing the next never freezes the first. */
  const raf = useRef<number[]>(BOLTS.map(() => 0));
  const done = useRef(false);

  const paint = useCallback((i: number, p: number) => {
    pos.current[i] = p;
    const el = barRefs.current[i];
    if (el) el.setAttribute('transform', `translate(${(p * BOLT_TRAVEL * BOLTS[i].dir).toFixed(1)} 0)`);
  }, []);

  useEffect(() => () => raf.current.forEach((id) => cancelAnimationFrame(id)), []);

  const settle = useCallback(
    (i: number, to: number) => {
      const from = pos.current[i];
      const t0 = performance.now();
      const step = (now: number) => {
        const k = reducedMotion ? 1 : Math.min(1, (now - t0) / SETTLE_MS);
        const e = 1 - (1 - k) ** 3;
        paint(i, from + (to - from) * e);
        if (k < 1) raf.current[i] = requestAnimationFrame(step);
      };
      cancelAnimationFrame(raf.current[i]);
      raf.current[i] = requestAnimationFrame(step);
    },
    [paint, reducedMotion],
  );

  const onDown = (i: number) => (e: React.PointerEvent<SVGGElement>) => {
    if (disabled || openRef.current[i] || drag.current) return;
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    cancelAnimationFrame(raf.current[i]);
    const m = svgRef.current?.getScreenCTM();
    drag.current = { i, x0: e.clientX, p0: pos.current[i], scale: m?.a || 1, v: 0, at: performance.now() };
    setActive(i);
    try {
      navigator.vibrate?.(6);
    } catch {
      /* not allowed here */
    }
  };

  const onMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x0) / d.scale;
    // Follows the finger both ways along the slot, from wherever it was grabbed.
    const p = Math.max(0, Math.min(1, d.p0 + (dx * BOLTS[d.i].dir) / BOLT_TRAVEL));
    const now = performance.now();
    d.v = blendVelocity(d.v, p - pos.current[d.i], now - d.at);
    d.at = now;
    paint(d.i, p);
  };

  const onUp = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setActive(null);
    const stale = e.type === 'pointercancel' || performance.now() - d.at > RELEASE_STALE_MS;
    const to = boltRelease(pos.current[d.i], stale ? 0 : d.v);
    settle(d.i, to);
    if (to === 1) {
      const next = openRef.current.map((o, k) => o || k === d.i);
      openRef.current = next;
      setOpen(next);
      const n = next.filter(Boolean).length;
      onOpenCount(n);
      try {
        navigator.vibrate?.(n === BOLTS.length ? [14, 40, 22] : 14);
      } catch {
        /* not allowed here */
      }
      if (n === BOLTS.length && !done.current) {
        done.current = true;
        window.setTimeout(onAllOpen, reducedMotion ? 60 : 260);
      }
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 900 1600"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full transition-opacity duration-500"
      // touch-action on inner SVG shapes is ignored: it has to sit on the <svg>
      // itself, or a phone pans and cancels the slide after a few pixels.
      style={{ opacity: leaving ? 0 : 1, pointerEvents: disabled || leaving ? 'none' : undefined, touchAction: 'none' }}
      aria-hidden
      data-bolts={open.filter(Boolean).length}
    >
      <defs>
        <linearGradient id="bolt-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF0B8" />
          <stop offset="0.45" stopColor="#E7B54E" />
          <stop offset="1" stopColor="#8F5E14" />
        </linearGradient>
        <linearGradient id="bolt-slot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
        <filter id="bolt-lift" x="-20%" y="-50%" width="140%" height="200%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000" floodOpacity="0.5" />
        </filter>
      </defs>
      {BOLTS.map((b, i) => {
        const isOpen = open[i];
        const lo = Math.min(450 - BOLT_W / 2, 450 - BOLT_W / 2 + BOLT_TRAVEL * b.dir);
        return (
          <g key={b.y} data-bolt={i} data-open={isOpen ? '1' : '0'}>
            {/* The slot it runs in. */}
            <rect x={lo - 6} y={b.y - 15} width={BOLT_W + BOLT_TRAVEL + 12} height={30} rx={15} fill="url(#bolt-slot)" />
            {/* Which way: chevrons pulsing out from the seam until it opens. */}
            {!isOpen && (
              <g
                opacity={active === i ? 0.25 : 0.85}
                className={reducedMotion ? undefined : b.dir < 0 ? 'stage-nudge-left' : 'stage-nudge-right'}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                {[0, 1].map((k) => {
                  const x = 450 + b.dir * (BOLT_W / 2 + 26 + k * 22);
                  return (
                    <path
                      key={k}
                      d={b.dir < 0 ? `M${x + 7} ${b.y - 12} L${x - 5} ${b.y} L${x + 7} ${b.y + 12}` : `M${x - 7} ${b.y - 12} L${x + 5} ${b.y} L${x - 7} ${b.y + 12}`}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={1 - k * 0.4}
                    />
                  );
                })}
              </g>
            )}
            <g
              ref={(el) => {
                barRefs.current[i] = el;
              }}
              onPointerDown={onDown(i)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              style={{ cursor: isOpen ? 'default' : 'grab', touchAction: 'none' }}
            >
              {/* A generous invisible grip for fingers. */}
              <rect x={450 - BOLT_W / 2 - 20} y={b.y - 60} width={BOLT_W + 40} height={120} fill="transparent" />
              <g filter="url(#bolt-lift)">
                <rect x={450 - BOLT_W / 2} y={b.y - BOLT_H / 2} width={BOLT_W} height={BOLT_H} rx={BOLT_H / 2} fill="url(#bolt-gold)" />
                {/* Engraved bands and the knob you push. */}
                {[-70, -52, 52, 70].map((dx) => (
                  <rect key={dx} x={450 + dx - 2} y={b.y - BOLT_H / 2 + 6} width={4} height={BOLT_H - 12} rx={2} fill="#8F5E14" opacity="0.55" />
                ))}
                <circle cx={450} cy={b.y} r={22} fill="url(#bolt-gold)" stroke="#8F5E14" strokeWidth="2" />
                <circle cx={450} cy={b.y} r={9} fill={isOpen ? glow : accent} style={{ filter: isOpen ? `drop-shadow(0 0 10px ${glow})` : undefined, transition: 'fill 300ms' }} />
                <rect x={450 - BOLT_W / 2 + 14} y={b.y - BOLT_H / 2 + 5} width={BOLT_W - 28} height={6} rx={3} fill="#FFFFFF" opacity="0.45" />
              </g>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
