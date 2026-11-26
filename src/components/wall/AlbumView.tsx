/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AlbumView — the live wall as a photo album.
 *
 * Guests' photos are stamped onto album pages, three or four to a page, each
 * one a few degrees off true and held by little photo corners, and the book
 * turns a page every few seconds. On a wide screen it is an open two-page
 * spread with a spine down the middle; on a tall one, a single page.
 *
 * NO WHITE BORDER on the photos: they already wear the event's Frames, and a
 * Polaroid edge around a frame reads as a frame in a frame. The photo corners
 * are what make it an album.
 *
 * Placement is pure and deterministic (lib/albumLayout): a photo keeps its
 * spot and tilt all night, and the pages fill in the order photos were taken,
 * so new photos only ever extend the last page or start a new one.
 *
 * THE ARRIVAL BEAM STILL LANDS. ArrivalBeam measures its destination once,
 * when the ceremony starts, so a photo that is mid-ceremony must already be
 * on screen in that same commit: the spread holding a beaming photo is shown
 * straight away (no page turn) and the photo reports its rectangle from a
 * layout effect, held invisible until the beam lands — the GridWall contract.
 * After an arrival the next turn goes to the newest page, so the room sees it.
 *
 * Only the open spread (and, mid-turn, the one being turned to) is mounted,
 * so a 400-photo album costs the same as an 8-photo one.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'motion/react';
import type { Post } from '../../types';
import PostImage from '../ui/PostImage';
import type { BeamRect } from '../../lib/wallArrivals';
import { albumHoldSec, albumPages, albumSpreads, nextSpread, pageSlots, spreadOf } from '../../lib/albumLayout';
import { usePrefersReducedMotion } from './wallHooks';

interface Props {
  posts: Post[];
  freshIds?: ReadonlySet<string>;
  beamingIds?: ReadonlySet<string>;
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  onSelect?: (post: Post) => void;
  /** Stop turning pages (ceremony on screen, lightbox open, tab hidden). */
  paused?: boolean;
  tone?: 'dark' | 'light';
  captions?: boolean;
  /** Small previews: no words, faster turns. */
  compact?: boolean;
  /** Remember the open page across remounts (the wall's layout rotation). */
  memoryKey?: string;
}

const TURN_SEC = 1.35;
/** Where the album was, per wall, so rotating away and back resumes it. */
const lastSpread = new Map<string, number>();

/** Page colours. Dark walls get the classic black-paper album with ivory
 *  corners; light walls an ivory page with dark corners. */
function paper(tone: 'dark' | 'light') {
  return tone === 'light'
    ? { page: '#F5F0E6', edge: '#E4DCCB', corner: 'rgba(44, 38, 50, 0.92)', ink: 'rgba(40, 34, 46, 0.78)', grain: 'rgba(120, 100, 70, 0.05)' }
    : { page: '#1B1A22', edge: '#121118', corner: 'rgba(242, 234, 216, 0.9)', ink: 'rgba(242, 234, 216, 0.72)', grain: 'rgba(255, 255, 255, 0.025)' };
}

