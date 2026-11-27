/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The picture at the top of each booth-intro step. Real platform imagery over
 * generic icons (Dapo, 2026-11-26): Beamy himself, the event's OWN looks
 * fanned out over a guest, the event's own frame standing up in a room, and a
 * live drawing of the booth's real buttons that points at each one in turn.
 *
 * Content animation always plays (brand rule: the owner's machine reports
 * prefers-reduced-motion and story motion must still read); reduced motion
 * only drops the decorative float.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Camera, ChevronLeft, Film, LayoutGrid, SwitchCamera, Trophy, Video } from 'lucide-react';
import type { IntroArt as Art, IntroLook } from '../../../lib/boothIntro';
import type { LookTab } from '../../../lib/lookTerms';
import beamyHello from '../../../assets/sales/v2/beamy-hello.webp';
import beamyCrown from '../../../assets/sales/v2/beamy-crown.webp';
import beamyBlast from '../../../assets/sales/beamy-blast.webp';
import boothStandin from '../../../assets/landing/booth-standin.webp';
import trophy from '../../../assets/landing/trophy-cutout.webp';
import wallCube from '../../../assets/landing/step-wall-cutout.webp';
import worldRoom from '../../../assets/landing/wall-scene.webp';

/** Beamy's little face for the step label (public/, served as-is). */
export const beamyGreet = '/mascot/beamy-greet.webp';

const TAB_NOUN: Record<LookTab, string> = { frames: 'Frame', props: 'Prop', paint: 'Paint', effects: 'Effect' };

/** A soft accent glow behind the art. */
function Glow({ className = 'inset-6' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`absolute ${className} rounded-full blur-2xl`}
      style={{ background: 'radial-gradient(closest-side, color-mix(in srgb, var(--sc-accent) 45%, transparent), transparent)' }}
    />
  );
}

function Floating({ children, delay = 0, amp = 6, style, className = '' }: { children: ReactNode; delay?: number; amp?: number; style?: CSSProperties; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.div
      className={className}
      style={style}
      animate={reduced ? undefined : { y: [0, -amp, 0] }}
      transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut', delay }}
    >
      {children}
    </motion.div>
  );
}

const BEAMY = { hello: beamyHello, crown: beamyCrown, blast: beamyBlast } as const;

function BeamyArt({ pose }: { pose: keyof typeof BEAMY }) {
  // The blast is a lit scene, not a cutout: it fills the stage edge to edge.
  if (pose === 'blast') {
    return (
      <motion.img
        src={beamyBlast}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: '50% 58%' }}
        initial={{ scale: 1.12, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />
    );
  }
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <Glow className="inset-4" />
      <Floating className="relative h-[92%]">
        <motion.img
          src={BEAMY[pose]}
          alt=""
          draggable={false}
          className="h-full w-auto object-contain drop-shadow-[0_18px_30px_rgba(10,8,40,0.45)]"
          initial={{ scale: 0.86, opacity: 0, rotate: pose === 'hello' ? -6 : 0 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 16 }}
        />
      </Floating>
    </div>
  );
}

