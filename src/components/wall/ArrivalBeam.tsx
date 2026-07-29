/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ArrivalBeam — the wall's arrival ceremony, carrying the guest's ACTUAL photo.
 *
 * What this replaces: a generic gold beam, two rings and ten hard-coded divs
 * that were byte-identical for every guest, after which the photo silently
 * appeared in a grid tile somewhere. The photo that had just arrived was not
 * in the animation at all.
 *
 * What it does now: the photo is sampled into ~13.7k GPU points by the same
 * ParticleBeam the marketing showcase uses, dissolves in from below the bottom
 * edge, arcs up the screen and REASSEMBLES pixel-for-pixel into its real tile
 * in the mosaic. A burst of arrivals is composited into one picture and lands
 * centre-stage as a single "N moments just landed".
 *
 * The three hard problems, and the answers:
 *
 * 1. THE DESTINATION RECT. The grid reports the fresh tile's DOMRect upward
 *    (MosaicGrid → Wall → here) and the tile is held INVISIBLE until the photo
 *    lands in it. Measuring the real element beats predicting it: the mosaic is
 *    a CSS `columns` masonry, so which column a prepended card lands in is the
 *    browser's decision, not something this component can compute. Tiles are
 *    hidden by default from the instant the ceremony starts and revealed the
 *    moment the flight ends (or immediately, if we bail) — a tile that appears
 *    300 ms late is invisible, a tile that appears and then vanishes is a bug.
 *
 * 2. CORS / TAINTED CANVAS. ParticleBeam samples pixels through a 2D canvas,
 *    and a cross-origin image drawn without CORS taints it. Rather than hand it
 *    a remote URL and hope, this component loads the media itself with
 *    `crossOrigin='anonymous'`, draws it, and calls `toDataURL` — which THROWS
 *    on a tainted canvas. So readability is proven here, before a single WebGL
 *    resource is allocated, and ParticleBeam receives a plain data URL exactly
 *    like the landing page does. If the pixels are not readable we never enter
 *    the particle path at all.
 *
 * 3. COST. One Canvas per ceremony, and the arrival queue guarantees only one
 *    ceremony exists at a time, so two beams can never be mounted at once. The
 *    Canvas is unmounted the frame the flight ends (phase leaves 'flying'),
 *    not held for the label, and ParticleBeam disposes its geometry/material on
 *    unmount. A hard watchdog fires `onDone` even if every other path stalls,
 *    so the queue can never wedge on a six-hour wall.
 *
 * FALLBACK. No WebGL, unreadable pixels, a media element that will not decode,
 * a degenerate rect, or `prefers-reduced-motion` ⇒ the classic <BeamIn/> plays.
 * The wall is never left with no arrival ceremony at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import ParticleBeam from '../landing/ParticleBeam';
import BeamIn from './BeamIn';
import { transformedUrl } from '../../lib/mediaUrl';
import {
  beamOriginRect,
  burstCells,
  burstLandingRect,
  ceremonyLabel,
  type BeamRect,
  type Ceremony,
  type WallArrival,
} from '../../lib/wallArrivals';
import { canUseWebgl, usePrefersReducedMotion } from './wallHooks';

/* ── Tunables ──────────────────────────────────────────────────────── */

/** Longest we wait for one photo to decode before giving up on the ceremony. */
const MEDIA_TIMEOUT_MS = 2500;
/** Composite canvas long edge. Big enough to sample 88×156 points from. */
const COMPOSITE_MAX_PX = 720;
/** How long the caption lingers after the photo has landed. */
const LABEL_MS = 1000;

type Phase = 'preparing' | 'flying' | 'landed' | 'fallback';

export interface ArrivalBeamProps {
  ceremony: Ceremony;
  /** Viewport-space landing rect per arrival id, reported by the grid.
   *  Missing ids land centre-stage (marquee tiles move; slideshow has no tile). */
  tileRects: Map<string, BeamRect>;
  /** Called with the ids this ceremony will actually carry. The wall hides
   *  exactly these tiles; an empty set means "reveal everything now". */
  onCarry: (ids: Set<string>) => void;
  onDone: () => void;
}

