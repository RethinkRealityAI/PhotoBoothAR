/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CardExperience — a keepsake card as the recipient lives it: the opening
 * REVEAL (envelope, curtain, airplane, stardust… or none), then the chosen
 * card TEMPLATE, in the chosen LOOK. Data in, no fetching — the public viewer
 * (/c/:publicId) and the host's full-screen preview both render this, so what
 * a host previews is exactly what the recipient gets.
 *
 * Phases: 'reveal' → (reveal calls onDone) → 'handoff' (template mounts
 * underneath, the reveal layer fades out over REVEAL_HANDOFF_MS) → 'card'.
 * The template is NOT mounted during 'reveal' so a WebGL reveal and a WebGL
 * template never hold two GPU contexts at once on a phone (contract:
 * reveals/types.ts).
 *
 * Look: 'beamwall' renders on the brand v2 dusk field (`app-bg` resolves to it
 * outside an event surface — src/styles/platform.css); 'event' paints the
 * card's theme snapshot as inline custom properties on this root, so it works
 * the same on /c (no EventProvider) and inside the host studio's platform
 * chrome (where :root belongs to the studio and must not be repainted).
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Play, RotateCcw } from 'lucide-react';
import type { CardViewContribution, CardViewData } from '../../lib/cards';
import {
  cardPalette,
  normalizeCardPresentation,
  playableReveal,
  resolveCardLook,
  type CardViewOverrides,
} from '../../lib/cardPresentation';
import { normalizeCardTheme } from '../../lib/cardTheme';
import { resolveCardTemplate } from './templates/registry';
import { CardField, ShimmerRim } from './templates/cardChrome';
import { clampIndex } from './templates/types';
import { revealComponent } from './reveals/registry';
import { REVEAL_HANDOFF_MS } from './reveals/types';
import { hasWebGL } from '../carousel/PhotoCarousel';

type Phase = 'reveal' | 'handoff' | 'card';

export interface CardExperienceProps {
  card: CardViewData;
  contributions: CardViewContribution[];
  /** Per-visit overrides (?reveal=&template=&look=), or a host preview's
   *  unsaved choice. Never written anywhere. */
  overrides?: CardViewOverrides;
  reducedMotion: boolean;
  /** Listen for arrow keys on window (the public page). A modal preview sets
   *  false and handles focus itself. */
  keyboard?: boolean;
}

/**
 * The keepsake film, for the RECIPIENT — card-view hands back a 1h signed MP4
 * whenever the card has a finished render, and this is the only place a
 * non-member can watch it. Collapsed by default so the card itself stays the
 * hero (and nothing is fetched until it is asked for).
 */
