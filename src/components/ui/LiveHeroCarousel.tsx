/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LiveHeroCarousel — the Landing hero's focal visual: a continuously
 * auto-scrolling, angled "coverflow" strip of real event frames, each streaming
 * live moderated moments from that event's actual live wall.
 *
 * Content is pulled live from the real events' `posts` (approved + non-hidden
 * only) and cycled at random inside their real frame designs (Jenna & Jake's
 * neon festival, Detola & Wuyi's green-and-gold, the Hope Gala's classic gold).
 * When live data can't be reached (e.g. the marketing build with no Supabase
 * creds, or an event with no posts yet) each card degrades to its frame over a
 * tasteful branded glow, so the hero always looks intentional.
 *
 * Motion: a rAF marquee translates a 2×-duplicated track for a seamless loop;
 * it pauses on hover and can be dragged/scrubbed by pointer. Under
 * prefers-reduced-motion the auto-scroll is off and the strip is drag-only.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { fetchPosts } from '../../lib/db';
import { BORDER_MAP, toDataUrl } from '../../lib/borders';
import type { Post } from '../../types';

interface Slot {
  event: string; // events.slug — posts.event_id key
  label: string;
  frameId: string; // BORDER_MAP id
  /** "r, g, b" for the branded glow / empty-state fill. */
  rgb: string;
}

/** Base strip — real events × their real frames; duplicated for the loop. */
const SLOTS: Slot[] = [
  { event: 'jenna-jake', label: 'Jenna & Jake', frameId: 'jj-neon-frame', rgb: '236, 72, 153' },
  { event: 'hope-gala', label: 'Hope Gala', frameId: 'frame-classic-gold', rgb: '212, 175, 55' },
  { event: 'detola-wuyi', label: 'Detola & Wuyi', frameId: 'frame-hexagon-plain', rgb: '31, 169, 113' },
  { event: 'jenna-jake', label: 'Jenna & Jake', frameId: 'jj-equalizer', rgb: '167, 139, 250' },
  { event: 'hope-gala', label: 'Hope Gala', frameId: 'frame-deco-plain', rgb: '212, 175, 55' },
  { event: 'detola-wuyi', label: 'Detola & Wuyi', frameId: 'dw-frame-classic', rgb: '212, 175, 55' },
];

interface Media {
  url: string;
}

/**
 * The frame SVGs (1080×1920) inset their art from the artboard edges, so drawn
 * 1:1 they leave a visible margin ring inside the card. Scaling the overlay up
 * slightly (clipped by the card's rounded overflow-hidden) pushes the frame art
 * out to the card edges so the card reads as a free-floating framed photo.
 */
const FRAME_OVERSCAN = 1.07;

/** Small viewports get a single, cheaper glow (two-layer shadows × 12 cards jank mobile GPUs). */
const COMPACT_VIEWPORT =
  typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

/** One framed card that cycles its event's live media. */
function FrameCard({ slot, pool, seed }: { slot: Slot; pool: Media[]; seed: number }) {
  const frameUrl = useMemo(() => {
    const border = BORDER_MAP[slot.frameId];
    return border ? toDataUrl(border.svg) : '';
  }, [slot.frameId]);

  // Cycle through this event's pool at random, staggered per card so the strip
  // doesn't flip all at once.
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (pool.length <= 1) return;
    const period = 4200 + (seed % 5) * 600;
    const t = setInterval(() => setIdx((i) => (i + 1) % pool.length), period);
    return () => clearInterval(t);
  }, [pool.length, seed]);

  const media = pool.length ? pool[(idx + seed) % pool.length] : undefined;

  return (
    // Transform is driven imperatively, per frame, by the marquee rAF loop
    // (coverflow: scale/rotateY/lift by distance from the strip centre).
    <div
      // w-36 on phones: at ~390px this leaves room for the focal card plus a
      // visible peek of BOTH neighbours — the desktop coverflow read.
      className="w-36 shrink-0 sm:w-52"
      style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}
    >
      <div
        className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl sm:rounded-3xl"
        style={{
          boxShadow: COMPACT_VIEWPORT
            ? `0 18px 44px -18px rgba(${slot.rgb}, 0.45)`
            : `0 0 34px -6px rgba(${slot.rgb}, 0.5), 0 30px 70px -28px rgba(0,0,0,0.85)`,
          // With live media the photo fills the card edge-to-edge — no backdrop,
          // so no dark ring ever shows around the frame art. The branded glow
          // fill only paints the no-media fallback.
          background: media
            ? undefined
            : `radial-gradient(120% 90% at 50% 24%, rgba(${slot.rgb}, 0.34), rgba(${slot.rgb}, 0.08) 58%, transparent 80%), linear-gradient(180deg, rgba(24, 26, 38, 0.92), rgba(8, 9, 15, 0.94))`,
        }}
      >
        {/* live moment (or branded fallback) — photos only: this card is
            ~160-208px wide and up to 12 mount at once, so an unmanaged
            <video autoPlay> here would be an iOS decode-pipeline hazard. */}
        {media ? (
          <img key={media.url} src={media.url} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-end justify-center pb-6">
            <span className="font-label uppercase tracking-luxe text-[9px] text-white/50">{slot.label}</span>
          </div>
        )}
        {/* the event's real frame, on top — overscanned so its art reaches the card edges */}
        {frameUrl && (
          <img
            src={frameUrl}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ transform: `scale(${FRAME_OVERSCAN})`, transformOrigin: 'center' }}
            draggable={false}
          />
        )}
        {/* glass sheen */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(168deg, rgba(255,255,255,0.10), transparent 30%)' }}
        />
      </div>
    </div>
  );
}

