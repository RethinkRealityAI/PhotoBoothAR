/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /c/:publicId — public greeting-card viewer.
 *
 * Fetches the published card via the card-view edge function and drives the
 * chosen template through the normalized progress model (index held HERE, the
 * templates are pure — see components/cards/templates/types.ts). Keyboard
 * arrows + on-screen controls advance pages; prefers-reduced-motion disables
 * page-turn animation. Theme-neutral platform styling (outside EventProvider).
 */
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { useParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { ChevronDown, Play } from 'lucide-react';
import { viewCard, type CardViewContribution, type CardViewData } from '../../lib/cards';
import Storybook from '../../components/cards/templates/Storybook';
import FilmStrip from '../../components/cards/templates/FilmStrip';
import Polaroid from '../../components/cards/templates/Polaroid';
import { clampIndex, type CardTemplateProps } from '../../components/cards/templates/types';
import { normalizeCardTemplate, type CardTemplateId } from '../../lib/cardTemplates';

/** The template registry — the ONE place a template id becomes a component.
 *  `normalizeCardTemplate` maps anything unknown (an id from a newer build, a
 *  hand-edited row) onto the default, so the map can never miss. */
const TEMPLATES: Record<CardTemplateId, ComponentType<CardTemplateProps>> = {
  storybook: Storybook,
  filmstrip: FilmStrip,
  polaroid: Polaroid,
};

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'ready'; card: CardViewData; contributions: CardViewContribution[] };

function CenterScreen({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center app-bg p-6">
      <div className="flex flex-col items-center gap-4 text-center animate-rise-in max-w-sm">
        <div className="w-12 h-12 rounded-full border border-accent/30 animate-pulse-glow" />
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">{eyebrow}</p>
        <h1 className="font-serif italic text-3xl text-foil-static">{title}</h1>
        {body && <p className="font-sans text-sm text-brand-muted/60 leading-relaxed">{body}</p>}
      </div>
    </div>
  );
}

/**
 * The keepsake film, for the RECIPIENT — card-view hands back a 1h signed MP4
 * whenever the card has a finished render, and this is the only place a
 * non-member can watch it. Collapsed by default so the card itself stays the
 * hero (and nothing is fetched until it is asked for).
 */
function KeepsakeFilm({ url }: { url: string }) {
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
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full min-h-[44px] items-center gap-3 rounded-2xl glass border border-accent/25 px-4 py-2.5 text-left transition hover:border-accent/45"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-2 transition group-hover:bg-accent/25">
          <Play className="w-3.5 h-3.5 translate-x-[1px]" fill="currentColor" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-label uppercase tracking-luxe text-[10px] text-brand-muted/55">Deluxe keepsake</span>
          <span className="block font-serif italic text-[15px] text-foil-static">Watch the keepsake film</span>
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-brand-muted/50 transition-transform ${open ? 'rotate-180' : ''}`}
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
          className="mt-2 w-full rounded-2xl border border-accent/20 bg-black shadow-[0_18px_60px_rgba(0,0,0,0.55)]"
        />
      )}
    </section>
  );
}

export default function CardViewer() {
  const { publicId = '' } = useParams<{ publicId: string }>();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [index, setIndex] = useState(0);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    setIndex(0);
    viewCard(publicId).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) {
        setState({ phase: 'missing' });
        return;
      }
      setState({ phase: 'ready', card: data.card, contributions: data.contributions });
      document.title = `${data.card.title} · Beamwall`;
    });
    return () => { alive = false; };
  }, [publicId]);

  const contributions = state.phase === 'ready' ? state.contributions : [];

  const goNext = useCallback(
    () => setIndex((i) => clampIndex(i + 1, contributions)),
    [contributions],
  );
  const goPrev = useCallback(
    () => setIndex((i) => clampIndex(i - 1, contributions)),
    [contributions],
  );

  // Keyboard navigation.
  useEffect(() => {
    if (state.phase !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.phase, goNext, goPrev]);

  if (state.phase === 'loading') {
    return <CenterScreen eyebrow="Greeting card" title="Opening your card…" />;
  }
  if (state.phase === 'missing') {
    return (
      <CenterScreen
        eyebrow="Greeting card"
        title="This card isn't available"
        body="It may not be published yet, or the link is incorrect. Double-check the link you were given."
      />
    );
  }

  const { card } = state;
  const Template = TEMPLATES[normalizeCardTemplate(card.template)];

  return (
    <div className="absolute inset-0 app-bg flex flex-col overflow-hidden">
      {/* soft ambient glow — neutral, no event theme */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(90% 60% at 50% 0%, rgba(var(--accent-rgb),0.07) 0%, transparent 60%)' }}
        aria-hidden
      />
      <main className="relative flex-1 min-h-0 w-full max-w-2xl mx-auto px-4 pt-4 pb-2 flex flex-col">
        {card.filmUrl && <KeepsakeFilm url={card.filmUrl} />}
        <Template
          card={card}
          contributions={contributions}
          index={index}
          onNext={goNext}
          onPrev={goPrev}
          reducedMotion={reducedMotion}
        />
      </main>
    </div>
  );
}
