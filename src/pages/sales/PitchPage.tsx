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
 *
 * Brand v2: the periwinkle scene (`app-bg`), a strip of glass for the header,
 * the display face for the wordmark and headings, white pill for the ask.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { getDeck, publicDeck, publicOfferPrice } from '../../lib/salesContent';
import type { Market } from '../../lib/salesTypes';
import { normalizeRef } from '../../lib/salesHub';
import { usePageTitle } from '../../lib/usePageTitle';
import SlideDeck, { useIsWide, type DeckEnv } from './components/SlideDeck';
import { CtaLink, PANE, type DeckCta } from './components/Slides';
import { useMetaTag, useNoIndex } from './components/pageMeta';
import { asksFor, contactLine, offersFromIds, type DeckBooking } from './components/deckEnv';
import { bookingPath } from '../../lib/booking';
import { fetchPublicBookingPage } from '../../lib/bookingApi';
import { BEAMY } from './salesImages';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
const headerBtn =
  `inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold leading-none transition active:scale-[0.98] ${focusRing} sm:px-5`;
/** Brand v2 primary: solid white pill, deep-indigo label. */
const primaryPill = 'bg-[color:var(--bw-accent)] text-[color:var(--bw-on-accent)] shadow-[0_10px_24px_-12px_rgba(26,23,64,0.5)] hover:bg-[color:var(--bw-accent-hover)]';
const wordmark = 'font-[family-name:var(--bw-font-display)] font-[750] leading-none tracking-[-0.035em] text-white';
const display = 'font-[family-name:var(--bw-font-display)] font-[720] tracking-[-0.022em] text-white';

function HeaderCta({ cta, primary }: { cta: DeckCta; primary: boolean }) {
  const cls = `${headerBtn} ${primary ? primaryPill : 'border-[1.5px] border-white/70 bg-[rgba(26,23,64,0.12)] text-white hover:border-white hover:bg-[rgba(26,23,64,0.28)]'}`;
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
    <header className="z-30 flex items-center justify-between gap-3 bg-[rgba(43,42,140,0.42)] px-4 py-2.5 shadow-[inset_0_-1px_0_rgba(255,255,255,0.18),0_12px_30px_-24px_rgba(22,18,78,0.7)] backdrop-blur-xl sm:px-6">
      <Link to="/" className={`rounded text-[22px] sm:text-[24px] ${wordmark} ${focusRing}`}>
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
      <div className="flex h-full w-full flex-col overflow-y-auto app-bg text-white [font-family:var(--bw-font-text)]">
        {header}
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <img src={BEAMY.src} width={BEAMY.width} height={BEAMY.height} alt="" className="h-auto w-40 motion-safe:animate-float" />
          <h1 className={`mt-6 text-balance text-4xl ${display}`}>This presentation has moved</h1>
          <p className="mt-4 text-white/[0.86]">
            The link may be out of date. Everything Beamwall does — the AR photo booth, the live wall and keepsake cards — is on our main site.
          </p>
          <Link to="/" className={`mt-8 inline-flex min-h-12 items-center gap-2 rounded-full px-8 text-[15px] font-semibold leading-none transition active:scale-[0.98] ${primaryPill} ${focusRing}`}>
            Visit Beamwall <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </Link>
        </main>
      </div>
    );
  }

  if (wide) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden app-bg text-white [font-family:var(--bw-font-text)]">
        {header}
        <h1 className="sr-only">{deck.name}: {deck.oneLiner}</h1>
        <main className="min-h-0 flex-1">
          <SlideDeck deck={deck} env={env} syncHash />
        </main>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-x-hidden overflow-y-auto scroll-smooth app-bg text-white [font-family:var(--bw-font-text)]">
      <div className="sticky top-0 z-30">{header}</div>
      <main className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
        <p className="flex flex-col gap-2.5 text-[14px] font-medium text-white">
          Beamwall for
          <span aria-hidden className="block h-[2px] w-7 rounded-full bg-white/70" />
        </p>
        <h1 className={`mt-2 text-[30px] leading-tight ${display}`}>{deck.name}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-white/[0.86]">{deck.oneLiner}</p>
        <div className="mt-6">
          <SlideDeck deck={deck} env={env} syncHash />
        </div>
        <div className="mt-8 flex flex-col items-stretch gap-3 rounded-[24px] p-5 text-center" style={PANE}>
          <p className={`text-2xl ${display}`}>Ready when you are.</p>
          <CtaLink cta={asks.primary} primary env={{ ...env, mode: 'card' }} />
          {asks.secondary !== undefined && <CtaLink cta={asks.secondary} primary={false} env={{ ...env, mode: 'card' }} />}
        </div>
      </main>
    </div>
  );
}
