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
import FetchFailed from './ui/FetchFailed';

export default function ChallengesPage() {
  const { eventId, basePath } = useEvent();
  const { challenges, challengesLoaded, challengesFailed, fetchChallenges } = useStore();
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
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar app-bg">
      <EventBackground density={22} />

      {/* Cross-page navigation — desktop pill; GuestNav also mounts the mobile
          bottom tab bar via portal, so this strip hides on small screens. */}
      <div className="hidden sm:flex sticky top-0 z-30 justify-center px-3 pt-4 pb-2"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)' }}>
        <GuestNav current="challenges" />
      </div>

      {/* Header. Compact on phones: the full-size lockup used to fill the first
          screen, so a guest saw the page title and none of the challenges. */}
      <div className="relative z-10 flex flex-col items-center pt-5 sm:pt-6 pb-5 px-4 text-center pt-safe-top [--safe-top:0.5rem]">
        <div className="scale-90 sm:scale-100 origin-top">
          <Wordmark size="md" />
        </div>
        <p className="mt-4 sm:mt-6 font-label uppercase tracking-luxe text-[10px] text-[color:var(--color-accent)]/75">Challenges</p>
        <p className="mt-1.5 font-serif italic text-[27px] sm:text-3xl text-foil-static leading-tight">
          {allDone ? 'You finished them all' : 'Complete them all'}
        </p>
        <span
          className="mt-3 h-px w-16 block"
          style={{ background: 'linear-gradient(to right, transparent, rgba(var(--accent-rgb),0.6), transparent)' }}
          aria-hidden
        />

        {active.length > 0 && (
          <div
            className="mt-5 w-full max-w-xs"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={active.length}
            aria-valuenow={doneCount}
            aria-label="Challenges completed"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/55">Your progress</span>
              <span className="font-label uppercase tracking-luxe text-[9px] text-[color:var(--color-accent)]">{doneCount}/{active.length}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-white/[0.07] overflow-hidden border border-white/10">
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
      <div className="relative z-10 px-4 sm:pb-16 max-w-2xl mx-auto pb-safe-bottom [--safe-bottom:7rem]">
        {!challengesLoaded ? (
          /* Skeletons in the real row shape, so nothing jumps when they land. */
          <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading challenges">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl liquid-glass h-[86px] animate-pulse"
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ))}
          </div>
        ) : active.length === 0 && challengesFailed ? (
          /* "This event hasn't added any challenges" is a claim about the
             host, not about our network — only make it when we actually know. */
          <FetchFailed what="the challenges" onRetry={() => fetchChallenges(true)} />
        ) : active.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="flex flex-col items-center py-16 text-center px-6"
          >
            <div className="w-20 h-20 rounded-full liquid-glass flex items-center justify-center mb-6 glow-accent">
              <Trophy className="w-9 h-9 text-[color:var(--color-accent)]" />
            </div>
            <p className="font-serif italic text-2xl text-foil-static mb-2">No challenges yet</p>
            <p className="font-sans text-brand-muted/70 text-sm max-w-xs leading-relaxed">
              This event hasn’t added any challenges. Step into the booth and capture a moment for the wall.
            </p>
            <a href={`${basePath}/booth`}
              className="pressable mt-7 inline-flex items-center gap-2 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] px-8 min-h-12 rounded-2xl glow-accent">
              <Camera className="w-4 h-4" /> Open the booth
            </a>
          </motion.div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {active.map((c, i) => {
                const done = completedSet.has(c.id);
                // An unfinished challenge is a thing to go and DO, so the whole
                // row is the tap target that takes the guest to the booth —
                // 44px-plus by construction, and it removes the "…and how do I
                // do it?" step the old static card left hanging.
                const Row = done ? 'div' : 'a';
                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 18, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.45, delay: Math.min(i * 0.05, 0.5), ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Row
                      {...(done ? {} : { href: `${basePath}/booth` })}
                      className={`pressable relative flex items-center gap-3.5 rounded-2xl liquid-glass p-4 min-h-[76px] ${
                        done ? 'opacity-65' : ''
                      }`}
                      aria-label={done ? undefined : `${c.title} — open the booth`}
                    >
                      <span className="text-3xl shrink-0 leading-none" aria-hidden>{c.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-sans text-[15px] text-brand-fg font-medium leading-tight">{c.title}</p>
                        {c.description && (
                          <p className="font-sans text-xs text-brand-muted/60 mt-1 leading-snug line-clamp-2">{c.description}</p>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1.5">
                        <span className="font-label text-[9px] uppercase tracking-luxe text-[color:var(--color-accent)]">
                          +{c.points}
                        </span>
                        {done ? (
                          <span
                            className="w-7 h-7 rounded-full flex items-center justify-center bg-foil"
                            title="Completed"
                          >
                            <Check className="w-4 h-4 text-[color:var(--on-accent)]" />
                          </span>
                        ) : (
                          <span className="w-7 h-7 rounded-full border border-white/20" aria-hidden />
                        )}
                      </div>
                    </Row>
                  </motion.div>
                );
              })}
            </div>

            <div className="mt-8 flex flex-col items-center text-center">
              {allDone ? (
                <>
                  <div className="text-4xl mb-2" aria-hidden>🏆</div>
                  <p className="font-serif italic text-xl text-foil-static">
                    Every one of them — go and see the leaderboard.
                  </p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                    <a href={`${basePath}/wall`}
                      className="pressable inline-flex items-center gap-2 bg-foil text-[color:var(--on-accent)] rounded-2xl px-7 min-h-12 font-label uppercase tracking-luxe text-[11px] glow-accent">
                      View the wall
                    </a>
                    <a href={`${basePath}/me`}
                      className="pressable inline-flex items-center gap-2 rounded-2xl px-7 min-h-12 font-label uppercase tracking-luxe text-[11px] text-brand-fg bg-white/[0.07] border border-white/10">
                      Your moments
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <p className="font-sans text-sm text-brand-muted/70 max-w-sm leading-relaxed">
                    Pick a challenge in the booth before you snap — the first guests to finish them all take the top spots.
                  </p>
                  <a href={`${basePath}/booth`}
                    className="pressable mt-5 inline-flex items-center gap-2 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] px-8 min-h-12 rounded-2xl glow-accent">
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
