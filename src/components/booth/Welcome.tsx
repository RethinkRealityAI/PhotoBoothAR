/**
 * Booth entrance. Gates the camera start behind a tap (more reliable on iOS,
 * and a more magical arrival than jumping straight to a permission prompt).
 *
 * The hero sits inside an ornate card with an animated accent sheen border that
 * slowly sweeps light around the frame — a premium, magical first impression.
 */
import type { CSSProperties } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Camera, Images } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Emblem, Wordmark } from '../ui/EventLogo';
import GoldFrameCard from '../ui/GoldFrameCard';
import { MediaStackIcon } from '../ui/MediaIcons';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';
import { resolveScene } from '../../lib/sceneThemes';
import SceneBackdrop from '../theme/SceneBackdrop';

/** Platform legal routes (/privacy, /terms) only exist in runtime multi-tenant
 *  builds — legacy single-event builds (VITE_EVENT set) keep their microcopy
 *  byte-identical and never link to a route that would redirect to "/". */
const IS_LEGACY_BUILD = (((import.meta.env.VITE_EVENT as string | undefined) ?? '')).trim() !== '';

/** Platform events get the scene-dressed splash; coded legacy events keep
 *  the gold-framed card below exactly as it shipped. */
export default function Welcome(props: { onStart: () => void }) {
  const { source } = useEvent();
  return source === 'db' ? <SceneWelcome {...props} /> : <LegacyWelcome {...props} />;
}

/**
 * The booth's front door on a platform event: the event's scene shows
 * through (Booth's EventBackground paints it), one clear glass card on top —
 * no gold line-art unless the host chose the Gilded look, which the
 * backdrop itself draws.
 */
function SceneWelcome({ onStart }: { onStart: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const { basePath, config } = useEvent();
  const eventName = useStore((s) => s.copy.eventName);
  const scene = config.scene ? resolveScene(config.scene) : null;
  const tone = scene?.tone ?? 'dark';
  const vars = { '--sc-accent': scene?.accent ?? 'var(--color-accent)' } as CSSProperties;
  const at = (delay: number) =>
    reduced ? { delay: 0, duration: 0.2 } : { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] as const };
  return (
    <motion.div
      data-scene-ui={tone}
      style={vars}
      className="absolute inset-0 z-40 flex flex-col items-center overflow-y-auto px-4 pt-safe-top pb-safe-bottom [--safe-top:1.5rem] [--safe-bottom:1.5rem]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* With a scene, the splash paints it full-bleed itself: the booth's
          stage box (dark, camera-sized) would otherwise sit between the card
          and the host's chosen look until the camera starts. Without one the
          booth's own background shows, with a soft pool of light so the card
          never floats on a flat field. */}
      {scene ? <SceneBackdrop scene={scene} /> : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(70% 55% at 50% 42%, rgba(var(--accent-rgb), 0.16), transparent 65%)' }}
        />
      )}
      <motion.div
        className="sc-glass-strong relative my-auto w-full max-w-[420px] rounded-[32px] px-6 pb-6 pt-9 text-center sm:px-9 sm:pt-11"
        initial={reduced ? { opacity: 0 } : { y: 18, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: reduced ? 0.2 : 0.55, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* The lens: the event's emblem inside a slowly turning aperture. */}
        <motion.div
          className="relative mx-auto flex h-24 w-24 items-center justify-center"
          initial={{ opacity: 0, scale: reduced ? 1 : 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={at(0.06)}
        >
          <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full" aria-hidden fill="none">
            <circle cx="48" cy="48" r="46" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
            <circle cx="48" cy="48" r="46" style={{ stroke: 'var(--sc-accent)' }} strokeWidth="2" strokeDasharray="70 220" strokeLinecap="round" className="sc-spin" />
            <circle cx="48" cy="48" r="36" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
          </svg>
          <Emblem size={46} />
        </motion.div>

        <motion.p className="mt-6 font-sans text-[13px] font-medium sc-faint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={at(0.12)}>
          {eventName}
        </motion.p>
        <motion.h1
          className="sc-display mt-1.5 text-[clamp(30px,8vw,38px)] font-semibold leading-[1.05] sc-ink"
          initial={{ opacity: 0, y: reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={at(0.16)}
        >
          Your photo booth is ready
        </motion.h1>
        <motion.p className="mx-auto mt-3 max-w-[30ch] font-sans text-[15px] leading-relaxed sc-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={at(0.22)}>
          Step into the booth and capture a moment to remember.
        </motion.p>

        <motion.button
          type="button"
          onClick={onStart}
          whileTap={{ scale: 0.97 }}
          className="sc-cta pressable mt-8 inline-flex min-h-[58px] w-full items-center justify-center gap-3 rounded-full px-8 font-sans text-[17px] font-semibold"
          initial={{ opacity: 0, y: reduced ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={at(0.28)}
        >
          <Camera className="h-5 w-5" aria-hidden />
          Step inside
        </motion.button>

        {/* Ways out before the camera, so this gate is never a dead end. */}
        <motion.div className="mt-3 flex items-center justify-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={at(0.34)}>
          <Link
            to={`${basePath}/wall`}
            className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-sans text-[13px] font-medium sc-muted hover:underline"
          >
            <Images className="h-4 w-4" aria-hidden />
            See the live wall
          </Link>
          <Link
            to={`${basePath}/me`}
            className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-sans text-[13px] font-medium sc-muted hover:underline"
          >
            <MediaStackIcon size={16} />
            My photos
          </Link>
        </motion.div>

        {/* The pre-camera disclosure — same promise as the original card. */}
        <motion.p className="mx-auto mt-4 max-w-[34ch] font-sans text-[12px] leading-relaxed sc-faint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={at(0.4)}>
          The camera runs on your device. Your photo only leaves it when you send it to the wall.
          {!IS_LEGACY_BUILD && (
            <>
              {' '}By continuing you agree to our{' '}
              <Link to="/privacy" className="underline underline-offset-2 sc-muted">
                privacy policy
              </Link>
              .
            </>
          )}
        </motion.p>
      </motion.div>
    </motion.div>
  );
}

function LegacyWelcome({ onStart }: { onStart: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const { basePath } = useEvent();
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
            className="mt-9 flex items-center gap-3 px-9 py-4 bg-foil text-[color:var(--on-accent)] rounded-full font-label uppercase tracking-luxe text-[11px] font-bold glow-accent animate-pulse-glow"
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={at(0.32)}
          >
            <Camera className="w-4 h-4" />
            Step Inside
          </motion.button>

          {/* Ways out BEFORE the camera. This gate used to be a dead end: a
              guest who didn't want to turn a camera on had nowhere to go. */}
          <motion.div
            className="mt-4 flex items-center justify-center gap-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={at(0.38)}
          >
            <Link
              to={`${basePath}/wall`}
              className="pressable flex min-h-11 items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 hover:text-brand-fg transition-colors"
            >
              <Images className="w-3.5 h-3.5" />
              See the live wall
            </Link>
            <Link
              to={`${basePath}/me`}
              className="pressable flex min-h-11 items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 hover:text-brand-fg transition-colors"
            >
              <MediaStackIcon size={14} />
              My photos
            </Link>
          </motion.div>

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
