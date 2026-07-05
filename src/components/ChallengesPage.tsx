/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ChallengesPage — the guest-facing /challenges destination. Lists the event's
 * active challenges with the guest's live progress (completed ones checked off,
 * hydrated from this device + their submitted posts) and a clear path to
 * complete them in the booth. Themed and reachable from the shared GuestNav.
 */
import { useEffect, useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Trophy, Check, Camera } from 'lucide-react';
import { useStore } from '../store';
import { useEvent } from '../events/EventContext';
import { getCompletedChallenges, addCompletedChallenges } from '../lib/session';
import { fetchMyPosts } from '../lib/db';
import EventBackground from './ui/EventBackground';
import { Wordmark } from './ui/EventLogo';
import GuestNav from './ui/GuestNav';

export default function ChallengesPage() {
  const { eventId, basePath } = useEvent();
  const { challenges, challengesLoaded, fetchChallenges } = useStore();
  const [completed, setCompleted] = useState<string[]>(() => getCompletedChallenges(eventId));

  useEffect(() => {
    if (!challengesLoaded) fetchChallenges(true);
  }, [challengesLoaded, fetchChallenges]);

  // Hydrate the completed set from this session's tagged posts + live changes.
  useEffect(() => {
    let alive = true;
    fetchMyPosts(eventId)
      .then((posts) => {
        const ids = posts.map((p) => p.challenge_id).filter(Boolean) as string[];
        if (ids.length) addCompletedChallenges(eventId, ids);
        if (alive) setCompleted(getCompletedChallenges(eventId));
      })
      .catch(() => {});
    const onChange = () => setCompleted(getCompletedChallenges(eventId));
    window.addEventListener('challenges:changed', onChange);
    return () => { alive = false; window.removeEventListener('challenges:changed', onChange); };
  }, [eventId]);

  const active = useMemo(() => challenges.filter((c) => c.active), [challenges]);
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const doneCount = active.filter((c) => completedSet.has(c.id)).length;
  const pct = active.length ? Math.round((doneCount / active.length) * 100) : 0;
  const allDone = active.length > 0 && doneCount === active.length;

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar bg-noir-900">
      <EventBackground density={28} />

      {/* Cross-page navigation — desktop pill; GuestNav also mounts the mobile
          bottom tab bar via portal, so this strip hides on small screens. */}
      <div className="hidden sm:flex sticky top-0 z-30 justify-center px-3 pt-4 pb-2"
        style={{ background: 'linear-gradient(to bottom, rgba(10,7,3,0.92) 0%, rgba(10,7,3,0) 100%)' }}>
        <GuestNav current="challenges" />
      </div>

      {/* Header */}
      <div className="relative z-10 flex flex-col items-center pt-6 pb-6 px-4 text-center">
        <Wordmark size="md" />
        <p className="mt-6 font-label uppercase tracking-luxe text-[10px] text-gold-300/70">Challenges</p>
        <p className="mt-2 font-serif italic text-2xl text-ivory/85">
          {allDone ? 'You finished them all!' : 'Complete them all'}
        </p>
        <span
          className="mt-3 h-px w-16 block"
          style={{ background: 'linear-gradient(to right, transparent, rgba(var(--accent-rgb),0.6), transparent)' }}
          aria-hidden
        />

        {active.length > 0 && (
          <div className="mt-5 w-full max-w-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/50">Your progress</span>
              <span className="font-label uppercase tracking-luxe text-[9px] text-gold-300">{doneCount}/{active.length}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-noir-800 overflow-hidden border border-gold-400/10">
              <motion.div
                className="h-full bg-foil"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="relative z-10 px-4 pb-28 sm:pb-16 max-w-2xl mx-auto">
        {!challengesLoaded ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 rounded-full border-2 border-gold-400/30 border-t-gold-400 animate-spin" />
          </div>
        ) : active.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="flex flex-col items-center py-16 text-center px-6"
          >
            <div className="w-20 h-20 rounded-full liquid-glass flex items-center justify-center mb-6">
              <Trophy className="w-9 h-9 text-gold-300" />
            </div>
            <p className="font-serif italic text-2xl text-foil-static mb-2">No challenges yet</p>
            <p className="font-sans text-champagne/60 text-sm max-w-xs leading-relaxed">
              This event hasn’t added any challenges. Step into the booth and capture a moment for the wall!
            </p>
            <a href={`${basePath}/booth`}
              className="mt-7 inline-flex items-center gap-2 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] px-8 py-3 rounded-xl glow-accent">
              <Camera className="w-4 h-4" /> Open the booth
            </a>
          </motion.div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {active.map((c, i) => {
                const done = completedSet.has(c.id);
                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 18, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.45, delay: Math.min(i * 0.05, 0.5), ease: [0.22, 1, 0.36, 1] }}
                    className={`relative flex items-center gap-3.5 rounded-2xl liquid-glass p-4 ${done ? 'opacity-70' : ''}`}
                  >
                    <span className="text-3xl shrink-0 leading-none">{c.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-sans text-[15px] text-ivory font-medium leading-tight">{c.title}</p>
                      {c.description && (
                        <p className="font-sans text-xs text-champagne/55 mt-1 leading-snug line-clamp-2">{c.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <span className="font-label text-[8px] uppercase tracking-luxe text-gold-400">+{c.points}pts</span>
                      {done ? (
                        <span className="w-6 h-6 rounded-full bg-gold-400/20 flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 text-gold-300" />
                        </span>
                      ) : (
                        <span className="w-6 h-6 rounded-full border border-champagne/20" aria-hidden />
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <div className="mt-8 flex flex-col items-center text-center">
              {allDone ? (
                <>
                  <div className="text-4xl mb-2">🏆</div>
                  <p className="font-serif italic text-xl text-foil-static">All done — check the wall leaderboard!</p>
                  <a href={`${basePath}/wall`}
                    className="mt-5 inline-flex items-center gap-2 glass rounded-xl px-7 py-3 font-label uppercase tracking-luxe text-[11px] text-champagne/75 hover:text-gold-300 border border-gold-400/20 transition-colors">
                    View the wall
                  </a>
                </>
              ) : (
                <>
                  <p className="font-sans text-sm text-champagne/60 max-w-sm leading-relaxed">
                    Pick a challenge in the booth before you snap — the first guests to finish them all take the top spots.
                  </p>
                  <a href={`${basePath}/booth`}
                    className="mt-5 inline-flex items-center gap-2 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] px-8 py-3 rounded-xl glow-accent">
                    <Camera className="w-4 h-4" /> Do a challenge
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
