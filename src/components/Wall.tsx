/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wall — the projected live photo wall for any Beamwall event (multi-tenant;
 * themed per event via EventProvider/branding).
 *
 * Four modes:
 *   Gallery    — responsive masonry grid, newest first, gentle entrance.
 *   Slideshow  — full-bleed single post, Ken-Burns drift (images), auto-advance 6 s.
 *   Leaderboard — points leaderboard (shown only when wallSettings.showLeaderboard).
 *   Projection — kiosk/projector mode: hides ALL chrome; shows only content + dust
 *                (plus a compact join-QR chip when showQR is on).
 *
 * Settings (live via subscribeToSettings):
 *   showQR            — hides/shows the QR panels instantly.
 *   showLeaderboard   — enables the Leaderboard tab in the mode picker.
 *   showChallenges    — shows/hides the challenges ticker strip.
 *   featuredSpotlight — periodic full-screen photo/CTA spotlight in Gallery mode.
 *
 * `mode`, `projectionMode` and the per-device QR override persist to
 * localStorage (beamwall:wall:<eventId>) so a projector refresh restores the
 * wall exactly as the operator left it.
 *
 * Realtime: subscribeToPosts, with its channel status surfaced as a discreet
 * LIVE / RECONNECTING indicator — a socket that dies on venue wifi used to be
 * completely unobserved, and the wall silently stopped celebrating arrivals.
 * Fallback poll adapts to that status (lib/wallRuntime.pollActionFor) and stops
 * dead while the wall is hidden.
 *
 * Arrivals: <ArrivalBeam/> carries the guest's ACTUAL photo into its real tile;
 * choreography (serialising, bounding, coalescing a rush) is decided by the
 * pure queue in lib/wallArrivals.
 */
import { useEffect, useState, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QrCode } from 'lucide-react';
import { useStore } from '../store';
import { useEvent } from '../events/EventContext';
import { fetchPostsResult, subscribeToPosts, subscribeToSettings } from '../lib/db';
import { getSavedPhotos } from '../lib/session';
import { Post } from '../types';
import EventBackground from './ui/EventBackground';
import { Wordmark } from './ui/EventLogo';
import GuestNav from './ui/GuestNav';
import ShareButton from './ui/ShareButton';
import ArrivalBeam from './wall/ArrivalBeam';
import MosaicGrid from './wall/MosaicGrid';
import MarqueeGrid from './wall/MarqueeGrid';
import SlideshowView from './wall/SlideshowView';
import LeaderboardView from './wall/LeaderboardView';
import WallQRCodes, { QRPanel } from './wall/WallQRCodes';
import ChallengesTicker from './wall/ChallengesTicker';
import WallLightbox from './wall/WallLightbox';
import FeaturedSpotlight from './wall/FeaturedSpotlight';
import EmptyWall from './wall/EmptyWall';
import FetchFailed from './ui/FetchFailed';
import { listState } from '../lib/listState';
import {
  COALESCE_GRACE_MS,
  ceremonyIds,
  emptyArrivalQueue,
  enqueueArrival,
  finishCeremony,
  spotlightIdFor,
  startNextCeremony,
  type BeamRect,
} from '../lib/wallArrivals';
import {
  INCREMENTAL_LIMIT,
  POLL_TICK_MS,
  burnInOffset,
  pollActionFor,
  socketStatusFrom,
  type SocketStatus,
} from '../lib/wallRuntime';
import {
  usePageVisible,
  useSlowClock,
  useWakeLock,
  useWallViewport,
} from './wall/wallHooks';

type ViewMode = 'mosaic' | 'slideshow' | 'leaderboard';

/**
 * Discreet realtime-health indicator.
 *
 * The socket dying is invisible from the room — photos keep arriving on the
 * poll, just without any of the ceremony — so the person running the venue
 * screen has no way to know the wall has gone quiet for a fixable reason.
 * A calm dot when live; a labelled amber pill only when it is not.
 */
