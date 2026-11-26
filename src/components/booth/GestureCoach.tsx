/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Try this" — the pop-up a guest sees when they pick a Look that reacts to a
 * face expression or a hand gesture. Copy comes from lib/gestureCoach.ts.
 *
 * DOM only, above the stage: StageCanvas composites the photo and the clip
 * from its own canvas, so this card can never appear in a capture.
 */
import { useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Hand, Sparkles, X } from 'lucide-react';
import { COACH_VISIBLE_MS, type GestureCoach as Coach } from '../../lib/gestureCoach';

interface Props {
  coach: Coach | null;
  open: boolean;
  onClose: () => void;
}

export default function GestureCoach({ coach, open, onClose }: Props) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open || !coach) return;
    const t = window.setTimeout(onClose, COACH_VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [open, coach, onClose]);

  return (
    <AnimatePresence>
      {open && coach && (
        <motion.div
          key={coach.key}
          role="status"
          aria-live="polite"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          // Not a stage tap (a double tap on the stage flips the camera).
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          className="pointer-events-auto absolute inset-x-0 top-[16%] z-30 mx-auto w-[min(88%,320px)]"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={`${coach.title}. Tap to close.`}
            className="liquid-glass-raised relative block w-full overflow-hidden rounded-3xl px-4 pb-4 pt-3.5 text-left shadow-[0_18px_50px_-18px_rgba(0,0,0,0.6)]"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20">
                <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
              </span>
              <span className="flex-1 font-label text-[11px] uppercase tracking-[0.14em] text-brand-fg/85">
                {coach.title}
              </span>
              <X className="h-4 w-4 text-brand-fg/50" aria-hidden />
            </span>
            <span className="mt-3 flex flex-col gap-2.5">
              {coach.steps.map((s, i) => (
                <span key={s.source} className="flex items-center gap-3">
                  <motion.span
                    aria-hidden
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[28px] leading-none ring-1 ring-white/15"
                    initial={reduce ? false : { scale: 0.4, rotate: -12, opacity: 0 }}
                    animate={reduce
                      ? { opacity: 1 }
                      : { scale: [0.4, 1.12, 1], rotate: [-12, 6, 0], opacity: 1, y: [0, 0, -2, 0, 2, 0] }}
                    transition={reduce ? { duration: 0.2 } : { duration: 1.4, delay: 0.08 + i * 0.12, times: [0, 0.3, 0.45, 0.65, 0.85, 1] }}
                  >
                    {s.glyph}
                  </motion.span>
                  <span className="min-w-0">
                    <span className="block font-sans text-[15px] font-semibold leading-tight text-brand-fg">{s.doThis}</span>
                    <span className="mt-0.5 block font-sans text-[13px] leading-snug text-brand-fg/70">{s.result}</span>
                  </span>
                </span>
              ))}
            </span>
            {coach.needsHand && (
              <span className="mt-3 flex items-center gap-1.5 font-sans text-[11px] text-brand-fg/60">
                <Hand className="h-3.5 w-3.5" aria-hidden /> Hold your hand up where the camera can see it
              </span>
            )}
            {/* Time left — the card closes itself; this says when. */}
            <motion.span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-accent/70"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: COACH_VISIBLE_MS / 1000, ease: 'linear' }}
            />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small side-rail chip that brings the card back after it closes. */
export function GestureCoachChip({ coach, onOpen }: { coach: Coach; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Show which gestures this Look reacts to"
      className="pressable liquid-glass-raised flex h-11 w-11 items-center justify-center rounded-full text-[20px] leading-none"
    >
      <span aria-hidden>{coach.steps[0]?.glyph ?? '✨'}</span>
    </button>
  );
}
