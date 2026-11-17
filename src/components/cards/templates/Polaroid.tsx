/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Polaroid card template — scattered instant prints. Warm paper, a squared
 * photo window, a handwritten-feel caption in the platform serif, and every
 * print tilted a little off true.
 *
 * Pure function of the normalized progress model (see ./types.ts): the page
 * shown is entirely determined by `index` (0 = the fanned cover stack,
 * 1..N = one print per contribution, N+1 = the closing print), and the tilt /
 * nudge of each print is a pure function of the CONTRIBUTION ID via
 * lib/cardTemplates.ts — no Math.random, so a print lands at the same angle on
 * every render, in StrictMode's double-invoke, and in a frame-by-frame render.
 *
 * `frameProgress`, when a renderer supplies it, drives the entrance
 * deterministically (polaroidEntrance) instead of the interactive spring —
 * which is what makes this template render identically frame for frame.
 */
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clampIndex, pageCount, type CardTemplateProps } from './types';
import {
  polaroidEntrance,
  polaroidFan,
  polaroidPlacement,
  type PolaroidPlacement,
} from '../../../lib/cardTemplates';
import type { CardViewContribution } from '../../../lib/cards';

/** Warm print stock + its ink, both from semantic tokens (never raw hex). */
const PAPER = 'bg-[color:var(--color-brand-text)] text-[color:var(--color-brand-bg)]';
const PRINT_SHADOW = 'shadow-[0_18px_44px_rgba(0,0,0,0.55)]';
/** How many prints the cover fans (a stack, not a contact sheet). */
const COVER_FAN_MAX = 3;

function transformFor(p: PolaroidPlacement, centered: boolean): string {
  const base = centered ? 'translate(-50%, -50%) ' : '';
  return `${base}translate(${p.offsetXPct}%, ${p.offsetYPct}%) rotate(${p.rotationDeg}deg)`;
}

