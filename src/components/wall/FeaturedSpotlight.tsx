/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FeaturedSpotlight — periodic full-screen spotlight overlay for the wall's
 * Gallery mode. Every `intervalSec` seconds it surfaces one post (or, every
 * 4th slot, a CTA card: join-QR / top-3 leaderboard / active challenge) for
 * ~8 s over a dimmed backdrop, then fades away.
 *
 * - Rotation/pick logic is pure (src/lib/wallSpotlight.ts, tested).
 * - `pendingFeatureId`: a just-beamed-in post is spotlighted ~2.5 s after the
 *   beam ceremony clears (fresh-post payoff), then the cadence resets.
 * - `suspended` (beam-in or lightbox open): active spotlight exits fast
 *   (0.3 s) and the interval pauses; it re-arms on resume.
 * - Overlay is pointer-events-none except the card; clicking a photo opens
 *   the wall lightbox via `onSelect`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Crown } from 'lucide-react';
import { useStore } from '../../store';
import { Post, Challenge, LeaderboardEntry } from '../../types';
import { QRPanel } from './WallQRCodes';
import { enabledCtaKinds, slotForTick, pickSpotlightPost, CtaKind } from '../../lib/wallSpotlight';

const SHOW_MS = 8000;
const PENDING_DELAY_MS = 2500;
const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface Props {
  posts: Post[];
  enabled: boolean;
  /** Seconds between spotlight appearances. */
  intervalSec: number;
  /** Freshly beamed-in post to feature next (Wall realtime insert handler). */
  pendingFeatureId: string | null;
  onConsumePending: () => void;
  /** True while a beam-in or the lightbox is up — never cover those. */
  suspended: boolean;
  onSelect?: (p: Post) => void;
  showQR: boolean;
  showLeaderboard: boolean;
  showChallenges: boolean;
  /** Site origin + event base path (QR base URL), as passed to WallQRCodes. */
  origin: string;
}

type KbConfig = { from: { scale: number; x: number; y: number }; to: { scale: number; x: number; y: number } };

// Ken-Burns keyframe configs — same drift family as SlideshowView (images only)
const KB_CONFIGS: KbConfig[] = [
  { from: { scale: 1.08, x: -2, y: -2 }, to: { scale: 1.18, x: 2, y: 2 } },
  { from: { scale: 1.1, x: 1, y: -1 }, to: { scale: 1.2, x: -2, y: 1 } },
  { from: { scale: 1.12, x: -1, y: 2 }, to: { scale: 1.06, x: 2, y: -2 } },
  { from: { scale: 1.15, x: 0, y: -1 }, to: { scale: 1.08, x: 0, y: 1 } },
];

type ActiveSpotlight =
  | { key: string; kind: 'photo'; post: Post; kb: KbConfig }
  | { key: string; kind: 'cta'; cta: CtaKind; challenge?: Challenge };

