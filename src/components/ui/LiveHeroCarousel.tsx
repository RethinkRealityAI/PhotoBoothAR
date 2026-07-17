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
  { event: 'hope-gala', label: 'Hope Gala', frameId: 'frame-classic', rgb: '212, 175, 55' },
  { event: 'detola-wuyi', label: 'Detola & Wuyi', frameId: 'dw-frame-monogram', rgb: '31, 169, 113' },
  { event: 'jenna-jake', label: 'Jenna & Jake', frameId: 'jj-lower-third', rgb: '167, 139, 250' },
  { event: 'hope-gala', label: 'Hope Gala', frameId: 'frame-deco', rgb: '212, 175, 55' },
  { event: 'detola-wuyi', label: 'Detola & Wuyi', frameId: 'dw-frame-classic', rgb: '212, 175, 55' },
];

interface Media {
  url: string;
}

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
    <div className="w-40 shrink-0 sm:w-52" style={{ transform: 'rotateY(-24deg)', transformStyle: 'preserve-3d' }}>
      <div
        className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl sm:rounded-3xl"
        style={{
          boxShadow: `0 0 34px -6px rgba(${slot.rgb}, 0.5), 0 30px 70px -28px rgba(0,0,0,0.85)`,
          background: `radial-gradient(120% 90% at 50% 24%, rgba(${slot.rgb}, 0.32), transparent 66%), rgba(6, 7, 13, 0.82)`,
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
        {/* the event's real frame, on top */}
        {frameUrl && (
          <img src={frameUrl} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" draggable={false} />
        )}
        {/* glass sheen */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(168deg, rgba(255,255,255,0.10), transparent 30%)' }}
        />
      </div>
      <p className="mt-3 text-center font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">{slot.label}</p>
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
  const lastX = useRef(0);
  // Hover-pause is a mouse affordance only — touch devices report no hover
  // capability, so a tap (which fires pointerenter too) never latches a pause
  // that only a pointerleave (which touch may never send) could clear.
  const hoverCapable = useRef(
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches,
  );

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const speed = 0.35; // px/frame — a slow, smooth drift
    const step = () => {
      if (!reduced && !dragging.current && !paused.current) offset.current -= speed;
      const half = track.scrollWidth / 2;
      if (half > 0) {
        if (offset.current <= -half) offset.current += half;
        else if (offset.current > 0) offset.current -= half;
      }
      track.style.transform = `translateX(${offset.current}px)`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cards = [...SLOTS, ...SLOTS]; // duplicate for the seamless wrap

  return (
    <div
      className={`relative ${className}`}
      onPointerEnter={() => { if (hoverCapable.current) paused.current = true; }}
      onPointerLeave={() => { paused.current = false; dragging.current = false; }}
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
          className="flex w-max cursor-grab items-start gap-5 py-6 active:cursor-grabbing sm:gap-7"
          style={{ willChange: 'transform' }}
          onPointerDown={(e) => { dragging.current = true; lastX.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (dragging.current) { offset.current += e.clientX - lastX.current; lastX.current = e.clientX; } }}
          onPointerUp={(e) => { dragging.current = false; paused.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }}
          onPointerCancel={(e) => { dragging.current = false; paused.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }}
        >
          {cards.map((slot, i) => (
            <FrameCard key={`${slot.event}-${slot.frameId}-${i}`} slot={slot} pool={pools[slot.event] ?? []} seed={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
