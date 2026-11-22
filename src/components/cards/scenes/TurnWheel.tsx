/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TurnWheel — "turn the wheel to open" (Deep blue). A brass wheel sits on
 * the porthole; the recipient turns it round (either way) and it turns with
 * the finger, a ring of light filling as it goes and the porthole cracking
 * open with it. Ticks in the hand every eighth of a turn; a full turn spins
 * it free and the porthole opens.
 *
 * Drawn in the 900x1600 stage space, centred on the gateway (450, 760).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { turnDelta, turnProgress, TURN_DEADZONE } from '../../../lib/openGesture';

export interface TurnWheelProps {
  accent: string;
  glow: string;
  disabled: boolean;
  reducedMotion: boolean;
  onProgress: (p: number) => void;
  onComplete: () => void;
  leaving: boolean;
}

const CX = 450;
const CY = 760;
const R = 150;
const SPOKES = 8;
/** Ring of light round the wheel (pathLength 1). */
const RING_R = 196;

export default function TurnWheel({ accent, glow, disabled, reducedMotion, onProgress, onComplete, leaving }: TurnWheelProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wheelRef = useRef<SVGGElement | null>(null);
  const ringRef = useRef<SVGCircleElement | null>(null);
  const st = useRef({ down: false, prev: 0, acc: 0, ticks: 0, done: false });
  const [turning, setTurning] = useState(false);
  const raf = useRef(0);

  const spokes = useMemo(
    () =>
      Array.from({ length: SPOKES }, (_, i) => {
        const a = (i / SPOKES) * Math.PI * 2;
        return {
          x1: CX + Math.cos(a) * 34,
          y1: CY + Math.sin(a) * 34,
          x2: CX + Math.cos(a) * (R + 34),
          y2: CY + Math.sin(a) * (R + 34),
        };
      }),
    [],
  );

  const paint = useCallback((acc: number) => {
    wheelRef.current?.setAttribute('transform', `rotate(${((acc * 180) / Math.PI).toFixed(2)} ${CX} ${CY})`);
    ringRef.current?.style.setProperty('stroke-dashoffset', String(1 - turnProgress(acc)));
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const angleOf = (e: React.PointerEvent) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    if (Math.hypot(p.x - CX, p.y - CY) < TURN_DEADZONE) return null;
    return Math.atan2(p.y - CY, p.x - CX);
  };

  const finish = useCallback(() => {
    const s = st.current;
    s.done = true;
    try {
      navigator.vibrate?.([16, 40, 24]);
    } catch {
      /* not allowed here */
    }
    // Spin it free, then hand over.
    const from = s.acc;
    const dir = Math.sign(from) || 1;
    const t0 = performance.now();
    const spin = (now: number) => {
      const k = reducedMotion ? 1 : Math.min(1, (now - t0) / 520);
      paint(from + dir * Math.PI * 1.2 * (1 - (1 - k) ** 3));
      if (k < 1) raf.current = requestAnimationFrame(spin);
    };
    raf.current = requestAnimationFrame(spin);
    onComplete();
  }, [onComplete, paint, reducedMotion]);

  const onDown = (e: React.PointerEvent<SVGGElement>) => {
    if (disabled || st.current.done) return;
    const a = angleOf(e);
    if (a === null) return;
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    st.current.down = true;
    st.current.prev = a;
    setTurning(true);
  };

  const onMove = (e: React.PointerEvent<SVGGElement>) => {
    const s = st.current;
    if (!s.down || s.done) return;
    const a = angleOf(e);
    if (a === null) return;
    s.acc += turnDelta(s.prev, a);
    s.prev = a;
    const p = turnProgress(s.acc);
    paint(s.acc);
    onProgress(p);
    const ticks = Math.floor(p * 8);
    if (ticks > s.ticks) {
      s.ticks = ticks;
      try {
        navigator.vibrate?.(5);
      } catch {
        /* not allowed here */
      }
    }
    if (p >= 1) {
      s.down = false;
      finish();
    }
  };

  const onUp = () => {
    st.current.down = false;
    setTurning(false);
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 900 1600"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-700"
      style={{ opacity: leaving ? 0 : 1 }}
      aria-hidden
      data-turn-wheel
    >
      <defs>
        <linearGradient id="wheel-brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE7A8" />
          <stop offset="0.5" stopColor="#D4A04A" />
          <stop offset="1" stopColor="#7E5418" />
        </linearGradient>
        <filter id="wheel-lift" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000" floodOpacity="0.5" />
        </filter>
      </defs>
      {/* The ring of light that fills as it turns. */}
      <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="6" />
      <circle
        ref={ringRef}
        cx={CX}
        cy={CY}
        r={RING_R}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="8"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        transform={`rotate(-90 ${CX} ${CY})`}
        style={{ strokeDashoffset: 1, filter: `drop-shadow(0 0 10px ${glow}) drop-shadow(0 0 22px ${accent})` }}
      />
      {/* A curved arrow round the rim until the first touch: "turn me". */}
      {!turning && !leaving && (
        <g className={reducedMotion ? undefined : 'stage-sway'} style={{ transformOrigin: `${CX}px ${CY}px` }} opacity="0.9">
          <path
            d={`M${CX - 120} ${CY - 186} A ${RING_R + 28} ${RING_R + 28} 0 0 1 ${CX + 120} ${CY - 186}`}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path d={`M${CX + 98} ${CY - 214} L${CX + 124} ${CY - 184} L${CX + 88} ${CY - 172}`} fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      <g
        className="pointer-events-auto"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ cursor: disabled ? undefined : turning ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        {/* A generous grip all round the wheel. */}
        <circle cx={CX} cy={CY} r={R + 110} fill="transparent" />
        <g ref={wheelRef} filter="url(#wheel-lift)">
          {spokes.map((s, i) => (
            <g key={i}>
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="url(#wheel-brass)" strokeWidth="16" strokeLinecap="round" />
              <circle cx={s.x2} cy={s.y2} r="15" fill="url(#wheel-brass)" stroke="#7E5418" strokeWidth="2" />
            </g>
          ))}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="url(#wheel-brass)" strokeWidth="24" />
          <circle cx={CX} cy={CY} r={R - 13} fill="none" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="3" />
          <circle cx={CX} cy={CY} r="44" fill="url(#wheel-brass)" stroke="#7E5418" strokeWidth="3" />
          <circle cx={CX} cy={CY} r="16" fill={accent} style={{ filter: `drop-shadow(0 0 8px ${glow})` }} />
        </g>
      </g>
    </svg>
  );
}