/* ── Media loading ─────────────────────────────────────────────────── */

/** Decode one post's media to something drawable, or null. */
function loadDrawable(
  arrival: WallArrival,
  signal: { cancelled: boolean },
): Promise<CanvasImageSource | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: CanvasImageSource | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(signal.cancelled ? null : v);
    };
    const timer = setTimeout(() => finish(null), MEDIA_TIMEOUT_MS);

    if (arrival.mediaType === 'video') {
      // A video post has no poster; seek a hair past zero and grab that frame.
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.onerror = () => finish(null);
      video.onseeked = () => finish(video);
      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(0.1, (video.duration || 1) / 4);
        } catch {
          finish(video); // seeking unsupported — frame 0 is already decoded
        }
      };
      video.src = arrival.imageUrl;
      video.load();
      return;
    }

    const img = new Image();
    img.decoding = 'async';
    // Must precede `src`: the attribute only affects the fetch it starts.
    // Without it the composite canvas is tainted and toDataURL throws below.
    img.crossOrigin = 'anonymous';
    img.onerror = () => finish(null);
    img.onload = () => finish(img);
    // Ask Storage for a wall-sized render when it can do one; the ceremony
    // samples an 88×156 grid, so the full 1080×1920 capture is pure waste.
    img.src = transformedUrl(arrival.imageUrl, { width: COMPOSITE_MAX_PX, quality: 82 })
      ?? arrival.imageUrl;
  });
}

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: 0, h: 0 };
}

/** Cover-crop `src` into `cell` on `ctx`. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  cell: BeamRect,
): boolean {
  const { w, h } = sourceSize(src);
  if (w <= 0 || h <= 0) return false;
  const target = cell.width / cell.height;
  const aspect = w / h;
  let sx = 0; let sy = 0; let sw = w; let sh = h;
  if (aspect > target) {
    sw = h * target;
    sx = (w - sw) / 2;
  } else {
    sh = w / target;
    sy = (h - sh) / 2;
  }
  ctx.drawImage(src, sx, sy, sw, sh, cell.left, cell.top, cell.width, cell.height);
  return true;
}

/**
 * Compose the ceremony's photos into ONE readable data URL.
 * Returns null on any failure — including the tainted-canvas throw, which is
 * precisely the CORS proof this ceremony depends on.
 */
