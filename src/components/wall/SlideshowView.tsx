/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SlideshowView — full-bleed single-post projection display.
 *
 * Features:
 * - Slow Ken-Burns drift (pan + scale) on each image post
 * - Elegant cross-fade between posts (AnimatePresence)
 * - Glass caption plate with guest name + message
 * - Auto-advances every ~6 seconds
 * - Manual prev/next controls (auto-hide after 3 s of no mouse movement)
 * - projectionMode: hides all chrome, shows only photo + tiny wordmark + dust
 * - media_type:'video': renders <video autoPlay loop muted playsInline> with
 *   no Ken-Burns (video has its own motion); Ken-Burns only on images.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Post } from '../../types';
import { Wordmark } from '../ui/EventLogo';

interface Props {
  posts: Post[];
  projectionMode: boolean;
  currentIndex: number;
  onIndexChange: (i: number) => void;
  /** Seconds each slide is shown before auto-advancing (default 6). */
  slideshowInterval?: number;
}

// Ken-Burns keyframe configs — cycle through them (images only)
const KB_CONFIGS = [
  { from: { scale: 1.08, x: -2, y: -2 }, to: { scale: 1.18, x: 2, y: 2 } },
  { from: { scale: 1.1, x: 1, y: -1 }, to: { scale: 1.2, x: -2, y: 1 } },
  { from: { scale: 1.12, x: -1, y: 2 }, to: { scale: 1.06, x: 2, y: -2 } },
  { from: { scale: 1.15, x: 0, y: -1 }, to: { scale: 1.08, x: 0, y: 1 } },
];

const DEFAULT_ADVANCE_INTERVAL = 6000;

