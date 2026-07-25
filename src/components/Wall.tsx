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
 * Realtime: subscribeToPosts; fallback poll every ~20 s.
 * Beam-in: fires <BeamIn/> overlay on every onInsert event.
 */
import { useEffect, useState, useRef, useCallback, useLayoutEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QrCode } from 'lucide-react';
import { useStore } from '../store';
import { useEvent } from '../events/EventContext';
import { subscribeToPosts, subscribeToSettings } from '../lib/db';
import { Post } from '../types';
import EventBackground from './ui/EventBackground';
import { Wordmark } from './ui/EventLogo';
import GuestNav from './ui/GuestNav';
import ShareButton from './ui/ShareButton';
import BeamIn from './wall/BeamIn';
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

type ViewMode = 'mosaic' | 'slideshow' | 'leaderboard';

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
  const { eventId, basePath } = useEvent();
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

  // Beam-in queue: each entry = { id, guestName }
  const [beamQueue, setBeamQueue] = useState<{ id: string; guestName: string | null }[]>([]);
  // Fresh IDs for golden glow ring in mosaic
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const freshTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Fallback poll interval ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      prependPost(post);
      setBeamQueue((q) => [...q, { id: post.id, guestName: post.guest_name }]);
      // Feature the newest arrival in the spotlight once the beam-in clears
      setPendingFeatureId(post.id);
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
      setSlideshowIndex(0);
    },
    [prependPost],
  );

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
  // Fallback poll every ~20 s
  // ----------------------------------------------------------------
  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchPosts();
    }, 20_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchPosts]);

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

  // ----------------------------------------------------------------
  // Beam queue: pop one at a time
  // ----------------------------------------------------------------
  const activeBeam = beamQueue[0] ?? null;
  const dismissBeam = useCallback(() => {
    setBeamQueue((q) => q.slice(1));
  }, []);

  // Stable identity so FeaturedSpotlight's pending-payoff effect (which lists it
  // as a dep) doesn't re-arm its 2.5 s timer on every Wall re-render.
  const consumePending = useCallback(() => setPendingFeatureId(null), []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

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
      <EmptyWall origin={`${origin}${basePath}`} />
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

  /** Effective QR visibility: this device's override, else the host's setting. */
  const showQR = qrOverride ?? wallSettings.showQR;

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
    >
      {/* Background — always rendered */}
      <EventBackground density={projectionMode ? 90 : 70} />

      {/* ── Gallery: Marquee (scrolling rows) or Mosaic (masonry grid) ── */}
      {mode === 'mosaic' && (
        <div className="absolute inset-0" style={{ paddingTop: projectionMode ? 0 : headerH }}>
          {galleryState !== 'ready' ? (
            galleryPlaceholder
          ) : wallSettings.galleryScroll ? (
            <MarqueeGrid
              posts={posts}
              scrollSpeed={wallSettings.galleryScrollSpeed ?? 1}
              onSelect={setLightboxPost}
            />
          ) : (
            <MosaicGrid posts={posts} freshIds={freshIds} onSelect={setLightboxPost} />
          )}

          {/* Featured Spotlight — content, not chrome: stays on in projection mode */}
          {wallSettings.featuredSpotlight && posts.length >= 3 && (
            <FeaturedSpotlight
              posts={posts}
              enabled={wallSettings.featuredSpotlight}
              intervalSec={wallSettings.featuredIntervalSec ?? 45}
              pendingFeatureId={pendingFeatureId}
              onConsumePending={consumePending}
              suspended={beamQueue.length > 0 || lightboxPost !== null}
              onSelect={setLightboxPost}
              showQR={showQR}
              showLeaderboard={wallSettings.showLeaderboard}
              showChallenges={wallSettings.showChallenges}
              origin={`${origin}${basePath}`}
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
            }}
          >
            {/* Brand — far left on wide screens only, so the nav stays truly centered */}
            <div className="hidden xl:flex items-center gap-3 absolute left-6 top-1/2 -translate-y-1/2">
              <Wordmark size="sm" />
            </div>
            {/* Moment count — far right on wide screens only */}
            <div className="hidden xl:flex items-baseline gap-1.5 absolute right-6 top-1/2 -translate-y-1/2">
              <span className="font-serif italic text-2xl text-foil-static leading-none">{posts.length}</span>
              <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/45">moments</span>
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
                    className={`px-3.5 py-1.5 rounded-full font-label uppercase tracking-luxe text-[10px] transition-all duration-200 ${
                      mode === tab.id
                        ? 'bg-foil text-noir-900 glow-accent'
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
                  className={`glass flex items-center gap-1.5 px-3 py-2 rounded-full font-label uppercase tracking-luxe text-[10px] transition-all ${showQR ? 'text-gold-200' : 'text-champagne/55 hover:text-champagne'}`}
                  style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
                  title={showQR ? 'Hide QR codes on this screen' : 'Show QR codes on this screen'}
                >
                  <QrCode className="w-3.5 h-3.5" /> QR {showQR ? 'On' : 'Off'}
                </button>

                {/* Share the booth link */}
                <ShareButton
                  label="Share"
                  iconSize={14}
                  className="glass flex items-center gap-1.5 px-3 py-2 rounded-full font-label uppercase tracking-luxe text-[10px] text-champagne/70 hover:text-gold-300 transition-all"
                />

                {/* Projection mode toggle — hidden below sm. This is a control
                    for whoever is driving the venue screen, and on a phone it
                    only ever produced a chrome-less dead end for a guest. */}
                <button
                  onClick={() => setProjectionMode((p) => !p)}
                  className="hidden sm:block glass px-3 py-2 rounded-full font-label uppercase tracking-luxe text-[10px] text-champagne/70 hover:text-gold-300 transition-all"
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
                    <WallQRCodes origin={`${origin}${basePath}`} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right: slideshow counter */}
            <div className="flex-1 flex justify-end">
              {mode === 'slideshow' && posts.length > 0 && (
                <div className="text-right">
                  <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40">
                    Photo
                  </p>
                  <p className="font-serif italic text-ivory/70 text-lg">
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
        <div className="fixed bottom-4 right-4 z-30" style={{ opacity: 0.55 }}>
          <QRPanel url={`${origin}${basePath}/`} label="Scan to join" size={84} />
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

      {/* ── Beam-in animation overlay ── */}
      <AnimatePresence>
        {activeBeam && (
          <BeamIn
            key={activeBeam.id}
            guestName={activeBeam.guestName}
            onDone={dismissBeam}
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
