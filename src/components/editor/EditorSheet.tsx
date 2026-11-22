/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The phone layout of EditorShell: the live preview pinned on top, the
 * options in a drawer below it (the setup wizard's PreviewSheet pattern).
 * Drag the grabber, or tap it, to give the options or the preview more room;
 * the toggle button does the same from the keyboard.
 *
 * Differences from the wizard's PreviewSheet, on purpose:
 *  - it measures ITS OWN box (ResizeObserver), not the window minus a
 *    `.wz-footer`, because an editor saves from its header and has no footer;
 *  - the tab bar lives in the drawer's top row, so the drawer's peek state
 *    still shows which group is open and switching groups never needs the
 *    drawer opened first. Only the grabber strip drags: a drag that started on
 *    a tab would swallow the tab's click (pointer capture retargets it).
 * The snap maths is the wizard's (lib/wizard/sheetSnap), so both feel the same.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { nextSnapOnTap, sheetSnaps, snapAfterDrag, type SheetSnap } from '../../lib/wizard/sheetSnap';

/** Grabber strip (26) + the tabs row (48) + padding: the collapsed height. */
const PEEK = 88;

export default function EditorSheet({ preview, tabBar, label, children }: {
  preview: ReactNode;
  tabBar: ReactNode;
  /** Accessible name of the drawer. */
  label: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<number | null>(null);
  const [snap, setSnap] = useState<SheetSnap>('half');
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; t: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (el === null) return;
    const measure = () => setAvail(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const room = avail ?? 600;
  const base = sheetSnaps(room);
  const snaps: Record<SheetSnap, number> = {
    peek: PEEK,
    half: Math.max(PEEK, Math.round(room * 0.52)),
    full: Math.max(PEEK, Math.max(base.full, room - 150)),
  };
  const sheetH = Math.min(room, dragH ?? snaps[snap]);
  const previewH = Math.max(0, room - sheetH - 10);
  const open = snap !== 'peek';
  const clamp = (h: number) => Math.min(snaps.full, Math.max(PEEK, h));

  const onDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: sheetH, t: performance.now(), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d === null) return;
    const dy = d.y - e.clientY;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    setDragH(clamp(d.h + dy));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d === null) return;
    if (!d.moved) { setSnap((s) => nextSnapOnTap(s)); return; }
    const h = clamp(d.h + (d.y - e.clientY));
    const velocity = (d.y - e.clientY) / Math.max(1, performance.now() - d.t);
    setSnap(snapAfterDrag(h, velocity, snaps));
    setDragH(null);
  };

  return (
    <div ref={host} className="relative flex-1 min-h-0">
      <div className="wz-sheet-preview absolute inset-x-3 top-2 flex-col" style={{ height: Math.max(0, previewH - 8) }} data-dragging={dragH !== null || undefined}>
        {preview}
      </div>
      <section className="wz-sheet" style={{ height: sheetH }} data-dragging={dragH !== null || undefined} aria-label={label}>
        <div
          className="flex-none h-[26px] grid place-items-center touch-none cursor-grab active:cursor-grabbing select-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => { drag.current = null; setDragH(null); }}
          aria-hidden
        >
          <span className="block h-[5px] w-10 rounded-full bg-white/55" />
        </div>
        <div className="flex-none flex items-center gap-1.5 px-3 pb-3">
          {/* Picking a group while the drawer is collapsed opens it: the pick means "show me these". */}
          <div className="flex-1 min-w-0" onClickCapture={() => { if (!open) setSnap('half'); }}>{tabBar}</div>
          <button
            type="button"
            className="pressable grid place-items-center h-11 w-11 shrink-0 rounded-full bg-white/12 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)]"
            aria-expanded={open}
            aria-label={open ? 'Hide the options to see the preview' : 'Show the options'}
            onClick={() => setSnap(open ? 'peek' : 'half')}
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronUp className="h-4 w-4" aria-hidden />}
          </button>
        </div>
        <div className="wz-sheet-body" inert={!open || undefined}>{children}</div>
      </section>
    </div>
  );
}
