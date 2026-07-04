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
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { viewCard, type CardViewContribution, type CardViewData } from '../../lib/cards';
import Storybook from '../../components/cards/templates/Storybook';
import FilmStrip from '../../components/cards/templates/FilmStrip';
import { clampIndex } from '../../components/cards/templates/types';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'ready'; card: CardViewData; contributions: CardViewContribution[] };

function CenterScreen({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center app-bg p-6">
      <div className="flex flex-col items-center gap-4 text-center animate-rise-in max-w-sm">
        <div className="w-12 h-12 rounded-full border border-gold-400/30 animate-pulse-glow" />
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">{eyebrow}</p>
        <h1 className="font-serif italic text-3xl text-foil-static">{title}</h1>
        {body && <p className="font-sans text-sm text-brand-muted/60 leading-relaxed">{body}</p>}
      </div>
    </div>
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
  const Template = card.template === 'filmstrip' ? FilmStrip : Storybook;

  return (
    <div className="absolute inset-0 app-bg flex flex-col overflow-hidden">
      {/* soft ambient glow — neutral, no event theme */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(90% 60% at 50% 0%, rgba(212,175,55,0.07) 0%, transparent 60%)' }}
        aria-hidden
      />
      <main className="relative flex-1 min-h-0 w-full max-w-2xl mx-auto px-4 pt-4 pb-2 flex flex-col">
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
