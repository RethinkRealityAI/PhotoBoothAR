/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RevealExperience — Beamy guards the news until the reader unlocks it.
 *
 *   live     /reveal/:slug and /reveal/demo/:occasion
 *   preview  the admin editor's iframe (/reveal/preview): replay / open keys
 *   poster   ?poster=1: the email's hero still (sealed, no text, no motion;
 *            sets <html data-reveal-ready="1"> once Beamy is standing)
 *
 * The geometry and the phase machine are pure (lib/reveals/revealScene), the
 * unlock maths too (lib/reveals/revealUnlock); this wires pointer and key
 * events to them and drives Beamy (BeamyLayer) and the effects. Every unlock
 * also opens with "Just show me" (keyboard, switch access, a hurry).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { THEME_PALETTES, UNLOCK_META, type RevealDoc } from '../../lib/reveals/revealModel';
import {
  beamyOutline,
  beamyTraceProgress,
  beamyTraceStep,
  holdCharge,
  HOLD_FULL_MS,
  isHoldUnlock,
  newBeamyTrace,
  newTurn,
  tapProgress,
  turnLift,
  turnProgress,
  turnStep,
  type TraceState,
  type TurnState,
} from '../../lib/reveals/revealUnlock';
import { traceLift } from '../../lib/traceOpen';
import {
  GREETING_MS,
  initialRevealState,
  lineText,
  OPENING_MS,
  OPENING_MS_REDUCED,
  POSTER_SETTLE_MS,
  revealLayout,
  revealReducer,
  type RevealMode,
  type Rect,
} from '../../lib/reveals/revealScene';
import BeamyLayer, { type BeamyCtl } from './BeamyLayer';
import FxCanvas, { type FxShot } from './FxCanvas';
import { Ornaments, SpeechBubble } from './Ornaments';
import RevealCard from './RevealCard';
import { CrystalBox, IceCover, RubCover, ShineCover, VaultPanel } from './SealedObject';
import './reveals.css';

export interface RevealExperienceProps {
  doc: RevealDoc;
  mode: RevealMode;
  /** Bump to restart sealed (the editor's replay, or a new unlock / theme). */
  replayKey?: number;
  /** Bump to jump straight to the revealed card (the editor's "open"). */
  openKey?: number;
}

function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Deterministic backdrop motes. */
function useMotes() {
  return useMemo(() => {
    let s = 7;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    return Array.from({ length: 46 }, (_, i) => ({
      left: rand() * 100,
      top: rand() * 100,
      size: 1.5 + rand() * 2.5,
      d: 4 + rand() * 5,
      delay: -rand() * 8,
      warm: i % 7 === 0,
    }));
  }, []);
}

