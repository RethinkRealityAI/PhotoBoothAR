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
import { GalleryHorizontal, LayoutDashboard, LayoutGrid, MonitorPlay, Orbit, QrCode, Trophy, UserRound, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import CarouselView from './wall/CarouselView';
import { hasWebGL } from './carousel/PhotoCarousel';
import MarqueeGrid from './wall/MarqueeGrid';
import SlideshowView from './wall/SlideshowView';
import LeaderboardView from './wall/LeaderboardView';
import WallQRCodes, { QRPanel } from './wall/WallQRCodes';
import ChallengesTicker from './wall/ChallengesTicker';
import WallLightbox from './wall/WallLightbox';
import FeaturedSpotlight from './wall/FeaturedSpotlight';
import EmptyWall from './wall/EmptyWall';
import GridWall from './wall/GridWall';
import WallBackdrop, { WallTwinkles } from './wall/WallBackdrop';
import { samplePosts } from './theme/samplePhotos';
import {
  PREVIEW_MAX_POSTS,
  WALL_PREVIEW_READY,
  isWallPreviewFrame,
  namedSamples,
  parseWallPreviewMessage,
  previewArrival,
} from '../lib/wallPreview';
import WallHeader, { type WallTab } from './wall/WallHeader';
import { themePackById, themeTone } from '../lib/themePacks';
import {
  WALL_LAYOUT_META,
  normalizeWallLook,
  resolveScene,
  resolveWallBackdrop,
  sameWallArrangement,
  WALL_CORNER_META,
  wallGlowColor,
  wallTone,
  type WallLayout,
} from '../lib/sceneThemes';
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
  usePrefersReducedMotion,
  useSlowClock,
  useWakeLock,
  useWallViewport,
} from './wall/wallHooks';
import { findDecision, mineChipVisible, minePosts, readPostParam, stripPostParam } from '../lib/wallFindYours';
import { LOCAL_BURST, newBucket, takeToken, type Bucket, type Point, type ReactionEmoji } from '../lib/wallReactions';
import { createReactTransport, type ReactTransport } from '../lib/wallReactTransport';
import { useReactionFloaters } from './wall/ReactionLayer';
import { haptic } from '../lib/haptics';

type ViewMode = 'mosaic' | 'slideshow' | 'leaderboard' | 'carousel';

/** Platform walls: the host's layouts (lib/sceneThemes) plus the leaderboard. */
type PlatformView = WallLayout | 'leaderboard';
const PLATFORM_VIEWS: readonly PlatformView[] = ['grid', 'masonry', 'marquee', 'carousel', 'slideshow', 'leaderboard'];

/** This device's own choice of view on a platform wall (null = follow the
 *  host's Wall design). Its own key, so the legacy persisted shape is untouched. */
function readPersistedPlatformView(eventId: string): PlatformView | null {
  try {
    const v = localStorage.getItem(`beamwall:wall-view:${eventId}`);
    return PLATFORM_VIEWS.includes(v as PlatformView) ? (v as PlatformView) : null;
  } catch {
    return null;
  }
}

/** '#RRGGBB' → 'r, g, b' for the `--accent-rgb` style tokens; null otherwise. */
function rgbTriplet(hex: string): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

const PLATFORM_TAB_ICONS: Record<PlatformView, WallTab<PlatformView>['Icon']> = {
  grid: LayoutGrid,
  masonry: LayoutDashboard,
  marquee: GalleryHorizontal,
  carousel: Orbit,
  slideshow: MonitorPlay,
  leaderboard: Trophy,
};

/** Set for the three frozen single-event deploys (see App.tsx). */
const IS_LEGACY_BUILD = (((import.meta.env.VITE_EVENT as string | undefined) ?? '')).trim() !== '';

/**
 * Discreet realtime-health indicator.
 *
 * The socket dying is invisible from the room — photos keep arriving on the
 * poll, just without any of the ceremony — so the person running the venue
 * screen has no way to know the wall has gone quiet for a fixable reason.
 * A calm dot when live; a labelled amber pill only when it is not.
 */
