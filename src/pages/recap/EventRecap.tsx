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
import { ArrowRight, Check, Share2 } from 'lucide-react';
import type { Post } from '../../types';
import { loadEventConfig, type EventLoad, type RuntimeEvent } from '../../events/runtime';
import { fetchEventFilm, fetchPostsResult } from '../../lib/db';
import { getSavedPhotos } from '../../lib/session';
import { recapAccess, recapCountLine, recapCounts, stillPhotos } from '../../lib/eventRecap';
import { keepsakeTheme, normalizeKeepsakeSettings } from '../../lib/keepsakeSettings';
import { introSeenKey, recapEyebrow, recapGreeting, recapThemeVars, takeHomeChoices } from '../../lib/recapKeepsake';
import { copyText } from '../../lib/clipboard';
import FetchFailed from '../../components/ui/FetchFailed';
import RecapHero from './RecapHero';
import RecapAlbum from './RecapAlbum';
import RecapIntro from './RecapIntro';
import RecapBeamyCard from './RecapBeamyCard';
import RecapTakeHome from './RecapTakeHome';
import RecapReplay from './RecapReplay';
import { K_BODY, K_SECONDARY } from './recapStyles';

/** The replay needs a few moments to be worth watching. */
const REPLAY_MIN_POSTS = 3;

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
  | {
      phase: 'ready';
      event: RuntimeEvent;
      posts: Post[];
      postsFailed: boolean;
      /** The next-day keepsake film (migration 050); null = none, for any reason. */
      film: { filmUrl: string; posterUrl: string } | null;
    };

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
        // The film is read beside the album and can only ever add a block:
        // a failed read is the same as no film.
        const [posts, film] = await Promise.all([
          fetchPostsResult(event.eventId).catch(() => ({ rows: [], failed: true })),
          fetchEventFilm(event.eventId).catch(() => null),
        ]);
        if (!alive) return;
        settled = true;
        clearTimeout(deadline);
        setState({ phase: 'ready', event, posts: posts.rows, postsFailed: posts.failed, film });
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

  // The host's keepsake look. TOTAL: a missing, junk or newer-build config
  // renders exactly the Beamwall defaults, because the link is already mailed.
  const settings = useMemo(() => normalizeKeepsakeSettings(ready?.event.keepsakes), [ready]);
  const theme = keepsakeTheme(settings.theme);
  const themeVars = useMemo(() => recapThemeVars(theme), [theme]);

  // The opening moment: once per visit, never under reduced motion. Decided in
  // a LAYOUT effect so the album never flashes before the overlay covers it.
  // 'lifting' = the overlay is fading off: the hero and the section reveals
  // start then, so the page arrives as the intro leaves instead of after it.
  const [intro, setIntro] = useState<'pending' | 'play' | 'lifting' | 'done'>('pending');
  useLayoutEffect(() => {
    if (readyEventId === null) return;
    let seen = false;
    try {
      const key = introSeenKey(readyEventId);
      seen = window.sessionStorage.getItem(key) === '1';
      window.sessionStorage.setItem(key, '1');
    } catch {
      // Private mode / blocked storage: play it, every time — harmless.
    }
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setIntro(seen || reduced || reducedMotion ? 'done' : 'play');
    // Decided once per album; a later preference flip must not replay it.
  }, [readyEventId]);
  const liftIntro = useCallback(() => setIntro((s) => (s === 'play' ? 'lifting' : s)), []);
  const endIntro = useCallback(() => setIntro('done'), []);
  const introLifted = intro === 'lifting' || intro === 'done';

  const [shared, setShared] = useState(false);
  const share = useCallback(async () => {
    const url = window.location.href.split('#')[0];
    const title = ready?.event.config.copy.fullName ?? 'Event album';
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: `The album from ${title}`, url });
      } catch {
        // Cancelled — say nothing.
      }
      return;
    }
    if (await copyText(url)) {
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    }
  }, [ready]);

  // Section reveals, observed against this page's own scroll container — the
  // app shell is overflow-hidden, so the window never scrolls.
  useLayoutEffect(() => {
    if (ready === null || !introLifted) return;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null) return;
    return installReveals(content, scroller, reducedMotion);
  }, [ready, reducedMotion, introLifted]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // The keepsake email links to /r/<slug>#film. The block only exists once
  // the async read lands — after the browser has already looked for the
  // anchor — so the jump is made here.
  const hasFilm = ready?.film != null;
  useEffect(() => {
    if (!hasFilm || intro !== 'done' || window.location.hash !== '#film') return;
    document.getElementById('film')?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [hasFilm, intro, reducedMotion]);

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
  const { copy } = event.config;
  const countLine = recapCountLine(counts);
  const eyebrow = recapEyebrow(copy.eyebrow, copy.fullName, event.startsAt);
  const greeting = recapGreeting(settings, {
    eventName: copy.fullName,
    photos: counts.moments,
    guests: counts.guests,
    eventDate: event.startsAt ?? null,
    now: Date.now(),
    // Org names are not readable anonymously; the host's own signature wins.
    orgName: '',
  });
  const stills = stillPhotos(posts).length;
  const choices = state.postsFailed
    ? (state.film !== null && settings.downloads.film ? (['film'] as const) : [])
    : takeHomeChoices(settings.downloads, { film: state.film !== null, stills, moments: posts.length });

  return (
    <div
      ref={scrollRef}
      data-keepsake-theme={theme.id}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden hide-scrollbar text-[color:var(--k-ink)]"
      style={{ ...(themeVars as React.CSSProperties), background: 'var(--k-bg)' }}
    >
      {/* The theme's light: an accent bloom from the top, the glow colour low
          on the page, and one faint diagonal beam — Beamwall's signature. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 55% at 50% -5%, rgba(var(--k-accent-rgb),0.28) 0%, transparent 62%), radial-gradient(70% 45% at 85% 105%, rgba(var(--k-glow-rgb),0.16) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute -top-1/3 left-[58%] h-[160%] w-40 -rotate-[18deg] opacity-40 blur-3xl"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(var(--k-accent-rgb),0.35), rgba(var(--k-glow-rgb),0.25), transparent)' }}
        />
      </div>

      {(intro === 'play' || intro === 'lifting') && (
        <RecapIntro
          kind={theme.intro}
          eyebrow={eyebrow}
          title={copy.fullName}
          photos={posts}
          onLift={liftIntro}
          onDone={endIntro}
        />
      )}

      <div
        ref={contentRef}
        className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 pt-10 pb-16 sm:gap-20 sm:px-8"
      >
        <RecapHero
          eyebrow={eyebrow}
          title={copy.fullName}
          countLine={countLine}
          photos={posts}
          reducedMotion={reducedMotion}
          play={introLifted}
          actions={
            <button type="button" onClick={() => void share()} className={K_SECONDARY}>
              {shared ? <Check className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
              {shared ? 'Link copied' : 'Share the album'}
            </button>
          }
        />

        {settings.beamy && <RecapBeamyCard greeting={greeting} />}

        {choices.length > 0 && (
          <RecapTakeHome
            choices={choices}
            film={state.film}
            photos={posts}
            ownIds={savedIds}
            title={copy.fullName}
            subtitle={countLine}
            palette={[theme.palette.accent, theme.palette.glow]}
            filePrefix={copy.filePrefix}
          />
        )}

        {state.postsFailed ? (
          <div data-reveal>
            <FetchFailed what="the album" onRetry={retry} />
          </div>
        ) : posts.length === 0 ? (
          <p data-reveal className={`text-center ${K_BODY}`}>
            No photos made it to the wall at this one. If you were there and took some on the booth,
            they are still saved on the device you took them with.
          </p>
        ) : (
          <>
            {posts.length >= REPLAY_MIN_POSTS && <RecapReplay posts={posts} reducedMotion={reducedMotion} />}
            <RecapAlbum photos={posts} ownPhotos={ownPhotos} filePrefix={copy.filePrefix} />
          </>
        )}

        <footer data-reveal className="mt-2 flex flex-col items-center gap-5 border-t border-[color:var(--k-line)] pt-10 text-center">
          <p className="flex items-center gap-2 font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-muted)]">
            <span aria-hidden className="h-px w-6 bg-[color:var(--k-accent)]" />
            Made with Beamwall
            <span aria-hidden className="h-px w-6 bg-[color:var(--k-accent)]" />
          </p>
          <p className={`max-w-sm ${K_BODY}`}>
            The AR photo booth and live wall that turned last night into this album.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => void share()} className={K_SECONDARY}>
              {shared ? <Check className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
              {shared ? 'Link copied' : 'Share'}
            </button>
            <Link to="/" className={K_SECONDARY}>
              Make your own event <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
