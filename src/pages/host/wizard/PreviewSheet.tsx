/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The phone layout for the wizard's design steps: the live preview pinned on
 * top, the options in a drawer below it. The host drags the drawer up to see
 * more options, or down to give the preview the whole screen, so every tap
 * shows its result without scrolling back and forth (owner, 2026-11-20).
 *
 * Desktop never renders this: the steps keep their side-by-side layout and
 * switch with `useIsDesktop`. One tree at a time, so a preview that is costly
 * to mount (the live wall iframe) never runs twice.
 *
 * The snap maths is pure and tested (lib/wizard/sheetSnap).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { SHEET_PEEK, nextSnapOnTap, sheetSnaps, snapAfterDrag, type SheetSnap } from '../../../lib/wizard/sheetSnap';

const DESKTOP_QUERY = '(min-width: 1024px)';

/** True at the wizard's desktop breakpoint (lg). Read synchronously on mount. */
export function useIsDesktop(): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;
  const [desktop, setDesktop] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

/** Scales its child down (never up) so the whole preview fits the box. */
function FitBox({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (o === null || i === null) return;
    const measure = () => {
      const h = i.offsetHeight;
      setScale(h > 0 ? Math.min(1, o.clientHeight / h) : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    // Not clipped: the child is already scaled to fit, and a clip cut its
    // shadow and the Beam button's glow off in a hard-edged box (owner, 2026-11-22).
    <div ref={outer} className="h-full w-full overflow-visible">
      <div ref={inner} style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>{children}</div>
    </div>
  );
}

export default function PreviewSheet({ preview, label, children, fit = true }: {
  preview: ReactNode;
  /** The drawer's title, shown even when it is collapsed. */
  label: string;
  children: ReactNode;
  /** true: scale a fixed-size preview down to fit. false: the preview fills the
   *  space and sizes itself (the keepsake album). */
  fit?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<number | null>(null);
  const [snap, setSnap] = useState<SheetSnap>('half');
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; t: number; moved: boolean } | null>(null);

  // The room between this box's top and the sticky footer. Re-measured on
  // resize (rotation, the phone keyboard on Android).
  useLayoutEffect(() => {
    const measure = () => {
      const el = host.current;
      if (el === null) return;
      const scroller = document.getElementById('wz-scroll');
      const top = el.getBoundingClientRect().top + (scroller?.scrollTop ?? 0);
      const footer = document.querySelector('.wz-footer')?.getBoundingClientRect().height ?? 72;
      // 24px: the page's own bottom padding, so the page does not scroll.
      setAvail(Math.max(320, Math.round(window.innerHeight - top - footer - 24)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const snaps = sheetSnaps(avail ?? 600);
  const sheetH = dragH ?? snaps[snap];
  const previewH = Math.max(0, (avail ?? 600) - sheetH - 12);
  const open = snap !== 'peek';

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
    setDragH(Math.min(snaps.full, Math.max(SHEET_PEEK, d.h + dy)));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d === null) return;
    if (!d.moved) { setSnap((s) => nextSnapOnTap(s)); return; }
    const h = Math.min(snaps.full, Math.max(SHEET_PEEK, d.h + (d.y - e.clientY)));
    const velocity = (d.y - e.clientY) / Math.max(1, performance.now() - d.t); // px/ms, + = up
    setSnap(snapAfterDrag(h, velocity, snaps));
    setDragH(null);
  };

  return (
    <div ref={host} className="relative -mx-4" style={{ height: avail ?? undefined, minHeight: avail === null ? '70dvh' : undefined }}>
      <div className="wz-sheet-preview absolute inset-x-4 top-0" style={{ height: previewH, '--sheet-preview-h': `${previewH}px` } as React.CSSProperties} data-dragging={dragH !== null || undefined}>
        {fit ? <FitBox>{preview}</FitBox> : <div className="h-full w-full min-h-0">{preview}</div>}
      </div>
      <section className="wz-sheet" style={{ height: sheetH }} data-dragging={dragH !== null || undefined} aria-label={label}>
        <div
          className="wz-sheet-handle"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => { drag.current = null; setDragH(null); }}
        >
          <span className="wz-sheet-grabber" aria-hidden />
          <div className="flex items-center gap-2">
            <h1 className="wz-display flex-1 min-w-0 truncate text-[18px] text-white">{label}</h1>
            <button
              type="button"
              className="wz-sheet-toggle"
              aria-expanded={open}
              aria-label={open ? 'Hide the options to see the preview' : 'Show the options'}
              // The handle's own tap already cycles; this button is the
              // explicit, keyboard-reachable collapse / expand.
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={() => setSnap(open ? 'peek' : 'half')}
            >
              {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronUp className="h-4 w-4" aria-hidden />}
              {open ? 'Preview' : 'Options'}
            </button>
          </div>
        </div>
        <div className="wz-sheet-body" inert={!open || undefined}>{children}</div>
      </section>
    </div>
  );
}
