/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Brand v2 pictures for the decks, built from the platform's REAL pieces
 * instead of the pre-v2 cutouts and films (midnight + serif, the retired
 * spiky crown):
 *
 *  - DeckWall:   the homepage's own live wall (components/beamy/LiveWall),
 *                photos swapping in on its scheduler, with Beamy beside it.
 *  - LooksBoard: what a guest can try on, in the platform's words
 *                (lib/lookTerms: Frames · Props · Paint · Effects), each shown
 *                with a real library piece.
 *  - StepArt:    the three "how it works" pictures: real frames, the one QR
 *                code, the wall filling up.
 *
 * Same contract as Slides.tsx: 'stage' is the fixed 1280×720 canvas, 'card'
 * the phone layout. Nothing below 14px on a stage or 12px on a card.
 */
import type { ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Music2, PartyPopper, Snowflake, Sparkles, Sun } from 'lucide-react';
import LiveWall, { WALL_POOL } from '../../../components/beamy/LiveWall';
import { LOOK_TABS } from '../../../lib/lookTerms';
import { LOOK_SHOTS, salesImage } from '../salesImages';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** A clear frost tile with a hairline light rim (Slides.tsx CARD's recipe). */
const GLASS = 'bg-white/[0.07] shadow-[inset_1px_1px_0_rgba(255,255,255,0.34),inset_-1px_-1px_0_rgba(255,255,255,0.08),inset_0_0_0_1px_rgba(255,255,255,0.10)]';
const DROP = 'drop-shadow(0 22px 34px rgba(22, 18, 78, 0.45))';

/** Real frames from the library (public/guides/frames), one per occasion. */
const FRAME_THUMBS = ['cultural-asoebi-arch', 'wedding-magazine-cover', 'gala-magazine-cover', 'birthday-monogram-corner'];
const frameThumb = (id: string) => `/guides/frames/thumb/${id}.webp`;

/** The homepage AR step's effects (lib/beamyAssets arLooks, category effect). */
const EFFECTS: { name: string; Icon: typeof Sparkles }[] = [
  { name: 'Sparkle burst', Icon: Sparkles },
  { name: 'Snowfall', Icon: Snowflake },
  { name: 'Confetti', Icon: PartyPopper },
  { name: 'Music notes', Icon: Music2 },
  { name: 'Stage lights', Icon: Sun },
];

function Pic({ k, eager, className = '' }: { k: string; eager: boolean; className?: string }) {
  const img = salesImage(k);
  if (img === null) return null;
  return (
    <img
      src={img.src}
      width={img.width}
      height={img.height}
      alt={img.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      className={cx('select-none object-contain', className)}
      style={{ filter: DROP }}
    />
  );
}

// ── Live wall ──────────────────────────────────────────────────────────────

/**
 * The live wall, as on beamwall.app. `still` (print, thumbnails) keeps the
 * same component: its first wall is drawn at once and a swap only changes
 * one tile, so a capture is always a full wall.
 */
export function DeckWall({ mode, eager = false, beamy = 'beamy-wave', className = '' }: {
  mode: 'stage' | 'card';
  eager?: boolean;
  /** The Beamy beside the wall; '' for none. */
  beamy?: string;
  className?: string;
}) {
  const stage = mode === 'stage';
  return (
    <div className={cx('relative', stage ? 'h-[560px]' : 'w-full', className)}>
      <div className={cx(stage ? 'ml-auto h-full w-[470px]' : 'mx-auto w-full max-w-[340px]')}>
        <LiveWall pool={WALL_POOL} pins={{}} dim={false} compact={!stage} ripple={0} seed={7} fill={stage} />
      </div>
      {beamy !== '' && (
        <Pic
          k={beamy}
          eager={eager}
          className={cx('pointer-events-none absolute', stage ? '-left-6 bottom-[-18px] h-[230px] w-auto' : '-bottom-5 -left-1 h-[104px] w-auto')}
        />
      )}
    </div>
  );
}

// ── Looks ──────────────────────────────────────────────────────────────────

function LookRow({ tab, mode, eager }: { tab: (typeof LOOK_TABS)[number]; mode: 'stage' | 'card'; eager: boolean }) {
  const stage = mode === 'stage';
  const thumb = stage ? 'h-[84px] w-[84px]' : 'h-[58px] w-[58px]';
  let content: ReactNode;
  if (tab.id === 'frames') {
    content = FRAME_THUMBS.map((id) => (
      <img
        key={id}
        src={frameThumb(id)}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        className={cx('aspect-[9/16] w-auto rounded-[6px] object-cover shadow-[0_10px_20px_-12px_rgba(22,18,78,0.8)]', stage ? 'h-[92px]' : 'h-[68px]')}
      />
    ));
  } else if (tab.id === 'effects') {
    content = EFFECTS.slice(0, stage ? 4 : 3).map(({ name, Icon }) => (
      <span key={name} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.12] font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]', stage ? 'h-10 px-4 text-[15px]' : 'h-8 px-3 text-[12.5px]')}>
        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden /> {name}
      </span>
    ));
  } else {
    content = LOOK_SHOTS[tab.id].map((k) => (
      <span key={k} className={cx('flex items-center justify-center overflow-hidden rounded-[14px] bg-white/[0.08]', thumb)}>
        <Pic k={k} eager={eager} className="h-[112%] w-[112%] max-w-none translate-y-[4%]" />
      </span>
    ));
  }
  return (
    <li className={cx('flex rounded-[20px]', GLASS, stage ? 'min-h-[118px] items-center gap-5 px-6 py-3' : 'flex-col gap-2 px-3.5 py-3')}>
      <p className={cx('shrink-0 font-semibold text-white', stage ? 'w-[118px] text-[19px]' : 'text-[14px]')}>{tab.label}</p>
      <div className={cx('flex flex-wrap items-center', stage ? 'gap-3' : 'gap-2')}>{content}</div>
    </li>
  );
}

