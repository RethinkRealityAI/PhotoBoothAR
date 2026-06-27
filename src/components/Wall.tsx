/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wall — the projected live photo wall for the Hope Gala 2026.
 *
 * Four modes:
 *   Gallery    — responsive masonry grid, newest first, gentle entrance.
 *   Slideshow  — full-bleed single post, Ken-Burns drift (images), auto-advance 6 s.
 *   Leaderboard — gorgeous gold gala leaderboard (shown only when wallSettings.showLeaderboard).
 *   Projection — kiosk/projector mode: hides ALL chrome; shows only content + dust.
 *
 * Settings (live via subscribeToSettings):
 *   showQR          — hides/shows the two bottom QR panels instantly.
 *   showLeaderboard — enables the Leaderboard tab in the mode picker.
 *   showChallenges  — shows/hides the challenges ticker strip.
 *
 * Realtime: subscribeToPosts; fallback poll every ~20 s.
 * Beam-in: fires <BeamIn/> overlay on every onInsert event.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QrCode, Camera } from 'lucide-react';
import { useStore } from '../store';
import { subscribeToPosts, subscribeToSettings, setWallSettings as dbSetWallSettings } from '../lib/db';
import { Post } from '../types';
import EventBackground from './ui/EventBackground';
import { Wordmark } from './ui/EventLogo';
import ShareButton from './ui/ShareButton';
import BeamIn from './wall/BeamIn';
import MosaicGrid from './wall/MosaicGrid';
import MarqueeGrid from './wall/MarqueeGrid';
import SlideshowView from './wall/SlideshowView';
import LeaderboardView from './wall/LeaderboardView';
import WallQRCodes from './wall/WallQRCodes';
import ChallengesTicker from './wall/ChallengesTicker';

type ViewMode = 'mosaic' | 'slideshow' | 'leaderboard';