function PhotoCorners({ size, color }: { size: number; color: string }) {
  const base: CSSProperties = { position: 'absolute', width: size, height: size, background: color, pointerEvents: 'none' };
  const off = -size * 0.32;
  return (
    <>
      <span aria-hidden style={{ ...base, left: off, top: off, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
      <span aria-hidden style={{ ...base, right: off, top: off, clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />
      <span aria-hidden style={{ ...base, left: off, bottom: off, clipPath: 'polygon(0 0, 0 100%, 100% 100%)' }} />
      <span aria-hidden style={{ ...base, right: off, bottom: off, clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }} />
    </>
  );
}

function AlbumPhoto({
  post, slot, pageW, pageH, colors, isFresh, isBeaming, onTileRect, onSelect, captions, compact, index,
}: {
  post: Post;
  slot: ReturnType<typeof pageSlots>[number];
  pageW: number;
  pageH: number;
  colors: ReturnType<typeof paper>;
  isFresh: boolean;
  isBeaming: boolean;
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  onSelect?: (post: Post) => void;
  captions: boolean;
  compact: boolean;
  index: number;
}) {
  // Booth photos are 9:16; an upload may not be. Learn the real shape on load.
  const [aspect, setAspect] = useState(9 / 16);
  const boxW = slot.maxW * pageW;
  const boxH = slot.maxH * pageH * (captions && !compact ? 0.86 : 1);
  const w = Math.min(boxW, boxH * aspect);
  const h = w / aspect;
  const ref = useRef<HTMLButtonElement>(null);
  const id = post.id;

  useLayoutEffect(() => {
    if (!isBeaming || onTileRect === undefined) return;
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    onTileRect(id, { left: r.left, top: r.top, width: r.width, height: r.height });
    return () => onTileRect(id, null);
  }, [isBeaming, id, onTileRect]);

  const corner = Math.max(6, Math.min(26, Math.min(w, h) * 0.12));
  return (
    <div
      className="absolute"
      style={{
        left: slot.cx * pageW - w / 2,
        top: slot.cy * pageH - h / 2 - (captions && !compact ? boxH * 0.06 : 0),
        width: w,
        transform: `rotate(${slot.tilt}deg)`,
        opacity: isBeaming ? 0 : 1,
        transition: 'opacity 0.35s ease',
      }}
    >
      <motion.button
        ref={ref}
        type="button"
        data-wall-post={post.id}
        onClick={onSelect ? () => onSelect(post) : undefined}
        tabIndex={onSelect ? 0 : -1}
        aria-label={post.guest_name ? `Photo by ${post.guest_name}` : 'Event photo'}
        className="relative block"
        style={{
          width: w,
          height: h,
          cursor: onSelect ? 'pointer' : 'default',
          borderRadius: 2,
          boxShadow: isFresh
            ? '0 0 0 2px rgba(var(--accent-rgb, 212,214,255), 0.9), 0 0 28px 4px rgba(var(--accent-rgb, 212,214,255), 0.55), 0 10px 22px -10px rgba(0,0,0,0.7)'
            : '0 1px 2px rgba(0,0,0,0.35), 0 10px 22px -10px rgba(0,0,0,0.7)',
        }}
        // Learn the photo's real shape from PostImage's own <img> (load does
        // not bubble, but it does capture), so nothing is downloaded twice.
        onLoadCapture={(e) => {
          const i = e.target;
          if (i instanceof HTMLImageElement && i.naturalWidth > 0 && i.naturalHeight > 0) setAspect(i.naturalWidth / i.naturalHeight);
        }}
        // Only a photo that just arrived is stamped down; a page being turned
        // to must look like it was always there.
        initial={isFresh && !compact ? { opacity: 0, scale: 1.12 } : false}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.08 * index, ease: [0.22, 1, 0.36, 1] }}
      >
        {post.media_type === 'video' ? (
          <video
            src={post.image_url}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
            style={{ borderRadius: 2 }}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(v.videoWidth / v.videoHeight);
            }}
          />
        ) : (
          <PostImage
            src={post.image_url}
            alt={post.guest_name ?? 'Event moment'}
            displayWidth={Math.max(240, Math.round(w))}
            eager
            className="absolute inset-0 h-full w-full object-cover"
            style={{ borderRadius: 2 }}
          />
        )}
        <PhotoCorners size={corner} color={colors.corner} />
      </motion.button>
      {captions && !compact && post.guest_name && (
        <p
          className="wall-album-caption mt-[0.5em] truncate text-center font-serif italic"
          style={{ color: colors.ink, fontSize: Math.max(11, Math.min(24, pageH * 0.03)) }}
        >
          {post.guest_name}
        </p>
      )}
    </div>
  );
}

function Page({
  ids, byId, side, pageW, pageH, colors, number, freshIds, beamingIds, onTileRect, onSelect, captions, compact,
}: {
  ids: readonly string[] | undefined;
  byId: ReadonlyMap<string, Post>;
  side: 'left' | 'right' | 'single';
  pageW: number;
  pageH: number;
  colors: ReturnType<typeof paper>;
  number: number;
  freshIds?: ReadonlySet<string>;
  beamingIds?: ReadonlySet<string>;
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  onSelect?: (post: Post) => void;
  captions: boolean;
  compact: boolean;
}) {
  const slots = ids ? pageSlots(ids) : [];
  // The gutter darkens toward the spine, like a real bound page.
  const spine = side === 'left'
    ? 'linear-gradient(to left, rgba(0,0,0,0.38), rgba(0,0,0,0) 9%)'
    : side === 'right'
      ? 'linear-gradient(to right, rgba(0,0,0,0.38), rgba(0,0,0,0) 9%)'
      : 'linear-gradient(to right, rgba(0,0,0,0.3), rgba(0,0,0,0) 6%)';
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        background: `${spine}, radial-gradient(circle at 30% 20%, ${colors.grain} 0 1px, transparent 1.5px) 0 0 / 7px 7px, ${colors.page}`,
        borderRadius: side === 'left' ? '6px 2px 2px 6px' : side === 'right' ? '2px 6px 6px 2px' : 6,
      }}
    >
      {ids?.map((id, i) => {
        const post = byId.get(id);
        if (post === undefined) return null;
        return (
          <AlbumPhoto
            key={id}
            post={post}
            slot={slots[i]}
            pageW={pageW}
            pageH={pageH}
            colors={colors}
            isFresh={freshIds?.has(id) === true}
            isBeaming={beamingIds?.has(id) === true}
            onTileRect={onTileRect}
            onSelect={onSelect}
            captions={captions}
            compact={compact}
            index={i}
          />
        );
      })}
      {!compact && ids !== undefined && (
        <span
          aria-hidden
          className="absolute bottom-[2.2%] font-serif italic"
          style={{
            color: colors.ink,
            opacity: 0.6,
            fontSize: Math.max(10, pageH * 0.022),
            ...(side === 'left' ? { left: '5%' } : side === 'right' ? { right: '5%' } : { right: '5%' }),
          }}
        >
          {number}
        </span>
      )}
    </div>
  );
}

