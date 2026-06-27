/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarqueeGrid — animated infinite-scrolling rows gallery for the Hope Gala wall.
 *
 * Layout:
 *   Posts are distributed into N rows (3 rows for <24 posts, 4 rows for 24+).
 *   Each row scrolls continuously in alternating directions:
 *     Row 0 → left (positive scrollX direction)
 *     Row 1 → right (negative scrollX direction)
 *     Row 2 → left, Row 3 → right, …
 *
 * Seamless loop: each row's item list is duplicated (tripled if too few cards to
 * fill two screen widths) so the strip wraps invisibly. When the translate X
 * reaches –(half the total strip width) we snap back to 0, giving the illusion of
 * infinite motion.
 *
 * Speed: `scrollSpeed` multiplier (1 = ~60 px/s base). Updated live.
 * Reduced motion: respects prefers-reduced-motion by halving speed + pausing
 * (the rAF still runs so posts stay visible; the motion just becomes very slow).
 *
 * Supports media_type:'video' and media_type:'image'. Video renders as
 * <video autoPlay loop muted playsInline>.
 */

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { Post } from '../../types';

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

/** Base pixels-per-second scroll speed (at multiplier = 1). */
const BASE_PX_PER_S = 60;

/** Card dimensions (px). Fixed size keeps layout stable and rows equal-height. */
const CARD_W = 220;
const CARD_H = 290;
const CARD_GAP = 12;

/** Total width of one card slot (card + gap). */
const SLOT_W = CARD_W + CARD_GAP;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Distribute posts into `numRows` rows in a balanced column-fill order.
 *  Post i goes to row (i % numRows) so each row has roughly equal items. */
function distributeToRows(posts: Post[], numRows: number): Post[][] {
  const rows: Post[][] = Array.from({ length: numRows }, () => []);
  posts.forEach((p, i) => rows[i % numRows].push(p));
  return rows;
}

/** Duplicate the row's items until the strip is at least `minCopies` times
 *  the viewport width. We always produce at least 2 full copies (for the snap loop). */
function buildLoopItems(items: Post[], minWidth: number): { items: Post[]; halfLen: number } {
  if (items.length === 0) return { items: [], halfLen: 0 };
  const stripW = items.length * SLOT_W;
  // We need at least 2× the visible area, plus a safety margin
  const copies = Math.max(2, Math.ceil((minWidth * 2) / stripW) + 1);
  const looped: Post[] = [];
  for (let c = 0; c < copies; c++) looped.push(...items);
  const halfLen = Math.floor(looped.length / 2) * SLOT_W;
  return { items: looped, halfLen };
}

/* ------------------------------------------------------------------ */
/* PostCard                                                             */
/* ------------------------------------------------------------------ */

interface CardProps {
  post: Post;
  onSelect?: (post: Post) => void;
}

