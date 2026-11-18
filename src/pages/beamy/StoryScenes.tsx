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
import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Camera, Play, Trophy } from 'lucide-react';
import LiveWall, { WALL_POOL } from '../../components/beamy/LiveWall';
import type { StoryFxId } from '../../lib/brandLanding';
import { STORY_SCENE } from '../../lib/beamyStory';
import { HOME_ASSET_DEFAULTS } from '../../lib/beamyAssets';
import { HERO_WEDDING } from '../../lib/landingAssets';

/** One placed piece: absolute box (classes), an entrance delay, and an inner float. */
function Piece({ cls, d = 0, tilt = 0, children, anchor, style }: { cls: string; d?: number; tilt?: number; children: ReactNode; anchor?: StoryFxId; style?: CSSProperties }) {
  return (
    <div className={cls} data-fx-anchor={anchor} style={{ ...style, ['--d' as string]: `${d}s`, ['--tilt' as string]: `${tilt}deg` }}>
      <div className="bw-float h-full w-full" style={{ animationDelay: `${-d * 2.3}s` }}>{children}</div>
    </div>
  );
}

/** One photo flying into the keepsake film (scene-box px, measured on entry). */
interface Fly { src: string; x: number; y: number; w: number; h: number; dx: number; dy: number; r: number; delay: number; wall: boolean; }

