/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InitialsGate — "trace your initials to open". The recipient's initials
 * hang large over the closed gate in the design's own lettering (gilded,
 * foil balloon, neon, frost, ribbon, marquee bulbs, pearls), unlit. Tracing
 * them lights them up stroke by stroke; once they are (nearly) all lit they
 * flare and the design opens its own way.
 *
 * All the tracing logic is lib/initialsTrace.ts; this only maps the pointer
 * into the 900x1600 stage and paints.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  initialsComplete,
  initialsLift,
  initialsLitPath,
  initialsStep,
  newInitialsTrace,
  type InitialsLayout,
  type InitialsTrace,
  type LetterStyle,
} from '../../../lib/initialsTrace';
import { shade } from '../../../lib/liveGates';

export interface InitialsGateProps {
  layout: InitialsLayout;
  style: LetterStyle;
  accent: string;
  glow: string;
  disabled: boolean;
  reducedMotion: boolean;
  /** Fades the letters out as the gate opens. */
  leaving: boolean;
  onComplete: () => void;
}

export default function InitialsGate({ layout, style, accent, glow, disabled, reducedMotion, leaving, onComplete }: InitialsGateProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sparkRef = useRef<SVGCircleElement | null>(null);
  const trace = useRef<InitialsTrace>(newInitialsTrace(layout));
  const [, setVersion] = useState(0);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);
  const allD = useMemo(() => layout.strokes.map((s) => s.d).join(' '), [layout]);
  const dotted = style === 'bulbs' || style === 'pearls';
  const dots = useMemo(
    () => layout.strokes.flatMap((s, si) => s.bins.map((b, bi) => ({ si, bi, x: b.x, y: b.y })).filter((_, k) => k % 2 === 0)),
    [layout],
  );
  const top = Math.min(...layout.strokes.flatMap((s) => s.bins.map((b) => b.y)));
  const bottom = Math.max(...layout.strokes.flatMap((s) => s.bins.map((b) => b.y)));

  const toStage = (e: React.PointerEvent) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const step = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || done) return;
      if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType === 'mouse') return;
      const p = toStage(e);
      if (!p) return;
      const next = initialsStep(trace.current, layout, p);
      if (sparkRef.current) {
        sparkRef.current.setAttribute('cx', String(p.x));
        sparkRef.current.setAttribute('cy', String(p.y));
        sparkRef.current.style.opacity = next.last ? '1' : '0.35';
      }
      if (next === trace.current) return;
      const before = trace.current;
      trace.current = next;
      setVersion((v) => v + 1);
      if (!before.covered.some((row, s) => row.some((c, b) => !c && next.covered[s][b]))) return;
      if (initialsComplete(next)) {
        setDone(true);
        trace.current = { covered: next.covered.map((r) => r.map(() => true)), last: null };
        try {
          navigator.vibrate?.([14, 40, 24]);
        } catch {
          /* not allowed here */
        }
        window.setTimeout(onComplete, reducedMotion ? 120 : 520);
      }
    },
    [disabled, done, layout, onComplete, reducedMotion],
  );

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || done) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    setTouched(true);
    step(e);
  };
  const onUp = () => {
    trace.current = initialsLift(trace.current);
    if (sparkRef.current) sparkRef.current.style.opacity = '0';
  };

  const lit = done ? allD : initialsLitPath(layout, trace.current);
  const covered = trace.current.covered;
  const gid = `ini-${style}`;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 900 1600"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      style={{
        touchAction: 'none',
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'scale(1.08)' : undefined,
        transformOrigin: '50% 47.5%',
        transition: 'opacity 600ms ease-out, transform 900ms cubic-bezier(0.16,1,0.3,1)',
        pointerEvents: disabled || leaving ? 'none' : undefined,
      }}
      onPointerDown={onDown}
      onPointerMove={step}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      aria-hidden
      data-initials={layout.letters}
      data-lettering={style}
      data-initials-done={done ? '1' : '0'}
    >
      <defs>
        <linearGradient id={`${gid}-gold`} gradientUnits="userSpaceOnUse" x1="0" y1={top} x2="0" y2={bottom}>
          <stop offset="0" stopColor="#FFF3C4" />
          <stop offset="0.45" stopColor="#E8B64C" />
          <stop offset="0.7" stopColor="#B07A1E" />
          <stop offset="1" stopColor="#F5D27A" />
        </linearGradient>
        <linearGradient id={`${gid}-foil`} gradientUnits="userSpaceOnUse" x1="0" y1={top} x2="0" y2={bottom}>
          <stop offset="0" stopColor={shade(accent, 0.55)} />
          <stop offset="0.5" stopColor={accent} />
          <stop offset="1" stopColor={shade(accent, -0.35)} />
        </linearGradient>
        <radialGradient id={`${gid}-pearl`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.6" stopColor="#F3ECF4" />
          <stop offset="1" stopColor="#BFB2C9" />
        </radialGradient>
        <filter id={`${gid}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* A soft pool of shade behind the letters so they read on any gate. */}
      <ellipse cx="450" cy="760" rx="340" ry="300" fill="#000" opacity="0.34" style={{ filter: 'blur(44px)' }} />

      {dotted ? (
        <g filter={`url(#${gid}-shadow)`}>
          <path d={allD} fill="none" stroke={style === 'bulbs' ? '#3A2410' : '#FFFFFF'} strokeOpacity={style === 'bulbs' ? 0.7 : 0.25} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          {dots.map((d) => {
            const on = done || covered[d.si]?.[d.bi];
            return style === 'bulbs' ? (
              <circle
                key={`${d.si}-${d.bi}`}
                cx={d.x}
                cy={d.y}
                r={on ? 11 : 9}
                fill={on ? '#FFF4CF' : '#6B4A1E'}
                stroke={on ? '#FFE08A' : '#2A1808'}
                strokeWidth="2"
                style={{ filter: on ? `drop-shadow(0 0 8px #FFE08A) drop-shadow(0 0 18px ${glow})` : undefined, transition: 'r 200ms' }}
              />
            ) : (
              <circle
                key={`${d.si}-${d.bi}`}
                cx={d.x}
                cy={d.y}
                r={on ? 13 : 11}
                fill={on ? `url(#${gid}-pearl)` : '#FFFFFF'}
                fillOpacity={on ? 1 : 0.28}
                style={{ filter: on ? `drop-shadow(0 0 10px ${glow})` : undefined, transition: 'r 200ms' }}
              />
            );
          })}
        </g>
      ) : (
        <>
          {/* Unlit: a dark channel, the letter dimmed in it, and a dotted line to follow */}
          <g filter={`url(#${gid}-shadow)`}>
            <path d={allD} fill="none" stroke={baseStroke(style, accent)} strokeOpacity={style === 'neon' ? 0.35 : 0.75} strokeWidth={width(style) + 12} strokeLinecap="round" strokeLinejoin="round" />
            <path
              d={allD}
              fill="none"
              stroke={style === 'neon' ? '#FFFFFF' : litStroke(style, gid)}
              strokeOpacity={style === 'neon' ? 0.2 : 0.4}
              strokeWidth={width(style)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <path d={allD} fill="none" stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="4" strokeDasharray="1 15" strokeLinecap="round" />
          {/* Lit, as it is traced */}
          {style !== 'neon' && (
            <path d={lit} fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth={width(style) + 10} strokeLinecap="round" strokeLinejoin="round" />
          )}
          <g style={{ filter: `drop-shadow(0 0 10px ${glow}) drop-shadow(0 0 26px ${style === 'neon' ? accent : glow})` }}>
            {style === 'neon' && <path d={lit} fill="none" stroke={accent} strokeWidth={width(style) + 10} strokeOpacity="0.85" strokeLinecap="round" strokeLinejoin="round" />}
            <path d={lit} fill="none" stroke={style === 'neon' ? '#FFFFFF' : litStroke(style, gid)} strokeWidth={style === 'neon' ? 9 : width(style)} strokeLinecap="round" strokeLinejoin="round" />
            {style !== 'neon' && (
              <path
                d={lit}
                fill="none"
                stroke="#FFFFFF"
                strokeOpacity={style === 'frost' ? 0.95 : 0.55}
                strokeWidth={style === 'frost' ? 6 : 7}
                strokeDasharray={style === 'frost' ? '2 14' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                transform="translate(-3 -4)"
              />
            )}
          </g>
        </>
      )}

      {/* The guide: a bead running along the first stroke until the first touch. */}
      {!touched && !reducedMotion && !disabled && (
        <circle r="13" fill="#FFFFFF" style={{ filter: `drop-shadow(0 0 12px ${glow})` }}>
          <animateMotion dur="2.6s" repeatCount="indefinite" path={layout.strokes[0].d} />
        </circle>
      )}
      <circle ref={sparkRef} r="18" fill="#FFFFFF" style={{ opacity: 0, filter: `drop-shadow(0 0 14px ${glow})`, transition: 'opacity 200ms' }} />
    </svg>
  );
}

function width(style: LetterStyle): number {
  return style === 'foil' ? 46 : style === 'ribbon' ? 34 : style === 'frost' ? 26 : style === 'neon' ? 18 : 30;
}

function baseStroke(style: LetterStyle, accent: string): string {
  if (style === 'gilt') return '#3A2306';
  if (style === 'neon') return accent;
  if (style === 'frost') return '#9FC7DA';
  return shade(accent, -0.45);
}

function litStroke(style: LetterStyle, gid: string): string {
  if (style === 'gilt') return `url(#${gid}-gold)`;
  if (style === 'foil') return `url(#${gid}-foil)`;
  if (style === 'frost') return '#EAF8FF';
  return `url(#${gid}-foil)`;
}
