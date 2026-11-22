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
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react';
import { ChevronDown, Play, RotateCcw } from 'lucide-react';
import type { CardViewContribution, CardViewData } from '../../lib/cards';
import {
  cardPalette,
  effectiveReveal, firstReadingPage,
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
import { cardDesign, designAssets, designCssVars } from '../../lib/cardDesigns';
import SceneBackdrop from './scenes/SceneBackdrop';
import { MidPair } from './scenes/sceneParts';
import { designSkin } from '../../lib/designSkins';
import { DesignSkinContext } from './designSkin';

/** A design's opening is its own lazy chunk, like every other reveal. */
const SceneOpener = lazy(() => import('./scenes/SceneOpener'));

type Phase = 'reveal' | 'handoff' | 'card';

/** The reveal layer's fade-out, and when the card starts fading in — both
 *  inside REVEAL_HANDOFF_MS, so the two never cross at full strength. */
const REVEAL_FADE_MS = 300;
const REVEAL_CARD_DELAY_MS = 220;

/**
 * A design's scene hands over more slowly: its last frame IS the backdrop the
 * card sits on, so the opener dissolves into it while the card rises in from
 * just below. The card is mounted (hidden) under the opener from the start,
 * so nothing loads or lays out during the hand-off — that load was the stutter.
 */
const SCENE_HANDOFF_MS = 1250;
const SCENE_FADE_MS = 800;
const SCENE_CARD_DELAY_MS = 160;
const SCENE_RISE_MS = 1050;
/** A long, soft settle (easeOutExpo-like): fast start, no visible stop. */
const SETTLE = 'cubic-bezier(0.16, 1, 0.3, 1)';

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
  // An illustrated design brings its own opening and colours (lib/cardDesigns.ts).
  const designChoice = overrides?.design ?? presentation.design;
  const design = designChoice === 'none' ? null : cardDesign(designChoice);
  const opening = effectiveReveal(overrides?.reveal ?? presentation.reveal, designChoice);
  const look = resolveCardLook(overrides?.look ?? presentation.look, theme?.vars);
  const palette = design
    ? { bg: design.palette.bg, fg: design.palette.fg, accent: design.palette.accent, accentRgb: design.palette.accentRgb }
    : cardPalette(look, theme?.vars);
  const revealId = opening === 'scene' ? 'scene' : playableReveal(opening, hasWebGL());
  const Reveal = revealId === 'scene' ? null : revealComponent(revealId);
  const hasOpening = revealId === 'scene' || Reveal !== null;
  /** Identity of the opening: a change (host flipping options) restarts it. */
  const openingKey = revealId === 'scene' ? `scene:${design?.id ?? ''}` : revealId;
  // How far the reader is through whatever scrolls inside the card, for the
  // design backdrop's parallax. A ref, not state: it changes every frame.
  const scrollRef = useRef(0);
  const onScrollCapture = useCallback((e: UIEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    const max = el.scrollHeight - el.clientHeight;
    const maxX = el.scrollWidth - el.clientWidth;
    if (max > 4) scrollRef.current = el.scrollTop / max;
    else if (maxX > 4) scrollRef.current = el.scrollLeft / maxX;
  }, []);
  const { Component: Template, fullBleed } = resolveCardTemplate(overrides?.template ?? card.template);

  // `run` re-keys the reveal so Replay mounts a fresh one.
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<Phase>(hasOpening ? 'reveal' : 'card');
  // A design's scene is not WebGL, so the card can wait, mounted and hidden,
  // under its opening (other reveals keep the one-GPU-context rule: the card
  // mounts only after them).
  const premount = design !== null && revealId === 'scene';
  const [index, setIndex] = useState(() => (premount ? firstReadingPage(true, contributions.length) : 0));

  // A different opening (host preview switching options) restarts the moment.
  // Skips the first render: the initial state already matches.
  const lastOpening = useRef(openingKey);
  useEffect(() => {
    if (lastOpening.current === openingKey) return;
    lastOpening.current = openingKey;
    setPhase(hasOpening ? 'reveal' : 'card');
    setIndex(premount ? firstReadingPage(true, contributions.length) : 0);
    setRun((r) => r + 1);
  }, [openingKey, hasOpening, premount, contributions.length]);

  // The opening was the "open your card" moment: land on the first message,
  // not on a cover asking them to open it again.
  const readingStart = firstReadingPage(hasOpening, contributions.length);
  const finishReveal = useCallback(() => {
    setPhase((p) => (p === 'reveal' ? 'handoff' : p));
    setIndex(readingStart);
  }, [readingStart]);

  useEffect(() => {
    if (phase !== 'handoff') return;
    const t = window.setTimeout(() => setPhase('card'), premount ? SCENE_HANDOFF_MS : REVEAL_HANDOFF_MS);
    return () => window.clearTimeout(t);
  }, [phase, premount]);

  const replay = useCallback(() => {
    if (!hasOpening) return;
    setIndex(premount ? readingStart : 0);
    setRun((r) => r + 1);
    setPhase('reveal');
  }, [hasOpening, premount, readingStart]);

  const goNext = useCallback(() => setIndex((i) => clampIndex(i + 1, contributions)), [contributions]);
  const goPrev = useCallback(
    () => setIndex((i) => Math.max(readingStart, clampIndex(i - 1, contributions))),
    [contributions, readingStart],
  );

  useEffect(() => {
    if (!keyboard || phase === 'reveal') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, phase, goNext, goPrev]);

  // Design: its palette as the semantic tokens every template reads. Event
  // look: the snapshot's variables. Inline on this root only either way.
  const rootStyle: CSSProperties | undefined = design
    ? ({
        ...designCssVars(design),
        backgroundColor: 'var(--color-brand-bg)',
        color: 'var(--color-brand-fg)',
      } as CSSProperties)
    : look === 'event' && theme
      ? ({
          ...theme.vars,
          backgroundColor: 'var(--color-brand-bg)',
          color: 'var(--color-brand-fg)',
          fontFamily: 'var(--font-sans)',
        } as CSSProperties)
      : undefined;

  const showCard = phase !== 'reveal' || premount;
  // The design's reading-view skin (photo frames, corner cut-outs), read by the templates.
  const skin = useMemo(() => (design ? designSkin(design.id) : null), [design]);

  // Hand-off choreography: the reveal fades out FAST and the card fades in a
  // beat later, so the reveal's title and the template's title (which sit at
  // different heights) are never both legible at once.
  const [cardIn, setCardIn] = useState(phase === 'card');
  useEffect(() => {
    if (phase === 'reveal') {
      setCardIn(false);
      return;
    }
    if (phase !== 'handoff') {
      setCardIn(true);
      return;
    }
    const t = window.setTimeout(() => setCardIn(true), premount ? SCENE_CARD_DELAY_MS : REVEAL_CARD_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [phase, premount]);

  // The card's entrance. A design's card rises and settles into place
  // (transform + opacity only: both run on the compositor, so the phone never
  // re-lays the page out mid-move); reduced motion keeps the fade alone.
  const mainMotion: CSSProperties = premount
    ? {
        opacity: cardIn ? 1 : 0,
        // The page grows out of the gateway it came through (the scene's centre).
        transform: cardIn || reducedMotion ? 'none' : 'translate3d(0, 22px, 0) scale(0.9)',
        transformOrigin: '50% 47%',
        transition: `opacity ${SCENE_RISE_MS * 0.7}ms ${SETTLE}, transform ${SCENE_RISE_MS}ms ${SETTLE}`,
        willChange: cardIn ? undefined : 'opacity, transform',
      }
    : { opacity: cardIn ? 1 : 0, transitionDuration: `${REVEAL_HANDOFF_MS - REVEAL_CARD_DELAY_MS}ms` };

  return (
    <DesignSkinContext.Provider value={skin}>
    <div
      className={`absolute inset-0 flex flex-col overflow-hidden ${!design && look === 'beamwall' ? 'app-bg' : ''}`}
      style={rootStyle}
      data-card-look={design ? 'design' : look}
      data-card-design={design?.id}
      data-card-reveal={revealId}
    >
      {showCard && (
        <>
          {/* The designed space behind the card (crown, rays, bokeh, star
              linework) — reads the accent, so it follows the event's look,
              and is seeded per card so the sky is the same every visit. */}
          {design ? (
            <SceneBackdrop
              design={design}
              scrollRef={scrollRef}
              reducedMotion={reducedMotion}
              seed={`${card.title}|${card.publishedAt ?? ''}`}
              arrived={phase !== 'reveal'}
            />
          ) : (
            <CardField seed={`${card.title}|${card.publishedAt ?? ''}`} reducedMotion={reducedMotion} />
          )}
          <main
            onScrollCapture={design ? onScrollCapture : undefined}
            className={`relative mx-auto flex min-h-0 w-full flex-1 flex-col pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] ${
              premount ? '' : 'transition-opacity ease-out'
            } ${
              design
                ? // Inside the scene's own portrait column, never wider than the art.
                  'max-w-[min(100%,calc(100dvh*9/16))] px-4'
                : fullBleed
                  ? 'max-w-none px-3 sm:px-6'
                  : 'max-w-2xl px-4'
            }`}
            style={mainMotion}
            // Waiting under the opening: hidden from screen readers and taps.
            aria-hidden={cardIn ? undefined : true}
            inert={!cardIn}
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
          {/* The scene's foreground cut-outs hang IN FRONT of the page, like the
              front layer of a paper diorama (the pager and footer sit above them). */}
          {design && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1/2 z-10 aspect-[9/16] h-full max-w-full -translate-x-1/2"
            >
              <MidPair src={designAssets(design.id).mid} design={design} />
            </div>
          )}
          {hasOpening && phase === 'card' && (
            <footer className="card-footer-in relative z-20 flex shrink-0 justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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

      {hasOpening && phase !== 'card' && (
        <div
          className="absolute inset-0 z-20 transition-opacity ease-out"
          style={{
            opacity: phase === 'handoff' ? 0 : 1,
            transitionDuration: `${premount ? SCENE_FADE_MS : REVEAL_FADE_MS}ms`,
            transitionTimingFunction: premount ? 'cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
            pointerEvents: phase === 'handoff' ? 'none' : undefined,
          }}
        >
          <Suspense fallback={null}>
            {design && revealId === 'scene' ? (
              <SceneOpener
                key={`${run}:${design.id}`}
                design={design}
                card={card}
                contributions={contributions}
                look={look}
                palette={palette}
                reducedMotion={reducedMotion}
                onDone={finishReveal}
              />
            ) : (
              Reveal && (
                <Reveal
                  key={run}
                  card={card}
                  contributions={contributions}
                  look={look}
                  palette={palette}
                  reducedMotion={reducedMotion}
                  onDone={finishReveal}
                />
              )
            )}
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
    </DesignSkinContext.Provider>
  );
}
