/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 'stardust' reveal — a small galaxy of glowing dust swirls on the dusk, the
 * card's title glowing faintly at its heart; the swirl bends round your
 * finger. "Open" (or Enter/Space, or a tap on the sky) spins it up into a
 * vortex, then every grain flies to its place on the card face and takes
 * its colour — the dust BECOMES the card — a flash as it locks in, light
 * racing round its edge and the photo's arch, and the solid card glows into
 * view. Contract: ./types.ts. Scene: ./stardustScene.tsx; maths:
 * lib/cardStardust.ts.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import { cardStage, type CardStage } from '../../../lib/cardFlight';
import { particleBudget } from '../../../lib/cardStardust';
import type { CardRevealProps } from './types';
import { revealSky, useCardFace } from './airplaneCardFace';
import StardustScene, { STARDUST_FOV, type StardustControl } from './stardustScene';

const noEvents = () => ({ enabled: false, priority: 0 });
const FACE_H = 1600;

export default function StardustReveal({ card, contributions, palette, reducedMotion, onDone }: CardRevealProps) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const flash = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<CardStage | null>(null);
  const [count, setCount] = useState(0);
  const [opened, setOpened] = useState(false);
  const control = useRef<StardustControl>({ openRequested: false, pointer: { x: 0, y: 0, active: false } });
  const done = useRef(false);
  const press = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setStage(cardStage(el.clientWidth, el.clientHeight));
    setCount(
      particleBudget({
        width: el.clientWidth,
        height: el.clientHeight,
        dpr: window.devicePixelRatio,
        reducedMotion,
      }),
    );
  }, [reducedMotion]);

  const faceW = stage === null ? null : Math.round(FACE_H * stage.aspect);
  const face = useCardFace(faceW, FACE_H, card, contributions, palette);

  const open = useCallback(() => {
    if (control.current.openRequested) return;
    control.current.openRequested = true;
    setOpened(true);
  }, []);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ndc = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, y: 1 - ((e.clientY - r.top) / Math.max(1, r.height)) * 2 };
  };

  const { bg, accentRgb } = palette;

  return (
    <div
      ref={wrap}
      className="absolute inset-0 overflow-hidden touch-none select-none"
      style={{ ...revealSky(bg, accentRgb), backgroundColor: `color-mix(in oklab, ${bg} 70%, black)` }}
      data-reveal="stardust"
      onPointerMove={(e) => {
        control.current.pointer = { ...ndc(e), active: true };
      }}
      onPointerDown={(e) => {
        const p = ndc(e);
        control.current.pointer = { ...p, active: true };
        press.current = p;
      }}
      onPointerUp={(e) => {
        const start = press.current;
        press.current = null;
        if (e.pointerType !== 'mouse') control.current.pointer = { ...control.current.pointer, active: false };
        if (!start) return;
        const p = ndc(e);
        // A tap opens; a drag just stirs the stars.
        if (Math.hypot(p.x - start.x, p.y - start.y) < 0.05) open();
      }}
      onPointerLeave={() => {
        control.current.pointer = { ...control.current.pointer, active: false };
      }}
    >
      {/* Night falls a little deeper here so the dust can glow. */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'rgba(0,0,0,0.28)' }} aria-hidden />
      {stage && count > 0 && faceW !== null && (
        <Canvas
          className="!absolute inset-0"
          dpr={[1, 2]}
          events={noEvents}
          camera={{ fov: STARDUST_FOV, near: 0.05, far: 100, position: [0, 0, 5] }}
          gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <StardustScene
            control={control}
            stage={stage}
            palette={palette}
            title={card.title}
            reducedMotion={reducedMotion}
            count={count}
            face={face}
            faceSize={{ w: faceW, h: FACE_H }}
            flashEl={flash}
            onFinished={finish}
          />
        </Canvas>
      )}
      <div
        ref={flash}
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0,
          background: `radial-gradient(70% 55% at 50% 50%, rgba(255,247,230,0.95) 0%, rgba(255,197,107,0.55) 35%, rgba(${accentRgb},0.18) 65%, rgba(${accentRgb},0) 100%)`,
          mixBlendMode: 'screen',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center px-6 pb-[max(2.75rem,calc(env(safe-area-inset-bottom)+1.5rem))] text-center transition-opacity duration-500"
        style={{ opacity: opened ? 0 : 1 }}
        aria-hidden={opened}
      >
        {card.recipientName && <p className="text-[13px] text-brand-fg/75">For {card.recipientName}</p>}
        <p className="mt-1.5 font-serif text-[26px] leading-tight text-balance text-brand-fg">Every moment, gathered into one</p>
        <button
          type="button"
          autoFocus
          disabled={opened}
          onClick={open}
          className="pointer-events-auto mt-6 min-h-[48px] min-w-[44px] rounded-full bg-accent px-9 text-[15px] font-medium text-[color:var(--on-accent)] shadow-[0_0_44px_rgba(var(--accent-rgb),0.45)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/50"
        >
          Open
        </button>
      </div>
    </div>
  );
}
