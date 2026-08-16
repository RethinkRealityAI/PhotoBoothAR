/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The keepsake collage block — pick a template, watch it draw, save the PNG.
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { Post } from '../../types';
import {
  COLLAGE_BASE,
  COLLAGE_BLURBS,
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

type LoadPhase = 'loading' | 'ready' | 'empty';

export default function RecapCollageCard({
  photos,
  ownIds,
  title,
  subtitle,
  accentHexes,
  filePrefix,
}: {
  /** The album, newest first. Clips are filtered out here, not by the caller. */
  photos: readonly Post[];
  /** This device's own post ids — they are placed first and never cut. */
  ownIds: ReadonlySet<string>;
  title: string;
  subtitle?: string;
  /** events.config.accentHexes, [0] dominant. Drives the card's ambience. */
  accentHexes: readonly string[];
  filePrefix: string;
}) {
  const [template, setTemplate] = useState<CollageTemplate>('mosaic');
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  const art: CollageArt = useMemo(() => {
    const palette = accentHexes.filter((h) => typeof h === 'string' && h.trim() !== '');
    return {
      background: COLLAGE_BASE,
      accent: palette[0] ?? '#E8C766',
      palette: palette.length > 0 ? [...palette] : undefined,
      title,
      subtitle,
      mark: 'beamwall',
    };
  }, [accentHexes, title, subtitle]);

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

  async function download() {
    setSaving(true);
    setSaveError(null);
    try {
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
        setSaveError('We couldn’t build the file on this device. Try a different browser, or save the photos one by one below.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = collageFileName(filePrefix, template);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      setSaving(false);
    }
  }

  if (phase === 'empty') return null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="recap-keepsake-heading">
      <header className="flex flex-col gap-1">
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">Keepsake</p>
        <h2 id="recap-keepsake-heading" className="font-serif italic text-2xl text-foil-static">
          Take the whole night with you
        </h2>
        <p className="font-sans text-xs text-brand-muted/60 leading-relaxed max-w-md">
          One picture, {chosen.length} moments, made on your phone. Pick a look and save it.
        </p>
      </header>

      <div
        role="radiogroup"
        aria-label="Collage style"
        className="grid grid-cols-3 gap-2"
      >
        {COLLAGE_TEMPLATES.map((t) => {
          const on = t === template;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setTemplate(t)}
              className={`min-h-11 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                on
                  ? 'liquid-glass border border-accent/40'
                  : 'glass border border-white/10 hover:border-accent/25'
              }`}
            >
              <span className={`block font-label uppercase tracking-luxe text-[10px] ${on ? 'text-accent' : 'text-brand-muted/70'}`}>
                {COLLAGE_LABELS[t]}
              </span>
              <span className="mt-0.5 block font-sans text-[10px] leading-tight text-brand-muted/45">
                {COLLAGE_BLURBS[t]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative rounded-3xl overflow-hidden liquid-glass p-2.5">
        <canvas
          ref={canvasRef}
          className="block w-full rounded-2xl"
          style={{ aspectRatio: `${COLLAGE_WIDTH} / ${COLLAGE_HEIGHT}` }}
          aria-label={`${COLLAGE_LABELS[template]} collage preview of ${chosen.length} photos`}
          role="img"
        />
        {phase === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-accent" aria-hidden />
            <span className="sr-only">Building your keepsake</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => void download()}
        disabled={phase !== 'ready' || saving}
        className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[11px] text-[color:var(--on-accent)] transition active:scale-[0.98] disabled:opacity-50"
      >
        {saving
          ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          : <Download className="w-4 h-4" aria-hidden />}
        {saving ? 'Saving…' : 'Download keepsake'}
      </button>
      {saveError !== null && (
        <p role="alert" className="font-sans text-[11px] leading-relaxed text-amber-300/90">{saveError}</p>
      )}
    </section>
  );
}
