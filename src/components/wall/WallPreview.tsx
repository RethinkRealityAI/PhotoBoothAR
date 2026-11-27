/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WallPreview — the host's live miniature of the projected wall, drawn from
 * the SAME pieces the wall uses: WallBackdrop, the [data-wall-tone] chrome
 * styles and, for the grid, the real GridWall turning tiles with the chosen
 * transition. The other layouts are faithful CSS sketches (a WebGL carousel
 * per thumbnail would be a second GPU context on the host's laptop).
 *
 * The chrome is drawn as shapes, not words: at this size any label would be
 * unreadable, and host screens never carry text under 12px.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Post } from '../../types';
import {
  resolveScene,
  resolveWallBackdrop,
  wallTone,
  type EventScene,
  type WallLook,
} from '../../lib/sceneThemes';
import GridWall from './GridWall';
import AlbumView from './AlbumView';
import WallBackdrop from './WallBackdrop';
import { usePrefersReducedMotion } from './wallHooks';
import { samplePosts } from '../theme/samplePhotos';

export { samplePosts };

function rgb(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '212, 214, 255';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function Shot({ post, style, className = '' }: { post: Post; style?: CSSProperties; className?: string }) {
  return (
    <img
      src={post.image_url}
      alt=""
      draggable={false}
      loading="lazy"
      className={`block object-cover ${className}`}
      style={{ borderRadius: 6, boxShadow: '0 6px 16px -10px rgba(4,3,20,0.8)', ...style }}
    />
  );
}

function MasonrySketch({ posts }: { posts: Post[] }) {
  const ratios = [1.35, 0.8, 1.1, 1.5, 0.9, 1.25, 1.0, 1.4];
  return (
    <div className="h-full overflow-hidden" style={{ columns: 4, columnGap: 6 }}>
      {posts.slice(0, 16).map((p, i) => (
        <Shot key={p.id} post={p} className="w-full" style={{ aspectRatio: `1 / ${ratios[i % ratios.length]}`, marginBottom: 6 }} />
      ))}
    </div>
  );
}

function MarqueeSketch({ posts }: { posts: Post[] }) {
  const rows = [0, 1, 2].map((r) => posts.filter((_, i) => i % 3 === r).slice(0, 8));
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 overflow-hidden">
      {rows.map((row, r) => (
        <div key={r} className={`wall-preview-marquee-row ${r % 2 === 1 ? 'reverse' : ''}`} style={{ height: '31%' }}>
          {[...row, ...row].map((p, i) => (
            <Shot key={`${p.id}-${i}`} post={p} style={{ height: '100%', aspectRatio: '3 / 4' }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CarouselSketch({ posts, width }: { posts: Post[]; width: number }) {
  const n = 10;
  const cardW = Math.max(36, width * 0.13);
  const radius = (cardW * 1.15) / (2 * Math.tan(Math.PI / n));
  return (
    <div className="relative h-full" style={{ perspective: width * 1.4 }}>
      <div className="wall-preview-ring" style={{ transform: `translateZ(${-radius}px)` }}>
        {posts.slice(0, n).map((p, i) => (
          <div
            key={p.id}
            className="absolute left-1/2 top-1/2"
            style={{
              width: cardW,
              aspectRatio: '3 / 4',
              marginLeft: -cardW / 2,
              marginTop: -(cardW * 4) / 6,
              transform: `rotateY(${(360 / n) * i}deg) translateZ(${radius}px)`,
            }}
          >
            <Shot post={p} className="h-full w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SlideshowSketch({ posts }: { posts: Post[] }) {
  const reduced = usePrefersReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced || posts.length < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % Math.min(posts.length, 8)), 2800);
    return () => clearInterval(t);
  }, [reduced, posts.length]);
  const post = posts[i % Math.max(1, posts.length)];
  if (post === undefined) return null;
  return (
    <div className="relative h-full overflow-hidden" style={{ borderRadius: 8 }}>
      <AnimatePresence initial={false}>
        <motion.div
          key={post.id}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeInOut' }}
        >
          <img src={post.image_url} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" style={{ filter: 'blur(14px)', opacity: 0.7, transform: 'scale(1.15)' }} />
          <img src={post.image_url} alt="" className="absolute inset-0 m-auto h-full object-contain" />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

interface Props {
  look: WallLook;
  /** The event's own scene — what "Follow event theme" shows. */
  eventScene?: EventScene;
  posts: Post[];
}

export default function WallPreview({ look, eventScene, posts }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setWidth(el.clientWidth || 640);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.max(0.2, width / 1440);
  const backdrop = resolveWallBackdrop(look);
  const eventResolved = useMemo(() => resolveScene(eventScene), [eventScene]);
  const tone = wallTone(look, eventResolved.tone);
  const scene = backdrop ?? eventResolved;
  const accent = backdrop?.accent ?? (tone === 'light' ? '#4B47B8' : eventResolved.accent);
  const u = (px: number) => Math.max(1, px * scale);
  const pill: CSSProperties = { height: u(44), borderRadius: 999 };
  const bar = (w: number, on = false): CSSProperties => ({
    width: u(w),
    height: u(10),
    borderRadius: 99,
    background: on ? `rgba(${rgb(accent)}, 0.9)` : tone === 'light' ? 'rgba(28,26,76,0.28)' : 'rgba(255,255,255,0.4)',
  });

  const area: CSSProperties = { top: u(132), left: u(14), right: u(160), bottom: u(14) };

  return (
    <div
      ref={ref}
      data-wall-tone={tone}
      className="relative w-full overflow-hidden rounded-2xl"
      style={{
        aspectRatio: '16 / 10',
        '--wall-scale': scale,
        '--color-accent': accent,
        '--accent-rgb': rgb(accent),
        boxShadow: '0 30px 60px -30px rgba(6,5,26,0.8), inset 0 0 0 1px rgba(255,255,255,0.12)',
        isolation: 'isolate',
      } as CSSProperties}
      role="img"
      aria-label="Live preview of your wall"
    >
      <WallBackdrop scene={scene} animated={false} />
      {backdrop === null && tone === 'light' && (
        <div aria-hidden className="absolute inset-0" style={{ background: 'rgba(246, 245, 252, 0.8)' }} />
      )}

      {/* Chrome, as shapes: wordmark · nav · counter, then the view switcher. */}
      <div className="wall-chrome absolute inset-x-0 top-0" aria-hidden style={{ padding: u(14) }}>
        <div className="flex items-center justify-between">
          <div className="wall-glass flex items-center" style={{ ...pill, width: u(160), paddingLeft: u(18) }}>
            <span style={bar(90)} />
          </div>
          <div className="wall-glass flex items-center justify-center" style={{ ...pill, width: u(330), gap: u(14) }}>
            {[0, 1, 2, 3].map((i) => <span key={i} style={bar(52, i === 1)} />)}
          </div>
          <div className="wall-glass flex items-center justify-center" style={{ ...pill, width: u(130), gap: u(8) }}>
            <span style={{ width: u(8), height: u(8), borderRadius: 99, background: 'rgba(120,220,150,0.9)' }} />
            <span style={bar(60)} />
          </div>
        </div>
        <div className="flex justify-center" style={{ marginTop: u(14) }}>
          <div className="wall-glass flex items-center" style={{ ...pill, gap: u(18), paddingInline: u(18) }}>
            {(['grid', 'masonry', 'marquee', 'carousel', 'slideshow', 'album'] as const).map((l) => (
              <span key={l} style={bar(56, l === look.layout)} />
            ))}
          </div>
        </div>
      </div>

      {/* The feed. */}
      <div className="absolute" style={area}>
        {look.layout === 'grid' && (
          <GridWall
            // A new size or transition is a new composition — restart it.
            key={`${look.gridSize}-${look.transition}`}
            posts={posts}
            gridSize={look.gridSize}
            transition={look.transition}
            intervalMs={1500}
            compact
          />
        )}
        {look.layout === 'masonry' && <MasonrySketch posts={posts} />}
        {look.layout === 'marquee' && <MarqueeSketch posts={posts} />}
        {look.layout === 'carousel' && <CarouselSketch posts={posts} width={width} />}
        {look.layout === 'slideshow' && <SlideshowSketch posts={posts} />}
        {look.layout === 'album' && <AlbumView posts={posts} compact tone={tone} captions={false} />}
      </div>

      {/* QR rail. */}
      <div className="wall-chrome absolute flex flex-col justify-center" aria-hidden style={{ right: u(16), top: u(132), bottom: u(14), gap: u(14) }}>
        {[0, 1].map((i) => (
          <div key={i} className="wall-glass flex flex-col items-center" style={{ borderRadius: u(20), padding: u(14), gap: u(10) }}>
            <span style={{ width: u(96), height: u(96), borderRadius: u(12), background: '#fff' }} />
            <span style={bar(80)} />
          </div>
        ))}
      </div>
    </div>
  );
}
