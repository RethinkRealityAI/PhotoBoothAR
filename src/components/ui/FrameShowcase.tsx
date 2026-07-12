/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FrameShowcase — the Landing hero's focal visual: a perspective ARC of tall
 * glowing glass frames standing on a reflective floor, tinted per hue from
 * the beam spectrum. Unlike the old version (one slot per app pillar), every
 * slot now shows a REAL frame design pulled straight from the platform's own
 * events — Detola & Wuyi's wedding gold, SCAGO's Hope Gala black-tie border
 * and Jenna & Jake's festival neon — the same border SVGs (src/lib/borders.ts)
 * and compositing technique (toDataUrl over a tinted glow) TemplatePreview
 * uses elsewhere on this page. A 6-item pool auto-rotates through the 5
 * visible slots and can be swiped; each slot's own beam-in entrance plays
 * once on mount, while its frame content crossfades independently.
 *
 * Side frames angle inward (CSS rotateY under a shared perspective), soft
 * light beams radiate upward from each frame, and a flipped, masked copy
 * below renders the floor reflection — the "beam wall" made literal.
 * Clicking a frame opens an info modal (portalled to <body>). On mobile only
 * the middle three slots render, large, inside a viewport-clamped wrapper so
 * the arc reads as rising up from the bottom of the screen instead of
 * spilling past the fold.
 */
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { BoothIcon, WallIcon, ChallengeIcon, CardIcon, StudioIcon, type BeamIconProps } from './BeamIcons';
import { BORDER_MAP, toDataUrl } from '../../lib/borders';

export interface ShowcaseFrame {
  id: string;
  /** The real event this frame design comes from. */
  event: string;
  label: string;
  caption: string;
  hue: string;
  /** "r, g, b" triplet matching `hue`, for rgba() glows. */
  rgb: string;
  Icon: ComponentType<BeamIconProps>;
  /** Built-in border id (src/lib/borders.ts) — the actual frame SVG. */
  borderId: string;
  /** Modal copy. */
  blurb: string;
  bullets: string[];
}

/** The rotating pool — 5 slots show a moving window of this array so the arc
 *  cycles through real designs from all three events. */
export const FRAME_POOL: ShowcaseFrame[] = [
  {
    id: 'dw-monogram',
    event: 'Detola & Wuyi',
    label: 'Detola & Wuyi',
    caption: 'Wedding · monogram frame',
    hue: '#D4AF37',
    rgb: '212, 175, 55',
    Icon: BoothIcon,
    borderId: 'dw-frame-monogram',
    blurb:
      'A real wedding frame from the Beamwall platform — Detola & Wuyi’s monogram border in gold on a deep black-green wash, their names and date baked right in.',
    bullets: ['Couple’s monogram + date, baked in', 'Deep green & gold wedding palette', 'One tap to apply at your own event'],
  },
  {
    id: 'hope-classic',
    event: 'Hope Gala',
    label: 'Hope Gala',
    caption: 'Black-tie · SCAGO 2026',
    hue: '#D4AF37',
    rgb: '212, 175, 55',
    Icon: ChallengeIcon,
    borderId: 'frame-classic',
    blurb:
      'SCAGO’s Hope Gala & Awards frame — a full gold border with the gala’s crest and lettering, straight from a real black-tie fundraiser.',
    bullets: ['Full gold border + gala crest', 'Baked-in event name & year', 'Built for a black-tie photo wall'],
  },
  {
    id: 'jj-neon',
    event: 'Jenna & Jake',
    label: 'Jenna & Jake',
    caption: 'Festival wedding · neon tubes',
    hue: '#FF2D9B',
    rgb: '255, 45, 155',
    Icon: WallIcon,
    borderId: 'jj-neon-frame',
    blurb:
      'An EDM-festival wedding’s neon border — magenta and cyan light tubes glowing straight off the dance floor.',
    bullets: ['Dual-tone neon tube border', 'Magenta + cyan glow', 'Matches a festival light show'],
  },
  {
    id: 'dw-corners',
    event: 'Detola & Wuyi',
    label: 'Detola & Wuyi',
    caption: 'Wedding · gold corners',
    hue: '#EACB6E',
    rgb: '234, 203, 110',
    Icon: CardIcon,
    borderId: 'dw-corners',
    blurb:
      'The same wedding’s minimal corner treatment — elegant gold flourishes that frame the photo without crowding it.',
    bullets: ['Neutral corners, no baked text', 'Layers over any photo or video', 'Pairs with the champagne-sparkle effect'],
  },
  {
    id: 'hope-crown',
    event: 'Hope Gala',
    label: 'Hope Gala',
    caption: 'Black-tie · crown sticker',
    hue: '#E8C766',
    rgb: '232, 199, 102',
    Icon: StudioIcon,
    borderId: 'sticker-crown',
    blurb:
      'A playful add-on from the same gala — a jeweled crown sticker guests loved stacking on top of the classic frame.',
    bullets: ['Jeweled crown overlay', 'Stacks on top of any frame', 'A guest favorite from the night'],
  },
  {
    id: 'jj-lower-third',
    event: 'Jenna & Jake',
    label: 'Jenna & Jake',
    caption: 'Festival wedding · holographic type',
    hue: '#19E3FF',
    rgb: '25, 227, 255',
    Icon: BoothIcon,
    borderId: 'jj-lower-third',
    blurb:
      'The same wedding’s lower-third — a holographic gradient banner that stamps the couple’s names across every shot.',
    bullets: ['Holographic couple lettering', 'Baked-in lower-third banner', 'Built for a high-energy dance floor'],
  },
];

