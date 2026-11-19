/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ArPicker: the clickable picker on the "How it works" AR step. The page
 * decides what Beamy wears; this file is only the UI, floating on the scene
 * with no panel.
 *
 *   • A floating glass tab switcher: Frames, 3D props, Filters, Effects.
 *   • No tiles. In each category the asset itself is the carousel. The
 *     current stop is on Beamy. The stops before and after it peek in at its
 *     sides. Arrows, a tap on a peek, a sideways swipe or the arrow keys step
 *     through the stops. Each carousel starts on a "None" stop, which is how
 *     a look comes off again (lib/beamyAssets arStops / wearStop). One look
 *     per category, and the categories combine.
 *   • A title above it in the shared shimmer (components/beamy/ShineText):
 *     a frame names its celebration, the rest their own name.
 *   • The peeks show the real thing:
 *       - frames: the frame image;
 *       - props: the GLB, which the stage draws floating in the peek's place
 *         (the page passes each `[data-prop-url]` peek's box to it);
 *       - filters: a flat swatch orb;
 *       - effects: an icon orb.
 *   • The worn frame stands IN FRONT of him: a DOM image over him, so its
 *     transparent window shows him through it. The page places the frame
 *     and the carousel box every frame from the stage's numbers. The box
 *     sits over the frame when he wears one (data-mode "frame"), otherwise
 *     around him (data-mode "stand").
 *
 * The picker only takes input while its step is up (`active`). Otherwise it
 * is inert and faded, so keyboard focus never lands on an invisible control.
 * `stacked` covers phones and portrait tablets, where the switcher sits above
 * him.
 */
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { ChevronLeft, ChevronRight, CircleSlash, Heart, Music, PartyPopper, Snowflake, Sparkles, Spotlight, type LucideIcon } from 'lucide-react';
import {
  AR_CATEGORIES, AR_NOUN, NONE_TITLE, arStopIndex, arStops, arTitle, lookAction, lookThumb, selectedLooks,
  type ArFx, type ArSelection, type HomeLook, type LookCategory,
} from '../../lib/beamyAssets';
import type { ArFxKind } from '../../lib/arFx';
import { AR_COPY } from '../../lib/beamyStory';
import ShineText from '../../components/beamy/ShineText';
import ArFxCanvas from '../../components/beamy/ArFx';

/** Each effect's line icon (no emoji). */
const FX_ICONS: Record<ArFx, LucideIcon> = { sparkles: Sparkles, snow: Snowflake, confetti: PartyPopper, hearts: Heart, notes: Music, spotlight: Spotlight };

/** A filter's swatch: its own colour as a flat disc (prismatic: three flat bands). */
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

/** What a peek shows: the frame, an empty orb the stage fills with the prop, a swatch, an icon, or None. */
function PeekFace({ stop, cat }: { stop: HomeLook | null; cat: LookCategory }) {
  // None: a small glass chip, its label under it ("No frame", "No 3D prop" ...).
  if (stop === null) {
    return (
      <span className="bw-ar-none" aria-hidden>
        <span className="bw-ar-orb bw-ar-none-chip"><CircleSlash className="h-[18px] w-[18px]" strokeWidth={1.7} /></span>
        <span className="bw-ar-none-label">{NONE_TITLE[cat]}</span>
      </span>
    );
  }
  const a = lookAction(stop);
  if (a.kind === 'frame') return <img src={a.url} alt="" draggable={false} />;
  if (a.kind === 'prop') return <span className="bw-ar-orb" data-prop aria-hidden />;
  if (a.kind === 'tint') return <span className="bw-ar-orb" aria-hidden><Swatch color={a.color} /></span>;
  if (a.kind === 'media') return <span className="bw-ar-orb" aria-hidden><img src={lookThumb(stop) ?? a.url} alt="" draggable={false} /></span>;
  const Icon = a.kind === 'fx' ? FX_ICONS[a.fx] : null;
  return <span className="bw-ar-orb" aria-hidden>{Icon !== null && <Icon className="h-6 w-6" strokeWidth={1.6} />}</span>;
}

export default function ArPicker({ looks, sel, tab, onTab, onWear, active, stacked, frameRef, carRef, fx, reduced }: {
  /** The picker's looks, in category order (lib/beamyAssets arOrder). */
  looks: HomeLook[];
  /** What he wears: one look id per category. */
  sel: ArSelection;
  /** The tab on show. */
  tab: LookCategory;
  onTab: (c: LookCategory) => void;
  /** Wear a carousel stop in its category (null = take that category off). */
  onWear: (c: LookCategory, stop: HomeLook | null) => void;
  active: boolean;
  stacked: boolean;
  /** The frame image; the page places it on him every frame. */
  frameRef: Ref<HTMLImageElement>;
  /** The carousel box; the page lays it over the frame, or around him. */
  carRef: Ref<HTMLDivElement>;
  /** The effect drawn round him (lib/arFx), or null. */
  fx: ArFxKind | null;
  reduced: boolean;
}) {
  const worn = selectedLooks(sel, looks);
  const frame = worn.find((l) => l.category === 'frame');
  const frameUrl = frame !== undefined ? lookAction(frame) : null;
  // This tab's carousel: None first, then its looks; the stop he wears is current.
  const stops = arStops(looks, tab);
  const n = stops.length;
  const cur = arStopIndex(sel, looks, tab);
  const at = (d: number) => (((cur + d) % n) + n) % n;
  const step = (d: number) => { if (n > 1) onWear(tab, stops[at(d)]); };
  const noun = AR_NOUN[tab];
  const title = arTitle(tab, stops[cur] ?? null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => { swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sw = swipe.current;
    swipe.current = null;
    if (sw === null || sw.id !== e.pointerId) return;
    const dx = e.clientX - sw.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - sw.y) * 1.4) step(dx < 0 ? 1 : -1);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    }
  };
  const peek = (d: -1 | 1) => {
    if (n < 2 || (n === 2 && d === -1)) return null;
    const s = stops[at(d)];
    const a = s !== null ? lookAction(s) : null;
    const side = d < 0 ? 'prev' : 'next';
    return (
      <button
        key={`${side}-${s?.id ?? 'none'}`}
        type="button"
        className="bw-ar-peek"
        data-side={side}
        data-kind={a?.kind === 'frame' ? 'frame' : s === null ? 'none' : 'orb'}
        data-prop-url={a?.kind === 'prop' ? a.url : undefined}
        tabIndex={-1}
        aria-label={s === null ? `Take the ${noun} off` : `Try ${s.name}`}
        onClick={() => onWear(tab, s)}
      >
        <PeekFace stop={s} cat={tab} />
      </button>
    );
  };
  // Over the worn frame, else around him.
  const mode = frameUrl !== null && frameUrl.kind === 'frame' ? 'frame' : 'stand';

  return (
    <div className="bw-ar" data-on={active ? 'true' : 'false'} inert={!active} data-stacked={stacked ? 'true' : 'false'}>
      {/* The frame he wears stands in front of him (placed by the page). */}
      {frameUrl !== null && frameUrl.kind === 'frame' && (
        <img key={frame?.id} ref={frameRef} className="bw-ar-frame" src={frameUrl.url} alt="" aria-hidden draggable={false} />
      )}
      {/* The carousel, laid over the frame or around him by the page: the title
          above, the stops before and after peeking at its sides, arrows on its edges. */}
      <div
        ref={carRef}
        className="bw-ar-car"
        data-mode={mode}
        data-tab={tab}
        data-fx-anchor="prop"
        role="group"
        aria-roledescription="carousel"
        aria-label={`${AR_CATEGORIES.find((c) => c.id === tab)?.label ?? ''}: ${title}. ${AR_COPY.pick}`}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => { swipe.current = null; }}
      >
        {/* The effect, drawn round him (never takes a tap). */}
        {fx !== null && <ArFxCanvas kind={fx} reduced={reduced} className="bw-ar-fx" />}
        <p className="bw-ar-title" aria-hidden><ShineText key={title} text={title} className="bw-ar-title-text" /></p>
        {peek(-1)}
        {peek(1)}
        {n > 1 && (
          <>
            <button type="button" className="bw-ar-arrow" data-side="prev" aria-label={`${AR_COPY.prev} ${noun}`} onClick={() => step(-1)}><ChevronLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden /></button>
            <button type="button" className="bw-ar-arrow" data-side="next" aria-label={`${AR_COPY.next} ${noun}`} onClick={() => step(1)}><ChevronRight className="h-5 w-5" strokeWidth={1.8} aria-hidden /></button>
          </>
        )}
      </div>
      {/* The switcher: above him on phones, lower left on wide screens. */}
      <div className={stacked ? 'absolute inset-x-0 top-0 z-[2] mx-auto max-w-[460px]' : 'absolute bottom-[6%] left-[clamp(24px,4vw,64px)] z-[2] w-[min(372px,31vw)]'}>
        <p className="sr-only">{AR_COPY.line}</p>
        <p className="sr-only" aria-live="polite">{worn.length > 0 ? `Beamy is wearing: ${worn.map((l) => l.name).join(', ')}` : 'Beamy is wearing nothing yet'}</p>
        <div role="group" aria-label="Kinds of looks" className={`bw-ar-tabs ${stacked ? 'mx-auto' : ''}`}>
          {AR_CATEGORIES.map((c) => {
            const on = sel[c.id] !== undefined;
            return (
              <button key={c.id} type="button" className="bw-ar-tab" aria-pressed={tab === c.id} onClick={() => onTab(c.id)}>
                {c.label}
                {on && <span className="bw-ar-dot" aria-hidden />}
                {on && <span className="sr-only"> (one on)</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
