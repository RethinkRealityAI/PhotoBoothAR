/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Polaroid card template — instant prints laid on the dusk. White print
 * stock with a squared window, a caption in the display face, every print
 * tilted a little off true, and a gloss that catches the light as you tilt
 * the phone (or move the mouse). The close is a print pressed with the
 * letterpress border, light running along its lines.
 *
 * Pure function of the normalized progress model (see ./types.ts): the page
 * shown is entirely determined by `index` (0 = the fanned cover stack,
 * 1..N = one print per contribution, N+1 = the closing print), and each
 * print's tilt/nudge is a pure function of the CONTRIBUTION ID via
 * lib/cardTemplates.ts — no Math.random.
 *
 * `frameProgress`, when a renderer supplies it, drives the entrance
 * deterministically (polaroidEntrance) instead of the interactive spring.
 */
import { AnimatePresence, motion } from 'motion/react';
import { clampIndex, pageCount, type CardTemplateProps } from './types';
import {
  polaroidEntrance,
  polaroidFan,
  polaroidPlacement,
  type PolaroidPlacement,
} from '../../../lib/cardTemplates';
import type { CardViewContribution } from '../../../lib/cards';
import CardOrnament from './cardOrnament';
import {
  BeamGlow,
  CardPhoto,
  CardVideo,
  ClosingContent,
  CoverTitle,
  NoteCard,
  OpenButton,
  Pager,
  TiltSheen,
  useSwipe,
} from './cardParts';

/** Print stock + its ink, both from semantic tokens (never raw hex). */
const PAPER = 'bg-[color:var(--color-brand-text)] text-[color:var(--color-brand-bg)]';
const PRINT_SHADOW =
  'shadow-[0_26px_50px_-18px_rgba(10,8,40,0.85),0_2px_6px_rgba(10,8,40,0.25),inset_0_0_0_1px_rgba(255,255,255,0.9)]';
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
      className={`${PAPER} ${PRINT_SHADOW} rounded-[4px] p-3 pb-5 ${className}`}
      style={{ transform: transformFor(placement, centered), zIndex }}
    >
      {children}
    </div>
  );
}

/** The squared photo window — dark inside, so a loading image is never a hole. */
function Window({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <div
      className={`relative w-full aspect-square overflow-hidden bg-[color:var(--color-brand-bg)] ${className}`}
      style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)' }}
    >
      {children}
    </div>
  );
}

function FanTile({ c }: { c: CardViewContribution | undefined }) {
  if (c?.mediaType === 'photo' && c.url) {
    return <img src={c.url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />;
  }
  if (c?.mediaType === 'video' && c.url) {
    return (
      <video
        src={`${c.url}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
        aria-hidden
        tabIndex={-1}
      />
    );
  }
  return (
    <span
      className="absolute inset-0 flex items-center justify-center font-serif text-4xl text-[color:var(--color-accent)]"
      aria-hidden
    >
      “
    </span>
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
  const swipe = useSwipe(onNext, onPrev);
  const interactive = onNext !== undefined || onPrev !== undefined;

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
    <div className="relative flex h-full w-full flex-col items-center">
      <div className="relative w-full max-w-[30rem] min-h-0 flex-1 py-2" style={{ touchAction: 'pan-y' }} {...swipe}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            className="absolute inset-0 flex flex-col items-center overflow-y-auto px-4 py-4 text-center"
            style={{ scrollbarWidth: 'none' }}
            initial={initial}
            animate={animate}
            exit={reducedMotion || driven ? { opacity: 1 } : { opacity: 0, y: -14, scale: 0.98 }}
            transition={transition}
          >
            <div className="my-auto flex w-full flex-col items-center">
              {isCover && (
                <>
                  {/* Fanned stack of the first prints, in front of a beam. */}
                  <div className="relative mb-12 mt-2 h-[13.5rem] w-full shrink-0">
                    <BeamGlow reducedMotion={reducedMotion} className="inset-x-[6%] -inset-y-[10%]" />
                    {fan.map((placement, i) => {
                      const c = fanSource[i];
                      const centre = i === Math.floor(fan.length / 2);
                      return (
                        <Print
                          key={c ? c.id : 'cover-blank'}
                          placement={placement}
                          centered
                          zIndex={centre ? 3 : 1}
                          className="absolute left-1/2 top-1/2 w-[8.6rem] p-2.5 pb-4"
                        >
                          <Window>
                            <FanTile c={c} />
                            {centre && <TiltSheen reducedMotion={reducedMotion} />}
                          </Window>
                          <p className="mt-2 truncate font-serif text-[12px] font-medium opacity-70">
                            {c?.contributorName || card.recipientName || 'Beamwall'}
                          </p>
                        </Print>
                      );
                    })}
                  </div>
                  <CoverTitle card={card} contributions={contributions} />
                  <div className="mt-8">
                    <OpenButton onClick={onNext} label="Look through the prints" />
                  </div>
                </>
              )}

              {contribution && (contribution.mediaType === 'text' || !contribution.url) && (
                <div className="w-full max-w-sm">
                  <NoteCard c={contribution} />
                </div>
              )}

              {contribution && contribution.mediaType !== 'text' && contribution.url && (
                <Print placement={polaroidPlacement(contribution.id)} className="w-[min(88%,22rem)] shrink-0">
                  <Window>
                    {contribution.mediaType === 'photo' ? (
                      <CardPhoto c={contribution} reducedMotion={reducedMotion} className="absolute inset-0" />
                    ) : (
                      <CardVideo c={contribution} className="absolute inset-0" compact />
                    )}
                    {contribution.mediaType === 'photo' && <TiltSheen reducedMotion={reducedMotion} />}
                  </Window>
                  {contribution.message && (
                    <p className="mt-4 px-1 font-serif text-[18px] font-medium leading-snug text-balance">
                      {contribution.message}
                    </p>
                  )}
                  <p className="mt-3 flex items-center justify-center gap-2 px-1 font-serif text-[15px] opacity-70">
                    <span className="h-px w-5 bg-current opacity-50" aria-hidden />
                    {contribution.contributorName || 'A friend'}
                  </p>
                </Print>
              )}

              {isEnd && (
                <div className="relative w-full overflow-hidden rounded-[1.8rem] px-10 pb-[5.5rem] pt-[5.5rem]">
                  <div className="liquid-glass absolute inset-0 rounded-[1.8rem]" aria-hidden />
                  <CardOrnament density="full" reducedMotion={reducedMotion} />
                  <div className="relative">
                    <ClosingContent card={card} contributions={contributions} scratch={interactive} />
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Desktop click zones (touch swipes); skipped on video pages so the
            player stays fully clickable. */}
        {contribution?.mediaType !== 'video' && onPrev && page > 0 && (
          <button
            type="button"
            aria-label="Previous print"
            onClick={onPrev}
            className="absolute left-0 top-0 hidden h-full w-[12%] cursor-w-resize md:block"
          />
        )}
        {contribution?.mediaType !== 'video' && onNext && page < total - 1 && (
          <button
            type="button"
            aria-label="Next print"
            onClick={onNext}
            className="absolute right-0 top-0 hidden h-full w-[12%] cursor-e-resize md:block"
          />
        )}
      </div>

      <Pager page={page} total={total} onPrev={onPrev} onNext={onNext} noun="print" className="shrink-0 pb-1 pt-2" />
    </div>
  );
}