function SocketDot({ status }: { status: SocketStatus }) {
  const live = status === 'live';
  return (
    <div
      className="flex items-center gap-1.5"
      title={live ? 'Realtime connected' : 'Reconnecting to realtime — photos still arrive, just more slowly'}
    >
      <span
        className="rounded-full"
        style={{
          width: 'calc(6px * var(--wall-scale, 1))',
          height: 'calc(6px * var(--wall-scale, 1))',
          background: live ? 'rgba(120,220,150,0.85)' : 'rgba(240,190,90,0.95)',
          boxShadow: live
            ? '0 0 8px rgba(120,220,150,0.55)'
            : '0 0 10px rgba(240,190,90,0.7)',
          animation: live ? undefined : 'wall-socket-pulse 1.6s ease-in-out infinite',
        }}
      />
      {!live && (
        <span
          className="font-label uppercase tracking-luxe text-amber-200/80"
          style={{ fontSize: 'calc(9px * var(--wall-scale, 1))' }}
        >
          Reconnecting
        </span>
      )}
    </div>
  );
}

/** Restore persisted { mode, projectionMode, qrOverride } for a projector refresh. */
function readPersistedWallState(eventId: string): {
  mode?: ViewMode;
  projectionMode?: boolean;
  qrOverride?: boolean | null;
} {
  try {
    const raw = localStorage.getItem(`beamwall:wall:${eventId}`);
    if (!raw) return {};
    const v = JSON.parse(raw) as { mode?: unknown; projectionMode?: unknown; qrOverride?: unknown };
    return {
      mode: v.mode === 'mosaic' || v.mode === 'slideshow' || v.mode === 'leaderboard' ? v.mode : undefined,
      projectionMode: typeof v.projectionMode === 'boolean' ? v.projectionMode : undefined,
      // Explicitly null-vs-undefined: null is a stored "follow the host's
      // setting", undefined is "nothing stored". Truthiness would merge them.
      qrOverride: typeof v.qrOverride === 'boolean' ? v.qrOverride : null,
    };
  } catch {
    return {}; // unavailable/corrupt storage — fall back to defaults
  }
}