/**
 * Beamy wearing a frame (and a prop) under the slide's words; the four kinds
 * of Look beside him, each with real library pieces. `header` is the slide's
 * eyebrow, title and body: on a stage it heads the left column.
 */
export function LooksBoard({ mode, hero = 'beamy-asoebi', eager = false, header }: { mode: 'stage' | 'card'; hero?: string; eager?: boolean; header: ReactNode }) {
  const stage = mode === 'stage';
  const halo = { background: 'radial-gradient(closest-side, rgba(134,125,240,0.55), transparent)' };
  const rows = <ul className={cx('flex flex-col', stage ? 'h-full justify-center gap-3' : 'gap-2.5')}>{LOOK_TABS.map((t) => <LookRow key={t.id} tab={t} mode={mode} eager={eager} />)}</ul>;
  if (!stage) {
    return (
      <div className="flex flex-col">
        {header}
        <div className="relative mx-auto mt-5 h-[230px] w-full">
          <div aria-hidden className="absolute inset-x-10 inset-y-4 rounded-full blur-3xl" style={halo} />
          <Pic k={hero} eager={eager} className="relative mx-auto h-full w-auto" />
        </div>
        <div className="mt-4">{rows}</div>
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-[0.82fr_1.18fr] gap-10">
      <div className="flex min-h-0 flex-col">
        {header}
        <div className="relative mt-4 min-h-0 flex-1">
          <div aria-hidden className="absolute inset-4 rounded-full blur-3xl" style={halo} />
          <Pic k={hero} eager={eager} className="relative mx-auto h-full w-auto" />
        </div>
      </div>
      {rows}
    </div>
  );
}

// ── How it works ───────────────────────────────────────────────────────────

/** Step 1: real frames fanned out. */
function FramesFan({ small, eager }: { small: boolean; eager: boolean }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {FRAME_THUMBS.slice(0, 3).map((id, i) => (
        <img
          key={id}
          src={frameThumb(id)}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          className={cx('absolute aspect-[9/16] w-auto rounded-[10px] object-cover shadow-[0_18px_30px_-16px_rgba(22,18,78,0.85)] ring-1 ring-white/30', small ? 'h-[66px]' : 'h-[190px]', i === 1 && 'z-10')}
          style={{ transform: `translateX(${(i - 1) * (small ? 16 : 58)}px) rotate(${(i - 1) * 9}deg)` }}
        />
      ))}
    </div>
  );
}

/** Step 2: the one QR code, on a glass table card. */
function QrCard({ small }: { small: boolean }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className={cx('flex flex-col items-center rounded-[18px] bg-white/[0.12] shadow-[inset_1px_1px_0_rgba(255,255,255,0.5),inset_0_0_0_1px_rgba(255,255,255,0.18),0_24px_40px_-24px_rgba(22,18,78,0.8)]', small ? 'gap-1 p-1.5' : 'gap-3 p-4')} style={{ transform: small ? undefined : 'rotate(-4deg)' }}>
        <div className={cx('rounded-[10px] bg-white', small ? 'p-1' : 'p-2.5')}>
          <QRCodeSVG value="https://beamwall.app" size={small ? 44 : 128} level="M" fgColor="#1A1740" />
        </div>
        {!small && <span className="text-[15px] font-semibold text-white">Scan to join</span>}
      </div>
    </div>
  );
}

/** Step 3: the wall filling up (static tiles, one lit as it lands). */
function WallTiles({ small }: { small: boolean }) {
  const pics = WALL_POOL.slice(0, 9);
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className={cx('bw-wall grid grid-cols-3', small ? 'w-[72px] gap-[2px] !p-[3px] !rounded-[8px]' : 'w-[200px] gap-[5px]')}>
        {pics.map((src, i) => (
          <div key={i} className={cx('bw-tile aspect-[4/5]', i === 4 && 'ring-2 ring-white')} style={i === 4 ? { boxShadow: '0 0 18px 2px rgba(212,214,255,0.8)' } : undefined}>
            <img src={src} alt="" draggable={false} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StepArt({ index, mode, eager = false }: { index: number; mode: 'stage' | 'card'; eager?: boolean }) {
  const small = mode === 'card';
  if (index === 0) return <FramesFan small={small} eager={eager} />;
  if (index === 1) return <QrCard small={small} />;
  if (index === 2) return <WallTiles small={small} />;
  return null;
}
