/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The free frame pack.
 *
 * Two things make this more than a grid of links:
 *
 *  1. The DASHED FACE WINDOW. Every entry carries a measured faceBox, drawn
 *     over the thumbnail. A host choosing a frame is really choosing how much
 *     room a person gets, and no thumbnail communicates that on its own — the
 *     arch designs in particular look generous and leave a narrow slot. On a
 *     phone the overlay is always on (there is no hover); on a pointer device
 *     it fades in, so the artwork is unobstructed while browsing.
 *  2. The thumbnails are WebP and lazy — the full 1080 × 1920 PNGs are only
 *     fetched when somebody actually downloads one.
 */
import { useState } from 'react';
import { Download } from 'lucide-react';
import {
  FRAME_CATEGORY_LABELS,
  FRAME_PACK_BY_ID,
  type FrameCategory,
  type FramePackId,
} from '../../lib/guidesContent';
import { frameDownloadName, framePng, frameThumb } from '../../lib/guidesMedia';

type Filter = FrameCategory | 'all';

export default function DownloadGallery({
  title,
  blurb,
  entryIds,
}: {
  title: string;
  blurb: string;
  entryIds: FramePackId[];
}) {
  const entries = entryIds.map((id) => FRAME_PACK_BY_ID[id]).filter((e) => e !== undefined);
  const [filter, setFilter] = useState<Filter>('all');

  if (entries.length === 0) return null;

  // Only categories actually present, in the order the pack lists them — an
  // empty chip is a dead end.
  const categories: FrameCategory[] = [];
  for (const e of entries) if (!categories.includes(e.category)) categories.push(e.category);

  const shown = filter === 'all' ? entries : entries.filter((e) => e.category === filter);

  const chip = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 font-label uppercase tracking-luxe text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
      active
        ? 'bg-white/[0.12] text-brand-fg'
        : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.06]'
    }`;

  return (
    <section data-guide-block="downloads" data-reveal="up" className="w-full">
      <h3 className="mb-2 font-serif text-2xl text-brand-fg">{title}</h3>
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-brand-muted">{blurb}</p>

      <div className="liquid-glass mb-6 flex flex-wrap items-center gap-1 rounded-full p-1.5">
        <button type="button" onClick={() => setFilter('all')} className={chip(filter === 'all')}>
          All {entries.length}
        </button>
        {categories.map((c) => (
          <button key={c} type="button" onClick={() => setFilter(c)} className={chip(filter === c)}>
            {FRAME_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((e) => (
          <a
            key={e.id}
            href={framePng(e.id)}
            download={frameDownloadName(e.id)}
            className="group liquid-glass pressable flex flex-col overflow-hidden rounded-2xl transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
          >
            <span className="relative block aspect-[9/16] w-full overflow-hidden bg-black/40">
              <img
                src={frameThumb(e.id)}
                alt={e.title}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              {/* The measured face window. Always visible on touch (no hover
                  exists there); fades in on pointer devices. */}
              <span
                aria-hidden
                className="pointer-events-none absolute rounded-[3px] border border-dashed border-white/70 bg-white/[0.06] opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100"
                style={{
                  left: `${e.faceBox.x * 100}%`,
                  top: `${e.faceBox.y * 100}%`,
                  width: `${e.faceBox.w * 100}%`,
                  height: `${e.faceBox.h * 100}%`,
                }}
              >
                {/* Centred in the window rather than pinned to its bottom
                    edge: the window is the empty part, so the label sits on
                    nothing instead of over the artwork below it. */}
                <span className="absolute inset-0 flex items-center justify-center px-1 text-center text-[9px] leading-tight uppercase tracking-[0.14em] text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                  your face goes here
                </span>
              </span>
            </span>
            <span className="flex flex-1 flex-col gap-1.5 p-3.5">
              <span className="font-serif text-sm leading-tight text-brand-fg">{e.title}</span>
              <span className="text-[11px] leading-snug text-brand-muted/85">{e.blurb}</span>
              <span className="mt-auto flex items-center gap-1.5 pt-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70 transition group-hover:text-brand-fg">
                <Download className="h-3.5 w-3.5" aria-hidden />
                PNG · 1080×1920
              </span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
