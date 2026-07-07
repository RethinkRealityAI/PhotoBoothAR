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
 * A frame either shows a photographic image (the AR-glasses portrait, the
 * beam-wall venue shot) or a soft icon-on-gradient card when no image is set.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { Camera, Rows3, Video, Sparkles, LayoutTemplate, Wand2 } from 'lucide-react';

export interface ShowcaseFrame {
  id: string;
  label: string;
  hue: string;
  /** "r, g, b" triplet matching `hue`, for rgba() glows. */
  rgb: string;
  Icon?: LucideIcon;
  image?: string;
  /** Small caption under the label; omit for the trailing "coming soon" card. */
  caption?: string;
}

// NOTE: these two point at Higgsfield's generation CDN rather than a
// repo-local asset — this sandbox's egress policy blocked downloading the
// bytes in (d8j0ntlcm91z4.cloudfront.net was denied by the proxy). Swap for
// `import ... from './landing/*.png'` once the files can be pulled in.
const BOOTH_IMAGE =
  'https://d8j0ntlcm91z4.cloudfront.net/user_33Txeg6YsaHeKOwmprAOf8Wr55B/hf_20260707_041724_7bedd98a-8eb8-4bc2-bf02-7fea18093449.png';
const WALL_IMAGE =
  'https://d8j0ntlcm91z4.cloudfront.net/user_33Txeg6YsaHeKOwmprAOf8Wr55B/hf_20260707_041725_a17613f5-4843-4613-a2a9-e8cdb0c2f74e.png';

export const SHOWCASE_FRAMES: ShowcaseFrame[] = [
  { id: 'booth', label: 'Booth', hue: '#5B8CFF', rgb: '91, 140, 255', Icon: Camera, image: BOOTH_IMAGE, caption: 'AR photo booth' },
  { id: 'wall', label: 'Wall', hue: '#22D3EE', rgb: '34, 211, 238', Icon: Rows3, image: WALL_IMAGE, caption: 'Live event wall' },
  { id: 'guestbook', label: 'Guestbook', hue: '#FB923C', rgb: '251, 146, 60', Icon: Video, caption: 'Video messages' },
  { id: 'templates', label: 'Templates', hue: '#34D399', rgb: '52, 211, 153', Icon: LayoutTemplate, caption: 'Themed in seconds' },
  { id: 'cards', label: 'Cards', hue: '#E879F9', rgb: '232, 121, 249', Icon: Sparkles, caption: 'Keepsake cards' },
  { id: 'studio', label: 'AI Studio', hue: '#7C6CF7', rgb: '124, 108, 247', Icon: Wand2, caption: 'Custom frames & effects' },
  { id: 'more', label: 'More', hue: '#38BDF8', rgb: '56, 189, 248' },
];

function FrameCard({ frame, index }: { frame: ShowcaseFrame; index: number }) {
  const { label, hue, rgb, Icon, image, caption } = frame;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(image) && !imageFailed;
  return (
    <motion.div
      className="flex flex-col items-center gap-3"
      initial={{ opacity: 0, y: -70, scaleY: 0.55, filter: 'brightness(2.2) blur(6px)' }}
      animate={{ opacity: 1, y: 0, scaleY: 1, filter: 'brightness(1) blur(0px)' }}
      transition={{ duration: 0.9, delay: 0.15 + index * 0.12, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl"
        style={{
          border: `1px solid rgba(${rgb}, 0.55)`,
          boxShadow: `0 0 30px -6px rgba(${rgb}, 0.55), 0 0 70px -20px rgba(${rgb}, 0.4), inset 0 0 40px -10px rgba(${rgb}, 0.35)`,
          background: showImage
            ? undefined
            : `radial-gradient(120% 90% at 50% 20%, rgba(${rgb}, 0.28), transparent 65%), rgba(8, 9, 16, 0.7)`,
        }}
      >
        {showImage ? (
          <img src={image} alt="" aria-hidden className="h-full w-full object-cover" onError={() => setImageFailed(true)} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {Icon ? (
              <Icon className="h-8 w-8 sm:h-10 sm:w-10" style={{ color: hue }} strokeWidth={1.5} />
            ) : (
              <span className="font-label uppercase tracking-luxe text-[9px]" style={{ color: hue }}>
                Coming&nbsp;soon
              </span>
            )}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0" style={{ backdropFilter: 'blur(0.2px)' }} />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
          style={{ background: `linear-gradient(to top, rgba(5,6,11,0.85), transparent)` }}
        />
      </div>
      <div className="flex flex-col items-center gap-0.5 text-center">
        <span className="font-label uppercase tracking-luxe text-[10px] font-semibold" style={{ color: hue }}>
          {label}
        </span>
        {caption && <span className="font-sans text-[11px] text-brand-muted/60">{caption}</span>}
      </div>
    </motion.div>
  );
}

export default function FrameShowcase({ className = '' }: { className?: string }) {
  return (
    <div className={`grid grid-cols-4 gap-3 sm:grid-cols-7 sm:gap-4 ${className}`}>
      {SHOWCASE_FRAMES.map((frame, i) => (
        <FrameCard key={frame.id} frame={frame} index={i} />
      ))}
    </div>
  );
}