function SocketDot({ status, brand = false }: { status: SocketStatus; brand?: boolean }) {
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
      {!live && (brand ? (
        <span className="font-sans font-medium text-amber-200" style={{ fontSize: 'calc(12px * var(--wall-scale, 1))' }}>
          Reconnecting
        </span>
      ) : (
        <span
          className="font-label uppercase tracking-luxe text-amber-200/80"
          style={{ fontSize: 'calc(9px * var(--wall-scale, 1))' }}
        >
          Reconnecting
        </span>
      ))}
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
      mode:
        v.mode === 'mosaic' || v.mode === 'slideshow' || v.mode === 'leaderboard' || v.mode === 'carousel'
          ? v.mode
          : undefined,
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
  const { eventId, basePath, source, config } = useEvent();
  /** Every new behaviour below (Wall design, grid, backdrop, tone, chrome)
   *  is gated on this; the three frozen legacy builds render byte-identically. */
  const platform = source === 'db' && !IS_LEGACY_BUILD;
  /** The setup wizard's embedded preview: sample photos, the host's unsaved
   *  design over postMessage, no database traffic, nothing persisted. */
  const [preview] = useState(() => platform && isWallPreviewFrame());
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
  // Never on the three frozen legacy sites: they are finished events, and a
  // new tab on their wall is a change to something nobody asked to change.
  const [carouselUsable] = useState(() => !IS_LEGACY_BUILD && hasWebGL());
  const [mode, setMode] = useState<ViewMode>(() => {
    const saved = readPersistedWallState(eventId).mode ?? 'mosaic';
    // A wall reopened on a machine without WebGL must not restore into a view
    // that machine cannot draw.
    return saved === 'carousel' && (IS_LEGACY_BUILD || !hasWebGL()) ? 'mosaic' : saved;
  });
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
    if (preview) return;
    try {
      localStorage.setItem(
        `beamwall:wall:${eventId}`,
        JSON.stringify({ mode, projectionMode, qrOverride }),
      );
    } catch {
      // storage unavailable (private mode/quota) — persistence is best-effort
    }
  }, [eventId, mode, projectionMode, qrOverride, preview]);

  // ── Platform: the host's Wall design (lib/sceneThemes) ──
  // The host's layout is every screen's default view. A device can still pick
  // another tab (persisted on that device), until the host CHANGES the
  // arrangement live — then every screen follows (see subscribeToSettings).
  const hostLook = useMemo(
    () => normalizeWallLook(wallSettings.wallLook, wallSettings.galleryScroll),
    [wallSettings.wallLook, wallSettings.galleryScroll],
  );
  const [viewOverride, setViewOverride] = useState<PlatformView | null>(
    () => (platform && !preview ? readPersistedPlatformView(eventId) : null),
  );
  useEffect(() => {
    if (!platform || preview) return;
    try {
      const key = `beamwall:wall-view:${eventId}`;
      if (viewOverride === null) localStorage.removeItem(key);
      else localStorage.setItem(key, viewOverride);
    } catch {
      // storage unavailable — the override just lasts for this page view
    }
  }, [platform, eventId, viewOverride, preview]);

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
  useWakeLock(!preview);
  // The preview never opens a socket; it is a faithful 'live' wall.
  const [socketStatus, setSocketStatus] = useState<SocketStatus>(preview ? 'live' : 'connecting');

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
    if (preview) return;
    if (!postsLoaded) fetchPosts();
  }, [postsLoaded, fetchPosts, preview]);

  // Preview: a wall full of stand-in moments, with names for the captions.
  const previewSamples = useMemo(() => (preview ? namedSamples(samplePosts(24)) : []), [preview]);
  useEffect(() => {
    if (!preview) return;
    useStore.setState({ posts: previewSamples, postsLoaded: true, postsFailed: false });
  }, [preview, previewSamples]);

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
    if (preview) return;
    fetchWallSettings();
  }, [fetchWallSettings, preview]);

  // ----------------------------------------------------------------
  // Live settings subscription
  // ----------------------------------------------------------------
  useEffect(() => {
    if (preview) return;
    const unsub = subscribeToSettings(eventId, (s) => {
      if (platform) {
        // The host changed the arrangement (layout or grid size): every
        // screen follows, whatever tab it was on. Colour/tone changes repaint
        // in place without yanking anyone's view.
        const prev = useStore.getState().wallSettings;
        const before = normalizeWallLook(prev.wallLook, prev.galleryScroll);
        const after = normalizeWallLook(s.wallLook, s.galleryScroll);
        if (!sameWallArrangement(before, after)) setViewOverride(null);
      }
      setWallSettings(s);
    });
    return unsub;
  }, [eventId, setWallSettings, platform, preview]);

  // If leaderboard mode is disabled by admin while viewing it, fall back to mosaic
  useEffect(() => {
    if (mode === 'leaderboard' && !wallSettings.showLeaderboard) {
      setMode('mosaic');
    }
  }, [wallSettings.showLeaderboard, mode]);
  useEffect(() => {
    if (platform && viewOverride === 'leaderboard' && !wallSettings.showLeaderboard) setViewOverride(null);
  }, [platform, viewOverride, wallSettings.showLeaderboard]);

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
    if (preview) return;
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
  }, [eventId, handleInsert, updatePost, removePost, preview]);

  // Preview: the wizard sends the host's unsaved design and "beam a photo"
  // requests. Same-origin parent only (lib/wallPreview).
  const beamCount = useRef(0);
  useEffect(() => {
    if (!preview) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const msg = parseWallPreviewMessage(e.data);
      if (msg === null) return;
      if (msg.type === 'beamwall:wall-preview:beam') {
        const post = previewArrival(previewSamples, beamCount.current);
        beamCount.current += 1;
        if (post === null) return;
        const current = useStore.getState().posts;
        if (current.length >= PREVIEW_MAX_POSTS) removePost(current[current.length - 1].id);
        handleInsert(post);
        return;
      }
      const prev = useStore.getState().wallSettings;
      const next = { ...prev, ...msg.settings };
      if (!sameWallArrangement(
        normalizeWallLook(prev.wallLook, prev.galleryScroll),
        normalizeWallLook(next.wallLook, next.galleryScroll),
      )) setViewOverride(null);
      setWallSettings(next);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: WALL_PREVIEW_READY }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [preview, previewSamples, handleInsert, removePost, setWallSettings]);

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
    if (preview) return;
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
  }, [fetchPosts, catchUp, preview]);

  // Coming back from hidden: catch up once, immediately, instead of waiting
  // out a tick — the wall was away, so this is the moment it is most stale.
  useEffect(() => {
    if (!visible || preview) return;
    void catchUp();
  }, [visible, catchUp, preview]);

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

  // ── Find yours on the wall (platform only) ──
  // The booth's success screen links to `/wall?post=<id>`. Open the lightbox
  // on that photo once it is on the wall; until then, a short note. The param
  // is removed straight away so a refresh never reopens it.
  const location = useLocation();
  const navigate = useNavigate();
  const [findTarget, setFindTarget] = useState<string | null>(
    () => (platform && !preview ? readPostParam(location.search) : null),
  );
  const [findNote, setFindNote] = useState(false);
  useEffect(() => {
    if (!platform || preview) return;
    const stripped = stripPostParam(location.search);
    if (stripped === location.search) return;
    navigate(
      { pathname: location.pathname, search: stripped, hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [platform, preview, location.pathname, location.search, location.hash, location.state, navigate]);
  useEffect(() => {
    if (findTarget === null) return;
    const decision = findDecision(findTarget, posts.map((p) => p.id), postsLoaded, postsFailed);
    if (decision === 'open') {
      const found = posts.find((p) => p.id === findTarget);
      if (found !== undefined) setLightboxPost(found);
      setFindTarget(null);
      setFindNote(false);
    } else if (decision === 'pending') {
      // Keep watching: a host approval arrives as a realtime UPDATE and lands
      // in `posts`, which re-runs this and opens it.
      setFindNote(true);
    } else if (decision === 'drop') {
      setFindTarget(null);
    }
  }, [findTarget, posts, postsLoaded, postsFailed]);
  // The note is a heads-up, not a fixture: it steps aside on its own.
  useEffect(() => {
    if (!findNote) return;
    const t = setTimeout(() => setFindNote(false), 15000);
    return () => clearTimeout(t);
  }, [findNote]);

  // ── Mine: phones only, this device's own posts ──
  const [mineOnly, setMineOnly] = useState(false);
  const mineCount = useMemo(
    () => posts.reduce((n, p) => n + (savedIds.has(p.id) ? 1 : 0), 0),
    [posts, savedIds],
  );
  const mineChip = platform && !preview
    && mineChipVisible({ width: viewport.width, projecting: projectionMode, mineCount });
  const filterMine = mineOnly && mineChip;
  useEffect(() => {
    if (!mineChip && mineOnly) setMineOnly(false);
  }, [mineChip, mineOnly]);
  /** What the gallery views draw: everything, or (Mine on) this guest's own. */
  const wallPosts = useMemo(
    () => (filterMine ? minePosts(posts, savedIds) : posts),
    [filterMine, posts, savedIds],
  );
  const toggleMine = useCallback(() => {
    setMineOnly((on) => !on);
    setSlideshowIndex(0);
  }, []);

  /** Effective QR visibility: this device's override, else the host's setting.
   *  Declared here because the empty-wall placeholder below needs it. */
  //
  // Platform walls start with the codes OFF unless the host opted them on for
  // every screen (`qrOnWall`); the Display menu turns them on for this screen.
  // A PHONE always starts off: that is a guest browsing the wall, already in
  // the event, and two scan panels would cover half their screen. Legacy
  // walls keep `showQR` exactly as before.
  const qrDefault = platform
    ? viewport.width >= 640 && wallSettings.qrOnWall === true
    : wallSettings.showQR;
  const showQR = qrOverride ?? qrDefault;

  /**
   * Where the two QR panels live.
   *
   * Centred at the bottom they sit ON the wall — which the mosaic tolerated
   * and the carousel does not: the ring's front card lands exactly there, so
   * the photo the room is meant to look at arrives behind a pair of QR codes.
   * On anything wide enough they move to a rail down the right-hand edge,
   * where they are still scannable from across a room and cover nothing.
   * Narrow screens keep the footer — a vertical stack would eat a phone's
   * width — and the three frozen legacy walls keep it unconditionally.
   */
  const qrRail = !IS_LEGACY_BUILD && !projectionMode && viewport.width >= 1024;

  // Measure the QR rail for the same reason the header is measured: the
  // carousel's canvas is sized to fill what is left, so the ring turns BESIDE
  // the codes instead of behind them.
  // A CALLBACK ref, not a plain one: the rail mounts inside an AnimatePresence
  // further down the tree, so a layout effect declared here runs while the node
  // is still null and would leave the width pinned at 0 forever.
  const [qrRailW, setQrRailW] = useState(0);
  const qrRailObserver = useRef<ResizeObserver | null>(null);
  const qrRailRef = useCallback((el: HTMLDivElement | null) => {
    qrRailObserver.current?.disconnect();
    qrRailObserver.current = null;
    if (el === null) { setQrRailW(0); return; }
    // Its own width plus the gap it sits in, so a card never touches it.
    const measure = () => setQrRailW(el.offsetWidth + 32);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    qrRailObserver.current = ro;
  }, []);
  useEffect(() => () => qrRailObserver.current?.disconnect(), []);

  /**
   * The room every view mode gets: below the header, and clear of the QR rail.
   *
   * Reserving the rail's width rather than floating over it is the whole point
   * of moving the codes — a mosaic whose last column sits behind a QR panel is
   * no better off than a carousel that turns behind one.
   */
  const modeAreaStyle: React.CSSProperties = {
    paddingTop: projectionMode ? 0 : headerH,
    paddingRight: qrRail && showQR ? qrRailW : 0,
  };

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
        boothHref={platform && !projectionMode ? `${basePath}/booth` : undefined}
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
    setQrOverride((prev) => !(prev ?? qrDefault));
  }, [qrDefault]);

  // Available mode tabs (leaderboard gated by setting)
  // The carousel is a WebGL view; a machine that cannot render it must not be
  // offered a tab that opens onto a black rectangle at an event. Probed once —
  // the answer cannot change while the page is open.
  const modeTabs: { id: ViewMode; label: string }[] = [
    { id: 'mosaic', label: 'Gallery' },
    ...(carouselUsable ? [{ id: 'carousel' as ViewMode, label: 'Carousel' }] : []),
    { id: 'slideshow', label: 'Slideshow' },
    ...(wallSettings.showLeaderboard
      ? [{ id: 'leaderboard' as ViewMode, label: 'Leaderboard' }]
      : []),
  ];

  // ── Platform view, tabs, backdrop and tone ──
  const reducedMotion = usePrefersReducedMotion();

  // ── Live emoji reactions (platform only; never in the host's preview) ──
  // An anonymous broadcast channel per event: no table, nothing stored. The
  // projector and every phone on the wall float each reaction from its tile.
  const reactionsOn = platform && !preview;
  const { spawn: spawnReaction, layer: reactionLayer } = useReactionFloaters(reducedMotion);
  const reactTransport = useRef<ReactTransport | null>(null);
  useEffect(() => {
    if (!reactionsOn) return;
    const t = createReactTransport(eventId, (r) => {
      // A hidden wall does not stack up a pile of floaters for its return.
      if (!visibleRef.current) return;
      spawnReaction({ emoji: r.emoji, postId: r.postId });
    });
    reactTransport.current = t;
    return () => {
      t.close();
      reactTransport.current = null;
    };
  }, [reactionsOn, eventId, spawnReaction]);
  /** Sender-side limit, ~4/s per device (lib/wallReactions.takeToken). */
  const reactBucket = useRef<Bucket | null>(null);
  const handleReact = useCallback((postId: string, emoji: ReactionEmoji, at: Point) => {
    const nowMs = performance.now();
    const r = takeToken(reactBucket.current ?? newBucket(nowMs), nowMs);
    reactBucket.current = r.bucket;
    if (!r.ok) {
      // Over the limit: one small local echo so the tap still answers, but
      // nothing goes on the wire.
      spawnReaction({ emoji, at, count: 1 });
      return;
    }
    haptic('tap');
    spawnReaction({ emoji, at, count: LOCAL_BURST });
    void reactTransport.current?.send({ postId, emoji }); // fire-and-forget: a lost reaction is harmless
  }, [spawnReaction]);

  /** A layout this machine can actually draw (no WebGL = no carousel). */
  const drawable = (v: PlatformView): PlatformView => (v === 'carousel' && !carouselUsable ? 'masonry' : v);
  const requestedView: PlatformView = viewOverride ?? hostLook.layout;
  const platformView: PlatformView = drawable(
    requestedView === 'leaderboard' && !wallSettings.showLeaderboard ? hostLook.layout : requestedView,
  );
  const platformTabs: WallTab<PlatformView>[] = PLATFORM_VIEWS
    .filter((v) => (v !== 'carousel' || carouselUsable) && (v !== 'leaderboard' || wallSettings.showLeaderboard))
    .map((v) => ({
      id: v,
      label: v === 'leaderboard' ? 'Leaderboard' : WALL_LAYOUT_META[v].label,
      Icon: PLATFORM_TAB_ICONS[v],
    }));
  /** Picking the host's own layout means "follow the host" again. */
  const selectPlatformView = useCallback((v: PlatformView) => {
    setViewOverride(v === hostLook.layout ? null : v);
  }, [hostLook.layout]);

  const backdrop = platform ? resolveWallBackdrop(hostLook) : null;
  // A theme pack (lib/themePacks) is the event's scene on the wall too.
  const themePack = platform && config.theme ? themePackById(config.theme.pack) : undefined;
  const eventSceneTone = themeTone(themePack ? config.theme : undefined)
    ?? (config.scene ? resolveScene(config.scene).tone : 'dark');
  const tone = wallTone(hostLook, eventSceneTone);
  /** A chosen backdrop brings its own accent, so selected tabs, fresh rings
   *  and glows read on it (a pale lilac accent vanishes on a light palette). */
  // Light tone over the event's own background: the event accent is usually a
  // pale tint built for dark screens, so the chrome takes the brand indigo.
  const chromeAccent = backdrop !== null
    ? backdrop.accent
    : platform && tone === 'light' ? '#4B47B8' : null;
  const accentRgb = chromeAccent !== null ? rgbTriplet(chromeAccent) : null;
  const platformVars: Record<string, string> = accentRgb !== null && chromeAccent !== null
    ? { '--color-accent': chromeAccent, '--accent-rgb': accentRgb, '--pf-accent-rgb': accentRgb }
    : {};

  // ── Host styling: cards, glow, corners, captions (lib/sceneThemes). Only
  // rendered once the host moved off the defaults, so a wall that never
  // chose a style paints exactly as it always did.
  const styled = platform && (
    hostLook.card !== 'classic' || hostLook.glow !== 'none' || hostLook.corners !== 'soft'
    || !hostLook.captions || hostLook.glowColor !== undefined
  );
  const glowHex = wallGlowColor(
    hostLook,
    chromeAccent ?? (themePack ? (config.theme?.colors?.accent ?? themePack.colors.accent)
      : config.scene ? resolveScene(config.scene).accent : '#D4D6FF'),
  );
  const glowRgb = rgbTriplet(glowHex) ?? '212, 214, 255';
  if (platform) {
    platformVars['--wall-glow-rgb'] = glowRgb;
    platformVars['--wall-radius'] = `calc(${WALL_CORNER_META[hostLook.corners].px}px * var(--wall-scale, 1))`;
  }
  /** Decor animates under reduced motion only in the host's preview, which
   *  exists to show the movement. */
  const decorAnimated = !reducedMotion || preview;

  // The grid fills its area exactly (no scroll), so unlike the scrolling
  // views it must stop above the footer QR codes and the phone tab bar.
  const [footerH, setFooterH] = useState(0);
  const footerObserver = useRef<ResizeObserver | null>(null);
  const footerRef = useCallback((el: HTMLElement | null) => {
    footerObserver.current?.disconnect();
    footerObserver.current = null;
    if (el === null) { setFooterH(0); return; }
    const measure = () => setFooterH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    footerObserver.current = ro;
  }, []);
  useEffect(() => () => footerObserver.current?.disconnect(), []);
  const gridAreaStyle: React.CSSProperties = {
    ...modeAreaStyle,
    // The phone tab bar floats OVER the footer, so the larger of the two wins.
    paddingBottom: projectionMode ? 0 : Math.max(footerH, viewport.width < 640 ? 76 : 0),
  };

  const gallerySpotlight = wallSettings.featuredSpotlight && posts.length >= 3 && !filterMine && (
    <FeaturedSpotlight
      posts={posts}
      enabled={wallSettings.featuredSpotlight}
      intervalSec={wallSettings.featuredIntervalSec ?? 45}
      pendingFeatureId={pendingFeatureId}
      onConsumePending={consumePending}
      suspended={ceremony !== null || lightboxPost !== null || !visible}
      onSelect={setLightboxPost}
      showQR={showQR}
      showLeaderboard={wallSettings.showLeaderboard}
      showChallenges={wallSettings.showChallenges}
      origin={`${origin}${basePath}`}
      joinUrl={joinUrl}
      framed
    />
  );

  /** One platform view. Crossfaded by the AnimatePresence in the render. */
  const renderPlatformView = () => {
    if (platformView === 'leaderboard') {
      // `relative` so the board's own `absolute inset-0` centres in the room
      // under the header instead of behind it.
      return <div className="wall-chrome wall-leaderboard relative h-full"><LeaderboardView platform /></div>;
    }
    if (galleryState !== 'ready') return <div className="wall-chrome h-full">{galleryPlaceholder}</div>;
    switch (platformView) {
      case 'grid':
        return (
          <>
            <GridWall
              posts={wallPosts}
              gridSize={hostLook.gridSize}
              transition={hostLook.transition}
              freshIds={freshIds}
              beamingIds={beamingIds}
              savedIds={savedIds}
              onTileRect={handleTileRect}
              onSelect={setLightboxPost}
              paused={ceremony !== null || lightboxPost !== null || !visible}
            />
            {gallerySpotlight}
          </>
        );
      case 'masonry':
        return (
          <>
            <MosaicGrid
              posts={wallPosts}
              freshIds={freshIds}
              beamingIds={beamingIds}
              savedIds={savedIds}
              viewportH={viewport.height}
              onTileRect={handleTileRect}
              onSelect={setLightboxPost}
              platformPolish
            />
            {gallerySpotlight}
          </>
        );
      case 'marquee':
        return (
          <>
            {/* MarqueeGrid is `absolute inset-0`, which resolves against the
                PADDING box — this wrapper puts it inside the room left
                between the header and the footer, and areaH sizes its rows
                to that room, so no row runs under the chrome. */}
            <div className="relative h-full w-full">
              <MarqueeGrid
                posts={wallPosts}
                scrollSpeed={wallSettings.galleryScrollSpeed ?? 1}
                viewportH={viewport.height}
                areaH={Math.max(0, viewport.height - (projectionMode ? 0 : headerH) - (gridAreaStyle.paddingBottom as number))}
                savedIds={savedIds}
                onSelect={setLightboxPost}
              />
            </div>
            {gallerySpotlight}
          </>
        );
      case 'carousel':
        return (
          <CarouselView
            posts={wallPosts}
            beamingIds={beamingIds}
            onTileRect={handleTileRect}
            onSelect={setLightboxPost}
            projectionMode={projectionMode}
            stage
          />
        );
      case 'slideshow':
        return (
          <SlideshowView
            posts={wallPosts}
            projectionMode={projectionMode}
            currentIndex={slideshowIndex}
            onIndexChange={setSlideshowIndex}
            slideshowInterval={wallSettings.slideshowInterval ?? 6}
            ambient
            framed
          />
        );
    }
  };
  const platformAreaStyle: React.CSSProperties =
    platformView === 'slideshow'
      ? { paddingRight: modeAreaStyle.paddingRight }
      : platformView === 'grid' || platformView === 'marquee' || platformView === 'carousel' || platformView === 'leaderboard'
        ? gridAreaStyle
        : modeAreaStyle;

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
      style={{ '--wall-scale': viewport.scale, ...platformVars } as React.CSSProperties}
      // Light/dark chrome for platform walls ([data-wall-tone] in index.css).
      data-wall-tone={platform ? tone : undefined}
      data-wall-card={styled ? hostLook.card : undefined}
      data-wall-glow={styled && hostLook.glow !== 'none' ? hostLook.glow : undefined}
      data-wall-captions={styled && !hostLook.captions ? 'off' : undefined}
    >
      {/* Background — always rendered.
          Projection mode used to RAISE particle density to 90. That is
          backwards: projection is the mode that runs unattended for six hours,
          usually on a mid-range laptop driving a 4K output, where the GPU cost
          compounds into thermal throttling — and on a 20-foot screen a dense
          drifting speckle competes with the photos instead of supporting them.
          It is now the quietest background of the three. */}
      {backdrop !== null ? (
        <WallBackdrop scene={backdrop} animated={decorAnimated} ambient={hostLook.ambient} />
      ) : (
        <>
          <EventBackground density={projectionMode ? 45 : 70} />
          {platform && hostLook.ambient === 'sparkle' && decorAnimated && <WallTwinkles />}
        </>
      )}
      {/* Light tone over the event's own (dark) background: frost it, so the
          light chrome sits on a light field instead of floating on night. */}
      {platform && backdrop === null && tone === 'light' && (
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(246, 245, 252, 0.8)' }} />
      )}

      <style>{`
        @keyframes wall-socket-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
        @media (prefers-reduced-motion: reduce) {
          [style*="wall-socket-pulse"] { animation: none !important }
        }
      `}</style>

      {/* ── Platform walls: the host's layout (or this device's tab), each
             view crossfading into the next. ── */}
      {platform && (
        <AnimatePresence initial={false}>
          <motion.div
            key={platformView === 'grid' ? `grid-${hostLook.gridSize}` : platformView}
            className="absolute inset-0"
            style={platformAreaStyle}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.01 }}
            transition={{ duration: reducedMotion ? 0.25 : 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            {renderPlatformView()}
          </motion.div>
        </AnimatePresence>
      )}

      {!platform && (<>
      {/* ── Gallery: Marquee (scrolling rows) or Mosaic (masonry grid) ── */}
      {mode === 'mosaic' && (
        <div className="absolute inset-0" style={modeAreaStyle}>
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

      {/* ── Carousel: a turning ring of photos. The arrival beam still plays —
             CarouselView reports the destination CARD's projected screen rect
             through the same onTileRect contract the mosaic uses. ── */}
      {mode === 'carousel' && (
        <div className="absolute inset-0" style={modeAreaStyle}>
          {galleryState !== 'ready' ? (
            galleryPlaceholder
          ) : (
            <CarouselView
              posts={posts}
              beamingIds={beamingIds}
              onTileRect={handleTileRect}
              onSelect={setLightboxPost}
              projectionMode={projectionMode}
            />
          )}
        </div>
      )}

      {/* ── Slideshow ── */}
      {mode === 'slideshow' && (
        <div className="absolute inset-0" style={{ paddingRight: modeAreaStyle.paddingRight }}>
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
        <div className="absolute inset-0" style={modeAreaStyle}>
          <LeaderboardView />
        </div>
      )}
      </>)}

      {/* ── Challenges ticker — floats above footer, gated by setting;
             stays up in projection mode with a small bottom offset ── */}
      {wallSettings.showChallenges && (
        <ChallengesTicker bottomOffset={projectionMode ? 12 : 96} />
      )}

      {/* ── Chrome header ── centered, viewport-contained, hidden in projection ── */}
      <AnimatePresence>
        {!projectionMode && platform && (
          <WallHeader
            key="header-platform"
            barRef={headerRef}
            tabs={platformTabs}
            active={platformView}
            onSelect={selectPlatformView}
            count={posts.length}
            socket={<SocketDot status={socketStatus} brand />}
            showQR={showQR}
            onToggleQR={toggleQR}
            onProject={() => setProjectionMode(true)}
            driftStyle={driftStyle}
            extra={mineChip && galleryState === 'ready' && platformView !== 'leaderboard' ? (
              <button
                type="button"
                onClick={toggleMine}
                aria-pressed={filterMine}
                className={`wall-tab wall-glass pressable flex items-center gap-1.5 rounded-full px-4 min-h-11 font-sans font-medium transition-colors ${
                  filterMine ? 'is-selected text-ivory' : 'text-champagne hover:text-ivory'
                }`}
                style={{ fontSize: 'calc(12px * var(--wall-scale, 1))' }}
              >
                <UserRound className="h-4 w-4" aria-hidden />
                {filterMine ? `Yours (${mineCount}) · Show all` : `Mine (${mineCount})`}
              </button>
            ) : undefined}
          />
        )}
        {!projectionMode && !platform && (
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
                        ? 'is-selected bg-foil text-[color:var(--on-accent)] glow-accent'
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
            ref={footerRef}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.35 }}
            // On a phone the platform tab bar floats over the bottom ~76px, so
            // the footer's own padding lifts the QR panels clear of it.
            className={`relative z-30 shrink-0 flex items-end justify-between px-8 pb-6 pt-2 mt-auto${platform ? ' wall-chrome pointer-events-none max-sm:px-3 max-sm:pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]' : ''}`}
            style={{
              // Platform walls float their glass panels instead of painting a
              // dark band over the bottom row of photos.
              background: platform
                ? 'none'
                : 'linear-gradient(to top, rgba(10,7,3,0.92) 0%, rgba(10,7,3,0) 100%)',
              ...driftStyle,
            }}
          >
            {/* Left spacer */}
            <div className="flex-1" />

            {/* QR codes centred — gated by wallSettings.showQR. On a wide
                platform wall these move to the right-hand rail instead. */}
            <div className="flex-1 flex justify-center">
              <AnimatePresence>
                {showQR && !qrRail && (
                  <motion.div
                    key="qr"
                    initial={{ opacity: 0, scale: 0.92, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: 8 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div className={platform ? 'pointer-events-auto' : undefined}>
                      <WallQRCodes origin={`${origin}${basePath}`} joinUrl={joinUrl} variant={platform ? 'brand' : undefined} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right: slideshow counter */}
            <div className="flex-1 flex justify-end">
              {(platform ? platformView === 'slideshow' : mode === 'slideshow') && posts.length > 0 && (
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
                    {slideshowIndex + 1} / {wallPosts.length}
                  </p>
                </div>
              )}
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* ── Right-hand QR rail: out of the wall's way, still scannable ── */}
      <AnimatePresence>
        {qrRail && showQR && (
          <motion.div
            key="qr-rail"
            className={`fixed right-4 top-1/2 z-30 -translate-y-1/2${platform ? ' wall-chrome' : ''}`}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={driftStyle}
            ref={qrRailRef}
          >
            <WallQRCodes
              origin={`${origin}${basePath}`}
              joinUrl={joinUrl}
              layout="column"
              size={Math.round(88 * Math.min(viewport.scale, 1.6))}
              variant={platform ? 'brand' : undefined}
            />
          </motion.div>
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
            variant={platform ? 'brand' : undefined}
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
            className={platform
              ? 'wall-chrome absolute top-4 right-4 z-50'
              : 'absolute top-4 right-4 z-50 glass rounded-xl px-3 py-2 font-label uppercase tracking-luxe text-[9px] text-champagne/60 hover:text-champagne transition-colors'}
            style={platform ? undefined : { border: '1px solid rgba(var(--accent-rgb),0.15)' }}
          >
            {platform ? (
              <span
                className="pressable wall-glass flex items-center rounded-full px-4 min-h-11 font-sans font-medium text-champagne hover:text-ivory"
                style={{ fontSize: 'calc(12px * var(--wall-scale, 1))' }}
              >
                Exit projection
              </span>
            ) : 'Exit Projection'}
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
            variant={platform ? hostLook.beam : 'beam'}
            glowColor={styled ? glowHex : undefined}
            forceMotion={preview}
          />
        )}
      </AnimatePresence>

      {/* ── Tap-a-photo lightbox: view + download/share from the wall ── */}
      <AnimatePresence>
        {lightboxPost && (
          <WallLightbox
            key={lightboxPost.id}
            post={lightboxPost}
            onClose={() => setLightboxPost(null)}
            platform={platform}
            onReact={reactionsOn ? (emoji, at) => handleReact(lightboxPost.id, emoji, at) : undefined}
          />
        )}
      </AnimatePresence>

      {/* ── Find yours: a polite note while this guest's photo waits for the
             host (only ever opened from a `?post=` link, so never on a venue
             screen). Firmer glass than the chrome: it sits over photos. ── */}
      {platform && !projectionMode && (
        <div
          className="wall-chrome pointer-events-none fixed inset-x-0 z-40 flex flex-col items-center gap-2 px-4"
          style={{ top: headerH + 8 }}
        >
          <AnimatePresence>
            {findNote && (
              <motion.div
                key="find-note"
                role="status"
                initial={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="wall-glass pointer-events-auto flex max-w-sm items-center gap-1 rounded-2xl py-1 pl-4 pr-1 text-champagne"
                // Dark walls only: the light tone's frosted white already reads.
                style={tone === 'light' ? undefined : { background: 'rgba(18, 16, 54, 0.82)' }}
              >
                <p className="font-sans leading-snug" style={{ fontSize: 'calc(13px * var(--wall-scale, 1))' }}>
                  Your photo is waiting for the host’s OK. It pops up here once approved.
                </p>
                <button
                  type="button"
                  onClick={() => setFindNote(false)}
                  aria-label="Dismiss"
                  className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-champagne/80 hover:text-ivory"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {reactionsOn && reactionLayer}
    </div>
  );
}