export default function AlbumView({
  posts, freshIds, beamingIds, onTileRect, onSelect, paused = false, tone = 'dark', captions = true,
  compact = false, memoryKey,
}: Props) {
  const reduced = usePrefersReducedMotion();
  const colors = paper(tone);
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = host.current;
    if (el === null) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A spread on a landscape screen, one page on a tall or small one.
  const twoUp = box.w >= box.h * 1.15 && box.w >= 560;
  const perSpread: 1 | 2 = twoUp ? 2 : 1;
  const ids = useMemo(() => posts.map((p) => p.id), [posts]);
  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);
  const pages = useMemo(() => albumPages(ids), [ids]);
  const spreads = useMemo(() => albumSpreads(pages, perSpread), [pages, perSpread]);
  const count = spreads.length;

  const [spread, setSpread] = useState(() => (memoryKey ? lastSpread.get(memoryKey) ?? 0 : 0));
  const [turningTo, setTurningTo] = useState<number | null>(null);
  const safe = count === 0 ? 0 : Math.min(spread, count - 1);

  // A photo mid-ceremony must be on screen NOW (see the header): show its
  // spread in this very render, no page turn.
  const beamingSpread = useMemo(() => {
    if (beamingIds === undefined || beamingIds.size === 0) return -1;
    for (const id of beamingIds) {
      const s = spreadOf(spreads, id);
      if (s >= 0) return s;
    }
    return -1;
  }, [beamingIds, spreads]);
  const shown = beamingSpread >= 0 ? beamingSpread : safe;
  useEffect(() => {
    if (beamingSpread >= 0 && beamingSpread !== spread) {
      setTurningTo(null);
      setSpread(beamingSpread);
    }
  }, [beamingSpread, spread]);
  useEffect(() => {
    if (memoryKey) lastSpread.set(memoryKey, shown);
  }, [memoryKey, shown]);

  // The newest photo's page jumps the queue once, when it arrives.
  const newestId = ids[0];
  const seenNewest = useRef(newestId);
  const [pendingNewest, setPendingNewest] = useState(-1);
  useEffect(() => {
    if (newestId === undefined || newestId === seenNewest.current) return;
    seenNewest.current = newestId;
    setPendingNewest(spreadOf(spreads, newestId));
  }, [newestId, spreads]);

  const hold = (compact ? 3.5 : albumHoldSec(count)) * 1000;
  useEffect(() => {
    if (paused || turningTo !== null || count <= 1 || beamingSpread >= 0) return;
    const t = setTimeout(() => {
      const to = nextSpread(shown, count, pendingNewest);
      setPendingNewest(-1);
      if (to === shown) return;
      if (reduced) setSpread(to);
      else setTurningTo(to);
    }, hold);
    return () => clearTimeout(t);
  }, [paused, turningTo, count, shown, pendingNewest, hold, reduced, beamingSpread]);

  const finishTurn = useCallback(() => {
    setTurningTo((to) => {
      if (to !== null) setSpread(to);
      return null;
    });
  }, []);

  // The book: as big as the room allows, pages a little taller than wide.
  const pageAspect = 0.76;
  const margin = compact ? 0.06 : 0.07;
  const availW = box.w * (1 - margin * 2);
  const availH = box.h * (1 - margin * 2);
  const bookAspect = pageAspect * perSpread;
  const bookW = Math.max(0, Math.min(availW, availH * bookAspect));
  const bookH = bookW / bookAspect;
  const pageW = bookW / perSpread;
  const pageH = bookH;

  const pageProps = { byId, pageW, pageH, colors, freshIds, beamingIds, onTileRect, onSelect, captions, compact };
  const pageNo = (s: number, i: number) => s * perSpread + i + 1;
  const cur = spreads[shown] ?? [];
  const to = turningTo !== null ? spreads[turningTo] ?? [] : null;
  // The spread the next turn will most likely open, drawn invisibly so its
  // photos are already decoded when the page turns (same sizes = same URLs).
  const upcoming = turningTo === null && count > 1 ? spreads[nextSpread(shown, count, pendingNewest)] : undefined;

  return (
    <div ref={host} className="wall-album absolute inset-0 flex items-center justify-center" style={{ perspective: Math.max(1600, bookW * 2.2) }}>
      {bookW > 0 && (
        <div className="relative" style={{ width: bookW, height: bookH, transformStyle: 'preserve-3d' }}>
          {/* The album's cover edge and shadow under the pages. */}
          <div
            aria-hidden
            className="absolute"
            style={{
              inset: -Math.max(6, bookW * 0.012),
              borderRadius: 10,
              background: colors.edge,
              boxShadow: '0 30px 60px -20px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.05)',
            }}
          />
          {upcoming !== undefined && (
            <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ visibility: 'hidden' }}>
              {upcoming.map((ids, i) => (
                <div key={i} className="absolute top-0" style={{ left: i * pageW, width: pageW, height: pageH }}>
                  <Page {...pageProps} ids={ids} side={perSpread === 2 ? (i === 0 ? 'left' : 'right') : 'single'} number={0} beamingIds={undefined} onTileRect={undefined} onSelect={undefined} />
                </div>
              ))}
            </div>
          )}
          {perSpread === 2 ? (
            <>
              <div className="absolute left-0 top-0" style={{ width: pageW, height: pageH }}>
                <Page {...pageProps} ids={cur[0]} side="left" number={pageNo(shown, 0)} />
              </div>
              <div className="absolute top-0" style={{ left: pageW, width: pageW, height: pageH }}>
                <Page {...pageProps} ids={to ? to[1] : cur[1]} side="right" number={pageNo(to ? turningTo ?? 0 : shown, 1)} />
              </div>
              {to !== null && (
                <motion.div
                  key={`leaf-${shown}-${turningTo}`}
                  className="absolute top-0"
                  style={{ left: pageW, width: pageW, height: pageH, transformOrigin: 'left center', transformStyle: 'preserve-3d', zIndex: 5 }}
                  initial={{ rotateY: 0 }}
                  animate={{ rotateY: -180 }}
                  transition={{ duration: TURN_SEC, ease: [0.45, 0, 0.25, 1] }}
                  onAnimationComplete={finishTurn}
                >
                  <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
                    <Page {...pageProps} ids={cur[1]} side="right" number={pageNo(shown, 1)} beamingIds={undefined} onTileRect={undefined} />
                    <LeafShade from="right" />
                  </div>
                  <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                    <Page {...pageProps} ids={to[0]} side="left" number={pageNo(turningTo ?? 0, 0)} beamingIds={undefined} onTileRect={undefined} />
                    <LeafShade from="left" />
                  </div>
                </motion.div>
              )}
              <div
                aria-hidden
                className="absolute top-0 h-full pointer-events-none"
                style={{ left: pageW - 1, width: 2, background: 'rgba(0,0,0,0.45)', zIndex: 6 }}
              />
            </>
          ) : (
            <>
              <div className="absolute inset-0">
                <Page {...pageProps} ids={to ? to[0] : cur[0]} side="single" number={pageNo(to ? turningTo ?? 0 : shown, 0)} />
              </div>
              {to !== null && (
                <motion.div
                  key={`leaf-${shown}-${turningTo}`}
                  className="absolute inset-0"
                  style={{ transformOrigin: 'left center', transformStyle: 'preserve-3d', zIndex: 5 }}
                  initial={{ rotateY: 0, opacity: 1 }}
                  animate={{ rotateY: -140, opacity: 0 }}
                  transition={{ duration: TURN_SEC, ease: [0.45, 0, 0.25, 1], opacity: { duration: TURN_SEC, ease: [0.7, 0, 1, 1] } }}
                  onAnimationComplete={finishTurn}
                >
                  <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
                    <Page {...pageProps} ids={cur[0]} side="single" number={pageNo(shown, 0)} beamingIds={undefined} onTileRect={undefined} />
                    <LeafShade from="right" />
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The page darkening as it lifts and turns. */
function LeafShade({ from }: { from: 'left' | 'right' }) {
  return (
    <motion.div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        background: `linear-gradient(to ${from === 'right' ? 'left' : 'right'}, rgba(0,0,0,0.42), rgba(0,0,0,0) 70%)`,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: TURN_SEC, times: [0, 0.5, 1] }}
    />
  );
}
