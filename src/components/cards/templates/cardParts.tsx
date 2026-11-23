/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pieces every keepsake template is built from — brand v2, one source.
 *
 * Each template arranges these differently (a book, a reel, prints, a ring,
 * a constellation), but the cover, a contribution, a note, the video control,
 * the close and the pager are the SAME objects everywhere, so a host who
 * switches style never loses a feature and the recipient always gets the
 * same quality of each moment.
 *
 * Rules held here (src/styles/brand.css): display face for headlines and
 * short messages, the text face (≥15px) for anything long; white ink on
 * glass; no gradient fills on text or buttons (light — the beam behind the
 * cover, the glow under the active dot — is the one expressive colour);
 * sentence case; nothing below 12px; every target ≥44px. Only semantic
 * tokens (`--color-accent`, `--color-brand-*`, `--font-*`), so the event look
 * repaints all of it.
 *
 * Copy decisions (no repeated recipient name, no event name, counts, the
 * closing headline) are pure functions in lib/cardTemplates.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CardViewContribution, CardViewData } from '../../../lib/cards';
import {
  closingHeadline,
  contributionCountLabel,
  contributorInitials,
  coverPicks,
  coverRecipientLine,
  formatNameList,
  messageTone,
  polaroidPlacement,
  uniqueContributors,
} from '../../../lib/cardTemplates';
import { cardMonogram } from '../../../lib/cardPresentation';
import { useSkinFrameStyle } from '../designSkin';
import { ShimmerRim } from './cardChrome';

/* ------------------------------------------------------------------ */
/* Gestures                                                            */
/* ------------------------------------------------------------------ */

/** Horizontal travel (px) that counts as a page swipe. */
const SWIPE_MIN_PX = 48;

/**
 * Touch/pen swipe → next/prev. Mouse drags are ignored (desktop has arrows,
 * keys and click zones), vertical-dominant moves are left to scrolling, and
 * the element should carry `touch-action: pan-y` so the browser keeps
 * vertical scroll while we take the horizontal.
 */
export function useSwipe(onNext?: () => void, onPrev?: () => void) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }, []);
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (s === null || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      if (dx < 0) onNext?.();
      else onPrev?.();
    },
    [onNext, onPrev],
  );
  const onPointerCancel = useCallback(() => {
    start.current = null;
  }, []);
  return { onPointerDown, onPointerUp, onPointerCancel };
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

/** One initials disc: glass with a lit rim. */
export function Avatar({ name, size = 36, className = '' }: { name: string | null; size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-serif font-semibold text-brand-fg ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, Math.round(size * 0.36)),
        background: 'rgba(var(--accent-rgb), 0.16)',
        boxShadow:
          'inset 0 0 0 1px rgba(255,255,255,0.32), inset 0 1px 0 rgba(255,255,255,0.45), 0 6px 16px -8px rgba(10,8,40,0.6)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
      aria-hidden
    >
      {contributorInitials(name)}
    </span>
  );
}

