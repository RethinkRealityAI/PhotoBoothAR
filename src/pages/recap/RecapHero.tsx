/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The recap's opening: the event's name in the platform serif, the two numbers
 * that describe the night, and a fan of the first prints rising into place.
 *
 * THE ANIMATION IS A GSAP TIMELINE, NOT CSS, for one reason: the prints have to
 * arrive in sequence and land at DIFFERENT resting angles, and expressing a
 * staggered set of distinct end-states in CSS means one keyframe rule per tile.
 * The tween is transform + opacity only — no layout property is touched — so it
 * runs on the compositor and stays smooth on the mid-range phone a guest is
 * actually holding. (No WebGL here on purpose; the AR stack belongs in the
 * booth, not in an album someone opens on the bus home.)
 *
 * REDUCED MOTION renders the finished state immediately. The markup's resting
 * position IS the final state, so honouring the preference is simply declining
 * to build the timeline — there is no second code path to keep in sync.
 */
import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import type { Post } from '../../types';
import PostImage from '../../components/ui/PostImage';

/** How many prints the fan holds. Five reads as a handful; more turns the hero
 *  into a second album and pushes the name off a phone screen. */
const HERO_PRINTS = 5;

/** Resting angles, authored not generated — the fan has to look arranged. */
const TILT = [-9, 5.5, -2.5, 7, -6];

export default function RecapHero({
  eyebrow,
  title,
  countLine,
  photos,
  reducedMotion,
}: {
  eyebrow: string;
  title: string;
  countLine: string;
  /** The album, newest first; the first few become the fan. */
  photos: readonly Post[];
  reducedMotion: boolean;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const prints = photos.slice(0, HERO_PRINTS);

  useLayoutEffect(() => {
    if (reducedMotion) return;
    const root = rootRef.current;
    if (root === null) return;
    // gsap.context scopes every selector to this subtree and gives one
    // revert() that undoes every property the timeline set — which matters on a
    // page whose data can change under it.
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo(
        '[data-hero-line]',
        { y: 26, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.75, stagger: 0.09 },
      );
      tl.fromTo(
        '[data-hero-print]',
        { y: 64, opacity: 0, scale: 0.9 },
        { y: 0, opacity: 1, scale: 1, duration: 0.85, stagger: 0.075 },
        // Overlap the prints with the tail of the text so the hero reads as one
        // arrival rather than two.
        '-=0.45',
      );
    }, root);
    return () => ctx.revert();
  }, [reducedMotion, prints.length]);

  return (
    <header ref={rootRef} className="flex flex-col items-center gap-5 pt-2 text-center">
      <p data-hero-line className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">
        {eyebrow}
      </p>
      <h1 data-hero-line className="font-serif italic text-4xl sm:text-5xl md:text-6xl leading-[1.05] text-foil-static">
        {title}
      </h1>
      <p data-hero-line className="font-sans text-xs tracking-wide text-brand-muted/60">
        {countLine}
      </p>

      {prints.length > 0 && (
        <ul className="mt-2 flex items-end justify-center -space-x-5 sm:-space-x-7" aria-hidden>
          {prints.map((p, i) => (
            <li
              key={p.id}
              data-hero-print
              className="w-[4.75rem] shrink-0 sm:w-28 md:w-32"
              // The gsap tween owns this element's transform; the resting tilt
              // lives on the child so the two never fight over the same
              // property.
              style={{ zIndex: i === 2 ? 3 : 2 - Math.abs(i - 2) }}
            >
              <div
                className="overflow-hidden rounded-2xl border border-white/12 bg-black/40 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)]"
                style={{ transform: `rotate(${TILT[i % TILT.length]}deg)`, aspectRatio: '3 / 4' }}
              >
                {p.media_type === 'video' ? (
                  <video src={p.image_url} className="h-full w-full object-cover" preload="metadata" muted playsInline />
                ) : (
                  <PostImage
                    src={p.image_url}
                    alt=""
                    displayWidth={160}
                    eager
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}
