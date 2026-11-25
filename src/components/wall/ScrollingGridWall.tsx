/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ScrollingGridWall — the photo half of the wall's split screen (Wall +
 * Leaderboard). An N×N grid that fills its area exactly (3×3 on a laptop, up
 * to 5×5 on a big projector) and, once there is more than one screen of
 * photos, drifts slowly upward on a seamless loop so the whole night passes
 * by without anyone touching it (Dapo, 2026-11-25: "should have automatic
 * scrolling"). Layout math is pure in lib/scrollingGrid.
 *
 * Arrivals keep the wall's contract (same as GridWall / MosaicGrid): a tile in
 * `beamingIds` is held invisible and reports its rect through `onTileRect`.
 * While a photo is arriving the grid snaps back to the top and holds, so the
 * newest photo's tile (top-left) is where the beam lands; the reported rect is
 * already corrected for that snap.
 *
 * Holds still while `paused` (lightbox, ceremony, hidden tab) and under
 * prefers-reduced-motion.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Post } from '../../types';
import type { BeamRect } from '../../lib/wallArrivals';
import { MOSAIC_VIDEO_CAP, autoplayVideoIds } from '../../lib/wallRuntime';
import { gridScrolls, loopHeight, loopIndexes, wrapOffset } from '../../lib/scrollingGrid';
import { TileMedia } from './GridWall';
import { usePrefersReducedMotion } from './wallHooks';

interface Props {
  posts: Post[];
  /** Columns, and rows on screen. */
  cols: number;
  freshIds?: Set<string>;
  beamingIds?: Set<string>;
  savedIds?: ReadonlySet<string>;
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  onSelect?: (post: Post) => void;
  paused?: boolean;
}

/** One row passes every this many seconds: calm, but clearly moving. */
const SECONDS_PER_ROW = 6;
const EDGE_FADE = 'linear-gradient(to bottom, transparent 0, #000 3%, #000 97%, transparent 100%)';

function Tile({
  post, isFresh, isBeaming, isMine, canPlay, onTileRect, onSelect, offsetRef,
}: {
  post: Post;
  isFresh: boolean;
  isBeaming: boolean;
  isMine: boolean;
  canPlay: boolean;
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  onSelect?: (p: Post) => void;
  offsetRef: MutableRefObject<number>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!isBeaming || onTileRect === undefined) return;
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    // The grid snaps to the top for the ceremony: report where the tile WILL
    // be, not where the drift happens to have it this frame.
    onTileRect(post.id, { left: r.left, top: r.top + offsetRef.current, width: r.width, height: r.height });
    return () => onTileRect(post.id, null);
  }, [isBeaming, post.id, onTileRect, offsetRef]);

  return (
    <button
      ref={ref}
      type="button"
      data-wall-post={post.id}
      className={`wall-tile wall-tile-face relative min-h-0 min-w-0 overflow-hidden text-left ${isFresh ? 'is-fresh' : ''}`}
      onClick={onSelect ? () => onSelect(post) : undefined}
      tabIndex={onSelect ? 0 : -1}
      aria-label={post.guest_name ? `Photo by ${post.guest_name}` : 'Event photo'}
      style={{ opacity: isBeaming ? 0 : 1, transition: 'opacity 0.35s ease', cursor: onSelect ? 'pointer' : 'default' }}
    >
      <TileMedia post={post} canPlay={canPlay} />
      {isFresh && !isBeaming && <span className="wall-tile-glint" aria-hidden />}
      {(isFresh || isMine) && <span className="wall-tile-chip">{isFresh ? 'Just in' : 'Yours'}</span>}
      {post.guest_name && (
        <span className="wall-tile-caption"><span className="truncate">{post.guest_name}</span></span>
      )}
    </button>
  );
}

export default function ScrollingGridWall({
  posts, cols, freshIds, beamingIds, savedIds, onTileRect, onSelect, paused = false,
}: Props) {
  const reduced = usePrefersReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0, gap: 10 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const measure = () => {
      const scale = parseFloat(getComputedStyle(el).getPropertyValue('--wall-scale')) || 1;
      setBox({ width: el.clientWidth, height: el.clientHeight, gap: Math.round((cols >= 5 ? 8 : 10) * scale) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cols]);

  const tileH = box.height > 0 ? (box.height - box.gap * (cols - 1)) / cols : 0;
  const scrolls = gridScrolls(posts.length, cols);
  const period = useMemo(() => (scrolls ? loopIndexes(posts.length, cols) : []), [scrolls, posts.length, cols]);
  const periodH = loopHeight(period.length, cols, tileH, box.gap);

  // Two copies of the period make the loop seamless; with nothing to scroll,
  // just the photos there are.
  const shown = useMemo<{ post: Post; key: string }[]>(() => {
    if (!scrolls) return posts.map((p) => ({ post: p, key: p.id }));
    const one = period.map((i, k) => ({ post: posts[i], key: `${posts[i].id}:${k}` }));
    return [...one, ...one.map((t) => ({ ...t, key: `${t.key}:b` }))];
  }, [scrolls, posts, period]);

  const playable = useMemo(
    () => autoplayVideoIds(posts.slice(0, cols * cols), MOSAIC_VIDEO_CAP),
    [posts, cols],
  );

  const arriving = (beamingIds?.size ?? 0) > 0;
  const offset = useRef(0);

  // Back to the top for an arrival (the beam aims at the top-left tile).
  useLayoutEffect(() => {
    if (!arriving) return;
    offset.current = 0;
    if (trackRef.current !== null) trackRef.current.style.transform = 'translate3d(0,0,0)';
  }, [arriving]);

  useEffect(() => {
    if (!scrolls || periodH <= 0 || paused || arriving || reduced) return;
    const speed = (tileH + box.gap) / SECONDS_PER_ROW;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      offset.current = wrapOffset(offset.current, speed * dt, periodH);
      if (trackRef.current !== null) {
        trackRef.current.style.transform = `translate3d(0, ${-offset.current}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrolls, periodH, paused, arriving, reduced, tileH, box.gap]);

  return (
    <div
      ref={boxRef}
      className="wall-grid relative h-full w-full overflow-hidden"
      // Soft top and bottom edges while drifting, so rows fade in and out
      // instead of being sliced by the frame.
      style={scrolls ? { maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE } : undefined}
    >
      {tileH > 0 && (
        <div
          ref={trackRef}
          className="grid w-full will-change-transform"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: `${tileH}px`,
            gap: box.gap,
          }}
        >
          {shown.map(({ post, key }) => (
            <Tile
              key={key}
              post={post}
              isFresh={freshIds?.has(post.id) ?? false}
              isBeaming={(beamingIds?.has(post.id) ?? false) && !key.endsWith(':b')}
              isMine={savedIds?.has(post.id) ?? false}
              canPlay={playable.has(post.id) && !key.endsWith(':b')}
              onTileRect={onTileRect}
              onSelect={onSelect}
              offsetRef={offset}
            />
          ))}
        </div>
      )}
    </div>
  );
}
