/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The deck viewer shared by the hub's presenter and /pitch/:slug.
 *
 * ≥768px: a real presentation — one 1280×720 stage scaled to fit, keyboard
 * (arrows/space/PageUp/PageDown/Home/End), click zones, swipe, progress bar,
 * counter, fullscreen, optional speaker-notes panel, and `#3` deep links.
 * <768px: no shrunken canvas (it would be 8px type). Slides re-flow as
 * full-width cards in a vertical snap-scroll.
 *
 * Print / Save as PDF renders every slide on its own landscape page through a
 * portal straight under <body>: the app shell is `h-screen overflow-hidden`,
 * which would otherwise clip the print to one page, and index.css's
 * ShareKit print rule hides `body *` — so the rules below re-show only us.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, NotebookPen, Printer, X } from 'lucide-react';
import type { Slide } from '../../../lib/salesTypes';
import { clampIndex, keyToStep, parseSlideHash, slideHash, swipeDirection } from '../../../lib/salesHub';
import { SlideView, STAGE_H, STAGE_W, type SlideEnv } from './Slides';

export interface DeckLike {
  slug: string;
  name: string;
  rgb: string;
  slides: Slide[];
}

export type DeckEnv = Omit<SlideEnv, 'mode' | 'rgb'>;

/** true at ≥768px. Starts from the real value so first paint is right. */
export function useIsWide(): boolean {
  const q = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

const DECK_CSS = `
.sd-in > * { animation: sd-in 620ms cubic-bezier(.16,1,.3,1) both; }
@keyframes sd-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .sd-in > * { animation: sd-fade 160ms ease-out both; }
  @keyframes sd-fade { from { opacity: 0; } to { opacity: 1; } }
}
#sales-print-root { display: none; }
@media print {
  @page { size: landscape; margin: 0; }
  html, body { height: auto !important; overflow: visible !important; background: #05060B !important; }
  body.sales-printing > *:not(#sales-print-root) { display: none !important; }
  body.sales-printing #sales-print-root { display: block !important; }
  #sales-print-root, #sales-print-root * { visibility: visible !important; }
  #sales-print-root .sd-in > * { animation: none !important; }
  /* Chrome's PDF output draws background-clip:text as a boxed fill. Solid ink. */
  #sales-print-root .text-foil-static { background: none !important; -webkit-text-fill-color: #A9C4FF !important; color: #A9C4FF !important; }
  .sales-print-page {
    height: 100vh; width: 100%;
    display: flex; align-items: center; justify-content: center;
    background: #05060B; overflow: hidden;
    break-after: page; page-break-after: always;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sales-print-page:last-child { break-after: auto; page-break-after: auto; }
  /* 1280×720 → fits both US Letter (1056×816) and A4 (1123×794) landscape. */
  .sales-print-page > .sales-stage { zoom: 0.82; }
}
`;

/** Every slide, one per landscape page. Hidden on screen. */
function PrintDeck({ deck, env }: { deck: DeckLike; env: DeckEnv }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'sales-print-root';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    document.body.classList.add('sales-printing');
    setHost(el);
    return () => {
      document.body.classList.remove('sales-printing');
      el.remove();
    };
  }, []);
  if (host === null) return null;
  const slideEnv: SlideEnv = { ...env, mode: 'stage', rgb: deck.rgb, eagerImages: true };
  return createPortal(
    <div className="text-brand-fg">
      {deck.slides.map((s, i) => (
        <div key={s.id} className="sales-print-page">
          <SlideView slide={s} env={slideEnv} index={i} total={deck.slides.length} deckName={deck.name} />
        </div>
      ))}
    </div>,
    host,
  );
}

const iconBtn =
  'inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] text-brand-fg transition hover:bg-white/[0.1] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] disabled:opacity-30';

