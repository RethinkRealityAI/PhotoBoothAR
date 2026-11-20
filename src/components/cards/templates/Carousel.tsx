/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Carousel card template — the keepsake as a ring of photographs you turn
 * through, built on the shared PhotoCarousel (adapted from pmndrs/examples
 * "cards").
 *
 * Progress model (see ./types.ts): this stays a PURE function of its props.
 * `index` drives which card faces the viewer — 0 is the cover (the ring
 * drifts behind the title), 1..N focus contribution N-1, and the last index
 * is the closing card. No internal timers and no data fetching.
 *
 * Written notes and videos have no photo to hang on a card, so they get a
 * painted card (noteCanvas.ts: frosted paper, the message in the display
 * face, or a glowing play disc for a clip) rather than being dropped — the
 * caption under the ring plays the video for real.
 *
 * FALLBACK: without WebGL, or when the reader asked for less motion, there is
 * no ring — the template renders the Storybook pages instead, so the keepsake
 * always opens and reads the same.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import PhotoCarousel, { hasWebGL, type CarouselItem } from '../../carousel/PhotoCarousel';
import { clampIndex, type CardTemplateProps } from './types';
import Storybook from './Storybook';
import { ShimmerRim } from './cardChrome';
import { drawNote, fontsReady, readCardPalette } from './noteCanvas';
import {
  CardVideo,
  ClosingContent,
  CoverTitle,
  Message,
  OpenButton,
  Pager,
  Signature,
  useSwipe,
} from './cardParts';

export default function Carousel(props: CardTemplateProps) {
  const { card, contributions, index, onNext, onPrev, reducedMotion = false } = props;
  const safeIndex = clampIndex(index, contributions);
  const total = contributions.length + 2;
  const isCover = safeIndex === 0;
  const isEnd = safeIndex === total - 1;
  const active = !isCover && !isEnd ? contributions[safeIndex - 1] : null;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const swipe = useSwipe(onNext, onPrev);
  const interactive = onNext !== undefined || onPrev !== undefined;

  // Painted cards for notes and videos, keyed by contribution id. Painted
  // once the display face is ready, in the live palette at this element.
  const [painted, setPainted] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    const palette = readCardPalette(rootRef.current);
    void fontsReady(palette).then(() => {
      if (!alive) return;
      const out: Record<string, string> = {};
      for (const c of contributions) {
        if (c.mediaType === 'photo' && c.url) continue;
        out[c.id] = drawNote(
          { kind: c.mediaType === 'video' ? 'video' : 'text', message: c.message, name: c.contributorName },
          palette,
          540,
          960,
        ).toDataURL('image/png');
      }
      setPainted(out);
    });
    return () => {
      alive = false;
    };
  }, [contributions]);

  const items = useMemo<CarouselItem[] | null>(() => {
    if (painted === null) return null;
    return contributions.map((c) => ({
      id: c.id,
      url: c.mediaType === 'photo' && c.url ? c.url : (painted[c.id] ?? ''),
    }));
  }, [contributions, painted]);

  // The ring is decorative motion; a reader who asked for less of it, or whose
  // device has no WebGL, gets the Storybook pages instead.
  const ringUsable = !reducedMotion && hasWebGL() && contributions.length > 0;
  if (!ringUsable) return <Storybook {...props} />;

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col" style={{ touchAction: 'pan-y' }} {...swipe}>
      {items !== null && (
        <PhotoCarousel
          items={items}
          // Cover and close have no contribution to face: hold the first card
          // and let it drift behind the copy.
          focusIndex={isCover || isEnd ? 0 : safeIndex - 1}
          autoSpin={isCover || isEnd ? 0.12 : 0}
          className="absolute inset-0"
        />
      )}

      {/* Foreground copy — pointer-events-none so the ring stays draggable,
          with the interactive bits opting back in. */}
      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col items-center justify-between px-1 pb-1 pt-3 text-center">
        {isCover && (
          <div className="flex w-full flex-col items-center">
            <CoverTitle card={card} contributions={contributions} size="md" />
          </div>
        )}
        {isEnd && (
          <div className="liquid-glass pointer-events-auto mt-2 w-full max-w-md rounded-[1.8rem] px-6 py-8">
            <ShimmerRim radius="1.8rem" lapS={9} reducedMotion={reducedMotion} />
            <ClosingContent card={card} contributions={contributions} scratch={interactive} />
          </div>
        )}
        {!isCover && !isEnd && <span aria-hidden />}

        <div className="flex w-full flex-col items-center gap-3">
          {isCover && (
            <div className="pointer-events-auto">
              <OpenButton onClick={onNext} label="Turn the ring" reducedMotion={reducedMotion} />
            </div>
          )}
          {/* A written note is already painted on its card in full — a
              caption would only repeat it over the card's own words. */}
          {active && active.mediaType !== 'text' && (
            <div className="liquid-glass pointer-events-auto w-full max-w-md rounded-[1.6rem] px-5 py-4">
              <ShimmerRim radius="1.6rem" lapS={9} reducedMotion={reducedMotion} />
              {active.mediaType === 'video' && active.url && (
                <CardVideo c={active} compact className="mb-4 aspect-video w-full rounded-2xl" />
              )}
              <Message message={active.message} />
              <Signature name={active.contributorName} className="mt-2" />
            </div>
          )}
          <div className="pointer-events-auto">
            <Pager page={safeIndex} total={total} onPrev={onPrev} onNext={onNext} />
          </div>
        </div>
      </div>
    </div>
  );
}
