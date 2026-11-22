/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SceneLife — the paper cut-outs that move inside a design's scene (birds,
 * balloons, hot-air balloons, caps, fireworks, smoke, lantern light…).
 *
 * One SVG in the scene's own 900x1600 space, laid over the back art (so it
 * scales and drifts with it), and one rAF loop writing attributes — no React
 * render per frame. Where each piece is comes from the pure
 * lib/sceneLife.ts `lifePose`, so the film intro can draw the same motion.
 * Pauses while the tab is hidden; stops on unmount.
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { CardDesign } from '../../../lib/cardDesigns';
import { designLife, lifePose, type LifeProp } from '../../../lib/sceneLife';

export interface SceneLifeProps {
  design: CardDesign;
  reducedMotion: boolean;
  /** Seconds added to the clock, so a backdrop picks up where the opening left off. */
  offset?: number;
  className?: string;
}

interface Parts {
  g: SVGGElement | null;
  wings: SVGGElement | null;
  grow: SVGGElement | null;
}

const PAPER = 'drop-shadow(0 4px 3px rgba(0,0,0,0.32))';

function Piece({ p, i, design, parts }: { p: LifeProp; i: number; design: CardDesign; parts: Parts[] }) {
  const c = p.color ?? design.palette.accent;
  const c2 = p.color2 ?? '#FFF6E4';
  const set = (key: keyof Parts) => (el: SVGGElement | null) => {
    parts[i] = parts[i] ?? { g: null, wings: null, grow: null };
    parts[i][key] = el;
  };
  let body: ReactElement;
  switch (p.kind) {
    case 'bird':
      body = (
        <g ref={set('wings')} style={{ filter: PAPER }}>
          <path d="M0 0 C-8 -10 -20 -12 -30 -6 C-20 -6 -10 -2 0 4 Z" fill={c} />
          <path d="M0 0 C8 -10 20 -12 30 -6 C20 -6 10 -2 0 4 Z" fill={c} />
          <ellipse cx="0" cy="2" rx="5" ry="3.5" fill={c} />
        </g>
      );
      break;
    case 'hotair':
      body = (
        <g style={{ filter: PAPER }}>
          <path d="M0 -62 C40 -62 52 -28 44 -2 C38 18 18 30 10 44 L-10 44 C-18 30 -38 18 -44 -2 C-52 -28 -40 -62 0 -62 Z" fill={c} />
          <path d="M0 -62 C14 -50 16 -10 6 44 L-6 44 C-16 -10 -14 -50 0 -62 Z" fill={c2} opacity="0.9" />
          <path d="M-32 -46 C-44 -20 -30 20 -10 44" stroke={c2} strokeWidth="3" fill="none" opacity="0.7" />
          <path d="M32 -46 C44 -20 30 20 10 44" stroke={c2} strokeWidth="3" fill="none" opacity="0.7" />
          <path d="M-9 44 L-7 60 M9 44 L7 60" stroke="#7A5A3A" strokeWidth="1.6" />
          <rect x="-9" y="58" width="18" height="13" rx="2" fill="#B07A4A" />
        </g>
      );
      break;
    case 'balloon':
      body = (
        <g>
          <path d="M0 34 C-6 60 8 80 -2 112" stroke="rgba(255,255,255,0.75)" strokeWidth="1.5" fill="none" />
          <g style={{ filter: PAPER }}>
            <ellipse cx="0" cy="0" rx="26" ry="32" fill={c} />
            <path d="M-4 31 L4 31 L0 37 Z" fill={c} />
            <ellipse cx="-9" cy="-12" rx="6" ry="10" fill="rgba(255,255,255,0.35)" transform="rotate(-20 -9 -12)" />
          </g>
        </g>
      );
      break;
    case 'cloud':
      body = (
        <g style={{ filter: PAPER }}>
          <path d="M-90 20 C-100 -4 -74 -22 -54 -12 C-48 -40 -10 -46 4 -22 C16 -44 56 -40 60 -12 C84 -18 102 4 90 20 Z" fill={c} />
          <path d="M-90 20 L90 20 C80 28 -80 28 -90 20 Z" fill="rgba(0,0,0,0.08)" />
        </g>
      );
      break;
    case 'glint':
      body = (
        <g>
          <circle r="18" fill={`url(#life-glow-${design.id})`} />
          <path d="M0 -22 Q0 0 22 0 Q0 0 0 22 Q0 0 -22 0 Q0 0 0 -22 Z" fill={p.color ?? '#FFF6DA'} />
        </g>
      );
      break;
    case 'flicker':
      body = <circle r="42" fill={p.color ?? design.palette.glow} style={{ filter: 'blur(14px)', mixBlendMode: 'screen' }} />;
      break;
    case 'shootingStar':
      body = (
        <g>
          <g ref={set('grow')}>
            <rect x="-180" y="-1.5" width="180" height="3" rx="1.5" fill={`url(#life-tail-${design.id})`} />
          </g>
          <circle r="4" fill="#FFFFFF" />
        </g>
      );
      break;
    case 'firework':
      body = (
        <g ref={set('grow')} style={{ mixBlendMode: 'screen' }}>
          {Array.from({ length: 14 }, (_, k) => {
            const a = (k / 14) * Math.PI * 2;
            const x = Math.cos(a) * 70;
            const y = Math.sin(a) * 70;
            return (
              <g key={k}>
                <line x1={x * 0.3} y1={y * 0.3} x2={x} y2={y} stroke={c} strokeWidth="2.5" strokeLinecap="round" />
                <circle cx={x * 1.08} cy={y * 1.08} r="3.2" fill="#FFFFFF" />
              </g>
            );
          })}
        </g>
      );
      break;
    case 'cap':
      body = (
        <g style={{ filter: PAPER }}>
          <path d="M-20 0 L20 0 L18 14 L-18 14 Z" fill={c} />
          <path d="M0 -16 L40 0 L0 16 L-40 0 Z" fill={c} />
          <path d="M0 -16 L40 0 L0 16 L-40 0 Z" fill="rgba(255,255,255,0.12)" />
          <path d="M0 0 L26 8 L26 26" stroke="#E8C77A" strokeWidth="2" fill="none" />
          <circle cx="26" cy="28" r="3" fill="#E8C77A" />
        </g>
      );
      break;
    case 'smoke':
      body = <circle r="26" fill="rgba(255,255,255,0.8)" style={{ filter: 'blur(6px)' }} />;
      break;
    case 'rays':
      body = (
        <g style={{ mixBlendMode: 'screen' }}>
          {[-48, -30, -14, 0, 14, 30, 48].map((deg) => (
            <path
              key={deg}
              d="M-10 0 L10 0 L60 760 L-60 760 Z"
              fill={`url(#life-ray-${design.id})`}
              transform={`rotate(${deg})`}
            />
          ))}
        </g>
      );
      break;
    case 'shimmer':
      body = <ellipse rx="46" ry="3" fill={c} style={{ filter: 'blur(1px)', mixBlendMode: 'screen' }} />;
      break;
    default:
      body = <g />;
  }
  return (
    <g ref={set('g')} opacity={0}>
      {body}
    </g>
  );
}

