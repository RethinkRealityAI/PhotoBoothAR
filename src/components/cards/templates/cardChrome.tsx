/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Card chrome — the light that every keepsake surface carries.
 *
 *   ShimmerRim  Beamwall's signature border: two heads of light (the accent,
 *               then a warm-white core) travelling round a rounded rim over a
 *               faint hairline, with a blurred copy underneath as the glow.
 *               Pure CSS: a conic-gradient whose start angle is a registered
 *               custom property (@property), masked to the border ring.
 *               `trigger="hover"` keeps it still until a pointer or focus
 *               arrives — that is how the glass buttons light up.
 *   CardField   The designed space behind the card: a crown of light with
 *               slow rays, drifting bokeh discs and a sparse star map joined
 *               by hairlines that a pulse of light runs along. Seeded per
 *               card (lib/cardTemplates.ts cardFieldLayout), so it is the same
 *               sky on every visit and in a frame render.
 *   CHROME_CSS  The shared rules (the rim, the glass call-to-action's glowing
 *               rim on hover/press, the field's keyframes), rendered as ONE
 *               hoisted, de-duplicated stylesheet (React 19 `precedence`).
 *
 * Cost on a phone: only transforms, opacity and one custom property animate;
 * no canvas, no WebGL, no per-frame JS. Everything pauses while the tab is
 * hidden. Under reduced motion the rims keep turning, slower and dimmer (a
 * still rim reads as dead), while the field holds still.
 *
 * Colours are semantic only (`--accent-rgb`, `--color-brand-bg`) plus the
 * brand's warm core, so the event look repaints all of it.
 */
import { useMemo, type CSSProperties } from 'react';
import { cardFieldLayout } from '../../../lib/cardTemplates';
import { useDocumentVisible } from './cardOrnament';

/** The two heads of light and the gaps between them. */
const RIM_LIGHT =
  'conic-gradient(from var(--bw-rim), transparent 0deg, rgba(var(--accent-rgb),0) 16deg, rgba(var(--accent-rgb),0.95) 48deg, #FFF6E8 57deg, rgba(255,197,107,0.9) 62deg, transparent 98deg, transparent 180deg, rgba(var(--accent-rgb),0) 196deg, rgba(var(--accent-rgb),0.75) 226deg, rgba(255,255,255,0.9) 234deg, transparent 268deg)';

export const CHROME_CSS = `
@property --bw-rim { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
@keyframes bw-rim-spin { to { --bw-rim: 360deg; } }
.bw-rim, .bw-rim-glow > span {
  position: absolute; inset: 0; pointer-events: none; box-sizing: border-box;
  padding: var(--bw-rim-w, 1.5px);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: bw-rim-spin var(--bw-rim-s, 8s) linear infinite;
}
.bw-rim {
  background: ${RIM_LIGHT}, linear-gradient(rgba(255,255,255,var(--bw-rim-base,0.2)), rgba(255,255,255,var(--bw-rim-base,0.2)));
  opacity: var(--bw-rim-o, 1);
}
.bw-rim-glow { position: absolute; inset: -4px; pointer-events: none; filter: blur(7px); opacity: calc(var(--bw-rim-o, 1) * 0.85); }
.bw-rim-glow > span { padding: calc(var(--bw-rim-w, 1.5px) + 4px); background: ${RIM_LIGHT}; }
.bw-rim[data-trigger='hover'], .bw-rim-glow[data-trigger='hover'] > span { animation-play-state: paused; }
.bw-rim-glow[data-trigger='hover'] { opacity: 0; transition: opacity 0.35s ease; }
@media (hover: hover) {
  .bw-cta:hover .bw-rim[data-trigger='hover'], .bw-cta:hover .bw-rim-glow[data-trigger='hover'] > span { animation-play-state: running; }
  .bw-cta:hover .bw-rim-glow[data-trigger='hover'] { opacity: 0.85; }
}
.bw-cta:focus-visible .bw-rim[data-trigger='hover'], .bw-cta:focus-visible .bw-rim-glow[data-trigger='hover'] > span,
.bw-cta:active .bw-rim[data-trigger='hover'], .bw-cta:active .bw-rim-glow[data-trigger='hover'] > span { animation-play-state: running; }
.bw-cta:focus-visible .bw-rim-glow[data-trigger='hover'], .bw-cta:active .bw-rim-glow[data-trigger='hover'] { opacity: 0.85; }

.bw-cta {
  transition: box-shadow 0.3s ease, transform 0.14s cubic-bezier(0.16, 1, 0.3, 1), filter 0.3s ease;
}
@media (hover: hover) {
  .bw-cta:hover {
    filter: brightness(1.08);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.42), 0 0 30px -6px rgba(var(--accent-rgb),0.95), 0 14px 40px -16px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.45);
  }
}
.bw-cta:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.6), 0 0 0 4px rgba(var(--accent-rgb),0.45), 0 0 30px -6px rgba(var(--accent-rgb),0.95);
}
.bw-cta:active {
  transform: scale(0.96);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.65), 0 0 42px -4px rgba(var(--accent-rgb),1), inset 0 0 22px -8px rgba(var(--accent-rgb),0.95);
}
.bw-cta:disabled { transform: none; filter: none; }

@keyframes bw-rays { from { transform: rotate(-3deg); } to { transform: rotate(3deg); } }
@keyframes bw-drift {
  0% { transform: translate3d(0, 0, 0); }
  50% { transform: translate3d(3vmin, -4vmin, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
@keyframes bw-twinkle { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@keyframes bw-line-run { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
.bw-field-paused, .bw-field-paused * { animation-play-state: paused !important; }
`;

/** The shared stylesheet. Safe to render many times: React hoists it once. */
export function ChromeStyles() {
  return (
    <style href="bw-card-chrome" precedence="default">
      {CHROME_CSS}
    </style>
  );
}

export interface ShimmerRimProps {
  /** Any CSS border-radius — the rim follows it exactly. */
  radius: string;
  /** Rim thickness in px. */
  width?: number;
  /** Seconds per lap. */
  lapS?: number;
  /** 'always' turns continuously; 'hover' waits for hover / focus / press. */
  trigger?: 'always' | 'hover';
  /** Brightness of the hairline the light travels over. */
  base?: number;
  glow?: boolean;
  reducedMotion?: boolean;
  /** Start the lap here (seconds, negative) so neighbouring rims differ. */
  phaseS?: number;
  className?: string;
}

export function ShimmerRim({
  radius,
  width = 1.5,
  lapS = 8,
  trigger = 'always',
  base = 0.2,
  glow = true,
  reducedMotion = false,
  phaseS = 0,
  className = '',
}: ShimmerRimProps) {
  const visible = useDocumentVisible();
  const vars = {
    '--bw-rim-w': `${width}px`,
    '--bw-rim-s': `${reducedMotion ? lapS * 2.4 : lapS}s`,
    '--bw-rim-o': reducedMotion ? 0.6 : 1,
    '--bw-rim-base': base,
    borderRadius: radius,
    animationDelay: `${phaseS}s`,
    // Hover rims are paused by the stylesheet until they are wanted.
    ...(trigger === 'always' ? { animationPlayState: visible ? 'running' : 'paused' } : null),
  } as CSSProperties;
  const inner = { borderRadius: radius, animationDelay: `${phaseS}s`, ...(trigger === 'always' ? { animationPlayState: vars.animationPlayState } : null) };
  return (
    <>
      <ChromeStyles />
      {glow && (
        <span className={`bw-rim-glow ${className}`} style={vars} data-trigger={trigger} aria-hidden>
          <span style={inner} />
        </span>
      )}
      <span className={`bw-rim ${className}`} style={vars} data-trigger={trigger} aria-hidden />
    </>
  );
}

const TINT: Record<'accent' | 'warm' | 'white', string> = {
  accent: 'var(--accent-rgb)',
  warm: '255,197,107',
  white: '255,255,255',
};

/**
 * The field behind the card. Fills its (positioned) parent; never takes a
 * pointer. `seed` picks this card's sky.
 */
export function CardField({ seed, reducedMotion }: { seed: string; reducedMotion: boolean }) {
  const visible = useDocumentVisible();
  const f = useMemo(() => cardFieldLayout(seed), [seed]);
  const still = reducedMotion;

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${visible ? '' : 'bw-field-paused'}`}
      aria-hidden
    >
      <ChromeStyles />
      {/* Crown of light above the card, a warm pool beneath it. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(70% 45% at 50% -6%, rgba(var(--accent-rgb),0.30) 0%, transparent 62%), radial-gradient(55% 30% at 50% 108%, rgba(255,197,107,0.12) 0%, transparent 70%)',
        }}
      />
      {/* Soft rays falling from the crown. */}
      <div
        className="absolute left-[-70%] top-[-12%] h-[115%] w-[240%]"
        style={{
          transformOrigin: '50% 0',
          background:
            'repeating-conic-gradient(from 90deg at 50% 0%, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.07) 1.4deg, rgba(255,255,255,0) 2.8deg, rgba(255,255,255,0) 6deg, rgba(var(--accent-rgb),0.09) 7.6deg, rgba(var(--accent-rgb),0) 9.2deg, rgba(255,255,255,0) 13deg)',
          WebkitMaskImage: 'radial-gradient(34% 62% at 50% 0%, #000 0%, rgba(0,0,0,0.5) 45%, transparent 100%)',
          maskImage: 'radial-gradient(34% 62% at 50% 0%, #000 0%, rgba(0,0,0,0.5) 45%, transparent 100%)',
          animation: still ? undefined : 'bw-rays 26s ease-in-out infinite alternate',
        }}
      />
      {/* Bokeh: half soft glows, half discs with the bright rim a real lens gives. */}
      {f.bokeh.map((b, i) => {
        const c = TINT[b.tint];
        const disc = i % 2 === 0;
        return (
          <div
            key={`b${i}`}
            className="absolute rounded-full"
            style={{
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: `${b.r * 2}vmin`,
              height: `${b.r * 2}vmin`,
              marginLeft: `${-b.r}vmin`,
              marginTop: `${-b.r}vmin`,
              opacity: b.opacity,
              background: disc
                ? `radial-gradient(circle, rgba(${c},0.32) 0%, rgba(${c},0.22) 58%, rgba(${c},0.55) 67%, rgba(${c},0) 71%)`
                : `radial-gradient(circle, rgba(${c},0.7) 0%, rgba(${c},0.18) 40%, rgba(${c},0) 70%)`,
              animation: still ? undefined : `bw-drift ${b.driftS}s ease-in-out ${b.delayS}s infinite`,
            }}
          />
        );
      })}
      {/* Constellation linework at the edges, framing the card. */}
      {/* Percent coordinates, no viewBox: strokes and dashes stay in real
          pixels at any aspect ratio. */}
      <svg className="absolute inset-0 h-full w-full">
        <g fill="none" strokeLinecap="round">
          {f.links.map(([a, b]) => {
            const p = f.stars[a];
            const q = f.stars[b];
            const ends = { x1: `${p.x}%`, y1: `${p.y}%`, x2: `${q.x}%`, y2: `${q.y}%` };
            return (
              <g key={`${a}-${b}`}>
                <line {...ends} stroke="rgba(255,255,255,0.2)" strokeWidth={0.75} />
                {!still && (
                  <line
                    {...ends}
                    pathLength={100}
                    strokeDasharray="16 84"
                    strokeWidth={1.5}
                    style={{
                      stroke: 'rgba(var(--accent-rgb),0.9)',
                      animation: `bw-line-run 6s linear ${p.twinkleDelayS}s infinite`,
                    }}
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {f.stars.map((s, i) => (
        <span
          key={`s${i}`}
          className="absolute rounded-full bg-white"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.r * 2,
            height: s.r * 2,
            marginLeft: -s.r,
            marginTop: -s.r,
            boxShadow: `0 0 ${4 + s.r * 4}px rgba(var(--accent-rgb),0.9)`,
            opacity: still ? 0.7 : undefined,
            animation: still ? undefined : `bw-twinkle 4.5s ease-in-out ${s.twinkleDelayS}s infinite`,
          }}
        />
      ))}
      {/* Vignette into the page colour, so the edges settle. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 42%, transparent 55%, color-mix(in srgb, var(--color-brand-bg) 55%, rgba(4,3,20,0.9)) 100%)',
          opacity: 0.55,
        }}
      />
    </div>
  );
}