/** A small bridal veil and tiara for Beamy's photobomb. */
function Veil() {
  return (
    <svg viewBox="0 0 100 60" className="bw-ch-veil" aria-hidden>
      <path d="M50 6 C24 6 8 22 2 58 C18 44 34 38 50 38 C66 38 82 44 98 58 C92 22 76 6 50 6 Z" fill="rgba(255,255,255,0.78)" />
      <path d="M30 14 L36 4 L42 12 L50 2 L58 12 L64 4 L70 14 Z" fill="#FFE2A6" stroke="#FFFFFF" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function StoryScenes({ step, ids, stacked, qrUrl, boothFrame, beamyPortrait, ripple, wallCentreRef, seed }: {
  step: number;
  ids: StoryFxId[];
  stacked: boolean;
  /** Where the real QR code goes (the public demo event). */
  qrUrl: string;
  /** The frame the demo booth screen wears after the scan. */
  boothFrame: string | null;
  /** Beamy's own portrait (BeamyApi.portrait), photobombing the challenge selfie; null: the selfie alone. */
  beamyPortrait: string | null;
  ripple: number;
  wallCentreRef: MutableRefObject<HTMLDivElement | null>;
  seed: number;
}) {
  const S = STORY_SCENE;
  const on = (id: StoryFxId) => (ids[step] === id ? 'true' : 'false');
  const photo = (k: number) => WALL_POOL[k % WALL_POOL.length];
  const A = HOME_ASSET_DEFAULTS;
  const album = (k: number) => (A.keepsakePhotos !== undefined && A.keepsakePhotos.length >= 6 ? A.keepsakePhotos[k] : photo(seed + 4 + k * 3));

  /* The keepsake: once the step is up, every album photo plus a few from the
     wall fly into the film (measured from where they really sit), the film
     finishes making itself, then plays. Leaving the step resets it. */
  const ksOn = ids[step] === 'keepsake';
  const ksBox = useRef<HTMLDivElement | null>(null);
  const ksAlbum = useRef<HTMLDivElement | null>(null);
  const ksFilm = useRef<HTMLDivElement | null>(null);
  const [fly, setFly] = useState<Fly[] | null>(null);
  useEffect(() => {
    if (!ksOn) { setFly(null); return; }
    const id = window.setTimeout(() => {
      const box = ksBox.current?.getBoundingClientRect();
      const film = ksFilm.current?.getBoundingClientRect();
      const cells = ksAlbum.current?.querySelectorAll('img');
      if (box === undefined || film === undefined || cells === undefined || cells.length === 0) return;
      const fx = film.left + film.width / 2 - box.left;
      const fy = film.top + film.height * 0.45 - box.top;
      const out: Fly[] = [];
      const to = (x: number, y: number, w: number, h: number) => ({ dx: fx - (x + w / 2), dy: fy - (y + h / 2) });
      cells.forEach((c, k) => {
        const r = c.getBoundingClientRect();
        const x = r.left - box.left, y = r.top - box.top;
        out.push({ src: c.currentSrc || c.src, x, y, w: r.width, h: r.height, ...to(x, y, r.width, r.height), r: (k % 2 ? 1 : -1) * (6 + k * 2), delay: 0.3 + k * 0.2, wall: false });
      });
      // From the live wall, above: they come in from the top of the scene.
      const c0 = cells[0].getBoundingClientRect();
      for (let k = 0; k < 3; k++) {
        const x = box.width * (0.34 + k * 0.14), y = -c0.height * 0.6;
        out.push({ src: photo(seed + 21 + k * 7), x, y, w: c0.width, h: c0.height, ...to(x, y, c0.width, c0.height), r: (k - 1) * 9, delay: 0.1 + k * 0.3, wall: true });
      }
      setFly(out);
    }, 1100);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure per entry and arrangement
  }, [ksOn, stacked]);

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

  /* Challenges: an alert, the guest's shot (Beamy photobombing in a veil),
     who sent it, then the board re-sorts and the sender jumps to #1. Plays
     once each time the step comes up, and holds its last frame. */
  const chPhoto = A.challengePhoto ?? HERO_WEDDING;
  const medal = (
    <div className="bw-scene bw-ch" data-on={on('medal')}>
      <Piece anchor="medal" tilt={6} cls={stacked ? 'left-[5%] top-[1%] w-[68%] max-w-[360px]' : 'left-[37%] top-[11%] w-[26%] max-w-[380px]'}>
        <div className="bw-scene-card flex items-center gap-3 p-4">
          <span className="bw-scene-badge bw-ch-bell"><Camera size={20} aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="bw-scene-tiny block">{S.medal.eyebrow}</span>
            <span className="block text-[clamp(14px,1.25vw,17px)] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{S.medal.mission}</span>
          </span>
          <span className="bw-scene-points">{S.medal.points}</span>
        </div>
      </Piece>
      <Piece d={0.9} tilt={-5} cls={stacked ? 'left-[5%] top-[21%] w-[33%] max-w-[180px]' : 'left-[8%] bottom-[9%] w-[14%] max-w-[230px]'}>
        <div className="bw-ch-photo bw-scene-card p-[6%]">
          <div className="relative aspect-[4/5] overflow-hidden rounded-lg">
            <img src={chPhoto} alt="" className="h-full w-full object-cover" />
            {A.challengePhoto === undefined && beamyPortrait !== null && (
              <span className="bw-ch-bomb">
                <img src={beamyPortrait} alt="" />
                <Veil />
              </span>
            )}
            <span className="bw-ch-flash" />
          </div>
          <span className="bw-scene-chip bw-ch-sent mx-auto mt-2 w-fit"><Camera size={12} aria-hidden /> {S.medal.sent}</span>
        </div>
      </Piece>
      <Piece d={0.3} tilt={-6} cls={stacked ? 'right-[5%] top-[22%] w-[56%] max-w-[320px]' : 'right-[5%] top-[30%] w-[22%] max-w-[330px]'}>
        <div className="bw-scene-card p-4">
          <p className="bw-scene-label flex items-center gap-2"><Trophy size={15} aria-hidden /> {S.medal.board}</p>
          <div className="mt-2.5 grid grid-cols-[20px_minmax(0,1fr)] gap-x-2">
            <ol className="bw-ch-ranks">
              {[1, 2, 3, 4].map((n) => <li key={n}><span className="bw-scene-rank">{n}</span></li>)}
            </ol>
            <ol className="bw-ch-board">
              {S.medal.rows.map(([who, pts]) => (
                <li key={who} className="bw-scene-row bw-ch-row" data-move="down">
                  <span className="min-w-0 flex-1 truncate">{who}</span>
                  <span className="tabular-nums">{pts}</span>
                </li>
              ))}
              <li className="bw-scene-row bw-ch-row" data-move="up">
                <span className="min-w-0 flex-1 truncate">{S.medal.sender}</span>
                <span className="bw-ch-pts tabular-nums"><span>0</span><span>{S.medal.winPts}</span></span>
              </li>
            </ol>
          </div>
        </div>
      </Piece>
    </div>
  );

  const keepsake = (
    <div ref={ksBox} className="bw-scene bw-ks" data-on={on('keepsake')}>
      <Piece anchor="keepsake" tilt={-6} cls={stacked ? 'left-[4%] top-[1%] w-[57%] max-w-[330px]' : 'right-[3%] top-[11%] w-[25%] max-w-[380px]'}>
        <div className="bw-scene-card p-3">
          <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
            <span className="truncate text-[clamp(12px,1.1vw,15px)] font-semibold" style={{ color: 'var(--bw-ink)' }}>{S.keepsake.album}</span>
            <span className="bw-scene-tiny shrink-0">{S.keepsake.count}</span>
          </div>
          <div ref={ksAlbum} className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2, 3, 4, 5].map((k) => <img key={k} src={album(k)} alt="" className="aspect-[4/5] w-full rounded-md object-cover" />)}
          </div>
        </div>
      </Piece>
      <Piece d={0.14} tilt={7} cls={stacked ? 'right-[4%] top-[3%] w-[35%] max-w-[210px] aspect-[9/16]' : 'left-[9%] bottom-[8%] w-[15%] max-w-[230px] aspect-[9/16]'}>
        <div ref={ksFilm} className="bw-scene-film bw-ks-film h-full w-full">
          {[0, 1, 2].map((k) => <img key={k} src={album(k * 2)} alt="" className="bw-kb" style={{ animationDelay: `${k * 3}s` }} />)}
          <div className="absolute inset-x-[8%] bottom-[6%]">
            <p className="text-[clamp(11px,1vw,13px)] font-semibold text-white">{S.keepsake.film}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="bw-scene-track"><span /></span>
              <span className="text-[10px] tabular-nums text-white/90">{S.keepsake.length}</span>
            </div>
          </div>
          <div className="bw-ks-making">
            <span className="bw-ks-spark"><Play size={16} aria-hidden /></span>
            <p className="bw-scene-tiny mt-2 text-center text-white">{S.keepsake.making}</p>
            <span className="bw-ks-bar"><span /></span>
          </div>
        </div>
      </Piece>
      <div className="bw-ks-fly inset-0">
        {fly?.map((f, k) => (
          <img
            key={k}
            src={f.src}
            alt=""
            className="bw-ks-tile"
            data-wall={f.wall ? 'true' : 'false'}
            style={{ left: f.x, top: f.y, width: f.w, height: f.h, animationDelay: `${f.delay}s`, ['--dx' as string]: `${f.dx}px`, ['--dy' as string]: `${f.dy}px`, ['--r' as string]: `${f.r}deg` }}
          />
        ))}
      </div>
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
