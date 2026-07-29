/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MosaicGrid — responsive masonry-style grid of all wall posts, newest first.
 * Columns: 2 on sm, 3 on md, 4 on lg, 5 on xl.
 *
 * Supports media_type:'image'|'video'.
 *
 * Videos: only the newest MOSAIC_VIDEO_CAP actually play. Browsers cap
 * concurrent hardware video decoders, and past that limit further <video>
 * elements render solid black — a wall with twenty clips on it became a grid
 * of black rectangles. The rest show their first frame (`preload="metadata"`
 * plus a `#t=` fragment) behind the play badge.
 *
 * Arrival ceremony: a tile whose id is in `beamingIds` is held invisible and
 * reports its DOMRect through `onTileRect`, so ArrivalBeam can reassemble the
 * guest's photo into exactly that rectangle and hand over.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import { Post } from '../../types';
import PostImage from '../ui/PostImage';
import { MOSAIC_VIDEO_CAP, autoplayVideoIds, mosaicTileMaxH } from '../../lib/wallRuntime';
import type { BeamRect } from '../../lib/wallArrivals';

interface Props {
  posts: Post[];
  /** IDs that just beam-in and should get a special glow ring briefly */
  freshIds?: Set<string>;
  /** IDs currently in flight in the arrival ceremony — held invisible so the
   *  same moment is never on screen twice at once. */
  beamingIds?: Set<string>;
  /** Report a beaming tile's viewport rect (null when it goes away). */
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  /** Live viewport height — caps tile height on very tall screens. */
  viewportH?: number;
  /** Tap a card to open it (download/share). */
  onSelect?: (post: Post) => void;
}

/** Small play-glyph badge shown on video thumbnails */
function PlayBadge() {
  return (
    <div
      className="absolute top-2 right-2 z-10 flex items-center justify-center rounded-full"
      style={{
        width: 28,
        height: 28,
        background: 'rgba(10,7,3,0.72)',
        border: '1px solid rgba(var(--accent-rgb),0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
        <path d="M1 1.5 L9 6 L1 10.5 Z" fill="#D4AF37" />
      </svg>
    </div>
  );
}

function PostCard({
  post, isFresh, isBeaming, canPlay, maxH, onTileRect, onSelect,
}: {
  post: Post;
  isFresh: boolean;
  isBeaming: boolean;
  canPlay: boolean;
  /** Height ceiling in px, or 0 for none — see wallRuntime.mosaicTileMaxH. */
  maxH: number;
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  onSelect?: (p: Post) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const isVideo = post.media_type === 'video';
  const ar = post.width && post.height ? `${post.width}/${post.height}` : '9/16';

  // Report the landing rect AFTER layout but BEFORE paint, so the ceremony
  // always measures the tile the browser actually produced. Measuring here
  // rather than predicting it is the whole point: the mosaic is a CSS
  // `columns` masonry, so which column a prepended card lands in is the
  // browser's decision, not something the caller can compute.
  useLayoutEffect(() => {
    if (!isBeaming || onTileRect === undefined) return;
    const el = cardRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    onTileRect(post.id, { left: r.left, top: r.top, width: r.width, height: r.height });
    return () => onTileRect(post.id, null);
  }, [isBeaming, post.id, onTileRect]);

  // Hold the decoder count down: a capped-out video is paused AND its buffer
  // released, otherwise the element still holds a decoder it never uses.
  useEffect(() => {
    const v = videoRef.current;
    if (v === null) return;
    if (canPlay) {
      void v.play().catch(() => { /* autoplay blocked — the poster frame stands */ });
    } else {
      v.pause();
    }
  }, [canPlay]);

  return (
    <div
      ref={cardRef}
      className={`relative overflow-hidden rounded-xl ${onSelect ? 'cursor-pointer' : ''}`}
      onClick={onSelect ? () => onSelect(post) : undefined}
      style={{
        boxShadow: isFresh
          ? '0 0 0 2px #D4AF37, 0 0 32px 8px rgba(var(--accent-rgb),0.33)'
          : '0 4px 24px rgba(0,0,0,0.45)',
        transition: 'box-shadow 0.6s ease, opacity 0.35s ease',
        // Invisible, not unmounted: the ceremony needs this exact rectangle.
        opacity: isBeaming ? 0 : 1,
        // The media keeps its aspect ratio and is cover-cropped by this box,
        // so a 9:16 capture cannot grow to 1300 px on a 4K projector and push
        // every other photo off screen. 0 = uncapped (laptop and phone).
        maxHeight: maxH > 0 ? maxH : undefined,
      }}
    >
      {isVideo ? (
        <>
          <video
            ref={videoRef}
            // `#t=0.1` makes a non-playing clip paint its first frame instead
            // of an empty black box.
            src={canPlay ? post.image_url : `${post.image_url}#t=0.1`}
            autoPlay={canPlay}
            loop={canPlay}
            muted
            playsInline
            preload={canPlay ? 'auto' : 'metadata'}
            className="w-full block object-cover"
            style={{ aspectRatio: ar, background: '#0a0703' }}
          />
          <PlayBadge />
        </>
      ) : (
        <PostImage
          src={post.image_url}
          alt={post.guest_name ?? 'Event moment'}
          displayWidth={720}
          className="w-full block object-cover"
          style={{ aspectRatio: ar }}
        />
      )}

      {/* Caption overlay */}
      {(post.guest_name || post.message) && (
        <div
          className="absolute bottom-0 inset-x-0 px-3 py-2"
          style={{
            background:
              'linear-gradient(to top, rgba(10,7,3,0.82) 0%, rgba(10,7,3,0) 100%)',
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
              className="font-sans text-champagne/70 leading-tight line-clamp-2 mt-0.5"
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

export default function MosaicGrid({ posts, freshIds, beamingIds, viewportH, onTileRect, onSelect }: Props) {
  const playable = useMemo(() => autoplayVideoIds(posts, MOSAIC_VIDEO_CAP), [posts]);
  const maxH = mosaicTileMaxH(viewportH ?? 0);

  // Empty state lives in Wall.tsx (<EmptyWall/>) — shared across all modes.
  return (
    <div
      className="w-full h-full overflow-y-auto hide-scrollbar px-4 pt-4 pb-24 sm:pb-4"
      style={{
        columns: 'var(--wall-cols, 4)',
        columnGap: 'calc(12px * var(--wall-scale, 1))',
      }}
    >
      <style>{`
        @media (max-width: 640px)  { :root { --wall-cols: 2 } }
        @media (min-width: 641px) and (max-width: 1023px) { :root { --wall-cols: 3 } }
        @media (min-width: 1024px) and (max-width: 1535px) { :root { --wall-cols: 4 } }
        @media (min-width: 1536px) { :root { --wall-cols: 5 } }
      `}</style>

      {posts.map((post, i) => {
        const isFresh = freshIds?.has(post.id) ?? false;
        const isBeaming = beamingIds?.has(post.id) ?? false;
        return (
          <motion.div
            key={post.id}
            className="break-inside-avoid"
            style={{ marginBottom: 'calc(12px * var(--wall-scale, 1))' }}
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: 0.55,
              delay: Math.min(i * 0.04, 0.8),
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <PostCard
              post={post}
              isFresh={isFresh}
              isBeaming={isBeaming}
              canPlay={playable.has(post.id)}
              maxH={maxH}
              onTileRect={onTileRect}
              onSelect={onSelect}
            />
          </motion.div>
        );
      })}
    </div>
  );
}
