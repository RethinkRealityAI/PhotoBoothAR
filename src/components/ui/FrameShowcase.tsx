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
import boothFeatureVideo from '../../assets/landing/booth-feature.mp4';
import boothFeaturePoster from '../../assets/landing/booth-feature-poster.jpg';
import wallFeatureVideo from '../../assets/landing/wall-feature.mp4';
import wallFeaturePoster from '../../assets/landing/wall-feature-poster.jpg';
import challengesFeatureVideo from '../../assets/landing/challenges-feature.mp4';
import challengesFeaturePoster from '../../assets/landing/challenges-feature-poster.jpg';
import cardsFeatureVideo from '../../assets/landing/cards-feature.mp4';
import cardsFeaturePoster from '../../assets/landing/cards-feature-poster.jpg';

/** The luxe "designed frame" accent — emerald green + foil gold on black,
 *  showcasing what the AI Studio can craft. Used by the studio frame only. */
const LUXE_GREEN = '31, 169, 113';
const LUXE_GOLD = '231, 200, 115';

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
  /** Looping feature footage played inside the frame (managed play/pause). */
  video?: string;
  /** Poster still for `video` (shown before play + in the floor reflection). */
  videoPoster?: string;
  /** Transparent cutout, floated over a tinted glow instead of full-bleed. */
  cutout?: string;
  /** Renders the ornate green/black/gold "designed frame" treatment. */
  luxe?: boolean;
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
    video: challengesFeatureVideo,
    videoPoster: challengesFeaturePoster,
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
    video: boothFeatureVideo,
    videoPoster: boothFeaturePoster,
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
    video: wallFeatureVideo,
    videoPoster: wallFeaturePoster,
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
    video: cardsFeatureVideo,
    videoPoster: cardsFeaturePoster,
    // On mobile we show 3 frames; Cards keeps its own full feature section
    // below, so it yields its hero slot to the green/gold AI Studio frame.
    desktopOnly: true,
    blurb:
      'Guests leave short video messages and sign a collective greeting card — a keepsake you keep forever, with an overnight highlight film on premium plans.',
    bullets: ['Video guestbook messages', 'Collaborative greeting cards', 'Keepsake highlight film'],
  },
  {
    id: 'studio',
    label: 'AI Studio',
    caption: 'Custom frames & effects',
    // Gold label + gold/green ornate border make this the "designed frame".
    // Shown on mobile too (it's the signature visual).
    hue: '#E7C873',
    rgb: LUXE_GOLD,
    Icon: StudioIcon,
    luxe: true,
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

/** Width by absolute distance from centre — center largest, tapering outward.
 *  Keyed on the offset (not array index) so the mobile trio stays a balanced
 *  arc once the desktop-only frames drop out. */
function slotWidth(offset: number): string {
  const abs = Math.abs(offset);
  return abs === 0 ? 'w-52 sm:w-64' : abs === 1 ? 'w-44 sm:w-52' : 'w-40 sm:w-44';
}

/** True below the `sm` breakpoint (640px), where the arc drops its desktop-only
 *  frames to the three that fit. Kept in JS (not just CSS) so the arc geometry
 *  re-centres on the frames actually shown. */
function useIsMobile(): boolean {
  const query = '(max-width: 639px)';
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/** Looping feature footage inside a frame — plays only while ~in view and
 *  pauses offscreen (iOS caps concurrent video pipelines; five hero frames
 *  decoding at once would silently freeze some). Mirrors Landing's FilmEmbed. */
function FrameFilm({ src, poster, onError }: { src: string; poster?: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.play().catch(() => { /* autoplay blocked — poster stays */ });
        else el.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      className="h-full w-full object-cover"
      onError={onError}
      aria-hidden
    />
  );
}

/** The ornate green/black/gold "designed frame" fill — a rotating emerald↔gold
 *  conic sheen leaves a thin jewelled ring around a black interior, with a gold
 *  hairline double-rule and the studio mark. Reflections render it still. */
function LuxeFrameFill({ frame, reflection }: { frame: ShowcaseFrame; reflection: boolean }) {
  const { Icon } = frame;
  return (
    <>
      <div
        className="absolute left-1/2 top-1/2 h-[220%] w-[220%] -translate-x-1/2 -translate-y-1/2"
        style={{
          background: `conic-gradient(from 0deg, rgba(${LUXE_GOLD}, 0.95), rgba(${LUXE_GREEN}, 0.85) 20%, rgba(3,5,9,0.35) 33%, rgba(${LUXE_GOLD}, 0.98) 50%, rgba(${LUXE_GREEN}, 0.85) 68%, rgba(3,5,9,0.35) 82%, rgba(${LUXE_GOLD}, 0.95))`,
          animation: reflection ? 'none' : 'slow-spin 11s linear infinite',
        }}
      />
      {/* black interior leaving a ~3px jewelled ring */}
      <div
        className="absolute inset-[3px] rounded-[inherit]"
        style={{ background: `radial-gradient(120% 90% at 50% 22%, rgba(${LUXE_GREEN}, 0.16), rgba(5,6,11,0.97) 60%)` }}
      />
      {/* gold hairline double-rule */}
      <div className="pointer-events-none absolute inset-[10px] rounded-2xl" style={{ border: `1px solid rgba(${LUXE_GOLD}, 0.4)` }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
        <Icon size={52} from="#E7C873" to="#1FA971" />
        <span className="font-label uppercase tracking-luxe text-[8px]" style={{ color: `rgba(${LUXE_GOLD}, 0.85)` }}>
          Designed for you
        </span>
      </div>
    </>
  );
}

/** The glass panel itself — rendered twice (frame + flipped reflection).
 *  `reflection` swaps the live video for its still poster and stills the luxe
 *  sheen (a second decoding video / spinning gradient beneath is wasteful). */
function FrameVisual({
  frame, failed, onFail, reflection = false,
}: {
  frame: ShowcaseFrame;
  failed: boolean;
  onFail: () => void;
  reflection?: boolean;
}) {
  const { hue, rgb, Icon, image, cutout, video, videoPoster, luxe } = frame;
  // A video that can't decode (e.g. a browser without H.264) falls back to its
  // poster still — a real frame of the footage — never straight to the icon.
  const [videoFailed, setVideoFailed] = useState(false);
  const showVideo = Boolean(video) && !reflection && !failed && !videoFailed;
  const still = image ?? videoPoster; // full-bleed still: reflections + video fallbacks
  const showImage = !luxe && !showVideo && Boolean(still) && !failed;
  const showCutout = !luxe && !showVideo && !showImage && Boolean(cutout) && !failed;
  return (
    <div
      className="relative aspect-[5/8] w-full overflow-hidden rounded-2xl sm:rounded-3xl"
      style={{
        border: `1px solid rgba(${rgb}, 0.55)`,
        boxShadow: `0 0 34px -6px rgba(${rgb}, 0.55), 0 0 90px -16px rgba(${rgb}, 0.4), inset 0 0 50px -10px rgba(${rgb}, 0.35)`,
        background: showImage || showVideo || luxe
          ? undefined
          : `radial-gradient(120% 90% at 50% 24%, rgba(${rgb}, 0.30), transparent 66%), rgba(6, 7, 13, 0.72)`,
      }}
    >
      {luxe ? (
        <LuxeFrameFill frame={frame} reflection={reflection} />
      ) : showVideo ? (
        <FrameFilm src={video!} poster={videoPoster} onError={() => setVideoFailed(true)} />
      ) : showImage ? (
        <img src={still} alt="" aria-hidden className="h-full w-full object-cover" onError={onFail} />
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
  offset,
  delayIndex,
  onOpen,
}: {
  frame: ShowcaseFrame;
  /** Signed distance from the arc centre (drives tilt, depth and width). */
  offset: number;
  /** Position in render order, for the staggered beam-in delay. */
  delayIndex: number;
  onOpen: (frame: ShowcaseFrame) => void;
}) {
  const { label, caption, hue, rgb } = frame;
  const [failed, setFailed] = useState(false);
  const { rotateY, z, lift } = arcStyle(offset);
  return (
    <motion.div
      className={`${slotWidth(offset)} shrink-0`}
      style={{ transform: `translateY(-${lift}px) rotateY(${rotateY}deg) translateZ(${z}px)`, transformStyle: 'preserve-3d' }}
      initial={{ opacity: 0, y: -80, scaleY: 0.5, filter: 'brightness(2.4) blur(8px)' }}
      animate={{ opacity: 1, y: 0, scaleY: 1, filter: 'brightness(1) blur(0px)' }}
      transition={{ duration: 1, delay: 0.25 + delayIndex * 0.16, ease: [0.16, 1, 0.3, 1] }}
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
        <FrameVisual frame={frame} failed={failed} onFail={() => setFailed(true)} reflection />
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
  const isMobile = useIsMobile();
  // Mobile drops the desktop-only frames to the three that fit; the arc then
  // re-centres on those (offsets −1, 0, +1) instead of sampling the desktop
  // five, so the green/gold Studio frame sits as a balanced side panel.
  const frames = SHOWCASE_FRAMES.filter((f) => !f.desktopOnly || !isMobile);
  const center = Math.floor(frames.length / 2);
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
        {frames.map((frame, i) => (
          <ArcFrame key={frame.id} frame={frame} offset={i - center} delayIndex={i} onOpen={setOpenFrame} />
        ))}
      </div>
      <AnimatePresence>
        {openFrame && <FrameModal frame={openFrame} onClose={() => setOpenFrame(null)} />}
      </AnimatePresence>
    </div>
  );
}