/** A look card: a frame drawn over a guest (frames are see-through), anything else its own picture. */
function LookCard({ look, className = '', style }: { look: IntroLook; className?: string; style?: CSSProperties }) {
  return (
    <div className={`relative overflow-hidden rounded-[18px] bg-black/30 ${className}`} style={{ boxShadow: '0 16px 30px -14px rgba(10,8,40,0.7), inset 0 0 0 1px rgba(255,255,255,0.28)', ...style }}>
      {look.tab === 'frames' && <img src={boothStandin} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />}
      {look.thumb && (
        <img
          src={look.thumb}
          alt=""
          draggable={false}
          className={`absolute inset-0 h-full w-full ${look.tab === 'frames' ? 'object-fill' : 'object-cover'}`}
        />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-left font-sans text-[11px] font-semibold text-white">
        {TAB_NOUN[look.tab]}
      </span>
    </div>
  );
}

function LooksArt({ looks }: { looks: IntroLook[] }) {
  const n = looks.length;
  const spread = n === 1 ? [0] : n === 2 ? [-7, 7] : [-10, 0, 10];
  const shift = n === 1 ? [0] : n === 2 ? [-46, 46] : [-84, 0, 84];
  return (
    <div className="relative h-full w-full">
      <Glow className="inset-8" />
      {looks.map((l, i) => (
        <motion.div
          key={l.id}
          className="absolute left-1/2 top-1/2"
          initial={{ x: '-50%', y: '-40%', rotate: 0, opacity: 0 }}
          animate={{ x: `calc(-50% + ${shift[i]}px)`, y: '-50%', rotate: spread[i], opacity: 1 }}
          transition={{ type: 'spring', stiffness: 170, damping: 18, delay: 0.08 * i }}
          style={{ zIndex: i === Math.floor(n / 2) ? 2 : 1 }}
        >
          <Floating delay={i * 0.6} amp={5}>
            <LookCard look={l} className="h-[164px] w-[110px]" />
          </Floating>
        </motion.div>
      ))}
    </div>
  );
}

/** The event's frame standing life-size in a room, a placement ring on the floor, Beamy beside it. */
function WorldArt({ frame }: { frame: IntroLook | null }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[inherit]">
      {frame?.thumb ? (
        <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #120f33 0%, #241d5c 58%, #0b0926 59%, #1a1547 100%)' }}>
          <svg viewBox="0 0 340 220" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-40">
            {[-160, -100, -40, 20, 80, 140, 200, 260, 320, 380, 440, 500].map((x) => (
              <line key={x} x1={170} y1={128} x2={x} y2={220} stroke="var(--sc-accent)" strokeWidth={0.7} />
            ))}
            {[140, 156, 178, 206].map((y) => <line key={y} x1={0} y1={y} x2={340} y2={y} stroke="var(--sc-accent)" strokeWidth={0.6} />)}
          </svg>
        </div>
      ) : (
        <img src={worldRoom} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" draggable={false} />
      )}
      {/* Placement ring: the same "tap to place" reticle the booth draws on the floor. */}
      <motion.div
        aria-hidden
        className="absolute left-[38%] top-[80%] h-[26px] w-[120px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2"
        style={{ borderColor: 'color-mix(in srgb, var(--sc-accent) 80%, white)' }}
        animate={{ scale: [0.8, 1.08, 0.8], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      {frame?.thumb && (
        <div className="absolute left-[38%] top-[12%] h-[70%] -translate-x-1/2" style={{ perspective: 600 }}>
          <motion.div
            className="relative h-full overflow-hidden rounded-[6px]"
            style={{ aspectRatio: '9 / 16', transformStyle: 'preserve-3d', boxShadow: '0 22px 30px -16px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.35)' }}
            initial={{ rotateY: -50, y: 30, opacity: 0 }}
            animate={{ rotateY: -18, y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 90, damping: 14 }}
          >
            <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.22), rgba(255,255,255,0.05) 45%, color-mix(in srgb, var(--sc-accent) 22%, transparent))' }} />
            <img src={frame.thumb} alt="" className="absolute inset-0 h-full w-full object-fill" draggable={false} />
          </motion.div>
        </div>
      )}
      <Floating className="absolute bottom-[6%] right-[9%] h-[56%]" amp={4} delay={0.4}>
        <img src={beamyHello} alt="" className="h-full w-auto object-contain drop-shadow-[0_14px_20px_rgba(0,0,0,0.5)]" draggable={false} />
      </Floating>
      <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 font-sans text-[11px] font-bold tracking-wide text-white" style={{ background: 'color-mix(in srgb, var(--sc-accent) 70%, #1a1740)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)' }}>
        AR
      </span>
    </div>
  );
}

function CutoutArt({ src, badge }: { src: string; badge?: string }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <Glow className="inset-5" />
      <Floating className="relative h-[94%]" amp={5}>
        <motion.img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-auto object-contain"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        />
      </Floating>
      {badge && (
        <span className="absolute right-[22%] top-[14%] flex h-9 min-w-9 items-center justify-center gap-1 rounded-full px-2.5 font-sans text-[15px] font-bold sc-cta">
          <Trophy className="h-4 w-4" aria-hidden />{badge}
        </span>
      )}
    </div>
  );
}