export default function LiveHeroCarousel({
  className = '',
  onHasMedia,
}: {
  className?: string;
  /** Fired once, after the live pools resolve, with whether any event had media —
   *  so the caller can caption the strip honestly instead of always claiming
   *  "live moments" over what may be empty branded frames. */
  onHasMedia?: (hasMedia: boolean) => void;
}): ReactNode {
  // Live media pools keyed by event slug.
  const [pools, setPools] = useState<Record<string, Media[]>>({});

  useEffect(() => {
    let alive = true;
    const events = Array.from(new Set(SLOTS.map((s) => s.event)));
    Promise.all(
      events.map(async (slug) => {
        const posts = await fetchPosts(slug, { limit: 24 }).catch(() => [] as Post[]);
        // Photos only — video posts are dropped here (see FrameCard note).
        const media: Media[] = posts
          .filter((p) => p.image_url && p.media_type !== 'video')
          .map((p) => ({ url: p.image_url }));
        return [slug, media] as const;
      }),
    ).then((entries) => {
      if (!alive) return;
      setPools(Object.fromEntries(entries));
      onHasMedia?.(entries.some(([, media]) => media.length > 0));
    });
    return () => { alive = false; };
  }, []);

  // Marquee: rAF-translated, seamless 2× loop, pausable + draggable.
  const trackRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const dragging = useRef(false);
  const paused = useRef(false);
  // Explicit user pause (the visible toggle) — unlike the ambient hover pause
  // above, this persists until toggled again, works for touch + keyboard, and
  // stops BOTH the desktop drift and the compact stepper. State drives the
  // button UI (icon/aria-pressed); the ref is what the rAF closures read.
  const [userPaused, setUserPaused] = useState(false);
  const userPausedRef = useRef(false);
  const toggleUserPaused = () => {
    const next = !userPausedRef.current;
    userPausedRef.current = next;
    setUserPaused(next);
  };
  const lastX = useRef(0);
  // Drag-intent gate: a pointer sequence only becomes a drag after ~8px of
  // mostly-horizontal travel — so a tap, or a vertical page-scroll that starts
  // over the strip, never grabs the track or pauses the marquee.
  const pendingPointer = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  // Hover-pause is a mouse affordance only — touch devices report no hover
  // capability, so a tap (which fires pointerenter too) never latches a pause
  // that only a pointerleave (which touch may never send) could clear.
  const hoverCapable = useRef(
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches,
  );
  // Arrow-button glide: remaining px the strip still owes an eased nudge. The
  // rAF loop consumes a fraction each frame — works under reduced motion too
  // (an explicit user action, not ambient animation).
  const glide = useRef(0);
  // One-shot: the first rAF frame with real layout snaps a card dead-centre.
  const centered = useRef(false);

  /** Nudge the strip by one card-slot; dir 1 = show previous (strip moves right). */
  const nudge = (dir: 1 | -1) => {
    const track = trackRef.current;
    const kids = track?.children;
    if (!kids || kids.length < 2) return;
    const slotW = (kids[1] as HTMLElement).offsetLeft - (kids[0] as HTMLElement).offsetLeft;
    if (slotW > 0) glide.current += dir * slotW;
  };

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const speed = 0.35; // px/frame — a slow, smooth drift
    // Coverflow tuning: centre card grows to CENTER_SCALE facing the viewer,
    // falling off (raised cosine over FALLOFF_SLOTS card-widths) to EDGE_SCALE
    // and ±EDGE_ROTATE_DEG (left cards face right, right cards face left).
    const CENTER_SCALE = 1.22;
    const EDGE_SCALE = 0.86;
    const EDGE_ROTATE_DEG = 26;
    // Compact viewports fall off faster so the strip reads as ONE dominant
    // focal card with smaller neighbours peeking in from the sides (desktop's
    // coverflow look) instead of two near-equal cards side by side.
    const FALLOFF_SLOTS = COMPACT_VIEWPORT ? 1.1 : 1.5;
    const CENTER_LIFT_PX = 12; // slight upward translateY for the focal card
    const CENTER_Z_PX = 90; // slight translateZ toward the viewer (perspective is on the container)
    const step = () => {
      if (glide.current !== 0) {
        // Ease out the owed nudge: 14%/frame, snapping shut under half a px.
        const d = glide.current * 0.14;
        offset.current += d;
        glide.current -= d;
        if (Math.abs(glide.current) < 0.5) glide.current = 0;
      }
      // Desktop drifts continuously; compact viewports STEP instead (below) —
      // a drifting strip at phone width spends most of its time with two
      // half-cards on screen, while stepping holds one focal card centred.
      if (!reduced && !COMPACT_VIEWPORT && !dragging.current && !paused.current && !userPausedRef.current) {
        offset.current -= speed;
      }
      const half = track.scrollWidth / 2;
      if (half > 0) {
        if (offset.current <= -half) offset.current += half;
        else if (offset.current > 0) offset.current -= half;
      }
      track.style.transform = `translateX(${offset.current}px)`;

      // Per-card coverflow transforms, from the track offset + fixed slot width
      // (cards are fixed-width flex items — no getBoundingClientRect per card).
      const viewport = track.parentElement;
      const kids = track.children;
      if (viewport !== null && kids.length > 1) {
        const first = kids[0] as HTMLElement;
        const cardW = first.offsetWidth;
        const slotW = (kids[1] as HTMLElement).offsetLeft - first.offsetLeft; // card + gap
        if (slotW > 0) {
          const centerX = viewport.clientWidth / 2;
          // First laid-out frame: snap a card dead-centre so the strip OPENS
          // as one focal card with side peeks (matters most on phones, where
          // the natural left-aligned start showed two half cards instead).
          if (!centered.current) {
            centered.current = true;
            offset.current = centerX - cardW / 2 - slotW;
          }
          const falloffPx = slotW * FALLOFF_SLOTS;
          for (let i = 0; i < kids.length; i++) {
            const el = kids[i] as HTMLElement;
            // Card i's centre in viewport coords: track is left-aligned in the
            // viewport and translated by offset.current.
            const dx = offset.current + i * slotW + cardW / 2 - centerX;
            const t = Math.min(Math.abs(dx) / falloffPx, 1); // 0 at centre → 1 at ≥1.5 slots out
            const f = 0.5 * (1 + Math.cos(Math.PI * t)); // raised cosine: 1 at centre → 0 at edges
            const scale = EDGE_SCALE + (CENTER_SCALE - EDGE_SCALE) * f;
            const rot = (dx < 0 ? 1 : -1) * EDGE_ROTATE_DEG * (1 - f);
            el.style.transform = `translate3d(0, ${-CENTER_LIFT_PX * f}px, ${CENTER_Z_PX * f}px) rotateY(${rot}deg) scale(${scale})`;
            el.style.zIndex = String(1 + Math.round(f * 10)); // focal card overlaps its neighbours
          }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Compact auto-advance: hold each focal card, then glide one slot (the
    // same eased glide the arrow buttons use).
    let stepTimer: ReturnType<typeof setInterval> | undefined;
    if (COMPACT_VIEWPORT && !reduced) {
      stepTimer = setInterval(() => {
        if (dragging.current || paused.current || userPausedRef.current) return;
        const kids = track.children;
        if (kids.length < 2) return;
        const slotW = (kids[1] as HTMLElement).offsetLeft - (kids[0] as HTMLElement).offsetLeft;
        if (slotW > 0) glide.current -= slotW;
      }, 3600);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (stepTimer !== undefined) clearInterval(stepTimer);
    };
  }, []);

  const cards = [...SLOTS, ...SLOTS]; // duplicate for the seamless wrap

  return (
    <div
      className={`relative ${className}`}
      onPointerEnter={() => { if (hoverCapable.current) paused.current = true; }}
      onPointerLeave={() => { paused.current = false; dragging.current = false; pendingPointer.current = null; }}
    >
      {/* floor glow the frames stand on */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[6%] bottom-10 h-24 rounded-[100%] blur-3xl"
        style={{ background: 'linear-gradient(90deg, rgba(236,72,153,0.14), rgba(212,175,55,0.16), rgba(31,169,113,0.14))' }}
      />

      {/*
        overflow-x-clip (not overflow-hidden) contains the wide track horizontally
        WITHOUT clipping vertically — so each card's drop-shadow / glow spills
        above and below, keeping the "floating over the page" 3D read. The
        horizontal edges dissolve via a mask that fades the cards to TRANSPARENT
        (not to a solid brand-bg wedge), so the strip melts seamlessly into
        whatever colourful backdrop sits behind it instead of showing a box.
      */}
      <div
        className="overflow-x-clip"
        style={{
          perspective: '1600px',
          WebkitMaskImage: 'linear-gradient(90deg, transparent 0, #000 10%, #000 90%, transparent 100%)',
          maskImage: 'linear-gradient(90deg, transparent 0, #000 10%, #000 90%, transparent 100%)',
        }}
      >
        <div
          ref={trackRef}
          // touch-pan-y: vertical page-scrolls over the strip stay with the
          // browser; only horizontal gestures reach the drag logic. py gives
          // the enlarged focal card (1.22×, lifted) room to grow without
          // crowding neighbouring page content.
          className="flex w-max cursor-grab touch-pan-y items-start gap-5 py-14 active:cursor-grabbing sm:gap-7 sm:py-16"
          style={{ willChange: 'transform', transformStyle: 'preserve-3d' }}
          onPointerDown={(e) => {
            pendingPointer.current = e.pointerId;
            startX.current = e.clientX;
            startY.current = e.clientY;
            lastX.current = e.clientX;
          }}
          onPointerMove={(e) => {
            if (dragging.current) {
              offset.current += e.clientX - lastX.current;
              lastX.current = e.clientX;
            } else if (pendingPointer.current === e.pointerId) {
              const dx = e.clientX - startX.current;
              const dy = e.clientY - startY.current;
              // Horizontal intent only: >8px travelled, mostly sideways.
              if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
                dragging.current = true;
                lastX.current = e.clientX;
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
              }
            }
          }}
          onPointerUp={(e) => { pendingPointer.current = null; dragging.current = false; paused.current = hoverCapable.current; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }}
          onPointerCancel={(e) => { pendingPointer.current = null; dragging.current = false; paused.current = hoverCapable.current; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }}
        >
          {cards.map((slot, i) => (
            <FrameCard key={`${slot.event}-${slot.frameId}-${i}`} slot={slot} pool={pools[slot.event] ?? []} seed={i} />
          ))}
        </div>
      </div>

      {/* Side arrows — manual scrub for visitors who want to browse rather
          than wait on the drift. Placed OUTSIDE the masked strip so the edge
          fade never dims them; z-20 keeps them above the lifted focal card. */}
      {/* .liquid-glass pins position:relative on itself, so the absolute
          placement lives on a wrapper div, not on the buttons. */}
      <div className="absolute left-1 top-1/2 z-20 -translate-y-1/2 sm:left-2">
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label="Previous frames"
          className="flex h-10 w-10 items-center justify-center rounded-full liquid-glass text-brand-fg/80 transition hover:text-brand-fg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:h-11 sm:w-11"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>
      <div className="absolute right-1 top-1/2 z-20 -translate-y-1/2 sm:right-2">
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label="Next frames"
          className="flex h-10 w-10 items-center justify-center rounded-full liquid-glass text-brand-fg/80 transition hover:text-brand-fg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:h-11 sm:w-11"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Visible pause/play for the auto-advancing strip (WCAG 2.2.2) —
          persists until toggled, unlike the ambient hover pause. */}
      <div className="absolute bottom-2 right-1 z-20 sm:right-2">
        <button
          type="button"
          onClick={toggleUserPaused}
          aria-pressed={userPaused}
          aria-label={userPaused ? 'Play the frame carousel' : 'Pause the frame carousel'}
          className="flex h-9 w-9 items-center justify-center rounded-full liquid-glass text-brand-fg/80 transition hover:text-brand-fg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        >
          {userPaused ? <Play className="ml-0.5 h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
