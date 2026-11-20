/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Storybook card template — one contribution per page, turned like a book.
 *
 * Each page is a pane of liquid glass pressed with letterpress linework (see
 * cardOrnament.tsx) that a slow light pulse runs along. The cover is the
 * lead photo in an arched window ringed with travelling light (the face the
 * reveals land on, one step richer), the title set big in
 * the display face; contributions get their photo or video large, the message
 * set by its length, and a signature; written-only notes are frosted paper
 * you can hold to warm; the close names everyone under a scratch-off foil.
 *
 * Pure function of the normalized progress model (see ./types.ts): the page
 * shown is entirely determined by `index`; onNext/onPrev only wire the
 * interactive affordances (arrows, desktop click zones, touch swipe). With
 * no handlers (a static/frame render) the close renders already revealed.
 */
import { AnimatePresence, motion } from 'motion/react';
import { clampIndex, pageCount, type CardTemplateProps } from './types';
import type { CardViewContribution } from '../../../lib/cards';
import CardOrnament from './cardOrnament';
import { ShimmerRim } from './cardChrome';
import {
  ClosingContent,
  ContributionMedia,
  CoverArch,
  CoverTitle,
  Message,
  NoteCard,
  OpenButton,
  PageMark,
  Pager,
  Signature,
  TiltSheen,
  useSwipe,
} from './cardParts';

function PageShell({
  children,
  density,
  reducedMotion,
  sheen = false,
}: {
  children: React.ReactNode;
  density: 'full' | 'light';
  reducedMotion: boolean;
  sheen?: boolean;
}) {
  return (
    <div className="absolute inset-0 rounded-[2rem]">
      <div className="liquid-glass h-full w-full overflow-hidden rounded-[2rem]">
        {sheen && <TiltSheen reducedMotion={reducedMotion} />}
        <CardOrnament density={density} reducedMotion={reducedMotion} />
        <div
          className="relative flex h-full w-full flex-col items-center overflow-y-auto overscroll-contain px-8 py-11 text-center sm:px-12"
          style={{ scrollbarWidth: 'none' }}
        >
          <div className="my-auto flex w-full flex-col items-center">{children}</div>
        </div>
      </div>
      {/* The signature rim: light travelling round the page's edge. */}
      <ShimmerRim radius="2rem" width={1.5} lapS={9} reducedMotion={reducedMotion} />
    </div>
  );
}

export function ContributionPage({
  c,
  n,
  of,
  reducedMotion,
}: {
  c: CardViewContribution;
  n: number;
  of: number;
  reducedMotion: boolean;
}) {
  if (c.mediaType === 'text' || !c.url) {
    return (
      <>
        <PageMark n={n} of={of} />
        <div className="mt-5 w-full max-w-sm">
          <NoteCard c={c} />
        </div>
      </>
    );
  }
  return (
    <>
      <PageMark n={n} of={of} />
      <ContributionMedia
        c={c}
        reducedMotion={reducedMotion}
        className="mt-4 aspect-[4/5] w-full max-w-[22rem] max-h-[min(52dvh,30rem)]"
      />
      <Message message={c.message} className="mt-6 max-w-md" />
      <Signature name={c.contributorName} className="mt-4" />
    </>
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
  const swipe = useSwipe(onNext, onPrev);
  const interactive = onNext !== undefined || onPrev !== undefined;

  // A page turn should settle like paper, not stop dead.
  const transition = reducedMotion
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 190, damping: 24, mass: 0.9 } as const);

  return (
    <div className="relative flex h-full w-full flex-col items-center">
      <div
        className="relative w-full max-w-[30rem] min-h-0 flex-1 py-3"
        style={{ touchAction: 'pan-y' }}
        {...swipe}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            className="absolute inset-0 py-3"
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, rotateY: 14, x: 42 }}
            animate={{ opacity: 1, rotateY: 0, x: 0 }}
            exit={reducedMotion ? { opacity: 1 } : { opacity: 0, rotateY: -12, x: -42 }}
            transition={transition}
            style={{ transformPerspective: 1100 }}
          >
            <PageShell density={contribution ? 'light' : 'full'} reducedMotion={reducedMotion} sheen={isCover}>
              {isCover && (
                <>
                  <CoverArch card={card} contributions={contributions} reducedMotion={reducedMotion} className="mb-8 mt-3" />
                  <CoverTitle card={card} contributions={contributions} />
                  <div className="mt-7">
                    <OpenButton onClick={onNext} reducedMotion={reducedMotion} />
                  </div>
                </>
              )}
              {contribution && (
                <ContributionPage c={contribution} n={page} of={contributions.length} reducedMotion={reducedMotion} />
              )}
              {isEnd && <ClosingContent card={card} contributions={contributions} scratch={interactive} />}
            </PageShell>
          </motion.div>
        </AnimatePresence>

        {/* Desktop click zones at the page edges (touch swipes instead);
            skipped on video pages so the player stays fully clickable. */}
        {contribution?.mediaType !== 'video' && onPrev && page > 0 && (
          <button
            type="button"
            aria-label="Previous page"
            onClick={onPrev}
            className="absolute left-0 top-0 hidden h-full w-[12%] cursor-w-resize md:block"
          />
        )}
        {contribution?.mediaType !== 'video' && onNext && page < total - 1 && (
          <button
            type="button"
            aria-label="Next page"
            onClick={onNext}
            className="absolute right-0 top-0 hidden h-full w-[12%] cursor-e-resize md:block"
          />
        )}
      </div>

      <Pager page={page} total={total} onPrev={onPrev} onNext={onNext} className="shrink-0 pb-1 pt-2" />
    </div>
  );
}