/** Small play badge for spotlighted video posts (SlideshowView idiom). */
function PlayBadge() {
  return (
    <div
      className="absolute top-3 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full"
      style={{
        background: 'rgba(10,7,3,0.65)',
        border: '1px solid rgba(var(--accent-rgb),0.3)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
        <path d="M0.5 1L7.5 5L0.5 9Z" fill="#D4AF37" />
      </svg>
      <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/70">Video</span>
    </div>
  );
}

const CARD_FRAME = {
  border: '1px solid rgba(var(--accent-rgb),0.25)',
  boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 40px rgba(var(--accent-rgb),0.12)',
};

// Crown colors + rank treatments — LeaderboardView idiom, compacted for a snippet.
const CROWN_COLOR = ['#F5C842', '#D6D6D6', '#CD8A4B']; // gold · silver · bronze
const RANK_STYLES: Record<number, { ring: string; glow: string; nameClass: string; bg: string }> = {
  0: { ring: '2px solid rgba(var(--accent-rgb),0.90)', glow: '0 0 24px rgba(var(--accent-rgb),0.55)', nameClass: 'text-foil-static font-serif italic text-lg', bg: 'rgba(var(--accent-rgb),0.10)' },
  1: { ring: '2px solid rgba(192,192,192,0.55)', glow: '0 0 16px rgba(192,192,192,0.28)', nameClass: 'text-ivory/95 font-serif italic text-lg', bg: 'rgba(180,180,180,0.06)' },
  2: { ring: '2px solid rgba(205,127,50,0.55)', glow: '0 0 16px rgba(205,127,50,0.25)', nameClass: 'text-ivory/90 font-serif italic text-lg', bg: 'rgba(205,127,50,0.07)' },
};

function LeaderboardSnippet({ entries }: { entries: LeaderboardEntry[] }) {
  const top = entries.slice(0, 3);
  return (
    <div className="glass-strong rounded-3xl px-8 py-7 w-[min(480px,66vw)]" style={CARD_FRAME}>
      <p className="font-serif italic text-3xl text-foil-static text-center mb-5">Leaderboard</p>
      {top.length === 0 ? (
        <p className="font-serif italic text-champagne/40 text-lg text-center py-4">
          No scores yet — be the first!
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {top.map((entry, rank) => {
            const style = RANK_STYLES[rank];
            return (
              <div
                key={entry.sessionId}
                className="flex items-center gap-3 px-4 py-2.5 rounded-2xl"
                style={{ background: style.bg, border: style.ring, boxShadow: style.glow }}
              >
                <Crown
                  className="w-5 h-5 shrink-0"
                  style={{ color: CROWN_COLOR[rank], filter: `drop-shadow(0 0 6px ${CROWN_COLOR[rank]}66)` }}
                  fill={CROWN_COLOR[rank]}
                  fillOpacity={0.22}
                />
                <p className={`flex-1 min-w-0 truncate ${style.nameClass}`}>{entry.name}</p>
                <p className="font-label text-champagne/80 text-base shrink-0">
                  {entry.points}
                  <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/40 ml-1">pts</span>
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChallengeCard({ challenge }: { challenge: Challenge }) {
  return (
    <div className="glass-strong rounded-3xl px-12 py-9 flex flex-col items-center gap-4 max-w-[66vw]" style={CARD_FRAME}>
      <span className="font-label uppercase tracking-luxe text-[10px] text-champagne/50">Challenge</span>
      <span style={{ fontSize: 56, lineHeight: 1 }}>{challenge.emoji}</span>
      <span className="font-serif italic text-ivory/90 text-3xl text-center max-w-md leading-tight">
        {challenge.title}
      </span>
      <span
        className="font-label uppercase tracking-luxe text-[10px] px-3 py-1 rounded-full"
        style={{
          background: 'rgba(var(--accent-rgb),0.12)',
          border: '1px solid rgba(var(--accent-rgb),0.22)',
          color: 'rgba(var(--accent-rgb),0.8)',
        }}
      >
        +{challenge.points} pts
      </span>
    </div>
  );
}

export default function FeaturedSpotlight({
  posts,
  enabled,
  intervalSec,
  pendingFeatureId,
  onConsumePending,
  suspended,
  onSelect,
  showQR,
  showLeaderboard,
  showChallenges,
  origin,
}: Props) {
  const { leaderboard, fetchLeaderboard, challenges, fetchChallenges } = useStore();
  const [active, setActive] = useState<ActiveSpotlight | null>(null);

  // Latest data in refs so the interval callback never goes stale (SlideshowView idiom).
  const postsRef = useRef(posts);
  useEffect(() => { postsRef.current = posts; }, [posts]);
  const ctaKindsRef = useRef<CtaKind[]>([]);
  const challengesRef = useRef<Challenge[]>([]);
  const activeChallenges = challenges.filter((c) => c.active);
  useEffect(() => {
    challengesRef.current = activeChallenges;
    ctaKindsRef.current = enabledCtaKinds({
      showQR,
      showLeaderboard,
      hasChallenges: showChallenges && activeChallenges.length > 0,
    });
  });

  const tickRef = useRef(0);
  const ctaChallengeRef = useRef(0);
  const recentRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Challenge titles for the CTA card (active ones; fail-soft to []).
  useEffect(() => {
    fetchChallenges(true);
  }, [fetchChallenges]);

  const armHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(null), SHOW_MS);
  }, []);

  const showPost = useCallback((post: Post) => {
    recentRef.current.add(post.id);
    setActive({
      key: `photo-${post.id}-${tickRef.current}`,
      kind: 'photo',
      post,
      kb: KB_CONFIGS[tickRef.current % KB_CONFIGS.length],
    });
    armHide();
  }, [armHide]);

  const showNext = useCallback(() => {
    const slot = slotForTick(tickRef.current, ctaKindsRef.current);
    tickRef.current += 1;
    if (slot.kind === 'cta' && slot.cta) {
      let challenge: Challenge | undefined;
      if (slot.cta === 'challenge') {
        const act = challengesRef.current;
        if (act.length === 0) return; // list emptied since pick — skip this beat
        challenge = act[ctaChallengeRef.current % act.length];
        ctaChallengeRef.current += 1;
      }
      if (slot.cta === 'leaderboard') fetchLeaderboard(); // fail-soft: keeps last/empty list
      setActive({ key: `cta-${slot.cta}-${tickRef.current}`, kind: 'cta', cta: slot.cta, challenge });
      armHide();
      return;
    }
    const { post, resetRecent } = pickSpotlightPost(postsRef.current, recentRef.current);
    if (resetRecent) recentRef.current.clear();
    if (!post) return;
    showPost(post);
  }, [armHide, fetchLeaderboard, showPost]);

  // Main cadence — paused entirely while suspended/disabled; re-armed on resume.
  useEffect(() => {
    if (!enabled || suspended) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setActive(null); // exits fast (0.3 s) when suspension caused this
      return;
    }
    intervalRef.current = setInterval(showNext, Math.max(5, intervalSec) * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [enabled, suspended, intervalSec, showNext]);

  // Fresh-post payoff: once unsuspended, wait 2.5 s then spotlight the new
  // post and restart the cadence from now.
  useEffect(() => {
    if (!enabled || suspended || pendingFeatureId === null) return;
    const t = setTimeout(() => {
      const post = postsRef.current.find((p) => p.id === pendingFeatureId) ?? null;
      onConsumePending();
      if (post === null) return;
      showPost(post);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(showNext, Math.max(5, intervalSec) * 1000);
    }, PENDING_DELAY_MS);
    return () => clearTimeout(t);
  }, [enabled, suspended, pendingFeatureId, onConsumePending, showPost, showNext, intervalSec]);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={active.key}
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none backdrop-blur-sm"
          style={{ background: 'rgba(10,7,3,0.55)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.4 } }}
          exit={{ opacity: 0, transition: { duration: suspended ? 0.3 : 0.8, ease: EASE_LUXE } }}
        >
          <motion.div
            className="pointer-events-auto"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: EASE_LUXE }}
          >
            {active.kind === 'photo' ? (
              <div
                className={`relative overflow-hidden rounded-2xl ${onSelect ? 'cursor-pointer' : ''}`}
                style={CARD_FRAME}
                onClick={onSelect ? () => onSelect(active.post) : undefined}
              >
                {active.post.media_type === 'video' ? (
                  <>
                    <video
                      src={active.post.image_url}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="max-w-[70vw] max-h-[72vh] object-contain block"
                      style={{ background: '#0a0703' }}
                    />
                    <PlayBadge />
                  </>
                ) : (
                  <motion.img
                    src={active.post.image_url}
                    alt={active.post.guest_name ?? 'Event moment'}
                    className="max-w-[70vw] max-h-[72vh] object-contain block"
                    style={{ background: '#0a0703', transformOrigin: 'center center' }}
                    initial={active.kb.from}
                    animate={active.kb.to}
                    transition={{ duration: SHOW_MS / 1000, ease: 'linear' }}
                    draggable={false}
                  />
                )}
                {/* Glass caption plate (SlideshowView idiom) */}
                {(active.post.guest_name || active.post.message) && (
                  <div className="absolute bottom-0 inset-x-0 flex justify-center pb-4 pointer-events-none">
                    <div
                      className="glass px-6 py-3 rounded-2xl max-w-xl text-center"
                      style={{
                        border: '1px solid rgba(var(--accent-rgb),0.25)',
                        boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 24px rgba(var(--accent-rgb),0.12)',
                      }}
                    >
                      {active.post.guest_name && (
                        <p className="font-serif italic text-xl text-ivory/95 leading-tight">
                          {active.post.guest_name}
                        </p>
                      )}
                      {active.post.message && (
                        <p className="font-sans text-champagne/75 text-sm mt-0.5 leading-snug">
                          {active.post.message}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : active.cta === 'qr' ? (
              <div className="glass-strong rounded-3xl px-12 py-9 flex flex-col items-center gap-5" style={CARD_FRAME}>
                <p className="font-serif italic text-3xl text-foil-static">Join the booth</p>
                <QRPanel url={`${origin}/`} label="Scan to join the booth" size={160} />
              </div>
            ) : active.cta === 'leaderboard' ? (
              <LeaderboardSnippet entries={leaderboard} />
            ) : active.challenge ? (
              <ChallengeCard challenge={active.challenge} />
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
