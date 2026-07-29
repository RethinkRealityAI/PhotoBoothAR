/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LayerList — ONE flat list of the scene's layers, in true paint order.
 *
 * What it replaces: three FIXED BUCKETS (Frame · Stickers · 3D pieces) rendered
 * over a reducer that reordered the flat `objects` array. The two disagreed, so
 * pressing "move up" on the sticker next to the frame changed what painted over
 * what and moved NOTHING in the visible list — the host pressed a button and saw
 * no result. state.ts carried a comment admitting it.
 *
 * Now the list IS the array (reversed for display, top-most first), every row
 * shows where it sits in the paint stack, reorder is visible where it happens,
 * and rows can be dragged. The kind of a layer is a BADGE, not a bucket — the
 * grouping information survives without the grouping lie.
 *
 * Drag-to-reorder is hand-rolled pointer events, matching the deliberate
 * no-dnd-kit decision already made for the asset dock (src/lib/studio/dnd.ts +
 * useStudioDnd.ts); all the maths is pure and tested in lib/studio/layerOrder.ts.
 *
 * Each row is TWO lines: identity (handle · stack position · kind icon · name ·
 * badges) over a full action bar (rename · hide · up · down · REMOVE). One line
 * could not hold both: five controls plus a name in a 19rem dock left the name
 * ~80px and every control a 14px glyph, so rename hid behind :hover (unreachable
 * on touch) and delete — the thing the owner said had "no clear way" — was the
 * last icon of a five-icon huddle. The extra line costs vertical space in a
 * scrolling panel and buys targets a thumb can actually hit.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Boxes,
  Crown,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  LayoutTemplate,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { layerRows, stepTargetIndex, rowAtPointer, dropIndexForRow, paintOrderHint } from '../../lib/studio/layerOrder';
import type { StudioAction, StudioObject } from '../../lib/studio/state';
import Tooltip from '../ui/Tooltip';

interface Props {
  objects: StudioObject[];
  selectedId: string | null;
  /** Display names (de-duplicated "Golden Crown 2"), keyed by object id. */
  displayNames: Map<string, string>;
  dispatch: React.Dispatch<StudioAction>;
}

function objectIcon(o: StudioObject) {
  if (o.type === 'overlay') return o.overlayKind === 'border' ? LayoutTemplate : ImageIcon;
  return o.type === 'headpiece' ? Crown : Boxes;
}

/** The badge that carries the kind information the old buckets used to. */
function kindBadge(o: StudioObject): string {
  if (o.type === 'overlay') return o.overlayKind === 'border' ? 'Frame' : 'Sticker';
  return o.type === 'headpiece' ? 'Head' : '3D';
}

const DRAG_THRESHOLD = 5; // px before a press on the handle becomes a drag

