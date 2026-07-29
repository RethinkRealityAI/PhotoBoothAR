/**
 * Countdown overlay: counts from `from` down to 1, then calls onComplete.
 * Supports variable from value (3, 5, 10) for the timer selector.
 *
 * This used to be a bare number on a `pointer-events-none` layer, mounted by a
 * phase that unmounts BOTH the top bar and the control deck — so a guest who
 * picked the 10s timer and then wanted to fix their hair, wait for a friend or
 * simply not be photographed had NO way out for ten seconds. That is a trap,
 * and on a booth in a queue it is the trap people remember.
 *
 * So the overlay now carries, in order of importance:
 *   • a large, thumb-reachable CANCEL (the layer is still pointer-transparent
 *     everywhere else, so nothing underneath became unreachable);
 *   • a progress ring, because "how long is left" should not require reading a
 *     digit and doing arithmetic;
 *   • per-second cues — a synthesized tick (no audio assets, no dependency)
 *     plus a haptic — with a visible mute. The final second is brighter so the
 *     guest knows to hold still without watching the number.
 *
 * Everything cue-shaped is opt-out safe: `playCue` never throws when the
 * AudioContext is blocked before a user gesture, `haptic()` is already a no-op
 * on iOS, and `prefers-reduced-motion` suppresses the scale animation, the
 * ring's transition and (via both helpers) the sound and buzz alike.
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { X, Volume2, VolumeX } from 'lucide-react';
import { haptic } from '../../lib/haptics';
import { playCue, soundEnabled, setSoundEnabled } from '../../lib/boothAudio';

interface Props {
  from?: number;
  onComplete: () => void;
  /** Abandon the shot and go back to the camera. Absent ⇒ no cancel affordance
   *  is rendered (kept optional so this component stays drop-in). */
  onCancel?: () => void;
  /** Optional line under the ring, e.g. the photo-strip's "Shot 2 of 3". */
  caption?: string;
}

const RING_R = 74;
const RING_C = 2 * Math.PI * RING_R;

export default function Countdown({ from = 3, onComplete, onCancel, caption }: Props) {
  const [count, setCount] = useState(from);
  const [muted, setMuted] = useState(() => !soundEnabled());
  const reduced = useReducedMotion() ?? false;
  /** Guards the cue so a re-render at the same count cannot double-beep. */
  const cuedRef = useRef<number | null>(null);

  useEffect(() => {
    setCount(from);
    cuedRef.current = null;
  }, [from]);

  useEffect(() => {
    if (count <= 0) {
      onComplete();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count, onComplete]);

  // Cues live in their own effect so the timing effect above stays exactly the
  // shape it has always been — a cue must never be able to shift the schedule.
  useEffect(() => {
    if (count <= 0 || cuedRef.current === count) return;
    cuedRef.current = count;
    playCue(count === 1 ? 'tickFinal' : 'tick');
    haptic('tap');
  }, [count]);

  const progress = from > 0 ? Math.max(0, Math.min(1, (count - 1) / from)) : 0;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none">
      {/* Ring + number */}
      <div className="relative flex items-center justify-center">
        <svg
          className="-rotate-90"
          width={(RING_R + 10) * 2}
          height={(RING_R + 10) * 2}
          viewBox={`0 0 ${(RING_R + 10) * 2} ${(RING_R + 10) * 2}`}
          aria-hidden
        >
          <circle
            cx={RING_R + 10} cy={RING_R + 10} r={RING_R}
            fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="4"
          />
          <circle
            cx={RING_R + 10} cy={RING_R + 10} r={RING_R}
            fill="none" stroke="var(--color-accent)" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
            style={{
              // One second per step, linear, so the ring tracks the digits
              // exactly. Under reduced motion it snaps instead of sweeping.
              transition: reduced ? 'none' : 'stroke-dashoffset 1s linear',
              filter: 'drop-shadow(0 0 10px rgba(var(--accent-rgb),0.7))',
            }}
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center">
          <AnimatePresence mode="wait">
            {count > 0 && (
              <motion.div
                key={count}
                initial={reduced ? { opacity: 1 } : { scale: 1.8, opacity: 0 }}
                animate={reduced ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
                transition={reduced ? { duration: 0 } : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="font-serif text-8xl font-bold text-foil drop-shadow-2xl"
                style={{ textShadow: '0 0 60px rgba(var(--accent-rgb),0.8)' }}
              >
                {count}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {caption && (
        <p className="mt-5 font-label text-[11px] uppercase tracking-luxe text-champagne/70">
          {caption}
        </p>
      )}

      {/* Escape hatch + mute. `pointer-events-auto` is scoped to this bar only,
          so the rest of the overlay stays transparent to taps as before. */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 pb-safe-bottom [--safe-bottom:2rem]">
        <button
          type="button"
          onClick={() => {
            haptic('toggle');
            const next = muted;           // un-muting: next state is "sound on"
            setSoundEnabled(next);
            setMuted(!next);
            if (next) playCue('tick');    // confirm audibly that it came back
          }}
          aria-label={muted ? 'Turn countdown sound on' : 'Turn countdown sound off'}
          aria-pressed={!muted}
          className="pressable liquid-glass-raised flex min-h-11 min-w-11 items-center gap-2 rounded-full px-4 font-label text-[10px] uppercase tracking-wide text-brand-fg/70"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          {muted ? 'Sound off' : 'Sound on'}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={() => { haptic('toggle'); onCancel(); }}
            className="pressable flex min-h-[56px] items-center gap-2.5 rounded-full px-8 font-label text-xs uppercase tracking-luxe text-ivory"
            style={{
              background: 'rgba(9,11,20,0.72)',
              border: '1.5px solid rgba(255,255,255,0.28)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            }}
          >
            <X className="h-5 w-5" />
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
