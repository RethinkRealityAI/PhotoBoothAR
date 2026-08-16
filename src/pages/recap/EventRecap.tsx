/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /r/:slug — the public post-event album.
 *
 * WHY IT MOUNTS OUTSIDE EventProvider. Ending an event closes its whole guest
 * subtree: for a signed-out visitor the provider renders "This event has ended"
 * INSTEAD of its children (EventContext + lib/eventAccess), which is exactly
 * right for the booth — nobody should be able to post to a party that is over —
 * and exactly wrong for a recap, whose entire job is to outlive the night. So
 * this page is a sibling of /c/:publicId, resolving the slug itself through
 * `loadEventConfig` and reading the same public posts view the wall does. Access
 * is its own rule (`recapAccess`), pure and tested, rather than a second meaning
 * bolted onto `guestAccess`.
 *
 * WHAT IT COSTS US TO SERVE. Nothing per guest. The album is public storage URLs
 * the browser fetches directly, and the keepsake collage is drawn on the guest's
 * own device (see lib/recapCollage.ts). A thousand guests downloading a thousand
 * collages is a thousand canvases and zero renders.
 *
 * HONESTY ON BAD WIFI. The provider's venue-wifi deadline is copied here for the
 * same reason it exists there: a blackhole network never rejects, so without a
 * bound the page would spin forever. After 10s the honest unreachable screen
 * appears with a retry, and a late success still upgrades it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import gsap from 'gsap';
import { ArrowRight } from 'lucide-react';
import type { Post } from '../../types';
import { loadEventConfig, type EventLoad, type RuntimeEvent } from '../../events/runtime';
import { fetchPostsResult } from '../../lib/db';
import { getSavedPhotos } from '../../lib/session';
import { recapAccess, recapCountLine, recapCounts } from '../../lib/eventRecap';
import FetchFailed from '../../components/ui/FetchFailed';
import RecapHero from './RecapHero';
import RecapAlbum from './RecapAlbum';
import RecapCollageCard from './RecapCollageCard';

/** Same bound, same reason, as EVENT_LOAD_DEADLINE_MS in EventContext. */
const RECAP_LOAD_DEADLINE_MS = 10_000;

/**
 * Reveal `[data-reveal]` sections as they come into view.
 *
 * WHY NOT `components/landing/scrollReveal`. That module — the marketing page's
 * reveals — triggers on `start: 'top 85%'`, i.e. "when the element's top passes
 * 85% down the scroller". On the landing page that is right, but it has a
 * failure mode this page walks straight into: the LAST element on a page can
 * never reach 85% of the viewport, because the page stops scrolling when its
 * own bottom does. Measured here on a 14-photo album at 1440×900: the footer
 * bottoms out with its top at 787px against a 765px threshold, so it stayed at
 * `opacity: 0` FOREVER — and the tween's own `y: 64` from-state was what pushed
 * it those last 64px out of reach. The same trap eats every section on a short
 * album, where the page barely scrolls at all.
 *
 * An IntersectionObserver has no threshold to miss: an element that is on
 * screen intersects, full stop. And when there is no observer to be had, this
 * hides nothing at all — the failure mode of a reveal must be "no animation",
 * never "no content".
 */
function installReveals(content: HTMLElement, root: HTMLElement, reduced: boolean): () => void {
  const els = Array.from(content.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (els.length === 0 || typeof IntersectionObserver === 'undefined') return () => {};
  // Reduced motion still fades — movement is what the preference is about, and
  // an element that only ever appears via a tween you declined to run is an
  // element nobody sees.
  const ctx = gsap.context(() => {
    gsap.set(els, reduced ? { opacity: 0 } : { opacity: 0, y: 48 });
  }, content);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        gsap.to(e.target, reduced
          ? { opacity: 1, duration: 0.45, ease: 'none' }
          : { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' });
      }
    },
    // No rootMargin: a section is revealed the instant any part of it is on
    // screen. Insetting the bottom edge would re-create exactly the
    // unreachable-threshold bug this function exists to avoid.
    { root },
  );
  els.forEach((el) => io.observe(el));
  return () => { io.disconnect(); ctx.revert(); };
}

type LoadState =
  | { phase: 'loading' }
  /** The lookup answered: there is no event at this slug. */
  | { phase: 'missing' }
  /** No answer at all — offline, RLS, 5xx. Recoverable, so it retries. */
  | { phase: 'unreachable' }
  /** The event exists but has no night to look back on (draft, or a status we
   *  do not recognise — an unknown status must never publish an album). */
  | { phase: 'closed'; event: RuntimeEvent }
  | { phase: 'ready'; event: RuntimeEvent; posts: Post[]; postsFailed: boolean };