/** One instant print: paper, a squared window, and the wide bottom lip. */
function Print({
  placement,
  centered = false,
  className = '',
  zIndex,
  children,
}: {
  placement: PolaroidPlacement;
  centered?: boolean;
  className?: string;
  zIndex?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${PAPER} ${PRINT_SHADOW} rounded-[3px] p-2.5 pb-4 ${className}`}
      style={{ transform: transformFor(placement, centered), zIndex }}
    >
      {children}
    </div>
  );
}

/** The squared photo window — dark inside, so a loading image is never a hole. */
function Window({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={`relative w-full aspect-square overflow-hidden bg-[color:var(--color-brand-bg)] ${className}`}>
      {children}
    </div>
  );
}

function ContributionMedia({ c }: { c: CardViewContribution }) {
  if (c.mediaType === 'photo' && c.url) {
    return (
      <img
        src={c.url}
        alt={c.contributorName ? `From ${c.contributorName}` : 'Contribution'}
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  if (c.mediaType === 'video' && c.url) {
    return (
      <video
        key={c.id}
        src={c.url}
        controls
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  // A written note still gets a print — the message IS the picture.
  return (
    <div className="absolute inset-0 flex items-center justify-center px-5 text-center">
      <p className="font-serif italic text-[15px] leading-relaxed text-brand-fg/90 line-clamp-6">
        “{c.message}”
      </p>
    </div>
  );
}

export default function Polaroid({
  card,
  contributions,
  index,
  frameProgress,
  onNext,
  onPrev,
  reducedMotion = false,
}: CardTemplateProps) {
  const total = pageCount(contributions);
  const page = clampIndex(index, contributions);
  const isCover = page === 0;
  const isEnd = page === total - 1;
  const contribution = !isCover && !isEnd ? contributions[page - 1] : null;

  // Driven (frame-by-frame) renders get the deterministic entrance; the
  // interactive viewer gets the spring; reduced motion gets neither.
  const driven = typeof frameProgress === 'number';
  const entrance = driven ? polaroidEntrance(frameProgress as number) : null;
  const animate = entrance
    ? { opacity: entrance.opacity, y: entrance.y, scale: entrance.scale }
    : { opacity: 1, y: 0, scale: 1 };
  const initial = driven || reducedMotion ? false : { opacity: 0, y: 26, scale: 0.96 };
  const transition =
    driven || reducedMotion
      ? { duration: 0 }
      : ({ type: 'spring', stiffness: 210, damping: 26, mass: 0.9 } as const);

  // A cover is a stack of PHOTOS: prints with media come first, and written
  // notes only fill the fan when there are not enough pictures to fill it.
  const withMedia = contributions.filter((c) => Boolean(c.url));
  const fanSource = (withMedia.length > 0 ? withMedia : contributions).slice(0, COVER_FAN_MAX);
  const fan = polaroidFan(fanSource.length > 0 ? fanSource.map((c) => c.id) : [card.title]);

  return (
    <div className="relative w-full h-full flex flex-col items-center">
      <div className="relative flex-1 w-full max-w-md min-h-0 py-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto px-3 py-2 text-center"
            initial={initial}
            animate={animate}
            exit={reducedMotion || driven ? { opacity: 1 } : { opacity: 0, y: -14, scale: 0.98 }}
            transition={transition}
          >
            {isCover && (
              <>
                {/* Fanned stack of the first prints. */}
                <div className="relative mb-7 h-44 w-full shrink-0">
                  {fan.map((placement, i) => {
                    const c = fanSource[i];
                    return (
                      <Print
                        key={c ? c.id : 'cover-blank'}
                        placement={placement}
                        centered
                        zIndex={i === Math.floor(fan.length / 2) ? 3 : 1}
                        className="absolute left-1/2 top-1/2 w-[7rem]"
                      >
                        <Window>
                          {c?.mediaType === 'photo' && c.url && (
                            <img src={c.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                          )}
                          {c?.mediaType === 'video' && c.url && (
                            <video
                              src={c.url}
                              muted
                              playsInline
                              preload="metadata"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          )}
                          {!c?.url && (
                            <span
                              className="absolute inset-0 flex items-center justify-center font-serif italic text-3xl text-accent/40"
                              aria-hidden
                            >
                              “
                            </span>
                          )}
                        </Window>
                        <p className="mt-1.5 truncate font-serif italic text-[10px] text-[color:var(--color-brand-bg)]/60">
                          {c?.contributorName || card.recipientName || 'Beamwall'}
                        </p>
                      </Print>
                    );
                  })}
                </div>

                {card.eventName && (
                  <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">{card.eventName}</p>
                )}
                <h1 className="mt-3 font-serif italic text-[2rem] leading-tight text-foil-static">{card.title}</h1>
                {card.recipientName && (
                  <p className="mt-3 font-sans text-sm text-brand-muted/80">for {card.recipientName}</p>
                )}
                <div className="mt-6 h-px w-24 bg-accent/40" />
                <p className="mt-5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">
                  {contributions.length} {contributions.length === 1 ? 'print' : 'prints'} inside
                </p>
              </>
            )}

            {contribution && (
              <Print
                placement={polaroidPlacement(contribution.id)}
                className="w-[min(84%,17rem)] shrink-0"
              >
                <Window>
                  <ContributionMedia c={contribution} />
                </Window>
                {contribution.message && contribution.mediaType !== 'text' && (
                  <p className="mt-3 px-1 font-serif italic text-[13px] leading-snug text-[color:var(--color-brand-bg)]/80 line-clamp-3">
                    {contribution.message}
                  </p>
                )}
                <p className="mt-2.5 px-1 font-serif italic text-[15px] text-[color:var(--color-brand-bg)]/70">
                  — {contribution.contributorName || 'A friend'}
                </p>
              </Print>
            )}

            {isEnd && (
              <>
                <Print placement={polaroidPlacement(`${card.title}-end`)} className="w-[min(72%,14rem)] shrink-0">
                  <Window>
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <p className="font-serif italic text-2xl text-foil-static">The end</p>
                      <div className="h-px w-12 bg-accent/40" />
                    </div>
                  </Window>
                  <p className="mt-3 font-serif italic text-[13px] text-[color:var(--color-brand-bg)]/70">
                    {card.recipientName ? `With love — to ${card.recipientName}.` : 'With love, from everyone.'}
                  </p>
                </Print>
                <p className="mt-7 font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">
                  Made with Beamwall
                </p>
                <Link
                  to="/"
                  className="mt-3 inline-flex min-h-[44px] items-center rounded-full border border-white/15 bg-white/[0.05] px-6 font-label uppercase tracking-luxe text-[10px] text-brand-fg transition hover:bg-white/[0.1]"
                >
                  Create your own
                </Link>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Click zones (interactive mode only; skipped on video pages so the
            player controls stay fully clickable). */}
        {contribution?.mediaType !== 'video' && onPrev && page > 0 && (
          <button aria-label="Previous print" onClick={onPrev} className="absolute left-0 top-0 h-full w-1/5 cursor-w-resize" />
        )}
        {contribution?.mediaType !== 'video' && onNext && page < total - 1 && (
          <button aria-label="Next print" onClick={onNext} className="absolute right-0 top-0 h-full w-1/5 cursor-e-resize" />
        )}
      </div>

      {/* Pager */}
      <div className="shrink-0 flex items-center gap-4 pb-2">
        {onPrev && (
          <button
            onClick={onPrev}
            disabled={page === 0}
            aria-label="Previous print"
            className="w-11 h-11 rounded-full bg-white/[0.06] flex items-center justify-center text-brand-fg/80 hover:bg-white/[0.12] transition disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`rounded-full transition-all ${i === page ? 'w-5 h-1.5 bg-accent/80' : 'w-1.5 h-1.5 bg-white/20'}`}
            />
          ))}
        </div>
        {onNext && (
          <button
            onClick={onNext}
            disabled={page === total - 1}
            aria-label="Next print"
            className="w-11 h-11 rounded-full bg-white/[0.06] flex items-center justify-center text-brand-fg/80 hover:bg-white/[0.12] transition disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
