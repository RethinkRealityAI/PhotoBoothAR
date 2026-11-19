/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The welcome page's living photo wall: dense columns of tall 9:16 tiles on
 * a tilted plane behind the page, drifting slowly (alternate columns in
 * opposite directions), so the page reads as the event's wall rather than a
 * landing page.
 *
 *  - With photos: every tile shows one. A few photos are cycled to fill the
 *    whole wall (lib/scenePage wallFieldFill: never the same photo twice in a
 *    row), so there are no empty cards. A realtime arrival beams in: a streak
 *    of light, then its tiles turn over.
 *  - Empty: the tiles stay glass and breathe, while a few lift as a beam of
 *    light drops onto them, as if photos were about to land.
 *
 * Budget for venue phones: CSS transform/opacity only (platform.css
 * `[data-wall-field]`), a viewport-sized column count (wallFieldColumns),
 * one drifting track per column, everything paused while the tab is hidden,
 * and a still wall with plain fades under prefers-reduced-motion. No WebGL.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Post } from '../../types';
import PostImage from '../ui/PostImage';
import { tileOrder, wallFieldColumns, wallFieldFill } from '../../lib/scenePage';

/** Looping "beam lands here" tiles in the empty state. */
const MAX_BEAT_TILES = 8;
/** Drift speed of a column, in px per second at the viewport's scale. */
const DRIFT_PX_S = 16;

function useViewport(): { w: number; h: number } {
  const read = () => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 390,
    h: typeof window !== 'undefined' ? window.innerHeight : 844,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSize(read()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return size;
}

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

/** A phone, for the host's miniature preview. */
const PHONE = { w: 390, h: 844 };

export default function LiveWallField({
  photos,
  fresh,
  still = false,
}: {
  /** The photos to show (scenePage.wallFieldPhotos), oldest first. */
  photos: readonly Post[];
  /** Ids that arrived live while the page was open: they beam in at once. */
  fresh: ReadonlySet<string>;
  /** The host picker's miniature: a phone-sized wall drawn at rest (no
   *  drift, no loops), with a few empty tiles held mid-lift. */
  still?: boolean;
}) {
  const viewport = useViewport();
  const { w, h } = still ? PHONE : viewport;
  const hidden = usePageHidden();
  const { cols, perCol } = wallFieldColumns(w, h);
  const fill = useMemo(() => wallFieldFill(photos.length, cols, perCol), [photos.length, cols, perCol]);
  const beats = useMemo(
    () => new Map(tileOrder(cols * perCol, 11).slice(0, MAX_BEAT_TILES).map((t, i) => [t, i])),
    [cols, perCol],
  );

  // Tiles that change photo after the first reveal swap with a short fade,
  // not the whole beam-in again (only a live arrival beams).
  const [settled, setSettled] = useState(still);
  useEffect(() => {
    if (still) return;
    const t = setTimeout(() => setSettled(true), 4000);
    return () => clearTimeout(t);
  }, [still]);

  // A column's track holds its tiles twice; moving it by half loops seamlessly.
  const colW = (1.38 * w) / cols;
  const trackPx = perCol * (colW * (16 / 9) + 8);
  const dur = Math.max(30, trackPx / DRIFT_PX_S);

  const tile = (c: number, r: number, copy: number) => {
    const idx = fill[c]?.[r] ?? -1;
    const key = `${copy}-${r}`;
    if (idx >= 0) {
      const p = photos[idx];
      const isFresh = fresh.has(p.id);
      const delay = isFresh ? 0 : c * 0.11 + r * 0.07;
      return (
        <div
          key={`${key}-${p.id}`}
          className={`wf-tile wf-photo${isFresh ? ' wf-fresh' : ''}`}
          style={{ ['--d' as string]: `${delay}s` }}
        >
          {isFresh && <span className="wf-streak" />}
          <div className="wf-face">
            <PostImage src={p.image_url} alt="" displayWidth={still ? 64 : 160} eager className="h-full w-full object-cover" />
          </div>
          {isFresh && <span className="wf-rim"><span /></span>}
        </div>
      );
    }
    const beat = beats.get(c * perCol + r);
    if (beat !== undefined) {
      return (
        <div key={key} className="wf-tile wf-beat" style={{ ['--d' as string]: `${beat * 0.85}s` }}>
          <span className="wf-streak" />
          <span className="wf-rim"><span /></span>
        </div>
      );
    }
    return <div key={key} className="wf-tile wf-glass" style={{ ['--d' as string]: `${((c * 5 + r * 3) % 9) * 0.6}s` }} />;
  };

  return (
    <div
      aria-hidden
      data-wall-field=""
      data-paused={hidden ? '' : undefined}
      data-still={still ? '' : undefined}
      data-settled={settled ? '' : undefined}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="wf-plane">
        <span className="wf-sweep" />
        {Array.from({ length: cols }, (_, c) => (
          <div
            key={c}
            className="wf-col"
            data-dir={c % 2 === 1 ? 'down' : undefined}
            style={{
              ['--dur' as string]: `${dur.toFixed(1)}s`,
              ['--off' as string]: `${(-((c * 0.37) % 1) * dur).toFixed(1)}s`,
              ['--k' as string]: String(c % 3),
            }}
          >
            <div className="wf-track">
              {Array.from({ length: perCol }, (_, r) => tile(c, r, 0))}
              {!still && Array.from({ length: perCol }, (_, r) => tile(c, r, 1))}
            </div>
          </div>
        ))}
      </div>
      {/* Legibility: the page's words sit on a calm pool, the wall shows round it. */}
      <div className="wf-scrim absolute inset-0" />
    </div>
  );
}
