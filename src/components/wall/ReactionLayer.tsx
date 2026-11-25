/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReactionLayer: emoji floating up off the Live wall (platform walls only).
 *
 * `useReactionFloaters` owns the in-flight set and the render cap; Wall feeds
 * it reactions from the broadcast wire and from this phone's own taps. All the
 * rules (cap, origin, flight) are pure in lib/wallReactions.
 *
 * A floater starts from its photo's tile when that tile is on screen. Tiles
 * carry `data-wall-post`, and the marquee renders each photo several times, so
 * the most visible copy wins. Otherwise it rises from the bottom edge. Under
 * reduced motion it is a brief pulse in place, with no travel.
 *
 * Pointer-events none and aria-hidden: decoration only, it can never eat a tap.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  FLOAT_MS,
  PULSE_MS,
  floaterFlight,
  floaterOrigin,
  floaterRoom,
  pickVisibleRect,
  type Point,
  type Rect,
  type ReactionEmoji,
} from '../../lib/wallReactions';

interface Floater {
  id: number;
  emoji: ReactionEmoji;
  x: number;
  y: number;
  style: CSSProperties;
}

/** Visible rects of every tile showing this post. */
function tileRectFor(postId: string, vw: number, vh: number): Rect | null {
  if (typeof document === 'undefined') return null;
  // postId was shape-checked (A-Z a-z 0-9 _ -) before it got here, so it is
  // safe inside the attribute selector.
  const nodes = document.querySelectorAll(`[data-wall-post="${postId}"]`);
  const rects: Rect[] = [];
  nodes.forEach((n) => {
    const r = n.getBoundingClientRect();
    rects.push({ left: r.left, top: r.top, width: r.width, height: r.height });
  });
  return pickVisibleRect(rects, vw, vh);
}

export interface SpawnOpts {
  emoji: ReactionEmoji;
  /** Start from this post's tile (if visible)... */
  postId?: string;
  /** ...or from an exact point (the button the guest just tapped). */
  at?: Point;
  count?: number;
}

export function useReactionFloaters(reduced: boolean): { spawn: (o: SpawnOpts) => void; layer: ReactNode } {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  /** Live count for the cap. A ref, so a burst of messages in one task all
   *  see each other instead of the same stale render's length. */
  const activeRef = useRef(0);
  const seedRef = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    const live = timers.current;
    return () => { live.forEach((t) => clearTimeout(t)); live.clear(); };
  }, []);

  const spawn = useCallback((o: SpawnOpts) => {
    if (typeof window === 'undefined') return;
    const reducedNow = reducedRef.current;
    // A stack of identical static pulses says nothing more than one.
    const wanted = reducedNow ? 1 : (o.count ?? 1);
    const room = floaterRoom(activeRef.current, wanted);
    if (room === 0) return; // over the cap: drop, never queue
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tile = o.at === undefined && o.postId !== undefined ? tileRectFor(o.postId, vw, vh) : null;
    const born: Floater[] = [];
    for (let i = 0; i < room; i += 1) {
      const seed = seedRef.current;
      seedRef.current += 1;
      const p = o.at ?? floaterOrigin(tile, vw, vh, seed);
      const f = floaterFlight(seed, vh, i);
      const lifeMs = reducedNow ? PULSE_MS : FLOAT_MS;
      born.push({
        id: seed,
        emoji: o.emoji,
        x: o.at !== undefined ? p.x + (i === 0 ? 0 : f.swayPx / 4) : p.x,
        y: p.y,
        style: {
          '--wr-sway': `${f.swayPx}px`,
          '--wr-rise': `${-f.risePx}px`,
          '--wr-tilt': `${f.tiltDeg}deg`,
          '--wr-scale': f.scale,
          animationDuration: `${lifeMs}ms`,
          animationDelay: `${f.delayMs}ms`,
        } as CSSProperties,
      });
      activeRef.current += 1;
      const t = setTimeout(() => {
        timers.current.delete(t);
        activeRef.current = Math.max(0, activeRef.current - 1);
        setFloaters((cur) => cur.filter((x) => x.id !== seed));
      }, lifeMs + f.delayMs + 50);
      timers.current.add(t);
    }
    setFloaters((cur) => [...cur, ...born]);
  }, []);

  const layer = (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      <style>{`
        .wall-react {
          position: absolute;
          transform: translate(-50%, -50%);
          font-size: calc(34px * var(--wall-scale, 1));
          line-height: 1;
          filter: drop-shadow(0 4px 10px rgba(0,0,0,0.45));
          opacity: 0;
          animation-name: wall-react-float;
          animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
          animation-fill-mode: both;
          will-change: transform, opacity;
        }
        .wall-react.is-still { animation-name: wall-react-pulse; animation-timing-function: ease-out; }
        @keyframes wall-react-float {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
          12%  { opacity: 1; transform: translate(-50%, -50%) scale(var(--wr-scale, 1)); }
          70%  { opacity: 1; }
          100% { opacity: 0; transform: translate(calc(-50% + var(--wr-sway, 0px)), calc(-50% + var(--wr-rise, -300px))) scale(var(--wr-scale, 1)) rotate(var(--wr-tilt, 0deg)); }
        }
        @keyframes wall-react-pulse {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
          30%  { opacity: 1; transform: translate(-50%, -50%) scale(1.12); }
          60%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
      {floaters.map((f) => (
        <span
          key={f.id}
          className={`wall-react${reduced ? ' is-still' : ''}`}
          style={{ left: f.x, top: f.y, ...f.style }}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );

  return { spawn, layer };
}
