/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FrameShowcase — the Landing hero's focal visual: a row of glowing vertical
 * glass frames, one per Beamwall pillar, each tinted its own hue from the
 * platform's beam spectrum (mirrors SpectrumField's palette). Frames beam in
 * on mount, staggered left to right, using the same settle easing as the
 * booth's other premium entrances (see Welcome.tsx / BeamIn.tsx).
 *
 * Five frames on desktop; on mobile only the first three render so each one
 * is large and impactful instead of seven slivers. A frame shows either a
 * photographic fill, a transparent cutout floating over a tinted glow, or a
 * bespoke gradient icon (BeamIcons) when no image is set.
 */
import { useState, type ComponentType } from 'react';
import { motion } from 'motion/react';
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
}

export const SHOWCASE_FRAMES: ShowcaseFrame[] = [
  { id: 'booth', label: 'AR Booth', caption: 'Immersive photo booth', hue: '#5B8CFF', rgb: '91, 140, 255', Icon: BoothIcon, image: HERO_BOOTH_PORTRAIT },
  { id: 'wall', label: 'Live Wall', caption: 'Photos beam in live', hue: '#22D3EE', rgb: '34, 211, 238', Icon: WallIcon, image: WALL_SCENE },
  { id: 'cards', label: 'Cards', caption: 'Keepsakes & guestbook', hue: '#E879F9', rgb: '232, 121, 249', Icon: CardIcon, cutout: CARD_CUTOUT },
  { id: 'challenges', label: 'Challenges', caption: 'Get the room playing', hue: '#FB923C', rgb: '251, 146, 60', Icon: ChallengeIcon, cutout: TROPHY_CUTOUT, desktopOnly: true },
  { id: 'studio', label: 'AI Studio', caption: 'Custom frames & effects', hue: '#7C6CF7', rgb: '124, 108, 247', Icon: StudioIcon, desktopOnly: true },
];

function FrameCard({ frame, index }: { frame: ShowcaseFrame; index: number }) {
  const { label, caption, hue, rgb, Icon, image, cutout, desktopOnly } = frame;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(image) && !imageFailed;
  const showCutout = Boolean(cutout) && !imageFailed;
  return (
    <motion.div
      className={`${desktopOnly ? 'hidden sm:flex' : 'flex'} min-w-0 flex-col items-center gap-3.5`}
      initial={{ opacity: 0, y: -70, scaleY: 0.55, filter: 'brightness(2.2) blur(6px)' }}
      animate={{ opacity: 1, y: 0, scaleY: 1, filter: 'brightness(1) blur(0px)' }}
      transition={{ duration: 0.9, delay: 0.15 + index * 0.13, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl sm:rounded-3xl"
        style={{
          border: `1px solid rgba(${rgb}, 0.55)`,
          boxShadow: `0 0 34px -6px rgba(${rgb}, 0.55), 0 0 80px -18px rgba(${rgb}, 0.4), inset 0 0 46px -10px rgba(${rgb}, 0.35)`,
          background: showImage
            ? undefined
            : `radial-gradient(120% 90% at 50% 24%, rgba(${rgb}, 0.30), transparent 66%), rgba(6, 7, 13, 0.72)`,
        }}
      >
        {showImage ? (
          <img src={image} alt="" aria-hidden className="h-full w-full object-cover" onError={() => setImageFailed(true)} />
        ) : showCutout ? (
          <div className="absolute inset-0 flex items-end justify-center p-2">
            <img
              src={cutout}
              alt=""
              aria-hidden
              className="max-h-[82%] w-auto object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
              onError={() => setImageFailed(true)}
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon size={44} from={hue} to={hue} />
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
      <div className="flex w-full min-w-0 flex-col items-center gap-1 text-center">
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
    </motion.div>
  );
}

export default function FrameShowcase({ className = '' }: { className?: string }) {
  return (
    <div className={`grid grid-cols-3 gap-3.5 sm:grid-cols-5 sm:gap-5 ${className}`}>
      {SHOWCASE_FRAMES.map((frame, i) => (
        <FrameCard key={frame.id} frame={frame} index={i} />
      ))}
    </div>
  );
}
