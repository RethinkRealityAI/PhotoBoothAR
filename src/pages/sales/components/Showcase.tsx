/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Feature showcases for the decks' "more than a booth" tiles. Tapping a tile
 * opens a modal that SHOWS the feature: a carousel of real themed frames, a
 * mockup of the AI frame studio, the landing's feature films, a moderation
 * queue you can click through. Prev/next cycles through every tile on the
 * slide, so a presenter can walk the whole list from inside the modal.
 *
 * Portalled to <body> so it is never scaled with the 1280×720 stage. React
 * still bubbles portal events to the deck, so the root stops click, touch and
 * key events — otherwise a tap in the modal would also advance the slide.
 *
 * Brand v2: an opaque indigo sheet (the scene's own surface, so dense mockups
 * sit on a calm ground) with an inset light edge, white ink, sentence case,
 * white pill for the one action.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, EyeOff, Sparkles, Wand2, X } from 'lucide-react';
import FilmEmbed from '../../../components/ui/FilmEmbed';
import { useDialog } from '../../../lib/useDialog';
import { DEMO_KITS, FRAME_THEMES } from '../../../lib/demoKits';
import type { ShowcaseId, SlideItem } from '../../../lib/salesTypes';
import { salesImage } from '../salesImages';
import { salesVideo } from '../salesVideos';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** A well inside the sheet: deeper indigo, hairline rim. */
const WELL = 'bg-[rgba(26,23,64,0.30)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]';
/** Quiet round/pill control: indigo veil, hairline rim, white ink. */
const QUIET = 'bg-[rgba(26,23,64,0.24)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)] transition hover:bg-[rgba(26,23,64,0.40)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';
const PRIMARY = 'bg-[color:var(--bw-accent)] text-[color:var(--bw-on-accent)] transition hover:bg-[color:var(--bw-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
const LABEL = 'text-[13px] font-medium text-white/80';

const BACKDROPS = ['event-wedding', 'event-gala', 'event-birthday', 'event-activation', 'event-conference', 'event-tradeshow'];
const backdrop = (i: number) => salesImage(BACKDROPS[i % BACKDROPS.length])?.src ?? '';

/** A transparent frame over a photo, so it reads as a finished guest shot. */
function FramedShot({ thumb, photo, className = '', alt }: { thumb: string; photo: string; className?: string; alt: string }) {
  return (
    <div className={cx('relative aspect-[9/16] overflow-hidden rounded-2xl bg-[color:var(--bw-deep-2)] shadow-[0_24px_50px_-24px_rgba(10,8,40,0.8)] ring-1 ring-white/20', className)}>
      {photo !== '' && <img src={photo} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
      <img src={thumb} alt={alt} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
    </div>
  );
}

// ── Frames: themed carousel ────────────────────────────────────────────────

function FramesShowcase() {
  const [theme, setTheme] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (reduced) return;
    const t = window.setInterval(() => setTheme((i) => (i + 1) % FRAME_THEMES.length), 3200);
    return () => window.clearInterval(t);
  }, [paused]);
  const set = FRAME_THEMES[theme];
  return (
    <div>
      <div role="tablist" aria-label="Event themes" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {FRAME_THEMES.map((t, i) => (
          <button
            key={t.theme}
            type="button"
            role="tab"
            aria-selected={i === theme}
            onClick={() => { setTheme(i); setPaused(true); }}
            className={cx(
              'min-h-11 shrink-0 rounded-full px-4 text-[14px] font-medium',
              i === theme ? PRIMARY : QUIET,
            )}
          >
            {t.theme}
          </button>
        ))}
      </div>
      <div key={set.theme} className="sc-fade mt-4 flex items-end justify-center gap-3 sm:gap-5">
        {set.frames.map((f, i) => (
          <FramedShot
            key={f.id}
            thumb={f.thumb}
            photo={backdrop(theme + i)}
            alt={`${f.name} frame`}
            className={cx('w-[30%] max-w-[190px]', set.frames.length === 3 && i === 1 && 'mb-4 sm:mb-6')}
          />
        ))}
      </div>
      <p className="mt-4 text-center text-[14px] text-white/[0.86]">
        Every event gets its own: names, dates, colours and monograms. {paused ? '' : 'Cycling themes…'}
      </p>
    </div>
  );
}

// ── AI studio mockup ───────────────────────────────────────────────────────

const AI_PROMPT = 'Gold and emerald owanbe wedding for Tolu & Femi. Aso-oke pattern, florals, a monogram.';

