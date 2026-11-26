/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SkyStage: the booth's screen furniture for a sky effect with no standing
 * Frame (`?ar=sky&sky=<id>`, lib/world/skyFx.ts). The picture itself is painted
 * inside 8th Wall's run canvas (lib/world/skyShader.ts) and shown by the
 * booth's compositor, so this is only:
 *  - the intro card, whose Start tap opens the back camera and asks for motion
 *    access (iOS grants both only from a tap), and
 *  - "Point your camera at the sky" when none is in view.
 * With a standing Frame on the page, WorldStage owns the start tap instead.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CloudSun } from 'lucide-react';
import type { WorldSession } from '../../lib/world/xr8World';
import { wantsSkyHint, type SkyEffect } from '../../lib/world/skyFx';
import { askMotionAccess } from './WorldStage';

export interface SkyStageProps {
  effect: SkyEffect;
  engine: WorldSession;
  /** The Start tap already happened (the camera is opening or open). */
  started: boolean;
  recording: boolean;
  /** Runs synchronously inside the Start tap. */
  onStartTap: () => void;
  /** Back to the selfie camera. */
  onExit: () => void;
}

export default function SkyStage({ effect, engine, started, recording, onStartTap, onExit }: SkyStageProps) {
  const [, bump] = useState(0);
  const [noSky, setNoSky] = useState(false);
  useEffect(() => {
    const prev = engine.onChange;
    engine.onChange = () => { prev?.(); bump((n) => n + 1); };
    const t = window.setInterval(() => {
      setNoSky(engine.live && wantsSkyHint(engine.sinceSky(performance.now())));
      bump((n) => n + 1);
    }, 400);
    return () => { engine.onChange = prev; window.clearInterval(t); };
  }, [engine]);

  const start = () => {
    // First and synchronous: iOS only asks from inside the tap.
    askMotionAccess();
    onStartTap();
  };

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      <AnimatePresence>
        {started && noSky && !recording && (
          <motion.div
            key="sky-hint"
            role="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="absolute left-1/2 top-[14%] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full glass-strong border border-gold-400/30 px-4 py-2 font-sans text-[13px] text-ivory"
          >
            <CloudSun className="h-4 w-4 text-gold-300" aria-hidden />
            Point your camera at the sky
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!started && (
          <motion.div
            key="sky-intro"
            className="absolute inset-0 z-40 flex items-end sm:items-center justify-center p-4 pointer-events-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" aria-hidden />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sky-intro-title"
              initial={{ y: 24, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 16, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="relative w-full max-w-sm rounded-3xl glass-strong border border-gold-400/25 p-5 pb-4 text-center mb-[22%] sm:mb-0"
            >
              <span
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-2xl text-white"
                style={{ background: `linear-gradient(180deg, ${effect.swatch[0]}, ${effect.swatch[1]})` }}
                aria-hidden
              >
                {effect.mark}
              </span>
              <h2 id="sky-intro-title" className="mt-3 font-display text-xl text-ivory">{effect.name}</h2>
              <p className="mt-1.5 font-sans text-sm text-ivory/75 leading-snug">
                {effect.blurb} Step outside, point the back camera at the sky, then take your photo or video.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={start}
                  autoFocus
                  disabled={!engine.loaded}
                  className="pressable flex min-h-12 items-center justify-center gap-2 rounded-xl bg-foil glow-accent px-6 font-label text-xs uppercase tracking-luxe text-[color:var(--on-accent)] transition-all active:scale-95 disabled:opacity-50"
                >
                  <CloudSun className="w-4 h-4" aria-hidden />
                  {engine.loaded ? 'Open the sky' : 'Loading…'}
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="min-h-11 rounded-xl font-sans text-[13px] text-ivory/70 hover:text-ivory"
                >
                  Back to the selfie camera
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
