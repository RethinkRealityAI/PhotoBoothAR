/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ornaments — what is drawn round Beamy (one viewport-sized SVG just over the
 * stage, never taking a tap) and his speech bubble:
 *   ring      turn: a vault dial that turns with the finger (ticks + a knob);
 *             tap: one segment per tap; melt / shine: the hold charge
 *   triangle  trace: the dashed outline (beamyOutline) with the traced
 *             stretches lit (traceOpen's tracedPath) and a start dot
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { tracedPath, type StagePoint, type TraceState } from '../../lib/traceOpen';
import type { RevealUnlock } from '../../lib/reveals/revealModel';
import type { BubbleSpot, RevealLayout } from '../../lib/reveals/revealScene';
import { describeArc } from './SealedObject';

interface OrnProps {
  layout: RevealLayout;
  unlock: RevealUnlock;
  progress: number;
  /** turn: the dial's angle (rad). */
  angle: number;
  taps: number;
  tapsNeeded: number;
  outline: readonly StagePoint[];
  trace: TraceState;
  /** Draw the active parts (the poster shows only the quiet track). */
  active: boolean;
}

export function Ornaments({ layout, unlock, progress, angle, taps, tapsNeeded, outline, trace, active }: OrnProps) {
  const { cx, cy, r } = layout.ring;
  const ringish = unlock === 'turn' || unlock === 'tap' || unlock === 'melt' || unlock === 'shine';
  return (
    <svg className="rv-orn" width="100%" height="100%" aria-hidden>
      {ringish && (
        <g>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--rv-fg)" strokeOpacity={unlock === 'turn' ? 0.28 : 0.16} strokeWidth={unlock === 'turn' ? 14 : 4} />
          {unlock === 'turn' && (
            <g transform={`rotate(${(angle * 180) / Math.PI} ${cx} ${cy})`}>
              {Array.from({ length: 36 }, (_, i) => {
                const a = (i / 36) * Math.PI * 2;
                const long = i % 3 === 0;
                const r0 = r - (long ? 9 : 5);
                const r1 = r + (long ? 9 : 5);
                return <line key={i} x1={cx + Math.sin(a) * r0} y1={cy - Math.cos(a) * r0} x2={cx + Math.sin(a) * r1} y2={cy - Math.cos(a) * r1} stroke="var(--rv-fg)" strokeOpacity={long ? 0.85 : 0.45} strokeWidth={long ? 2 : 1.2} strokeLinecap="round" />;
              })}
              <circle cx={cx} cy={cy - r} r={13} fill="var(--rv-core)" stroke="#FFFFFF" strokeWidth="2.5" style={{ filter: 'drop-shadow(0 0 8px var(--rv-core))' }} />
            </g>
          )}
          {unlock === 'tap' && Array.from({ length: tapsNeeded }, (_, i) => {
            const seg = (Math.PI * 2) / tapsNeeded;
            const d = describeArc(cx, cy, r, i * seg + 0.08, (i + 1) * seg - 0.08);
            const on = i < taps;
            return <path key={i} d={d} fill="none" stroke={on ? 'var(--rv-core)' : 'var(--rv-fg)'} strokeOpacity={on ? 1 : 0.3} strokeWidth={on ? 6 : 4} strokeLinecap="round" style={on ? { filter: 'drop-shadow(0 0 6px var(--rv-core))' } : undefined} />;
          })}
          {active && unlock !== 'tap' && progress > 0.002 && (
            <path d={describeArc(cx, cy, r, 0, progress * Math.PI * 2)} fill="none" stroke="var(--rv-core)" strokeWidth={unlock === 'turn' ? 5 : 6} strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 6px var(--rv-core))' }} />
          )}
        </g>
      )}
      {unlock === 'trace' && outline.length > 2 && (
        <g>
          <polygon className="rv-dash" points={outline.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--rv-fg)" strokeOpacity="0.55" strokeWidth="3" strokeDasharray="10 4" strokeLinejoin="round" />
          {active && (
            <path d={tracedPath(outline, trace)} fill="none" stroke="var(--rv-core)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px var(--rv-core))' }} />
          )}
          {active && progress === 0 && <circle cx={outline[0].x} cy={outline[0].y} r="9" fill="var(--rv-core)" className="rv-hint-dot" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />}
        </g>
      )}
    </svg>
  );
}

/** Beamy's speech bubble, kept on screen and pointed at the spot. */
export function SpeechBubble({ text, spot, hidden, phone }: { text: string; spot: BubbleSpot; hidden: boolean; phone: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; tailX: number }>({ left: -9999, top: 0, tailX: 20 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    const vw = window.innerWidth;
    if (spot.tail === 'left') {
      setPos({ left: Math.min(spot.x + 10, vw - 12 - bw), top: Math.max(8, spot.y - bh / 2), tailX: 20 });
    } else {
      const left = Math.min(Math.max(12, spot.x - bw / 2), Math.max(12, vw - 12 - bw));
      setPos({ left, top: spot.y - bh - 9, tailX: Math.min(Math.max(22, spot.x - left), bw - 22) });
    }
  }, [text, spot.x, spot.y, spot.tail, spot.maxW]);
  return (
    <div
      ref={ref}
      className="bw-bubble rv-bubble"
      data-tail={spot.tail}
      data-hidden={hidden || text === '' ? 'true' : 'false'}
      role="status"
      aria-live="polite"
      style={{ transform: `translate3d(${pos.left}px, ${pos.top}px, 0)`, maxWidth: spot.maxW, fontSize: phone ? 14 : 15, ['--tail-x' as string]: `${pos.tailX}px` }}
    >
      <span className="rv-bubble-text" key={text}>{text}</span>
    </div>
  );
}
