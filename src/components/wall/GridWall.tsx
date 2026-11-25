/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GridWall — the platform wall's N×N layout: an edge-to-edge wall of live
 * tiles (3×3, 4×4 or 5×5) that fills the mode area exactly, with no scroll.
 *
 * With more posts than cells, ONE tile turns over at a time on a calm cadence
 * (lib/wallGrid: never the same tile twice in a row, never a duplicate on
 * screen, the longest-unseen photo comes in next) using the host's chosen
 * transition — a 3D flip, a crossfade or a soft zoom. Under
 * prefers-reduced-motion every transition becomes a short crossfade.
 *
 * Arrivals: a genuinely new post takes a tile immediately (lib/wallGrid
 * syncGrid) and is protected from rotation while fresh. Its tile honours the
 * SAME arrival contract as MosaicGrid — a tile in `beamingIds` is held
 * invisible and reports its rect through `onTileRect`, so ArrivalBeam lands
 * the guest's real photo in it and hands over.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, type TargetAndTransition, type Transition } from 'motion/react';
import type { Post } from '../../types';
import PostImage from '../ui/PostImage';
import { MOSAIC_VIDEO_CAP, autoplayVideoIds } from '../../lib/wallRuntime';
import type { BeamRect } from '../../lib/wallArrivals';
import { createGrid, gridRotationMs, rotateGrid, syncGrid } from '../../lib/wallGrid';
import { gridCellCount, type WallGridSize, type WallTransition } from '../../lib/sceneThemes';
import { usePrefersReducedMotion } from './wallHooks';

interface Props {
  posts: Post[];
  gridSize: WallGridSize;
  transition: WallTransition;
  freshIds?: Set<string>;
  beamingIds?: Set<string>;
  savedIds?: ReadonlySet<string>;
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  onSelect?: (post: Post) => void;
  /** Stop turning tiles (ceremony on screen, lightbox open, tab hidden). */
  paused?: boolean;
  /** Rotation cadence override (the host's mini preview runs faster). */
  intervalMs?: number;
  /** Small previews: no words at all (captions, chips, empty-cell copy) —
   *  unreadable at thumbnail size. */
  compact?: boolean;
}

interface Motion {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  mode: 'wait' | 'sync';
}

const EASE_OUT: Transition['ease'] = [0.22, 1, 0.36, 1];

/** How long a just-landed arrival keeps its highlight after the ceremony. */
const LANDED_GLOW_MS = 4500;

function motionFor(kind: WallTransition, reduced: boolean): Motion {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: 0.45 } },
      exit: { opacity: 0, transition: { duration: 0.45 } },
      mode: 'sync',
    };
  }
  switch (kind) {
    case 'flip':
      // Two halves of one turn: the old photo rotates away to edge-on, the new
      // one rotates in from the other side.
      return {
        initial: { rotateY: -90, opacity: 0.6 },
        animate: { rotateY: 0, opacity: 1, transition: { duration: 0.5, ease: EASE_OUT } },
        exit: { rotateY: 90, opacity: 0.6, transition: { duration: 0.38, ease: [0.55, 0, 0.75, 0.35] } },
        mode: 'wait',
      };
    case 'zoom':
      return {
        initial: { scale: 1.16, opacity: 0 },
        animate: { scale: 1, opacity: 1, transition: { duration: 0.9, ease: EASE_OUT } },
        exit: { scale: 0.94, opacity: 0, transition: { duration: 0.6, ease: 'easeIn' } },
        mode: 'sync',
      };
    case 'fade':
    default:
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 1.1, ease: 'easeInOut' } },
        exit: { opacity: 0, transition: { duration: 1.1, ease: 'easeInOut' } },
        mode: 'sync',
      };
  }
}

