/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /c/:publicId — public greeting-card viewer.
 *
 * Fetches the published card via the card-view edge function and hands it to
 * CardExperience (components/cards/CardExperience.tsx), which plays the host's
 * chosen opening reveal and then the card template. The host's full-screen
 * preview renders the same component, so a host sees exactly this.
 *
 * Assessment overrides: `?reveal=` / `?template=` / `?look=` try any option on
 * a real card without saving anything (lib/cardPresentation.ts
 * parseCardViewOverrides — cosmetic, per-visit, unknown values ignored).
 *
 * This page renders OUTSIDE EventProvider (it is anonymous and the event is not
 * in the URL), so it wears either the Beamwall brand look or the theme the
 * host snapshotted into the card itself (lib/cardTheme.ts), per the card's
 * presentation `look`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { viewCard, type CardViewContribution, type CardViewData } from '../../lib/cards';
import { useCardTheme } from '../../components/cards/useCardTheme';
import CardExperience from '../../components/cards/CardExperience';
import { normalizeCardPresentation, parseCardViewOverrides, resolveCardLook } from '../../lib/cardPresentation';
import { normalizeCardTheme } from '../../lib/cardTheme';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'ready'; card: CardViewData; contributions: CardViewContribution[] };

function CenterScreen({ title, body }: { title: string; body?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center app-bg p-6">
      <div className="flex flex-col items-center gap-4 text-center animate-rise-in max-w-sm">
        <div className="w-12 h-12 rounded-full border border-accent/30 animate-pulse-glow" />
        <h1 className="font-serif text-3xl text-brand-fg">{title}</h1>
        {body && <p className="font-sans text-sm text-brand-muted leading-relaxed">{body}</p>}
      </div>
    </div>
  );
}

export default function CardViewer() {
  const { publicId = '' } = useParams<{ publicId: string }>();
  const { search } = useLocation();
  const overrides = useMemo(() => parseCardViewOverrides(search), [search]);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const reducedMotion = useReducedMotion() ?? false;

  // The event look needs its webfont on the page (the colours are painted
  // inline by CardExperience). The Beamwall look paints nothing.
  const ready = state.phase === 'ready' ? state.card : null;
  const wantsEventLook =
    !!ready &&
    resolveCardLook(
      overrides.look ?? normalizeCardPresentation(ready.presentation).look,
      normalizeCardTheme(ready.theme)?.vars,
    ) === 'event';
  useCardTheme(wantsEventLook ? ready.theme : null);

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    viewCard(publicId).then(({ data, error }) => {
      if (!alive) return;
      // A body without a card (an older or misbehaving card-view deployment)
      // used to reach `data.card.title` and crash the whole page into the
      // app error screen. It is the same thing to a guest as a missing card.
      if (error || !data || data.card == null) {
        setState({ phase: 'missing' });
        return;
      }
      setState({ phase: 'ready', card: data.card, contributions: Array.isArray(data.contributions) ? data.contributions : [] });
      document.title = `${data.card.title} · Beamwall`;
    });
    return () => { alive = false; };
  }, [publicId]);

  if (state.phase === 'loading') {
    return <CenterScreen title="Opening your card…" />;
  }
  if (state.phase === 'missing') {
    return (
      <CenterScreen
        title="This card isn't available"
        body="It may not be published yet, or the link is incorrect. Double-check the link you were given."
      />
    );
  }

  return (
    <CardExperience
      card={state.card}
      contributions={state.contributions}
      overrides={overrides}
      reducedMotion={reducedMotion}
    />
  );
}
