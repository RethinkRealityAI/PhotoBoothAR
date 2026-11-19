/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The welcome page's living photo wall: a tilted grid of glass tiles behind
 * the page, so the page reads as the event's wall rather than a landing page.
 *
 *  - Empty: glass tiles lift and settle in a staggered wave while soft beams
 *    of light drop onto a few of them, as if photos were about to land.
 *  - With photos: the newest guest photos beam in one at a time (a streak of
 *    light, then the tile turns over), the rest of the tiles stay glass. A
 *    realtime arrival mounts as a new tile and beams in the same way.
 *
 * Budget for venue phones: CSS transform/opacity only (platform.css
 * `[data-wall-field]`), a viewport-sized tile count (lib/scenePage
 * wallFieldSize), at most 8 looping tiles, everything paused while the tab
 * is hidden, and a still glass grid with plain fades under
 * prefers-reduced-motion. No WebGL.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Post } from '../../types';
import PostImage from '../ui/PostImage';
import { wallFieldSize, wallFieldSlots } from '../../lib/scenePage';

/** Looping "beam lands here" tiles in the empty state / spare tiles. */
const MAX_BEAT_TILES = 8;
/** Gap between consecutive photo reveals on first paint. */
const REVEAL_STEP_S = 0.42;

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

export default function LiveWallField({
  photos,
  fresh,
}: {
  /** Oldest first (scenePage.wallFieldPhotos), so photo k keeps its tile. */
  photos: readonly Post[];
  /** Ids that arrived live while the page was open: they beam in at once. */
  fresh: ReadonlySet<string>;
}) {
  const { w, h } = useViewport();
  const hidden = usePageHidden();
  const { cols, rows, tiles } = wallFieldSize(w, h);
  // Visible tiles first, so photos and beams land where a guest can see them.
  const order = useMemo(() => wallFieldSlots(cols, rows, w, h), [cols, rows, w, h]);

  // tile index → what lives there
  const cells = useMemo(() => {
    const byTile = new Map<number, { photo?: Post; k: number; beat?: number }>();
    const shown = photos.slice(-Math.min(photos.length, Math.max(0, tiles - 4)));
    shown.forEach((p, k) => byTile.set(order[k], { photo: p, k }));
    const spare = order.slice(shown.length, shown.length + MAX_BEAT_TILES);
    spare.forEach((t, i) => byTile.set(t, { k: -1, beat: i }));
    return byTile;
  }, [photos, order, tiles]);

  return (
    <div
      aria-hidden
      data-wall-field=""
      data-paused={hidden ? '' : undefined}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className="wf-plane"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        <span className="wf-sweep" />
        {Array.from({ length: tiles }, (_, t) => {
          const cell = cells.get(t);
          if (cell?.photo) {
            const p = cell.photo;
            const delay = fresh.has(p.id) ? 0 : 0.3 + cell.k * REVEAL_STEP_S;
            return (
              <div key={`p-${p.id}`} className="wf-tile wf-photo" style={{ ['--d' as string]: `${delay}s` }}>
                <span className="wf-streak" />
                <div className="wf-face">
                  <PostImage src={p.image_url} alt="" displayWidth={180} eager className="h-full w-full object-cover" />
                </div>
                <span className="wf-rim"><span /></span>
              </div>
            );
          }
          if (cell?.beat !== undefined) {
            return (
              <div key={`b-${t}`} className="wf-tile wf-beat" style={{ ['--d' as string]: `${cell.beat * 0.85}s` }}>
                <span className="wf-streak" />
                <span className="wf-rim"><span /></span>
              </div>
            );
          }
          return <div key={`g-${t}`} className="wf-tile" />;
        })}
      </div>
      {/* Legibility: the page's words sit on a calm pool, the wall shows round it. */}
      <div className="wf-scrim absolute inset-0" />
    </div>
  );
}
