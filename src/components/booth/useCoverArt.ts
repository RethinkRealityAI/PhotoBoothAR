/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The art for an event's magazine cover Frames: each cover drawn (with this
 * device's cover names) to a 1080×1920 PNG object URL, keyed by template id.
 * Redrawn when the names change; old URLs are revoked a little later, once
 * the stage has swapped to the new ones. The renderer is loaded on demand, so
 * an event without covers never downloads it.
 */
import { useEffect, useMemo, useState } from 'react';
import { resolveCover, type CoverSettings } from '../../lib/cover/spec';

export function useCoverArt(covers: readonly CoverSettings[], eventName: string, guests: readonly string[]): Record<string, string> {
  const [art, setArt] = useState<Record<string, string>>({});
  const key = useMemo(() => JSON.stringify([covers, eventName, guests]), [covers, eventName, guests]);

  useEffect(() => {
    if (covers.length === 0) { setArt({}); return; }
    let alive = true;
    const made: string[] = [];
    (async () => {
      const { renderCover2D, canvasToObjectUrl } = await import('../../lib/cover/render2d');
      const next: Record<string, string> = {};
      for (const c of covers) {
        try {
          const cv = await renderCover2D(resolveCover(c, eventName, guests));
          const url = await canvasToObjectUrl(cv);
          made.push(url);
          next[c.template] = url;
        } catch (e) {
          // One cover failing must not take the others with it.
          console.warn('[cover] art failed', c.template, e);
        }
        if (!alive) return;
      }
      if (alive) setArt(next);
    })().catch((e) => console.warn('[cover] renderer failed to load', e));
    return () => {
      alive = false;
      // Give the stage time to load the next art before this set goes.
      window.setTimeout(() => made.forEach((u) => URL.revokeObjectURL(u)), 8000);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return art;
}