export default function Wall() {
  const { eventId, basePath, source } = useEvent();
  const {
    posts,
    postsLoaded,
    postsFailed,
    fetchPosts,
    prependPost,
    removePost,
    updatePost,
    wallSettings,
    fetchWallSettings,
    setWallSettings,
  } = useStore();

  // View state — default to Gallery (static masonry grid: clickable, no
  // duplicates); restored from localStorage so a projector refresh recovers.
  const [mode, setMode] = useState<ViewMode>(() => readPersistedWallState(eventId).mode ?? 'mosaic');
  const [projectionMode, setProjectionMode] = useState(
    () => readPersistedWallState(eventId).projectionMode ?? false,
  );
  /** Per-device QR visibility override; null = follow the host's setting.
   *  Persisted beside mode/projectionMode: this replaced a value that lived in
   *  the database, so leaving it in memory only would have meant the venue
   *  operator lost their choice on every projector refresh. */
  const [qrOverride, setQrOverride] = useState<boolean | null>(
    () => readPersistedWallState(eventId).qrOverride ?? null,
  );
  const [lightboxPost, setLightboxPost] = useState<Post | null>(null);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  // Freshly beamed-in post the Featured Spotlight should feature next.
  const [pendingFeatureId, setPendingFeatureId] = useState<string | null>(null);

  // Persist { mode, projectionMode, qrOverride } for this event.
  useEffect(() => {
    try {
      localStorage.setItem(
        `beamwall:wall:${eventId}`,
        JSON.stringify({ mode, projectionMode, qrOverride }),
      );
    } catch {
      // storage unavailable (private mode/quota) — persistence is best-effort
    }
  }, [eventId, mode, projectionMode, qrOverride]);

  // Controls auto-hide (projection mode hides the toggle bar after 4 s idle)
  const [showChrome, setShowChrome] = useState(true);
  const chromeDimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Arrival choreography. The old version pushed onto an UNBOUNDED array and
  // played one ~1.6 s beam per insert, so ten photos at dinner meant sixteen
  // seconds of identical beams; it also overwrote `pendingFeatureId` on every
  // insert, so nine of those ten guests were never spotlighted. All of that
  // decision-making now lives in the pure, tested queue.
  const [arrivals, setArrivals] = useState(emptyArrivalQueue);
  /** Ids ArrivalBeam says it is actually carrying; null = "the whole ceremony". */
  const [carriedIds, setCarriedIds] = useState<Set<string> | null>(null);
  /** Landing rects reported upward by the grid, keyed by post id. */
  const tileRectsRef = useRef<Map<string, BeamRect>>(new Map());

  // Fresh IDs for golden glow ring in mosaic
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const freshTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Six-hour survival: is the wall actually on screen, how big is it, and can
  // we stop the projector laptop going to sleep mid-gala?
  const visible = usePageVisible();
  const viewport = useWallViewport(projectionMode);
  useWakeLock(true);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');

  // Slow drift for the persistent high-contrast chrome (burn-in defence).
  const driftSeconds = useSlowClock(visible);
  const drift = burnInOffset(driftSeconds);
  const driftStyle = { transform: `translate3d(${drift.x}px, ${drift.y}px, 0)` };

  // Measure the (variable-height, wrapping) header so gallery content always
  // starts just below it — never clipped, no magic numbers.
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerH, setHeaderH] = useState(96);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) { setHeaderH(0); return; }
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [projectionMode]);

  // ----------------------------------------------------------------
  // Initial data load
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!postsLoaded) fetchPosts();
  }, [postsLoaded, fetchPosts]);

  // What the gallery area should show. Previously this was just
  // `posts.length === 0`, which conflated three different situations: the
  // first fetch still in flight (so "Be the first to capture a moment"
  // flashed before the grid popped in), a fetch that failed (the wall
  // claiming nobody had posted), and a genuinely empty wall.
  const galleryState = listState({ count: posts.length, loaded: postsLoaded, failed: postsFailed });

  const [retrying, setRetrying] = useState(false);
  const retryPosts = useCallback(async () => {
    setRetrying(true);
    await fetchPosts();
    setRetrying(false);
  }, [fetchPosts]);

  useEffect(() => {
    fetchWallSettings();
  }, [fetchWallSettings]);

  // ----------------------------------------------------------------
  // Live settings subscription
  // ----------------------------------------------------------------
  useEffect(() => {
    const unsub = subscribeToSettings(eventId, (s) => {
      setWallSettings(s);
    });
    return unsub;
  }, [eventId, setWallSettings]);

  // If leaderboard mode is disabled by admin while viewing it, fall back to mosaic
  useEffect(() => {
    if (mode === 'leaderboard' && !wallSettings.showLeaderboard) {
      setMode('mosaic');
    }
  }, [wallSettings.showLeaderboard, mode]);

  // ----------------------------------------------------------------
  // Realtime subscription
  // ----------------------------------------------------------------
  const handleInsert = useCallback(
    (post: Post) => {
      // visibleOnly subscription already filters; keep a guard so a beam-in
      // can never fire for a post the wall won't show (pre-moderation).
      if (!post.approved || post.hidden) return;
      const isNew = !useStore.getState().posts.some((p) => p.id === post.id);
      prependPost(post);
      setArrivals((q) => enqueueArrival(q, {
        id: post.id,
        guestName: post.guest_name,
        imageUrl: post.image_url,
        mediaType: post.media_type === 'video' ? 'video' : 'image',
      }));
      // Mark fresh for 5 s
      setFreshIds((s) => new Set(s).add(post.id));
      const timer = setTimeout(() => {
        setFreshIds((s) => {
          const next = new Set(s);
          next.delete(post.id);
          return next;
        });
        freshTimers.current.delete(post.id);
      }, 5000);
      freshTimers.current.set(post.id, timer);
      // Posts are PREPENDED, so every existing index shifts by one. This used
      // to reset the slideshow to 0 on every insert, which at a busy event
      // meant it never advanced past the first two photos; shifting instead
      // keeps the guest currently on screen on screen.
      if (isNew) setSlideshowIndex((i) => i + 1);
    },
    [prependPost],
  );

  // ----------------------------------------------------------------
  // Arrival queue: drain one ceremony at a time
  // ----------------------------------------------------------------
  const ceremony = arrivals.playing;

  useEffect(() => {
    if (arrivals.playing !== null || arrivals.pending.length === 0) return;
    // Wait a beat before starting: realtime delivers each INSERT in its own
    // task, so without this the first photo of a rush would always win a solo
    // ceremony and the coalescing rule could never fire.
    const t = setTimeout(() => setArrivals(startNextCeremony), COALESCE_GRACE_MS);
    return () => clearTimeout(t);
  }, [arrivals]);

  /** Tiles held invisible until their photo lands in them. Derived during
   *  render (not set in an effect) so the grid measures and hides the tile in
   *  the SAME commit the ceremony starts — otherwise the photo would flash in
   *  the grid for one frame and then disappear into the beam. */
  const beamingIds = useMemo(
    () => carriedIds ?? ceremonyIds(ceremony),
    [carriedIds, ceremony],
  );

  const handleTileRect = useCallback((id: string, rect: BeamRect | null) => {
    if (rect === null) tileRectsRef.current.delete(id);
    else tileRectsRef.current.set(id, rect);
  }, []);

  const handleCeremonyDone = useCallback(() => {
    setCarriedIds(null);
    setArrivals(finishCeremony);
  }, []);

  // Hand the spotlight the newest photo of the ceremony the room just watched.
  useEffect(() => {
    const id = spotlightIdFor(ceremony);
    if (id !== null) setPendingFeatureId(id);
  }, [ceremony]);

  useEffect(() => {
    // visibleOnly: unapproved/hidden posts never reach the wall, and a hide/
    // unapprove arrives as onDelete → removed instantly (no 20 s poll wait).
    const unsubscribe = subscribeToPosts(eventId, {
      onInsert: handleInsert,
      onUpdate: (post) => {
        // A pre-moderation post approved just now arrives as an UPDATE the
        // wall has never seen — give it the full new-arrival ceremony (beam,
        // fresh badge, spotlight) instead of silently prepending.
        const known = useStore.getState().posts.some((p) => p.id === post.id);
        if (!known && post.approved && !post.hidden) {
          handleInsert(post);
        } else {
          updatePost(post);
        }
      },
      onDelete: removePost,
      // Without this the socket could die on venue wifi and nobody in the room
      // would know: photos still trickled in on the poll, but with no beam-in,
      // no fresh glow and no spotlight.
      onStatus: (s) => setSocketStatus(socketStatusFrom(s)),
    }, { visibleOnly: true });
    return unsubscribe;
  }, [eventId, handleInsert, updatePost, removePost]);

  // Clean up fresh-id timers on unmount
  useEffect(() => {
    return () => {
      freshTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // ----------------------------------------------------------------
  // Fallback poll — adaptive, bounded, and stopped while hidden
  //
  // This used to re-fetch EVERY post every 20 s with no limit: at hour five of
  // a gala with 800 moments that is a full-table pull three times a minute,
  // and each one replaced the `posts` array identity and re-ran the marquee's
  // whole memo chain. It also kept running while the tab was hidden, so a
  // sleeping projector queued them all up to land at once on wake.
  //
  // Now: nothing at all while hidden; a bounded newest-N catch-up on the
  // common tick; a full reconcile only occasionally (that is the pass which
  // still REMOVES a post a host hid while realtime was unavailable, so it
  // cannot be dropped entirely). Cadence follows the socket — see
  // lib/wallRuntime.pollActionFor.
  // ----------------------------------------------------------------
  const catchUp = useCallback(async () => {
    const { rows, failed } = await fetchPostsResult(eventId, { limit: INCREMENTAL_LIMIT });
    // Same reasoning as the store: a failed refresh must never empty a wall.
    if (failed) return;
    const known = new Set(useStore.getState().posts.map((p) => p.id));
    // Oldest → newest, so prepending preserves order. Anything genuinely new
    // gets the full arrival ceremony: when the socket is down this poll IS the
    // realtime feed, and the magic should not quietly stop with it.
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (!known.has(rows[i].id)) handleInsert(rows[i]);
    }
  }, [eventId, handleInsert]);

  const statusRef = useRef(socketStatus);
  statusRef.current = socketStatus;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const pollTickRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      pollTickRef.current += 1;
      const action = pollActionFor({
        visible: visibleRef.current,
        status: statusRef.current,
        tick: pollTickRef.current,
      });
      if (action === 'full') void fetchPosts();
      else if (action === 'incremental') void catchUp();
    }, POLL_TICK_MS);
    return () => clearInterval(id);
  }, [fetchPosts, catchUp]);

  // Coming back from hidden: catch up once, immediately, instead of waiting
  // out a tick — the wall was away, so this is the moment it is most stale.
  useEffect(() => {
    if (!visible) return;
    void catchUp();
  }, [visible, catchUp]);

  // ----------------------------------------------------------------
  // Projection mode: dim chrome after 4 s of no mouse movement
  // ----------------------------------------------------------------
  const handleMouseMove = useCallback(() => {
    setShowChrome(true);
    if (chromeDimTimer.current) clearTimeout(chromeDimTimer.current);
    if (projectionMode) {
      chromeDimTimer.current = setTimeout(() => setShowChrome(false), 4000);
    }
  }, [projectionMode]);

  useEffect(() => {
    if (projectionMode) {
      chromeDimTimer.current = setTimeout(() => setShowChrome(false), 4000);
    } else {
      setShowChrome(true);
      if (chromeDimTimer.current) clearTimeout(chromeDimTimer.current);
    }
    return () => {
      if (chromeDimTimer.current) clearTimeout(chromeDimTimer.current);
    };
  }, [projectionMode]);

  // Stable identity so FeaturedSpotlight's pending-payoff effect (which lists it
  // as a dep) doesn't re-arm its 2.5 s timer on every Wall re-render.
  const consumePending = useCallback(() => setPendingFeatureId(null), []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  /** Where the wall's join QR sends a fresh scan. Platform (db) events point
   *  signage at the /welcome guest hub — instructions before a camera
   *  permission prompt; legacy coded builds keep their shipped target
   *  (`${basePath}/`) byte-for-byte. */
  const joinUrl = source === 'db'
    ? `${origin}${basePath}/welcome`
    : `${origin}${basePath}/`;

  /** This DEVICE's own post ids (booth saves them at send time) — drives the
   *  small "Yours" chip on matching tiles. A projector never has any, so venue
   *  screens render exactly as before. */
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(
    () => new Set(getSavedPhotos(eventId).map((p) => p.id)),
  );
  useEffect(() => {
    const refresh = () => setSavedIds(new Set(getSavedPhotos(eventId).map((p) => p.id)));
    refresh();
    window.addEventListener('gallery:changed', refresh);
    return () => window.removeEventListener('gallery:changed', refresh);
  }, [eventId]);

  /** Effective QR visibility: this device's override, else the host's setting.
   *  Declared here because the empty-wall placeholder below needs it. */
  const showQR = qrOverride ?? wallSettings.showQR;

  /** The placeholder shown in place of the grid when there is nothing to draw.
   *  Declared after `origin` because EmptyWall needs it. */
  const galleryPlaceholder =
    galleryState === 'failed' ? (
      <FetchFailed what="the wall" onRetry={retryPosts} retrying={retrying} />
    ) : galleryState === 'loading' ? (
      <div className="flex h-full items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-[color:var(--color-accent)] animate-spin" />
      </div>
    ) : (
      <EmptyWall
        origin={`${origin}${basePath}`}
        joinUrl={joinUrl}
        // The footer already carries a join QR unless it is hidden or we are
        // projecting; two of them stacked was the previous result.
        showOwnQR={projectionMode || !showQR}
      />
    );

  // Show/hide the QR codes on THIS screen only.
  //
  // This used to write wallSettings for the whole event and live-sync it to
  // every other screen — but /e/:slug/wall is a guest-reachable route with no
  // auth, so any guest could hide the join QR that every other guest needs,
  // on the projector, from their phone. (The write also swallowed its own
  // failure, so a denied write still flipped the button.) The event-wide
  // value stays where it belongs, under the host's control in Settings; this
  // is now a local override for the device you are looking at.
  const toggleQR = useCallback(() => {
    setQrOverride((prev) => !(prev ?? wallSettings.showQR));
  }, [wallSettings.showQR]);

  // Available mode tabs (leaderboard gated by setting)
  const modeTabs: { id: ViewMode; label: string }[] = [
    { id: 'mosaic', label: 'Gallery' },
    { id: 'slideshow', label: 'Slideshow' },
    ...(wallSettings.showLeaderboard
      ? [{ id: 'leaderboard' as ViewMode, label: 'Leaderboard' }]
      : []),
  ];

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden bg-noir-900"
      onMouseMove={handleMouseMove}
      // Projection mode hides all chrome and its only escape used to be bound
      // to onMouseMove, which never fires on a phone — a guest who tapped
      // Project was trapped, and the flag persists across reloads.
      onTouchStart={handleMouseMove}
      // Every wall type size is expressed as `calc(Npx * var(--wall-scale))`.
      // Exactly 1 at the 1440×900 design size, so the browser view is
      // unchanged; 2.2 on a 4K projector, where 9-13 px captions were
      // unreadable from the room. See lib/wallRuntime.wallScale.
      style={{ '--wall-scale': viewport.scale } as React.CSSProperties}
    >
      {/* Background — always rendered.
          Projection mode used to RAISE particle density to 90. That is
          backwards: projection is the mode that runs unattended for six hours,
          usually on a mid-range laptop driving a 4K output, where the GPU cost
          compounds into thermal throttling — and on a 20-foot screen a dense
          drifting speckle competes with the photos instead of supporting them.
          It is now the quietest background of the three. */}
      <EventBackground density={projectionMode ? 45 : 70} />

      <style>{`
        @keyframes wall-socket-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
        @media (prefers-reduced-motion: reduce) {
          [style*="wall-socket-pulse"] { animation: none !important }
        }
      `}</style>

      {/* ── Gallery: Marquee (scrolling rows) or Mosaic (masonry grid) ── */}
      {mode === 'mosaic' && (
        <div className="absolute inset-0" style={{ paddingTop: projectionMode ? 0 : headerH }}>
          {galleryState !== 'ready' ? (
            galleryPlaceholder
          ) : wallSettings.galleryScroll ? (
            <MarqueeGrid
              posts={posts}
              scrollSpeed={wallSettings.galleryScrollSpeed ?? 1}
              viewportH={viewport.height}
              savedIds={savedIds}
              onSelect={setLightboxPost}
            />
          ) : (
            <MosaicGrid
              posts={posts}
              freshIds={freshIds}
              beamingIds={beamingIds}
              savedIds={savedIds}
              viewportH={viewport.height}
              onTileRect={handleTileRect}
              onSelect={setLightboxPost}
            />
          )}

          {/* Featured Spotlight — content, not chrome: stays on in projection mode */}
          {wallSettings.featuredSpotlight && posts.length >= 3 && (
            <FeaturedSpotlight
              posts={posts}
              enabled={wallSettings.featuredSpotlight}
              intervalSec={wallSettings.featuredIntervalSec ?? 45}
              pendingFeatureId={pendingFeatureId}
              onConsumePending={consumePending}
              // …and suspended while hidden, so its cadence timer does not
              // queue up behind a sleeping projector.
              suspended={ceremony !== null || lightboxPost !== null || !visible}
              onSelect={setLightboxPost}
              showQR={showQR}
              showLeaderboard={wallSettings.showLeaderboard}
              showChallenges={wallSettings.showChallenges}
              origin={`${origin}${basePath}`}
              joinUrl={joinUrl}
            />
          )}
        </div>
      )}

      {/* ── Slideshow ── */}
      {mode === 'slideshow' && (
        <div className="absolute inset-0">
          {galleryState !== 'ready' ? (
            galleryPlaceholder
          ) : (
            <SlideshowView
              posts={posts}
              projectionMode={projectionMode}
              currentIndex={slideshowIndex}
              onIndexChange={setSlideshowIndex}
              slideshowInterval={wallSettings.slideshowInterval ?? 6}
            />
          )}
        </div>
      )}

      {/* ── Leaderboard ── */}
      {mode === 'leaderboard' && (
        <div className="absolute inset-0" style={{ paddingTop: projectionMode ? 0 : headerH }}>
          <LeaderboardView />
        </div>
      )}

      {/* ── Challenges ticker — floats above footer, gated by setting;
             stays up in projection mode with a small bottom offset ── */}
      {wallSettings.showChallenges && (
        <ChallengesTicker bottomOffset={projectionMode ? 12 : 96} />
      )}

      {/* ── Chrome header ── centered, viewport-contained, hidden in projection ── */}
      <AnimatePresence>
        {!projectionMode && (
          <motion.header
            key="header"
            ref={headerRef}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35 }}
            className="relative z-30 shrink-0 flex flex-col items-center gap-2 px-3 pt-3 pb-3"
            style={{
              background:
                'linear-gradient(to bottom, rgba(10,7,3,0.9) 0%, rgba(10,7,3,0) 100%)',
              // Burn-in defence: this bar is high-contrast and never moves,
              // which over a six-hour projection is how you etch a panel.
              ...driftStyle,
            }}
          >
            {/* Brand — far left on wide screens only, so the nav stays truly centered */}
            <div className="hidden xl:flex items-center gap-3 absolute left-6 top-1/2 -translate-y-1/2">
              <Wordmark size="sm" />
            </div>
            {/* Moment count + socket health — far right on wide screens only */}
            <div className="hidden xl:flex items-center gap-4 absolute right-6 top-1/2 -translate-y-1/2">
              <SocketDot status={socketStatus} />
              <div className="flex items-baseline gap-1.5">
                <span
                  className="font-serif italic text-foil-static leading-none"
                  style={{ fontSize: 'calc(24px * var(--wall-scale, 1))' }}
                >
                  {posts.length}
                </span>
                <span
                  className="font-label uppercase tracking-luxe text-champagne/45"
                  style={{ fontSize: 'calc(10px * var(--wall-scale, 1))' }}
                >
                  moments
                </span>
              </div>
            </div>

            {/* Primary cross-page navigation — go anywhere from here */}
            <GuestNav current="wall" />

            {/* View tabs + wall actions — centered, wraps, never clipped */}
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-full">
              <div
                className="glass flex rounded-full p-0.5 shrink-0"
                style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
              >
                {modeTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setMode(tab.id)}
                    className={`pressable px-3.5 min-h-11 rounded-full font-label uppercase tracking-luxe text-[10px] transition-all duration-200 ${
                      mode === tab.id
                        ? 'bg-foil text-[color:var(--on-accent)] glow-accent'
                        : 'text-champagne/60 hover:text-champagne'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* QR codes on/off */}
                <button
                  onClick={toggleQR}
                  className={`pressable glass flex items-center gap-1.5 px-3 min-h-11 rounded-full font-label uppercase tracking-luxe text-[10px] transition-all ${showQR ? 'text-gold-200' : 'text-champagne/55 hover:text-champagne'}`}
                  style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
                  title={showQR ? 'Hide QR codes on this screen' : 'Show QR codes on this screen'}
                >
                  <QrCode className="w-3.5 h-3.5" /> QR {showQR ? 'On' : 'Off'}
                </button>

                {/* Share the booth link */}
                <ShareButton
                  label="Share"
                  iconSize={14}
                  className="pressable glass flex items-center gap-1.5 px-3 min-h-11 rounded-full font-label uppercase tracking-luxe text-[10px] text-champagne/70 hover:text-gold-300 transition-all"
                />

                {/* Projection mode toggle — hidden below sm. This is a control
                    for whoever is driving the venue screen, and on a phone it
                    only ever produced a chrome-less dead end for a guest. */}
                <button
                  onClick={() => setProjectionMode((p) => !p)}
                  className="pressable hidden sm:flex items-center glass px-3 min-h-11 rounded-full font-label uppercase tracking-luxe text-[10px] text-champagne/70 hover:text-gold-300 transition-all"
                  style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
                  title="Full screen — hides everything except the photos"
                >
                  ⊡ Project
                </button>
              </div>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* ── Footer: QR codes + slideshow info — hidden in projection mode ── */}
      <AnimatePresence>
        {!projectionMode && (
          <motion.footer
            key="footer"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.35 }}
            className="relative z-30 shrink-0 flex items-end justify-between px-8 pb-6 pt-2 mt-auto"
            style={{
              background:
                'linear-gradient(to top, rgba(10,7,3,0.92) 0%, rgba(10,7,3,0) 100%)',
              ...driftStyle,
            }}
          >
            {/* Left spacer */}
            <div className="flex-1" />

            {/* QR codes centred — gated by wallSettings.showQR */}
            <div className="flex-1 flex justify-center">
              <AnimatePresence>
                {showQR && (
                  <motion.div
                    key="qr"
                    initial={{ opacity: 0, scale: 0.92, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: 8 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <WallQRCodes origin={`${origin}${basePath}`} joinUrl={joinUrl} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right: slideshow counter */}
            <div className="flex-1 flex justify-end">
              {mode === 'slideshow' && posts.length > 0 && (
                <div className="text-right">
                  <p
                    className="font-label uppercase tracking-luxe text-champagne/40"
                    style={{ fontSize: 'calc(10px * var(--wall-scale, 1))' }}
                  >
                    Photo
                  </p>
                  <p
                    className="font-serif italic text-ivory/70"
                    style={{ fontSize: 'calc(18px * var(--wall-scale, 1))' }}
                  >
                    {slideshowIndex + 1} / {posts.length}
                  </p>
                </div>
              )}
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* ── Projection-mode: compact persistent join-QR chip (outside the
             auto-hiding chrome — guests can always join) ── */}
      {projectionMode && showQR && (
        <div
          className="fixed bottom-4 right-4 z-30"
          style={{ opacity: 0.55, ...driftStyle }}
        >
          <QRPanel
            url={joinUrl}
            label="Scan to join"
            size={Math.round(84 * Math.min(viewport.scale, 2))}
          />
        </div>
      )}

      {/* ── Projection-mode: surface a dead socket even with no chrome. Shown
             ONLY when something is wrong, so a healthy projection stays clean. ── */}
      {projectionMode && socketStatus !== 'live' && (
        <div className="fixed bottom-4 left-4 z-30 glass rounded-full px-3 py-2" style={driftStyle}>
          <SocketDot status={socketStatus} />
        </div>
      )}

      {/* ── Projection-mode: tiny exit button that fades in on mouse move ── */}
      <AnimatePresence>
        {projectionMode && showChrome && (
          <motion.button
            key="exit-projection"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => setProjectionMode(false)}
            className="absolute top-4 right-4 z-50 glass rounded-xl px-3 py-2 font-label uppercase tracking-luxe text-[9px] text-champagne/60 hover:text-champagne transition-colors"
            style={{ border: '1px solid rgba(var(--accent-rgb),0.15)' }}
          >
            Exit Projection
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Arrival ceremony — the guest's real photo, in flight ── */}
      <AnimatePresence>
        {ceremony !== null && (
          <ArrivalBeam
            key={ceremony.key}
            ceremony={ceremony}
            tileRects={tileRectsRef.current}
            onCarry={setCarriedIds}
            onDone={handleCeremonyDone}
          />
        )}
      </AnimatePresence>

      {/* ── Tap-a-photo lightbox: view + download/share from the wall ── */}
      <AnimatePresence>
        {lightboxPost && (
          <WallLightbox key={lightboxPost.id} post={lightboxPost} onClose={() => setLightboxPost(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
