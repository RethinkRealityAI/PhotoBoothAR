/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Storybook card template — one contribution per "page" with an elegant page
 * transition. Dark, premium, theme-neutral platform styling (no event theme).
 *
 * Pure function of the normalized progress model (see ./types.ts): the page
 * shown is entirely determined by `index`; onNext/onPrev only wire the
 * interactive affordances. Renders identically frame-by-frame under a future
 * Remotion driver.
 */
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clampIndex, pageCount, type CardTemplateProps } from './types';

/** Ornate corner flourish (GoldFrameCard-style, standalone copy). */
function Corner({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={`absolute w-7 h-7 text-gold-400/60 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 20 C3 10.6 10.6 3 20 3" />
      <path d="M3 13 C3 7.5 7.5 3 13 3" strokeWidth="0.7" />
      <circle cx="10" cy="10" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full h-full rounded-[1.8rem] overflow-hidden border border-gold-400/25 bg-gradient-to-b from-white/[0.05] to-white/[0.015] shadow-[0_24px_90px_rgba(0,0,0,0.6)]">
      <div className="absolute inset-[10px] rounded-[1.4rem] border border-gold-400/15 pointer-events-none" />
      <Corner className="top-3 left-3" />
      <Corner className="top-3 right-3 rotate-90" />
      <Corner className="bottom-3 right-3 rotate-180" />
      <Corner className="bottom-3 left-3 -rotate-90" />
      <div className="relative w-full h-full flex flex-col items-center justify-center px-7 py-10 text-center overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

export default function Storybook({
  card,
  contributions,
  index,
  onNext,
  onPrev,
  reducedMotion = false,
}: CardTemplateProps) {
  const total = pageCount(contributions);
  const page = clampIndex(index, contributions);
  const isCover = page === 0;
  const isEnd = page === total - 1;
  const contribution = !isCover && !isEnd ? contributions[page - 1] : null;

  const transition = reducedMotion ? { duration: 0 } : { duration: 0.45, ease: 'easeOut' as const };

  return (
    <div className="relative w-full h-full flex flex-col items-center">
      {/* Page */}
      <div className="relative flex-1 w-full max-w-md min-h-0 py-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            className="absolute inset-0 py-4"
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, rotateY: 14, x: 42 }}
            animate={{ opacity: 1, rotateY: 0, x: 0 }}
            exit={reducedMotion ? { opacity: 1 } : { opacity: 0, rotateY: -12, x: -42 }}
            transition={transition}
            style={{ transformPerspective: 1100 }}
          >
            <PageShell>
              {isCover && (
                <>
                  {card.eventName && (
                    <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">{card.eventName}</p>
                  )}
                  <h1 className="mt-4 font-serif italic text-4xl leading-tight text-foil-static">{card.title}</h1>
                  {card.recipientName && (
                    <p className="mt-4 font-sans text-sm text-brand-muted/80">for {card.recipientName}</p>
                  )}
                  <div className="mt-8 h-px w-24 bg-gold-400/40" />
                  <p className="mt-6 font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">
                    {contributions.length} {contributions.length === 1 ? 'message' : 'messages'} inside
                  </p>
                </>
              )}

              {contribution && (
                <>
                  {contribution.mediaType === 'photo' && contribution.url && (
                    <img
                      src={contribution.url}
                      alt={contribution.contributorName ? `From ${contribution.contributorName}` : 'Contribution'}
                      className="max-h-[52%] max-w-full rounded-xl object-contain shadow-[0_12px_44px_rgba(0,0,0,0.5)]"
                    />
                  )}
                  {contribution.mediaType === 'video' && contribution.url && (
                    <video
                      key={contribution.id}
                      src={contribution.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="max-h-[52%] max-w-full rounded-xl shadow-[0_12px_44px_rgba(0,0,0,0.5)]"
                    />
                  )}
                  {contribution.message && (
                    <p className={`mt-5 font-serif italic leading-relaxed text-brand-fg/90 ${contribution.mediaType === 'text' ? 'text-xl' : 'text-sm'}`}>
                      “{contribution.message}”
                    </p>
                  )}
                  <p className="mt-5 font-label uppercase tracking-luxe text-[10px] text-gold-300/80">
                    — {contribution.contributorName || 'A friend'}
                  </p>
                </>
              )}

              {isEnd && (
                <>
                  <p className="font-serif italic text-3xl text-foil-static">The end</p>
                  {card.recipientName && (
                    <p className="mt-3 font-sans text-sm text-brand-muted/70">With love, from everyone — to {card.recipientName}.</p>
                  )}
                  <div className="mt-8 h-px w-24 bg-gold-400/40" />
                  <p className="mt-7 font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">Made with Beamwall</p>
                  <Link
                    to="/"
                    className="mt-4 rounded-full border border-white/15 bg-white/[0.05] px-6 py-2.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg hover:bg-white/[0.1] transition"
                  >
                    Create your own
                  </Link>
                </>
              )}
            </PageShell>
          </motion.div>
        </AnimatePresence>

        {/* Click zones (interactive mode only; skipped on video pages so the
            player controls stay fully clickable) */}
        {contribution?.mediaType !== 'video' && onPrev && page > 0 && (
          <button aria-label="Previous page" onClick={onPrev} className="absolute left-0 top-0 h-full w-1/5 cursor-w-resize" />
        )}
        {contribution?.mediaType !== 'video' && onNext && page < total - 1 && (
          <button aria-label="Next page" onClick={onNext} className="absolute right-0 top-0 h-full w-1/5 cursor-e-resize" />
        )}
      </div>

      {/* Pager */}
      <div className="shrink-0 flex items-center gap-4 pb-2">
        {onPrev && (
          <button
            onClick={onPrev}
            disabled={page === 0}
            aria-label="Previous page"
            className="w-10 h-10 rounded-full bg-white/[0.06] flex items-center justify-center text-brand-fg/80 hover:bg-white/[0.12] transition disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`rounded-full transition-all ${i === page ? 'w-5 h-1.5 bg-gold-400/80' : 'w-1.5 h-1.5 bg-white/20'}`}
            />
          ))}
        </div>
        {onNext && (
          <button
            onClick={onNext}
            disabled={page === total - 1}
            aria-label="Next page"
            className="w-10 h-10 rounded-full bg-white/[0.06] flex items-center justify-center text-brand-fg/80 hover:bg-white/[0.12] transition disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
