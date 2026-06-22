/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ChallengesTicker — subtle rotating ticker of active challenges shown on the wall.
 *
 * - Fetches active challenges via store.fetchChallenges(true) once on mount.
 * - Rotates through them every ~4 s with a cross-fade.
 * - Sits as a fixed bottom strip above the footer, narrow so it doesn't distract.
 * - Gated externally by wallSettings.showChallenges (rendered null if not shown).
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../../store';
import { Challenge } from '../../types';

const ROTATE_INTERVAL = 4200;

interface Props {
  /** Additional bottom offset (px) so ticker clears any footer chrome */
  bottomOffset?: number;
}

function TickerSlide({ challenge }: { challenge: Challenge }) {
  return (
    <motion.div
      key={challenge.id}
      className="flex items-center gap-3"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{challenge.emoji}</span>
      <span className="font-label uppercase tracking-luxe text-[10px] text-champagne/50 mr-1">
        Challenge
      </span>
      <span className="font-serif italic text-ivory/80 text-sm truncate">
        {challenge.title}
      </span>
      <span
        className="font-label uppercase tracking-luxe text-[9px] shrink-0 px-2 py-0.5 rounded-full"
        style={{
          background: 'rgba(var(--accent-rgb),0.12)',
          border: '1px solid rgba(var(--accent-rgb),0.22)',
          color: 'rgba(var(--accent-rgb),0.8)',
        }}
      >
        +{challenge.points} pts
      </span>
    </motion.div>
  );
}

export default function ChallengesTicker({ bottomOffset = 0 }: Props) {
  const { challenges, fetchChallenges } = useStore();
  const [index, setIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchChallenges(true);
  }, [fetchChallenges]);

  const active = challenges.filter((c) => c.active);

  // Auto-rotate
  useEffect(() => {
    if (active.length <= 1) return;
    intervalRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % active.length);
    }, ROTATE_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active.length]);

  if (active.length === 0) return null;

  const current = active[index % active.length];

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none"
      style={{ bottom: bottomOffset + 8 }}
    >
      <div
        className="glass flex items-center gap-2 px-5 py-2.5 rounded-full overflow-hidden"
        style={{
          border: '1px solid rgba(var(--accent-rgb),0.18)',
          boxShadow: '0 0 16px rgba(var(--accent-rgb),0.08)',
          minWidth: 280,
          maxWidth: '90vw',
          justifyContent: 'center',
        }}
      >
        <AnimatePresence mode="wait">
          <TickerSlide key={current.id} challenge={current} />
        </AnimatePresence>

        {active.length > 1 && (
          <div className="flex gap-1 ml-3 shrink-0">
            {active.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-300"
                style={{
                  width: i === index % active.length ? 14 : 4,
                  height: 4,
                  background:
                    i === index % active.length
                      ? 'rgba(var(--accent-rgb),0.75)'
                      : 'rgba(var(--accent-rgb),0.25)',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
