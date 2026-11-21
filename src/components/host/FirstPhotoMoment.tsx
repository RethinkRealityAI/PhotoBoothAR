/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The host's "it works!" moment: the first guest photo of a live event lands
 * while the dashboard is open, and this card rises with the photo itself, a
 * small confetti pop and a link straight to the live wall. Shown once per
 * event (the page stops watching an event as soon as it has a photo).
 *
 * Sits above the assistant button on a phone so it never covers it, and is a
 * polite live region so a screen reader hears the news without losing focus.
 */
import { useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, PartyPopper, Play } from 'lucide-react';
import PostImage from '../ui/PostImage';

export interface FirstPhotoMomentProps {
  eventName: string;
  slug: string;
  imageUrl: string;
  mediaType: string | null | undefined;
  guestName: string | null | undefined;
  onClose: () => void;
}

const COLOURS = ['#FFD27A', '#FF9FB8', '#9FD8FF', '#C9B6FF', '#FFFFFF'];
const PIECES = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2;
  const reach = 60 + (i % 3) * 26;
  return {
    x: Math.cos(angle) * reach,
    y: Math.sin(angle) * reach - 20,
    rotate: (i % 2 === 0 ? 1 : -1) * (140 + i * 14),
    colour: COLOURS[i % COLOURS.length],
    round: i % 3 === 0,
    delay: 0.25 + (i % 4) * 0.03,
  };
});

export default function FirstPhotoMoment({ eventName, slug, imageUrl, mediaType, guestName, onClose }: FirstPhotoMomentProps) {
  const reduceMotion = useReducedMotion();
  const isVideo = mediaType === 'video';
  const who = guestName?.trim();

  // A short tap on phones that support it; silently nothing elsewhere.
  useEffect(() => {
    try { navigator.vibrate?.([18, 60, 28]); } catch { /* unsupported */ }
  }, []);

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.96 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 22 }}
      className="fixed z-[75] inset-x-4 bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+4.75rem)] sm:inset-x-auto sm:right-6 sm:bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+4.75rem)] sm:w-[400px]"
    >
      <div className="liquid-glass rounded-[28px] p-4 flex gap-4 items-center shadow-[0_18px_60px_rgba(10,8,40,0.45)]">
        <div className="relative shrink-0">
          <div className="h-24 w-[72px] rounded-2xl overflow-hidden bg-white/10 ring-2 ring-white/70">
            {isVideo ? (
              <div className="h-full w-full grid place-items-center"><Play className="h-6 w-6" aria-hidden /></div>
            ) : (
              <PostImage src={imageUrl} alt="" displayWidth={96} eager className="h-full w-full object-cover" />
            )}
          </div>
          {!reduceMotion && (
            <span aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">
              {PIECES.map((p, i) => (
                <motion.span
                  key={i}
                  className={`absolute left-1/2 top-1/2 block ${p.round ? 'h-2 w-2 rounded-full' : 'h-2.5 w-1.5 rounded-[2px]'}`}
                  style={{ background: p.colour }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
                  animate={{ x: p.x, y: [0, p.y, p.y + 50], opacity: [1, 1, 0], scale: 1, rotate: p.rotate }}
                  transition={{ duration: 1.3, delay: p.delay, ease: 'easeOut' }}
                />
              ))}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#FFD9B8]">
            <PartyPopper className="h-3.5 w-3.5" aria-hidden /> First photo
          </p>
          <p className="mt-0.5 text-[16px] font-semibold leading-snug">Your first guest photo just landed</p>
          <p className="mt-0.5 text-[13px] text-white/80 truncate">{who ? `From ${who} · ` : ''}{eventName}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={`/e/${slug}/wall`}
              target="_blank"
              rel="noreferrer"
              className="pressable bg-foil inline-flex items-center gap-1.5 rounded-full px-4 min-h-11 text-[14px] font-semibold"
            >
              See it on the wall <ArrowUpRight className="h-4 w-4" aria-hidden />
            </a>
            <button type="button" onClick={onClose} className="rounded-full px-4 min-h-11 text-[14px] hover:bg-white/10">
              Nice!
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
