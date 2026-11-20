/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CardOrnament — the letterpress frame every keepsake page wears.
 *
 * Fine ornamental linework (double hairline rules, a beaded rule, a notched
 * inner border with an ogee arch top and bottom, filigree corners and a crest
 * in each arch), embossed by LAYERING rather than filtering: every line is
 * drawn three times — a deep shadow a hair down-right, a highlight a hair
 * up-left, then the line itself. That reads as pressed paper and costs no
 * filter pass on a phone.
 *
 * Over it runs the "energy pulse": a short bright dash of light that travels
 * along every seam (stroke-dashoffset on `pathLength`-normalised paths, so a
 * corner curl and a full-height rule finish their lap together and the whole
 * frame pulses as one). A wider, fainter copy of the same dash is the glow —
 * no blur filter. Paused while the tab is hidden; under reduced motion it
 * keeps running, slower and dimmer, because a still frame reads as dead.
 *
 * Geometry is drawn in the box's own pixels (lib/cardTemplates.ts
 * `ornamentFrame`) — a stretched viewBox would squash the corners.
 *
 * Colours are semantic only: lines in `--color-brand-fg` (or the paper's ink
 * for `tone="paper"`), light in `--color-accent`, the crest spark in the warm
 * core — so the event look repaints it without a code path.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ornamentFrame } from '../../../lib/cardTemplates';

/** One filigree corner, drawn for the top-left; mirrored into the others.
 *  Symmetric about the diagonal: the half below is reflected by swapping x/y. */
const CORNER_HALF = [
  // The main scroll, ending in a curl.
  'M7 7C20 9 40 6 60 8C73 9 79 16 75 22C72 26 66 24 67 19C68 16 72 16 72 19',
  // A thinner inner vine.
  'M12 16C24 19 33 25 39 34',
  // Leaves along the scroll.
  'M24 9C27 5.5 33 5.5 36 9C33 12.5 27 12.5 24 9Z',
  'M42 8C45 4.8 50 5 53 8.4C50 11.4 45 11.3 42 8Z',
  'M33 25C36 23 40 24 41 27C38 29 35 28 33 25Z',
  // A tendril off the curl.
  'M60 8C64 4 70 3 74 5',
];
const CORNER_DOTS: Array<[number, number, number]> = [
  [56, 14, 1.1],
  [63, 15, 0.8],
  [47, 16, 0.9],
];
/** The rosette at the corner's heart. */
const ROSETTE_PETALS = 8;

/** The crest in each arch: a sprig with two curls, origin at its top. */
const CREST = [
  'M0 2V20',
  'M0 7C-7 2-15 5-17 11C-18 15-14 17-12 14C-11 12-13 10-15 11',
  'M0 7C7 2 15 5 17 11C18 15 14 17 12 14C11 12 13 10 15 11',
  'M0 14C-4 12-8 13-10 16C-7 18-3 17 0 14Z',
  'M0 14C4 12 8 13 10 16C7 18 3 17 0 14Z',
];

/** False while the tab is hidden — every looping light on a card pauses on it. */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