const SLOT_COUNT = 5;
/** Auto-advance interval — generous enough to read a design before it moves on. */
const ROTATE_MS = 4200;
/** Horizontal drag distance (px) that counts as a swipe. */
const SWIPE_THRESHOLD = 40;

/** Arc geometry per slot offset from center (-2 … 2). */
function arcStyle(offset: number): { rotateY: number; z: number; lift: number } {
  const abs = Math.abs(offset);
  return {
    rotateY: offset * -11, // side frames angle inward toward the center
    z: -abs * 46, // and recede slightly for depth
    lift: abs * 10, // outer frames sit a touch higher off the floor line
  };
}

/** Width per slot — center largest, tapering outward; bigger than v1. */
const SLOT_WIDTH = ['w-40 sm:w-44', 'w-44 sm:w-52', 'w-52 sm:w-64', 'w-44 sm:w-52', 'w-40 sm:w-44'];

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}

/** The glass panel itself — the real border SVG composited over a tinted
 *  glow (same technique as TemplatePreview). Crossfades on rotation/swipe;
 *  rendered twice per slot (frame + flipped reflection). */
function FrameVisual({ frame }: { frame: ShowcaseFrame }) {
  const { rgb, borderId } = frame;
  const border = BORDER_MAP[borderId];
  const frameUrl = border ? toDataUrl(border.svg) : null;
  return (
    <div className="relative aspect-[5/8] w-full overflow-hidden rounded-2xl sm:rounded-3xl">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={frame.id}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          style={{
            border: `1px solid rgba(${rgb}, 0.55)`,
            boxShadow: `0 0 34px -6px rgba(${rgb}, 0.55), 0 0 90px -16px rgba(${rgb}, 0.4), inset 0 0 50px -10px rgba(${rgb}, 0.35)`,
            background: `radial-gradient(120% 90% at 50% 24%, rgba(${rgb}, 0.30), transparent 66%), rgba(6, 7, 13, 0.72)`,
            borderRadius: 'inherit',
          }}
        >
          {/* soft ambient "guest" glow so the frame doesn't read empty */}
          <div
            className="absolute left-1/2 top-[38%] h-[46%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: 'radial-gradient(circle at 50% 38%, rgba(255,255,255,0.14), rgba(255,255,255,0.02) 68%)' }}
          />
          {frameUrl && <img src={frameUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full" />}
          {/* glass sheen + grounding gradient */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(168deg, rgba(255,255,255,0.10), transparent 30%)' }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
            style={{ background: 'linear-gradient(to top, rgba(4,5,10,0.85), transparent)' }}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ArcFrame({
  frame,
  index,
  isMobile,
  onOpen,
}: {
  frame: ShowcaseFrame;
  index: number;
  isMobile: boolean;
  onOpen: (frame: ShowcaseFrame) => void;
}) {
  const { label, caption, hue, rgb } = frame;
  // Only the middle three slots show on mobile — driven by SLOT POSITION so
  // it holds steady as the pool rotates through different frame content.
  const desktopOnly = index === 0 || index === 4;
  const { rotateY, z, lift } = arcStyle(index - 2);
  return (
    <motion.div
      className={`${desktopOnly ? 'hidden sm:block' : ''} ${SLOT_WIDTH[index]} shrink-0`}
      style={{ transform: `translateY(-${lift}px) rotateY(${rotateY}deg) translateZ(${z}px)`, transformStyle: 'preserve-3d' }}
      initial={{ opacity: 0, y: isMobile ? 120 : -80, scaleY: 0.5, filter: 'brightness(2.4) blur(8px)' }}
      animate={{ opacity: 1, y: 0, scaleY: 1, filter: 'brightness(1) blur(0px)' }}
      transition={{ duration: 1, delay: 0.25 + index * 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* light beaming up from the frame into the sky — subtle */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-full left-1/2 h-36 w-[42%] -translate-x-1/2 opacity-50 blur-md sm:h-48"
        style={{ background: `linear-gradient(to top, rgba(${rgb}, 0.4), rgba(${rgb}, 0.08) 55%, transparent)` }}
      />

      <button
        type="button"
        onClick={() => onOpen(frame)}
        aria-label={`About the ${label} frame`}
        className="group block w-full cursor-pointer rounded-2xl text-left transition-transform duration-300 hover:scale-[1.03] focus-visible:scale-[1.03] focus-visible:outline-none sm:rounded-3xl"
      >
        <FrameVisual frame={frame} />
        <div className="mt-3 flex w-full min-w-0 flex-col items-center gap-1 text-center">
          <span
            className="w-full break-words font-label uppercase tracking-wide text-[10px] font-semibold leading-tight sm:tracking-luxe sm:text-[11px]"
            style={{ color: hue }}
          >
            {label}
          </span>
          <span className="w-full break-words font-sans text-[10.5px] leading-snug text-brand-muted/60 sm:text-[11.5px]">
            {caption}
          </span>
        </div>
      </button>

      {/* floor reflection — flipped copy, masked away and softened */}
      <div
        aria-hidden
        className="pointer-events-none mt-1 h-20 overflow-hidden opacity-45 blur-[2px] sm:h-28"
        style={{
          transform: 'scaleY(-1)',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent 78%)',
          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent 78%)',
        }}
      >
        <FrameVisual frame={frame} />
      </div>
    </motion.div>
  );
}

/* ── Info modal ─────────────────────────────────────────────────────── */

function FrameModal({ frame, onClose }: { frame: ShowcaseFrame; onClose: () => void }) {
  const { event, label, caption, hue, rgb, Icon, blurb, bullets } = frame;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="liquid-glass relative w-full max-w-md rounded-3xl px-7 py-8 text-left"
        style={{
          border: `1px solid rgba(${rgb}, 0.4)`,
          boxShadow: `0 0 60px -12px rgba(${rgb}, 0.45), 0 30px 80px -20px rgba(0,0,0,0.8)`,
        }}
        initial={{ opacity: 0, y: 26, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.96 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/[0.05] p-2 text-brand-muted/70 transition hover:text-brand-fg"
        >
          <X className="h-4 w-4" />
        </button>

        <div
          className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            background: `linear-gradient(140deg, rgba(${rgb}, 0.18), rgba(${rgb}, 0.05))`,
            border: `1px solid rgba(${rgb}, 0.35)`,
          }}
        >
          <Icon size={26} from={hue} to={hue} />
        </div>
        <p className="font-label uppercase tracking-luxe text-[10px]" style={{ color: hue }}>
          {event} · {caption}
        </p>
        <h3 className="mt-2 font-display text-3xl text-brand-fg">{label}</h3>
        <p className="mt-3 text-sm leading-relaxed text-brand-muted/80">{blurb}</p>
        <ul className="mt-5 flex flex-col gap-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm text-brand-fg/90">
              <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: hue }} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <Link
          to="/signup"
          className="mt-7 block rounded-full bg-foil px-6 py-3.5 text-center font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98]"
        >
          Create your event
        </Link>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/* ── The arc ────────────────────────────────────────────────────────── */

export default function FrameShowcase({ className = '' }: { className?: string }): ReactNode {
  const [openFrame, setOpenFrame] = useState<ShowcaseFrame | null>(null);
  const [rotation, setRotation] = useState(0);
  const isMobile = useIsMobile();
  const reduced = useReducedMotion() ?? false;
  const dragStartX = useRef<number | null>(null);

  const shift = useCallback((dir: 1 | -1) => {
    setRotation((r) => (r + dir + FRAME_POOL.length) % FRAME_POOL.length);
  }, []);

  // Auto-advance the carousel; pauses under reduced motion and while the
  // info modal is open (a background rotation mid-read is disorienting).
  useEffect(() => {
    if (reduced || openFrame) return;
    const t = window.setInterval(() => shift(1), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [reduced, openFrame, shift]);

  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => FRAME_POOL[(rotation + i) % FRAME_POOL.length]);

  return (
    <div
      className={`relative ${isMobile ? 'max-h-[70vh] overflow-hidden' : ''} ${className}`}
      onPointerDown={(e) => { dragStartX.current = e.clientX; }}
      onPointerUp={(e) => {
        const startX = dragStartX.current;
        dragStartX.current = null;
        if (startX === null) return;
        const dx = e.clientX - startX;
        if (Math.abs(dx) > SWIPE_THRESHOLD) shift(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => { dragStartX.current = null; }}
    >
      {/* floor glow the frames stand on */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[8%] bottom-14 h-24 rounded-[100%] blur-3xl sm:bottom-20"
        style={{ background: 'linear-gradient(90deg, rgba(91,140,255,0.14), rgba(34,211,238,0.16), rgba(232,121,249,0.14))' }}
      />
      <div
        className="flex items-end justify-center gap-3 sm:gap-5"
        style={{ perspective: '1400px' }}
      >
        {slots.map((frame, i) => (
          <ArcFrame key={i} frame={frame} index={i} isMobile={isMobile} onOpen={setOpenFrame} />
        ))}
      </div>

      {/* rotation dots — a quiet hint that this cycles and can be swiped */}
      <div className="mt-4 flex items-center justify-center gap-1.5" aria-hidden>
        {FRAME_POOL.map((f, i) => (
          <span
            key={f.id}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{ width: i === rotation ? 18 : 6, background: i === rotation ? f.hue : 'rgba(255,255,255,0.18)' }}
          />
        ))}
      </div>

      <AnimatePresence>
        {openFrame && <FrameModal frame={openFrame} onClose={() => setOpenFrame(null)} />}
      </AnimatePresence>
    </div>
  );
}
