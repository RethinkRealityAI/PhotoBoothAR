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
  traceLift,
  traceStep,
  type TraceState,
} from '../../../lib/traceOpen';
import { DESIGN_DISSOLVE } from '../../../lib/openingFx';
import {
  gestureFor,
  holdDrain,
  holdProgress,
  holdT,
  OPEN_HINT,
  pullOpens,
  pullProgress,
  pullSettle,
  pullT,
} from '../../../lib/openGesture';
import MotifLayer from './MotifLayer';
import OpeningFx from './OpeningFx';
import GateDissolve from './GateDissolve';
import LiveGate from './LiveGate';
import { LIVE_SEED } from '../../../lib/liveGates';
import { SceneStage, MidPair, decodeImages } from './sceneParts';
import SceneLife from './SceneLife';

/** Hold on the settled title plate before handing over to the card. */
const PLATE_HOLD_MS = 650;
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
  const dissolve = DESIGN_DISSOLVE[design.id] ?? null;
  const dissolvingRef = useRef(false);

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
      set(gateRef.current, {
        transform: `scale(${f.gateScale})`,
        // A dissolving gate is carried away by its canvas, not moved.
        opacity: dissolvingRef.current ? '0' : String(f.gateOpacity),
      });
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

  /** Timeline position the live gate reads (it animates its own pieces from it). */
  const tRef = useRef(0);
  const applyT = useCallback(
    (t: number) => {
      tRef.current = t;
      apply(sceneFrame(kind, t, reducedMotion));
    },
    [apply, kind, reducedMotion],
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
  // Only while closed: once opening, a hold or pull has already moved the gate
  // and snapping it back to 0 for a frame would flicker.
  useEffect(() => {
    if (phase === 'loading' || phase === 'closed') applyT(0);
  }, [applyT, phase]);

  /** Open, carrying on from wherever a gesture already pushed the gate (0 = closed). */
  const open = useCallback(async (from: unknown = 0) => {
    if (phase !== 'closed') return;
    const fromT = typeof from === 'number' && Number.isFinite(from) ? Math.max(0, Math.min(0.9, from)) : 0;
    cancelAnimationFrame(gestureRaf.current);
    if (dissolve) {
      dissolvingRef.current = true;
      // The canvas already shows this exact gate: hide the DOM one now, so
      // nothing shows through the holes while the scene art finishes decoding.
      if (gateRef.current) gateRef.current.style.opacity = '0';
    }
    setPhase('opening');
    await decodeImages([assets.back, assets.mid], ART_TIMEOUT_MS);
    const total = reducedMotion ? SCENE_OPEN_MS_REDUCED : SCENE_OPEN_MS;
    const start = performance.now() - fromT * total;
    setMotifOn(1);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / total);
      applyT(t);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        if (doneRef.current) return;
        doneRef.current = true;
        setPhase('done');
        onDone();
      }, PLATE_HOLD_MS);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [phase, assets.back, assets.mid, reducedMotion, apply, kind, onDone, dissolve]);

  // --- Hold (doors, seals, lifting walls) and pull (drapes, leaves) -------
  const gesture = gestureFor(design.id);
  const gestureRaf = useRef(0);
  const ringRef = useRef<SVGCircleElement | null>(null);
  const holdRef = useRef({ down: false, start: 0, releasedAt: 0, fromP: 0, p: 0 });
  const [holdState, setHoldState] = useState<'idle' | 'holding' | 'short' | 'done'>('idle');
  /** Hold progress for the dissolve to react to (OpeningFx reads it per frame). */
  const chargeRef = useRef(0);

  const buzz = (pattern: number | number[]) => {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* not allowed here: the light carries it */
    }
  };

  const paintHold = useCallback(
    (p: number) => {
      chargeRef.current = p;
      ringRef.current?.style.setProperty('stroke-dashoffset', String(1 - p));
      applyT(holdT(p));
    },
    [apply, kind, reducedMotion],
  );

  const holdLoop = useCallback(() => {
    const h = holdRef.current;
    const now = performance.now();
    const p = h.down ? Math.min(1, h.fromP + holdProgress(now - h.start)) : holdDrain(h.fromP, now - h.releasedAt);
    h.p = p;
    paintHold(p);
    if (h.down && p >= 1) {
      h.down = false;
      setHoldState('done');
      buzz([16, 50, 26]);
      void open(holdT(1));
      return;
    }
    if (h.down || p > 0) gestureRaf.current = requestAnimationFrame(holdLoop);
  }, [paintHold, open]);

  const onHoldDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (phase !== 'closed' || holdState === 'done') return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
      const h = holdRef.current;
      h.down = true;
      h.fromP = h.p; // a re-press picks up from what has not drained yet
      h.start = performance.now();
      setHoldState('holding');
      buzz(8);
      cancelAnimationFrame(gestureRaf.current);
      gestureRaf.current = requestAnimationFrame(holdLoop);
    },
    [phase, holdState, holdLoop],
  );

  const onHoldUp = useCallback(() => {
    const h = holdRef.current;
    if (!h.down) return;
    h.down = false;
    h.fromP = h.p;
    h.releasedAt = performance.now();
    setHoldState('short');
  }, []);

  const pullRef = useRef({ down: false, x0: 0, width: 1, p: 0, base: 0 });
  const [pulling, setPulling] = useState(false);

  const onPullDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (phase !== 'closed') return;
      if ((e.target as HTMLElement).closest('button')) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
      cancelAnimationFrame(gestureRaf.current);
      const r = pullRef.current;
      r.down = true;
      r.x0 = e.clientX;
      r.base = r.p; // grabbing it while it settles back carries on from there
      r.width = e.currentTarget.getBoundingClientRect().width || 1;
      setPulling(true);
    },
    [phase],
  );

  const onPullMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = pullRef.current;
      if (!r.down || phase !== 'closed') return;
      r.p = Math.min(1, r.base + pullProgress(e.clientX - r.x0, r.width));
      applyT(pullT(r.p));
    },
    [phase, apply, kind, reducedMotion],
  );

  const onPullUp = useCallback(() => {
    const r = pullRef.current;
    if (!r.down) return;
    r.down = false;
    setPulling(false);
    if (pullOpens(r.p)) {
      buzz(14);
      void open(pullT(r.p));
      return;
    }
    const from = r.p;
    const t0 = performance.now();
    const settle = (now: number) => {
      r.p = pullSettle(from, now - t0);
      applyT(pullT(r.p));
      if (r.p > 0) gestureRaf.current = requestAnimationFrame(settle);
    };
    gestureRaf.current = requestAnimationFrame(settle);
  }, [open, apply, kind, reducedMotion]);

  useEffect(() => () => cancelAnimationFrame(gestureRaf.current), []);

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
        {!design.live && (kind === 'doors' || kind === 'slide') && (
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
        {!design.live && kind === 'rise' &&
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
        {design.live && (
          <LiveGate kind={design.live} seed={LIVE_SEED} tRef={tRef} chargeRef={chargeRef} reducedMotion={reducedMotion} />
        )}
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

      {/* Designs whose gate turns into the occasion (petals, confetti, gold, a burn) */}
      {dissolve && (
        <GateDissolve
          design={design}
          dissolve={dissolve}
          gateSrc={assets.gate}
          seed={`${design.id}|${card.title}`}
          chargeRef={chargeRef}
          playing={phase === 'opening' || phase === 'done'}
          reducedMotion={reducedMotion}
        />
      )}

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
          style={traceShape || gesture === 'pull' ? { touchAction: 'none' } : undefined}
          onPointerDown={traceShape ? onTraceDown : gesture === 'pull' ? onPullDown : undefined}
          onPointerMove={traceShape ? onTraceMove : gesture === 'pull' ? onPullMove : undefined}
          onPointerUp={traceShape ? onTraceUp : gesture === 'pull' ? onPullUp : undefined}
          onPointerCancel={traceShape ? onTraceUp : gesture === 'pull' ? onPullUp : undefined}
          data-gesture={gesture}
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
{gesture === 'hold' && (
            <HoldSeal
              ringRef={ringRef}
              accentRgb={design.palette.accentRgb}
              glow={design.palette.glow}
              state={holdState}
              disabled={phase !== 'closed'}
              reducedMotion={reducedMotion}
              onPointerDown={onHoldDown}
              onPointerUp={onHoldUp}
              onKeyOpen={() => void open()}
            />
          )}
          <div className="flex flex-col items-center gap-2">
            <p
              role="status"
              className="liquid-glass flex items-center gap-2 rounded-full px-5 py-2.5 text-center font-sans text-[15px] font-semibold text-white"
              style={{ boxShadow: `0 0 0 1px rgba(${design.palette.accentRgb},0.55), 0 0 30px -8px rgba(${design.palette.accentRgb},0.8)` }}
            >
              {gesture === 'pull' && phase === 'closed' && <PullArrow dir="left" still={reducedMotion || pulling} />}
              <span>
                {phase === 'loading'
                  ? 'Getting it ready…'
                  : traceDone || holdState === 'done'
                    ? 'Opening…'
                    : holdState === 'holding'
                      ? 'Keep holding…'
                      : holdState === 'short'
                        ? 'Hold a little longer'
                        : OPEN_HINT[design.id]}
              </span>
              {gesture === 'pull' && phase === 'closed' && <PullArrow dir="right" still={reducedMotion || pulling} />}
            </p>
            {/* Keyboard, switch and screen-reader users (and anyone in a
                hurry) open it with one press. The hold seal is itself that
                button for keys (Enter / Space open at once). */}
            {gesture !== 'hold' && (
              <button
                type="button"
                onClick={open}
                disabled={phase !== 'closed'}
                autoFocus
                className="min-h-[44px] rounded-full bg-black/25 px-4 font-sans text-[13px] font-medium text-white/90 underline decoration-white/40 underline-offset-4 backdrop-blur-sm transition hover:text-white disabled:opacity-60"
              >
                Or tap here to open
              </button>
            )}
          </div>
        </div>
      )}
    </SceneStage>
  );
}

