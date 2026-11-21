/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 'airplane' reveal — a pearlescent paper dart glides across the dusk; catch
 * it (the "Catch it" button, Enter/Space, a tap on the sky, or a FLICK — fling
 * it and it loops back to you) and it swoops in, loops, settles, light races
 * along its creases, and it unfolds fold by fold into the card. Contract:
 * ./types.ts. The scene: ./airplaneScene.tsx; the maths: lib/cardFlight.ts.
 *
 * This shell owns the DOM: the sky, the prompt + button, pointer/keyboard
 * input, and preparing the printed face (fonts, the lead photo) off the
 * critical path — the plane flies on plain stock until the print is ready.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import { cardStage, type CardStage } from '../../../lib/cardFlight';
import type { CardRevealProps } from './types';
import { revealSky, useCardFace } from './airplaneCardFace';
import AirplaneScene, { AIRPLANE_FOV, type AirplaneControl } from './airplaneScene';

/** R3F's pointer layer is not used (input is handled on the wrapper). */
const noEvents = () => ({ enabled: false, priority: 0 });

/** Face texture height in px — the card is seen at most ~800 css px tall, so this is 2×. */
const FACE_H = 1600;

export default function AirplaneReveal({ card, contributions, palette, reducedMotion, onDone }: CardRevealProps) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<CardStage | null>(null);
  const [caught, setCaught] = useState(false);
  const control = useRef<AirplaneControl>({ catchRequested: false, pointer: { x: 0, y: 0, active: false }, flick: null });
  const done = useRef(false);
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);

  // The stage is measured once, from the reveal's own box (a host preview is
  // not the window), and frozen so a resize mid-flight never refolds the plane.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (el) setStage(cardStage(el.clientWidth, el.clientHeight));
  }, []);

  const { bg, accentRgb } = palette;
  const face = useCardFace(stage === null ? null : Math.round(FACE_H * stage.aspect), FACE_H, card, contributions, palette);

  const catchIt = useCallback((flick?: { x: number; y: number }) => {
    const c = control.current;
    if (c.catchRequested) return;
    c.flick = flick ?? null;
    c.catchRequested = true;
    setCaught(true);
  }, []);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  // Enter/Space anywhere (the button handles them itself when focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      catchIt();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [catchIt]);

  const ndc = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, y: 1 - ((e.clientY - r.top) / Math.max(1, r.height)) * 2 };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = ndc(e);
    control.current.pointer = { ...p, active: true };
    if (press.current) {
      trail.current.push({ ...p, t: e.timeStamp });
      if (trail.current.length > 6) trail.current.shift();
    }
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const p = ndc(e);
    control.current.pointer = { ...p, active: true };
    press.current = { ...p, t: e.timeStamp };
    trail.current = [{ ...p, t: e.timeStamp }];
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = press.current;
    press.current = null;
    if (!start) return;
    const p = ndc(e);
    const first = trail.current[0] ?? start;
    const dt = Math.max(1, e.timeStamp - first.t) / 1000;
    const vx = (p.x - first.x) / dt;
    const vy = (p.y - first.y) / dt;
    const moved = Math.hypot(p.x - start.x, p.y - start.y);
    if (Math.hypot(vx, vy) > 2.2 && moved > 0.12) catchIt({ x: vx, y: vy });
    else if (moved < 0.05) catchIt();
  };
  const onLeave = () => {
    control.current.pointer = { ...control.current.pointer, active: false };
  };

  return (
    <div
      ref={wrap}
      className="absolute inset-0 overflow-hidden touch-none select-none"
      style={revealSky(bg, accentRgb)}
      data-reveal="airplane"
      onPointerMove={onMove}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onLeave}
    >
      {stage && (
        <Canvas
          className="!absolute inset-0"
          dpr={[1, 2]}
          events={noEvents}
          camera={{ fov: AIRPLANE_FOV, near: 0.05, far: 200, position: [0, 0, 0] }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <AirplaneScene
            control={control}
            stage={stage}
            palette={palette}
            reducedMotion={reducedMotion}
            face={face}
            onFinished={finish}
          />
        </Canvas>
      )}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center px-6 pb-[max(2.75rem,calc(env(safe-area-inset-bottom)+1.5rem))] text-center transition-opacity duration-500"
        style={{ opacity: caught ? 0 : 1 }}
        aria-hidden={caught}
      >
        {card.recipientName && <p className="text-[13px] text-brand-fg/75">For {card.recipientName}</p>}
        <p className="mt-1.5 font-serif text-[26px] leading-tight text-brand-fg">Something's flying your way</p>
        <button
          type="button"
          autoFocus
          disabled={caught}
          onClick={() => catchIt()}
          className="pointer-events-auto mt-6 min-h-[48px] min-w-[44px] rounded-full bg-accent px-8 text-[15px] font-medium text-[color:var(--on-accent)] shadow-[0_0_44px_rgba(var(--accent-rgb),0.45)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/50"
        >
          Catch it
        </button>
      </div>
    </div>
  );
}