function AiShowcase() {
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'thinking' | 'done'>('typing');
  const [run, setRun] = useState(0);
  useEffect(() => {
    setTyped(0);
    setPhase('typing');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (reduced) {
      setTyped(AI_PROMPT.length);
      setPhase('done');
      return;
    }
    let n = 0;
    const t = window.setInterval(() => {
      n += 2;
      setTyped(Math.min(n, AI_PROMPT.length));
      if (n >= AI_PROMPT.length) {
        window.clearInterval(t);
        setPhase('thinking');
        window.setTimeout(() => setPhase('done'), 1700);
      }
    }, 35);
    return () => window.clearInterval(t);
  }, [run]);
  const results = DEMO_KITS.wedding.frames.slice(0, 3);
  return (
    <div className={cx('overflow-hidden rounded-[20px]', WELL)}>
      <div className="flex items-center gap-2 border-b border-white/[0.12] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" /><span className="h-2.5 w-2.5 rounded-full bg-white/25" /><span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <p className={cx('ml-2', LABEL)}>Beamwall Studio · AI frames</p>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-white/[0.08] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
            <p className={LABEL}>Describe the event</p>
            <p className="mt-1.5 min-h-[4.5em] text-[14.5px] leading-snug text-white">
              {AI_PROMPT.slice(0, typed)}
              {phase === 'typing' && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-white" />}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['#0F5132', '#D4AF37', '#F5EBDD', '#7E5C14'].map((c) => (
              <span key={c} className="h-7 w-7 rounded-full ring-1 ring-white/30" style={{ background: c }} aria-hidden />
            ))}
            <span className="ml-1 self-center text-[13px] text-white/[0.86]">Palette from the invitation</span>
          </div>
          <button
            type="button"
            onClick={() => setRun((r) => r + 1)}
            className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold', PRIMARY)}
          >
            <Wand2 className="h-4 w-4" strokeWidth={1.75} aria-hidden /> {phase === 'done' ? 'Design again' : 'Designing…'}
          </button>
        </div>
        <div>
          <p className={cx('mb-2 flex items-center gap-1.5', LABEL)}>
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {phase === 'done' ? '3 frames ready' : phase === 'thinking' ? 'Designing your frames…' : 'Results'}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {results.map((f, i) => (
              phase === 'done' ? (
                <div key={`${run}-${f.id}`} className="sc-pop" style={{ animationDelay: `${i * 140}ms` }}>
                  <FramedShot thumb={f.thumb} photo={backdrop(i)} alt={`AI frame option ${i + 1}`} />
                </div>
              ) : (
                <div key={f.id} className="aspect-[9/16] animate-pulse rounded-2xl bg-white/[0.08] motion-reduce:animate-none" />
              )
            ))}
          </div>
        </div>
      </div>
      <p className="border-t border-white/[0.12] px-4 py-2 text-[13px] text-white/80">
        A mockup of the studio. Your designer briefs it in a sentence, then refines the result.
      </p>
    </div>
  );
}

// ── Moderation mockup ──────────────────────────────────────────────────────

