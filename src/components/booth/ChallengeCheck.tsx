/**
 * ChallengeCheck — the AI photo-check moment for challenges that require one.
 *
 * Two states over the captured photo:
 *   • 'checking' — a scanning sweep while the AI judges the shot against the
 *     challenge's requirement.
 *   • 'failed'   — the photo didn't match: a friendly reason + Retake (primary)
 *     or "Post without the challenge" (secondary — never traps the guest).
 *
 * Purely presentational; the Booth owns the validation call and phase.
 */
import { motion } from 'motion/react';
import { ScanEye, RefreshCw, Send } from 'lucide-react';

interface Props {
  dataUrl: string;
  phase: 'checking' | 'failed';
  challengeTitle?: string;
  reason?: string;
  onRetake: () => void;
  onPostAnyway: () => void;
}

export default function ChallengeCheck({
  dataUrl, phase, challengeTitle, reason, onRetake, onPostAnyway,
}: Props) {
  const checking = phase === 'checking';
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-hidden bg-noir-900/95 px-8 vignette">
      {/* Soft accent bloom */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[110vmin] w-[110vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.18) 0%, transparent 60%)' }}
      />

      {/* The captured photo, with a scanning sweep while checking */}
      <div className="relative aspect-[9/16] max-h-72 w-52 overflow-hidden rounded-2xl border border-gold-400/25 shadow-2xl">
        <img
          src={dataUrl}
          alt=""
          className="h-full w-full object-cover transition-all duration-500"
          style={{ filter: checking ? 'brightness(0.7)' : 'brightness(0.85)' }}
        />
        {checking && (
          <motion.div
            aria-hidden
            className="absolute inset-x-0 h-16"
            style={{
              background:
                'linear-gradient(to bottom, transparent, rgba(var(--accent-rgb),0.55), transparent)',
              boxShadow: '0 0 18px rgba(var(--accent-rgb),0.5)',
            }}
            initial={{ top: '-15%' }}
            animate={{ top: ['-15%', '100%'] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>

      {checking ? (
        <div className="space-y-2 text-center">
          <motion.div
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-foil glow-accent"
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ScanEye className="h-5 w-5 text-noir-900" />
          </motion.div>
          <p className="font-serif text-lg italic text-champagne/80">Checking your photo…</p>
          {challengeTitle && (
            <p className="font-sans text-[12px] text-champagne/50">
              for “{challengeTitle}”
            </p>
          )}
          <div className="flex justify-center gap-1.5 pt-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-gold-400/70"
                animate={{ opacity: [0.25, 1, 0.25], scale: [0.85, 1.1, 0.85] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
              />
            ))}
          </div>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex w-full max-w-xs flex-col items-center gap-4 text-center"
        >
          <div className="space-y-1.5">
            <p className="font-serif text-xl text-champagne/90">Not quite yet</p>
            <p className="font-sans text-sm leading-relaxed text-champagne/65">
              {reason || "That photo doesn't match the challenge — give it another go!"}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2.5">
            <button
              onClick={onRetake}
              className="flex items-center justify-center gap-2 rounded-xl bg-foil px-6 py-3.5 font-label text-xs uppercase tracking-luxe text-noir-900 glow-accent transition-all hover:brightness-110 active:scale-95"
            >
              <RefreshCw className="h-4 w-4" />
              Retake photo
            </button>
            <button
              onClick={onPostAnyway}
              className="glass flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-label text-[11px] uppercase tracking-wide text-champagne/60 transition-colors hover:text-ivory"
            >
              <Send className="h-3.5 w-3.5" />
              Post without the challenge
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
