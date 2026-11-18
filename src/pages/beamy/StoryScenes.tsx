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
import { type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Camera, Play, Trophy } from 'lucide-react';
import LiveWall, { WALL_POOL } from '../../components/beamy/LiveWall';
import type { StoryFxId } from '../../lib/brandLanding';
import { STORY_SCENE } from '../../lib/beamyStory';

/** One placed piece: absolute box (classes), an entrance delay, and an inner float. */
function Piece({ cls, d = 0, tilt = 0, children, anchor, style }: { cls: string; d?: number; tilt?: number; children: ReactNode; anchor?: StoryFxId; style?: CSSProperties }) {
  return (
    <div className={cls} data-fx-anchor={anchor} style={{ ...style, ['--d' as string]: `${d}s`, ['--tilt' as string]: `${tilt}deg` }}>
      <div className="bw-float h-full w-full" style={{ animationDelay: `${-d * 2.3}s` }}>{children}</div>
    </div>
  );
}

export default function StoryScenes({ step, ids, stacked, qrUrl, boothFrame, ripple, wallCentreRef, seed }: {
  step: number;
  ids: StoryFxId[];
  stacked: boolean;
  /** Where the real QR code goes (the public demo event). */
  qrUrl: string;
  /** The frame the demo booth screen wears after the scan. */
  boothFrame: string | null;
  ripple: number;
  wallCentreRef: MutableRefObject<HTMLDivElement | null>;
  seed: number;
}) {
  const S = STORY_SCENE;
  const on = (id: StoryFxId) => (ids[step] === id ? 'true' : 'false');
  const photo = (k: number) => WALL_POOL[k % WALL_POOL.length];

  /* Each scene's pieces, placed for the arrangement. Percentages are of the scene box. */
  // ONE real, scannable code (an Easter egg: it opens the public demo
  // event). The scene loops while the step is up: a guest's phone comes
  // down over the code and scans it, the code dissolves into the phone, the
  // phone opens the event's booth, then the code comes back. Hovering the
  // code holds the loop so a visitor can scan it for real.
  const qr = (
    <div className="bw-scene bw-qr" data-on={on('qr')}>
      <Piece tilt={5} cls={stacked ? 'left-[5%] top-[15%] w-[42%] max-w-[220px]' : 'right-[18%] bottom-[8%] w-[14%] min-w-[184px] max-w-[236px]'}>
        <a href={qrUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1} className="bw-qr-card bw-scene-card block p-[9%] text-center">
          <span className="block rounded-xl bg-white p-[6%]">
            <QRCodeSVG value={qrUrl} level="M" marginSize={0} bgColor="#FFFFFF" fgColor="#1A1740" className="block h-auto w-full" />
          </span>
          <span className="bw-scene-label mt-2.5 block">{S.qr.real}</span>
        </a>
      </Piece>
      <Piece anchor="qr" d={0.12} tilt={-7} cls={stacked ? 'right-[6%] top-[1%] h-[47%] aspect-[9/18.5]' : 'right-[5%] top-[2%] h-[62%] aspect-[9/18.5]'}>
        <div className="bw-qr-phone bw-scene-phone h-full w-full">
          <div className="bw-scene-phone-screen p-0">
            {/* 1: the camera, looking for a code. */}
            <div className="bw-qr-cam">
              <span className="bw-qr-brackets" />
              <span className="bw-scene-scan" />
              <p className="bw-scene-tiny absolute inset-x-0 bottom-[12%] text-center">{S.qr.scan}</p>
            </div>
            {/* 2: the event's booth, live in the browser. */}
            <div className="bw-qr-booth">
              <img src={photo(seed + 5)} alt="" className="absolute inset-0 h-full w-full object-cover" />
              {boothFrame !== null && <img src={boothFrame} alt="" className="absolute inset-0 h-full w-full object-cover" />}
              <p className="absolute inset-x-0 top-[8%] flex justify-center"><span className="bw-scene-chip">{S.qr.event}</span></p>
              <div className="bw-qr-dock">
                <p className="flex justify-center gap-[8%]">{S.qr.tabs.map((t, k) => <span key={t} className="bw-qr-tab" data-on={k === 0 ? 'true' : 'false'}>{t}</span>)}</p>
                <span className="bw-qr-shutter" />
              </div>
            </div>
            <span className="bw-scene-notch" />
          </div>
        </div>
      </Piece>
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

  // The AR step's picker is real, interactive UI: BeamyPage renders it (ArPicker).
  const byId: Record<StoryFxId, ReactNode> = { qr, prop: null, wall, medal, keepsake };
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-stacked={stacked ? 'true' : 'false'}>
      {ids.map((id) => <div key={id} className="contents">{byId[id]}</div>)}
    </div>
  );
}