function ImageArt({ url }: { url: string }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[inherit]">
      <img src={url} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-xl" draggable={false} />
      <motion.img
        src={url}
        alt=""
        draggable={false}
        className="relative h-full w-full object-contain p-2"
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35 }}
      />
    </div>
  );
}

/* ── The controls step: the booth's real buttons, pointed at in turn ── */

type ControlId = 'flip' | 'looks' | 'modes' | 'snap';

/** Hit boxes in the 320×200 drawing (the mini phone sits at x 14, y 6, 100×188). */
const TARGET: Record<ControlId, { x: number; y: number; w: number; h: number }> = {
  flip: { x: 90, y: 9, w: 22, h: 22 },
  looks: { x: 17, y: 115, w: 94, h: 36 },
  modes: { x: 17, y: 160, w: 36, h: 22 },
  snap: { x: 52, y: 157, w: 26, h: 28 },
};

export function ControlsArt({ flip, video, strip, tabs, looks }: Extract<Art, { kind: 'controls' }>) {
  const items: { id: ControlId; label: string; Icon: typeof Camera }[] = [
    ...(flip ? [{ id: 'flip' as const, label: 'Flip camera', Icon: SwitchCamera }] : []),
    { id: 'looks', label: 'Switch looks', Icon: LayoutGrid },
    { id: 'modes', label: ['Photo', ...(video ? ['Video'] : []), ...(strip ? ['Strip'] : [])].join(' · '), Icon: video ? Video : Film },
    { id: 'snap', label: 'Snap!', Icon: Camera },
  ];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % items.length), 1900);
    return () => clearInterval(t);
  }, [items.length]);
  const cur = items[Math.min(active, items.length - 1)];
  const box = TARGET[cur.id];
  const rowGap = 200 / items.length;
  const rowY = (i: number) => rowGap * i + rowGap / 2;
  const frame = looks.find((l) => l.tab === 'frames' && l.thumb);
  const orbs = looks.slice(0, 4);
  // Connector: from the ring's right edge to the active label's left edge.
  const x1 = box.x + box.w + 2;
  const y1 = box.y + box.h / 2;
  const x2 = 140;
  const y2 = rowY(active);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="relative h-[200px] w-[320px] shrink-0" role="img" aria-label={`The booth’s buttons: ${items.map((i) => i.label).join(', ')}`}>
        {/* The mini booth */}
        <div className="absolute left-[14px] top-[6px] h-[188px] w-[100px] overflow-hidden rounded-[18px] bg-black" style={{ boxShadow: '0 0 0 3px rgba(10,8,40,0.85), 0 0 0 4px rgba(255,255,255,0.25), 0 18px 30px -14px rgba(0,0,0,0.8)' }}>
          <img src={boothStandin} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          {frame?.thumb && <img src={frame.thumb} alt="" className="absolute inset-0 h-full w-full object-fill" draggable={false} />}
          <div className="absolute inset-x-0 bottom-0 h-[44%] bg-gradient-to-t from-black/85 via-black/55 to-transparent" />
          <span className="absolute left-[6px] top-[6px] flex h-[14px] w-[14px] items-center justify-center rounded-full bg-white/25 backdrop-blur"><ChevronLeft className="h-2 w-2 text-white" /></span>
          {flip && <span className="absolute right-[6px] top-[6px] flex h-[16px] w-[16px] items-center justify-center rounded-full bg-white/30 backdrop-blur"><SwitchCamera className="h-[9px] w-[9px] text-white" /></span>}
          {/* Tabs + orbs */}
          <div className="absolute inset-x-0 top-[112px] flex justify-center gap-[3px]">
            {(tabs.length ? tabs : (['effects'] as LookTab[])).map((t, i) => (
              <span key={t} className={`rounded-full px-[4px] py-[1px] font-sans text-[5.5px] font-semibold ${i === 0 ? 'bg-white/25 text-white' : 'text-white/70'}`}>{TAB_NOUN[t]}s</span>
            ))}
          </div>
          <div className="absolute inset-x-0 top-[124px] flex justify-center gap-[4px]">
            {Array.from({ length: 4 }, (_, i) => {
              const l = orbs[i];
              return (
                <span key={i} className={`relative h-[18px] w-[18px] overflow-hidden rounded-full ${i === 1 ? 'ring-[1.5px] ring-white' : 'ring-1 ring-white/30'} bg-white/15`}>
                  {l?.thumb && <img src={l.thumb} alt="" className="h-full w-full object-cover" draggable={false} />}
                </span>
              );
            })}
          </div>
          {/* Mode pill · shutter · more */}
          <div className="absolute left-[6px] top-[165px] flex h-[12px] items-center gap-[2px] rounded-full bg-white/20 px-[2px]">
            <span className="flex h-[9px] w-[9px] items-center justify-center rounded-full" style={{ background: 'var(--sc-accent)' }}><Camera className="h-[5px] w-[5px] text-white" /></span>
            {video && <Video className="h-[5px] w-[5px] text-white/80" />}
            {strip && <Film className="h-[5px] w-[5px] text-white/80" />}
          </div>
          <span className="absolute left-1/2 top-[160px] h-[22px] w-[22px] -translate-x-1/2 rounded-full border-2 border-white/90" style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--sc-accent) 85%, white) 0 55%, transparent 58%)' }} />
          <span className="absolute right-[6px] top-[165px] flex h-[12px] w-[20px] items-center justify-center rounded-full bg-white/20"><LayoutGrid className="h-[6px] w-[6px] text-white" /></span>
        </div>

        {/* The pointer: a ring that glides to each button, with a tap ripple. */}
        <svg viewBox="0 0 320 200" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <motion.rect
            rx={11}
            fill="none"
            stroke="var(--sc-accent)"
            strokeWidth={2.2}
            initial={false}
            animate={{ x: box.x, y: box.y, width: box.w, height: box.h }}
            transition={{ type: 'spring', stiffness: 210, damping: 22 }}
            style={{ filter: 'drop-shadow(0 0 6px var(--sc-accent))' }}
          />
          <motion.circle
            key={`ripple-${active}`}
            cx={box.x + box.w / 2}
            cy={box.y + box.h / 2}
            fill="white"
            initial={{ r: 2, opacity: 0.9 }}
            animate={{ r: 14, opacity: 0 }}
            transition={{ duration: 0.9, delay: 0.35, ease: 'easeOut' }}
          />
          <motion.path
            key={`line-${active}`}
            d={`M ${x1} ${y1} C ${x1 + 22} ${y1}, ${x2 - 22} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke="var(--sc-accent)"
            strokeWidth={1.6}
            strokeDasharray="3 3"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.9 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          />
        </svg>

        {/* The labels */}
        {items.map((it, i) => {
          const on = i === active;
          return (
            <motion.div
              key={it.id}
              className="absolute left-[146px] flex h-[34px] -translate-y-1/2 items-center gap-2 rounded-full pl-1.5 pr-3"
              style={{ top: rowY(i) }}
              animate={{
                x: on ? 4 : 0,
                backgroundColor: on ? 'color-mix(in srgb, var(--sc-accent) 30%, transparent)' : 'rgba(255,255,255,0)',
              }}
              transition={{ duration: 0.25 }}
            >
              <span className={`flex h-[26px] w-[26px] items-center justify-center rounded-full ${on ? 'sc-cta' : 'sc-chip'}`}>
                <it.Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className={`whitespace-nowrap font-sans text-[13px] font-semibold ${on ? 'sc-ink' : 'sc-faint'}`}>{it.label}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default function IntroArt({ art }: { art: Art }) {
  switch (art.kind) {
    case 'beamy': return <BeamyArt pose={art.pose} />;
    case 'controls': return <ControlsArt {...art} />;
    case 'looks': return <LooksArt looks={art.looks} />;
    case 'world': return <WorldArt frame={art.frame} />;
    case 'challenges': return <CutoutArt src={trophy} badge={String(art.count)} />;
    case 'wall': return <CutoutArt src={wallCube} />;
    case 'image': return <ImageArt url={art.url} />;
  }
}
