/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The booth preview with the event's looks floating round it: small glass
 * cards showing the host's own frames, 3D props and filters (or generic
 * starters until they add some — scenePage.boothShowcase), each tagged with
 * what it is, and a one-line caption of the kinds underneath.
 *
 * The cards are decoration only (aria-hidden): the shutter is the way in.
 * Motion is CSS (platform.css `.bs-*`) and stops under reduced motion.
 */
import type { ReactNode } from 'react';
import { SHOWCASE_STANDIN } from './samplePhotos';
import { SHOWCASE_LABEL, showcaseKinds, type ShowcaseCard } from '../../lib/scenePage';

/** Where each card sits round the phone, as classes (platform.css). */
const SLOTS = ['bs-l1', 'bs-r1', 'bs-l2', 'bs-r2', 'bs-l3', 'bs-r3'] as const;

const CAPTION: Record<ShowcaseCard['kind'], string> = {
  filter: 'Effects',
  prop: 'Props',
  frame: 'Frames',
};

export default function BoothShowcase({
  cards,
  children,
  overlay,
}: {
  cards: readonly ShowcaseCard[];
  /** The phone (BoothViewfinder). */
  children: ReactNode;
  /** Drawn over the top of the phone (the room's pulse, on phones). */
  overlay?: ReactNode;
}) {
  const kinds = showcaseKinds(cards);
  return (
    <div className="flex flex-col items-center">
      <div className="bs-stage relative">
        <div aria-hidden className="pointer-events-none">
          {cards.slice(0, SLOTS.length).map((c, i) => (
            <div
              key={c.id}
              className={`bs-card ${SLOTS[i]} sc-glass absolute rounded-[16px] p-1`}
              style={{ ['--bs-d' as string]: `-${(i * 1.3).toFixed(1)}s` }}
            >
              <span className="sc-rim" style={{ ['--rim-d' as string]: `-${(i * 0.9).toFixed(1)}s` }}><span /></span>
              <div className="relative aspect-[9/16] overflow-hidden rounded-[12px] bg-[#0E0C2A]">
                {/* Bare frame art reads as a frame only on a face. */}
                {c.fit === 'contain' && (
                  <img src={SHOWCASE_STANDIN} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
                )}
                <img
                  src={c.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className={`relative h-full w-full ${c.fit === 'cover' ? 'object-cover' : 'object-fill'}`}
                />
                <span className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/70 to-transparent pb-1 pt-4">
                  <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
                    {SHOWCASE_LABEL[c.kind]}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="relative z-10">{children}</div>
        {overlay && <div className="absolute inset-x-0 top-4 z-20 flex justify-center">{overlay}</div>}
      </div>
      {kinds.length > 0 && (
        <p className="mt-4 font-sans text-[13px] font-medium tracking-wide sc-muted">
          {kinds.map((k) => CAPTION[k]).join(' · ')}
          <span className="sc-faint"> and more</span>
        </p>
      )}
    </div>
  );
}
