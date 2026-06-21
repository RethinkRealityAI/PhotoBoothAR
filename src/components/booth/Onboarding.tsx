/**
 * First-launch onboarding modal (shown once via 'hopegala.onboarded' localStorage flag).
 * Five elegant steps, each with a bespoke gold line-art illustration (see
 * OnboardingArt.tsx). Gala-styled bottom sheet, swipeable, skippable.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronRight } from 'lucide-react';
import ScagoMark from '../ui/ScagoMark';
import { Art } from './OnboardingArt';
import { activeEvent } from '../../events/active';

interface Step {
  eyebrow: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    eyebrow: 'Step One',
    title: 'Choose Your Look',
    body: 'Pick a dazzling Effect — gold sparkles, shimmering aurora, soft lens flares — then layer it with a curated Frame. They were designed to pair beautifully together.',
  },
  {
    eyebrow: 'Step Two',
    title: 'Flip & Adorn',
    body: 'Tap to flip between front and back cameras. Then crown yourself with a 3D accessory — tracked live to your head by our face AI as you move.',
  },
  {
    eyebrow: 'Step Three',
    title: 'Photo or Video',
    body: 'Press the shutter for a single luminous frame, or switch to Video to capture up to 30 seconds of magic — sound, motion and your chosen effects, all in one.',
  },
  {
    eyebrow: 'Step Four',
    title: 'Send & Shine',
    body: 'Set a hands-free timer (3s, 5s or 10s) for the perfect pose, then beam your portrait straight to the live Gala Wall for everyone to admire.',
  },
  {
    eyebrow: 'Step Five',
    title: 'Take the Challenge',
    body: 'Accept a live Challenge — a photo with two family physicians, with an award winner, or a playful one with SCAGO President & CEO Mrs. Lanre Tunji-Ajayi. Climb the Leaderboard and a special prize awaits the night’s champion.',
  },
];

const ONBOARDED_KEY = 'hopegala.onboarded';

export function useOnboarding(): { showOnboarding: boolean; dismiss: () => void } {
  const [showOnboarding] = useState(() => {
    try { return !localStorage.getItem(ONBOARDED_KEY); } catch { return false; }
  });

  function dismiss() {
    try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* non-fatal */ }
  }

  return { showOnboarding, dismiss };
}

interface Props {
  onDismiss: () => void;
}

export default function Onboarding({ onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];
  const StepArt = Art[step];

  function advance() {
    if (isLast) { onDismiss(); return; }
    setStep((s) => s + 1);
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <motion.div
      className="absolute inset-0 z-[70] flex items-end justify-center bg-noir-900/80 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="w-full max-w-md glass-strong rounded-t-3xl px-7 pt-7 pb-safe-bottom pb-10 relative overflow-hidden"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        onDragEnd={(_, info) => {
          if (info.offset.x < -70) advance();
          else if (info.offset.x > 70) back();
        }}
      >
        {/* hairline foil accent along the top edge */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-foil opacity-60" />

        {/* Brand header: SCAGO ABOVE Hope Gala & Awards, paired with the emblem */}
        <div className="flex items-center gap-2.5 mb-5 pr-10">
          <ScagoMark size={34} variant="gold" animated className="shrink-0" title="SCAGO" />
          <div className="flex flex-col leading-none">
            <span className="font-label uppercase tracking-luxe text-[9px] text-gold-300">
              SCAGO
            </span>
            <span className="font-serif italic text-base text-ivory mt-0.5">
              {activeEvent.copy.eventName}
            </span>
          </div>
        </div>

        {/* Skip */}
        <button
          onClick={onDismiss}
          className="absolute top-5 right-5 w-8 h-8 rounded-full glass flex items-center justify-center text-champagne/40 hover:text-ivory transition-colors"
          aria-label="Skip onboarding"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Progress dots (5) */}
        <div className="flex justify-center gap-1.5 mb-5">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              className={`h-1 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-gold-400' : 'w-1.5 bg-champagne/20 hover:bg-champagne/40'}`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -30, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex flex-col items-center text-center gap-4"
          >
            {/* Bespoke gold line-art illustration */}
            <div className="relative flex items-center justify-center w-40 h-40">
              <div className="absolute inset-6 rounded-full bg-foil opacity-[0.07] blur-2xl" />
              <StepArt size={148} className="relative drop-shadow-[0_0_20px_rgba(212,175,55,0.25)]" />
            </div>

            <div className="space-y-2">
              <span className="font-label uppercase tracking-luxe text-[9px] text-gold-400/80">
                {current.eyebrow}
              </span>
              <h3 className="font-serif text-2xl text-ivory leading-tight">{current.title}</h3>
              <p className="font-sans text-sm text-champagne/70 leading-relaxed max-w-xs">
                {current.body}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Advance / Begin */}
        <div className="mt-7 flex flex-col gap-3">
          <button
            onClick={advance}
            className="w-full bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-xs rounded-xl px-6 py-4 flex items-center justify-center gap-2.5 hover:brightness-110 transition-all active:scale-95"
          >
            {isLast ? (
              <>
                <ScagoMark size={20} variant="mono" className="shrink-0" title="SCAGO" />
                <span>Begin the Experience</span>
              </>
            ) : (
              <>
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>

          {!isLast && (
            <button
              onClick={onDismiss}
              className="font-label text-[9px] uppercase tracking-luxe text-champagne/30 hover:text-champagne/60 transition-colors"
            >
              Skip intro
            </button>
          )}
        </div>

        {/* Footer: SCAGO above Hope Gala & Awards, paired with the emblem */}
        <div className="mt-5 flex items-center justify-center gap-2 opacity-40">
          <ScagoMark size={14} variant="gold" animated className="shrink-0" title="SCAGO" />
          <p className="text-center font-label text-[8px] uppercase tracking-luxe text-champagne/60 leading-tight">
            {activeEvent.copy.fullName}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
