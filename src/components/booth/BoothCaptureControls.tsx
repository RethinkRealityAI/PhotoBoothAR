/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The booth's capture controls — the Photo · Video · Strip pill and the
 * self-timer — shared by both decks.
 *
 * Extracted VERBATIM from BoothControlDeck so the legacy deck (which keeps
 * them beside the shutter) and the platform deck (pill beside the shutter,
 * timer up in the top bar) render the same control rather than two copies
 * that drift apart. The legacy deck's markup is unchanged by the move.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Camera as CameraIcon, Clock, Film, Video } from 'lucide-react';
import { haptic } from '../../lib/haptics';

export interface CaptureModePillProps {
  mediaMode: 'photo' | 'video';
  onMediaMode: (m: 'photo' | 'video') => void;
  videoAllowed: boolean;
  recording: boolean;
  stripMode: boolean;
  onStripMode?: (on: boolean) => void;
  stripShots?: number;
  onOpenStripPicker?: () => void;
  /** Positioning classes for the pill's wrapper. */
  className: string;
}

/**
 * Capture mode. The icons stay 32px so the cluster fits a 360px phone, but
 * each carries a `-inset-1.5` pseudo-element, so the real TOUCH target is
 * 44px — the accessibility minimum — while the visual stays compact.
 */
export function CaptureModePill({
  mediaMode, onMediaMode, videoAllowed, recording,
  stripMode, onStripMode, stripShots, onOpenStripPicker, className,
}: CaptureModePillProps) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => { if (!recording) { haptic('toggle'); onMediaMode('photo'); onStripMode?.(false); } }}
        disabled={recording}
        aria-label="Photo mode"
        aria-pressed={mediaMode === 'photo' && !stripMode}
        className={`pressable relative flex h-8 w-8 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1.5 after:rounded-full after:content-[''] ${
          mediaMode === 'photo' && !stripMode ? 'is-selected bg-foil text-[color:var(--on-accent)]' : 'text-brand-muted/70'
        }`}
      >
        <CameraIcon className="h-3.5 w-3.5" />
      </button>
      {videoAllowed && (
        <button
          type="button"
          onClick={() => { if (!recording) { haptic('toggle'); onMediaMode('video'); onStripMode?.(false); } }}
          disabled={recording}
          aria-label="Video mode"
          aria-pressed={mediaMode === 'video'}
          className={`pressable relative flex h-8 w-8 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1.5 after:rounded-full after:content-[''] ${
            mediaMode === 'video' ? 'is-selected bg-foil text-[color:var(--on-accent)]' : 'text-brand-muted/70'
          }`}
        >
          <Video className="h-3.5 w-3.5" />
        </button>
      )}
      {onOpenStripPicker && (
        <button
          type="button"
          onClick={() => { if (!recording) { haptic('tap'); onOpenStripPicker(); } }}
          disabled={recording}
          aria-label="Photo strip — choose a layout"
          aria-pressed={mediaMode === 'photo' && stripMode}
          className={`pressable relative flex h-8 w-8 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1.5 after:rounded-full after:content-[''] ${
            mediaMode === 'photo' && stripMode ? 'is-selected bg-foil text-[color:var(--on-accent)]' : 'text-brand-muted/70'
          }`}
        >
          <Film className="h-3.5 w-3.5" />
          {mediaMode === 'photo' && stripMode && stripShots != null && (
            <span
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full font-label text-[8px] font-bold"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--on-accent)',
                boxShadow: '0 0 6px rgba(var(--accent-rgb),0.8)',
              }}
            >
              {stripShots}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

export interface TimerControlProps<T extends number> {
  timerSec: T;
  onTimerSec: (s: T) => void;
  timerOptions: readonly T[];
  /** Positioning classes for the wrapper. */
  className: string;
  /** 'up' = the deck (popover opens above, right-aligned); 'down' = the top
   *  bar (popover opens below, right-aligned). */
  placement?: 'up' | 'down';
  /** The top bar's glass-circle look instead of the deck's inset pill. */
  variant?: 'deck' | 'circle';
}

/** Self-timer button + its option popover, with light dismissal. */
export function TimerControl<T extends number>({
  timerSec, onTimerSec, timerOptions, className, placement = 'up', variant = 'deck',
}: TimerControlProps<T>) {
  const [timerOpen, setTimerOpen] = useState(false);
  /** The open popover sits over the shutter's corner — without light dismissal
   *  it blocked the very control the guest reaches for next. */
  const timerWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!timerOpen) return;
    const onDown = (e: PointerEvent) => {
      if (timerWrapRef.current && e.target instanceof Node && !timerWrapRef.current.contains(e.target)) {
        setTimerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTimerOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [timerOpen]);

  const down = placement === 'down';
  return (
    <div ref={timerWrapRef} className={className}>
      {variant === 'circle' ? (
        <button
          type="button"
          onClick={() => { haptic('tap'); setTimerOpen((o) => !o); }}
          aria-label={timerSec === 0 ? 'Self-timer (off)' : `Self-timer (${timerSec} seconds)`}
          title="Self-timer"
          aria-expanded={timerOpen}
          className="pressable liquid-glass-raised relative flex h-11 w-11 items-center justify-center rounded-full"
          style={timerSec === 0 ? undefined : { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
        >
          <Clock className="h-[18px] w-[18px]" />
          {timerSec !== 0 && (
            <span
              className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-label text-[10px] font-semibold"
              style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
            >
              {timerSec}s
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { haptic('tap'); setTimerOpen((o) => !o); }}
          aria-label="Self-timer"
          aria-expanded={timerOpen}
          className={`pressable liquid-glass-inset flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 font-label text-[9px] uppercase tracking-wide transition-colors ${
            timerSec === 0 ? 'text-brand-muted/70' : 'text-[color:var(--color-accent)]'
          }`}
        >
          <Clock className="h-3 w-3" />
          {timerSec === 0 ? '' : `${timerSec}s`}
        </button>
      )}
      <AnimatePresence>
        {timerOpen && (
          <motion.div
            initial={{ opacity: 0, y: down ? -6 : 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: down ? -6 : 6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={down
              ? 'liquid-glass-raised absolute right-0 top-full z-40 mt-2 flex gap-1 rounded-2xl p-1.5'
              : 'liquid-glass-raised absolute bottom-full right-0 z-30 mb-2 flex gap-1 rounded-2xl p-1.5'}
            // The top-bar popover pins itself: `.liquid-glass-raised` sets
            // `position: relative` after `absolute` in the utilities layer.
            // The deck ('up') keeps its shipped styling untouched.
            style={down ? { position: 'absolute' } : undefined}
          >
            {timerOptions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { haptic('select'); onTimerSec(t); setTimerOpen(false); }}
                className={down
                  ? `pressable h-11 w-11 rounded-xl font-label text-[12px] transition-colors ${
                      timerSec === t ? 'is-selected text-brand-fg' : 'text-brand-muted/80 hover:text-brand-fg'
                    }`
                  : `pressable h-11 w-11 rounded-xl font-label text-[10px] transition-colors ${
                      timerSec === t
                        ? 'is-selected bg-foil text-[color:var(--on-accent)]'
                        : 'text-brand-muted/70 hover:text-brand-fg'
                    }`}
              >
                {t === 0 ? 'Off' : `${t}s`}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
