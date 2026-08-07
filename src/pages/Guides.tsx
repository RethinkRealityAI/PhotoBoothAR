/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /guides and /guides/:slug — the public help surface.
 *
 * Structure is deliberately Landing.tsx's, because this page shares its chrome
 * and has to scroll the same way: the platform shell (AppShell in App.tsx) is
 * `h-screen overflow-hidden`, so THIS component owns scrolling via its own root
 * (`h-full overflow-y-auto`) and every ScrollTrigger is handed that element as
 * its scroller. The `overflow-x-clip` sits on <main>, not on the scroller —
 * Landing.tsx:642-648 explains why: CSS demotes clip to hidden on a scroll
 * container, and hidden still lets an anchor jump shove the page sideways.
 *
 * An unrecognised slug renders the hub with a short note rather than a 404. A
 * stale link from a printed sign or an old email should land somewhere useful.
 */
import { useLayoutEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import gsap from 'gsap';
import MarketingHeader from '../components/landing/MarketingHeader';
import MarketingFooter from '../components/landing/MarketingFooter';
import { applyReducedReveals, applyReveals } from '../components/landing/scrollReveal';
import GuideDetail from '../components/guides/GuideDetail';
import GuideHub from '../components/guides/GuideHub';
import { GUIDES, isGuideSlug } from '../lib/guidesContent';
import { usePageTitle } from '../lib/usePageTitle';

export default function Guides() {
  const { slug } = useParams();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const known = slug !== undefined && isGuideSlug(slug);
  const doc = known ? GUIDES[slug] : null;
  const missing = slug !== undefined && !known;

  usePageTitle(
    doc === null
      ? 'Guides · Beamwall'
      : `${doc.title} · Beamwall guides`,
  );

  // Scroll choreography, matching Landing: [data-reveal] slides in,
  // [data-reveal-stagger] cascades, [data-screen-tilt] leans a film upright.
  // Reduced motion gets a plain opacity fade rather than nothing at all.
  // Keyed on the slug: navigating between guides swaps the whole block set, so
  // the triggers have to be rebuilt against the new nodes.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    // A guide opened from another guide must start at the top; this page owns
    // its scroll container, so the router's own restoration never sees it.
    scroller.scrollTo({ top: 0, behavior: 'auto' });
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      applyReveals(content, scroller);
    });
    mm.add('(prefers-reduced-motion: reduce)', () => {
      applyReducedReveals(content, scroller);
    });
    return () => mm.revert();
  }, [slug]);

  return (
    <div
      ref={scrollRef}
      className="relative h-full w-full overflow-x-hidden overflow-y-auto scroll-smooth app-bg text-brand-fg"
    >
      <div ref={contentRef} className="relative z-10 mx-auto flex w-full max-w-5xl flex-col px-6 py-8">
        {/* anchorBase '/' — #demo and #pricing live on the landing page, so from
            here they have to be full paths, not same-page jumps. */}
        <MarketingHeader active="guides" anchorBase="/" />

        <main className="flex flex-1 flex-col items-center overflow-x-clip pb-10 text-center">
          {doc !== null ? (
            <GuideDetail doc={doc} />
          ) : (
            <GuideHub
              notice={
                missing
                  ? "We couldn't find that guide — it may have been renamed. Everything we have is below."
                  : undefined
              }
            />
          )}
        </main>

        <MarketingFooter />
      </div>
    </div>
  );
}