function CenterScreen({
  eyebrow,
  title,
  body,
  onRetry,
  spinning = true,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  onRetry?: () => void;
  spinning?: boolean;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center app-bg p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center animate-rise-in">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 rounded-full border border-white/15 animate-pulse-glow" />
          {spinning && (
            <div className="absolute inset-1 animate-spin rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)]" />
          )}
        </div>
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">{eyebrow}</p>
        <h1 className="font-serif italic text-3xl text-foil-static">{title}</h1>
        {body !== undefined && (
          <p className="font-sans text-sm leading-relaxed text-brand-muted/60">{body}</p>
        )}
        {onRetry !== undefined && (
          <button
            onClick={onRetry}
            className="mt-2 min-h-11 rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[11px] text-[color:var(--on-accent)]"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export default function EventRecap() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const reducedMotion = useReducedMotion() ?? false;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    let settled = false;
    const deadline = setTimeout(() => {
      if (alive && !settled) setState({ phase: 'unreachable' });
    }, RECAP_LOAD_DEADLINE_MS);

    void loadEventConfig(slug)
      .catch((e): EventLoad => {
        console.error('[recap] loadEventConfig threw', e);
        return { event: null, error: 'unreachable' };
      })
      .then(async ({ event, error }) => {
        if (!alive) return;
        if (error === 'unreachable') {
          settled = true;
          clearTimeout(deadline);
          setState({ phase: 'unreachable' });
          return;
        }
        if (event === null) {
          settled = true;
          clearTimeout(deadline);
          setState({ phase: 'missing' });
          return;
        }
        if (recapAccess(event.status) !== 'open') {
          settled = true;
          clearTimeout(deadline);
          setState({ phase: 'closed', event });
          return;
        }
        // The album's own read. It is allowed to fail on its own — the event
        // resolved, so the page can still name itself and say what went wrong
        // rather than pretending the night had no photos in it.
        const posts = await fetchPostsResult(event.eventId).catch(() => ({ rows: [], failed: true }));
        if (!alive) return;
        settled = true;
        clearTimeout(deadline);
        setState({ phase: 'ready', event, posts: posts.rows, postsFailed: posts.failed });
      });

    return () => { alive = false; clearTimeout(deadline); };
  }, [slug, attempt]);

  const ready = state.phase === 'ready' ? state : null;

  useEffect(() => {
    if (ready === null) return;
    document.title = `${ready.event.config.copy.fullName} · Event album`;
  }, [ready]);

  /** This device's own post ids, exactly as the wall reads them (localStorage,
   *  written by the booth at send time). A visitor who was never at the booth —
   *  or a projector — simply has none, and the personal rail does not render. */
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const readyEventId = ready?.event.eventId ?? null;
  useEffect(() => {
    if (readyEventId === null) return;
    setSavedIds(new Set(getSavedPhotos(readyEventId).map((p) => p.id)));
  }, [readyEventId]);

  const posts = ready?.posts ?? [];
  const ownPhotos = useMemo(() => posts.filter((p) => savedIds.has(p.id)), [posts, savedIds]);
  const counts = useMemo(() => recapCounts(posts), [posts]);

  // Section reveals, observed against this page's own scroll container — the
  // app shell is overflow-hidden, so the window never scrolls.
  useLayoutEffect(() => {
    if (ready === null) return;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null) return;
    return installReveals(content, scroller, reducedMotion);
  }, [ready, reducedMotion]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.phase === 'loading') {
    return <CenterScreen eyebrow="Event album" title="Opening the album…" />;
  }
  if (state.phase === 'unreachable') {
    return (
      <CenterScreen
        eyebrow="Event album"
        title="Can’t reach this album"
        body="Your link is fine — we just couldn’t load it. Check your connection and try again."
        onRetry={retry}
        spinning={false}
      />
    );
  }
  if (state.phase === 'missing') {
    return (
      <CenterScreen
        eyebrow="Event album"
        title="No album here"
        body="We couldn’t find an event at this address. Double-check the link you were given."
        spinning={false}
      />
    );
  }
  if (state.phase === 'closed') {
    return (
      <CenterScreen
        eyebrow={state.event.config.copy.eyebrow}
        title="This album isn’t ready yet"
        body="The host is still setting this event up. Once the night has happened, this link is where the photos live."
        spinning={false}
      />
    );
  }

  const { event } = state;
  const { copy, accentHexes } = event.config;

  return (
    <div
      ref={scrollRef}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden app-bg hide-scrollbar"
    >
      {/* A soft wash in the event's own colour. The page chrome stays on the
          platform tokens — contrast there is tested and an event's palette is
          not — but the album is allowed to feel like the party it came from. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: `radial-gradient(95% 55% at 50% 0%, ${hexWash(accentHexes[0])} 0%, transparent 62%)`,
        }}
      />

      <div
        ref={contentRef}
        className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-12 px-5 pt-10 pb-16 sm:px-8"
      >
        <RecapHero
          eyebrow={copy.eyebrow}
          title={copy.fullName}
          countLine={recapCountLine(counts)}
          photos={posts}
          reducedMotion={reducedMotion}
        />

        {state.postsFailed ? (
          <div data-reveal>
            <FetchFailed what="the album" onRetry={retry} />
          </div>
        ) : posts.length === 0 ? (
          <p data-reveal className="text-center font-sans text-sm leading-relaxed text-brand-muted/60">
            No photos made it to the wall at this one. If you were there and took some on the booth,
            they are still saved on the device you took them with.
          </p>
        ) : (
          <>
            <div data-reveal>
              <RecapCollageCard
                photos={posts}
                ownIds={savedIds}
                title={copy.fullName}
                subtitle={recapCountLine(counts)}
                accentHexes={accentHexes}
                filePrefix={copy.filePrefix}
              />
            </div>
            <RecapAlbum photos={posts} ownPhotos={ownPhotos} filePrefix={copy.filePrefix} />
          </>
        )}

        <footer data-reveal className="mt-4 flex flex-col items-center gap-4 border-t border-white/8 pt-8 text-center">
          <p className="font-sans text-xs leading-relaxed text-brand-muted/50">
            This album was made with Beamwall — an AR photo booth and live wall for events.
          </p>
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-full glass px-6 font-label uppercase tracking-luxe text-[10px] text-brand-muted/80 transition-colors hover:text-accent"
          >
            Make your own event <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </Link>
        </footer>
      </div>
    </div>
  );
}

/**
 * An event accent as a faint wash, without dragging a colour library in.
 * Unparseable values (or none) fall back to the platform accent, so a broken
 * `accentHexes` costs a tint, never the page.
 */
function hexWash(hex: string | undefined): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (m === null) return 'rgba(var(--accent-rgb), 0.10)';
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, 0.13)`;
}
