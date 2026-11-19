/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ArPicker — the "How it works" AR step's real, clickable picker. The page
 * drives what Beamy wears; this is the UI, floating on the scene (no panel):
 *
 *   • a floating glass tab switcher: Frames, Props, Filters, Effects;
 *   • the tab's looks as floating tile cards. A tap wears that look, ONE per
 *     category, so a frame, a prop, a filter and an effect combine; a tap on
 *     what he already wears takes it off (lib/beamyAssets toggleLook);
 *   • the picked frame stands IN FRONT of him (a DOM image over him, so its
 *     transparent window shows him through it); the page places it on him
 *     every frame from the stage's own numbers (AR_FRAME_FRONT).
 *
 * The tile area always reserves the biggest category's room, so switching
 * tabs never changes its height. Only interactive while its step is up
 * (`active`); otherwise it is inert and faded, so keyboard focus never lands
 * on an invisible control. `stacked` = phones and portrait tablets (the
 * picker above him, the tiles one row that scrolls sideways).
 */
import type { Ref } from 'react';
import { Music2, Sparkles, X, Zap, type LucideIcon } from 'lucide-react';
import {
  AR_CATEGORIES, lookAction, lookThumb, selectedLooks,
  type ArSelection, type HomeLook, type LookCategory,
} from '../../lib/beamyAssets';
import { AR_COPY } from '../../lib/beamyStory';

const FX_ICONS: Record<string, LucideIcon> = { sparkles: Sparkles, beam: Zap, dance: Music2 };
/** Wide screens lay the tiles out three to a row. */
const WIDE_COLS = 3;

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

export default function ArPicker({ looks, sel, tab, onTab, onToggle, active, stacked, frameRef }: {
  /** The picker's looks, in category order (lib/beamyAssets arOrder). */
  looks: HomeLook[];
  /** What he wears: one look id per category. */
  sel: ArSelection;
  /** The tab on show. */
  tab: LookCategory;
  onTab: (c: LookCategory) => void;
  onToggle: (l: HomeLook) => void;
  active: boolean;
  stacked: boolean;
  /** The frame image; the page places it on him every frame. */
  frameRef: Ref<HTMLImageElement>;
}) {
  const inTab = looks.filter((l) => l.category === tab);
  // The biggest category's room, always: switching tabs never resizes the tiles.
  const most = Math.max(1, ...AR_CATEGORIES.map((c) => looks.filter((l) => l.category === c.id).length));
  const spare = stacked ? 0 : Math.ceil(most / WIDE_COLS) * WIDE_COLS - inTab.length;
  const worn = selectedLooks(sel, looks);
  const frame = worn.find((l) => l.category === 'frame');
  const frameUrl = frame !== undefined ? lookAction(frame) : null;

  return (
    <div className="bw-ar" data-on={active ? 'true' : 'false'} inert={!active} data-stacked={stacked ? 'true' : 'false'}>
      {/* The frame he wears stands in front of him (placed by the page). */}
      {frameUrl !== null && frameUrl.kind === 'frame' && (
        <img key={frame?.id} ref={frameRef} className="bw-ar-frame" src={frameUrl.url} alt="" aria-hidden draggable={false} />
      )}
      {/* The picker: above him on phones, lower left on wide screens. */}
      <div className={stacked ? 'absolute inset-x-0 top-0 z-[2] mx-auto max-w-[460px]' : 'absolute bottom-[6%] left-[clamp(24px,4vw,64px)] z-[2] w-[min(372px,31vw)]'}>
        <p className="sr-only">{AR_COPY.line}</p>
        <p className="sr-only" aria-live="polite">{worn.length > 0 ? `Beamy is wearing: ${worn.map((l) => l.name).join(', ')}` : 'Beamy is wearing nothing yet'}</p>
        <div role="group" aria-label="Kinds of looks" className={`bw-ar-tabs ${stacked ? 'mx-auto' : ''}`}>
          {AR_CATEGORIES.map((c) => {
            const n = sel[c.id] !== undefined;
            return (
              <button key={c.id} type="button" className="bw-ar-tab" aria-pressed={tab === c.id} onClick={() => onTab(c.id)}>
                {c.label}
                {n && <span className="bw-ar-dot" aria-hidden />}
                {n && <span className="sr-only"> (one on)</span>}
              </button>
            );
          })}
        </div>
        <div
          role="group"
          aria-label={AR_COPY.pick}
          data-fx-anchor="prop"
          className={stacked ? 'bw-ar-row mt-2.5' : 'mt-3 grid grid-cols-3 gap-2.5'}
        >
          {inTab.map((l) => {
            const a = lookAction(l);
            const t = a.kind === 'frame' || a.kind === 'prop' || a.kind === 'media' ? lookThumb(l) : null;
            const Icon = a.kind === 'fx' ? FX_ICONS[a.fx] : null;
            const on = sel[l.category] === l.id;
            return (
              <button
                key={l.id}
                type="button"
                className={`bw-ar-tile ${stacked ? 'w-[72px] shrink-0' : ''}`}
                aria-pressed={on}
                aria-label={on ? `${l.name}, on. Tap to take it off` : l.name}
                title={l.name}
                onClick={() => onToggle(l)}
              >
                <span className="bw-ar-pic" aria-hidden>
                  {t !== null && <img src={t} alt="" draggable={false} />}
                  {a.kind === 'tint' && <Swatch color={a.color} />}
                  {Icon !== null && <Icon className="h-6 w-6" strokeWidth={1.6} />}
                </span>
                <span className="bw-ar-name" aria-hidden>{l.name}</span>
                {on && <span className="bw-ar-off" aria-hidden><X className="h-3 w-3" strokeWidth={2.4} /></span>}
              </button>
            );
          })}
          {/* Same shape as a tile, unseen: holds the row height. */}
          {Array.from({ length: spare }, (_, k) => (
            <span key={`spare-${k}`} className="bw-ar-tile bw-ar-spare" aria-hidden><span className="bw-ar-pic" /><span className="bw-ar-name">&nbsp;</span></span>
          ))}
        </div>
      </div>
    </div>
  );
}