async function composeCeremonyImage(
  arrivals: WallArrival[],
  aspect: number,
  signal: { cancelled: boolean },
): Promise<string | null> {
  const sources = await Promise.all(arrivals.map((a) => loadDrawable(a, signal)));
  if (signal.cancelled) return null;
  const usable = sources.filter((s): s is CanvasImageSource => s !== null);
  if (usable.length === 0) return null;

  const width = aspect >= 1 ? COMPOSITE_MAX_PX : Math.round(COMPOSITE_MAX_PX * aspect);
  const height = aspect >= 1 ? Math.round(COMPOSITE_MAX_PX / aspect) : COMPOSITE_MAX_PX;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, width);
  canvas.height = Math.max(2, height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  // JPEG has no alpha, so anything not covered by a cell would export as pure
  // black. Matte it in the wall's own ink instead.
  ctx.fillStyle = '#0a0703';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cells = usable.length === 1
    ? [{ left: 0, top: 0, width: canvas.width, height: canvas.height }]
    : burstCells(usable.length, canvas.width, canvas.height, Math.round(canvas.width * 0.006));

  let drew = 0;
  for (let i = 0; i < usable.length && i < cells.length; i += 1) {
    if (drawCover(ctx, usable[i], cells[i])) drew += 1;
  }
  if (drew === 0) return null;

  try {
    return canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    // Tainted canvas — the media host did not answer with CORS headers, so the
    // pixels can never be sampled. Caller degrades to the classic BeamIn.
    return null;
  }
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function ArrivalBeam({ ceremony, tileRects, onCarry, onDone }: ArrivalBeamProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>('preparing');
  const [shot, setShot] = useState<string | null>(null);
  const [rects, setRects] = useState<{ from: BeamRect; to: BeamRect; vw: number; vh: number } | null>(null);

  // onDone fires exactly once, from whichever path gets there first.
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const fireDone = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  const onCarryRef = useRef(onCarry);
  onCarryRef.current = onCarry;
  const releaseTiles = useCallback(() => onCarryRef.current(new Set()), []);

  // Watchdog: whatever happens — a decode that never resolves, a GPU that
  // never produces a frame — the queue drains. A wedged queue on a six-hour
  // wall means no arrival is ever celebrated again.
  useEffect(() => {
    const t = setTimeout(() => {
      releaseTiles();
      fireDone();
    }, ceremony.durationMs + 4000);
    return () => clearTimeout(t);
  }, [ceremony.durationMs, fireDone, releaseTiles]);

  // ---- Prepare: measure, then prove the pixels are readable -------------
  useEffect(() => {
    const signal = { cancelled: false };

    const bail = () => {
      if (signal.cancelled) return;
      releaseTiles(); // nothing will fly into these tiles — show them now
      setPhase('fallback');
    };

    if (reducedMotion || !canUseWebgl()) {
      bail();
      return () => { signal.cancelled = true; };
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const solo = ceremony.arrivals.length === 1;
    const tile = solo ? tileRects.get(ceremony.arrivals[0].id) ?? null : null;
    const to = tile !== null && tile.width > 4 && tile.height > 4
      ? tile
      : burstLandingRect(ceremony.arrivals.length, vw, vh);

    if (to.width <= 0 || to.height <= 0 || !Number.isFinite(to.left) || !Number.isFinite(to.top)) {
      bail();
      return () => { signal.cancelled = true; };
    }

    // A solo flight reassembles into the real tile, so only then do we hide it.
    onCarryRef.current(tile !== null && solo ? new Set([ceremony.arrivals[0].id]) : new Set());

    void composeCeremonyImage(ceremony.arrivals, to.width / to.height, signal).then((url) => {
      if (signal.cancelled) return;
      if (url === null) {
        bail();
        return;
      }
      setShot(url);
      setRects({ from: beamOriginRect(to, vw, vh), to, vw, vh });
      setPhase('flying');
    });

    return () => { signal.cancelled = true; };
    // ceremony.key changes per ceremony; tileRects is read once, on purpose —
    // re-measuring mid-flight would move the destination under the particles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceremony.key, reducedMotion, releaseTiles]);

  // ---- Land ------------------------------------------------------------
  const handleFlightDone = useCallback(() => {
    releaseTiles(); // the real tile takes over exactly where the particles settled
    setPhase('landed');
  }, [releaseTiles]);

  useEffect(() => {
    if (phase !== 'landed') return;
    const t = setTimeout(fireDone, LABEL_MS);
    return () => clearTimeout(t);
  }, [phase, fireDone]);

  // ---- Fallback: the classic beam, so an arrival is never uncelebrated --
  if (phase === 'fallback') {
    return (
      <BeamIn
        guestName={ceremony.kind === 'solo' ? ceremony.arrivals[0]?.guestName : null}
        onDone={fireDone}
      />
    );
  }

  const label = ceremonyLabel(ceremony);
  const showComposite = phase === 'landed' && ceremony.kind === 'burst' && shot !== null && rects !== null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden" aria-hidden>
      {/* Beam corridor — a soft rise of light along the flight, so the photo
          reads as travelling rather than crossfading. */}
      <motion.div
        className="absolute inset-x-0 bottom-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.55, 0.28, 0] }}
        transition={{ duration: ceremony.durationMs / 1000, times: [0, 0.22, 0.6, 1], ease: 'easeOut' }}
        style={{
          height: '72vh',
          background:
            'radial-gradient(ellipse 42% 100% at 50% 100%, rgba(251,243,217,0.30) 0%, rgba(var(--accent-rgb),0.18) 34%, rgba(var(--accent-rgb),0) 78%)',
          filter: 'blur(6px)',
        }}
      />

      {/* The photo in flight. Mounted ONLY during 'flying' so the WebGL
          context is released the frame the flight ends. */}
      {phase === 'flying' && shot !== null && rects !== null && (
        <ParticleBeam
          from={rects.from}
          to={rects.to}
          shot={shot}
          durationMs={Math.max(900, ceremony.durationMs - LABEL_MS)}
          onDone={handleFlightDone}
        />
      )}

      {/* A burst has no tile to hand off to, so the composite it just
          assembled stays on screen under the caption. */}
      {showComposite && (
        <motion.img
          src={shot}
          alt=""
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute rounded-2xl object-cover"
          style={{
            left: rects.to.left,
            top: rects.to.top,
            width: rects.to.width,
            height: rects.to.height,
            boxShadow: '0 0 0 2px rgba(var(--accent-rgb),0.5), 0 0 60px 18px rgba(var(--accent-rgb),0.28)',
          }}
        />
      )}

      {/* Landing flare over the destination — the visual handover from
          particles to the real tile. */}
      {phase === 'landed' && rects !== null && !showComposite && (
        <motion.div
          className="absolute rounded-2xl"
          initial={{ opacity: 0.85, scale: 1 }}
          animate={{ opacity: 0, scale: 1.06 }}
          transition={{ duration: LABEL_MS / 1000, ease: 'easeOut' }}
          style={{
            left: rects.to.left,
            top: rects.to.top,
            width: rects.to.width,
            height: rects.to.height,
            boxShadow: '0 0 0 2px rgba(251,243,217,0.75), 0 0 70px 22px rgba(var(--accent-rgb),0.45)',
          }}
        />
      )}

      {/* Caption — appears with the landing, not before it, and is anchored to
          the photo it is naming. A fixed bottom offset collided with the
          footer QR block, which on a projected wall is where guests are
          looking to join. */}
      {phase === 'landed' && rects !== null && (
        <motion.div
          className="absolute -translate-x-1/2 -translate-y-1/2 glass-strong rounded-2xl text-center"
          initial={{ y: 18, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          style={{
            // Centred ON the photo that just landed. Anything anchored to a
            // screen edge eventually lands on the footer QR block or the
            // header — and on a projected wall the join QR is the one thing
            // that must never be covered. Clamped so an edge tile's pill
            // cannot leave the viewport.
            left: Math.min(Math.max(rects.to.left + rects.to.width / 2, rects.vw * 0.22), rects.vw * 0.78),
            top: Math.min(Math.max(rects.to.top + rects.to.height * 0.5, 70), rects.vh - 70),
            maxWidth: '86vw',
            border: '1px solid rgba(var(--accent-rgb),0.40)',
            boxShadow: '0 0 32px rgba(var(--accent-rgb),0.30), 0 8px 24px rgba(0,0,0,0.5)',
            whiteSpace: 'nowrap',
            padding: 'calc(14px * var(--wall-scale, 1)) calc(28px * var(--wall-scale, 1))',
          }}
        >
          <span style={{ fontSize: 'calc(20px * var(--wall-scale, 1))' }}>✦</span>
          <span
            className="ml-2.5 font-serif italic text-ivory"
            style={{ fontSize: 'calc(18px * var(--wall-scale, 1))' }}
          >
            {ceremony.kind === 'solo' && ceremony.arrivals[0]?.guestName ? (
              <>
                <span className="text-foil-static">{ceremony.arrivals[0].guestName}</span>
                <span className="text-ivory/80"> just shared a moment</span>
              </>
            ) : (
              <span className="text-ivory/90">{label}</span>
            )}
          </span>
        </motion.div>
      )}
    </div>
  );
}