/** The seal in the middle of a closed door or wall: press and hold it. */
function HoldSeal({
  ringRef,
  accentRgb,
  glow,
  state,
  disabled,
  reducedMotion,
  onPointerDown,
  onPointerUp,
  onKeyOpen,
}: {
  ringRef: React.MutableRefObject<SVGCircleElement | null>;
  accentRgb: string;
  glow: string;
  state: 'idle' | 'holding' | 'short' | 'done';
  disabled: boolean;
  reducedMotion: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onKeyOpen: () => void;
}) {
  const pressed = state === 'holding';
  return (
    <button
      type="button"
      aria-label="Hold to open (or press Enter)"
      disabled={disabled}
      autoFocus
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        // A pointer press is the hold; only keys (detail 0) open at once.
        if (e.detail === 0) onKeyOpen();
      }}
      className="absolute left-1/2 top-[47.5%] grid h-[92px] w-[92px] -translate-x-1/2 -translate-y-1/2 select-none place-items-center rounded-full outline-none [-webkit-touch-callout:none] [-webkit-user-select:none] focus-visible:ring-2 focus-visible:ring-white/80"
      style={{ touchAction: 'none' }}
      data-hold-state={state}
    >
      {/* Breathing halo while it waits; brighter while held. */}
      <span
        aria-hidden
        className={`absolute inset-0 rounded-full ${reducedMotion || pressed || state === 'done' ? '' : 'seal-breathe'}`}
        style={{
          background: `radial-gradient(circle, ${glow}AA 0%, ${glow}33 45%, transparent 70%)`,
          transform: pressed ? 'scale(1.35)' : 'scale(1.1)',
          transition: 'transform 600ms cubic-bezier(0.16,1,0.3,1)',
        }}
      />
      <span
        aria-hidden
        className="liquid-glass-raised absolute inset-[14px] rounded-full transition-transform duration-300"
        style={{
          transform: pressed ? 'scale(0.92)' : 'scale(1)',
          boxShadow: `0 0 0 1.5px rgba(${accentRgb},0.75), 0 0 28px -4px rgba(${accentRgb},0.9)`,
        }}
      />
      {/* The ring of light that fills as it is held (pathLength 1: offset 1 → 0). */}
      <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
        <circle
          ref={ringRef}
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="4"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          style={{ strokeDashoffset: 1, filter: `drop-shadow(0 0 6px ${glow})` }}
        />
      </svg>
      {state === 'done' && !reducedMotion && (
        <span aria-hidden className="seal-burst absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 3px ${glow}` }} />
      )}
      {/* A four-point star: the seal's mark. */}
      <svg aria-hidden viewBox="-12 -12 24 24" className="relative h-7 w-7">
        <path d="M0 -11 Q1.4 -1.4 11 0 Q1.4 1.4 0 11 Q-1.4 1.4 -11 0 Q-1.4 -1.4 0 -11Z" fill="#FFFFFF" />
      </svg>
    </button>
  );
}

/** A chevron nudging outwards: "pull this way". */
function PullArrow({ dir, still }: { dir: 'left' | 'right'; still: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className={`h-3.5 w-3.5 ${still ? '' : dir === 'left' ? 'pull-nudge-left' : 'pull-nudge-right'}`}
    >
      <path d={dir === 'left' ? 'M8 2 L4 6 L8 10' : 'M4 2 L8 6 L4 10'} fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
