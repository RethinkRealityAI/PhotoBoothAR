/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ArPicker — the "How it works" AR step's real, clickable picker. Beamy
 * wears whatever is picked (the page drives the stage); this is the UI:
 *
 *   • category tabs (Frames, Props, Filters, Effects) as glass chips;
 *   • the category's looks as thumbnail buttons (a tap switches him at once;
 *     the page pauses its auto tour for a while after any tap);
 *   • for frames, a carousel around him: the frame he wears stands behind
 *     him (drawn by the stage), the next ones fan out beside him as peeks;
 *     arrows, a tap on a peek, or a swipe across the carousel moves along.
 *
 * Only interactive while its step is up (`active`); otherwise it is inert
 * and faded, so keyboard focus never lands on an invisible control.
 * `stacked` = phones and portrait tablets (panel above him, peeks both sides).
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Music2, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { AR_CATEGORIES, carousel, categoryStart, lookAction, lookThumb, type HomeLook, type LookCategory } from '../../lib/beamyAssets';
import { AR_COPY } from '../../lib/beamyStory';

const FX_ICONS: Record<string, LucideIcon> = { sparkles: Sparkles, beam: Zap, dance: Music2 };

/** A filter's swatch: its own colour as a soft flat disc (prismatic: three flat bands). */
function Swatch({ color }: { color: string }) {
  if (color === 'prismatic') {
    return (
      <span className="bw-ar-swatch" aria-hidden>
        <span style={{ background: '#38BDF8' }} /><span style={{ background: '#A78BFA' }} /><span style={{ background: '#F472B6' }} />
      </span>
    );
  }
  return <span className="bw-ar-swatch" aria-hidden><span style={{ background: color }} /></span>;
}

export default function ArPicker({ looks, ix, onPick, active, stacked }: {
  /** The picker's looks, in category order (lib/beamyAssets arOrder). */
  looks: HomeLook[];
  ix: number;
  onPick: (i: number) => void;
  active: boolean;
  stacked: boolean;
}) {
  const cur = looks[ix];
  const cat: LookCategory = cur?.category ?? 'frame';
  const inCat = looks.map((l, i) => ({ l, i })).filter((x) => x.l.category === cat);
  const frames = looks.map((l, i) => ({ l, i })).filter((x) => x.l.category === 'frame');
  const fPos = frames.findIndex((x) => x.i === ix);
  const car = fPos >= 0 ? carousel(fPos, frames.length) : null;
  const step = (d: number) => {
    if (fPos < 0 || frames.length === 0) return;
    onPick(frames[(((fPos + d) % frames.length) + frames.length) % frames.length].i);
  };
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => { swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (s === null || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.4) step(dx < 0 ? 1 : -1);
  };

  const peek = (k: number | null, side: 'prev' | 'next' | 'after') => {
    if (k === null) return null;
    const f = frames[k];
    const t = lookThumb(f.l) ?? f.l.url;
    return (
      <button
        key={`${side}-${f.l.id}`}
        type="button"
        className="bw-ar-peek"
        data-side={side}
        tabIndex={-1}
        aria-hidden
        onClick={() => onPick(f.i)}
      >
        <img src={t} alt="" draggable={false} />
      </button>
    );
  };

  const panel = (
    <div className={`bw-ar-panel bw-glass-card bw-pane ${stacked ? 'px-3 pb-3 pt-3' : 'px-5 pb-5 pt-4'}`}>
      <p className={`bw-small ${stacked ? 'text-[13px] leading-snug' : ''}`} style={{ color: 'var(--bw-ink)' }}>{AR_COPY.line}</p>
      <div role="group" aria-label="Kinds of looks" className={`flex gap-1.5 ${stacked ? 'mt-2.5 overflow-x-auto [scrollbar-width:none]' : 'mt-3 flex-wrap'}`}>
        {AR_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`bw-glass-chip shrink-0 ${stacked ? 'px-3 text-[13px]' : 'px-3.5'}`}
            aria-pressed={cat === c.id}
            onClick={() => { const k = categoryStart(looks, c.id); if (k >= 0) onPick(k); }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div
        role="group"
        aria-label={AR_COPY.pick}
        data-fx-anchor="prop"
        className={`mt-2.5 ${stacked ? 'flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]' : 'grid grid-cols-3 gap-2'}`}
      >
        {inCat.map(({ l, i }) => {
          const a = lookAction(l);
          const t = a.kind === 'frame' || a.kind === 'prop' ? lookThumb(l) : a.kind === 'media' ? lookThumb(l) : null;
          const Icon = a.kind === 'fx' ? FX_ICONS[a.fx] : null;
          return (
            <button
              key={l.id}
              type="button"
              className={`bw-ar-tile ${stacked ? 'w-[68px] shrink-0' : ''}`}
              aria-pressed={i === ix}
              aria-label={l.name}
              title={l.name}
              onClick={() => onPick(i)}
            >
              <span className="bw-ar-pic" aria-hidden>
                {t !== null && <img src={t} alt="" draggable={false} />}
                {a.kind === 'tint' && <Swatch color={a.color} />}
                {Icon !== null && <Icon className="h-6 w-6" strokeWidth={1.6} />}
              </span>
              <span className="bw-ar-name" aria-hidden>{l.name}</span>
            </button>
          );
        })}
      </div>
      {/* Frames: step through the carousel (it also takes a swipe, or a tap on a peek). */}
      {cat === 'frame' && fPos >= 0 && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <button type="button" className="bw-ar-arrow" aria-label={AR_COPY.prev} onClick={() => step(-1)}><ChevronLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden /></button>
          <span className="bw-label min-w-0 truncate text-center" style={{ color: 'var(--bw-ink)' }} aria-live="polite">{cur?.name} · {fPos + 1}/{frames.length}</span>
          <button type="button" className="bw-ar-arrow" aria-label={AR_COPY.next} onClick={() => step(1)}><ChevronRight className="h-5 w-5" strokeWidth={1.8} aria-hidden /></button>
        </div>
      )}
    </div>
  );

  return (
    <div className="bw-ar" data-on={active ? 'true' : 'false'} inert={!active} data-stacked={stacked ? 'true' : 'false'}>
      {/* The panel: above him on phones, lower left on wide screens. */}
      <div className={stacked ? 'absolute inset-x-0 top-0 z-[2] mx-auto max-w-[460px]' : 'absolute bottom-[6%] left-[clamp(24px,4vw,64px)] z-[2] w-[min(380px,27vw)]'}>
        {panel}
      </div>
      {/* The frames carousel shares his slot's box (CSS container units give his height). */}
      {cat === 'frame' && car !== null && (
        <div
          className={`bw-ar-car ${stacked ? 'bottom-[1%] left-[15%] right-[15%] h-[46%]' : 'bottom-[3%] left-[30%] right-[30%] h-[58%]'}`}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => { swipe.current = null; }}
        >
          {stacked && peek(car.prev, 'prev')}
          {peek(car.after, 'after')}
          {peek(car.next, 'next')}
        </div>
      )}
    </div>
  );
}
