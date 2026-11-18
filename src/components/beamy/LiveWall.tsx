/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The brand-v2 live wall (moved out of BeamyPage unchanged so /brand can show
 * it as a specimen).
 */
import { useEffect, useMemo, useReducer, useRef, type MutableRefObject } from 'react';
import { WALL_CENTRE, initialWall, nextSwap, rippleRings, swapDelay, type WallState } from '../../lib/beamyWall';
import { WALL_LABEL, seededRandom } from '../../lib/brandLanding';
import { HERO_SLOT_IMAGES } from '../../lib/landingAssets';
import { salesImage } from '../../pages/sales/salesImages';

const WALL_SEED = ['event-wedding', 'event-birthday', 'event-gala', 'event-activation', 'event-conference', 'hero-wall', 'event-tradeshow'];
/** The wall's photos: the landing's hero-carousel illustrations + the event cards (13, so 4 spares). */
export const WALL_POOL = [...HERO_SLOT_IMAGES, ...WALL_SEED.map((k) => salesImage(k)?.src ?? '')].filter((s) => s !== '');

/** A photo pinned to a tile (Beamy's selfie, a visitor's shots): frozen out of the rotation. */
export interface Pin { src: string; key: string; mine: boolean; }

/**
 * The live wall: a 3×3 grid in a slim deep-indigo frame whose tiles swap
 * photos on the pure scheduler in lib/beamyWall (one tile every 1.5–2.5s,
 * never the same tile twice in a row, never a duplicate on the wall). Pinned
 * tiles (Beamy's selfie, a visitor's shots) are frozen out of the rotation.
 */
export default function LiveWall({ pool, pins, dim, compact, centreRef, ripple, seed }: {
  pool: string[];
  pins: Record<number, Pin>;
  dim: boolean;
  compact: boolean;
  centreRef?: MutableRefObject<HTMLDivElement | null>;
  ripple: number;
  seed: number;
}) {
  const rand = useRef<() => number>(seededRandom(seed));
  const wallRef = useRef<WallState>(initialWall(pool.length, rand.current));
  const prevRef = useRef<(number | null)[]>(wallRef.current.tiles.map(() => null));
  const freshRef = useRef<number | null>(null);
  const frozenRef = useRef(new Set<number>());
  frozenRef.current = new Set(Object.keys(pins).map(Number));
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const rings = useMemo(() => rippleRings(), []);

  useEffect(() => {
    let id = 0;
    const schedule = () => {
      id = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          const s = wallRef.current;
          const r = nextSwap(s, pool.length, rand.current, frozenRef.current);
          if (r !== null) {
            prevRef.current[r.tile] = s.tiles[r.tile];
            freshRef.current = r.tile;
            wallRef.current = r.state;
            bump();
          }
        }
        schedule();
      }, swapDelay(rand.current));
    };
    schedule();
    return () => window.clearTimeout(id);
  }, [pool.length]);

  const tiles = wallRef.current.tiles;
  return (
    <div className="bw-wall" data-dim={dim} role="group" aria-label={WALL_LABEL} style={compact ? { padding: 6, borderRadius: 14 } : undefined}>
      <p className={`bw-label flex items-center gap-2 px-1 ${compact ? 'mb-1.5 text-[12px]' : 'mb-2'}`} style={{ color: 'var(--bw-ink)' }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--bw-danger)' }} aria-hidden /> {WALL_LABEL}
      </p>
      <div className={`grid grid-cols-3 ${compact ? 'gap-[4px]' : 'gap-[7px]'}`}>
        {tiles.map((img, n) => {
          const pin = pins[n];
          const prev = prevRef.current[n];
          return (
            <div
              key={n}
              ref={n === WALL_CENTRE && centreRef !== undefined ? (el) => { centreRef.current = el; } : undefined}
              className={`bw-tile ${compact ? 'aspect-square' : 'aspect-[4/5]'}`}
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