function PlayBadge() {
  return (
    <div
      className="absolute top-2 right-2 z-10 flex items-center justify-center rounded-full"
      style={{
        width: 26,
        height: 26,
        background: 'rgba(10,7,3,0.72)',
        border: '1px solid rgba(var(--accent-rgb),0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <svg width="9" height="11" viewBox="0 0 9 11" fill="none">
        <path d="M1 1.5 L8 5.5 L1 9.5 Z" fill="#D4AF37" />
      </svg>
    </div>
  );
}

function PostCard({ post, onSelect }: CardProps) {
  const isVideo = post.media_type === 'video';

  return (
    <div
      className={`relative overflow-hidden rounded-xl shrink-0 ${onSelect ? 'cursor-pointer' : ''}`}
      onClick={onSelect ? () => onSelect(post) : undefined}
      style={{
        width: CARD_W,
        height: CARD_H,
        marginRight: CARD_GAP,
        border: '1.5px solid rgba(var(--accent-rgb),0.28)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.55), 0 0 12px rgba(var(--accent-rgb),0.06)',
        background: '#0a0703',
      }}
    >
      {isVideo ? (
        <>
          <video
            src={post.image_url}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
          <PlayBadge />
        </>
      ) : (
        <img
          src={post.image_url}
          alt={post.guest_name ?? 'Gala moment'}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      )}

      {/* Caption overlay */}
      {(post.guest_name || post.message) && (
        <div
          className="absolute bottom-0 inset-x-0 px-3 py-2 pointer-events-none"
          style={{
            background:
              'linear-gradient(to top, rgba(10,7,3,0.85) 0%, rgba(10,7,3,0) 100%)',
          }}
        >
          {post.guest_name && (
            <p className="font-serif italic text-ivory/90 text-[12px] leading-tight truncate">
              {post.guest_name}
            </p>
          )}
          {post.message && (
            <p className="font-sans text-champagne/65 text-[10px] leading-tight line-clamp-2 mt-0.5">
              {post.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MarqueeRow                                                           */
/* ------------------------------------------------------------------ */

interface RowProps {
  /** The looped item list (pre-duplicated). */
  items: Post[];
  /** The pixel offset at which we snap back to 0 (= half the full looped strip width). */
  halfLen: number;
  /** +1 = scrolls left→right (x increases toward negative), -1 = right→left */
  direction: 1 | -1;
  /** px per second scroll rate (already multiplied by speed factor). */
  pxPerSec: number;
  onSelect?: (post: Post) => void;
}

function MarqueeRow({ items, halfLen, direction, pxPerSec, onSelect }: RowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  // We store offset as a plain mutable ref to avoid React re-renders on each frame.
  const offsetRef = useRef(0);
  // Keep a ref to the latest pxPerSec so the rAF closure always reads the fresh value.
  const pxPerSecRef = useRef(pxPerSec);
  useEffect(() => { pxPerSecRef.current = pxPerSec; }, [pxPerSec]);

  const lastTsRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  const tick = useCallback((ts: number) => {
    if (lastTsRef.current === null) lastTsRef.current = ts;
    const dt = (ts - lastTsRef.current) / 1000; // seconds
    lastTsRef.current = ts;

    // Move in the chosen direction
    offsetRef.current += direction * pxPerSecRef.current * dt;

    // Wrap: once we've scrolled a full "half" copy, snap back silently
    if (direction === 1 && offsetRef.current >= halfLen) {
      offsetRef.current -= halfLen;
    } else if (direction === -1 && offsetRef.current <= -halfLen) {
      offsetRef.current += halfLen;
    }

    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${-offsetRef.current}px)`;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [direction, halfLen]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [tick]);

  return (
    <div className="overflow-hidden" style={{ width: '100%' }}>
      <div
        ref={trackRef}
        className="flex"
        style={{
          willChange: 'transform',
          // Initial offset: right-scrolling rows start mid-strip so they look
          // continuous from frame 0 rather than starting at the left edge.
          transform: direction === -1 ? `translateX(${-halfLen / 2}px)` : undefined,
        }}
      >
        {items.map((post, i) => (
          <PostCard key={`${post.id}-${i}`} post={post} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MarqueeGrid (exported)                                              */
/* ------------------------------------------------------------------ */

interface MarqueeGridProps {
  posts: Post[];
  /** Speed multiplier from WallSettings (0.25 slow … 3 fast). */
  scrollSpeed: number;
  onSelect?: (post: Post) => void;
}

export default function MarqueeGrid({ posts, scrollSpeed, onSelect }: MarqueeGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute effective px/s — honour reduced motion with a ~30% cap
  const reducedMotion = prefersReducedMotion();
  const effectivePxPerSec = reducedMotion
    ? Math.min(BASE_PX_PER_S * scrollSpeed, BASE_PX_PER_S * 0.3)
    : BASE_PX_PER_S * scrollSpeed;

  // Choose number of rows
  const numRows = posts.length >= 24 ? 4 : 3;

  // Distribute posts into rows — memoised so redistribution only triggers
  // when posts actually change, not on every speed-change render.
  const rows = useMemo(
    () => distributeToRows(posts, numRows),
    [posts, numRows],
  );

  // Build looped row data — need a viewport width estimate.
  // We use a fixed generous width (3840 px) so it works on any projector resolution
  // without needing a layout effect just to measure.
  const MIN_FILL_WIDTH = 3840;

  const rowData = useMemo(
    () => rows.map((rowPosts) => buildLoopItems(rowPosts, MIN_FILL_WIDTH)),
    [rows],
  );

  if (posts.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center animate-rise-in">
          <p className="font-serif italic text-4xl text-foil-static mb-4">
            Be the first to capture a moment…
          </p>
          <p className="font-label uppercase tracking-luxe text-champagne/50 text-xs">
            Step into the booth and share your story
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex flex-col justify-center gap-3 overflow-hidden py-2"
    >
      {rowData.map((rd, rowIdx) => {
        if (rd.items.length === 0) return null;
        const direction = rowIdx % 2 === 0 ? 1 : -1;
        return (
          <MarqueeRow
            key={rowIdx}
            items={rd.items}
            halfLen={rd.halfLen}
            direction={direction as 1 | -1}
            pxPerSec={effectivePxPerSec}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}
