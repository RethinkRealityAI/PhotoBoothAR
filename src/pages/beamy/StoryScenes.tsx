/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StoryScenes — what unfolds around Beamy at each "How it works" step: real
 * DOM pieces (crisp text, real photos, real library thumbnails) standing in
 * the space around him, tilted a little in 3D and floating. Each scene beams
 * in when its step comes up (a bright, soft materialise) and fades fully out
 * before the next one arrives. Decorative: the caption panel carries every
 * step's words, so the whole layer is aria-hidden.
 *
 * Two arrangements: `stacked` (phones and portrait tablets: everything rises
 * above his head, he stands big below) and wide (pieces on both sides of
 * him, clear of the caption at the top left). The page marks each step's
 * main piece with `data-fx-anchor` and aims his projector cone at it.
 */
import { useMemo, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { Camera, Play, Trophy } from 'lucide-react';
import LiveWall, { WALL_POOL } from '../../components/beamy/LiveWall';
import type { StoryFxId } from '../../lib/brandLanding';
import { STORY_LOOKS, STORY_SCENE, lookThumb, qrModules } from '../../lib/beamyStory';

function QrArt({ className }: { className?: string }) {
  const g = useMemo(() => qrModules(21, 11), []);
  return (
    <svg viewBox="-2 -2 25 25" className={className} aria-hidden shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={25} height={25} fill="#FFFFFF" />
      {g.map((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill="#1A1740" /> : null)))}
    </svg>
  );
}

/** One placed piece: absolute box (classes), an entrance delay, and an inner float. */
function Piece({ cls, d = 0, tilt = 0, children, anchor, style }: { cls: string; d?: number; tilt?: number; children: ReactNode; anchor?: StoryFxId; style?: CSSProperties }) {
  return (
    <div className={cls} data-fx-anchor={anchor} style={{ ...style, ['--d' as string]: `${d}s`, ['--tilt' as string]: `${tilt}deg` }}>
      <div className="bw-float h-full w-full" style={{ animationDelay: `${-d * 2.3}s` }}>{children}</div>
    </div>
  );
}

