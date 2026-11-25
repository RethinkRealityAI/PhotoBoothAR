/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The "Magazine covers" tiles in the Looks step's Frames tab: one per
 * occasion, drawn with the event's own name, ticked when it is on. Tapping
 * one opens the cover editor. Thumbnails are drawn on demand, smallest
 * first-paint cost: a placeholder card with the masthead until each is ready.
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { resolveCover, type CoverSettings } from '../../../lib/cover/spec';
import { COVER_TEMPLATES, type CoverTemplateId } from '../../../lib/cover/templates';

const SAMPLE_FACE = '/starters/soft-portrait.webp';

function useCoverThumbs(eventName: string, covers: readonly CoverSettings[]): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const key = JSON.stringify([eventName, covers]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { renderCover2D } = await import('../../../lib/cover/render2d');
      const small = document.createElement('canvas');
      small.width = 216;
      small.height = 384;
      const sctx = small.getContext('2d');
      for (const t of COVER_TEMPLATES) {
        if (!alive || !sctx) return;
        const s = covers.find((c) => c.template === t.id) ?? { template: t.id };
        try {
          const big = await renderCover2D(resolveCover(s, eventName, []));
          sctx.clearRect(0, 0, small.width, small.height);
          sctx.drawImage(big, 0, 0, small.width, small.height);
          const url = small.toDataURL('image/webp', 0.85);
          if (alive) setThumbs((m) => ({ ...m, [t.id]: url }));
        } catch (e) {
          console.warn('[cover thumbs]', t.id, e);
        }
      }
    })().catch((e) => console.warn('[cover thumbs] renderer failed to load', e));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return thumbs;
}

export default function CoverTiles({ eventName, covers, onOpen }: {
  eventName: string;
  covers: readonly CoverSettings[];
  onOpen: (t: CoverTemplateId) => void;
}) {
  const thumbs = useCoverThumbs(eventName, covers);
  return (
    <>
      {COVER_TEMPLATES.map((t) => {
        const on = covers.some((c) => c.template === t.id);
        return (
          <button
            key={t.id}
            type="button"
            className="wz-tile"
            aria-pressed={on}
            onClick={() => onOpen(t.id)}
            title={`${t.label} cover`}
            aria-label={`${t.label} cover, ${on ? 'on' : 'off'}. Open to edit`}
          >
            <span className="wz-check" aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
            <span className="wz-tile-art aspect-[3/4]">
              <img src={SAMPLE_FACE} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" loading="lazy" />
              {thumbs[t.id]
                ? <img src={thumbs[t.id]} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />
                : <span className="absolute inset-x-0 top-2 text-center text-[13px] font-bold text-white/90 tracking-wide">{t.masthead.text}</span>}
            </span>
            <span className="wz-tile-name">{t.label}</span>
          </button>
        );
      })}
    </>
  );
}