export default function Wall() {
  const {
    posts,
    postsLoaded,
    fetchPosts,
    prependPost,
    removePost,
    updatePost,
    wallSettings,
    fetchWallSettings,
    setWallSettings,
  } = useStore();

  // View state — default to Slideshow (one photo at a time, no duplicates).
  const [mode, setMode] = useState<ViewMode>('slideshow');
  const [projectionMode, setProjectionMode] = useState(false);
  const [slideshowIndex, setSlideshowIndex] = useState(0);

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

  // ----------------------------------------------------------------
  // Initial data load
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!postsLoaded) fetchPosts();
  }, [postsLoaded, fetchPosts]);

  useEffect(() => {
    fetchWallSettings();
  }, [fetchWallSettings]);

  // ----------------------------------------------------------------
  // Live settings subscription
  // ----------------------------------------------------------------
  useEffect(() => {
    const unsub = subscribeToSettings((s) => {
      setWallSettings(s);
    });
    return unsub;
  }, [setWallSettings]);

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
      prependPost(post);
      setBeamQueue((q) => [...q, { id: post.id, guestName: post.guest_name }]);
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
    const unsubscribe = subscribeToPosts({
      onInsert: handleInsert,
      onUpdate: updatePost,
      onDelete: removePost,
    });
    return unsubscribe;
  }, [handleInsert, updatePost, removePost]);

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

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // Toggle the QR codes from the wall itself (persists + live-syncs to all screens).
  const toggleQR = useCallback(() => {
    const next = !wallSettings.showQR;
    setWallSettings({ ...wallSettings, showQR: next }); // optimistic
    dbSetWallSettings({ showQR: next }).catch(() => {});
  }, [wallSettings, setWallSettings]);

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
    >
      {/* Background — always rendered */}
      <EventBackground density={projectionMode ? 90 : 70} />

      {/* ── Gallery: Marquee (scrolling rows) or Mosaic (masonry grid) ── */}
      {mode === 'mosaic' && (
        <div className="absolute inset-0 pt-[72px]">
          {wallSettings.galleryScroll ? (
            <MarqueeGrid
              posts={posts}
              scrollSpeed={wallSettings.galleryScrollSpeed ?? 1}
            />
          ) : (
            <MosaicGrid posts={posts} freshIds={freshIds} />
          )}
        </div>
      )}

      {/* ── Slideshow ── */}
      {mode === 'slideshow' && (
        <div className="absolute inset-0">
          <SlideshowView
            posts={posts}
            projectionMode={projectionMode}
            currentIndex={slideshowIndex}
            onIndexChange={setSlideshowIndex}
            slideshowInterval={wallSettings.slideshowInterval ?? 6}
          />
        </div>
      )}

      {/* ── Leaderboard ── */}
      {mode === 'leaderboard' && (
        <div className="absolute inset-0 pt-[72px]">
          <LeaderboardView />
        </div>
      )}

      {/* ── Challenges ticker — floats above footer, gated by setting ── */}
      {!projectionMode && wallSettings.showChallenges && (
        <ChallengesTicker bottomOffset={96} />
      )}

      {/* ── Chrome header ── hidden in projection mode ── */}
      <AnimatePresence>
        {!projectionMode && (
          <motion.header
            key="header"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35 }}
            className="relative z-30 flex items-center justify-between px-6 py-3 shrink-0"
            style={{
              background:
                'linear-gradient(to bottom, rgba(10,7,3,0.88) 0%, rgba(10,7,3,0) 100%)',
            }}
          >
            {/* Left: wordmark */}
            <div className="flex items-center gap-4">
              <Wordmark size="sm" />
            </div>

            {/* Centre: photo counter */}
            <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center">
              <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/50">
                Moments shared
              </span>
              <span className="font-serif italic text-3xl text-foil-static leading-tight">
                {posts.length}
              </span>
            </div>

            {/* Right: view controls */}
            <div className="flex items-center gap-3">
              {/* Mode tabs */}
              <div
                className="glass flex rounded-xl overflow-hidden"
                style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
              >
                {modeTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setMode(tab.id)}
                    className={`px-4 py-2 font-label uppercase tracking-luxe text-[10px] transition-all duration-200 ${
                      mode === tab.id
                        ? 'bg-foil text-noir-900 glow-accent'
                        : 'text-champagne/60 hover:text-champagne'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Open the booth */}
              <a
                href="/booth"
                className="glass flex items-center gap-1.5 px-4 py-2 rounded-xl font-label uppercase tracking-luxe text-[10px] text-champagne/70 hover:glow-accent transition-all"
                style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
                title="Open the photo booth"
              >
                <Camera className="w-3.5 h-3.5" /> Booth
              </a>

              {/* Share the booth link */}
              <ShareButton
                label="Share"
                iconSize={14}
                className="glass flex items-center gap-1.5 px-4 py-2 rounded-xl font-label uppercase tracking-luxe text-[10px] text-champagne/70 hover:glow-accent transition-all"
              />

              {/* QR codes on/off */}
              <button
                onClick={toggleQR}
                className={`glass flex items-center gap-1.5 px-4 py-2 rounded-xl font-label uppercase tracking-luxe text-[10px] transition-all ${wallSettings.showQR ? 'text-gold-200' : 'text-champagne/50'}`}
                style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
                title={wallSettings.showQR ? 'Hide QR codes' : 'Show QR codes'}
              >
                <QrCode className="w-3.5 h-3.5" /> {wallSettings.showQR ? 'QR On' : 'QR Off'}
              </button>

              {/* Projection mode toggle */}
              <button
                onClick={() => setProjectionMode((p) => !p)}
                className="glass px-4 py-2 rounded-xl font-label uppercase tracking-luxe text-[10px] text-champagne/70 hover:glow-accent transition-all"
                style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
                title="Projection mode (hides all chrome)"
              >
                ⊡ Project
              </button>
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
                {wallSettings.showQR && (
                  <motion.div
                    key="qr"
                    initial={{ opacity: 0, scale: 0.92, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: 8 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <WallQRCodes origin={origin} />
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
    </div>
  );
}
