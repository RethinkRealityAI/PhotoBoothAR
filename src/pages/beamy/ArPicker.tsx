/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ArPicker: the clickable picker on the "How it works" AR step. The page
 * decides what Beamy wears; this file is only the UI, floating on the scene
 * with no panel.
 *
 *   • A floating glass tab switcher: Frames, 3D props, Filters, Effects.
 *   • No tiles. In each category the asset itself is the carousel. Each
 *     carousel starts on a "None" stop, which is how a look comes off again
 *     (lib/beamyAssets arStops / wearStop). One look per category, and the
 *     categories combine. Arrows, a tap on a stop, a sideways swipe or the
 *     arrow keys step through the stops.
 *       - Frames: the current frame is on Beamy; the frames before and after
 *         it peek in at his sides.
 *       - 3D props, filters, effects: a rail ABOVE him (and above the frame),
 *         bigger stops in a row, the worn one in the middle; the prop it
 *         names lands on his head, neck or ears. The rail's room is kept on
 *         every tab, so switching tabs never moves him or the frame.
 *   • A title right above the frame in the shared shimmer (components/beamy/
 *     ShineText): a frame names its celebration, the rest their own name.
 *   • The peeks show the real thing:
 *       - frames: the frame image;
 *       - props: the GLB, which the stage draws floating in the stop's place
 *         (the page passes each `[data-prop-url]` stop's box to it);
 *       - filters: a flat swatch orb;
 *       - effects: an icon orb.
 *   • ONE fixed stage (lib/beamyAssets arStage): the page lays the carousel
 *     box on it and he stands in it, the same size and place on every tab
 *     and item. The worn frame fills that box IN FRONT of him (a DOM image,
 *     so its transparent window shows him through it).
 *   • Each category is a track whose stops all stay mounted; a step only
 *     changes each stop's place, so the incoming one glides into place as
 *     the outgoing one glides out to its peek (no jump cut).
 *
 * The picker only takes input while its step is up (`active`). Otherwise it
 * is inert and faded, so keyboard focus never lands on an invisible control.
 * `stacked` covers phones and portrait tablets, where the switcher sits above
 * him; on laptops the page renders ArTabs under the story card.
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

/** A stop's place on a track, as a signed distance from the current stop (wrapping; the shorter way round). */
function offset(i: number, cur: number, n: number): number {
  const d = (((i - cur) % n) + n) % n;
  return d > n / 2 ? d - n : d;
}
/** The CSS position a track item takes: -1/1 the peeks, 0 on him, ±2 parked out of sight. */
const place = (d: number) => String(Math.max(-2, Math.min(2, d)));
/** The rail shows two stops each side of the worn one; ±3 is parked out of sight. */
const RAIL_REACH = 2;
const railPlace = (d: number) => String(Math.max(-RAIL_REACH - 1, Math.min(RAIL_REACH + 1, d)));

/**
 * One carousel track: EVERY stop of a category stays mounted, each keyed by
 * its look, and only its place changes (data-at), so a step is one smooth
 * CSS transition: the incoming stop glides in from its peek while the
 * outgoing one glides out to the other side (brand.css .bw-ar-item).
 */
function Track({ cat, stops, cur, show, noun, onWear, rail = false }: {
  cat: LookCategory;
  stops: (HomeLook | null)[];
  cur: number;
  /** Peeks visible (this tab is on); the frames track always shows the worn frame. */
  show: boolean;
  noun: string;
  onWear: (c: LookCategory, stop: HomeLook | null) => void;
  /** The rail above him: a row of stops, the worn one in the middle and shown too. */
  rail?: boolean;
}) {
  const n = stops.length;
  return (
    <div className="bw-ar-track" data-cat={cat} data-show={show ? 'true' : 'false'} data-rail={rail ? 'true' : undefined}>
      {stops.map((s, i) => {
        const d = n > 1 ? offset(i, cur, n) : 0;
        // Two stops: the other one peeks on the right only.
        const at = n === 2 && d === -1 ? 1 : d;
        const a = s !== null ? lookAction(s) : null;
        const kind = a?.kind === 'frame' ? 'frame' : s === null ? 'none' : 'orb';
        // On the rail every stop in reach is shown (the worn one in the middle); the others peek.
        const seen = rail ? Math.abs(at) <= RAIL_REACH : Math.abs(at) === 1;
        const peek = show && at !== 0 && seen;
        return (
          <button
            key={s?.id ?? 'none'}
            type="button"
            className="bw-ar-item bw-ar-peek"
            data-at={rail ? railPlace(at) : place(at)}
            data-side={at < 0 ? 'prev' : at > 0 ? 'next' : 'on'}
            data-kind={kind}
            data-prop-url={a?.kind === 'prop' && show && seen ? a.url : undefined}
            tabIndex={-1}
            aria-hidden={peek ? undefined : true}
            aria-label={s === null ? `Take the ${noun} off` : `Try ${s.name}`}
            onClick={peek ? () => onWear(cat, s) : undefined}
          >
            <PeekFace stop={s} cat={cat} />
          </button>
        );
      })}
    </div>
  );
}

/** The glass tab switcher (Frames, 3D props, Filters, Effects): inside the picker on phones, under the story card on laptops. */
export function ArTabs({ sel, tab, onTab, className = '' }: { sel: ArSelection; tab: LookCategory; onTab: (c: LookCategory) => void; className?: string }) {
  return (
    <div role="group" aria-label="Kinds of looks" className={`bw-ar-tabs ${className}`}>
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
  );
}

export default function ArPicker({ looks, sel, tab, onTab, onWear, active, stacked, carRef, fx, reduced }: {
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
  /** Phones and portrait tablets: the switcher sits above him, in here. Laptops: the page puts ArTabs under the story card. */
  stacked: boolean;
  /** The carousel box; the page lays it on the fixed AR stage (lib/beamyAssets arStage). */
  carRef: Ref<HTMLDivElement>;
  /** The effect drawn round him (lib/arFx), or null. */
  fx: ArFxKind | null;
  reduced: boolean;
}) {
  const worn = selectedLooks(sel, looks);
  // This tab's carousel: None first, then its looks; the stop he wears is current.
  const stops = arStops(looks, tab);
  const n = stops.length;
  const cur = arStopIndex(sel, looks, tab);
  const at = (d: number) => (((cur + d) % n) + n) % n;
  const step = (d: number) => { if (n > 1) onWear(tab, stops[at(d)]); };
  const noun = AR_NOUN[tab];
  const title = arTitle(tab, stops[cur] ?? null);
  // The frames track is always there: it shows the worn frame on every tab.
  const frameStops = arStops(looks, 'frame');
  const frameCur = arStopIndex(sel, looks, 'frame');
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => { swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sw = swipe.current;
    swipe.current = null;
    if (sw === null || sw.id !== e.pointerId) return;
    const dx = e.clientX - sw.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - sw.y) * 1.4) {
      step(dx < 0 ? 1 : -1);
      // A swipe that ends on a stop is not also a tap on it (the click follows this pointerup).
      swiped.current = true;
      window.setTimeout(() => { swiped.current = false; }, 0);
    }
  };
  const swiped = useRef(false);
  const wear = (c: LookCategory, s: HomeLook | null) => { if (!swiped.current) onWear(c, s); };
  const arrows = (
    <>
      <button type="button" className="bw-ar-arrow" data-side="prev" aria-label={`${AR_COPY.prev} ${noun}`} onClick={() => step(-1)}><ChevronLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden /></button>
      <button type="button" className="bw-ar-arrow" data-side="next" aria-label={`${AR_COPY.next} ${noun}`} onClick={() => step(1)}><ChevronRight className="h-5 w-5" strokeWidth={1.8} aria-hidden /></button>
    </>
  );
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    }
  };

  return (
    <div className="bw-ar" data-on={active ? 'true' : 'false'} inert={!active} data-stacked={stacked ? 'true' : 'false'}>
      {/* The carousel, on the fixed AR stage (placed by the page): the worn
          frame fills it, in front of him; the title above; the stops before
          and after peek at its sides; arrows on its edges. */}
      <div
        ref={carRef}
        className="bw-ar-car"
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
        <Track cat="frame" stops={frameStops} cur={frameCur} show={tab === 'frame'} noun={AR_NOUN.frame} onWear={wear} />
        {/* The effect, drawn round him and over the frame (never takes a tap). */}
        {fx !== null && <ArFxCanvas key={fx} kind={fx} reduced={reduced} className="bw-ar-fx" />}
        {/* Above the frame: the rail (props, filters, effects), then the title.
            The rail's room is there on the Frames tab too (empty), so a tab
            change never moves the frame or him. */}
        <div className="bw-ar-top">
          <div
            className="bw-ar-rail"
            data-on={tab !== 'frame' ? 'true' : 'false'}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onPointerCancel={() => { swipe.current = null; }}
          >
            {tab !== 'frame' && <Track key={tab} cat={tab} stops={stops} cur={cur} show noun={noun} onWear={wear} rail />}
            {tab !== 'frame' && n > 1 && arrows}
          </div>
          <p className="bw-ar-title" aria-hidden><ShineText key={title} text={title} className="bw-ar-title-text" /></p>
        </div>
        {tab === 'frame' && n > 1 && arrows}
      </div>
      <p className="sr-only">{AR_COPY.line}</p>
      <p className="sr-only" aria-live="polite">{worn.length > 0 ? `Beamy is wearing: ${worn.map((l) => l.name).join(', ')}` : 'Beamy is wearing nothing yet'}</p>
      {/* Phones: the switcher above him. (Laptops: the page puts ArTabs under the story card.) */}
      {stacked && (
        <div className="absolute inset-x-0 top-0 z-[2] mx-auto max-w-[460px]">
          <ArTabs sel={sel} tab={tab} onTab={onTab} className="mx-auto" />
        </div>
      )}
    </div>
  );
}
