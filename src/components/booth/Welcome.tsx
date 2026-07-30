/**
 * Booth entrance. Gates the camera start behind a tap (more reliable on iOS,
 * and a more magical arrival than jumping straight to a permission prompt).
 *
 * The hero sits inside an ornate card with an animated accent sheen border that
 * slowly sweeps light around the frame — a premium, magical first impression.
 */
import { motion, useReducedMotion } from 'motion/react';
import { Camera } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Wordmark } from '../ui/EventLogo';
import GoldFrameCard from '../ui/GoldFrameCard';

/** Platform legal routes (/privacy, /terms) only exist in runtime multi-tenant
 *  builds — legacy single-event builds (VITE_EVENT set) keep their microcopy
 *  byte-identical and never link to a route that would redirect to "/". */
const IS_LEGACY_BUILD = (((import.meta.env.VITE_EVENT as string | undefined) ?? '')).trim() !== '';

export default function Welcome({ onStart }: { onStart: () => void }) {
  const reduced = useReducedMotion() ?? false;
  /* The staged reveal used to span ~1.85s, which read as an empty dark frame
     while it played. It now completes in ~0.7s (and is instant under
     prefers-reduced-motion), so the card never lingers half-built. */
  const at = (delay: number) =>
    reduced
      ? { delay: 0, duration: 0.2 }
      : { delay, duration: 0.55, ease: [0.16, 1, 0.3, 1] as const };
  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center px-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Themed ambience behind the card — the entrance previously sat on a
          flat near-black field, which guests read as a broken black box. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(85% 60% at 50% 38%, rgba(var(--accent-rgb), 0.16), transparent 62%),' +
            'radial-gradient(120% 50% at 50% 112%, rgba(var(--accent-rgb), 0.10), transparent 65%)',
        }}
      />
      <motion.div
        className="relative w-full max-w-sm"
        initial={reduced ? { opacity: 0 } : { y: 20, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: reduced ? 0.2 : 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <GoldFrameCard>
          <motion.div
            initial={reduced ? { opacity: 0 } : { y: 14, opacity: 0, scale: 0.92 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={at(0.08)}
          >
            <Wordmark size="lg" />
          </motion.div>

          <motion.p
            className="mt-7 max-w-xs font-serif italic text-lg text-brand-muted/80 leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={at(0.2)}
          >
            Step into the booth and capture a moment to remember.
          </motion.p>

          <motion.button
            onClick={onStart}
            whileTap={{ scale: 0.96 }}
            className="mt-9 flex items-center gap-3 px-9 py-4 bg-foil text-white rounded-full font-label uppercase tracking-luxe text-[11px] font-bold glow-accent animate-pulse-glow"
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={at(0.32)}
          >
            <Camera className="w-4 h-4" />
            Step Inside
          </motion.button>

          {/* The pre-camera disclosure. This was 8px uppercase at 30% opacity
              with 0.28em tracking — not a legible disclosure by any measure,
              on the one screen where a guest decides whether to turn on their
              camera. Now sentence case at a readable size and contrast.
              The claim itself was also softened from "only shared when you
              choose": on a photo challenge the shot is uploaded for an
              automatic check as soon as the guest presses send, so "leaves
              this device when you send it" is what actually happens. */}
          <motion.p
            className="mt-6 max-w-xs font-sans text-[13px] text-brand-muted/75 leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={at(0.44)}
          >
            The camera runs on your device. Your photo only leaves it when you send it to the wall.
            {!IS_LEGACY_BUILD && (
              <>
                {' '}By continuing you agree to our{' '}
                <Link to="/privacy" className="underline underline-offset-2 text-brand-fg/80 hover:text-brand-fg">
                  privacy policy
                </Link>
                .
              </>
            )}
          </motion.p>
        </GoldFrameCard>
      </motion.div>
    </motion.div>
  );
}