function TileMedia({ post, canPlay }: { post: Post; canPlay: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (v === null) return;
    if (canPlay) void v.play().catch(() => { /* autoplay blocked — first frame stands */ });
    else v.pause();
  }, [canPlay]);
  if (post.media_type === 'video') {
    return (
      <video
        ref={videoRef}
        src={canPlay ? post.image_url : `${post.image_url}#t=0.1`}
        autoPlay={canPlay}
        loop={canPlay}
        muted
        playsInline
        preload={canPlay ? 'auto' : 'metadata'}
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  return (
    <PostImage
      src={post.image_url}
      alt={post.guest_name ?? 'Event moment'}
      displayWidth={720}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

function GridTile({
  post, cell, isFresh, isBeaming, isMine, canPlay, motionSpec, onTileRect, onSelect, firstEmpty, compact,
}: {
  post: Post | undefined;
  cell: number;
  isFresh: boolean;
  isBeaming: boolean;
  isMine: boolean;
  canPlay: boolean;
  motionSpec: Motion;
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  onSelect?: (p: Post) => void;
  firstEmpty: boolean;
  compact: boolean;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const id = post?.id;

  // Same contract as MosaicGrid: measured after layout, before paint, so the
  // ceremony lands in the rectangle the browser actually produced.
  useLayoutEffect(() => {
    if (!isBeaming || id === undefined || onTileRect === undefined) return;
    const el = tileRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    onTileRect(id, { left: r.left, top: r.top, width: r.width, height: r.height });
    return () => onTileRect(id, null);
  }, [isBeaming, id, onTileRect]);

  // The ceremony keeps the tile invisible for most of its "fresh" window, so
  // the highlight would barely show. Once the photo has landed, hold the
  // glow a little longer — keyed by post id so the next photo in this cell
  // never inherits it.
  const [landedId, setLandedId] = useState<string | null>(null);
  const beamedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isBeaming && id !== undefined) {
      beamedRef.current = id;
      return;
    }
    if (!isBeaming && id !== undefined && beamedRef.current === id) {
      beamedRef.current = null;
      setLandedId(id);
      const t = setTimeout(() => setLandedId((cur) => (cur === id ? null : cur)), LANDED_GLOW_MS);
      return () => clearTimeout(t);
    }
  }, [isBeaming, id]);
  const glow = isFresh || (id !== undefined && landedId === id);

  return (
    <div
      ref={tileRef}
      data-cell={cell}
      className={`wall-tile relative min-h-0 min-w-0 ${glow ? 'is-fresh' : ''}`}
      style={{
        perspective: 1200,
        // Invisible, not unmounted: the ceremony needs this exact rectangle.
        opacity: isBeaming ? 0 : 1,
        transition: 'opacity 0.35s ease',
      }}
    >
      <AnimatePresence initial={false} mode={motionSpec.mode}>
        {post !== undefined ? (
          <motion.button
            type="button"
            key={post.id}
            data-wall-post={post.id}
            className="wall-tile-face absolute inset-0 overflow-hidden text-left"
            onClick={onSelect ? () => onSelect(post) : undefined}
            tabIndex={onSelect ? 0 : -1}
            aria-label={post.guest_name ? `Photo by ${post.guest_name}` : 'Event photo'}
            initial={motionSpec.initial}
            animate={motionSpec.animate}
            exit={motionSpec.exit}
            style={{
              backfaceVisibility: 'hidden',
              cursor: onSelect ? 'pointer' : 'default',
            }}
          >
            <TileMedia post={post} canPlay={canPlay} />
            {glow && !isBeaming && <span className="wall-tile-glint" aria-hidden />}
            {!compact && (glow || isMine) && (
              <span className="wall-tile-chip">{glow ? 'Just in' : 'Yours'}</span>
            )}
            {!compact && post.guest_name && (
              <span className="wall-tile-caption">
                <span className="truncate">{post.guest_name}</span>
              </span>
            )}
          </motion.button>
        ) : (
          <motion.div
            key="empty"
            className="wall-tile-empty absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {firstEmpty && !compact && (
              <span className="wall-tile-empty-label">Next photo lands here</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function GridWall({
  posts, gridSize, transition, freshIds, beamingIds, savedIds, onTileRect, onSelect, paused = false,
  intervalMs, compact = false,
}: Props) {
  const cellCount = gridCellCount(gridSize);
  const ids = useMemo(() => posts.map((p) => p.id), [posts]);
  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);
  const reduced = usePrefersReducedMotion();
  const motionSpec = useMemo(() => motionFor(transition, reduced), [transition, reduced]);

  /** Fresh arrivals and tiles mid-ceremony never rotate out. */
  const protect = useMemo(() => {
    const s = new Set<string>();
    freshIds?.forEach((id) => s.add(id));
    beamingIds?.forEach((id) => s.add(id));
    return s;
  }, [freshIds, beamingIds]);
  const protectRef = useRef(protect);
  protectRef.current = protect;
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const [grid, setGrid] = useState(() => createGrid(ids, cellCount));

  // Reconcile BEFORE paint: an arrival must be sitting in its tile by the time
  // the ceremony starts and asks for the tile's rect.
  useLayoutEffect(() => {
    setGrid((g) => {
      const { state, changes } = syncGrid(g, ids, cellCount, protectRef.current);
      return changes.length === 0 && state.cells.length === g.cells.length ? g : state;
    });
  }, [ids, cellCount]);

  // The calm rotation: one tile per tick, nothing while paused.
  const every = intervalMs ?? gridRotationMs(gridSize);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      setGrid((g) => {
        const r = rotateGrid(g, idsRef.current, { protect: protectRef.current });
        return r.change === null ? g : r.state;
      });
    }, every);
    return () => clearInterval(t);
  }, [paused, every]);

  const shownPosts = useMemo(
    () => grid.cells.map((id) => (id === null ? undefined : byId.get(id))),
    [grid.cells, byId],
  );
  const playable = useMemo(
    () => autoplayVideoIds(shownPosts.filter((p): p is Post => p !== undefined), MOSAIC_VIDEO_CAP),
    [shownPosts],
  );
  const firstEmptyCell = shownPosts.findIndex((p) => p === undefined);

  return (
    <div
      className="wall-grid grid h-full w-full"
      style={{
        gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`,
        gap: compact ? 4 : `calc(${gridSize >= 5 ? 8 : 10}px * var(--wall-scale, 1))`,
        padding: compact ? 4 : 'calc(14px * var(--wall-scale, 1))',
      }}
    >
      {shownPosts.map((post, cell) => (
        <GridTile
          // Keyed by CELL, not post: a cell is a place on the wall, and its
          // photo changing is the transition, not a remount of the tile.
          key={cell}
          cell={cell}
          post={post}
          isFresh={post !== undefined && (freshIds?.has(post.id) ?? false)}
          isBeaming={post !== undefined && (beamingIds?.has(post.id) ?? false)}
          isMine={post !== undefined && (savedIds?.has(post.id) ?? false)}
          canPlay={post !== undefined && playable.has(post.id)}
          motionSpec={motionSpec}
          onTileRect={onTileRect}
          onSelect={onSelect}
          firstEmpty={cell === firstEmptyCell}
          compact={compact}
        />
      ))}
    </div>
  );
}