function KeepsakeFilm({ url, reducedMotion }: { url: string; reducedMotion: boolean }) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Opening IS the gesture, so a play attempt is legitimate here; if the
    // browser refuses it anyway (Low Power Mode, autoplay policy), the native
    // controls are already on screen — nothing to recover.
    videoRef.current?.play().catch(() => {});
  }, [open]);

  return (
    <section className="shrink-0 mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="bw-cta liquid-glass group flex w-full min-h-[52px] items-center gap-3 rounded-full py-1.5 pl-1.5 pr-4 text-left"
      >
        <ShimmerRim radius="9999px" lapS={10} base={0.24} reducedMotion={reducedMotion} />
        <span
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-brand-fg transition group-hover:scale-105"
          style={{
            background: 'rgba(var(--accent-rgb),0.22)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.4), 0 0 22px -4px rgba(var(--accent-rgb),0.9)',
          }}
        >
          <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block font-serif text-[16px] font-medium leading-tight text-brand-fg">Watch the keepsake film</span>
          <span className="block text-[12px] text-brand-fg/65">Everyone's messages, cut into one film</span>
        </span>
        <ChevronDown
          className={`relative h-4 w-4 shrink-0 text-brand-fg/60 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <video
          ref={videoRef}
          src={url}
          controls
          playsInline
          preload="metadata"
          className="mt-3 w-full rounded-[1.4rem] bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.16),0_24px_60px_-20px_rgba(10,8,40,0.85)]"
        />
      )}
    </section>
  );
}

export default function CardExperience({
  card,
  contributions,
  overrides,
  reducedMotion,
  keyboard = true,
}: CardExperienceProps) {
  const presentation = normalizeCardPresentation(card.presentation);
  const theme = useMemo(() => normalizeCardTheme(card.theme), [card.theme]);
  const look = resolveCardLook(overrides?.look ?? presentation.look, theme?.vars);
  const palette = cardPalette(look, theme?.vars);
  const revealId = playableReveal(overrides?.reveal ?? presentation.reveal, hasWebGL());
  const Reveal = revealComponent(revealId);
  const { Component: Template, fullBleed } = resolveCardTemplate(overrides?.template ?? card.template);

  // `run` re-keys the reveal so Replay mounts a fresh one.
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<Phase>(Reveal ? 'reveal' : 'card');
  const [index, setIndex] = useState(0);

  // A different reveal (host preview switching options) restarts the moment.
  // Skips the first render: the initial state already matches.
  const lastReveal = useRef(Reveal);
  useEffect(() => {
    if (lastReveal.current === Reveal) return;
    lastReveal.current = Reveal;
    setPhase(Reveal ? 'reveal' : 'card');
    setIndex(0);
    setRun((r) => r + 1);
  }, [Reveal]);

  const finishReveal = useCallback(() => {
    setPhase((p) => (p === 'reveal' ? 'handoff' : p));
  }, []);

  useEffect(() => {
    if (phase !== 'handoff') return;
    const t = window.setTimeout(() => setPhase('card'), REVEAL_HANDOFF_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  const replay = useCallback(() => {
    if (!Reveal) return;
    setIndex(0);
    setRun((r) => r + 1);
    setPhase('reveal');
  }, [Reveal]);

  const goNext = useCallback(() => setIndex((i) => clampIndex(i + 1, contributions)), [contributions]);
  const goPrev = useCallback(() => setIndex((i) => clampIndex(i - 1, contributions)), [contributions]);

  useEffect(() => {
    if (!keyboard || phase === 'reveal') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, phase, goNext, goPrev]);

  // Event look: the snapshot's variables, inline on this root only.
  const rootStyle: CSSProperties | undefined =
    look === 'event' && theme
      ? ({
          ...theme.vars,
          backgroundColor: 'var(--color-brand-bg)',
          color: 'var(--color-brand-fg)',
          fontFamily: 'var(--font-sans)',
        } as CSSProperties)
      : undefined;

  const showCard = phase !== 'reveal';

  return (
    <div
      className={`absolute inset-0 flex flex-col overflow-hidden ${look === 'beamwall' ? 'app-bg' : ''}`}
      style={rootStyle}
      data-card-look={look}
      data-card-reveal={revealId}
    >
      {showCard && (
        <>
          {/* The designed space behind the card (crown, rays, bokeh, star
              linework) — reads the accent, so it follows the event's look,
              and is seeded per card so the sky is the same every visit. */}
          <CardField seed={`${card.title}|${card.publishedAt ?? ''}`} reducedMotion={reducedMotion} />
          <main
            className={`relative mx-auto flex min-h-0 w-full flex-1 flex-col pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] ${
              fullBleed ? 'max-w-none px-3 sm:px-6' : 'max-w-2xl px-4'
            }`}
          >
            {card.filmUrl && <KeepsakeFilm url={card.filmUrl} reducedMotion={reducedMotion} />}
            <Template
              card={card}
              contributions={contributions}
              index={index}
              onNext={goNext}
              onPrev={goPrev}
              reducedMotion={reducedMotion}
            />
          </main>
          {Reveal && phase === 'card' && (
            <footer className="relative flex shrink-0 justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={replay}
                className="bw-cta relative inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white/[0.05] px-4 text-[13px] text-brand-fg/75 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] backdrop-blur-md hover:text-brand-fg"
              >
                <ShimmerRim radius="9999px" trigger="hover" lapS={3.6} base={0.1} />
                <RotateCcw className="relative h-3.5 w-3.5" aria-hidden />
                <span className="relative">Replay the opening</span>
              </button>
            </footer>
          )}
        </>
      )}

      {Reveal && phase !== 'card' && (
        <div
          className="absolute inset-0 z-20 transition-opacity ease-out"
          style={{
            opacity: phase === 'handoff' ? 0 : 1,
            transitionDuration: `${REVEAL_HANDOFF_MS}ms`,
            pointerEvents: phase === 'handoff' ? 'none' : undefined,
          }}
        >
          <Suspense fallback={null}>
            <Reveal
              key={run}
              card={card}
              contributions={contributions}
              look={look}
              palette={palette}
              reducedMotion={reducedMotion}
              onDone={finishReveal}
            />
          </Suspense>
          {phase === 'reveal' && (
            <button
              type="button"
              onClick={finishReveal}
              className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 min-h-[44px] rounded-full px-4 text-xs text-brand-muted/80 transition hover:text-brand-fg"
            >
              Skip
            </button>
          )}
        </div>
      )}
    </div>
  );
}
