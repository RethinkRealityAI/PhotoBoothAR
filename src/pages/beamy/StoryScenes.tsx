/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StoryScenes — what unfolds around Beamy at each "How it works" step: real
 * DOM pieces (crisp text, real photos, real library thumbnails) standing in
 * the space around him, tilted a little in 3D. Decorative: the caption panel
 * carries every step's words, so the whole layer is aria-hidden.
 *
 * Every scene is an ordered timeline (lib/beamyStory STORY_SEQ, run by the
 * pure sequencer in lib/beamyMotion): a piece appears only at its cue, so a
 * scene unfolds as a story and never all at once, and leaving the step
 * resets it so it replays on the next entry. The page hears each cue
 * (`onCue`) and has Beamy act on it (catch a shot, beam it to the wall).
 * The same timeline runs under reduced motion; only the CSS softens.
 *
 * Two arrangements: `stacked` (phones and portrait tablets: everything rises
 * above his head, he stands big below) and wide (pieces on both sides of
 * him, clear of the caption at the top left). The page marks each step's
 * main piece with `data-fx-anchor` and aims his projector cone at it.
 * Step 6's pieces (virtual celebrations) live in VirtualCelebrations.tsx.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Camera, Check, ChevronsUp, CircleCheck, Crown, Play, Trophy } from 'lucide-react';
import LiveWall, { WALL_POOL, type Pin } from '../../components/beamy/LiveWall';
import type { StoryFxId } from '../../lib/brandLanding';
import { STORY_SCENE, STORY_SEQ } from '../../lib/beamyStory';
import { useBeamyAssets } from './useBeamyAssets';
import { currentCue, nextChange, passAt, phaseAt, reached, type Sequence } from '../../lib/beamyMotion';
import { WALL_CENTRE } from '../../lib/beamyWall';
import { HERO_WEDDING } from '../../lib/landingAssets';
import { salesImage } from '../sales/salesImages';
import { VcCard, VcLinkPanel } from './VirtualCelebrations';

type SeqScene = keyof typeof STORY_SEQ;
type Pt = { x: number; y: number };

/** One placed piece: absolute box (classes), an entrance delay, an inner float; `show` = its cue has come. */
function Piece({ cls, d = 0, tilt = 0, children, anchor, style, show }: { cls: string; d?: number; tilt?: number; children: ReactNode; anchor?: StoryFxId; style?: CSSProperties; show?: boolean }) {
  return (
    <div className={cls} data-fx-anchor={anchor} data-seq={show === undefined ? undefined : show ? 'on' : 'off'} style={{ ...style, ['--d' as string]: `${d}s`, ['--tilt' as string]: `${tilt}deg` }}>
      <div className="bw-float h-full w-full" style={{ animationDelay: `${-d * 2.3}s` }}>{children}</div>
    </div>
  );
}

/** Run a scene's timeline while it is up: the cues started so far, and which pass (looping scenes). */
function useSeq(active: boolean, s: Sequence): { phase: number; pass: number } {
  const [st, setSt] = useState({ phase: 0, pass: 0 });
  useEffect(() => {
    if (!active) { setSt({ phase: 0, pass: 0 }); return; }
    const t0 = performance.now();
    let id = 0;
    const tick = () => {
      const t = performance.now() - t0;
      const phase = phaseAt(s, t);
      const pass = passAt(s, t);
      setSt((o) => (o.phase === phase && o.pass === pass ? o : { phase, pass }));
      const n = nextChange(s, t);
      if (n !== null) id = window.setTimeout(tick, Math.max(16, n + 4));
    };
    tick();
    return () => window.clearTimeout(id);
  }, [active, s]);
  return st;
}

/** One photo flying into the keepsake film (scene-box px, measured at its cue). */
interface Fly { src: string; x: number; y: number; w: number; h: number; dx: number; dy: number; r: number; delay: number; wall: boolean; }
/** The wall step's shot on its way from the phone to Beamy (scene-box px). */
interface ShotFlight { x: number; y: number; w: number; h: number; dx: number; dy: number; }

