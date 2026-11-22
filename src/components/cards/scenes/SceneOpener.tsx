/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SceneOpener — a design's cinematic opening (contract: reveals/types.ts).
 *
 * The recipient lands on the design's closed paper-cut gateway with a small
 * glass name plate. One tap and the gateway opens the design's own way
 * (doors swing in 3D, a cut-out grows, drapes glide apart, a balloon wall
 * lifts away), light pours through, the camera glides into the layered scene
 * while the foreground cut-outs drift past at their own depth, and the card's
 * title lands on a glass plate. Then onDone, and the card itself arrives over
 * the same scene (SceneBackdrop), so nothing jumps.
 *
 * Every pixel of motion is lib/cardDesigns.ts `sceneFrame(kind, t)` — the
 * same pure function the keepsake-film intro renders — written straight to
 * element styles from one rAF loop (no React re-render per frame).
 *
 * Performance: plain DOM + CSS transforms on four images (~300 KB a design,
 * webp, same-origin), one 2D particle canvas, an SVG mask only for the iris
 * kind. No WebGL, so it is a 'standard' option that works on every phone.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CardRevealProps } from '../reveals/types';
import {
  designAssets,
  irisPath,
  sceneFrame,
  SCENE_OPEN_MS,
  SCENE_OPEN_MS_REDUCED,
  type CardDesign,
  type SceneFrame,
} from '../../../lib/cardDesigns';
import { coverRecipientLine } from '../../../lib/cardTemplates';
import {
  newTrace,
  rimOutline,
  traceComplete,
  tracedPath,
  traceHint,
  traceLift,
  traceStep,
  type TraceState,
} from '../../../lib/traceOpen';
import MotifLayer from './MotifLayer';
import OpeningFx from './OpeningFx';
import { SceneStage, MidPair, decodeImages } from './sceneParts';
import SceneLife from './SceneLife';

/** Hold on the settled title plate before handing over to the card. */
const HOLD_MS = 650;
/** Never wait longer than this for art before opening anyway. */
const ART_TIMEOUT_MS = 2500;

export interface SceneOpenerProps extends CardRevealProps {
  design: CardDesign;
}

type Phase = 'loading' | 'closed' | 'opening' | 'done';

