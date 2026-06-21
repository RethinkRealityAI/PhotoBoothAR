/**
 * Challenge selector — a prominent gold "Challenges" button that opens a sheet.
 *
 * Challenge mode is name-gated: the guest enters their name once (saved to this
 * device) so the leaderboard isn't anonymous, then picks a challenge. Challenges
 * they've already completed drop off the list (tracked locally + hydrated from
 * this session's submitted posts). Winners are the first three to finish them
 * all (see db.fetchLeaderboard).
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, X, Check, ChevronUp, Pencil } from 'lucide-react';
import { useStore } from '../../store';
import { Challenge } from '../../types';
import {
  getGuestName, setGuestName,
  getCompletedChallenges, addCompletedChallenges,
} from '../../lib/session';
import { fetchMyPosts } from '../../lib/db';

interface Props {
  selectedChallenge: Challenge | null;
  onSelect: (c: Challenge | null) => void;
}

export default function ChallengeSelector({ selectedChallenge, onSelect }: Props) {
  const { challenges, challengesLoaded, fetchChallenges } = useStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [completed, setCompleted] = useState<string[]>(() => getCompletedChallenges());
  const [nameInput, setNameInput] = useState<string>(() => getGuestName());
  const [needName, setNeedName] = useState(false);

  useEffect(() => {
    if (!challengesLoaded) fetchChallenges(true);
  }, [challengesLoaded, fetchChallenges]);

  // Hydrate completed-challenge set from this session's tagged posts + listen for changes.
  useEffect(() => {
    let alive = true;
    fetchMyPosts()
      .then((posts) => {
        const ids = posts.map((p) => p.challenge_id).filter(Boolean) as string[];
        if (ids.length) addCompletedChallenges(ids);
        if (alive) setCompleted(getCompletedChallenges());
      })
      .catch(() => {});
    const onChange = () => setCompleted(getCompletedChallenges());
    window.addEventListener('challenges:changed', onChange);
    return () => { alive = false; window.removeEventListener('challenges:changed', onChange); };
  }, []);

  const active = challenges.filter((c) => c.active);
  if (active.length === 0 && challengesLoaded) return null;

  const completedSet = new Set(completed);
  const available = active.filter((c) => !completedSet.has(c.id));
  const allDone = active.length > 0 && available.length === 0;
  const doneCount = active.length - available.length;

  const openSheet = () => {
    setNameInput(getGuestName());
    setNeedName(!getGuestName());
    setSheetOpen(true);
  };
  const close = () => setSheetOpen(false);

  const confirmName = () => {
    const n = nameInput.trim();
    if (n.length < 2) return;
    setGuestName(n);
    setNeedName(false);
  };

  return (
    <>
      {/* Trigger */}
      {selectedChallenge ? (
        <div className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-full bg-gold-400/15 border border-gold-400/45 glow-soft">
          <Trophy className="w-3.5 h-3.5 text-gold-300 shrink-0" />
          <span className="font-label text-[9px] uppercase tracking-wide text-gold-200 max-w-[92px] truncate">
            {selectedChallenge.title}
          </span>
          <button onClick={() => onSelect(null)} className="text-gold-300/60 hover:text-ivory transition-colors" aria-label="Remove challenge">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={openSheet}
          className="flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full bg-gold-400/15 border border-gold-400/45 text-gold-200 hover:bg-gold-400/25 hover:border-gold-400/70 transition-all glow-soft active:scale-95"
        >
          <Trophy className="w-4 h-4 text-gold-300" />
          <span className="font-label text-[9px] uppercase tracking-luxe">Challenges</span>
          {available.length > 0 ? (
            <span className="min-w-[16px] h-4 px-1 rounded-full bg-foil text-noir-900 font-label text-[9px] flex items-center justify-center">
              {available.length}
            </span>
          ) : allDone ? (
            <Check className="w-3.5 h-3.5 text-gold-300" />
          ) : (
            <ChevronUp className="w-3 h-3 text-gold-300/50" />
          )}
        </button>
      )}

      {/* Sheet */}
      <AnimatePresence>
        {sheetOpen && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-end justify-center bg-noir-900/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          >
            <motion.div
              className="w-full max-w-md glass-strong rounded-t-3xl px-6 pt-6 pb-safe-bottom pb-8"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-champagne/20 mx-auto mb-5" />

              {needName ? (
                /* ── Name step (required before entering challenge mode) ── */
                <div className="text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-foil glow-accent flex items-center justify-center">
                    <Trophy className="w-6 h-6 text-noir-900" />
                  </div>
                  <h3 className="font-serif text-2xl text-ivory mb-1">Enter the Challenges</h3>
                  <p className="font-sans text-[13px] text-champagne/60 leading-relaxed mb-5 max-w-xs mx-auto">
                    Add your name so we can crown the winners. The first three guests to finish every challenge take 1st, 2nd &amp; 3rd place!
                  </p>
                  <input
                    type="text"
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value.slice(0, 60))}
                    onKeyDown={(e) => e.key === 'Enter' && confirmName()}
                    placeholder="Your name"
                    className="w-full text-center bg-noir-800/70 border border-gold-400/25 rounded-xl px-4 py-3 font-sans text-base text-ivory placeholder-champagne/30 outline-none focus:border-gold-400/60 transition-colors mb-4"
                  />
                  <div className="flex gap-3">
                    <button onClick={close} className="flex-1 glass rounded-xl px-4 py-3 font-label uppercase tracking-luxe text-[11px] text-champagne/60 hover:text-ivory transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={confirmName}
                      disabled={nameInput.trim().length < 2}
                      className="flex-1 bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl px-4 py-3 hover:brightness-110 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Challenge list ── */
                <>
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <h3 className="font-serif text-xl text-ivory">Gala Challenges</h3>
                      <p className="font-sans text-xs text-champagne/50 mt-0.5">
                        {doneCount} of {active.length} complete · be one of the first 3 to finish them all
                      </p>
                    </div>
                    <button onClick={close} className="w-8 h-8 rounded-full glass flex items-center justify-center text-champagne/40 hover:text-ivory shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Greeting + change name */}
                  <button
                    onClick={() => { setNameInput(getGuestName()); setNeedName(true); }}
                    className="flex items-center gap-1.5 mb-4 text-gold-300/80 hover:text-gold-200 transition-colors"
                  >
                    <span className="font-label text-[9px] uppercase tracking-luxe">Playing as {getGuestName() || 'Guest'}</span>
                    <Pencil className="w-3 h-3" />
                  </button>

                  {allDone ? (
                    <div className="py-8 text-center">
                      <div className="text-5xl mb-3">🏆</div>
                      <p className="font-serif italic text-xl text-foil-static mb-1">All challenges complete!</p>
                      <p className="font-sans text-xs text-champagne/50">Check the live wall leaderboard to see if you made the top three.</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto hide-scrollbar">
                      {available.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { onSelect(c); close(); }}
                          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-left glass hover:border-gold-400/30 border border-transparent active:scale-[0.99]"
                        >
                          <span className="text-2xl flex-shrink-0">{c.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-sans text-sm text-ivory font-medium">{c.title}</p>
                            {c.description && (
                              <p className="font-sans text-xs text-champagne/50 mt-0.5 line-clamp-2">{c.description}</p>
                            )}
                          </div>
                          <span className="font-label text-[8px] uppercase tracking-wide text-gold-400 flex-shrink-0">+{c.points}pts</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Skip */}
                  <button
                    onClick={() => { onSelect(null); close(); }}
                    className="w-full mt-3 text-center font-label text-[9px] uppercase tracking-luxe text-champagne/35 hover:text-champagne/60 transition-colors"
                  >
                    Skip — no challenge this time
                  </button>
                  <p className="mt-2 text-center font-label text-[8px] uppercase tracking-luxe text-champagne/20">
                    Tagged when you send to the wall
                  </p>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