function ModerationShowcase() {
  const [hold, setHold] = useState(true);
  const [state, setState] = useState<Record<number, 'live' | 'hidden'>>({});
  const tiles = [0, 1, 2, 3, 4, 5];
  return (
    <div>
      <label className={cx('flex min-h-11 items-center justify-between gap-3 rounded-xl px-4', WELL)}>
        <span className="text-[14px] text-white">Hold photos for approval</span>
        <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} className="h-5 w-5 accent-white" />
      </label>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {tiles.map((i) => {
          const s = state[i] ?? (hold ? undefined : 'live');
          return (
            <div key={i} className={cx('relative overflow-hidden rounded-xl ring-1 transition', s === 'hidden' ? 'opacity-35 ring-white/10' : s === 'live' ? 'ring-2 ring-[color:var(--bw-success)]' : 'ring-white/20')}>
              <img src={backdrop(i)} alt="" draggable={false} className="aspect-square w-full object-cover" />
              {s === undefined ? (
                <div className="absolute inset-x-1 bottom-1 flex gap-1">
                  <button type="button" onClick={() => setState((p) => ({ ...p, [i]: 'live' }))} aria-label="Approve photo" className="flex min-h-9 flex-1 items-center justify-center rounded-lg bg-white text-[color:var(--bw-on-accent)]"><Check className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setState((p) => ({ ...p, [i]: 'hidden' }))} aria-label="Hide photo" className="flex min-h-9 flex-1 items-center justify-center rounded-lg bg-[rgba(26,23,64,0.80)] text-white"><EyeOff className="h-4 w-4" /></button>
                </div>
              ) : (
                <span className="absolute left-1 top-1 rounded-full bg-[rgba(26,23,64,0.80)] px-2 py-0.5 text-[12px] font-medium text-white">{s === 'live' ? 'On the wall' : 'Hidden'}</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[14px] text-white/[0.86]">Approve or hide from any phone. Hidden photos never reach the wall.</p>
    </div>
  );
}

function GalleryShowcase() {
  const frames = FRAME_THEMES.flatMap((t) => t.frames).slice(0, 8);
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {frames.map((f, i) => <FramedShot key={f.id} thumb={f.thumb} photo={backdrop(i)} alt="" className="rounded-xl" />)}
      </div>
      <p className="mt-3 text-center text-[14px] text-white/[0.86]">Every shot in one gallery link after the event, ready to download and share.</p>
    </div>
  );
}

function Film({ k }: { k: string }) {
  const v = salesVideo(k);
  if (v === null) return null;
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-white/20">
      <FilmEmbed src={v.src} poster={v.poster} label={v.label} />
    </div>
  );
}

const BODY: Record<ShowcaseId, () => ReactNode> = {
  frames: () => <FramesShowcase />,
  ai: () => <AiShowcase />,
  wall: () => <Film k="wall" />,
  '3d': () => <Film k="booth" />,
  challenges: () => <Film k="challenges" />,
  keepsake: () => <Film k="cards" />,
  moderation: () => <ModerationShowcase />,
  gallery: () => <GalleryShowcase />,
};

export function hasShowcase(id: string | undefined): id is ShowcaseId {
  return id !== undefined && Object.prototype.hasOwnProperty.call(BODY, id);
}

const SC_CSS = `
@keyframes sc-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes sc-pop { from { opacity: 0; transform: scale(0.85); filter: blur(6px) brightness(1.8); } to { opacity: 1; transform: none; filter: none; } }
.sc-fade { animation: sc-fade 420ms ease-out both; }
.sc-pop { animation: sc-pop 560ms cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .sc-fade, .sc-pop { animation: none; } }
`;

/** Modal over every showcase tile of one slide; `start` is the tapped one. */
export function ShowcaseModal({ items, start, onClose }: { items: SlideItem[]; start: number; onClose: () => void }) {
  const list = items.filter((it) => hasShowcase(it.showcase));
  const [i, setI] = useState(() => Math.max(0, list.findIndex((it) => it === items[start])));
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(() => closeRef.current(), list[i]?.title ?? 'Feature');
  const item = list[i];
  if (item === undefined || !hasShowcase(item.showcase)) return null;
  const go = (d: number) => setI((n) => (n + d + list.length) % list.length);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(15,13,51,0.62)] backdrop-blur-md sm:items-center sm:p-6 [font-family:var(--bw-font-text)]"
      onClick={(e) => { stop(e); onClose(); }}
      onTouchStart={stop}
      onTouchEnd={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'ArrowRight') go(1);
        else if (e.key === 'ArrowLeft') go(-1);
      }}
    >
      <style>{SC_CSS}</style>
      <div
        ref={panelRef}
        {...dialogProps}
        onClick={stop}
        className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-[#352FA6] text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.40),inset_-1px_-1px_0_rgba(255,255,255,0.08),inset_0_0_0_1px_rgba(255,255,255,0.10),0_40px_100px_-30px_rgba(10,8,40,0.75)] sm:max-w-3xl sm:rounded-[28px]"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-7">
          <div className="min-w-0">
            <p className="text-[13px] font-medium tabular-nums text-white/80">
              {i + 1} of {list.length}
            </p>
            <h2 className="mt-1 font-[family-name:var(--bw-font-display)] text-[26px] font-[700] leading-tight tracking-[-0.022em] text-white sm:text-[32px]">{item.title}</h2>
            {item.body !== undefined && <p className="mt-1 text-[14.5px] text-white/[0.86]">{item.body}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', QUIET)}>
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div key={item.title} className="sc-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 sm:px-7">
          {BODY[item.showcase]()}
        </div>
        {list.length > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.12] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-7">
            <button type="button" onClick={() => go(-1)} className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px]', QUIET)}>
              <ChevronLeft className="h-4 w-4" aria-hidden /> {list[(i - 1 + list.length) % list.length].title}
            </button>
            <button type="button" onClick={() => go(1)} className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px]', QUIET)}>
              {list[(i + 1) % list.length].title} <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