const tf = (b: boolean) => (b ? 'true' : 'false');

export default function StoryScenes({ step, live, ids, stacked, qrUrl, wallCentreRef, seed, beamyAt, onCue }: {
  step: number;
  /** The story is the stop on screen (timelines only run then). */
  live: boolean;
  ids: StoryFxId[];
  stacked: boolean;
  /** Where the real QR code goes (the public demo event). */
  qrUrl: string;
  wallCentreRef: MutableRefObject<HTMLDivElement | null>;
  seed: number;
  /** Beamy's mouth in viewport px (null: no stage), where the wall step's shot flies to. */
  beamyAt: () => Pt | null;
  /** A scene's cue just started (the page has Beamy act on it). */
  onCue: (scene: SeqScene, cue: string, pass: number) => void;
}) {
  const S = STORY_SCENE;
  const on = (id: StoryFxId) => tf(ids[step] === id);
  const photo = (k: number) => WALL_POOL[k % WALL_POOL.length];
  const A = useBeamyAssets();
  const album = (k: number) => (A.keepsakePhotos !== undefined && A.keepsakePhotos.length >= 6 ? A.keepsakePhotos[k] : photo(seed + 4 + k * 3));

  const qrSeq = useSeq(live && ids[step] === 'qr', STORY_SEQ.qr);
  const wallSeq = useSeq(live && ids[step] === 'wall', STORY_SEQ.wall);
  const medalSeq = useSeq(live && ids[step] === 'medal', STORY_SEQ.medal);
  const ksSeq = useSeq(live && ids[step] === 'keepsake', STORY_SEQ.keepsake);
  const vcSeq = useSeq(live && ids[step] === 'virtual', STORY_SEQ.virtual);

  /* Tell the page about each cue as it starts (every one, in order, even
     if a slow frame let two start between ticks). */
  const onCueRef = useRef(onCue);
  onCueRef.current = onCue;
  const useCueEvents = (scene: SeqScene, st: { phase: number; pass: number }) => {
    const told = useRef({ phase: 0, pass: 0 });
    useEffect(() => {
      const t = told.current;
      const from = t.pass === st.pass && st.phase >= t.phase ? t.phase : 0;
      told.current = { phase: st.phase, pass: st.pass };
      for (let n = from + 1; n <= st.phase; n++) {
        const c = currentCue(STORY_SEQ[scene], n);
        if (c !== null) onCueRef.current(scene, c, st.pass);
      }
    }, [scene, st.phase, st.pass]);
  };
  useCueEvents('qr', qrSeq);
  useCueEvents('wall', wallSeq);
  useCueEvents('medal', medalSeq);
  useCueEvents('keepsake', ksSeq);
  useCueEvents('virtual', vcSeq);

  /* ── 1. The scan ──────────────────────────────────────────────────── */
  const q = (id: string) => reached(STORY_SEQ.qr, qrSeq.phase, id);
  const qrBox = useRef<HTMLDivElement | null>(null);
  const qrCard = useRef<HTMLAnchorElement | null>(null);
  const qrCode = useRef<HTMLSpanElement | null>(null);
  const qrPhone = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    // Where the phone hovers: centred over the code (layout offsets, so the
    // pieces' tilt and float never skew it), a touch bigger than the code.
    const measure = () => {
      const card = qrCard.current, code = qrCode.current, ph = qrPhone.current;
      if (card === null || code === null || ph === null || ph.offsetWidth === 0) return;
      const cx = card.offsetLeft + code.offsetLeft + code.offsetWidth / 2;
      const cy = card.offsetTop + code.offsetTop + code.offsetHeight / 2;
      const px = ph.offsetLeft + ph.offsetWidth / 2;
      const py = ph.offsetTop + ph.offsetHeight / 2;
      const s = Math.min(1.7, Math.max(1, (code.offsetWidth * 1.3) / (ph.offsetWidth * 0.9)));
      setHover({ ['--hx' as string]: `${(cx - px).toFixed(1)}px`, ['--hy' as string]: `${(cy - py).toFixed(1)}px`, ['--hs' as string]: s.toFixed(3) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (qrBox.current !== null) ro.observe(qrBox.current);
    return () => ro.disconnect();
  }, [stacked]);
  const splashPhoto = salesImage('event-wedding')?.src ?? HERO_WEDDING;

  const qr = (
    <div className="bw-scene bw-qr" data-on={on('qr')}>
      <Piece anchor="qr" cls={stacked ? 'inset-x-[3%] top-[0%] h-[52%]' : 'right-[3.5%] top-[8%] h-[80%] w-[27%] max-w-[440px]'}>
        <div
          ref={qrBox}
          className="bw-qrs"
          data-stacked={tf(stacked)}
          data-hover={tf(q('hover'))}
          data-scan={tf(q('scan'))}
          data-gone={tf(q('dissolve'))}
          data-splash={tf(q('splash'))}
          data-rest={tf(q('rest'))}
          style={hover}
        >
          {/* ONE real, scannable code (it opens the public demo event). It is
              the target the phone scans, and it is back at rest to scan for real. */}
          <a ref={qrCard} href={qrUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1} className="bw-qr-card bw-scene-card">
            <span ref={qrCode} className="bw-qr-code">
              <QRCodeSVG value={qrUrl} level="M" marginSize={0} bgColor="#FFFFFF" fgColor="#1A1740" className="block h-auto w-full" />
            </span>
            <span className="bw-scene-label mt-2.5 block text-center">{S.qr.real}</span>
          </a>
          {/* The guest's phone: glass while it hovers over the code (the code
              shows through), solid once the event opens. */}
          <div ref={qrPhone} className="bw-qr-phone">
            <div className="bw-qr-screen">
              <span className="bw-qr-brackets" />
              <span className="bw-qr-sweep" />
              <span className="bw-qr-glow" />
              <div className="bw-qr-splash">
                <img src={splashPhoto} alt="" className="absolute inset-0 h-full w-full object-cover" />
                <span className="bw-qr-veil" />
                <div className="bw-qr-words">
                  <p className="bw-qr-welcome">{S.qr.welcome}</p>
                  <p className="bw-qr-couple">{S.qr.couple}</p>
                  <p className="bw-qr-booth">{S.qr.booth}</p>
                  <span className="bw-qr-start">{S.qr.start}</span>
                  <p className="bw-qr-hint">{S.qr.hint}</p>
                </div>
              </div>
            </div>
            <span className="bw-qr-notch" />
          </div>
        </div>
      </Piece>
    </div>
  );

  /* ── 3. Every shot beams to the wall ──────────────────────────────── */
  const w = (id: string) => reached(STORY_SEQ.wall, wallSeq.phase, id);
  const wallBox = useRef<HTMLDivElement | null>(null);
  const wallScreen = useRef<HTMLDivElement | null>(null);
  const shot = photo(seed + 2 + wallSeq.pass * 5);
  const [shotFlight, setShotFlight] = useState<ShotFlight | null>(null);
  const [wallPins, setWallPins] = useState<Record<number, Pin>>({});
  const [wallRipple, setWallRipple] = useState(0);
  const flying = w('fly');
  const landed = w('land');
  useEffect(() => {
    if (!flying) { setShotFlight(null); return; }
    const box = wallBox.current?.getBoundingClientRect();
    const scr = wallScreen.current?.getBoundingClientRect();
    if (box === undefined || scr === undefined) return;
    const to = beamyAt() ?? { x: box.left + box.width / 2, y: box.top + box.height * 0.7 };
    const x = scr.left - box.left, y = scr.top - box.top;
    setShotFlight({ x, y, w: scr.width, h: scr.height, dx: to.x - box.left - (x + scr.width / 2), dy: to.y - box.top - (y + scr.height / 2) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measured once per flight
  }, [flying, wallSeq.pass]);
  useEffect(() => {
    if (!landed) return;
    setWallPins({ [WALL_CENTRE]: { src: shot, key: `wl${wallSeq.pass}`, mine: true } });
    setWallRipple((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per landing
  }, [landed, wallSeq.pass]);
  useEffect(() => { if (ids[step] !== 'wall') setWallPins({}); }, [ids, step]);

  const wall = (
    <div ref={wallBox} className="bw-scene bw-wl" data-on={on('wall')}>
      <Piece anchor="wall" tilt={-6} cls={stacked ? 'inset-x-[6%] top-[0%] h-[44%]' : 'right-[3%] top-[5%] bottom-[7%] w-[25%]'}>
        <div className="bw-wall-mount h-full" data-lit={tf(landed)} style={{ ['--wall-yaw' as string]: '0deg' }}>
          <LiveWall key={stacked ? 3 : 4} pool={WALL_POOL} pins={wallPins} dim={false} compact={stacked} centreRef={wallCentreRef} ripple={wallRipple} seed={seed + 3} rows={stacked ? 3 : 4} fill />
        </div>
      </Piece>
      <Piece d={0.14} tilt={7} cls={stacked ? 'left-[2%] bottom-[16%] w-[25%] max-w-[150px] aspect-[9/16]' : 'left-[9%] bottom-[9%] w-[14%] max-w-[210px] aspect-[9/16]'}>
        <div className="bw-scene-phone h-full w-full">
          <div ref={wallScreen} className="bw-scene-phone-screen bw-wl-screen p-0" data-flash={tf(w('flash'))} data-gone={tf(flying)}>
            <img key={shot} src={shot} alt="" className="bw-wl-shot absolute inset-0 h-full w-full rounded-[inherit] object-cover" />
            <span className="bw-wl-flash" />
            <span className="bw-wl-shutter" />
          </div>
          <p className="bw-wl-toast" data-seq={w('toast') ? 'on' : 'off'}>
            <span className="bw-wl-tick" aria-hidden>{landed ? <Check size={11} strokeWidth={3} /> : <Camera size={11} strokeWidth={2.4} />}</span>
            {landed ? S.wall.sent : S.wall.captured}
          </p>
        </div>
      </Piece>
      {shotFlight !== null && (
        <img
          key={`f${wallSeq.pass}`}
          src={shot}
          alt=""
          className="bw-wl-fly"
          data-caught={tf(w('receive'))}
          style={{ left: shotFlight.x, top: shotFlight.y, width: shotFlight.w, height: shotFlight.h, ['--dx' as string]: `${shotFlight.dx}px`, ['--dy' as string]: `${shotFlight.dy}px` }}
        />
      )}
    </div>
  );

  /* ── 4. Challenges: the alert, Ada's selfie, who sent it, completed, the board re-sorts ── */
  const m = (id: string) => reached(STORY_SEQ.medal, medalSeq.phase, id);
  const chPhoto = A.challengePhoto ?? HERO_WEDDING;
  const medal = (
    <div className="bw-scene bw-ch" data-on={on('medal')}>
      <Piece anchor="medal" show={m('alert')} tilt={6} cls={stacked ? 'left-[5%] top-[1%] w-[80%] max-w-[360px]' : 'left-[37%] top-[11%] w-[26%] max-w-[380px]'}>
        <div className="bw-scene-card bw-ch-alert p-4" data-done={tf(m('done'))}>
          <div className="bw-ch-state flex items-center gap-3">
            <span className="bw-scene-badge bw-ch-bell"><Camera size={20} aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="bw-scene-tiny block">{S.medal.eyebrow}</span>
              <span className="block text-[clamp(14px,1.25vw,17px)] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{S.medal.mission}</span>
            </span>
            <span className="bw-scene-points">{S.medal.points}</span>
          </div>
          <div className="bw-ch-state bw-ch-donestate flex items-center gap-3">
            <span className="bw-scene-badge bw-ch-check"><CircleCheck size={22} aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="bw-scene-tiny block">{S.medal.doneEyebrow}</span>
              <span className="block text-[clamp(14px,1.25vw,17px)] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{S.medal.done}</span>
            </span>
          </div>
        </div>
      </Piece>
      <Piece show={m('photo')} tilt={-5} cls={stacked ? 'left-[5%] top-[23%] w-[34%] max-w-[180px]' : 'left-[8%] bottom-[9%] w-[14%] max-w-[230px]'}>
        <div className="bw-ch-photo bw-scene-card p-[6%]" data-flash={tf(m('photo'))}>
          <div className="relative aspect-[4/5] overflow-hidden rounded-lg">
            <img src={chPhoto} alt="" className="h-full w-full object-cover" />
            <span className="bw-ch-flash" />
          </div>
          <span className="bw-scene-chip bw-ch-sent mx-auto mt-2 w-fit" data-seq={m('sent') ? 'on' : 'off'}><Camera size={12} aria-hidden /> {S.medal.sent}</span>
        </div>
      </Piece>
      <Piece show={m('board')} tilt={-6} cls={stacked ? 'right-[5%] top-[24%] w-[55%] max-w-[320px]' : 'right-[5%] top-[30%] w-[22%] max-w-[330px]'}>
        <div className="bw-scene-card p-4">
          <p className="bw-scene-label flex items-center gap-2"><Trophy size={15} aria-hidden /> {S.medal.board}</p>
          {/* Places hold still (a gold crown on #1, then silver and bronze);
              the rows slide past them, and the one on top carries the shine. */}
          <div className="mt-2.5 grid grid-cols-[26px_minmax(0,1fr)] gap-x-2" data-rank={tf(m('rank'))}>
            <ol className="bw-ch-ranks">
              {[1, 2, 3, 4].map((n) => (
                <li key={n}><span className="bw-ch-medal" data-place={n}>{n === 1 ? <Crown size={14} strokeWidth={2} aria-hidden /> : n}</span></li>
              ))}
            </ol>
            <ol className="bw-ch-board" data-rank={tf(m('rank'))}>
              {S.medal.rows.map(([who, pts]) => (
                <li key={who} className="bw-scene-row bw-ch-row" data-move="down">
                  <span className="bw-ch-face" aria-hidden>{who.charAt(0)}</span>
                  <span className="min-w-0 flex-1 truncate">{who}</span>
                  <span className="tabular-nums">{pts}</span>
                </li>
              ))}
              <li className="bw-scene-row bw-ch-row" data-move="up">
                <span className="bw-ch-face" aria-hidden>{S.medal.sender.charAt(0)}</span>
                <span className="min-w-0 flex-1 truncate">{S.medal.sender}</span>
                <span className="bw-ch-climb" aria-hidden><ChevronsUp size={14} strokeWidth={2.2} /></span>
                <span className="bw-ch-pts tabular-nums"><span>0</span><span>{S.medal.winPts}</span></span>
              </li>
            </ol>
          </div>
        </div>
      </Piece>
    </div>
  );

  /* ── 5. The keepsake: the album, its photos fly into the film, it makes itself, it plays ── */
  const k = (id: string) => reached(STORY_SEQ.keepsake, ksSeq.phase, id);
  const ksBox = useRef<HTMLDivElement | null>(null);
  const ksAlbum = useRef<HTMLDivElement | null>(null);
  const ksFilm = useRef<HTMLDivElement | null>(null);
  const [fly, setFly] = useState<Fly[] | null>(null);
  const ksFly = k('fly');
  useEffect(() => {
    if (!ksFly) { setFly(null); return; }
    const box = ksBox.current?.getBoundingClientRect();
    const film = ksFilm.current?.getBoundingClientRect();
    const cells = ksAlbum.current?.querySelectorAll('img');
    if (box === undefined || film === undefined || cells === undefined || cells.length === 0) return;
    const fx = film.left + film.width / 2 - box.left;
    const fy = film.top + film.height * 0.45 - box.top;
    const out: Fly[] = [];
    const to = (x: number, y: number, ww: number, hh: number) => ({ dx: fx - (x + ww / 2), dy: fy - (y + hh / 2) });
    cells.forEach((c, n) => {
      const r = c.getBoundingClientRect();
      const x = r.left - box.left, y = r.top - box.top;
      out.push({ src: c.currentSrc || c.src, x, y, w: r.width, h: r.height, ...to(x, y, r.width, r.height), r: (n % 2 ? 1 : -1) * (6 + n * 2), delay: 0.1 + n * 0.18, wall: false });
    });
    // From the live wall, above: they come in from the top of the scene.
    const c0 = cells[0].getBoundingClientRect();
    for (let n = 0; n < 3; n++) {
      const x = box.width * (0.34 + n * 0.14), y = -c0.height * 0.6;
      out.push({ src: photo(seed + 21 + n * 7), x, y, w: c0.width, h: c0.height, ...to(x, y, c0.width, c0.height), r: (n - 1) * 9, delay: 0.2 + n * 0.3, wall: true });
    }
    setFly(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measured once per entry and arrangement
  }, [ksFly, stacked]);

  const keepsake = (
    <div ref={ksBox} className="bw-scene bw-ks" data-on={on('keepsake')}>
      <Piece anchor="keepsake" show={k('album')} tilt={-6} cls={stacked ? 'left-[4%] top-[1%] w-[57%] max-w-[330px]' : 'right-[3%] top-[11%] w-[25%] max-w-[380px]'}>
        <div className="bw-scene-card p-3">
          <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
            <span className="truncate text-[clamp(12px,1.1vw,15px)] font-semibold" style={{ color: 'var(--bw-ink)' }}>{S.keepsake.album}</span>
            <span className="bw-scene-tiny shrink-0">{S.keepsake.count}</span>
          </div>
          <div ref={ksAlbum} className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2, 3, 4, 5].map((n) => <img key={n} src={album(n)} alt="" className="aspect-[4/5] w-full rounded-md object-cover" />)}
          </div>
        </div>
      </Piece>
      <Piece show={ksFly} tilt={7} cls={stacked ? 'right-[4%] top-[3%] w-[35%] max-w-[210px] aspect-[9/16]' : 'left-[9%] bottom-[8%] w-[15%] max-w-[230px] aspect-[9/16]'}>
        <div ref={ksFilm} className="bw-scene-film bw-ks-film h-full w-full" data-making={tf(k('making'))} data-play={tf(k('play'))}>
          {[0, 1, 2].map((n) => <img key={n} src={album(n * 2)} alt="" className="bw-kb" style={{ animationDelay: `${n * 3}s` }} />)}
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
        {fly?.map((f, n) => (
          <img
            key={n}
            src={f.src}
            alt=""
            className="bw-ks-tile"
            data-wall={tf(f.wall)}
            style={{ left: f.x, top: f.y, width: f.w, height: f.h, animationDelay: `${f.delay}s`, ['--dx' as string]: `${f.dx}px`, ['--dy' as string]: `${f.dy}px`, ['--r' as string]: `${f.r}deg` }}
          />
        ))}
      </div>
    </div>
  );

  /* ── 6. Virtual celebrations: the link goes out, friends' pieces land on one card, it goes out ── */
  const vOn = ids[step] === 'virtual';
  const virtual = (
    <div className="bw-scene bw-vcs" data-on={on('virtual')}>
      <Piece show={reached(STORY_SEQ.virtual, vcSeq.phase, 'link')} tilt={stacked ? 0 : 6} cls={stacked ? 'inset-x-[4%] top-[0%]' : 'left-[8%] bottom-[10%] w-[22%] max-w-[340px]'}>
        <VcLinkPanel phase={vcSeq.phase} compact={stacked} />
      </Piece>
      <Piece anchor="virtual" tilt={stacked ? 0 : -5} cls={stacked ? 'left-[15%] right-[15%] top-[10%]' : 'right-[4%] top-[9%] w-[25%] max-w-[400px]'}>
        <VcCard phase={vcSeq.phase} on={vOn} compact={stacked} />
      </Piece>
    </div>
  );

  // The AR step's picker is real, interactive UI: BeamyPage renders it (ArPicker).
  const byId: Record<StoryFxId, ReactNode> = { qr, prop: null, wall, medal, keepsake, virtual };
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-stacked={tf(stacked)}>
      {ids.map((id) => <div key={id} className="contents">{byId[id]}</div>)}
    </div>
  );
}