export default function SceneOpener({ card, design, reducedMotion, onDone }: SceneOpenerProps) {
  const assets = useMemo(() => designAssets(design.id), [design.id]);
  const kind = design.gateway.kind;
  const [phase, setPhase] = useState<Phase>('loading');
  const [motifOn, setMotifOn] = useState(0);

  // Element refs the rAF loop writes to.
  const backRef = useRef<HTMLDivElement | null>(null);
  const midRef = useRef<HTMLDivElement | null>(null);
  const gateRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const stripRefs = useRef<Array<HTMLDivElement | null>>([]);
  const irisRef = useRef<SVGPathElement | null>(null);
  const rimRef = useRef<SVGPathElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const plateRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(false);

  // Trace-to-open (iris designs): the finger runs round the carved rim.
  const traceShape = kind === 'iris' ? (design.gateway.shape ?? 'circle') : null;
  const outline = useMemo(() => (traceShape ? rimOutline(traceShape) : []), [traceShape]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tracedRef = useRef<SVGPathElement | null>(null);
  const sparkRef = useRef<SVGCircleElement | null>(null);
  const traceRef = useRef<TraceState>(newTrace(outline.length || undefined));
  const [tracing, setTracing] = useState(false);
  const [traceDone, setTraceDone] = useState(false);

  const apply = useCallback(
    (f: SceneFrame) => {
      const set = (el: HTMLElement | null, s: Partial<CSSStyleDeclaration>) => {
        if (el) Object.assign(el.style, s);
      };
      set(backRef.current, { transform: `translate3d(0, ${f.backY}%, 0) scale(${f.backScale})` });
      set(midRef.current, { transform: `translate3d(0, ${f.midY}%, 0) scale(${f.midScale})`, opacity: String(f.midOpacity) });
      set(gateRef.current, { transform: `scale(${f.gateScale})`, opacity: String(f.gateOpacity) });
      if (kind === 'doors') {
        set(leftRef.current, { transform: `rotateY(${-f.doorDeg}deg)` });
        set(rightRef.current, { transform: `rotateY(${f.doorDeg}deg)` });
      } else if (kind === 'slide') {
        set(leftRef.current, { transform: `translate3d(${-f.slidePct}%, 0, 0)` });
        set(rightRef.current, { transform: `translate3d(${f.slidePct}%, 0, 0)` });
      } else if (kind === 'rise') {
        stripRefs.current.forEach((el, i) => {
          const lag = i === 1 ? 0 : f.riseLagPct * (i === 0 ? 1 : 0.6);
          set(el, { transform: `translate3d(0, ${-(f.risePct - lag)}%, 0)` });
        });
      } else if (kind === 'iris') {
        const d = irisPath(design.gateway.shape ?? 'circle', f.irisR);
        irisRef.current?.setAttribute('d', d);
        // The carved rim shows the shape even before it opens.
        rimRef.current?.setAttribute('d', irisPath(design.gateway.shape ?? 'circle', Math.max(f.irisR, 0.16)));
      }
      set(glowRef.current, { opacity: String(f.glow) });
      set(plateRef.current, {
        opacity: String(f.plateOpacity),
        transform: `translate3d(0, ${f.plateY}px, 0) scale(${f.plateScale})`,
      });
    },
    [kind, design.gateway.shape],
  );

  // Load the art: show the gateway as soon as IT is ready; the scene behind
  // keeps loading while the recipient reads the name plate.
  useEffect(() => {
    let alive = true;
    decodeImages([assets.gate], ART_TIMEOUT_MS).then(() => {
      if (alive) setPhase((p) => (p === 'loading' ? 'closed' : p));
    });
    return () => {
      alive = false;
    };
  }, [assets.gate]);

  // Paint frame 0 before anything moves.
  useEffect(() => {
    apply(sceneFrame(kind, 0, reducedMotion));
  }, [apply, kind, reducedMotion, phase]);

  const open = useCallback(async () => {
    if (phase !== 'closed') return;
    setPhase('opening');
    await decodeImages([assets.back, assets.mid], ART_TIMEOUT_MS);
    const total = reducedMotion ? SCENE_OPEN_MS_REDUCED : SCENE_OPEN_MS;
    const start = performance.now();
    setMotifOn(1);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / total);
      apply(sceneFrame(kind, t, reducedMotion));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        if (doneRef.current) return;
        doneRef.current = true;
        setPhase('done');
        onDone();
      }, HOLD_MS);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [phase, assets.back, assets.mid, reducedMotion, apply, kind, onDone]);

  /** Pointer → the 900x1600 stage space the rim is drawn in. */
  const toStage = useCallback((e: React.PointerEvent) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  }, []);

  const onTraceMove = useCallback(
    (e: React.PointerEvent) => {
      if (!traceShape || phase !== 'closed' || traceDone) return;
      if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType === 'mouse') return;
      const p = toStage(e);
      if (!p) return;
      const next = traceStep(traceRef.current, outline, p);
      if (sparkRef.current) {
        sparkRef.current.setAttribute('cx', String(p.x));
        sparkRef.current.setAttribute('cy', String(p.y));
        sparkRef.current.style.opacity = next.last === null ? '0.35' : '1';
      }
      if (next === traceRef.current) return;
      traceRef.current = next;
      tracedRef.current?.setAttribute('d', tracedPath(outline, next));
      if (traceComplete(next)) {
        setTraceDone(true);
        // Close the loop on screen, a small tick in the hand, then open.
        tracedRef.current?.setAttribute('d', tracedPath(outline, { covered: next.covered.map(() => true), last: null }));
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(18);
          } catch {
            /* not allowed here: the light is enough */
          }
        }
        timerRef.current = window.setTimeout(() => void open(), reducedMotion ? 120 : 380);
      }
    },
    [traceShape, phase, traceDone, toStage, outline, open, reducedMotion],
  );

  const onTraceDown = useCallback(
    (e: React.PointerEvent) => {
      if (!traceShape || phase !== 'closed') return;
      if ((e.target as HTMLElement).closest('button')) return;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
      setTracing(true);
      onTraceMove(e);
    },
    [traceShape, phase, onTraceMove],
  );

  const onTraceUp = useCallback(() => {
    traceRef.current = traceLift(traceRef.current);
    if (sparkRef.current) sparkRef.current.style.opacity = '0';
  }, []);

  const rafRef = useRef(0);
  const timerRef = useRef(0);
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  const forLine = coverRecipientLine(null, card.recipientName);
  const gateBg: CSSProperties = { backgroundImage: `url(${assets.gate})`, backgroundRepeat: 'no-repeat' };
  const closed = phase === 'loading' || phase === 'closed';

  return (
    <SceneStage design={design} backUrl={assets.back} data-scene-phase={phase}>
      {/* The scene behind the gateway */}
      <div ref={backRef} className="absolute inset-0 will-change-transform" style={{ transformOrigin: '50% 55%' }}>
        <img src={assets.back} alt="" draggable={false} className="h-full w-full object-cover" />
        <SceneLife design={design} reducedMotion={reducedMotion} />
      </div>
      <div ref={midRef} className="absolute inset-0 will-change-transform" style={{ transformOrigin: '50% 100%', opacity: 0 }}>
        <MidPair src={assets.mid} design={design} />
      </div>
      <MotifLayer
        kind={design.motif.kind}
        colors={design.motif.colors}
        seed={`${design.id}|${card.title}`}
        reducedMotion={reducedMotion}
        intensity={motifOn}
      />

      {/* Light pouring through the opening */}
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0,
          background: `radial-gradient(ellipse 55% 45% at 50% 48%, ${design.palette.glow} 0%, ${design.palette.glow}99 30%, transparent 72%)`,
          mixBlendMode: 'screen',
        }}
      />

      {/* The gateway */}
      <div
        ref={gateRef}
        aria-hidden
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          perspective: kind === 'doors' ? '1300px' : undefined,
          transformOrigin: '50% 50%',
          visibility: phase === 'loading' ? 'hidden' : undefined,
        }}
      >
        {(kind === 'doors' || kind === 'slide') && (
          <>
            <div
              ref={leftRef}
              className="absolute inset-y-0 left-0 w-1/2 will-change-transform"
              style={{
                ...gateBg,
                backgroundSize: '200% 100%',
                backgroundPosition: '0% 50%',
                transformOrigin: '0% 50%',
                backfaceVisibility: 'hidden',
                boxShadow: 'inset -14px 0 24px -16px rgba(0,0,0,0.55)',
              }}
            />
            <div
              ref={rightRef}
              className="absolute inset-y-0 right-0 w-1/2 will-change-transform"
              style={{
                ...gateBg,
                backgroundSize: '200% 100%',
                backgroundPosition: '100% 50%',
                transformOrigin: '100% 50%',
                backfaceVisibility: 'hidden',
                boxShadow: 'inset 14px 0 24px -16px rgba(0,0,0,0.55)',
              }}
            />
          </>
        )}
        {kind === 'rise' &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              ref={(el) => {
                stripRefs.current[i] = el;
              }}
              className="absolute inset-y-0 will-change-transform"
              style={{
                ...gateBg,
                left: `${(i * 100) / 3}%`,
                width: `${100 / 3 + 0.4}%`,
                backgroundSize: '300% 100%',
                backgroundPosition: `${i * 50}% 50%`,
              }}
            />
          ))}
        {kind === 'iris' && (
          <svg ref={svgRef} viewBox="0 0 900 1600" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
            <defs>
              <mask id={`iris-${design.id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="1600">
                <rect width="900" height="1600" fill="white" />
                <path ref={irisRef} d={irisPath(design.gateway.shape ?? 'circle', 0)} fill="black" />
              </mask>
              <filter id={`rim-${design.id}`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.45" />
              </filter>
            </defs>
            <image
              href={assets.gate}
              width="900"
              height="1600"
              preserveAspectRatio="xMidYMid slice"
              mask={`url(#iris-${design.id})`}
            />
            <path
              ref={rimRef}
              d={irisPath(design.gateway.shape ?? 'circle', 0.16)}
              fill="none"
              stroke={design.palette.accent}
              strokeWidth="5"
              strokeOpacity="0.85"
              filter={`url(#rim-${design.id})`}
            />
            {traceShape && phase === 'closed' && (
              <g aria-hidden>
                {/* The guide: a soft dotted line over the rim, and (until the
                    first touch) a glowing bead tracing it to show the way. */}
                <path
                  d={irisPath(traceShape, 0.16)}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeOpacity={tracing ? 0.35 : 0.6}
                  strokeWidth="3"
                  strokeDasharray="2 16"
                  strokeLinecap="round"
                  className="transition-[stroke-opacity] duration-500"
                />
                {!tracing && !reducedMotion && (
                  <circle r="11" fill="#FFFFFF" style={{ filter: `drop-shadow(0 0 10px ${design.palette.glow})` }}>
                    <animateMotion dur="3.6s" repeatCount="indefinite" path={irisPath(traceShape, 0.16)} />
                  </circle>
                )}
                <path
                  ref={tracedRef}
                  d=""
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 0 8px ${design.palette.glow}) drop-shadow(0 0 22px ${design.palette.accent})` }}
                />
                <circle
                  ref={sparkRef}
                  r="16"
                  fill="#FFFFFF"
                  style={{ opacity: 0, filter: `drop-shadow(0 0 14px ${design.palette.glow})`, transition: 'opacity 200ms' }}
                />
              </g>
            )}
          </svg>
        )}
      </div>

      {/* The design's own flourish as it opens (petals, frost, confetti…) */}
      <OpeningFx
        design={design}
        seed={`${design.id}|${card.title}`}
        reducedMotion={reducedMotion}
        playing={phase === 'opening' || phase === 'done'}
      />

      {/* The title plate the opening lands on */}
      <div className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center px-6">
        <div
          ref={plateRef}
          className="liquid-glass max-w-[22rem] rounded-[2rem] px-7 py-6 text-center"
          style={{ opacity: 0, boxShadow: `0 0 0 1px rgba(${design.palette.accentRgb},0.45), 0 30px 80px -30px rgba(0,0,0,0.6)` }}
        >
          <p className="font-serif text-[clamp(1.6rem,7.5vw,2.4rem)] leading-[1.1] text-white [text-wrap:balance]">{card.title}</p>
        </div>
      </div>

      {/* Before the tap: the name plate and the button */}
      {closed && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-between px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[22%]"
          style={traceShape ? { touchAction: 'none' } : undefined}
          onPointerDown={traceShape ? onTraceDown : undefined}
          onPointerMove={traceShape ? onTraceMove : undefined}
          onPointerUp={traceShape ? onTraceUp : undefined}
          onPointerCancel={traceShape ? onTraceUp : undefined}
          data-trace={traceShape ?? undefined}
        >
          <div
            className="liquid-glass rounded-full px-6 py-3 text-center transition-opacity duration-500"
            style={{ opacity: phase === 'closed' ? 1 : 0, boxShadow: `0 0 0 1px rgba(${design.palette.accentRgb},0.5)` }}
          >
            {forLine ? (
              <p className="font-serif text-[clamp(1.2rem,5.4vw,1.6rem)] leading-tight text-white">{forLine.replace(/^for /, 'For ')}</p>
            ) : (
              <p className="font-serif text-[clamp(1.2rem,5.4vw,1.6rem)] leading-tight text-white">{card.title}</p>
            )}
          </div>
{traceShape ? (
            <div className="flex flex-col items-center gap-2">
              <p
                role="status"
                className="liquid-glass rounded-full px-5 py-2.5 text-center font-sans text-[15px] font-semibold text-white"
                style={{ boxShadow: `0 0 0 1px rgba(${design.palette.accentRgb},0.55), 0 0 30px -8px rgba(${design.palette.accentRgb},0.8)` }}
              >
                {phase === 'loading' ? 'Getting it ready…' : traceDone ? 'Opening…' : traceHint(traceShape)}
              </p>
              {/* Keyboard, switch and screen-reader users (and anyone in a
                  hurry) open it with one press, as before. */}
              <button
                type="button"
                onClick={open}
                disabled={phase !== 'closed'}
                autoFocus
                className="min-h-[44px] rounded-full bg-black/25 px-4 font-sans text-[13px] font-medium text-white/90 underline decoration-white/40 underline-offset-4 backdrop-blur-sm transition hover:text-white disabled:opacity-60"
              >
                Or tap here to open
              </button>
            </div>
          ) : (
                      <button
              type="button"
              onClick={open}
              disabled={phase !== 'closed'}
              autoFocus
              className="bw-cta liquid-glass-raised flex min-h-[52px] items-center gap-2 rounded-full px-7 font-sans text-[15px] font-semibold text-white transition disabled:opacity-60"
              style={{ boxShadow: `0 0 0 1px rgba(${design.palette.accentRgb},0.65), 0 0 36px -6px rgba(${design.palette.accentRgb},0.85)` }}
            >
              {phase === 'loading' ? 'Getting it ready…' : 'Tap to open'}
            </button>
          )}
        </div>
      )}
    </SceneStage>
  );
}
