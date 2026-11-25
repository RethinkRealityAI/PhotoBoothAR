/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LeaderboardView — gorgeous gold gala leaderboard for the wall.
 *
 * - Fetches via store.fetchLeaderboard() on mount + every 15 s
 * - Top-3 get gold/silver/bronze treatment
 * - Rank · Name · Points · Photos · Challenges-Completed columns
 * - Elegant glass panel, large-screen optimised (wall projection)
 */
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Crown } from 'lucide-react';
import { useStore } from '../../store';
import { LeaderboardEntry } from '../../types';
import { Wordmark } from '../ui/EventLogo';
import { usePageVisible } from './wallHooks';

const REFRESH_INTERVAL = 15_000;

const CROWN_COLOR = ['#F5C842', '#D6D6D6', '#CD8A4B']; // gold · silver · bronze

const RANK_STYLES: Record<number, { ring: string; glow: string; nameClass: string; bg: string }> = {
  0: {
    ring: '2px solid rgba(var(--accent-rgb),0.90)',
    glow: '0 0 24px rgba(var(--accent-rgb),0.55)',
    nameClass: 'text-foil-static font-serif italic text-xl',
    bg: 'rgba(var(--accent-rgb),0.10)',
  },
  1: {
    ring: '2px solid rgba(192,192,192,0.55)',
    glow: '0 0 16px rgba(192,192,192,0.28)',
    nameClass: 'text-ivory/95 font-serif italic text-xl',
    bg: 'rgba(180,180,180,0.06)',
  },
  2: {
    ring: '2px solid rgba(205,127,50,0.55)',
    glow: '0 0 16px rgba(205,127,50,0.25)',
    nameClass: 'text-ivory/90 font-serif italic text-xl',
    bg: 'rgba(205,127,50,0.07)',
  },
};

function RankBadge({ rank, isWinner }: { rank: number; isWinner: boolean }) {
  if (isWinner) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ width: 40, height: 44 }}>
        <Crown className="w-7 h-7" style={{ color: CROWN_COLOR[rank], filter: `drop-shadow(0 0 6px ${CROWN_COLOR[rank]}66)` }} fill={CROWN_COLOR[rank]} fillOpacity={0.22} />
        <span className="font-label text-[9px]" style={{ color: CROWN_COLOR[rank] }}>{rank + 1}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center font-label text-champagne/50 text-sm" style={{ width: 40, height: 44 }}>
      #{rank + 1}
    </div>
  );
}

function EntryRow({ entry, rank, delay, compact = false }: { entry: LeaderboardEntry; rank: number; delay: number; compact?: boolean }) {
  const isWinner = !!entry.completedAll && rank < 3;
  const style = isWinner ? RANK_STYLES[rank] : null;

  return (
    <motion.div
      className={compact ? 'flex items-center gap-3 px-3 py-2.5 rounded-2xl' : 'flex items-center gap-4 px-5 py-3.5 rounded-2xl'}
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      style={{
        background: style ? style.bg : 'rgba(255,255,255,0.02)',
        border: style ? style.ring : '1px solid rgba(var(--accent-rgb),0.08)',
        boxShadow: style ? style.glow : 'none',
      }}
    >
      {/* Rank badge */}
      <RankBadge rank={rank} isWinner={isWinner} />

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p
          className={style ? style.nameClass : 'font-serif italic text-ivory/80 text-lg'}
          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {entry.name}
        </p>
        {entry.completedAll && (
          <span className="inline-flex items-center gap-1 mt-0.5 font-label uppercase tracking-luxe text-[8px] text-gold-300/80">
            <Crown className="w-2.5 h-2.5" /> Completed all challenges
          </span>
        )}
      </div>

      {/* Points */}
      <div className={compact ? 'text-right shrink-0 w-16' : 'text-right shrink-0 w-24'}>
        <p
          className={
            isWinner && rank === 0
              ? 'text-foil-static font-label text-xl tracking-wide'
              : 'font-label text-champagne/80 text-lg'
          }
        >
          {entry.points}
        </p>
        <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40">
          pts
        </p>
      </div>

      {/* Photos */}
      {!compact && <div className="text-right shrink-0 w-16">
        <p className="font-label text-champagne/70 text-base">{entry.photos}</p>
        <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/35">
          photos
        </p>
      </div>}

      {/* Challenges */}
      {!compact && <div className="text-right shrink-0 w-20">
        <p className="font-label text-champagne/70 text-base">{entry.challengesCompleted}</p>
        <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/35 leading-tight">
          challenges
        </p>
      </div>}
    </motion.div>
  );
}

/**
 * `platform` — the platform wall already shows the event name in its header,
 * so the board drops its own wordmark + name line, and it scrolls (top-safe
 * centred) inside the room under the header instead of clipping long boards.
 * Legacy walls leave it off and render exactly as before.
 */
