/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Carousel card template — the keepsake as a ring of photographs you turn
 * through, built on the shared PhotoCarousel (adapted from pmndrs/examples
 * "cards").
 *
 * Progress model (see ./types.ts): this stays a PURE function of its props.
 * `index` drives which card faces the viewer — 0 is the cover (the ring sits
 * back, title over it), 1..N focus contribution N-1, and the last index is the
 * closing card. No internal timers and no data fetching, so a frame renderer
 * can drive the same component deterministically.
 *
 * Text and video contributions have no image to hang on a card, so they get a
 * generated cover (initial + tint) rather than being dropped: a keepsake whose
 * ring silently omits half the messages would be worse than one that shows
 * them as cards you read below.
 *
 * FALLBACK: without WebGL there is no ring, so the template renders the same
 * readable stack of contributions the ring would otherwise annotate — the
 * keepsake always opens.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import PhotoCarousel, { hasWebGL, type CarouselItem } from '../../carousel/PhotoCarousel';
import { clampIndex, type CardTemplateProps } from './types';
import type { CardViewContribution } from '../../../lib/cards';

/**
 * A card face for a contribution with no image of its own.
 *
 * Drawn as an SVG data URL so it costs no network and no canvas: the ring
 * takes plain urls, and this keeps text contributions first-class on it.
 */
function placeholderCard(c: CardViewContribution, i: number): string {
  const hues = ['#5B8CFF', '#22D3EE', '#E879F9', '#FB923C', '#34D399', '#7C6CF7'];
  const hue = hues[i % hues.length];
  const initial = (c.contributorName?.trim()?.[0] ?? '·').toUpperCase();
  const kind = c.mediaType === 'video' ? 'VIDEO MESSAGE' : 'MESSAGE';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${hue}" stop-opacity="0.32"/>` +
    `<stop offset="1" stop-color="#05060B" stop-opacity="0.95"/></linearGradient></defs>` +
    `<rect width="270" height="480" fill="#0B0D16"/>` +
    `<rect width="270" height="480" fill="url(#g)"/>` +
    `<text x="135" y="250" text-anchor="middle" font-family="Georgia,serif" font-size="112"` +
    ` fill="${hue}" fill-opacity="0.9">${initial}</text>` +
    `<text x="135" y="300" text-anchor="middle" font-family="Arial,sans-serif" font-size="15"` +
    ` letter-spacing="4" fill="#A9B4CC">${kind}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default function Carousel({
  card, contributions, index, onNext, onPrev, reducedMotion = false,
}: CardTemplateProps) {
  const safeIndex = clampIndex(index, contributions);
  const isCover = safeIndex === 0;
  const isEnd = safeIndex === contributions.length + 1;
  const active = contributions[safeIndex - 1];

  const items = useMemo<CarouselItem[]>(
    () =>
      contributions.map((c, i) => ({
        id: c.id,
        url: c.mediaType === 'photo' && c.url ? c.url : placeholderCard(c, i),
      })),
    [contributions],
  );

  // The ring is decorative motion; a reader who asked for less of it, or whose
  // device has no WebGL, gets the contributions as a readable stack instead.
  const ringUsable = !reducedMotion && hasWebGL() && items.length > 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {ringUsable ? (
        <PhotoCarousel
          items={items}
          // Cover and closing pages have no contribution to face; hold the ring
          // on the first card and let the copy take the foreground.
          focusIndex={isCover || isEnd ? 0 : safeIndex - 1}
          autoSpin={isCover ? 0.12 : 0}
          className="absolute inset-0"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-4">
          {contributions.map((c) => (
            <div key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">
                {c.contributorName || 'Anonymous'}
              </p>
              {c.message && <p className="mt-1 font-serif text-sm italic text-brand-fg">“{c.message}”</p>}
            </div>
          ))}
        </div>
      )}

      {/* Foreground copy — pointer-events-none so the ring stays draggable,
          with the interactive bits opting back in. */}
      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col items-center justify-between py-4 text-center">
        {isCover ? (
          <div className="mt-6 flex flex-col items-center">
            <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">
              {card.eventName ?? 'A keepsake'}
            </p>
            <h1 className="mt-2 max-w-md font-serif text-3xl italic leading-tight text-foil-static">
              {card.title}
            </h1>
            {card.recipientName && (
              <p className="mt-2 font-sans text-sm text-brand-muted/70">for {card.recipientName}</p>
            )}
            <p className="mt-4 font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">
              {contributions.length} {contributions.length === 1 ? 'message' : 'messages'} inside
            </p>
          </div>
        ) : isEnd ? (
          <div className="mt-10 flex flex-col items-center">
            <h2 className="font-serif text-3xl italic text-foil-static">Fin.</h2>
            <p className="mt-3 font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">
              Made with Beamwall
            </p>
            <Link
              to="/"
              className="pointer-events-auto mt-5 rounded-full border border-white/15 px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg transition hover:bg-white/[0.06]"
            >
              Create your own
            </Link>
          </div>
        ) : (
          <div className="mt-auto w-full max-w-md rounded-2xl bg-void-900/70 px-5 py-4 backdrop-blur-sm">
            {active?.message && (
              <p className="font-serif text-base italic leading-relaxed text-brand-fg">
                “{active.message}”
              </p>
            )}
            <p className="mt-2 font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">
              — {active?.contributorName || 'Anonymous'}
            </p>
          </div>
        )}

        {/* Paging — the viewer owns `index`; these just ask for the next one. */}
        <div className="pointer-events-auto mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onPrev}
            disabled={!onPrev || safeIndex === 0}
            className="min-h-11 rounded-full border border-white/15 px-4 font-label uppercase tracking-luxe text-[10px] text-brand-fg transition hover:bg-white/[0.06] disabled:opacity-30"
          >
            Prev
          </button>
          <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">
            {safeIndex + 1} / {contributions.length + 2}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext || isEnd}
            className="min-h-11 rounded-full border border-white/15 px-4 font-label uppercase tracking-luxe text-[10px] text-brand-fg transition hover:bg-white/[0.06] disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
