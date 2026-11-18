/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The hero's accent: a floating glass phone that tells the product story,
 * phone → beam → wall. A soft light beam arcs from its camera to the live
 * wall; each time the wall is about to change a tile, a tiny photo card
 * leaves the phone, rides the beam and lands on that tile as it swaps (the
 * wall announces the swap ahead of time, see LiveWall `onUpcoming`).
 *
 * Purely decorative (aria-hidden, no pointer events). It lives in its own
 * depth layer inside the hero pane, so the pointer and scroll parallax move
 * the phone, the beam and the card together. Reduced motion: the phone holds
 * still, the beam is a steady glow and no card flies (the wall's swaps are
 * plain crossfades).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';

export interface Box { left: number; top: number; width: number; height: number; }

export interface HeroPhoneHandle {
  /** Send a photo card from the phone to `tile`, arriving in `ms`. */
  fly: (tile: HTMLElement, src: string, ms: number) => void;
}

type Pt = { x: number; y: number };

/** Where on the phone the beam leaves from (its camera, top edge toward the wall), as a fraction of the box. */
const CAMERA = { x: 0.74, y: 0.12 };

/** A quadratic arc from a to b, bowed gently upward (an eighth of its length). */
function arc(a: Pt, b: Pt): { c: Pt; at: (k: number) => Pt } {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - Math.max(16, d * 0.12) };
  return {
    c,
    at: (k) => ({
      x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * c.x + k * k * b.x,
      y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * c.y + k * k * b.y,
    }),
  };
}

const HeroPhone = forwardRef<HeroPhoneHandle, {
  /** The phone's box, in the hero pane's px. */
  box: Box;
  /** Where the beam rests between photos (the wall's centre tile). */
  restOn: () => HTMLElement | null;
  /** What the phone's screen shows: a guest photo under a look frame. */
  photo: string;
  frame: string | null;
  reduced: boolean;
  /** The layer's parallax depth (px per unit of pointer; px per px of scroll). */
  depth: { dx: number; dy: number; ds: number };
}>(function HeroPhone({ box, restOn, photo, frame, reduced, depth }, ref) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = [useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null)];
  const cardImgs = [useRef<HTMLImageElement | null>(null), useRef<HTMLImageElement | null>(null)];
  const screenRef = useRef<HTMLImageElement | null>(null);
  const nextCard = useRef(0);
  const [aim, setAim] = useState<Pt | null>(null);
  const cam: Pt = { x: box.left + box.width * CAMERA.x, y: box.top + box.height * CAMERA.y };

  /** A point on an element, in this layer's px (both measured now, so the parallax cancels). */
  const local = useCallback((el: Element, fx = 0.5, fy = 0.5): Pt | null => {
    const layer = layerRef.current;
    if (layer === null) return null;
    const lr = layer.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.width < 2) return null;
    return { x: r.left - lr.left + r.width * fx, y: r.top - lr.top + r.height * fy };
  }, []);

  // Rest the beam on the wall (re-aimed on every layout change).
  useEffect(() => {
    const el = restOn();
    if (el === null) return;
    const p = local(el);
    if (p !== null) setAim(p);
  }, [box.left, box.top, box.width, box.height, restOn, local]);

  useImperativeHandle(ref, () => ({
    fly(tile, src, ms) {
      if (reduced) return;
      const to = local(tile);
      if (to === null) return;
      setAim(to);
      const n = nextCard.current;
      nextCard.current = (n + 1) % cardRefs.length;
      const card = cardRefs[n].current;
      const img = cardImgs[n].current;
      if (card === null || img === null) return;
      img.src = src;
      if (screenRef.current !== null) screenRef.current.src = src;
      const tr = tile.getBoundingClientRect();
      const cw = card.offsetWidth || 30;
      const end = Math.max(0.5, Math.min(tr.width / cw, 3) * 0.8);
      const path = arc(cam, to);
      const frames: Keyframe[] = [];
      for (let i = 0; i <= 16; i++) {
        const k = i / 16;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const p = path.at(e);
        frames.push({
          offset: k,
          transform: `translate3d(${(p.x - cw / 2).toFixed(1)}px, ${(p.y - card.offsetHeight / 2).toFixed(1)}px, 0) scale(${(0.4 + (end - 0.4) * e).toFixed(3)}) rotate(${(-8 + 8 * e).toFixed(1)}deg)`,
          opacity: k < 0.12 ? k / 0.12 : k > 0.86 ? (1 - k) / 0.14 : 1,
        });
      }
      card.getAnimations().forEach((a) => a.cancel());
      card.animate(frames, { duration: ms, easing: 'linear', fill: 'both' });
    },
  }));

  const beam = aim !== null ? arc(cam, aim) : null;
  const d = beam !== null && aim !== null ? `M ${cam.x.toFixed(1)} ${cam.y.toFixed(1)} Q ${beam.c.x.toFixed(1)} ${beam.c.y.toFixed(1)} ${aim.x.toFixed(1)} ${aim.y.toFixed(1)}` : '';
  const layerStyle = { ['--dx' as string]: depth.dx, ['--dy' as string]: depth.dy, ['--ds' as string]: depth.ds } as CSSProperties;

  return (
    <div ref={layerRef} aria-hidden data-hero-accent className="bw-depth pointer-events-none absolute inset-0" style={layerStyle}>
      {d !== '' && (
        <svg className="absolute inset-0 h-full w-full overflow-visible" data-reduced={reduced}>
          <defs>
            <linearGradient id="bw-beam-g" gradientUnits="userSpaceOnUse" x1={cam.x} y1={cam.y} x2={aim?.x ?? 0} y2={aim?.y ?? 0}>
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
              <stop offset="0.6" stopColor="#CFCBFF" stopOpacity="0.55" />
              <stop offset="1" stopColor="#FFC56B" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <path className="bw-beam-glow" d={d} stroke="url(#bw-beam-g)" />
          <path className="bw-beam-core" d={d} stroke="url(#bw-beam-g)" />
          <path className="bw-beam-pulse" d={d} stroke="#FFFFFF" pathLength={100} />
          <circle className="bw-beam-spot" cx={aim?.x} cy={aim?.y} r={10} />
        </svg>
      )}
      <div className="absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
        <span className="bw-hphone-shadow" />
        <div className="bw-hphone" data-still={reduced}>
          <div className="bw-hphone-body">
            <div className="bw-hphone-screen">
              <img ref={screenRef} src={photo} alt="" draggable={false} />
              {frame !== null && <img src={frame} alt="" draggable={false} className="bw-hphone-frame" />}
            </div>
            <span className="bw-hphone-cam" />
          </div>
        </div>
      </div>
      {cardRefs.map((r, n) => (
        <div key={n} ref={r} className="bw-beam-card" style={{ opacity: 0 }}>
          <img ref={cardImgs[n]} alt="" draggable={false} />
        </div>
      ))}
    </div>
  );
});

export default HeroPhone;
