/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 'curtain' reveal — the GRAND REVEAL. Contract: ./types.ts.
 *
 * Satin curtains hang across the screen with the title glowing on them and a
 * thread of light down the seam. "Open": a beam of light slices down the seam
 * and the curtains draw apart onto bright light and drifting motes; the card
 * floats up out of the light as a real 3D slab (its photo side toward you —
 * drag it, it springs back); then it turns over to its cover side while the
 * camera dollies in until it sits exactly on the template cover's rectangle,
 * and the crisp DOM card takes over → onDone.
 *
 * This file is the DOM shell (buttons, text, pointer, hand-off card); the
 * three.js scene is ./curtainScene.tsx, driven from the one clock below.
 * A lazy chunk (registry.ts) that only runs where hasWebGL() is true.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { CardRevealProps } from './types';
import { revealPhotos } from './types';
import CurtainScene, { CURTAIN_FOV, type CurtainClock } from './curtainScene';
import { curtainBeats } from '../../../lib/cardReveal';

const CORE_HEX = '#FFC56B';
const CORE_RGB = '255, 197, 107';

export default function CurtainReveal({ card, contributions, palette, look, reducedMotion, onDone }: CardRevealProps) {
  const clock = useRef<CurtainClock>({ start: null, readAt: null, pointer: { x: -0.3, y: 0 }, drag: null });
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef<HTMLButtonElement | null>(null);
  const dragFrom = useRef<{ x: number; y: number; id: number } | null>(null);
  const doneRef = useRef(false);
  const [opened, setOpened] = useState(false);
  const [showRead, setShowRead] = useState(false);
  const B = curtainBeats(reducedMotion);

  const warmHex = look === 'beamwall' ? CORE_HEX : palette.accent;
  const warmRgb = look === 'beamwall' ? CORE_RGB : palette.accentRgb;
  const photos = useMemo(() => revealPhotos(contributions, 4), [contributions]);
  // A stable palette object: the scene repaints the card faces when it changes.
  const pal = useMemo(
    () => ({ bg: palette.bg, fg: palette.fg, accent: palette.accent, accentRgb: palette.accentRgb }),
    [palette.bg, palette.fg, palette.accent, palette.accentRgb],
  );

  // Focus "Open" so Enter/Space works at once, without painting a focus ring
  // on load (a keyboard user who tabs still gets it).
  useEffect(() => {
    const el = openRef.current;
    if (!el) return;
    const opts: FocusOptions & { focusVisible?: boolean } = { preventScroll: true, focusVisible: false };
    el.focus(opts);
  }, []);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  // "Read your card" is offered while the card floats.
  useEffect(() => {
    if (!opened) return;
    const show = window.setTimeout(() => setShowRead(true), (B.float.at + 0.3) * 1000);
    const hide = window.setTimeout(() => setShowRead(false), B.dolly.at * 1000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [opened, B.float.at, B.dolly.at]);

  const open = useCallback(() => {
    if (clock.current.start !== null) return;
    clock.current.start = performance.now();
    setOpened(true);
  }, []);

  const read = useCallback(() => {
    const c = clock.current;
    if (c.start === null || c.readAt !== null) return;
    c.readAt = (performance.now() - c.start) / 1000;
    c.drag = null;
    dragFrom.current = null;
    setShowRead(false);
  }, []);

  // Pointer: the satin's light follows it before the tap; after, a drag tilts the card.
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    clock.current.pointer = {
      x: ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1,
      y: ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1,
    };
    const from = dragFrom.current;
    if (from !== null && from.id === e.pointerId) {
      clock.current.drag = { dx: e.clientX - from.x, dy: e.clientY - from.y };
    }
  }, []);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const c = clock.current;
    if (c.start === null || c.readAt !== null) return;
    dragFrom.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    c.drag = { dx: 0, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragFrom.current === null || dragFrom.current.id !== e.pointerId) return;
    dragFrom.current = null;
    clock.current.drag = null;
  }, []);

  return (
    <div
      className="absolute inset-0 overflow-hidden select-none"
      data-reveal="curtain"
      style={{ touchAction: opened ? 'none' : undefined, cursor: opened ? 'grab' : undefined }}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <h1 className="sr-only">{card.title}</h1>
      <Canvas
        className="!absolute inset-0"
        dpr={[1, 2]}
        flat
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: CURTAIN_FOV, position: [0, 0, 10], near: 0.1, far: 60 }}
        aria-hidden
      >
        <CurtainScene
          clock={clock}
          title={card.title}
          photos={photos}
          palette={pal}
          warmHex={warmHex}
          reducedMotion={reducedMotion}
          overlayRef={overlayRef}
          onFinish={finish}
        />
      </Canvas>

      {/* The title, glowing on the curtains, and the way in. */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center transition-opacity ease-out"
        style={{ opacity: opened ? 0 : 1, transitionDuration: opened ? '450ms' : '0ms' }}
      >
        <p
          className="font-serif text-4xl leading-tight sm:text-6xl"
          style={{
            color: palette.fg,
            textShadow: `0 0 18px rgba(${warmRgb}, 0.55), 0 0 42px rgba(${warmRgb}, 0.3), 0 2px 10px rgba(10, 8, 40, 0.6)`,
          }}
        >
          {card.title}
        </p>
        <button
          ref={openRef}
          type="button"
          onClick={open}
          disabled={opened}
          className="pointer-events-auto relative mt-9 inline-flex min-h-[48px] min-w-[132px] items-center justify-center rounded-full px-8 text-[15px] font-medium tracking-[0.02em] outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          style={{
            color: palette.fg,
            background: 'rgba(255, 255, 255, 0.12)',
            WebkitBackdropFilter: 'blur(16px) saturate(140%)',
            backdropFilter: 'blur(16px) saturate(140%)',
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 0 34px rgba(${warmRgb}, 0.42), 0 0 80px -10px rgba(${warmRgb}, 0.3), 0 10px 30px -12px rgba(8, 6, 40, 0.7)`,
            textShadow: `0 0 12px rgba(${warmRgb}, 0.6)`,
          }}
        >
          <GlassRim warmRgb={warmRgb} reducedMotion={reducedMotion} />
          Open
        </button>
      </div>

      {showRead && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-center">
          <button
            type="button"
            onClick={read}
            onPointerDown={(e) => e.stopPropagation()}
            className="pointer-events-auto relative inline-flex min-h-[44px] items-center justify-center rounded-full px-6 text-sm font-medium outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/80"
            style={{
              color: palette.fg,
              background: 'rgba(255, 255, 255, 0.12)',
              WebkitBackdropFilter: 'blur(16px) saturate(140%)',
              backdropFilter: 'blur(16px) saturate(140%)',
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 0 26px rgba(${warmRgb}, 0.3), 0 10px 30px -12px rgba(8, 6, 40, 0.7)`,
            }}
          >
            <GlassRim warmRgb={warmRgb} reducedMotion={reducedMotion} />
            Read your card
          </button>
        </div>
      )}

      {/* The hand-off: the same card, crisp, on the cover's rect. */}
      <HandoffCard overlayRef={overlayRef} title={card.title} palette={pal} />
    </div>
  );
}