/**
 * `compact` — the side panel of the wall's split screen: about a third of the
 * screen wide, so it keeps rank, name and points and drops the photos and
 * challenges columns.
 */
export default function LeaderboardView({ platform = false, compact = false }: { platform?: boolean; compact?: boolean } = {}) {
  const { leaderboard, fetchLeaderboard, copy } = useStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visible = usePageVisible();

  useEffect(() => {
    fetchLeaderboard();
    // Stop refreshing entirely while the wall is hidden: a throttled interval
    // queues rather than pauses, and four minutes away meant sixteen fetches
    // landing together the moment the projector woke.
    if (!visible) return;
    intervalRef.current = setInterval(() => {
      fetchLeaderboard();
    }, REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchLeaderboard, visible]);

  return (
    // The board is a fixed 768 px panel of 9-11 px labels — about 20% of a
    // 3840 px projector, unreadable from the room. Scaling the whole panel
    // (rather than every label individually) keeps the composition intact and
    // is exactly 1× at the 1440×900 design size.
    <div
      className={platform
        ? `absolute inset-0 flex flex-col items-center overflow-y-auto hide-scrollbar ${compact ? 'px-0 py-2' : 'px-4 py-6 sm:px-6'}`
        : 'absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-6 py-8'}
      style={platform
        ? { justifyContent: 'safe center' }
        : { transform: 'scale(var(--wall-scale, 1))', transformOrigin: 'center center' }}
    >
      {/* Header */}
      <motion.div
        className={platform ? 'flex flex-col items-center mb-5 shrink-0' : 'flex flex-col items-center mb-8'}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {!platform && <Wordmark size="md" />}
        <div className={platform ? 'flex flex-col items-center gap-1' : 'mt-5 flex flex-col items-center gap-1'}>
          {!platform && (
            <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/50">
              {copy.fullName}
            </p>
          )}
          <h2 className={`font-serif italic text-foil-static ${compact ? 'text-3xl' : 'text-4xl'}`}>
            Leaderboard
          </h2>
          <div
            className="mt-2 h-px w-32"
            style={{
              background:
                'linear-gradient(to right, transparent, rgba(var(--accent-rgb),0.55), transparent)',
            }}
          />
          {!compact && (
            <p className="mt-2 font-label uppercase tracking-luxe text-[9px] text-gold-300/70 flex items-center gap-1.5">
              <Crown className="w-3 h-3" /> First three to finish every challenge are crowned champions
            </p>
          )}
        </div>
      </motion.div>

      {/* Table */}
      <div
        className={platform ? 'w-full max-w-3xl glass-strong rounded-3xl overflow-hidden shrink-0' : 'w-full max-w-3xl glass-strong rounded-3xl overflow-hidden'}
        style={{
          border: '1px solid rgba(var(--accent-rgb),0.20)',
          boxShadow:
            '0 0 60px rgba(var(--accent-rgb),0.08), 0 32px 64px rgba(0,0,0,0.55)',
        }}
      >
        {/* Column headers */}
        <div className={`flex items-center border-b border-gold-400/10 ${compact ? 'gap-3 px-3 py-2.5' : 'gap-4 px-5 py-3'}`}>
          <div style={{ width: 40 }} />
          <div className="flex-1">
            <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40">
              Guest
            </p>
          </div>
          <div className={compact ? 'text-right shrink-0 w-16' : 'text-right shrink-0 w-24'}>
            <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40">
              Points
            </p>
          </div>
          {!compact && (
            <>
              <div className="text-right shrink-0 w-16">
                <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40">
                  Photos
                </p>
              </div>
              <div className="text-right shrink-0 w-20">
                <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40">
                  Challenges
                </p>
              </div>
            </>
          )}
        </div>

        {/* Rows */}
        <div className={`flex flex-col gap-1 ${compact ? 'p-2' : 'p-3'}`}>
          <AnimatePresence mode="popLayout">
            {leaderboard.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-12 text-center"
              >
                <p className="font-serif italic text-champagne/40 text-xl">
                  No scores yet — be the first!
                </p>
              </motion.div>
            ) : (
              leaderboard.map((entry, i) => (
                <EntryRow
                  key={entry.sessionId}
                  entry={entry}
                  rank={i}
                  delay={i * 0.04}
                  compact={compact}
                />
              ))
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Live refresh indicator */}
      <motion.p
        className="mt-5 font-label uppercase tracking-luxe text-[9px] text-champagne/30"
        animate={{ opacity: [0.4, 0.8, 0.4] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        Live · Updates every 15 s
      </motion.p>
    </div>
  );
}
