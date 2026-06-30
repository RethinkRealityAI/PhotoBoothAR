/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UploadGate — password protection for the public /upload page so bots/strangers
 * can't mass-upload to the wall. Beautiful, on-theme: an ornate gold-border card
 * (same treatment as the booth entrance) floating between two closed "elevator
 * doors". On the correct passcode the card bows out and the doors slide apart to
 * reveal the upload experience beneath.
 *
 * Not hard security — a friction layer for the event (RLS hardening is tracked
 * post-event, like the studio passcode).
 */
import { useCallback, useEffect, useRef, useState, ReactNode, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, ArrowRight } from 'lucide-react';
import EventBackground from '../ui/EventBackground';
import GoldFrameCard from '../ui/GoldFrameCard';
import { Wordmark } from '../ui/EventLogo';
import { useStore } from '../../store';

const KEY = 'hopegala.upload';

type Phase = 'locked' | 'unlocking' | 'open';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** One half of the elevator door. `side` controls which edge carries the seam. */
function Door({
  side,
  opening,
  reduced,
  onOpened,
}: {
  side: 'left' | 'right';
  opening: boolean;
  reduced: boolean;
  onOpened?: () => void;
}) {
  const isLeft = side === 'left';
  return (
    <motion.div
      className={`absolute inset-y-0 ${isLeft ? 'left-0' : 'right-0'} w-1/2 overflow-hidden`}
      initial={false}
      animate={
        reduced
          ? { opacity: opening ? 0 : 1 }
          : { x: opening ? (isLeft ? '-100%' : '100%') : '0%' }
      }
      transition={
        reduced
          ? { duration: 0.4 }
          : { duration: 0.95, ease: [0.16, 1, 0.3, 1], delay: opening ? 0.22 : 0 }
      }
      onAnimationComplete={() => {
        if (opening && onOpened) onOpened();
      }}
      style={{
        background:
          'linear-gradient(180deg, #0B0806 0%, #15100a 45%, #1c1409 100%)',
      }}
    >
      {/* faint vertical brushed-gold panelling */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          background:
            'repeating-linear-gradient(90deg, #FBF3D9 0 1px, transparent 1px 26px)',
        }}
      />
      {/* ornate inner edge (the seam where the doors meet) */}
      <div
        className={`absolute inset-y-0 ${isLeft ? 'right-0' : 'left-0'} w-[3px]`}
        style={{
          background:
            'linear-gradient(to bottom, transparent, rgba(212,175,55,0.85) 18%, #FBF3D9 50%, rgba(212,175,55,0.85) 82%, transparent)',
          boxShadow: '0 0 22px 3px rgba(212,175,55,0.45)',
        }}
      />
      {/* secondary hairline just inside the seam */}
      <div
        className={`absolute inset-y-8 ${isLeft ? 'right-3' : 'left-3'} w-px bg-gold-400/20`}
      />
    </motion.div>
  );
}

export default function UploadGate({ children }: { children: ReactNode }) {
  const passcode =
    (import.meta.env.VITE_UPLOAD_PASSCODE as string) ||
    (import.meta.env.VITE_ADMIN_PASSCODE as string) ||
    'hopegala2026';
  const eventName = useStore((s) => s.copy.eventName);

  const reduced = useRef(prefersReducedMotion());
  const [phase, setPhase] = useState<Phase>(() =>
    sessionStorage.getItem(KEY) === '1' ? 'open' : 'locked',
  );
  const [val, setVal] = useState('');
  const [err, setErr] = useState(false);

  const submit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (val.trim() === passcode) {
        sessionStorage.setItem(KEY, '1');
        setErr(false);
        setPhase(reduced.current ? 'open' : 'unlocking');
      } else {
        setErr(true);
      }
    },
    [val, passcode],
  );

  // Reduced-motion path skips the door choreography entirely.
  useEffect(() => {
    if (phase === 'unlocking' && reduced.current) setPhase('open');
  }, [phase]);

  const opening = phase === 'unlocking';
  const showOverlay = phase !== 'open';

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* The upload experience — mounted once we begin opening so it's revealed
          live as the doors part (and stays mounted when fully open). */}
      {phase !== 'locked' && <div className="absolute inset-0">{children}</div>}

      <AnimatePresence>
        {showOverlay && (
          <motion.div
            key="gate-overlay"
            className="absolute inset-0 z-50"
            initial={false}
            exit={{ opacity: 0 }}
          >
            <Door
              side="left"
              opening={opening}
              reduced={reduced.current}
              onOpened={() => setPhase('open')}
            />
            <Door side="right" opening={opening} reduced={reduced.current} />

            {/* Decorative backdrop dust — only while closed, so the reveal is clean */}
            {phase === 'locked' && (
              <div className="absolute inset-0 pointer-events-none">
                <EventBackground density={22} />
              </div>
            )}

            {/* Password card — bows out the instant we start unlocking */}
            <AnimatePresence>
              {phase === 'locked' && (
                <motion.div
                  key="gate-card"
                  className="absolute inset-0 z-10 flex items-center justify-center p-6"
                  initial={{ opacity: 0, y: 18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92, y: -10 }}
                  transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                >
                  <GoldFrameCard className="w-full max-w-sm" contentClassName="px-8 py-11">
                    <div className="w-14 h-14 mb-6 rounded-full bg-foil glow-accent flex items-center justify-center">
                      <Lock className="w-6 h-6 text-noir-900" />
                    </div>

                    <Wordmark size="md" />

                    <h1 className="mt-5 font-serif italic text-3xl text-foil-static">
                      Private Upload
                    </h1>
                    <p className="mt-1 font-label uppercase tracking-luxe text-[10px] text-champagne/50">
                      {eventName} · Add to the Wall
                    </p>
                    <p className="mt-4 max-w-[17rem] font-sans text-[12px] text-champagne/55 leading-relaxed">
                      This area is passcode-protected. Enter the event passcode to
                      upload your photos &amp; videos to the live wall.
                    </p>

                    <form onSubmit={submit} className="mt-7 w-full">
                      <input
                        type="password"
                        autoFocus
                        value={val}
                        onChange={(e) => {
                          setVal(e.target.value);
                          setErr(false);
                        }}
                        placeholder="Enter passcode"
                        className={`w-full text-center bg-white/5 border rounded-xl px-4 py-3 text-ivory placeholder-white/25 outline-none transition-colors ${
                          err
                            ? 'border-red-400/60'
                            : 'border-gold-400/20 focus:border-gold-400/60'
                        }`}
                      />
                      {err && (
                        <p className="text-red-300/80 text-xs mt-3">Incorrect passcode</p>
                      )}
                      <button
                        type="submit"
                        className="mt-6 w-full py-3.5 bg-foil text-noir-900 font-bold uppercase tracking-luxe text-[11px] rounded-xl glow-accent hover:scale-[1.02] transition-transform flex items-center justify-center gap-2"
                      >
                        Unlock
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </form>
                  </GoldFrameCard>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
