/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-run studio onboarding — shown once when a host first opens the event
 * studio (gated by the `beamwall.studio.onboarded` localStorage flag). Mirrors
 * the booth's onboarding pattern (swipeable, dot-paged, skippable) but on the
 * platform's own liquid-glass look, and each step frames a real screenshot of
 * the actual studio (captured from the editor) rather than an illustration.
 */
import { useState, type ComponentType } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronRight, ChevronLeft, QrCode } from 'lucide-react';
import libraryImg from '../../assets/studio/studio-library.jpg';
import directorImg from '../../assets/studio/studio-director.jpg';
import triggersImg from '../../assets/studio/studio-triggers.jpg';

const ONBOARDED_KEY = 'beamwall.studio.onboarded';

/** Shows once, ever, per browser. Call `dismiss()` when the host finishes/skips. */
export function useStudioOnboarding(): { show: boolean; dismiss: () => void } {
  const [show] = useState(() => {
    try {
      return !localStorage.getItem(ONBOARDED_KEY);
    } catch {
      return false;
    }
  });
  function dismiss() {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      /* private mode / storage disabled — non-fatal, just re-shows next visit */
    }
  }
  return { show, dismiss };
}

interface Step {
  eyebrow: string;
  title: string;
  body: string;
  /** Real studio screenshot for the step, framed as an app window. */
  image?: string;
  /** Fallback icon when there's no representative screenshot (e.g. Go live). */
  Icon?: ComponentType<{ className?: string }>;
}

const STEPS: Step[] = [
  {
    eyebrow: 'Your studio',
    title: 'Design your look',
    body: 'Every frame, sticker, filter and 3D prop lives in one library — drop any onto your scene, or tap “AI Generate Frame” to create a new one, on brand, in seconds.',
    image: libraryImg,
  },
  {
    eyebrow: 'AI Director',
    title: 'Describe it — the AI builds it',
    body: 'Tell the Director the vibe and it designs a matching frame, filter and head-piece as one scene. Preview each piece first; you only spend credits on what you keep.',
    image: directorImg,
  },
  {
    eyebrow: 'Effects & magic',
    title: 'Bring it to life',
    body: 'Layer cinematic filters, then add Magic Triggers so a guest’s smile, wink or open mouth sets off effects live in the booth.',
    image: triggersImg,
  },
  {
    eyebrow: 'Go live',
    title: 'Share one QR code',
    body: 'When it looks perfect, hit Save, then share your event’s QR from the Share tab. Guests scan and step straight into your AR booth — no app to download.',
    Icon: QrCode,
  },
];

export default function StudioOnboarding({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  function advance() {
    if (isLast) {
      onDismiss();
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to the studio"
    >
      <motion.div
        className="glass-strong relative w-full max-w-lg overflow-hidden rounded-3xl px-7 pb-8 pt-6 shadow-[0_30px_100px_rgba(0,0,0,0.7)]"
        initial={{ opacity: 0, y: 26, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.97 }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.16}
        onDragEnd={(_, info) => {
          if (info.offset.x < -70) advance();
          else if (info.offset.x > 70) back();
        }}
      >
        {/* foil hairline along the top edge */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-foil opacity-60" />

        <div className="mb-4 flex items-center justify-between">
          <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">
            The studio · quick tour
          </span>
          <button
            onClick={onDismiss}
            aria-label="Skip tour"
            className="rounded-full border border-white/10 bg-white/[0.05] p-2 text-brand-muted/70 transition hover:text-brand-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            {/* Framed studio screenshot (top-anchored so the feature reads) */}
            <div
              className="relative h-52 w-full overflow-hidden rounded-2xl border border-white/10 bg-brand-bg sm:h-60"
              style={{ boxShadow: '0 20px 60px -24px rgba(0,0,0,0.85)' }}
            >
              {current.image ? (
                <img src={current.image} alt="" aria-hidden className="h-full w-full object-cover object-top" draggable={false} />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(120%_100%_at_50%_0%,color-mix(in_srgb,var(--color-accent)_18%,transparent),transparent_60%)]">
                  {current.Icon && <current.Icon className="h-16 w-16 text-accent" />}
                </div>
              )}
              {/* bottom fade so the crop blends into the card */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[color:var(--color-brand-bg)] to-transparent" />
            </div>

            <div className="mt-5 text-center">
              <p className="font-label uppercase tracking-luxe text-[10px] text-accent">{current.eyebrow}</p>
              <h3 className="mt-2 font-serif text-2xl text-brand-fg">{current.title}</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-brand-muted/80">{current.body}</p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Dots */}
        <div className="mt-6 flex justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 bg-[color:var(--color-accent)]' : 'w-1.5 bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            onClick={back}
            disabled={step === 0}
            className="flex items-center gap-1 rounded-full px-3 py-2 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 transition hover:text-brand-fg disabled:pointer-events-none disabled:opacity-0"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <button
            onClick={advance}
            className="flex items-center gap-2 rounded-full bg-foil px-7 py-3 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
          >
            {isLast ? 'Start designing' : 'Next'}
            {!isLast && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