export default function SlideDeck({
  deck,
  env,
  syncHash = false,
  notesAvailable = false,
  onClose,
  autoFocus = true,
}: {
  deck: DeckLike;
  env: DeckEnv;
  /** Read/write the 1-based slide number in location.hash (/pitch only). */
  syncHash?: boolean;
  /** Hub presenter: show the speaker-notes toggle. */
  notesAvailable?: boolean;
  onClose?: () => void;
  autoFocus?: boolean;
}) {
  const wide = useIsWide();
  const count = deck.slides.length;
  const [index, setIndex] = useState(() =>
    syncHash && typeof window !== 'undefined' ? (parseSlideHash(window.location.hash, count) ?? 0) : 0,
  );
  const [notesOpen, setNotesOpen] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const go = useCallback((i: number) => setIndex(clampIndex(i, count)), [count]);

  // ── hash sync ──
  useEffect(() => {
    if (!syncHash) return;
    const want = slideHash(index);
    if (window.location.hash !== want) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${want}`);
    }
  }, [index, syncHash]);
  useEffect(() => {
    if (!syncHash) return;
    const on = () => {
      const i = parseSlideHash(window.location.hash, count);
      if (i !== null) setIndex(i);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [syncHash, count]);

  // ── keyboard (wide only; on phones the page just scrolls) ──
  useEffect(() => {
    if (!wide) return;
    const on = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'Escape' && onClose !== undefined && document.fullscreenElement === null) {
        onClose();
        return;
      }
      // Space on a focused button should press it, not advance.
      if (e.key === ' ' && t !== null && /^(BUTTON|A)$/.test(t.tagName)) return;
      const step = keyToStep(e.key);
      if (step === null) return;
      e.preventDefault();
      setIndex((i) => clampIndex(step === 'next' ? i + 1 : step === 'prev' ? i - 1 : step === 'first' ? 0 : count - 1, count));
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [wide, count, onClose]);

  // ── fit the stage ──
  useLayoutEffect(() => {
    if (!wide) return;
    const el = areaRef.current;
    if (el === null) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width / STAGE_W, r.height / STAGE_H);
      setScale(s > 0 ? s : 0.5);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wide, notesOpen]);

  // ── fullscreen ──
  const fsSupported = typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function';
  useEffect(() => {
    const on = () => setIsFs(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFs = async () => {
    try {
      if (document.fullscreenElement !== null) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      // Denied (iframe, iOS Safari): the deck already fills its container.
    }
  };

  useEffect(() => {
    if (autoFocus && wide) rootRef.current?.focus({ preventScroll: true });
  }, [autoFocus, wide]);

  // ── phones: deep-link scroll + keep the hash current as cards pass ──
  useEffect(() => {
    if (wide || !syncHash) return;
    const first = cardRefs.current[index];
    if (index > 0 && first !== null && first !== undefined) first.scrollIntoView({ block: 'start' });
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = Number((e.target as HTMLElement).dataset.index);
            if (Number.isInteger(i)) setIndex(i);
          }
        }
      },
      { threshold: 0.55 },
    );
    cardRefs.current.forEach((el) => {
      if (el !== null) io.observe(el);
    });
    return () => io.disconnect();
    // index intentionally omitted: the initial jump runs once per layout switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, syncHash, count]);

  const slide = deck.slides[index];
  const notes = slide?.notes;
  const printBtn = (
    <button type="button" className={iconBtn} onClick={() => window.print()} aria-label="Print or save as PDF" title="Print / Save as PDF">
      <Printer className="h-4.5 w-4.5" aria-hidden />
    </button>
  );

  if (count === 0) {
    return <p className="p-8 text-center text-brand-muted">This deck has no slides yet.</p>;
  }

  // ───────────── Phone layout ─────────────
  if (!wide) {
    const cardEnv: SlideEnv = { ...env, mode: 'card', rgb: deck.rgb };
    return (
      <div ref={rootRef} className="flex flex-col gap-4">
        <style>{DECK_CSS}</style>
        {(notesAvailable || onClose !== undefined) && (
          <div className="sticky top-0 z-20 -mx-4 flex items-center gap-2 border-b border-white/5 bg-brand-bg/80 px-4 py-2 backdrop-blur-md">
            {notesAvailable && (
              <button
                type="button"
                aria-pressed={notesOpen}
                onClick={() => setNotesOpen((v) => !v)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 font-label text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-fg"
              >
                <NotebookPen className="h-4 w-4" aria-hidden /> {notesOpen ? 'Hide notes' : 'Show notes'}
              </button>
            )}
            <span className="ml-auto" />
            {onClose !== undefined && (
              <button type="button" className={iconBtn} onClick={onClose} aria-label="Close deck">
                <X className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>
        )}
        {deck.slides.map((s, i) => (
          <div
            key={s.id}
            id={`slide-${i + 1}`}
            data-index={i}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className="scroll-mt-16"
          >
            <SlideView slide={s} env={cardEnv} index={i} total={count} deckName={deck.name} />
            {notesAvailable && notesOpen && s.notes !== undefined && s.notes !== '' && (
              <div className="mt-2 rounded-2xl border border-dashed border-amber-300/30 bg-amber-300/[0.05] p-4 text-[14px] leading-relaxed text-amber-50/90">
                <p className="mb-1 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200/80">Speaker notes</p>
                {s.notes}
              </div>
            )}
          </div>
        ))}
        <PrintDeck deck={deck} env={env} />
      </div>
    );
  }

  // ───────────── Presentation layout ─────────────
  const stageEnv: SlideEnv = { ...env, mode: 'stage', rgb: deck.rgb };
  const progress = count <= 1 ? 1 : (index + 1) / count;
  const stageStyle: CSSProperties = {
    width: STAGE_W,
    height: STAGE_H,
    transform: `scale(${scale})`,
    transformOrigin: 'center center',
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-roledescription="slide deck"
      aria-label={deck.name}
      className="relative flex h-full w-full flex-col bg-[#03040a] outline-none"
    >
      <style>{DECK_CSS}</style>
      {/* progress */}
      <div className="h-[3px] w-full bg-white/[0.06]" aria-hidden>
        <div
          className="h-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${progress * 100}%`, background: `linear-gradient(90deg, rgba(${deck.rgb},0.6), rgb(${deck.rgb}))`, boxShadow: `0 0 12px rgba(${deck.rgb},0.8)` }}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="relative min-w-0 flex-1 cursor-pointer select-none overflow-hidden p-5 lg:p-8"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a,button,input,textarea,select') !== null) return;
            const r = e.currentTarget.getBoundingClientRect();
            go((e.clientX - r.left) / r.width < 0.35 ? index - 1 : index + 1);
          }}
          onTouchStart={(e) => {
            const t = e.touches[0];
            touch.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const start = touch.current;
            touch.current = null;
            if (start === null) return;
            const t = e.changedTouches[0];
            const dir = swipeDirection(t.clientX - start.x, t.clientY - start.y);
            if (dir !== null) go(dir === 'next' ? index + 1 : index - 1);
          }}
        >
          <div ref={areaRef} className="relative flex h-full w-full items-center justify-center">
            <div style={stageStyle} className="shrink-0 overflow-hidden rounded-[6px] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]">
              {slide !== undefined && (
                <SlideView key={slide.id} slide={slide} env={stageEnv} index={index} total={count} deckName={deck.name} />
              )}
            </div>
          </div>
        </div>

        {notesAvailable && notesOpen && (
          <aside aria-label="Speaker notes" className="flex w-[340px] shrink-0 flex-col border-l border-white/10 bg-[#0a0c15] p-5">
            <p className="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-amber-200/80">Speaker notes · slide {index + 1}</p>
            <div className="mt-3 flex-1 overflow-y-auto whitespace-pre-line text-[15px] leading-relaxed text-brand-fg/90">
              {notes !== undefined && notes !== '' ? notes : <span className="text-brand-muted/60">No notes for this slide.</span>}
            </div>
            {index + 1 < count && (
              <p className="mt-4 border-t border-white/10 pt-3 text-[12.5px] text-brand-muted">
                <span className="font-label text-[10px] font-semibold uppercase tracking-[0.2em]">Next:</span> {deck.slides[index + 1].title}
              </p>
            )}
          </aside>
        )}
      </div>

      {/* controls */}
      <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
        <button type="button" className={iconBtn} onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide">
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <span className="min-w-[4.5rem] text-center font-label text-[12px] font-semibold tabular-nums tracking-[0.18em] text-brand-muted" aria-live="polite">
          {index + 1} / {count}
        </span>
        <button type="button" className={iconBtn} onClick={() => go(index + 1)} disabled={index === count - 1} aria-label="Next slide">
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
        <p className="ml-3 hidden truncate text-[13px] text-brand-muted/70 lg:block">{slide?.title}</p>
        <span className="ml-auto" />
        {notesAvailable && (
          <button
            type="button"
            aria-pressed={notesOpen}
            onClick={() => setNotesOpen((v) => !v)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-label text-[11px] font-semibold uppercase tracking-[0.16em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
              notesOpen ? 'border-amber-300/40 bg-amber-300/10 text-amber-100' : 'border-white/12 bg-white/[0.05] text-brand-fg hover:bg-white/[0.1]'
            }`}
          >
            <NotebookPen className="h-4 w-4" aria-hidden /> Notes
          </button>
        )}
        {printBtn}
        {fsSupported && (
          <button type="button" className={iconBtn} onClick={toggleFs} aria-label={isFs ? 'Exit fullscreen' : 'Enter fullscreen'}>
            {isFs ? <Minimize2 className="h-4.5 w-4.5" aria-hidden /> : <Maximize2 className="h-4.5 w-4.5" aria-hidden />}
          </button>
        )}
        {onClose !== undefined && (
          <button type="button" className={iconBtn} onClick={onClose} aria-label="Close deck">
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
      <PrintDeck deck={deck} env={env} />
    </div>
  );
}

/** A static, non-interactive thumbnail of one slide, scaled to its box. */
export function SlideThumb({ deck, env, index = 0 }: { deck: DeckLike; env: DeckEnv; index?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const fit = () => setScale(el.getBoundingClientRect().width / STAGE_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const slide = deck.slides[index];
  return (
    <div ref={ref} className="relative aspect-video w-full overflow-hidden" aria-hidden inert>
      {slide !== undefined && scale > 0 && (
        <div style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="pointer-events-none absolute left-0 top-0">
          <SlideView slide={slide} env={{ ...env, mode: 'stage', rgb: deck.rgb }} index={index} total={deck.slides.length} deckName={deck.name} />
        </div>
      )}
    </div>
  );
}
