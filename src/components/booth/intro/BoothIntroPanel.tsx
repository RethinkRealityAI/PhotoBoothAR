/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The booth intro's content — Beamy showing a guest around, in the event's
 * colours, inside the drawer guests already know (ResponsiveSheet). The booth
 * and the host wizard's preview both render THIS component, so what a host
 * sees while editing is exactly what a guest gets.
 *
 * Steps come from lib/boothIntro (only the features the event has). Swipe,
 * arrow keys, the progress segments, Back/Next and Skip all work; Skip, the
 * last step's button, Escape and the scrim (the sheet's) all finish it.
 */
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { IntroStep } from '../../../lib/boothIntro';
import IntroArt, { beamyGreet } from './IntroArt';

export interface BoothIntroPanelProps {
  steps: readonly IntroStep[];
  eventName: string;
  /** The event's emblem / logo, beside its name. */
  emblem: ReactNode;
  /** The event's accent (scene accent, or the platform accent). */
  accent: string;
  /** Controlled step (the wizard preview follows the host's chosen step). */
  index?: number;
  onIndex?: (i: number) => void;
  onDone: () => void;
}

export default function BoothIntroPanel({ steps, eventName, emblem, accent, index, onIndex, onDone }: BoothIntroPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const [own, setOwn] = useState(0);
  const [dir, setDir] = useState(1);
  const last = Math.max(0, steps.length - 1);
  const at = Math.min(index ?? own, last);
  const isLast = at === last;
  const current = steps[at];

  const go = (to: number) => {
    const next = Math.max(0, Math.min(last, to));
    setDir(next >= at ? 1 : -1);
    if (onIndex) onIndex(next);
    else setOwn(next);
  };
  const advance = () => (isLast ? onDone() : go(at + 1));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); advance(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
  };
  if (!current) return null;
  const slide = reduced ? 0 : 36;
  const vars = {
    '--sc-accent': accent,
    // The CTA keeps the frosted brand pill, glowing in the event's colour.
    '--sc-cta-glow': `color-mix(in srgb, ${accent} 70%, transparent)`,
  } as CSSProperties;
  const isBeamy = current.art.kind === 'beamy' && current.id === 'welcome';

  return (
    <div style={vars} className="px-5 pb-5 pt-1 sm:px-8 sm:pb-7 sm:pt-6" onKeyDown={onKeyDown}>
      {/* Event header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0">{emblem}</span>
          <span className="truncate font-sans text-[14px] font-semibold sc-ink">{eventName}</span>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="sc-chip pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 font-sans text-[13px] font-medium"
        >
          Skip
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="relative mt-3 overflow-hidden" aria-live="polite">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={current.id}
            custom={dir}
            initial={{ x: dir * slide, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -dir * slide, opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            drag={reduced ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.x < -60) advance();
              else if (info.offset.x > 60) go(at - 1);
            }}
            className="flex touch-pan-y flex-col"
          >
            {/* The stage: a glass window with a glimmering rim, the step's picture inside. */}
            <div
              className="relative h-[224px] overflow-hidden rounded-[26px]"
              style={{
                background: `radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, ${accent} 30%, transparent), transparent 70%), var(--sc-glass)`,
                boxShadow: 'inset 0 1px 0 var(--sc-rim), inset 0 0 0 1px var(--sc-hair)',
              }}
            >
              <IntroArt art={current.art} />
              <span className="sc-rim" aria-hidden><span /></span>
            </div>

            {/* Beamy leads every step: his face beside the step's label. */}
            <div className="mt-4 flex items-center gap-2">
              {!isBeamy && <img src={beamyGreet} alt="" aria-hidden className="h-7 w-7 shrink-0 object-contain" draggable={false} />}
              <p className="font-sans text-[12.5px] font-semibold" style={{ color: `color-mix(in srgb, ${accent} 80%, var(--sc-ink))` }}>
                {current.eyebrow}
              </p>
            </div>
            <h2 className="sc-display mt-1 text-[26px] font-semibold leading-[1.1] sc-ink">{current.title}</h2>
            <p className="mt-2 min-h-[3em] font-sans text-[15px] leading-relaxed sc-muted">{current.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress + actions */}
      <div className="mt-4 flex items-center gap-3">
        {at > 0 && (
          <button
            type="button"
            onClick={() => go(at - 1)}
            aria-label="Previous step"
            className="sc-chip pressable flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={advance}
          className="sc-cta pressable flex min-h-14 flex-1 items-center justify-center gap-2 rounded-full px-6 font-sans text-[16px] font-semibold"
        >
          {isLast ? 'Start taking photos' : (
            <>
              Next
              <ChevronRight className="h-5 w-5" aria-hidden />
            </>
          )}
        </button>
      </div>
      {steps.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5" aria-label={`Step ${at + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => go(i)}
              aria-label={`Go to step ${i + 1}`}
              aria-current={i === at ? 'step' : undefined}
              className="flex h-6 items-center px-0.5"
            >
              <span
                className="block h-1.5 rounded-full transition-all duration-300"
                style={{ width: i === at ? 22 : 7, background: i === at ? accent : 'var(--sc-hair)', opacity: i < at ? 0.6 : 1 }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