export default function RevealExperience({ doc, mode, replayKey = 0, openKey = 0 }: RevealExperienceProps) {
  const poster = mode === 'poster';
  const vp = useViewport();
  const reduced = useReducedMotion() || poster;
  const palette = THEME_PALETTES[doc.theme];
  const meta = UNLOCK_META[doc.unlock];
  const unlock = doc.unlock;
  const [state, dispatch] = useReducer(revealReducer, undefined, () => initialRevealState(0, poster));
  const phase = state.phase;
  const sealed = phase === 'sealed' || phase === 'arriving';
  const layout = revealLayout(vp.w, vp.h, mode, phase, unlock);
  const motes = useMotes();
  const ctl = useRef<BeamyCtl | null>(null);
  const [beamyReady, setBeamyReady] = useState(false);
  const arrivedOnce = useRef(poster);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  /* ── Per-run unlock state ─────────────────────────────────────── */
  const [taps, setTaps] = useState(0);
  const [charge, setCharge] = useState(0);
  const chargeRef = useRef(0);
  const [pressed, setPressed] = useState(false);
  const pressedRef = useRef(false);
  const turnRef = useRef<TurnState>(newTurn());
  const [angle, setAngle] = useState(0);
  const [trace, setTrace] = useState<TraceState>(() => newBeamyTrace());
  const traceRef = useRef<TraceState>(trace);
  const [charging, setCharging] = useState(false);
  const blastBusy = useRef(false);
  const [shots, setShots] = useState<FxShot[]>([]);
  const lastFace = useRef(0);
  const lastTick = useRef(0);
  const litBins = useRef(0);

  const resetLocal = useCallback(() => {
    setTaps(0);
    setCharge(0);
    chargeRef.current = 0;
    setPressed(false);
    pressedRef.current = false;
    turnRef.current = newTurn();
    setAngle(0);
    traceRef.current = newBeamyTrace();
    setTrace(traceRef.current);
    setCharging(false);
    blastBusy.current = false;
    setShots([]);
    litBins.current = 0;
    ctl.current?.tint(null);
    ctl.current?.face(null);
  }, []);

  /* Restart (editor replay / new unlock) and jump (editor open). */
  const firstReplay = useRef(replayKey);
  useEffect(() => {
    if (replayKey === firstReplay.current) return;
    firstReplay.current = replayKey;
    resetLocal();
    dispatch({ type: 'restart' });
  }, [replayKey, resetLocal]);
  const firstOpen = useRef(openKey);
  useEffect(() => {
    if (openKey === firstOpen.current) return;
    firstOpen.current = openKey;
    ctl.current?.tint(null);
    dispatch({ type: 'jump' });
  }, [openKey]);

  /* ── Arrival, greeting, hint ──────────────────────────────────── */
  useEffect(() => {
    if (!beamyReady || poster) return;
    if (!arrivedOnce.current) {
      arrivedOnce.current = true;
      void ctl.current?.arrive().then(() => {
        if (phaseRef.current === 'arriving') dispatch({ type: 'arrived' });
      });
      return;
    }
    if (phase === 'arriving') {
      const t = window.setTimeout(() => dispatch({ type: 'arrived' }), reduced ? 0 : 350);
      return () => window.clearTimeout(t);
    }
  }, [beamyReady, phase, poster, reduced, state.run]);

  useEffect(() => {
    if (state.line !== 'greeting' || phase !== 'sealed') return;
    const t = window.setTimeout(() => dispatch({ type: 'hint' }), GREETING_MS);
    return () => window.clearTimeout(t);
  }, [state.line, phase, state.run]);

  /* Poster: mark ready once Beamy is standing. */
  useEffect(() => {
    if (!poster || !beamyReady) return;
    const t = window.setTimeout(() => { document.documentElement.dataset.revealReady = '1'; }, POSTER_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [poster, beamyReady]);
  useEffect(() => () => { delete document.documentElement.dataset.revealReady; }, []);

  /* ── Opening: effects, Beamy's dance, then the card ──────────── */
  useEffect(() => {
    if (phase !== 'opening') return;
    const sealedL = revealLayout(vp.w, vp.h, mode, 'sealed', unlock);
    const next: FxShot[] = [];
    const key = Date.now();
    if (unlock === 'blast') next.push({ key, kind: 'shards', rect: sealedL.slot });
    next.push({ key: key + 1, kind: 'celebrate', rect: sealedL.slot });
    setShots(next);
    setPressed(false);
    pressedRef.current = false;
    const c = ctl.current;
    c?.tint(null);
    c?.face(null);
    c?.sparkle('burst');
    if (!(unlock === 'blast' && state.openedBy === 'gesture')) {
      c?.play(reduced ? 'Hop' : 'Dance');
      if (!reduced) c?.spin();
    }
    try { navigator.vibrate?.(30); } catch { /* no haptics */ }
    const t = window.setTimeout(() => dispatch({ type: 'opened' }), reduced ? OPENING_MS_REDUCED : OPENING_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [phase, state.run]);

  /* ── Hold (melt, shine) ───────────────────────────────────────── */
  useEffect(() => {
    if (!isHoldUnlock(unlock) || !sealed || poster) return;
    const full = HOLD_FULL_MS[unlock];
    let raf = 0;
    let last = performance.now();
    let shown = chargeRef.current;
    const frame = (now: number) => {
      const c = holdCharge(chargeRef.current, now - last, pressedRef.current, full);
      last = now;
      chargeRef.current = c;
      if (Math.abs(c - shown) >= 0.006 || (c === 0 && shown !== 0) || c === 1) {
        shown = c;
        setCharge(c);
        dispatch({ type: 'progress', value: c });
      }
      if (c < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [unlock, sealed, poster, state.run]);

  // While held: melt = his warm beam on the ice; shine = he glows and sparkles.
  useEffect(() => {
    if (!pressed || !sealed) return;
    const c = ctl.current;
    if (unlock === 'shine') {
      c?.tint(palette.core);
      const iv = window.setInterval(() => ctl.current?.sparkle('sparkle'), 420);
      return () => { window.clearInterval(iv); ctl.current?.tint(null); };
    }
    if (unlock === 'melt') {
      let alive = true;
      const loop = async () => {
        while (alive && pressedRef.current) {
          const s = layoutRef.current.slot;
          await ctl.current?.zap({ x: s.x + s.w / 2, y: s.y + s.h * 0.62 }, 520);
          if (!ctl.current) break;
        }
      };
      void loop();
      return () => { alive = false; };
    }
  }, [pressed, sealed, unlock, palette.core]);

  const press = (on: boolean) => {
    if (on && (!sealed || poster)) return;
    if (pressedRef.current === on) return;
    pressedRef.current = on;
    setPressed(on);
  };

  /* ── Tap / blast on Beamy ─────────────────────────────────────── */
  const onBeamy = () => {
    const c = ctl.current;
    if (phase === 'revealed') {
      c?.play('Hop');
      c?.sparkle('sparkle');
      return;
    }
    if (!sealed) return;
    if (unlock === 'tap') {
      const n = taps + 1;
      setTaps(n);
      c?.play('Hop');
      c?.sparkle(n % 3 === 0 ? 'burst' : 'sparkle');
      if (n % 3 === 0 && !reduced) c?.spin();
      dispatch({ type: 'progress', value: tapProgress(n, doc.taps) });
      return;
    }
    if (unlock === 'blast') {
      if (blastBusy.current) return;
      blastBusy.current = true;
      setCharging(true);
      dispatch({ type: 'progress', value: 0.5 });
      const target = center(layoutRef.current.slot);
      const fire = () => {
        setCharging(false);
        dispatch({ type: 'open', by: 'gesture' });
      };
      if (!c) { fire(); return; }
      void c.beam(target, fire).then(() => {
        ctl.current?.play(reduced ? 'Hop' : 'Dance');
        ctl.current?.sparkle('burst');
      });
    }
  };

  const onHitKeyDown = (e: RKeyboardEvent<HTMLButtonElement>) => {
    if (!isHoldUnlock(unlock)) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) press(true);
    }
  };
  const onHitKeyUp = (e: RKeyboardEvent<HTMLButtonElement>) => {
    if (!isHoldUnlock(unlock)) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); press(false); }
  };

  /* ── Turn: the vault dial ─────────────────────────────────────── */
  const applyTurn = (next: TurnState) => {
    turnRef.current = next;
    setAngle(next.total);
    const now = performance.now();
    if (now - lastFace.current > 90) {
      lastFace.current = now;
      ctl.current?.face(layout.ring.cx + Math.sin(next.total) * 600);
    }
    const tick = Math.floor(next.total / (Math.PI / 6));
    if (tick !== lastTick.current) {
      lastTick.current = tick;
      try { navigator.vibrate?.(4); } catch { /* no haptics */ }
    }
    dispatch({ type: 'progress', value: turnProgress(next) });
  };
  const onTurnPointer = (e: RPointerEvent<HTMLDivElement>, down: boolean) => {
    if (!sealed) return;
    if (down) e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applyTurn(turnStep(turnRef.current, { x: e.clientX, y: e.clientY }, { x: layout.ring.cx, y: layout.ring.cy }, layout.ring.r));
  };
  const onTurnUp = () => {
    turnRef.current = turnLift(turnRef.current);
    ctl.current?.face(null);
  };
  const onTurnKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.35 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.35 : 0;
    if (d === 0 || !sealed) return;
    e.preventDefault();
    applyTurn({ total: turnRef.current.total + d, last: null });
  };

  /* ── Trace: round Beamy ───────────────────────────────────────── */
  const tri = layout.triangle;
  const outline = useMemo(() => beamyOutline(tri.cx, tri.cy, tri.size), [tri.cx, tri.cy, tri.size]);
  const onTracePointer = (e: RPointerEvent<HTMLDivElement>, down: boolean) => {
    if (!sealed) return;
    if (down) e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const prev = traceRef.current;
    const next = beamyTraceStep(prev, outline, { x: e.clientX, y: e.clientY }, tri.size);
    if (next === prev) return;
    traceRef.current = next;
    setTrace(next);
    const lit = next.covered.filter(Boolean).length;
    if (lit - litBins.current >= 6) { litBins.current = lit; ctl.current?.sparkle('sparkle'); }
    dispatch({ type: 'progress', value: beamyTraceProgress(next) });
  };
  const onTraceUp = () => {
    traceRef.current = traceLift(traceRef.current);
    setTrace(traceRef.current);
  };

  /* ── Rub ──────────────────────────────────────────────────────── */
  const onRub = useCallback((p: number) => dispatch({ type: 'progress', value: p }), []);
  const onFirstRub = useCallback(() => dispatch({ type: 'hint' }), []);

  /* ── Render ───────────────────────────────────────────────────── */
  const rootStyle = {
    '--rv-bg-top': palette.bgTop,
    '--rv-bg-bottom': palette.bgBottom,
    '--rv-panel': palette.panel,
    '--rv-fg': palette.fg,
    '--rv-muted': palette.muted,
    '--rv-accent': palette.accent,
    '--rv-on-accent': palette.onAccent,
    '--rv-core': palette.core,
  } as CSSProperties;

  const revealed = phase === 'revealed';
  const opening = phase === 'opening';
  const covered = unlock === 'melt' || unlock === 'rub' || unlock === 'shine';
  const left = Math.max(0, doc.taps - taps);
  const bubbleText = lineText(state.line, doc.beamy, left);
  const progress = unlock === 'tap' ? tapProgress(taps, doc.taps) : isHoldUnlock(unlock) ? charge : state.progress;
  const b = layout.beamy;
  const meter = unlock === 'tap'
    ? `${Math.min(taps, doc.taps)} / ${doc.taps}`
    : unlock === 'blast' ? '' : `${Math.round(progress * 100)}%`;
  const hitLabel = unlock === 'tap'
    ? `Tap Beamy, ${left} to go`
    : isHoldUnlock(unlock) ? 'Press and hold Beamy' : unlock === 'blast' ? 'Tap Beamy to blast it open' : 'Tap Beamy';
  const colors = [palette.core, palette.accent, '#FFFFFF', palette.core, palette.accent];

  const slotStyle: CSSProperties = { left: layout.slot.x, top: layout.slot.y, width: layout.slot.w, height: layout.slot.h };
  let slotInner: ReactNode;
  if (covered) {
    slotInner = (
      <>
        <RevealCard doc={doc} open={revealed} rise={revealed && state.openedBy !== 'jump' && !reduced} skeleton={poster} inert={mode === 'preview'} />
        {!revealed && unlock === 'melt' && <IceCover charge={charge} fall={opening} seed={11} />}
        {!revealed && unlock === 'shine' && <ShineCover charge={charge} flood={opening} />}
        {!revealed && unlock === 'rub' && <RubCover key={state.run} interactive={sealed && !poster} fade={opening} onProgress={onRub} onFirstRub={onFirstRub} />}
      </>
    );
  } else if (revealed) {
    slotInner = <RevealCard doc={doc} open rise={state.openedBy !== 'jump' && !reduced} inert={mode === 'preview'} />;
  } else if (unlock === 'blast') {
    slotInner = <CrystalBox charging={charging} gone={opening} />;
  } else {
    slotInner = <VaultPanel unlock={unlock} progress={progress} angle={angle} taps={taps} burst={opening} />;
  }

  const ring = layout.ring;
  const turnZone = ring.r * 1.35;
  const triPad = 34;
  const triBox = {
    left: tri.cx - tri.size / Math.sqrt(3) - triPad,
    top: tri.cy - (2 / 3) * tri.size - triPad,
    width: (2 * tri.size) / Math.sqrt(3) + triPad * 2,
    height: tri.size + triPad * 2,
  };
  const showHit = !poster && ((sealed && (unlock === 'blast' || unlock === 'tap' || isHoldUnlock(unlock))) || revealed);
  const showBubble = !poster && phase !== 'arriving';

  return (
    <div className="rv-root" data-platform data-brand="2" data-mode={mode} data-phase={phase} data-unlock={unlock} style={rootStyle}>
      <div className="rv-motes" aria-hidden>
        {motes.map((m, i) => (
          <span key={i} className="rv-mote" data-warm={m.warm ? 'true' : undefined} style={{ left: `${m.left}%`, top: `${m.top}%`, width: m.size, height: m.size, ['--d' as string]: `${m.d}s`, ['--delay' as string]: `${m.delay}s` }} />
        ))}
      </div>
      <div className="rv-pool" aria-hidden style={{ left: b.x, top: b.feet - b.h * 0.1, width: b.h * 2.4, height: b.h * 0.9 }} />
      {unlock === 'shine' && sealed && !poster && (
        <div className="rv-bloom" aria-hidden style={{ left: b.x, top: b.feet - b.h * 0.5, width: b.h * 4, height: b.h * 4, opacity: charge * 0.9 }} />
      )}

      {!poster && (
        <header className="rv-bar">
          <Link to="/" className="rv-wordmark rv-focus" onClick={mode === 'preview' ? (e) => e.preventDefault() : undefined}>Beamwall</Link>
          {revealed && (
            <button type="button" className="rv-chipbtn rv-focus" onClick={() => { resetLocal(); dispatch({ type: 'restart' }); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
              Replay
            </button>
          )}
        </header>
      )}

      {layout.teaserTop !== null && !revealed && (doc.teaser.kicker !== '' || doc.teaser.headline !== '') && (
        <div className="rv-teaser" style={{ top: layout.teaserTop }}>
          {doc.teaser.kicker !== '' && <div className="rv-kicker">{doc.teaser.kicker}</div>}
          <h1 className="rv-display rv-headline" style={layout.wide ? undefined : { fontSize: 26 }}>{doc.teaser.headline}</h1>
        </div>
      )}

      <div className="rv-slot" data-open={revealed ? 'true' : undefined} style={slotStyle} key={`slot-${state.run}`}>{slotInner}</div>

      {!revealed && (
        <Ornaments layout={layout} unlock={unlock} progress={progress} angle={angle} taps={taps} tapsNeeded={doc.taps} outline={outline} trace={trace} active={!poster} />
      )}

      <BeamyLayer
        spot={b}
        phone={!layout.wide}
        reduced={reduced}
        startHidden={!poster}
        ctlRef={ctl}
        onReady={() => setBeamyReady(true)}
      />

      <FxCanvas shots={shots} colors={colors} reduced={reduced} />

      {showHit && (
        <button
          type="button"
          className="rv-hit"
          aria-label={revealed ? 'Tap Beamy' : hitLabel}
          style={{ left: layout.hit.x, top: layout.hit.y, width: layout.hit.w, height: layout.hit.h }}
          onClick={() => { if (!isHoldUnlock(unlock) || revealed) onBeamy(); }}
          onPointerDown={(e) => { if (isHoldUnlock(unlock) && sealed) { e.currentTarget.setPointerCapture(e.pointerId); press(true); } }}
          onPointerUp={() => press(false)}
          onPointerCancel={() => press(false)}
          onLostPointerCapture={() => press(false)}
          onKeyDown={onHitKeyDown}
          onKeyUp={onHitKeyUp}
          onBlur={() => press(false)}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}

      {!poster && sealed && unlock === 'turn' && (
        <div
          className="rv-zone rv-focus"
          role="slider"
          tabIndex={0}
          aria-label="Turn the ring round Beamy"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          style={{ left: ring.cx - turnZone, top: ring.cy - turnZone, width: turnZone * 2, height: turnZone * 2, cursor: 'grab' }}
          onPointerDown={(e) => onTurnPointer(e, true)}
          onPointerMove={(e) => onTurnPointer(e, false)}
          onPointerUp={onTurnUp}
          onPointerCancel={onTurnUp}
          onKeyDown={onTurnKey}
        />
      )}
      {!poster && sealed && unlock === 'trace' && (
        <div
          className="rv-zone"
          aria-hidden
          style={{ ...triBox, borderRadius: 24 }}
          onPointerDown={(e) => onTracePointer(e, true)}
          onPointerMove={(e) => onTracePointer(e, false)}
          onPointerUp={onTraceUp}
          onPointerCancel={onTraceUp}
        />
      )}

      {showBubble && <SpeechBubble text={bubbleText} spot={layout.bubble} hidden={bubbleText === ''} phone={!layout.wide} />}

      {layout.controls !== null && !poster && sealed && (
        <div className="rv-controls" style={{ left: layout.controls.x, top: layout.controls.y, width: layout.controls.w }}>
          <div className="rv-hint">
            <span className="rv-hint-dot" aria-hidden />
            <span>{meta.gesture}</span>
            {meter !== '' && <span className="rv-hint-meter" aria-hidden>{meter}</span>}
          </div>
          <button type="button" className="rv-textbtn rv-focus" onClick={() => { press(false); dispatch({ type: 'open', by: 'skip' }); }}>
            Just show me
          </button>
        </div>
      )}
    </div>
  );
}
