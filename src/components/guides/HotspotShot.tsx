/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * An annotated product screenshot: numbered markers over an image, each one
 * opening a short explanation.
 *
 * RENDERS NOTHING when the shot has not been taken (width 0). That is the
 * normal state right now — both entries in HOTSPOT_SHOTS ship empty so the
 * layout is authored ahead of the screenshots — and an empty grey box with
 * markers floating on it would be worse than the section simply not existing.
 *
 * Two presentations, because a popover pinned beside a marker is unreadable on
 * a 390px screen: ≥md opens a glass popover on the side the content author
 * chose (so it never leaves the image), <md opens a fixed bottom sheet with
 * safe-area padding. Both are the same state.
 *
 * A <details> list of every marker sits under the image unconditionally. Markers
 * on an image are a poor experience with a screen reader or a keyboard-only
 * setup no matter how carefully they are labelled, so the same content also
 * exists as plain prose that nobody has to hunt for.
 */
// Aliased: an unqualified `KeyboardEvent` import shadows the DOM one, and the
// window listener below needs the DOM type.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { HOTSPOT_SHOTS, type HotspotShotKey } from '../../lib/guidesContent';
import { hotspotShotPng } from '../../lib/guidesMedia';

export default function HotspotShot({
  shot: shotKey,
  title,
  blurb,
}: {
  shot: HotspotShotKey;
  title: string;
  blurb: string;
}) {
  const shot = HOTSPOT_SHOTS[shotKey];
  const [open, setOpen] = useState<string | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // Esc closes from anywhere, including from inside the bottom sheet.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // See the file note: nothing to draw until the screenshot exists.
  if (shot === undefined || shot.width === 0 || shot.height === 0 || shot.hotspots.length === 0) {
    return null;
  }

  const move = (from: number, delta: number) => {
    const next = (from + delta + shot.hotspots.length) % shot.hotspots.length;
    buttons.current[next]?.focus();
    setOpen(shot.hotspots[next].id);
  };

  const onMarkerKey = (e: ReactKeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(i, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(i, -1);
    }
  };

  const active = shot.hotspots.find((h) => h.id === open) ?? null;

  return (
    <section data-guide-block="hotspots" data-reveal="up" className="w-full">
      <h3 className="mb-2 font-serif text-2xl text-brand-fg">{title}</h3>
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-brand-muted">{blurb}</p>

      <div
        className="liquid-glass relative overflow-hidden rounded-2xl p-2"
        style={{ aspectRatio: `${shot.width} / ${shot.height}` }}
      >
        <img
          src={hotspotShotPng(shot.key)}
          alt={shot.alt}
          loading="lazy"
          className="h-full w-full rounded-xl object-cover"
        />

        {shot.hotspots.map((h, i) => {
          const isOpen = open === h.id;
          return (
            <div
              key={h.id}
              className="absolute"
              style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%` }}
            >
              <button
                type="button"
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                onClick={() => setOpen(isOpen ? null : h.id)}
                onKeyDown={(e) => onMarkerKey(e, i)}
                aria-expanded={isOpen}
                aria-controls={`hotspot-${shot.key}-${h.id}`}
                aria-label={`${i + 1}. ${h.label}`}
                className={`liquid-glass pressable -ml-3.5 -mt-3.5 flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-brand-fg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
                  isOpen ? 'glow-accent scale-110' : 'hover:scale-110'
                }`}
              >
                {i + 1}
              </button>

              {/* ≥md: a popover beside the marker, on the authored side. */}
              {isOpen && (
                <div
                  id={`hotspot-${shot.key}-${h.id}`}
                  role="dialog"
                  aria-label={h.title}
                  className={`liquid-glass absolute top-1/2 z-20 hidden w-64 -translate-y-1/2 rounded-2xl p-4 text-left md:block ${
                    h.side === 'left' ? 'right-6' : 'left-6'
                  }`}
                >
                  <p className="mb-1 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70">
                    {h.label}
                  </p>
                  <p className="mb-1.5 font-serif text-base text-brand-fg">{h.title}</p>
                  <p className="text-xs leading-relaxed text-brand-muted">{h.body}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* <md: one bottom sheet, outside the image so it is never clipped. */}
      {active !== null && (
        <div
          id={`hotspot-${shot.key}-${active.id}-sheet`}
          role="dialog"
          aria-label={active.title}
          className="glass-strong fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-white/10 p-5 md:hidden"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="mb-1 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70">
                {active.label}
              </p>
              <p className="font-serif text-lg text-brand-fg">{active.title}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="Close"
              className="pressable -mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-brand-muted transition hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-brand-muted">{active.body}</p>
        </div>
      )}

      <details className="glass mt-3 rounded-2xl px-5 py-4">
        <summary className="cursor-pointer font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/80 transition hover:text-brand-fg">
          Read this as a list
        </summary>
        <dl className="mt-4 space-y-4">
          {shot.hotspots.map((h, i) => (
            <div key={h.id}>
              <dt className="font-serif text-base text-brand-fg">
                {i + 1}. {h.title}
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-brand-muted">{h.body}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