export default function SceneLife({ design, reducedMotion, offset = 0, className = '' }: SceneLifeProps) {
  const props = useMemo(() => designLife(design.id), [design.id]);
  const partsRef = useRef<Parts[]>([]);
  const rayColor = props.find((p) => p.kind === 'rays')?.color ?? design.palette.glow;

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    let paused = 0;
    let hiddenAt = 0;
    const tick = (now: number) => {
      const t = (now - start - paused) / 1000 + offset;
      props.forEach((p, i) => {
        const part = partsRef.current[i];
        if (!part?.g) return;
        const q = lifePose(p, t, reducedMotion);
        part.g.setAttribute(
          'transform',
          `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) rotate(${q.rot.toFixed(2)}) scale(${q.scale.toFixed(3)})`,
        );
        part.g.setAttribute('opacity', q.opacity.toFixed(3));
        if (part.wings) part.wings.setAttribute('transform', `scale(1 ${(0.35 + 0.65 * Math.abs(q.flap)).toFixed(3)})`);
        if (part.grow) {
          if (p.kind === 'shootingStar') part.grow.setAttribute('transform', `scale(${q.grow.toFixed(3)} 1)`);
          else part.grow.setAttribute('transform', `scale(${Math.max(0.001, q.grow).toFixed(3)})`);
        }
      });
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        cancelAnimationFrame(raf);
        hiddenAt = performance.now();
      } else {
        if (hiddenAt) paused += performance.now() - hiddenAt;
        hiddenAt = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [props, reducedMotion, offset]);

  if (props.length === 0) return null;
  return (
    <svg
      aria-hidden
      viewBox="0 0 900 1600"
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 h-full w-full overflow-visible ${className}`}
      data-scene-life={design.id}
    >
      <defs>
        <radialGradient id={`life-glow-${design.id}`}>
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`life-tail-${design.id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id={`life-ray-${design.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={rayColor} stopOpacity="0.55" />
          <stop offset="1" stopColor={rayColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      {props.map((p, i) => (
        <Piece key={i} p={p} i={i} design={design} parts={partsRef.current} />
      ))}
    </svg>
  );
}