/** Overlapping avatars for everyone in the card, then "+3". */
export function ContributorAvatars({
  contributions,
  max = 5,
  size = 34,
}: {
  contributions: readonly CardViewContribution[];
  max?: number;
  size?: number;
}) {
  const names = uniqueContributors(contributions);
  if (names.length === 0) return null;
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div className="flex items-center" aria-label={`From ${formatNameList(names)}`} role="img">
      {shown.map((n, i) => (
        <Avatar key={n} name={n} size={size} className={i > 0 ? '-ml-2.5' : ''} />
      ))}
      {rest > 0 && (
        <span
          className="-ml-2.5 inline-flex items-center justify-center rounded-full text-[12px] font-medium text-brand-fg"
          style={{
            width: size,
            height: size,
            background: 'rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28)',
          }}
          aria-hidden
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

/** "— The Squad", the way a card is signed. */
export function Signature({ name, className = '' }: { name: string | null; className?: string }) {
  return (
    <p className={`flex items-center justify-center gap-2.5 font-serif text-[17px] text-brand-fg/85 ${className}`}>
      <span className="h-px w-6 bg-[color:var(--color-accent)] opacity-60" aria-hidden />
      <span className="min-w-0 truncate">{name?.trim() || 'A friend'}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

function fmtDuration(s: number | null): string | null {
  if (s === null || !Number.isFinite(s) || s <= 0) return null;
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * A video message with a clear custom control: one big glass play button,
 * tap to play WITH sound (the tap is the gesture that allows it), inline on
 * iOS (playsInline), tap again to pause, replay at the end. Until the first
 * frame decodes the tile shows a designed poster — light, a play glyph and
 * who it is from — never a black hole.
 */
export function CardVideo({
  c,
  className = '',
  fit = 'cover',
  compact = false,
  style,
}: {
  c: CardViewContribution;
  className?: string;
  fit?: 'cover' | 'contain';
  compact?: boolean;
  /** Frame overrides (a card design's photo shape). */
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<'idle' | 'playing' | 'paused' | 'ended'>('idle');
  const [hasFrame, setHasFrame] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // A page turn unmounts the player; make sure no audio outlives it.
    const v = ref.current;
    return () => {
      v?.pause();
    };
  }, []);

  if (!c.url) return null;
  // `#t=0.1` asks iOS Safari to decode a poster frame with preload=metadata.
  const src = c.url.includes('#') ? c.url : `${c.url}#t=0.1`;
  const duration = fmtDuration(c.durationSeconds);

  const toggle = () => {
    const v = ref.current;
    if (v === null) return;
    if (state === 'playing') {
      v.pause();
      return;
    }
    v.muted = false;
    if (state === 'ended') v.currentTime = 0;
    void v.play().catch(() => {
      // Autoplay policy can still refuse; retry muted so something plays.
      v.muted = true;
      void v.play().catch(() => setState('paused'));
    });
  };

  const big = compact ? 56 : 72;

  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      {/* Designed poster under the video: shows until a frame decodes. */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-end gap-1 pb-5 text-center"
        style={{
          background:
            'radial-gradient(70% 55% at 50% 42%, rgba(var(--accent-rgb),0.34), transparent 70%), rgba(20,18,64,0.55)',
        }}
        aria-hidden
      >
        {!hasFrame && (
          <>
            <span className="text-[13px] text-brand-fg/80">Video from {c.contributorName?.trim() || 'a friend'}</span>
            {duration && <span className="text-[12px] tabular-nums text-brand-fg/60">{duration}</span>}
          </>
        )}
      </div>
      <video
        ref={ref}
        src={src}
        playsInline
        preload="metadata"
        className={`relative block h-full w-full transition-opacity duration-500 ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${hasFrame ? 'opacity-100' : 'opacity-0'}`}
        onLoadedData={() => setHasFrame(true)}
        onPlay={() => setState('playing')}
        onPause={() => setState((s) => (s === 'ended' ? s : 'paused'))}
        onEnded={() => setState('ended')}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration > 0) setProgress(v.currentTime / v.duration);
        }}
        onClick={toggle}
        aria-label={`Video message from ${c.contributorName?.trim() || 'a friend'}`}
      />

      {state !== 'playing' && (
        <button
          type="button"
          onClick={toggle}
          aria-label={state === 'ended' ? 'Play the video again' : 'Play the video with sound'}
          className="bw-cta absolute left-1/2 top-1/2 flex items-center justify-center rounded-full text-brand-fg"
          style={{
            marginLeft: -big / 2,
            marginTop: -big / 2,
            width: big,
            height: big,
            background: 'rgba(255,255,255,0.16)',
            backdropFilter: 'blur(14px) saturate(140%)',
            WebkitBackdropFilter: 'blur(14px) saturate(140%)',
            boxShadow:
              'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.6), 0 0 36px -6px rgba(var(--accent-rgb),0.85), 0 14px 30px -12px rgba(10,8,40,0.7)',
          }}
        >
          <ShimmerRim radius="9999px" lapS={5} glow={false} />
          {state === 'ended' ? (
            <RotateCcw className="relative h-6 w-6" aria-hidden />
          ) : (
            <Play className="relative h-7 w-7 translate-x-[2px]" fill="currentColor" aria-hidden />
          )}
        </button>
      )}

      {state === 'playing' && (
        <button
          type="button"
          onClick={toggle}
          aria-label="Pause the video"
          className="absolute bottom-2 left-2 flex h-11 w-11 items-center justify-center rounded-full text-brand-fg"
          style={{
            background: 'rgba(20,18,64,0.45)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.3)',
          }}
        >
          <Pause className="h-4 w-4" fill="currentColor" aria-hidden />
        </button>
      )}
      {state !== 'idle' && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/15" aria-hidden>
          <span
            className="block h-full bg-[color:var(--color-accent)]"
            style={{ width: `${Math.round(progress * 1000) / 10}%`, boxShadow: '0 0 10px rgba(var(--accent-rgb),0.9)' }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * A photo, large: rounded, a soft lifted shadow and — unless the reader
 * asked for less motion — a slow Ken Burns drift inside its own frame.
 */
export function CardPhoto({
  c,
  reducedMotion,
  className = '',
  imgClassName = '',
  style,
}: {
  c: CardViewContribution;
  reducedMotion: boolean;
  className?: string;
  imgClassName?: string;
  /** Frame overrides (a card design's photo shape). */
  style?: React.CSSProperties;
}) {
  if (!c.url) return null;
  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      <motion.img
        src={c.url}
        alt={c.contributorName ? `Photo from ${c.contributorName}` : 'Photo'}
        className={`block h-full w-full object-cover ${imgClassName}`}
        initial={false}
        animate={reducedMotion ? { scale: 1 } : { scale: [1, 1.07] }}
        transition={
          reducedMotion ? { duration: 0 } : { duration: 16, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' }
        }
        draggable={false}
      />
    </div>
  );
}

/** Media of any kind for a contribution, in a rounded lifted frame. */
export function ContributionMedia({
  c,
  reducedMotion,
  className = '',
}: {
  c: CardViewContribution;
  reducedMotion: boolean;
  className?: string;
}) {
  // A card design reshapes the frame (arch, oval, deco mat… lib/designSkins.ts).
  const skinStyle = useSkinFrameStyle();
  const frame = `rounded-[1.4rem] shadow-[0_22px_50px_-18px_rgba(10,8,40,0.75),0_0_0_1px_rgba(255,255,255,0.14)] ${className}`;
  if (c.mediaType === 'photo') return <CardPhoto c={c} reducedMotion={reducedMotion} className={frame} style={skinStyle} />;
  if (c.mediaType === 'video') return <CardVideo c={c} className={frame} style={skinStyle} />;
  return null;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

/**
 * A message, set by its length: short lines in the display face at headline
 * size, longer ones in the text face at a readable 16-17px.
 */
export function Message({
  message,
  emphasis = 'normal',
  className = '',
}: {
  message: string | null;
  /** 'note' = the contribution is ONLY words, so it gets the largest setting. */
  emphasis?: 'normal' | 'note';
  className?: string;
}) {
  const tone = messageTone(message);
  if (tone === 'none' || message === null) return null;
  const cls =
    tone === 'display'
      ? `font-serif font-medium leading-[1.22] text-brand-fg ${emphasis === 'note' ? 'text-[clamp(24px,6.4vw,34px)]' : 'text-[clamp(19px,5vw,24px)]'}`
      : `font-sans leading-relaxed text-brand-fg/95 ${emphasis === 'note' ? 'text-[17px]' : 'text-[16px]'}`;
  return <p className={`${cls} text-balance ${className}`}>{message.trim()}</p>;
}

/** Faint ruled lines + grain: the frosted paper of a written note. */
const NOTE_PAPER: React.CSSProperties = {
  background:
    'repeating-linear-gradient(to bottom, transparent 0, transparent 33px, rgba(255,255,255,0.09) 33px, rgba(255,255,255,0.09) 34px), rgba(255,255,255,0.13)',
  backdropFilter: 'blur(20px) saturate(135%)',
  WebkitBackdropFilter: 'blur(20px) saturate(135%)',
  boxShadow:
    'inset 1px 1px 0 rgba(255,255,255,0.45), inset -1px -1px 0 rgba(255,255,255,0.1), inset 0 0 0 1px rgba(255,255,255,0.12), 0 30px 60px -30px rgba(10,8,40,0.8)',
};

/**
 * A written-only contribution: a note on frosted paper — a lit quote mark,
 * the words, the signature — set a few degrees off true (seeded by id, so it
 * lands the same way every time).
 *
 * HOLD TO GLOW: press and hold the note and light gathers under your finger
 * and spreads through the paper, the quote mark flares, and the note lifts
 * level — the words were written for you, so the paper warms when you hold
 * it. Purely presentational; nothing is hidden behind it.
 */
export function NoteCard({
  c,
  className = '',
  tilt = true,
}: {
  c: CardViewContribution;
  className?: string;
  tilt?: boolean;
}) {
  const rot = tilt ? polaroidPlacement(c.id).rotationDeg * 0.5 : 0;
  const [held, setHeld] = useState(false);
  const [at, setAt] = useState({ x: 50, y: 50 });
  const place = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    setAt({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };
  return (
    <figure
      className={`relative w-full select-none rounded-[1.6rem] px-7 pb-7 pt-12 text-center transition-transform duration-500 ${className}`}
      style={{ ...NOTE_PAPER, transform: `rotate(${held ? 0 : rot}deg) scale(${held ? 1.015 : 1})`, touchAction: 'pan-y' }}
      onPointerDown={(e) => {
        place(e);
        setHeld(true);
      }}
      onPointerMove={(e) => {
        if (held) place(e);
      }}
      onPointerUp={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
    >
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-700"
        style={{
          opacity: held ? 1 : 0,
          background: `radial-gradient(60% 55% at ${at.x}% ${at.y}%, rgba(255,214,150,0.30), rgba(var(--accent-rgb),0.16) 45%, transparent 75%)`,
          boxShadow: '0 0 60px -10px rgba(var(--accent-rgb),0.75)',
        }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 select-none font-serif text-[64px] leading-none transition-[text-shadow] duration-500"
        style={{
          color: 'var(--color-accent)',
          textShadow: held
            ? '0 0 18px rgba(255,214,150,0.95), 0 0 42px rgba(var(--accent-rgb),1)'
            : '0 0 22px rgba(var(--accent-rgb),0.8)',
        }}
        aria-hidden
      >
        “
      </span>
      <blockquote className="relative">
        <Message message={c.message} emphasis="note" />
      </blockquote>
      <figcaption className="relative mt-6">
        <Signature name={c.contributorName} />
      </figcaption>
      <span className="pointer-events-none mt-4 block text-[12px] text-brand-fg/45" aria-hidden>
        Hold the note
      </span>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Delights                                                            */
/* ------------------------------------------------------------------ */

/**
 * A pearlescent sheen that moves with the reader: pointer position on a
 * desktop, the phone's tilt where the browser hands it over without a
 * permission prompt (Android), and a slow drift elsewhere (iOS asks for
 * motion permission, which a greeting card should not). Writes CSS variables
 * from a rAF loop on its own node — no React re-render per frame. Light on
 * the card material, never on text or buttons.
 */
export function TiltSheen({ reducedMotion, className = '' }: { reducedMotion: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    let tx = 0.5;
    let ty = 0.5;
    let x = 0.5;
    let y = 0.5;
    let live = false; // a real input has arrived; stop the idle drift
    let raf = 0;
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      live = true;
      tx = e.clientX / Math.max(1, window.innerWidth);
      ty = e.clientY / Math.max(1, window.innerHeight);
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      live = true;
      tx = Math.max(0, Math.min(1, 0.5 + e.gamma / 60));
      ty = Math.max(0, Math.min(1, 0.5 + (e.beta - 45) / 60));
    };
    const t0 = performance.now();
    const tick = (now: number) => {
      if (!live && !reducedMotion) {
        const t = (now - t0) / 1000;
        tx = 0.5 + Math.sin(t * 0.25) * 0.35;
        ty = 0.5 + Math.cos(t * 0.19) * 0.25;
      }
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      el.style.setProperty('--sheen-x', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--sheen-y', `${(y * 100).toFixed(1)}%`);
      raf = document.visibilityState === 'hidden' ? 0 : requestAnimationFrame(tick);
    };
    const onVis = () => {
      if (document.visibilityState !== 'hidden' && raf === 0) raf = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('deviceorientation', onTilt, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onTilt);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [reducedMotion]);
  return (
    <div
      ref={ref}
      className={`pointer-events-none absolute inset-0 rounded-[inherit] ${className}`}
      style={{
        background:
          'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.13) 44%, rgba(var(--accent-rgb),0.16) 50%, rgba(255,214,160,0.10) 56%, transparent 70%)',
        backgroundSize: '260% 260%',
        backgroundPosition: 'var(--sheen-x, 50%) var(--sheen-y, 50%)',
        mixBlendMode: 'screen',
      }}
      aria-hidden
    />
  );
}

/** Fraction of the foil that must be cleared before it falls away. */
const SCRATCH_CLEAR_AT = 0.42;

/**
 * Scratch to reveal: the children sit under a pearlescent foil the reader
 * rubs away with a finger (or the mouse). Past ~42% cleared the rest of the
 * foil dissolves. A "Reveal" button does it in one tap — for a keyboard, a
 * screen reader, or anyone who would rather not scratch — and the content
 * is in the DOM (and the accessibility tree) the whole time.
 */
export function ScratchReveal({
  children,
  label = 'Scratch to reveal',
  disabled = false,
  className = '',
}: {
  children: React.ReactNode;
  label?: string;
  /** Render revealed (static/frame renders). */
  disabled?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [revealed, setRevealed] = useState(disabled);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const strokes = useRef(0);

  useEffect(() => {
    if (revealed) return;
    const el = box.current;
    const cv = canvas.current;
    if (el === null || cv === null) return;
    const paint = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      const ctx = cv.getContext('2d');
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const accent = getComputedStyle(el).getPropertyValue('--accent-rgb').trim() || '212, 214, 255';
      // Pearlescent foil: a pale base, a sweep of accent light, fine sparkle.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgb(232,230,255)';
      ctx.fillRect(0, 0, r.width, r.height);
      const g = ctx.createLinearGradient(0, 0, r.width, r.height);
      g.addColorStop(0, `rgba(${accent},0.55)`);
      g.addColorStop(0.45, 'rgba(255,255,255,0.0)');
      g.addColorStop(0.6, 'rgba(255,214,160,0.45)');
      g.addColorStop(1, `rgba(${accent},0.6)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, r.width, r.height);
      for (let i = 0; i < Math.round((r.width * r.height) / 260); i++) {
        // Deterministic sparkle (golden-ratio walk) — no Math.random.
        const px = ((i * 0.618034) % 1) * r.width;
        const py = ((i * 0.381966 * 1.7) % 1) * r.height;
        ctx.fillStyle = `rgba(255,255,255,${0.35 + ((i * 7) % 10) / 20})`;
        ctx.fillRect(px, py, 1.2, 1.2);
      }
      ctx.fillStyle = 'rgba(30,26,90,0.78)';
      ctx.font = `500 15px ${getComputedStyle(el).getPropertyValue('--font-sans') || 'sans-serif'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, r.width / 2, r.height / 2);
    };
    paint();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    return () => ro.disconnect();
  }, [revealed, label]);

  const scratch = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const r = cv.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 34;
    ctx.beginPath();
    const from = last.current ?? p;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(p.x + 0.01, p.y);
    ctx.stroke();
    last.current = p;
    // Sample the cleared fraction every few strokes (getImageData is not free).
    strokes.current += 1;
    if (strokes.current % 6 !== 0) return;
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0;
    let n = 0;
    for (let i = 3; i < data.length; i += 4 * 16) {
      n++;
      if (data[i] < 40) clear++;
    }
    if (n > 0 && clear / n >= SCRATCH_CLEAR_AT) setRevealed(true);
  };

  return (
    <div ref={box} className={`relative ${className}`}>
      <div aria-live="polite">{children}</div>
      {!revealed && (
        <>
          <canvas
            ref={canvas}
            className="absolute inset-0 h-full w-full cursor-pointer rounded-2xl"
            style={{ touchAction: 'none', boxShadow: '0 0 0 1px rgba(255,255,255,0.4), 0 0 30px -8px rgba(var(--accent-rgb),0.8)' }}
            onPointerDown={(e) => {
              drawing.current = true;
              last.current = null;
              e.currentTarget.setPointerCapture(e.pointerId);
              scratch(e);
            }}
            onPointerMove={(e) => {
              if (drawing.current) scratch(e);
            }}
            onPointerUp={() => {
              drawing.current = false;
              last.current = null;
            }}
            onPointerCancel={() => {
              drawing.current = false;
              last.current = null;
            }}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute -bottom-12 left-1/2 inline-flex min-h-[44px] -translate-x-1/2 items-center rounded-full px-4 text-[12px] text-brand-fg/70 underline decoration-white/25 underline-offset-4 hover:text-brand-fg"
          >
            Reveal
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cover                                                               */
/* ------------------------------------------------------------------ */

/** The light behind the cover: a soft beam with a warm core. */
export function BeamGlow({ reducedMotion, className = '' }: { reducedMotion: boolean; className?: string }) {
  return (
    <motion.div
      className={`pointer-events-none absolute ${className}`}
      aria-hidden
      initial={false}
      animate={reducedMotion ? { opacity: 0.9 } : { opacity: [0.75, 1, 0.75] }}
      transition={reducedMotion ? { duration: 0 } : { duration: 6, ease: 'easeInOut', repeat: Infinity }}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(50% 50% at 50% 50%, rgba(var(--accent-rgb),0.7), transparent 70%)', filter: 'blur(8px)' }}
      />
      <div
        className="absolute left-1/2 top-[-30%] h-[160%] w-[18%] -translate-x-1/2"
        style={{ background: 'radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.5), transparent 72%)', filter: 'blur(10px)' }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-[34%] w-[34%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(50% 50% at 50% 50%, rgba(255,197,107,0.55), transparent 70%)' }}
      />
    </motion.div>
  );
}

/** One tile in the cover arc. */
function CoverTile({ c }: { c: CardViewContribution }) {
  const base = 'absolute inset-0 h-full w-full object-cover';
  if (c.mediaType === 'photo' && c.url) {
    return <img src={c.url} alt="" className={base} draggable={false} />;
  }
  if (c.mediaType === 'video' && c.url) {
    return (
      <>
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(70% 60% at 50% 45%, rgba(var(--accent-rgb),0.45), rgba(24,20,72,0.9))' }}
        />
        <video src={`${c.url}#t=0.1`} muted playsInline preload="metadata" className={base} aria-hidden tabIndex={-1} />
        <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/25 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)] backdrop-blur-md">
          <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden />
        </span>
      </>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2" style={NOTE_PAPER}>
      <span className="font-serif text-[34px] leading-none" style={{ color: 'var(--color-accent)' }} aria-hidden>
        “
      </span>
      <span className="font-serif text-[13px] font-medium text-brand-fg/85">{contributorInitials(c.contributorName)}</span>
    </div>
  );
}

/** A semicircular top over a softly rounded base, for a 3:4 window. */
export const ARCH_RADIUS = '50% 50% 22px 22px / 37.5% 37.5% 22px 22px';

/**
 * The cover's hero, picking up where the reveals leave off: the lead photo
 * in an arched window with the shimmer rim running round it and a warm spark
 * at its crown, two more of the people in the card tucked behind its
 * shoulders, all in front of the beam. Without a photo, the arch frames the
 * recipient's monogram on frosted paper.
 */
export function CoverArch({
  card,
  contributions,
  reducedMotion,
  width = 'clamp(176px, 50vw, 248px)',
  className = '',
}: {
  card: CardViewData;
  contributions: readonly CardViewContribution[];
  reducedMotion: boolean;
  width?: string;
  className?: string;
}) {
  const picks = coverPicks(contributions, 3);
  const lead = picks.find((c) => c.url !== null && c.mediaType !== 'text') ?? null;
  const shoulders = picks.filter((c) => c !== lead).slice(0, 2);
  const spring = (delay: number) =>
    reducedMotion ? { duration: 0 } : ({ type: 'spring', stiffness: 130, damping: 18, delay } as const);

  return (
    <div className={`relative flex w-full justify-center ${className}`}>
      <BeamGlow reducedMotion={reducedMotion} className="inset-x-[4%] -inset-y-[14%]" />
      <div className="relative" style={{ width, aspectRatio: '3 / 4' }}>
        {shoulders.map((c, i) => {
          const left = i === 0;
          return (
            <motion.div
              key={c.id}
              className="absolute top-[20%] h-[64%] overflow-hidden rounded-[16px]"
              style={{
                aspectRatio: '3 / 4',
                [left ? 'left' : 'right']: '-24%',
                boxShadow:
                  '0 0 0 1px rgba(255,255,255,0.32), inset 0 1px 0 rgba(255,255,255,0.4), 0 18px 40px -16px rgba(10,8,40,0.85)',
              }}
              initial={reducedMotion ? false : { opacity: 0, x: left ? '30%' : '-30%', rotate: 0 }}
              animate={{ opacity: 0.92, x: '0%', rotate: left ? -9 : 9 }}
              transition={spring(0.22 + i * 0.06)}
            >
              <CoverTile c={c} />
              <div className="absolute inset-0 bg-[rgba(16,12,60,0.18)]" aria-hidden />
            </motion.div>
          );
        })}

        <motion.div
          className="absolute inset-0"
          style={{ borderRadius: ARCH_RADIUS }}
          initial={reducedMotion ? false : { opacity: 0, y: 18, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={spring(0.05)}
        >
          <div
            className="absolute inset-0 overflow-hidden"
            style={{
              borderRadius: ARCH_RADIUS,
              boxShadow: '0 26px 60px -22px rgba(10,8,40,0.9), 0 0 60px -18px rgba(var(--accent-rgb),0.75)',
            }}
          >
            {lead?.mediaType === 'photo' ? (
              <div className="absolute inset-0">
                <CardPhoto c={lead} reducedMotion={reducedMotion} className="h-full w-full" />
              </div>
            ) : lead ? (
              <CoverTile c={lead} />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center" style={NOTE_PAPER}>
                <span
                  className="font-serif text-[clamp(56px,16vw,88px)] font-semibold leading-none tracking-[-0.04em]"
                  style={{ color: 'var(--color-accent)', textShadow: '0 0 30px rgba(var(--accent-rgb),0.5)' }}
                  aria-hidden
                >
                  {cardMonogram(card.recipientName, card.title)}
                </span>
              </div>
            )}
            {/* Depth: light from the crown, shade at the sill. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, transparent 28%, transparent 70%, rgba(10,8,40,0.38) 100%)',
              }}
              aria-hidden
            />
            <TiltSheen reducedMotion={reducedMotion} />
          </div>
          <ShimmerRim radius={ARCH_RADIUS} width={2} lapS={7} base={0.34} reducedMotion={reducedMotion} />
          {/* The warm spark at the arch's crown. */}
          <svg
            viewBox="-10 -10 20 20"
            className="pointer-events-none absolute left-1/2 top-0 h-6 w-6 -translate-x-1/2 -translate-y-1/2"
            aria-hidden
          >
            <circle r="9" fill="#FFC56B" fillOpacity="0.22" />
            <path d="M0-8.5L1.7-1.7L8.5 0L1.7 1.7L0 8.5L-1.7 1.7L-8.5 0L-1.7-1.7Z" fill="#FFE2B0" />
          </svg>
        </motion.div>
      </div>
    </div>
  );
}

/** Title, the optional "for X" line, avatars and the count. */
export function CoverTitle({
  card,
  contributions,
  align = 'center',
  size = 'lg',
}: {
  card: CardViewData;
  contributions: readonly CardViewContribution[];
  align?: 'center' | 'left';
  size?: 'lg' | 'md';
}) {
  const forLine = coverRecipientLine(card.title, card.recipientName);
  const titleSize = size === 'lg' ? 'text-[clamp(40px,11.5vw,68px)]' : 'text-[clamp(34px,9vw,52px)]';
  return (
    <div className={`flex flex-col ${align === 'center' ? 'items-center text-center' : 'items-start text-left'}`}>
      <h1
        className={`font-serif font-semibold leading-[0.98] tracking-[-0.035em] text-brand-fg text-balance ${titleSize}`}
        style={{ textShadow: '0 2px 30px rgba(var(--accent-rgb),0.35)' }}
      >
        {card.title}
      </h1>
      {forLine && <p className="mt-3 font-sans text-[17px] text-brand-fg/80">{forLine}</p>}
      <div className={`mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 ${align === 'center' ? 'justify-center' : ''}`}>
        <ContributorAvatars contributions={contributions} max={size === 'lg' ? 5 : 4} />
        <span className="whitespace-nowrap text-[13px] text-brand-fg/75">{contributionCountLabel(contributions.length)}</span>
      </div>
    </div>
  );
}

/** The one call to action on a cover: open it. */
export function OpenButton({
  onClick,
  label = 'Open your card',
  reducedMotion = false,
}: {
  onClick?: () => void;
  label?: string;
  reducedMotion?: boolean;
}) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="bw-cta liquid-glass inline-flex min-h-[52px] items-center gap-3 rounded-full py-1.5 pl-6 pr-1.5 text-[15px] font-medium text-brand-fg"
    >
      <ShimmerRim radius="9999px" lapS={5.5} reducedMotion={reducedMotion} />
      <span className="relative">{label}</span>
      <span
        className="relative flex h-10 w-10 items-center justify-center rounded-full"
        style={{
          background: 'rgba(var(--accent-rgb),0.3)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.5), 0 0 18px -2px rgba(var(--accent-rgb),0.95)',
        }}
        aria-hidden
      >
        <ChevronRight className="h-4 w-4" />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Close                                                               */
/* ------------------------------------------------------------------ */

/** The small, tasteful sign-off: a beam glyph and the name. */
export function MadeWithBeamwall({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`group inline-flex min-h-[44px] items-center gap-2 rounded-full px-3 text-[12px] text-brand-fg/60 transition hover:text-brand-fg ${className}`}
    >
      <svg viewBox="0 0 12 16" className="h-4 w-3" aria-hidden>
        <line x1="6" y1="0.5" x2="6" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <circle cx="6" cy="12.5" r="2.4" fill="#FFC56B" opacity="0.9" />
      </svg>
      Made with Beamwall
    </Link>
  );
}

/** The warm close: who it is from, then the sign-off. */
export function ClosingContent({
  card,
  contributions,
  showCreate = true,
  scratch = true,
}: {
  card: CardViewData;
  contributions: readonly CardViewContribution[];
  showCreate?: boolean;
  /** Hide the signatures under a scratch-off foil (interactive views only). */
  scratch?: boolean;
}) {
  const names = uniqueContributors(contributions);
  const signed = (
    <div className="px-4 py-3">
      <p className="max-w-[30ch] font-sans text-[15px] leading-relaxed text-brand-fg/85 text-balance">
        {formatNameList(names, 8)}
      </p>
      {card.recipientName && <p className="mt-1.5 text-[13px] text-brand-fg/60">to {card.recipientName.trim()}</p>}
    </div>
  );
  return (
    <div className="flex flex-col items-center text-center">
      <ContributorAvatars contributions={contributions} max={5} size={36} />
      <h2
        className="mt-6 font-serif text-[clamp(32px,8.6vw,52px)] font-semibold leading-[1.02] tracking-[-0.03em] text-brand-fg text-balance"
        style={{ textShadow: '0 2px 30px rgba(var(--accent-rgb),0.35)' }}
      >
        {closingHeadline(contributions)}
      </h2>
      {names.length > 1 && (
        <ScratchReveal
          className="mt-4 min-w-[min(17rem,80vw)]"
          label="Scratch to see who signed it"
          disabled={!scratch}
        >
          {signed}
        </ScratchReveal>
      )}
      <div className={`${names.length > 1 && scratch ? 'mt-14' : 'mt-8'} flex flex-col items-center gap-1`}>
        <MadeWithBeamwall />
        {showCreate && (
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center rounded-full px-4 text-[13px] text-brand-fg/75 underline decoration-white/25 underline-offset-4 transition hover:text-brand-fg"
          >
            Make one for someone
          </Link>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

const GLASS_ROUND =
  'bw-cta liquid-glass flex h-12 w-12 items-center justify-center rounded-full text-brand-fg disabled:pointer-events-none disabled:opacity-30';

/** A glass arrow: still until hovered, focused or pressed, then its rim lights. */
function GlassArrow({
  dir,
  onClick,
  disabled,
  label,
}: {
  dir: 'prev' | 'next';
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={GLASS_ROUND}>
      <ShimmerRim radius="9999px" trigger="hover" lapS={3.2} base={0.28} />
      <Icon className="relative h-5 w-5" aria-hidden />
    </button>
  );
}

/** Glass arrows and a progress row. More than 12 pages → a counter. */
export function Pager({
  page,
  total,
  onPrev,
  onNext,
  noun = 'page',
  className = '',
}: {
  page: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
  noun?: string;
  className?: string;
}) {
  return (
    <nav className={`relative z-20 flex items-center justify-center gap-4 ${className}`} aria-label="Card pages">
      {onPrev && <GlassArrow dir="prev" onClick={onPrev} disabled={page === 0} label={`Previous ${noun}`} />}
      {total <= 12 ? (
        <div className="flex items-center gap-1.5" aria-label={`${noun} ${page + 1} of ${total}`} role="img">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className="h-1.5 rounded-full transition-all duration-300"
              style={
                i === page
                  ? {
                      width: 22,
                      background: 'var(--color-accent)',
                      boxShadow: '0 0 12px rgba(var(--accent-rgb),0.9), 0 0 2px rgba(255,255,255,0.9)',
                    }
                  : { width: 6, background: 'rgba(255,255,255,0.28)' }
              }
            />
          ))}
        </div>
      ) : (
        <span className="min-w-[4.5rem] text-center text-[13px] tabular-nums text-brand-fg/75">
          {page + 1} / {total}
        </span>
      )}
      {onNext && <GlassArrow dir="next" onClick={onNext} disabled={page === total - 1} label={`Next ${noun}`} />}
    </nav>
  );
}

/** "3 of 8" above a contribution. */
export function PageMark({ n, of }: { n: number; of: number }) {
  return (
    <p className="text-[12px] tabular-nums tracking-[0.02em] text-brand-fg/55">
      {n} of {of}
    </p>
  );
}