/** Small play badge for slideshow video posts */
function PlayBadge() {
  return (
    <div
      className="absolute top-3 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full"
      style={{
        background: 'rgba(10,7,3,0.65)',
        border: '1px solid rgba(212,175,55,0.3)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
        <path d="M0.5 1L7.5 5L0.5 9Z" fill="#D4AF37" />
      </svg>
      <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/70">
        Video
      </span>
    </div>
  );
}

export default function SlideshowView({
  posts,
  projectionMode,
  currentIndex,
  onIndexChange,
  slideshowInterval,
}: Props) {
  const advanceMs = (slideshowInterval ?? 6) * 1000 || DEFAULT_ADVANCE_INTERVAL;
  const [showControls, setShowControls] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const post = posts[currentIndex] ?? null;
  const isVideo = post?.media_type === 'video';
  const kbCfg = KB_CONFIGS[currentIndex % KB_CONFIGS.length];

  // Auto-advance — the interval reads the latest index from a ref so a newly
  // arrived post (which resets the index to 0) never causes a backward jump.
  const idxRef = useRef(currentIndex);
  useEffect(() => { idxRef.current = currentIndex; }, [currentIndex]);

  // Keep a ref to advanceMs so resetAuto always uses the latest value without
  // being re-created every time the interval changes.
  const advanceMsRef = useRef(advanceMs);
  useEffect(() => { advanceMsRef.current = advanceMs; }, [advanceMs]);

  const resetAuto = useCallback(() => {
    if (autoTimer.current) clearInterval(autoTimer.current);
    if (posts.length <= 1) return;
    autoTimer.current = setInterval(() => {
      onIndexChange((idxRef.current + 1) % Math.max(posts.length, 1));
    }, advanceMsRef.current);
  }, [posts.length, onIndexChange]);

  useEffect(() => {
    resetAuto();
    return () => {
      if (autoTimer.current) clearInterval(autoTimer.current);
    };
  }, [resetAuto]);

  // Re-arm the interval when the admin changes slideshowInterval live.
  useEffect(() => {
    advanceMsRef.current = advanceMs;
    resetAuto();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanceMs]);

  // Mouse-move reveals controls briefly
  const handleMouseMove = useCallback(() => {
    if (projectionMode) return;
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, [projectionMode]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const prev = () => {
    onIndexChange((currentIndex - 1 + posts.length) % posts.length);
    resetAuto();
  };
  const next = () => {
    onIndexChange((currentIndex + 1) % posts.length);
    resetAuto();
  };

  if (!post) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center animate-rise-in">
          <p className="font-serif italic text-5xl text-foil-static mb-4">
            Be the first to capture a moment…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-noir-900"
      onMouseMove={handleMouseMove}
    >
      {/* Cross-fading posts with Ken-Burns (images) or plain fade (videos) */}
      <AnimatePresence mode="sync">
        <motion.div
          key={post.id}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeInOut' }}
        >
          {isVideo ? (
            /* Video — no Ken-Burns, just fill */
            <div className="absolute inset-0">
              <video
                src={post.image_url}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-contain"
                style={{ background: '#0a0703' }}
              />
              <PlayBadge />
            </div>
          ) : (
            /* Image — Ken-Burns drift */
            <motion.div
              className="absolute inset-0"
              initial={kbCfg.from}
              animate={kbCfg.to}
              transition={{ duration: 7, ease: 'linear' }}
              style={{ transformOrigin: 'center center' }}
            >
              <img
                src={post.image_url}
                alt={post.guest_name ?? 'Gala moment'}
                className="w-full h-full object-contain"
                style={{ background: '#0a0703' }}
                draggable={false}
              />
            </motion.div>
          )}

          {/* Deep vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 85% 85% at 50% 50%, transparent 40%, rgba(5,3,1,0.72) 100%)',
            }}
          />

          {/* Caption plate — glass panel at bottom */}
          {(post.guest_name || post.message) && (
            <motion.div
              className="absolute bottom-0 inset-x-0 flex justify-center pb-16"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.6 }}
            >
              <div
                className="glass px-8 py-4 rounded-2xl max-w-2xl text-center"
                style={{
                  border: '1px solid rgba(212,175,55,0.25)',
                  boxShadow:
                    '0 8px 40px rgba(0,0,0,0.5), 0 0 24px rgba(212,175,55,0.12)',
                }}
              >
                {post.guest_name && (
                  <p className="font-serif italic text-2xl text-ivory/95 leading-tight">
                    {post.guest_name}
                  </p>
                )}
                {post.message && (
                  <p className="font-sans text-champagne/75 text-base mt-1 leading-snug">
                    {post.message}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Projection-mode wordmark — only when the Wall header is hidden, so it
          doesn't double-up with the Wall's own top-left wordmark. */}
      {projectionMode && (
        <div className="absolute top-6 left-8 z-20" style={{ opacity: 0.65 }}>
          <Wordmark size="sm" />
        </div>
      )}

      {/* Slide counter dot-pips — hidden in projection mode */}
      {!projectionMode && posts.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
          {posts.slice(0, Math.min(posts.length, 20)).map((p, i) => (
            <button
              key={p.id}
              onClick={() => {
                onIndexChange(i);
                resetAuto();
              }}
              className={`rounded-full transition-all duration-300 ${
                i === currentIndex
                  ? 'w-6 h-2 bg-foil glow-accent'
                  : 'w-2 h-2 bg-champagne/30 hover:bg-champagne/60'
              }`}
            />
          ))}
          {posts.length > 20 && (
            <span className="text-champagne/40 text-xs font-label self-center ml-1">
              +{posts.length - 20}
            </span>
          )}
        </div>
      )}

      {/* Prev / Next controls — hidden in projection mode, auto-hide */}
      {!projectionMode && (
        <AnimatePresence>
          {showControls && posts.length > 1 && (
            <>
              <motion.button
                key="prev"
                onClick={prev}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 glass rounded-full w-12 h-12 flex items-center justify-center hover:glow-accent transition-all"
                style={{ border: '1px solid rgba(212,175,55,0.3)' }}
              >
                <span className="text-ivory text-xl">‹</span>
              </motion.button>
              <motion.button
                key="next"
                onClick={next}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 glass rounded-full w-12 h-12 flex items-center justify-center hover:glow-accent transition-all"
                style={{ border: '1px solid rgba(212,175,55,0.3)' }}
              >
                <span className="text-ivory text-xl">›</span>
              </motion.button>
            </>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
