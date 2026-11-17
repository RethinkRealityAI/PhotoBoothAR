/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /pitch/:slug — the deck a prospect was sent.
 *
 * Renders publicDeck(getDeck(slug)) ONLY: no speaker notes, no internal
 * audience line, and every price through publicOfferPrice() so a placeholder
 * number can never reach a prospect. Chrome is deliberately minimal.
 *
 * Market matters for the ask: North American decks push "Start free"
 * (self-serve checkout, ?ref= carried through to /signup). Nigerian clients
 * are invoiced — there is no payment flow for them — so an NG deck asks for a
 * call/chat instead and offers "See it live" as the secondary.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { getDeck, publicDeck, publicOfferPrice } from '../../lib/salesContent';
import type { Market } from '../../lib/salesTypes';
import { normalizeRef } from '../../lib/salesHub';
import { usePageTitle } from '../../lib/usePageTitle';
import SlideDeck, { useIsWide, type DeckEnv } from './components/SlideDeck';
import { CtaLink, type DeckCta } from './components/Slides';
import { useMetaTag, useNoIndex } from './components/pageMeta';
import { asksFor, contactLine, offersFromIds, type DeckBooking } from './components/deckEnv';
import { bookingPath } from '../../lib/booking';
import { fetchPublicBookingPage } from '../../lib/bookingApi';
import { BEAMY } from './salesImages';

const headerBtn =
  'inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 font-label text-[10.5px] font-bold uppercase tracking-[0.18em] transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:px-5';

function HeaderCta({ cta, primary }: { cta: DeckCta; primary: boolean }) {
  const cls = `${headerBtn} ${primary ? 'bg-foil text-white glow-accent' : 'border border-white/15 bg-white/[0.04] text-brand-fg hover:bg-white/[0.08]'}`;
  if (cta.external) {
    const mail = cta.href.startsWith('mailto:');
    return <a href={cta.href} className={cls} {...(mail ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{cta.label}</a>;
  }
  return <Link to={cta.href} className={cls}>{cta.label}</Link>;
}

export default function PitchPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const ref = normalizeRef(params.get('ref'));
  const wide = useIsWide();

  const source = getDeck(slug);
  const deck = useMemo(() => (source === undefined ? null : publicDeck(source)), [source]);
  // Market is read from the source deck: it is not internal, and the public
  // copy is only the gate for notes/audience.
  const market: Market = source?.market === 'na' ? 'na' : 'ng';
  // The rep's booking page, if their ref is on the link and the page is live.
  // Any failure (042 not applied, offline) just means no booking button.
  const [booking, setBooking] = useState<DeckBooking | null>(null);
  useEffect(() => {
    if (ref === '') return;
    let live = true;
    void fetchPublicBookingPage(ref).then((r) => {
      if (live && r.data !== null && r.data !== undefined) setBooking({ href: bookingPath(r.data.ref), repName: r.data.rep_name });
    });
    return () => { live = false; };
  }, [ref]);
  const asks = asksFor(market, ref, booking);

  const title = deck === null ? 'Beamwall' : `${deck.name} · Beamwall`;
  usePageTitle(title);
  useNoIndex();
  useMetaTag('property', 'og:title', title);
  useMetaTag('property', 'og:description', deck?.oneLiner ?? 'Live AR photo booth and photo wall for events.');

  const env: DeckEnv = {
    offersFor: offersFromIds,
    priceFor: publicOfferPrice,
    placeholderBadges: false,
    primaryCta: asks.primary,
    secondaryCta: asks.secondary,
    contactLine: contactLine(),
  };

  const header = (
    <header className="z-30 flex items-center justify-between gap-3 border-b border-white/5 bg-brand-bg/75 px-4 py-2.5 backdrop-blur-md sm:px-6">
      <Link to="/" className="rounded font-serif text-xl font-semibold tracking-wide text-foil-static focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:text-2xl">
        Beamwall
      </Link>
      <nav className="flex items-center gap-2" aria-label="Get started">
        {asks.secondary !== undefined && (
          <span className="hidden sm:inline-flex"><HeaderCta cta={asks.secondary} primary={false} /></span>
        )}
        <HeaderCta cta={asks.primary} primary />
      </nav>
    </header>
  );

  if (deck === null) {
    return (
      <div className="flex h-full w-full flex-col overflow-y-auto app-bg text-brand-fg">
        {header}
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <img src={BEAMY.src} width={BEAMY.width} height={BEAMY.height} alt="" className="h-auto w-40 motion-safe:animate-float" />
          <h1 className="mt-6 font-serif text-4xl font-semibold text-foil-static">This presentation has moved</h1>
          <p className="mt-4 text-brand-muted">
            The link may be out of date. Everything Beamwall does — the AR photo booth, the live wall and keepsake cards — is on our main site.
          </p>
          <Link to="/" className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full bg-foil px-8 py-3.5 font-label text-[12px] font-bold uppercase tracking-[0.2em] text-white glow-accent">
            Visit Beamwall <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </main>
      </div>
    );
  }

  if (wide) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-[#03040a] text-brand-fg">
        {header}
        <h1 className="sr-only">{deck.name}: {deck.oneLiner}</h1>
        <main className="min-h-0 flex-1">
          <SlideDeck deck={deck} env={env} syncHash />
        </main>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-x-hidden overflow-y-auto scroll-smooth app-bg text-brand-fg">
      <div className="sticky top-0 z-30">{header}</div>
      <main className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
        <p className="font-label text-[10px] font-semibold uppercase tracking-[0.26em]" style={{ color: `rgb(${deck.rgb})` }}>
          Beamwall for
        </p>
        <h1 className="mt-1 font-serif text-[30px] font-semibold leading-tight text-brand-fg">{deck.name}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-brand-muted">{deck.oneLiner}</p>
        <div className="mt-6">
          <SlideDeck deck={deck} env={env} syncHash />
        </div>
        <div className="mt-8 flex flex-col items-stretch gap-3 rounded-[28px] liquid-glass p-5 text-center">
          <p className="font-serif text-2xl text-brand-fg">Ready when you are.</p>
          <CtaLink cta={asks.primary} primary env={{ ...env, mode: 'card', rgb: deck.rgb }} />
          {asks.secondary !== undefined && <CtaLink cta={asks.secondary} primary={false} env={{ ...env, mode: 'card', rgb: deck.rgb }} />}
        </div>
      </main>
    </div>
  );
}