export default function LayerList({ objects, selectedId, displayNames, dispatch }: Props) {
  const rows = layerRows(objects);
  const count = objects.length;

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  /** Row currently being dragged, and the row it is hovering. */
  const [drag, setDrag] = useState<{ fromRow: number; overRow: number } | null>(null);

  const listRef = useRef<HTMLUListElement>(null);
  // Live drag bookkeeping the window listeners read (they cannot see state).
  const dragState = useRef<{ fromRow: number; startY: number; active: boolean } | null>(null);

  const commitRename = useCallback((id: string) => {
    // RENAME_OBJECT ignores an empty name, so an emptied field cancels rather
    // than producing a nameless layer.
    dispatch({ type: 'RENAME_OBJECT', id, name: renameText });
    setRenamingId(null);
  }, [dispatch, renameText]);

  /** Measure each row so the pointer can be mapped onto one (pure maths in layerOrder). */
  const rowRects = useCallback(() => {
    const el = listRef.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll('[data-layer-row]')).map((n) => {
      const r = (n as HTMLElement).getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
  }, []);

  const beginRowDrag = useCallback((fromRow: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragState.current = { fromRow, startY: e.clientY, active: false };

    const onMove = (ev: PointerEvent) => {
      const st = dragState.current;
      if (!st) return;
      if (!st.active) {
        if (Math.abs(ev.clientY - st.startY) < DRAG_THRESHOLD) return;
        st.active = true;
      }
      const over = rowAtPointer(rowRects(), ev.clientY);
      setDrag({ fromRow: st.fromRow, overRow: over ?? st.fromRow });
    };

    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      const st = dragState.current;
      dragState.current = null;
      setDrag(null);
      if (!st?.active) return; // a click on the handle, not a drag
      const over = rowAtPointer(rowRects(), ev.clientY);
      if (over === null || over === st.fromRow) return;
      const { fromIndex, toIndex } = dropIndexForRow(st.fromRow, over, count);
      const moved = objects[fromIndex];
      if (moved) dispatch({ type: 'MOVE_OBJECT', id: moved.id, toIndex });
    };

    // A cancelled pointer (a touch-drag that became a scroll) must reset
    // WITHOUT committing a reorder the host never completed.
    const cancel = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      dragState.current = null;
      setDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  }, [count, objects, dispatch, rowRects]);

  // Never leave a drag's window listeners attached past unmount.
  useEffect(() => () => { dragState.current = null; }, []);

  const action =
    'flex items-center justify-center w-10 h-10 shrink-0 rounded-lg transition-colors disabled:opacity-20 disabled:pointer-events-none';

  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-sans text-[9px] text-brand-muted/40 leading-snug px-1">
        Top of the list paints over everything below it. Drag a row, or use the arrows, to restack.
      </p>
      <ul ref={listRef} className="flex flex-col gap-1.5">
        {rows.map(({ object: o, index, row, isTop, isBottom }) => {
          const isSel = o.id === selectedId;
          const Icon = objectIcon(o);
          const hidden = !!o.hidden;
          const isDragging = drag?.fromRow === row;
          const isDropTarget = !!drag && drag.overRow === row && drag.fromRow !== row;
          const renaming = renamingId === o.id;
          const shownName = displayNames.get(o.id) ?? o.name;
          return (
            <li
              key={o.id}
              data-layer-row
              onClick={() => dispatch({ type: 'SELECT_OBJECT', id: o.id })}
              className={`flex flex-col gap-0.5 rounded-xl border pl-1.5 pr-1 py-1.5 cursor-pointer transition-colors
                ${isSel ? 'bg-accent/12 border-accent/35' : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/10'}
                ${hidden ? 'opacity-40' : ''}
                ${isDragging ? 'opacity-50' : ''}
                ${isDropTarget ? 'ring-1 ring-accent/60' : ''}`}
            >
              {/* Line 1 — WHAT this layer is and WHERE it sits in the stack. */}
              <div className="flex items-center gap-1.5 min-w-0">
                {/* Drag handle — its own target so a plain row click still selects. */}
                <button
                  onPointerDown={(e) => { e.stopPropagation(); beginRowDrag(row, e); }}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Reorder ${shownName}`}
                  title="Drag to restack"
                  className="shrink-0 p-1 rounded text-brand-muted/30 hover:text-brand-fg cursor-grab active:cursor-grabbing transition-colors touch-none"
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </button>

                {/* The stack position, stated. It was previously sr-only + a
                    tooltip, so a sighted host could see the ORDER but never the
                    NUMBER — which is what "third from the top" conversations
                    with a venue are actually about. */}
                <span className="shrink-0 w-3 text-center font-mono text-[8px] text-brand-muted/40 tabular-nums">{row + 1}</span>

                <Icon className={`w-3.5 h-3.5 shrink-0 ${isSel ? 'text-accent-2' : 'text-brand-muted/50'}`} />

                {renaming ? (
                  <input
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => commitRename(o.id)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(o.id); }
                      else if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); }
                    }}
                    aria-label="Layer name"
                    className="flex-1 min-w-0 rounded bg-white/[0.06] border border-accent/40 px-1.5 py-0.5 text-[11px] text-brand-fg outline-none"
                  />
                ) : (
                  <Tooltip label={shownName} hint={paintOrderHint(row, count)} side="left">
                    <span
                      onDoubleClick={(e) => { e.stopPropagation(); setRenameText(o.name); setRenamingId(o.id); }}
                      className={`text-[11px] font-sans truncate flex-1 min-w-0 cursor-text ${isSel ? 'text-brand-fg' : 'text-brand-muted/70'}`}
                    >
                      {shownName}
                    </span>
                  </Tooltip>
                )}

                <span className="shrink-0 font-label text-[7px] uppercase tracking-widest text-brand-muted/40 bg-white/[0.05] px-1 py-px rounded-full">
                  {kindBadge(o)}
                </span>
                {o.animation !== 'none' && (
                  <span className="text-[7px] font-label uppercase tracking-widest text-accent-2/70 bg-accent/10 px-1.5 py-0.5 rounded-full shrink-0">{o.animation}</span>
                )}
              </div>

              {/* Line 2 — WHAT YOU CAN DO to it. Its own row on purpose: five
                  controls cannot share a 19rem line with a layer name without
                  either the name or the targets becoming unusable. Everything
                  here is now permanently visible at ~40px, where rename used to
                  be hover-only (unreachable on touch) and delete was a 14px
                  glyph in a 5-icon huddle — the "no clear way to remove them"
                  the owner reported. */}
              <div className="flex items-center justify-end gap-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); setRenameText(o.name); setRenamingId(o.id); }}
                  aria-label={`Rename ${shownName}`}
                  title="Rename layer (or double-click its name)"
                  className={`${action} text-brand-muted/40 hover:text-brand-fg hover:bg-white/[0.06]`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {/* NOT a preview toggle — draftMapping persists `hidden` and the
                    booth honours it, so this is a publish control. */}
                <button
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: 'UPDATE_OBJECT', id: o.id, patch: { hidden: !hidden } }); }}
                  aria-label={hidden ? 'Show this layer to guests' : 'Hide this layer from guests'}
                  title={hidden ? 'Hidden from guests — click to show' : 'Visible to guests — click to hide'}
                  className={`${action} text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]`}
                >
                  {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {/* Absolute-index moves: "up" means up in THIS list, always. */}
                <button
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: 'MOVE_OBJECT', id: o.id, toIndex: stepTargetIndex(row, count, 'up') }); }}
                  disabled={isTop}
                  aria-label="Move layer up"
                  title="Move up — paints over more"
                  className={`${action} text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]`}
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: 'MOVE_OBJECT', id: o.id, toIndex: stepTargetIndex(row, count, 'down') }); }}
                  disabled={isBottom}
                  aria-label="Move layer down"
                  title="Move down — paints under more"
                  className={`${action} text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]`}
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <Tooltip label="Remove from scene" hint="Deletes this layer. Del or Backspace does the same to the selected layer." side="left">
                  <button
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: 'DELETE_OBJECT', id: o.id }); }}
                    aria-label={`Remove ${shownName} from the scene`}
                    className={`${action} bg-rose-500/[0.08] text-rose-300/80 hover:bg-rose-500/20 hover:text-rose-200`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
              <span className="sr-only">{`Layer ${row + 1} of ${count}. ${paintOrderHint(row, count)}. Array index ${index}.`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
