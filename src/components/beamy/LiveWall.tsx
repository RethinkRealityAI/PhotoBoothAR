/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The brand-v2 live wall (moved out of BeamyPage unchanged so /brand can show
 * it as a specimen).
 */
import { useEffect, useMemo, useReducer, useRef, type MutableRefObject } from 'react';
import { WALL_CENTRE, WALL_COLS, initialWall, nextSwap, rippleRings, swapDelay, type WallState } from '../../lib/beamyWall';
import { WALL_LABEL, seededRandom } from '../../lib/brandLanding';
import { HERO_SLOT_IMAGES } from '../../lib/landingAssets';
import { salesImage } from '../../pages/sales/salesImages';

const WALL_SEED = ['event-wedding', 'event-birthday', 'event-gala', 'event-activation', 'event-conference', 'hero-wall', 'event-tradeshow'];
/** The wall's photos: the landing's hero-carousel illustrations + the event cards (13, so 4 spares). */
export const WALL_POOL = [...HERO_SLOT_IMAGES, ...WALL_SEED.map((k) => salesImage(k)?.src ?? '')].filter((s) => s !== '');

/** A photo pinned to a tile (Beamy's selfie, a visitor's shots): frozen out of the rotation. */
export interface Pin { src: string; key: string; mine: boolean; }

/**
 * The live wall: a 3-column grid (3 rows unless `rows` says 4) in a slim
 * deep-indigo frame whose tiles swap photos on the pure scheduler in
 * lib/beamyWall (one tile every 1.5–2.5s, never the same tile twice in a
 * row, never a duplicate on the wall). Pinned tiles (Beamy's selfie, a
 * visitor's shots) are frozen out of the rotation.
 *
 * Optional, for the hero's phone accent: with `onUpcoming`, each swap is
 * announced `lead` ms before it happens (the tile element and the photo
 * that will land there), so a photo card can fly in and arrive as it swaps.
 * `fill` stretches the wall to its box's height (rows share it evenly).
 * A change of `rows` needs a fresh wall: key the component by it.
 */
export default function LiveWall({ pool, pins, dim, compact, centreRef, ripple, seed, rows = 3, fill = false, lead = 0, onUpcoming }: {
  pool: string[];
  pins: Record<number, Pin>;
  dim: boolean;
  compact: boolean;
  centreRef?: MutableRefObject<HTMLDivElement | null>;
  ripple: number;
  seed: number;
  rows?: 3 | 4;
  fill?: boolean;
  lead?: number;
  onUpcoming?: (tile: HTMLDivElement, src: string) => void;
}) {
  const rand = useRef<() => number>(seededRandom(seed));
  const wallRef = useRef<WallState>(initialWall(pool.length, rand.current, WALL_COLS * rows));
  const prevRef = useRef<(number | null)[]>(wallRef.current.tiles.map(() => null));
  const freshRef = useRef<number | null>(null);
  const frozenRef = useRef(new Set<number>());
  frozenRef.current = new Set(Object.keys(pins).map(Number));
  const tileEls = useRef<(HTMLDivElement | null)[]>([]);
  const upcomingRef = useRef(onUpcoming);
  upcomingRef.current = onUpcoming;
  const leadRef = useRef(lead);
  leadRef.current = lead;
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const rings = useMemo(() => rippleRings(WALL_CENTRE, WALL_COLS, rows), [rows]);

  useEffect(() => {
    let id = 0;
    let applyId = 0;
    const schedule = () => {
      id = window.setTimeout(() => {
        if (document.visibilityState !== 'visible') { schedule(); return; }
        const s = wallRef.current;
        const r = nextSwap(s, pool.length, rand.current, frozenRef.current);
        if (r === null) { schedule(); return; }
        const apply = () => {
          // A pin may have landed on this tile while the card was in the air.
          if (!frozenRef.current.has(r.tile) && wallRef.current === s) {
            prevRef.current[r.tile] = s.tiles[r.tile];
            freshRef.current = r.tile;
            wallRef.current = r.state;
            bump();
          }
          schedule();
        };
        const el = tileEls.current[r.tile];
        const ann = upcomingRef.current;
        const ms = leadRef.current;
        if (ann !== undefined && ms > 0 && el !== null && el !== undefined) {
          ann(el, pool[r.image]);
          applyId = window.setTimeout(apply, ms);
        } else apply();
      }, swapDelay(rand.current));
    };
    schedule();
    return () => { window.clearTimeout(id); window.clearTimeout(applyId); };
  }, [pool]);

  const tiles = wallRef.current.tiles;
  const aspect = compact || fill ? '' : 'aspect-[4/5]';
  return (
    <div
      className={`bw-wall ${fill ? 'flex h-full flex-col' : ''}`}
      data-dim={dim}
      role="group"
      aria-label={WALL_LABEL}
      style={compact ? { padding: 6, borderRadius: 14 } : undefined}
    >
      <p className={`bw-label flex shrink-0 items-center gap-2 px-1 ${compact ? 'mb-1.5 text-[12px]' : 'mb-2'}`} style={{ color: 'var(--bw-ink)' }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--bw-danger)' }} aria-hidden /> {WALL_LABEL}
      </p>
      <div
        className={`grid grid-cols-3 ${compact ? 'gap-[4px]' : 'gap-[7px]'} ${fill ? 'min-h-0 flex-1' : ''}`}
        style={fill ? { gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` } : undefined}
      >
        {tiles.map((img, n) => {
          const pin = pins[n];
          const prev = prevRef.current[n];
          return (
            <div
              key={n}
              ref={(el) => {
                tileEls.current[n] = el;
                if (n === WALL_CENTRE && centreRef !== undefined) centreRef.current = el;
              }}
              data-tile={n}
              className={`bw-tile ${compact && !fill ? 'aspect-square' : aspect}`}
              style={pin?.mine === true ? { boxShadow: '0 0 0 1.5px var(--bw-core)' } : undefined}
            >
              {prev !== null && <img src={pool[prev]} alt="" draggable={false} />}
              <img key={pool[img]} src={pool[img]} alt="" draggable={false} className={freshRef.current === n ? 'bw-tile-in' : undefined} />
              {pin !== undefined && (
                <img key={pin.key} src={pin.src} alt={pin.mine ? 'Your photo on the wall' : 'Beamy’s selfie on the wall'} draggable={false} className="bw-tile-in" style={{ opacity: 1 }} />
              )}
              {ripple > 0 && rings[n] > 0 && <span key={`r${ripple}`} className="bw-tile-flash" style={{ ['--ripple' as string]: rings[n] }} aria-hidden />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