function useBoxSize(ref: React.RefObject<SVGSVGElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export interface CardOrnamentProps {
  /** 'full' = rules, beads, the arched border, corners and crests (covers,
   *  closing pages). 'light' = rules, beads and corners only (content pages,
   *  where an arch would collide with a photo). */
  density?: 'full' | 'light';
  /** 'glass' draws light lines on the dusk/glass; 'paper' presses ink-tinted
   *  lines into a white print. */
  tone?: 'glass' | 'paper';
  reducedMotion?: boolean;
  /** Turn the travelling light off (static/frame renders). */
  pulse?: boolean;
  className?: string;
}

export default function CardOrnament({
  density = 'full',
  tone = 'glass',
  reducedMotion = false,
  pulse = true,
  className = '',
}: CardOrnamentProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const { w, h } = useBoxSize(ref);
  const visible = useDocumentVisible();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ready = w > 60 && h > 60;
  const f = ready ? ornamentFrame(w, h) : null;
  const full = density === 'full';

  const ink = tone === 'paper' ? 'var(--color-brand-bg)' : 'var(--color-brand-fg)';
  const baseOpacity = tone === 'paper' ? 0.34 : 0.42;
  const hiColor = '#FFFFFF';
  const hiOpacity = tone === 'paper' ? 0.95 : 0.4;
  const shadowColor = 'rgba(16, 12, 60, 1)';
  const shadowOpacity = tone === 'paper' ? 0.16 : 0.38;

  const duration = reducedMotion ? 16 : 7;
  const pulseOpacity = reducedMotion ? 0.45 : 1;
  const playState = visible ? 'running' : 'paused';

  const lines = `bwo-lines-${uid}`;
  const anim = (delay: number): React.CSSProperties => ({
    animation: `bwo-seam-${uid} ${duration}s linear ${delay}s infinite`,
    animationPlayState: playState,
  });

  return (
    <svg
      ref={ref}
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      width="100%"
      height="100%"
      aria-hidden
      focusable="false"
    >
      {f && (
        <>
          <style>{`@keyframes bwo-seam-${uid}{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}`}</style>
          <defs>
            {/* Symbol per motif, so the corners and crests are drawn once. */}
            <g id={`${lines}-corner`}>
              {CORNER_HALF.map((d) => (
                <path key={d} d={d} pathLength={100} />
              ))}
              <g transform="matrix(0 1 1 0 0 0)">
                {CORNER_HALF.map((d) => (
                  <path key={d} d={d} pathLength={100} />
                ))}
              </g>
              {Array.from({ length: ROSETTE_PETALS }, (_, i) => (
                <ellipse
                  key={i}
                  cx={17}
                  cy={17}
                  rx={4.6}
                  ry={1.7}
                  transform={`rotate(${(360 / ROSETTE_PETALS) * i} 17 17) translate(4.6 0)`}
                  pathLength={100}
                />
              ))}
            </g>
            <g id={`${lines}-crest`}>
              {CREST.map((d) => (
                <path key={d} d={d} pathLength={100} />
              ))}
            </g>
            <g id={lines}>
              <path d={f.rules[0]} pathLength={100} />
              <path d={f.rules[1]} pathLength={100} />
              {full && <path d={f.arch} pathLength={100} />}
              {f.corners.map((t) => (
                <use key={t} href={`#${lines}-corner`} transform={t} />
              ))}
              {full && f.crests.map((t) => <use key={t} href={`#${lines}-crest`} transform={t} />)}
            </g>
          </defs>

          {/* Emboss: shadow, highlight, then the line. */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
            <use
              href={`#${lines}`}
              transform="translate(0.7 0.9)"
              stroke={shadowColor}
              strokeOpacity={shadowOpacity}
              strokeWidth={1}
            />
            <use
              href={`#${lines}`}
              transform="translate(-0.5 -0.6)"
              stroke={hiColor}
              strokeOpacity={hiOpacity}
              strokeWidth={0.8}
            />
            <use href={`#${lines}`} style={{ stroke: ink }} strokeOpacity={baseOpacity} strokeWidth={0.9} />

            {/* Beaded rule: round caps on a zero-length dash make pearls. */}
            <path
              d={f.beads}
              style={{ stroke: ink }}
              strokeOpacity={baseOpacity * 0.9}
              strokeWidth={2}
              strokeDasharray="0 7"
            />
            {CORNER_DOTS.length > 0 &&
              f.corners.map((t) => (
                <g key={`dots-${t}`} transform={t} style={{ fill: ink }} fillOpacity={baseOpacity} stroke="none">
                  {CORNER_DOTS.map(([x, y, r]) => (
                    <g key={`${x}-${y}`}>
                      <circle cx={x} cy={y} r={r} />
                      <circle cx={y} cy={x} r={r} />
                    </g>
                  ))}
                  <circle cx={17} cy={17} r={1.8} />
                </g>
              ))}
          </g>

          {/* The energy pulse: a bright dash travelling every seam, plus a
              wider faint copy as its glow. */}
          {pulse && (
            <g fill="none" strokeLinecap="round" style={{ opacity: pulseOpacity }}>
              {/* Halo in the accent, a warm bloom, then a near-white core. */}
              <use
                href={`#${lines}`}
                strokeWidth={5}
                strokeOpacity={0.3}
                strokeDasharray="18 82"
                style={{ ...anim(0), stroke: 'var(--color-accent)' }}
              />
              <use
                href={`#${lines}`}
                strokeWidth={2.6}
                strokeOpacity={0.55}
                strokeDasharray="12 88"
                style={{ ...anim(0), stroke: '#FFC56B' }}
              />
              <use
                href={`#${lines}`}
                strokeWidth={1.4}
                strokeOpacity={1}
                strokeDasharray="7 93"
                style={{ ...anim(0), stroke: '#FFF6E8' }}
              />
              {/* A fainter second spark half a lap behind. */}
              <use
                href={`#${lines}`}
                strokeWidth={1.2}
                strokeOpacity={0.6}
                strokeDasharray="4 96"
                style={{ ...anim(-duration / 2), stroke: 'var(--color-accent)' }}
              />
            </g>
          )}

          {/* The crest spark: the one warm light on the page. */}
          {full &&
            f.crests.map((t) => (
              <g key={`spark-${t}`} transform={t}>
                <circle cx={0} cy={26} r={5} fill="#FFC56B" fillOpacity={0.18} />
                <path d="M0 21.5L1.2 24.8L4.5 26L1.2 27.2L0 30.5L-1.2 27.2L-4.5 26L-1.2 24.8Z" fill="#FFE2B0" />
              </g>
            ))}
        </>
      )}
    </svg>
  );
}
