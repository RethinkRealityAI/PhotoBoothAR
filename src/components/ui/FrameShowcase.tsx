/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FrameShowcase — the Landing hero's focal visual: a perspective ARC of tall
 * glowing glass frames standing on a reflective floor, one per Beamwall
 * pillar, each tinted its own hue from the beam spectrum (mirrors
 * SpectrumField's palette). Side frames angle inward (CSS rotateY under a
 * shared perspective), soft light beams radiate upward from each frame, and
 * a flipped, masked copy below renders the floor reflection — the "beam
 * wall" made literal.
 *
 * Frames beam in one at a time, left to right (same settle easing as the
 * booth's premium entrances — see Welcome.tsx / BeamIn.tsx). Clicking a
 * frame opens an info modal about that pillar (portalled to <body> so
 * ancestor parallax transforms can't trap it). On mobile only the middle
 * three render, large; the outer two are desktop-only.
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { BoothIcon, WallIcon, ChallengeIcon, CardIcon, StudioIcon, type BeamIconProps } from './BeamIcons';
import { HERO_BOOTH_PORTRAIT, WALL_SCENE, TROPHY_CUTOUT, CARD_CUTOUT } from '../../lib/landingAssets';

export interface ShowcaseFrame {
  id: string;
  label: string;
  caption: string;
  hue: string;
  /** "r, g, b" triplet matching `hue`, for rgba() glows. */
  rgb: string;
  Icon: ComponentType<BeamIconProps>;
  /** Full-bleed photographic fill. */
  image?: string;
  /** Transparent cutout, floated over a tinted glow instead of full-bleed. */
  cutout?: string;
  /** Hidden below the sm breakpoint so mobile shows 3 big frames. */
  desktopOnly?: boolean;
  /** Modal copy. */
  blurb: string;
  bullets: string[];
}

/** Display order, left → right; index 2 is the arc's center. */
export const SHOWCASE_FRAMES: ShowcaseFrame[] = [
  {
    id: 'challenges',
    label: 'Challenges',
    caption: 'Get the room playing',
    hue: '#FB923C',
    rgb: '251, 146, 60',
    Icon: ChallengeIcon,
    cutout: TROPHY_CUTOUT,
    desktopOnly: true,
    blurb:
      'Set photo challenges — “catch the first dance”, “selfie with a stranger” — and a live leaderboard lights the wall up while guests race to complete them.',
    bullets: ['Custom photo challenges', 'Live leaderboard on the wall', 'Crowd-decided winners'],
  },
  {
    id: 'booth',
    label: 'AR Booth',
    caption: 'Immersive photo booth',
    hue: '#5B8CFF',
    rgb: '91, 140, 255',
    Icon: BoothIcon,
    image: HERO_BOOTH_PORTRAIT,
    blurb:
      'One QR code drops every guest into an AR photo booth in their browser — face-tracked 3D props, live effects and your frames, with zero downloads.',
    bullets: ['Face-tracked 3D props & frames', 'Cinematic live WebGL effects', 'Photo & video, no app needed'],
  },
  {
    id: 'wall',
    label: 'Live Wall',
    caption: 'Photos beam in live',
    hue: '#22D3EE',
    rgb: '34, 211, 238',
    Icon: WallIcon,
    image: WALL_SCENE,
    blurb:
      'Every capture beams onto a cinematic wall the whole room watches — mosaic, slideshow and marquee views, moderated from your phone in one tap.',
    bullets: ['Realtime beam-in animations', 'Mosaic, slideshow & marquee views', 'One-tap moderation'],
  },
  {
    id: 'cards',
    label: 'Cards',
    caption: 'Keepsakes & guestbook',
    hue: '#E879F9',
    rgb: '232, 121, 249',
    Icon: CardIcon,
    cutout: CARD_CUTOUT,
    blurb:
      'Guests leave short video messages and sign a collective greeting card — a keepsake you keep forever, with an overnight highlight film on premium plans.',
    bullets: ['Video guestbook messages', 'Collaborative greeting cards', 'Keepsake highlight film'],
  },
  {
    id: 'studio',
    label: 'AI Studio',
    caption: 'Custom frames & effects',
    hue: '#7C6CF7',
    rgb: '124, 108, 247',
    Icon: StudioIcon,
    desktopOnly: true,
    blurb:
      'Describe a look and the AI studio generates custom frames, stickers and 3D props on brand for your event — then fine-tune everything by hand.',
    bullets: ['AI-generated frames & stickers', 'Custom 3D props', 'Full manual fine-tuning'],
  },
];

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

/** The glass panel itself — rendered twice (frame + flipped reflection). */
function FrameVisual({ frame, failed, onFail }: { frame: ShowcaseFrame; failed: boolean; onFail: () => void }) {
  const { hue, rgb, Icon, image, cutout } = frame;
  const showImage = Boolean(image) && !failed;
  const showCutout = Boolean(cutout) && !failed;
  return (
    <div
      className="relative aspect-[5/8] w-full overflow-hidden rounded-2xl sm:rounded-3xl"
      style={{
        border: `1px solid rgba(${rgb}, 0.55)`,
        boxShadow: `0 0 34px -6px rgba(${rgb}, 0.55), 0 0 90px -16px rgba(${rgb}, 0.4), inset 0 0 50px -10px rgba(${rgb}, 0.35)`,
        background: showImage
          ? undefined
          : `radial-gradient(120% 90% at 50% 24%, rgba(${rgb}, 0.30), transparent 66%), rgba(6, 7, 13, 0.72)`,
      }}
    >
      {showImage ? (
        <img src={image} alt="" aria-hidden className="h-full w-full object-cover" onError={onFail} />
      ) : showCutout ? (
        <div className="absolute inset-0 flex items-end justify-center p-2">
          <img
            src={cutout}
            alt=""
            aria-hidden
            className="max-h-[84%] w-auto object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
            onError={onFail}
          />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon size={48} from={hue} to={hue} />
        </div>
      )}
      {/* glass sheen + grounding gradient */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(168deg, rgba(255,255,255,0.10), transparent 30%)' }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
        style={{ background: 'linear-gradient(to top, rgba(4,5,10,0.85), transparent)' }}
      />
    </div>
  );
}

function ArcFrame({
  frame,
  index,
  onOpen,
}: {
  frame: ShowcaseFrame;
  index: number;
  onOpen: (frame: ShowcaseFrame) => void;
}) {
  const { label, caption, hue, rgb, desktopOnly } = frame;
  const [failed, setFailed] = useState(false);
  const { rotateY, z, lift } = arcStyle(index - 2);
  return (
    <motion.div
      className={`${desktopOnly ? 'hidden sm:block' : ''} ${SLOT_WIDTH[index]} shrink-0`}
      style={{ transform: `translateY(-${lift}px) rotateY(${rotateY}deg) translateZ(${z}px)`, transformStyle: 'preserve-3d' }}
      initial={{ opacity: 0, y: -80, scaleY: 0.5, filter: 'brightness(2.4) blur(8px)' }}
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
        aria-label={`About ${label}`}
        className="group block w-full cursor-pointer rounded-2xl text-left transition-transform duration-300 hover:scale-[1.03] focus-visible:scale-[1.03] focus-visible:outline-none sm:rounded-3xl"
      >
        <FrameVisual frame={frame} failed={failed} onFail={() => setFailed(true)} />
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
        <FrameVisual frame={frame} failed={failed} onFail={() => setFailed(true)} />
      </div>
    </motion.div>
  );
}

/* ── Info modal ─────────────────────────────────────────────────────── */

function FrameModal({ frame, onClose }: { frame: ShowcaseFrame; onClose: () => void }) {
  const { label, caption, hue, rgb, Icon, blurb, bullets } = frame;
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
          {caption}
        </p>
        <h3 className="mt-2 font-serif text-3xl text-brand-fg">{label}</h3>
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
  return (
    <div className={`relative ${className}`}>
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
        {SHOWCASE_FRAMES.map((frame, i) => (
          <ArcFrame key={frame.id} frame={frame} index={i} onOpen={setOpenFrame} />
        ))}
      </div>
      <AnimatePresence>
        {openFrame && <FrameModal frame={openFrame} onClose={() => setOpenFrame(null)} />}
      </AnimatePresence>
    </div>
  );
}