export default function StoryScenes({ step, ids, stacked, lookId, ripple, wallCentreRef, seed }: {
  step: number;
  ids: StoryFxId[];
  stacked: boolean;
  /** The look Beamy is wearing right now (the AR step lights its tile). */
  lookId: string | null;
  ripple: number;
  wallCentreRef: MutableRefObject<HTMLDivElement | null>;
  seed: number;
}) {
  const S = STORY_SCENE;
  const on = (id: StoryFxId) => (ids[step] === id ? 'true' : 'false');
  const photo = (k: number) => WALL_POOL[k % WALL_POOL.length];

  /* Each scene's pieces, placed for the arrangement. Percentages are of the scene box. */
  const qr = (
    <div className="bw-scene" data-on={on('qr')}>
      <Piece anchor="qr" tilt={-7} cls={stacked ? 'right-[7%] top-[1%] h-[47%] aspect-[9/18.5]' : 'right-[8%] top-[8%] h-[78%] aspect-[9/18.5]'}>
        <div className="bw-scene-phone h-full w-full">
          <div className="bw-scene-phone-screen">
            <span className="bw-scene-notch" />
            <p className="bw-scene-tiny mt-[14%] text-center">{S.qr.event}</p>
            <div className="relative mx-auto mt-[8%] w-[74%] overflow-hidden rounded-[10%] bg-white p-[6%]">
              <QrArt className="block h-auto w-full" />
              <span className="bw-scene-scan" />
            </div>
            <p className="mt-[9%] text-center text-[clamp(11px,1.3vw,15px)] font-semibold" style={{ color: 'var(--bw-ink)' }}>{S.qr.scan}</p>
            <p className="mt-[5%] flex justify-center"><span className="bw-scene-chip">{S.qr.hint}</span></p>
          </div>
        </div>
      </Piece>
      <Piece d={0.12} tilt={6} cls={stacked ? 'left-[6%] top-[12%] w-[34%] max-w-[200px]' : 'left-[9%] bottom-[9%] w-[16%] max-w-[230px]'}>
        <div className="bw-scene-card px-[12%] pb-[12%] pt-[10%] text-center">
          <div className="mx-auto w-[78%] overflow-hidden rounded-lg bg-white p-[6%]"><QrArt className="block h-auto w-full" /></div>
          <p className="bw-scene-label mt-3">{S.qr.tent}</p>
        </div>
      </Piece>
    </div>
  );

  // Six real library looks: the one he wears now is lit.
  const tiles = STORY_LOOKS.slice(0, 6);
  const spotsWide = ['left-[7%] top-[38%]', 'left-[19%] top-[56%]', 'left-[6%] top-[74%]', 'right-[9%] top-[8%]', 'right-[4%] top-[36%]', 'right-[10%] top-[64%]'];
  const prop = (
    <div className="bw-scene" data-on={on('prop')}>
      {stacked ? (
        <div className="absolute inset-x-[5%] top-[1%] mx-auto grid max-w-[420px] grid-cols-3 gap-[3%]" data-fx-anchor="prop" style={{ ['--d' as string]: '0s' }}>
          {tiles.map((l) => (
            <div key={l.id} className="bw-scene-tile" data-lit={lookId === l.id ? 'true' : 'false'}>
              <img src={lookThumb(l) ?? ''} alt="" className="aspect-square w-full rounded-xl object-cover" />
              <span className="bw-scene-tiny mt-1 block truncate text-center">{l.name}</span>
            </div>
          ))}
        </div>
      ) : (
        tiles.map((l, k) => (
          <Piece key={l.id} anchor={k === 0 ? 'prop' : undefined} d={k * 0.07} tilt={k < 3 ? 8 : -8} cls={`${spotsWide[k]} w-[clamp(96px,9vw,140px)]`}>
            <div className="bw-scene-tile" data-lit={lookId === l.id ? 'true' : 'false'}>
              <img src={lookThumb(l) ?? ''} alt="" className="aspect-square w-full rounded-xl object-cover" />
              <span className="bw-scene-tiny mt-1.5 block truncate text-center">{l.name}</span>
            </div>
          </Piece>
        ))
      )}
    </div>
  );

  const wall = (
    <div className="bw-scene" data-on={on('wall')}>
      <Piece anchor="wall" tilt={-6} cls={stacked ? 'inset-x-[6%] top-[0%] h-[47%]' : 'right-[3%] top-[5%] bottom-[7%] w-[25%]'}>
        <div className="bw-wall-mount h-full" style={{ ['--wall-yaw' as string]: '0deg' }}>
          <LiveWall key={stacked ? 3 : 4} pool={WALL_POOL} pins={{}} dim={false} compact={stacked} centreRef={wallCentreRef} ripple={ripple} seed={seed + 3} rows={stacked ? 3 : 4} fill />
        </div>
      </Piece>
      {!stacked && (
        <Piece d={0.14} tilt={7} cls="left-[9%] bottom-[9%] w-[14%] max-w-[210px] aspect-[9/16]">
          <div className="bw-scene-phone h-full w-full">
            <div className="bw-scene-phone-screen p-0">
              <img src={photo(seed + 2)} alt="" className="absolute inset-0 h-full w-full rounded-[inherit] object-cover" />
              <span className="bw-scene-chip absolute bottom-[6%] left-1/2 -translate-x-1/2"><Camera size={13} aria-hidden /> {S.wall.sent}</span>
            </div>
          </div>
        </Piece>
      )}
    </div>
  );

  const medal = (
    <div className="bw-scene" data-on={on('medal')}>
      <Piece anchor="medal" tilt={6} cls={stacked ? 'left-[5%] top-[1%] w-[68%] max-w-[360px]' : 'left-[37%] top-[11%] w-[26%] max-w-[380px]'}>
        <div className="bw-scene-card flex items-center gap-3 p-4">
          <span className="bw-scene-badge"><Camera size={20} aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="bw-scene-tiny block">{S.medal.eyebrow}</span>
            <span className="block text-[clamp(14px,1.25vw,17px)] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{S.medal.mission}</span>
          </span>
          <span className="bw-scene-points">{S.medal.points}</span>
        </div>
      </Piece>
      <Piece d={0.14} tilt={-6} cls={stacked ? 'right-[5%] top-[22%] w-[64%] max-w-[340px]' : 'right-[5%] top-[30%] w-[22%] max-w-[330px]'}>
        <div className="bw-scene-card p-4">
          <p className="bw-scene-label flex items-center gap-2"><Trophy size={15} aria-hidden /> {S.medal.board}</p>
          <ol className="mt-2.5 space-y-1.5">
            {S.medal.rows.map(([who, pts], k) => (
              <li key={who} className="bw-scene-row" data-first={k === 0 ? 'true' : 'false'}>
                <span className="bw-scene-rank">{k + 1}</span>
                <span className="min-w-0 flex-1 truncate">{who}</span>
                <span className="tabular-nums">{pts}</span>
              </li>
            ))}
          </ol>
        </div>
      </Piece>
    </div>
  );

  const keepsake = (
    <div className="bw-scene" data-on={on('keepsake')}>
      <Piece anchor="keepsake" tilt={-6} cls={stacked ? 'left-[4%] top-[1%] w-[57%] max-w-[330px]' : 'right-[3%] top-[11%] w-[25%] max-w-[380px]'}>
        <div className="bw-scene-card p-3">
          <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
            <span className="truncate text-[clamp(12px,1.1vw,15px)] font-semibold" style={{ color: 'var(--bw-ink)' }}>{S.keepsake.album}</span>
            <span className="bw-scene-tiny shrink-0">{S.keepsake.count}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2, 3, 4, 5].map((k) => <img key={k} src={photo(seed + 4 + k * 3)} alt="" className="aspect-[4/5] w-full rounded-md object-cover" />)}
          </div>
        </div>
      </Piece>
      <Piece d={0.14} tilt={7} cls={stacked ? 'right-[4%] top-[3%] w-[35%] max-w-[210px] aspect-[9/16]' : 'left-[9%] bottom-[8%] w-[15%] max-w-[230px] aspect-[9/16]'}>
        <div className="bw-scene-film h-full w-full">
          {[0, 1, 2].map((k) => <img key={k} src={photo(seed + 1 + k * 5)} alt="" className="bw-kb" style={{ animationDelay: `${k * 3}s` }} />)}
          <span className="bw-scene-play"><Play size={16} aria-hidden /></span>
          <div className="absolute inset-x-[8%] bottom-[6%]">
            <p className="text-[clamp(11px,1vw,13px)] font-semibold text-white">{S.keepsake.film}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="bw-scene-track"><span /></span>
              <span className="text-[10px] tabular-nums text-white/90">{S.keepsake.length}</span>
            </div>
          </div>
        </div>
      </Piece>
    </div>
  );

  const byId: Record<StoryFxId, ReactNode> = { qr, prop, wall, medal, keepsake };
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-stacked={stacked ? 'true' : 'false'}>
      {ids.map((id) => <div key={id} className="contents">{byId[id]}</div>)}
    </div>
  );
}
