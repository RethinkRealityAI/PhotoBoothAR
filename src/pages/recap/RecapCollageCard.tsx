/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The keepsake collage PREVIEW — a canvas that draws the chosen template, plus
 * an imperative `save()` the Take-home section's one download button calls.
 *
 * The template picker and the button used to live in here; the owner asked for
 * the album's take-home order to be "choices, then the button, then the
 * preview", so they moved up to RecapTakeHome and this became a controlled
 * component (template in, save() out).
 *
 * ZERO MARGINAL COST is the design constraint, not an implementation detail. A
 * recap link goes to every guest at an event, so a server-rendered collage would
 * bill us per guest for the same picture; every pixel here is drawn on the
 * device that asked for it. That is why the whole thing is a `<canvas>` and why
 * `lib/recapCollage.ts` — the geometry — is pure and separately tested.
 *
 * The preview and the export run the SAME `collageLayout` + `paintCollage` pair,
 * only at different sizes: what the guest is looking at is what lands in their
 * gallery. Photos are decoded ONCE for all three templates, because switching
 * template must feel instant and re-fetching a dozen photos over venue wifi
 * would make it feel like a page load.
 */
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Loader2 } from 'lucide-react';
import type { Post } from '../../types';
import {
  COLLAGE_BASE,
  COLLAGE_HEIGHT,
  COLLAGE_LABELS,
  COLLAGE_TEMPLATES,
  COLLAGE_WIDTH,
  collageCapacity,
  collageFileName,
  collageLayout,
  collagePngBlob,
  loadCollageImages,
  paintCollage,
  pickCollagePhotos,
  type CollageArt,
  type CollageTemplate,
} from '../../lib/recapCollage';
import { stillPhotos } from '../../lib/eventRecap';

export type CollagePhase = 'loading' | 'ready' | 'empty';

export interface CollageHandle {
  /** Build and download the full-size PNG. Resolves to an error line for the
   *  guest, or null when the file was handed over. */
  save: () => Promise<string | null>;
}

export default function RecapCollageCard({
  ref,
  photos,
  ownIds,
  template,
  title,
  subtitle,
  palette,
  filePrefix,
  onPhase,
}: {
  ref?: Ref<CollageHandle>;
  /** The album, newest first. Clips are filtered out here, not by the caller. */
  photos: readonly Post[];
  /** This device's own post ids — they are placed first and never cut. */
  ownIds: ReadonlySet<string>;
  template: CollageTemplate;
  title: string;
  subtitle?: string;
  /** Ambience colours, [0] dominant (the keepsake theme's accent + glow). */
  palette: readonly string[];
  filePrefix: string;
  onPhase?: (phase: CollagePhase, count: number) => void;
}) {
  const [phase, setPhase] = useState<CollagePhase>('loading');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Decoded photos by post id. A `null` value means "tried and failed" — the
   *  slot paints as an empty frame rather than holding the whole collage up. */
  const decoded = useRef(new Map<string, HTMLImageElement | null>());

  const stills = useMemo(() => stillPhotos(photos), [photos]);

  /** The widest cut any template can ask for, so one decode serves all three. */
  const superset = useMemo(() => {
    const widest = Math.max(...COLLAGE_TEMPLATES.map(collageCapacity));
    // pickCollagePhotos caps by template; ask the most generous one for its
    // ordering, then take everything it kept.
    const generous = COLLAGE_TEMPLATES.reduce((best, t) =>
      collageCapacity(t) >= widest ? t : best, COLLAGE_TEMPLATES[0]);
    return pickCollagePhotos(stills, ownIds, generous);
  }, [stills, ownIds]);

  /** The cut this template actually prints. */
  const chosen = useMemo(
    () => pickCollagePhotos(superset, ownIds, template),
    [superset, ownIds, template],
  );

  useEffect(() => { onPhase?.(phase, chosen.length); }, [onPhase, phase, chosen.length]);

  const art: CollageArt = useMemo(() => {
    const clean = palette.filter((h) => typeof h === 'string' && h.trim() !== '');
    return {
      background: COLLAGE_BASE,
      accent: clean[0] ?? '#E8C766',
      palette: clean.length > 0 ? [...clean] : undefined,
      title,
      subtitle,
      mark: 'beamwall',
    };
  }, [palette, title, subtitle]);

  // Decode once, for every template. Runs again only if the album itself
  // changes — switching template never re-fetches a byte.
  useEffect(() => {
    let alive = true;
    if (superset.length === 0) {
      setPhase('empty');
      return;
    }
    setPhase('loading');
    const wanted = superset.filter((p) => !decoded.current.has(p.id));
    if (wanted.length === 0) {
      setPhase('ready');
      return;
    }
    void loadCollageImages(wanted.map((p) => p.image_url)).then((imgs) => {
      if (!alive) return;
      wanted.forEach((p, i) => decoded.current.set(p.id, imgs[i]));
      setPhase('ready');
    });
    return () => { alive = false; };
  }, [superset]);

  /** Paint the preview at whatever size the card is, device pixels included —
   *  a collage drawn at CSS resolution looks soft next to the photos in it. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || phase !== 'ready') return;
    const cssW = canvas.clientWidth;
    if (cssW <= 0) return;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const w = Math.round(cssW * dpr);
    const h = Math.round(w * (COLLAGE_HEIGHT / COLLAGE_WIDTH));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const layout = collageLayout(chosen.length, w, h, template, chosen.map((p) => p.id));
    paintCollage(ctx, layout, chosen.map((p) => decoded.current.get(p.id) ?? null), art);
  }, [chosen, template, art, phase]);

  useEffect(() => { repaint(); }, [repaint]);

  // The card is fluid, so the preview has to be redrawn when it resizes —
  // otherwise a rotated phone shows a stretched bitmap of the old width.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => repaint());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [repaint]);

  useImperativeHandle(ref, () => ({
    async save() {
      if (phase !== 'ready') return 'Your collage is still being made — give it a moment.';
      const layout = collageLayout(
        chosen.length, COLLAGE_WIDTH, COLLAGE_HEIGHT, template, chosen.map((p) => p.id),
      );
      const blob = await collagePngBlob(
        chosen.map((p) => decoded.current.get(p.id) ?? null), layout, art,
      );
      if (blob === null) {
        // The two real failures: no 2D context, or a canvas tainted because a
        // photo's host answered without CORS headers. Both mean "no file", and
        // saying so beats handing over a broken download.
        return 'We couldn’t build the file on this device. Try a different browser, or save the photos one by one below.';
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = collageFileName(filePrefix, template);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return null;
    },
  }), [phase, chosen, template, art, filePrefix]);

  if (phase === 'empty') return null;

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-[color:var(--k-line)] bg-[rgba(var(--k-ink-rgb),0.06)] p-2 shadow-[0_40px_80px_-40px_var(--k-shadow)]">
      <canvas
        ref={canvasRef}
        className="block w-full rounded-[1.35rem]"
        style={{ aspectRatio: `${COLLAGE_WIDTH} / ${COLLAGE_HEIGHT}` }}
        aria-label={`${COLLAGE_LABELS[template]} collage preview of ${chosen.length} photos`}
        role="img"
      />
      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[color:var(--k-accent)]" aria-hidden />
          <span className="sr-only">Building your keepsake</span>
        </div>
      )}
    </div>
  );
}