/**
 * The glass pill's rim: a crisp 1.5px ring with a slow comet of warm light
 * running round it, plus the same comet blurred into a halo that spills past
 * the edge. Reduced motion keeps the lit rim, still.
 */
function GlassRim({ warmRgb, reducedMotion }: { warmRgb: string; reducedMotion: boolean }) {
  const rim = `conic-gradient(from 0deg, rgba(255,255,255,0.22) 0deg, rgba(255,255,255,0.3) 150deg, rgba(${warmRgb},0.55) 215deg, rgba(${warmRgb},1) 255deg, #fff 272deg, rgba(${warmRgb},0.9) 290deg, rgba(255,255,255,0.3) 335deg, rgba(255,255,255,0.22) 360deg)`;
  const halo = `conic-gradient(from 0deg, rgba(${warmRgb},0) 0deg, rgba(${warmRgb},0) 200deg, rgba(${warmRgb},0.9) 258deg, rgba(255,246,228,1) 272deg, rgba(${warmRgb},0.8) 292deg, rgba(${warmRgb},0) 345deg)`;
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute -inset-[3px]" style={{ filter: 'blur(6px)' }}>
        <RimRing background={halo} padding={5} reducedMotion={reducedMotion} />
      </span>
      <RimRing background={rim} padding={1.5} reducedMotion={reducedMotion} />
    </>
  );
}

/** A rotating conic gradient masked to a pill-shaped ring `padding` px thick. */
function RimRing({ background, padding, reducedMotion }: { background: string; padding: number; reducedMotion: boolean }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
      style={{
        padding,
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor',
        mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
      }}
    >
      <span
        className={`absolute aspect-square ${reducedMotion ? '' : 'animate-spin'}`}
        style={{
          left: '50%',
          top: '50%',
          width: '260%',
          marginLeft: '-130%',
          marginTop: '-130%',
          animationDuration: '4.6s',
          transform: reducedMotion ? 'rotate(-40deg)' : undefined,
          background,
        }}
      />
    </span>
  );
}

function HandoffCard({
  overlayRef,
  title,
  palette,
}: {
  overlayRef: React.MutableRefObject<HTMLDivElement | null>;
  title: string;
  palette: { fg: string; accentRgb: string };
}) {
  return (
    <div
      ref={overlayRef}
      aria-hidden
      className="pointer-events-none absolute inset-x-4 top-8 bottom-[76px] mx-auto max-w-[448px] overflow-hidden text-center"
      style={{
        opacity: 0,
        borderRadius: '1.8rem',
        background: 'rgba(255,255,255,0.07)',
        WebkitBackdropFilter: 'blur(18px) saturate(130%)',
        backdropFilter: 'blur(18px) saturate(130%)',
        boxShadow: `inset 1px 1px 0 rgba(255,255,255,0.36), inset -1px -1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(${palette.accentRgb},0.18), 0 24px 90px rgba(0,0,0,0.45)`,
      }}
    >
      <div className="absolute inset-x-0 top-0 flex items-center justify-center px-7" style={{ height: '90%' }}>
        <p className="font-serif text-4xl leading-tight" style={{ color: palette.fg }}>
          {title}
        </p>
      </div>
    </div>
  );
}
