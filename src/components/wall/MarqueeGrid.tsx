/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarqueeGrid — animated infinite-scrolling rows gallery for the event wall
 * (multi-tenant; themed per event via the accent CSS variables).
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
import PostImage from '../ui/PostImage';
import {
  MARQUEE_VIDEO_CAP,
  advanceOffset,
  autoplayVideoIds,
  boundRowItems,
  marqueeMetrics,
  type MarqueeMetrics,
} from '../../lib/wallRuntime';
import { usePageVisible, usePrefersReducedMotion } from './wallHooks';

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

/** Base pixels-per-second scroll speed (at multiplier = 1). */
const BASE_PX_PER_S = 60;

/** Card width for a post at the row height, honouring its aspect ratio.
 *  Row height is no longer a constant: it scales with the viewport so the
 *  same component reads on a laptop AND across a 20-foot projection
 *  (lib/wallRuntime.marqueeMetrics). */
function cardWidth(post: Post, m: MarqueeMetrics): number {
  const ar = post.width && post.height ? post.width / post.height : 9 / 16;
  return Math.round(Math.max(m.minCardW, Math.min(m.maxCardW, m.cardH * ar)));
}

/** Total width of one card slot (card + gap). */
function slotWidth(post: Post, m: MarqueeMetrics): number {
  return cardWidth(post, m) + m.gap;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Distribute posts into `numRows` rows in a balanced column-fill order.
 *  Post i goes to row (i % numRows) so each row has roughly equal items. */
function distributeToRows(posts: Post[], numRows: number): Post[][] {
  const rows: Post[][] = Array.from({ length: numRows }, () => []);
  posts.forEach((p, i) => rows[i % numRows].push(p));
  return rows;
}

/** Duplicate the row's items until the strip is at least `minCopies` times
 *  the viewport width. We always produce at least 2 full copies (for the snap loop). */
function buildLoopItems(items: Post[], minWidth: number, m: MarqueeMetrics): { items: Post[]; halfLen: number } {
  if (items.length === 0) return { items: [], halfLen: 0 };
  const stripW = items.reduce((sum, p) => sum + slotWidth(p, m), 0);
  // Build an EVEN number of whole copies so the snap-back distance is an exact
  // multiple of one full pattern — seamless even with variable card widths.
  const copiesPerHalf = Math.max(1, Math.ceil(minWidth / stripW) + 1);
  const copies = copiesPerHalf * 2;
  const looped: Post[] = [];
  for (let c = 0; c < copies; c++) looped.push(...items);
  const halfLen = copiesPerHalf * stripW; // whole copies → pattern realigns on snap
  return { items: looped, halfLen };
}

/* ------------------------------------------------------------------ */
/* PostCard                                                             */
/* ------------------------------------------------------------------ */

interface CardProps {
  post: Post;
  metrics: MarqueeMetrics;
  /** Whether this clip is inside the concurrent-decoder cap. */
  canPlay: boolean;
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

function PostCard({ post, metrics, canPlay, onSelect }: CardProps) {
  const isVideo = post.media_type === 'video';

  return (
    <div
      className={`relative overflow-hidden rounded-xl shrink-0 ${onSelect ? 'cursor-pointer' : ''}`}
      onClick={onSelect ? () => onSelect(post) : undefined}
      style={{
        width: cardWidth(post, metrics),
        height: metrics.cardH,
        marginRight: metrics.gap,
        border: '1.5px solid rgba(var(--accent-rgb),0.28)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.55), 0 0 12px rgba(var(--accent-rgb),0.06)',
        background: '#0a0703',
      }}
    >
      {isVideo ? (
        <>
          {/* Only the newest few clips hold a decoder; the rest paint their
              first frame. Past the platform decoder limit a <video> renders
              solid black, and the marquee duplicates every card 4× — this is
              where that limit was being blown through hardest. */}
          <video
            src={canPlay ? post.image_url : `${post.image_url}#t=0.1`}
            autoPlay={canPlay}
            loop={canPlay}
            muted
            playsInline
            preload={canPlay ? 'auto' : 'metadata'}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <PlayBadge />
        </>
      ) : (
        <PostImage
          src={post.image_url}
          alt={post.guest_name ?? 'Event moment'}
          displayWidth={Math.round(metrics.maxCardW * 1.35)}
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
            <p
              className="font-serif italic text-ivory/90 leading-tight truncate"
              style={{ fontSize: 'calc(13px * var(--wall-scale, 1))' }}
            >
              {post.guest_name}
            </p>
          )}
          {post.message && (
            <p
              className="font-sans text-champagne/65 leading-tight line-clamp-2 mt-0.5"
              style={{ fontSize: 'calc(11px * var(--wall-scale, 1))' }}
            >
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
  metrics: MarqueeMetrics;
  playable: Set<string>;
  /** Whether the wall is on screen at all — rAF is stopped when it is not. */
  active: boolean;
  onSelect?: (post: Post) => void;
}

function MarqueeRow({ items, halfLen, direction, pxPerSec, metrics, playable, active, onSelect }: RowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  // We store offset as a plain mutable ref to avoid React re-renders on each frame.
  // Right-scrolling rows start mid-strip so they look continuous from frame 0.
  const offsetRef = useRef(direction === -1 ? halfLen / 2 : 0);
  // Keep a ref to the latest pxPerSec so the rAF closure always reads the fresh value.
  const pxPerSecRef = useRef(pxPerSec);
  useEffect(() => { pxPerSecRef.current = pxPerSec; }, [pxPerSec]);

  const lastTsRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  const tick = useCallback((ts: number) => {
    if (lastTsRef.current === null) lastTsRef.current = ts;
    const dt = (ts - lastTsRef.current) / 1000; // seconds
    lastTsRef.current = ts;

    // Advance + wrap. This used to be one `if` per direction, i.e. a single
    // subtraction, which can only recover an overshoot of LESS THAN one
    // period. rAF does not run while the tab is hidden or the projector
    // output is occluded, so on return `dt` was however long the machine was
    // away, the offset overshot by many periods, one subtraction could not
    // bring it back, and the track translated off screen FOREVER — a
    // projector laptop that slept meant a blank wall for the rest of the
    // night. `advanceOffset` clamps the frame delta and wraps with a true
    // modulo; both halves are unit-tested in lib/wallRuntime.
    offsetRef.current = advanceOffset(offsetRef.current, direction, pxPerSecRef.current, dt, halfLen);

    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${-offsetRef.current}px)`;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [direction, halfLen]);

  useEffect(() => {
    if (!active) return;
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [tick, active]);

  return (
    <div className="overflow-hidden" style={{ width: '100%' }}>
      <div
        ref={trackRef}
        className="flex"
        style={{
          willChange: 'transform',
          transform: `translateX(${-offsetRef.current}px)`,
        }}
      >
        {items.map((post, i) => (
          <PostCard
            key={`${post.id}-${i}`}
            post={post}
            metrics={metrics}
            canPlay={playable.has(post.id)}
            onSelect={onSelect}
          />
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
  /** Live viewport height — drives card size so the wall reads at 20 feet. */
  viewportH: number;
  onSelect?: (post: Post) => void;
}

export default function MarqueeGrid({ posts, scrollSpeed, viewportH, onSelect }: MarqueeGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute effective px/s — honour reduced motion with a ~30% cap
  const reducedMotion = usePrefersReducedMotion();
  const visible = usePageVisible();
  const effectivePxPerSec = reducedMotion
    ? Math.min(BASE_PX_PER_S * scrollSpeed, BASE_PX_PER_S * 0.3)
    : BASE_PX_PER_S * scrollSpeed;

  // Choose number of rows
  const numRows = posts.length >= 24 ? 4 : 3;

  // Card geometry follows the viewport height: 290 px on a laptop (unchanged),
  // ~510 px on a 4K projector, where the old fixed size made each face about
  // 9% of the screen width.
  const metrics = useMemo(() => marqueeMetrics(viewportH, numRows), [viewportH, numRows]);

  const playable = useMemo(() => autoplayVideoIds(posts, MARQUEE_VIDEO_CAP), [posts]);

  // Distribute posts into rows — memoised so redistribution only triggers
  // when posts actually change, not on every speed-change render.
  // boundRowItems is the DOM ceiling: 500 posts used to mean 125 items per
  // row, each duplicated at least four times — ~2000 card elements, with
  // every video among them duplicated as a separate decoder.
  const rows = useMemo(
    () => distributeToRows(posts, numRows).map((r) => boundRowItems(r)),
    [posts, numRows],
  );

  // Build looped row data — need a viewport width estimate.
  // We use a fixed generous width (3840 px) so it works on any projector resolution
  // without needing a layout effect just to measure.
  const MIN_FILL_WIDTH = 3840;

  const rowData = useMemo(
    () => rows.map((rowPosts) => buildLoopItems(rowPosts, MIN_FILL_WIDTH, metrics)),
    [rows, metrics],
  );

  // Empty state lives in Wall.tsx (<EmptyWall/>) — shared across all modes.
  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex flex-col justify-center overflow-hidden py-2"
      style={{ gap: metrics.gap }}
    >
      {rowData.map((rd, rowIdx) => {
        if (rd.items.length === 0) return null;
        const direction = rowIdx % 2 === 0 ? 1 : -1;
        return (
          <MarqueeRow
            key={`${rowIdx}:${rd.halfLen}`}
            items={rd.items}
            halfLen={rd.halfLen}
            direction={direction as 1 | -1}
            pxPerSec={effectivePxPerSec}
            metrics={metrics}
            playable={playable}
            active={visible}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}
