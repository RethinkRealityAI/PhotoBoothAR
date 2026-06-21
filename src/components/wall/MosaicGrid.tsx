/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MosaicGrid — responsive masonry-style grid of all wall posts, newest first.
 * Columns: 2 on sm, 3 on md, 4 on lg, 5 on xl.
 *
 * Supports media_type:'image'|'video'.
 * Videos render as <video autoPlay loop muted playsInline> with a play glyph badge.
 */
import { useRef } from 'react';
import { motion } from 'motion/react';
import { Post } from '../../types';

interface Props {
  posts: Post[];
  /** IDs that just beam-in and should get a special glow ring briefly */
  freshIds?: Set<string>;
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
        border: '1px solid rgba(212,175,55,0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
        <path d="M1 1.5 L9 6 L1 10.5 Z" fill="#D4AF37" />
      </svg>
    </div>
  );
}

function PostCard({ post, isFresh }: { post: Post; isFresh: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = post.media_type === 'video';
  const ar = post.width && post.height ? `${post.width}/${post.height}` : '9/16';

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{
        boxShadow: isFresh
          ? '0 0 0 2px #D4AF37, 0 0 32px 8px rgba(212,175,55,0.33)'
          : '0 4px 24px rgba(0,0,0,0.45)',
        transition: 'box-shadow 0.6s ease',
      }}
    >
      {isVideo ? (
        <>
          <video
            ref={videoRef}
            src={post.image_url}
            autoPlay
            loop
            muted
            playsInline
            className="w-full block object-cover"
            style={{ aspectRatio: ar, background: '#0a0703' }}
          />
          <PlayBadge />
        </>
      ) : (
        <img
          src={post.image_url}
          alt={post.guest_name ?? 'Gala moment'}
          loading="lazy"
          decoding="async"
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
            <p className="font-serif italic text-ivory/90 text-[13px] leading-tight truncate">
              {post.guest_name}
            </p>
          )}
          {post.message && (
            <p className="font-sans text-champagne/70 text-[11px] leading-tight line-clamp-2 mt-0.5">
              {post.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function MosaicGrid({ posts, freshIds }: Props) {
  if (posts.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center animate-rise-in">
          <p className="font-serif italic text-4xl gold-foil-static mb-4">
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
      className="w-full h-full overflow-y-auto hide-scrollbar px-4 py-4"
      style={{
        columns: 'var(--wall-cols, 4)',
        columnGap: '12px',
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
        return (
          <motion.div
            key={post.id}
            className="break-inside-avoid mb-3"
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: 0.55,
              delay: Math.min(i * 0.04, 0.8),
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <PostCard post={post} isFresh={isFresh} />
          </motion.div>
        );
      })}
    </div>
  );
}
