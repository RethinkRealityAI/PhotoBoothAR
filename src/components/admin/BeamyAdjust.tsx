/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamyAdjust — /admin/home-assets' "Adjust on Beamy" mode: a big preview of
 * the homepage's own Beamy (BeamyPreview → BeamyStage) wearing the prop, and
 * direct manipulation of where it sits:
 *   • drag anywhere on the stage to move it (it follows the pointer: the
 *     stage measures his bone's on-screen axes, lib/beamyFitAdjust solves the
 *     move, so a turned Beamy is handled and nothing is mirrored);
 *   • wheel, pinch or the size buttons to resize; a two-finger twist or the
 *     rotate buttons to turn it in his face's plane; tilt buttons for a hat's
 *     lean;
 *   • a nudge pad (fine 2 mm / coarse 1 cm) for his left/right, up/down and
 *     back/forward, plus the arrow keys on the stage;
 *   • undo, reset to the anchor's preset, Cancel (puts back what it was when
 *     the mode opened) and Done.
 * Every change goes through `onFit`: the SAME PropFit the sliders edit, so
 * Save draft and Publish carry it and the homepage renders what was placed.
 * The turn buttons are off while a drag is in progress. It is portalled to
 * <body>: it opens from inside a .liquid-glass section, whose backdrop-filter
 * would otherwise become the containing block of its `position: fixed`.
 */
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Move, Plus, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import BeamyPreview from './BeamyPreview';
import type { BeamyApi } from '../../pages/beamy/BeamyStage';
import { useDialog } from '../../lib/useDialog';
import { ANCHOR_PRESETS, presetFit, type AnchorId, type HomeLook, type PropFit } from '../../lib/homeAssets';
import {
  NUDGE_COARSE, NUDGE_FINE, ROT_COARSE, ROT_FINE, SIZE_COARSE, SIZE_FINE, axesForYaw, degrees, dragFit, fitsEqual, lateralAxis,
  nudgeFit, offsetCm, pinchFactor, pushUndo, resizeFit, rotateFit, sizePercent, spaceFit, twistRoll, wheelFactor,
  type NudgeDir, type ScreenAxes, type Vec2,
} from '../../lib/beamyFitAdjust';

const labelCls = 'font-label uppercase tracking-luxe text-[10px] text-brand-muted/70';
const padBtn =
  'pressable grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-brand-fg/85 hover:bg-white/[0.08] disabled:opacity-35';
const textBtn =
  'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-4 font-label uppercase tracking-luxe text-[10px] text-brand-fg/85 hover:bg-white/[0.08] disabled:opacity-35';

type Gesture =
  | { kind: 'drag'; id: number; x: number; y: number; fit: PropFit; axes: ScreenAxes }
  | { kind: 'pinch'; a: number; b: number; a0: Vec2; b0: Vec2; fit: PropFit };

/** A − value + row (size, tilt, rotate, spacing). */
function Stepper({ label, value, onDown, onUp, downLabel, upLabel, downIcon, upIcon }: {
  label: string; value: string; onDown: () => void; onUp: () => void; downLabel: string; upLabel: string; downIcon?: ReactNode; upIcon?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`${labelCls} min-w-0 flex-1`}>{label}</span>
      <button type="button" className={padBtn} aria-label={downLabel} onClick={onDown}>{downIcon ?? <Minus className="h-4 w-4" />}</button>
      <span className="w-14 text-center font-sans text-xs tabular-nums text-brand-fg/90">{value}</span>
      <button type="button" className={padBtn} aria-label={upLabel} onClick={onUp}>{upIcon ?? <Plus className="h-4 w-4" />}</button>
    </div>
  );
}

export default function BeamyAdjust({ look, fit, anchor, mode, onFit, onDone, onCancel }: {
  /** The look being edited, wearing `fit` (a prop, or a hero frame with its worn-with prop). */
  look: HomeLook;
  fit: PropFit;
  anchor: AnchorId;
  mode: 'hero' | 'ar';
  onFit: (f: PropFit) => void;
  onDone: () => void;
  /** Called after the fit has been put back to what it was when the mode opened. */
  onCancel: () => void;
}) {
  const original = useRef(fit);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const api = useRef<BeamyApi | null>(null);
  const [yaw, setYaw] = useState(0);
  const [past, setPast] = useState<PropFit[]>([]);
  const [coarse, setCoarse] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, Vec2>());
  const gesture = useRef<Gesture | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const marker = useRef<HTMLDivElement | null>(null);

  const cancel = () => { onFit(original.current); onCancel(); };
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(cancel, 'Adjust on Beamy');

  /** A finished change: one undo step. */
  const commit = (next: PropFit) => {
    const cur = fitRef.current;
    if (fitsEqual(next, cur)) return;
    setPast((p) => pushUndo(p, cur));
    onFit(next);
  };
  const undo = () => {
    const prev = past[past.length - 1];
    if (prev === undefined) return;
    setPast(past.slice(0, -1));
    onFit(prev);
  };

  const step = coarse ? NUDGE_COARSE : NUDGE_FINE;
  const nudge = (d: NudgeDir) => commit(nudgeFit(fitRef.current, d, step, anchor));
  const size = (up: boolean) => commit(resizeFit(fitRef.current, up ? (coarse ? SIZE_COARSE : SIZE_FINE) : 1 / (coarse ? SIZE_COARSE : SIZE_FINE), anchor));
  const turn = (which: 'tilt' | 'roll', sign: 1 | -1) => commit(rotateFit(fitRef.current, which, sign * (coarse ? ROT_COARSE : ROT_FINE), anchor));

  // The anchor marker follows the live prop every frame (no React render).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const h = api.current?.wornHandle() ?? null;
      const m = marker.current;
      if (m !== null) {
        m.style.opacity = h === null ? '0' : '1';
        if (h !== null) m.style.transform = `translate(${h.anchor.x}px, ${h.anchor.y}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Wheel = size. Non-passive, so the page behind never scrolls; one undo step per burst.
  useEffect(() => {
    const el = surface.current;
    if (el === null) return;
    let burst: { fit: PropFit; t: number } | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      if (burst === null || now - burst.t > 450) {
        if (burst !== null) { const b = burst.fit; setPast((p) => pushUndo(p, b)); }
        burst = { fit: fitRef.current, t: now };
      }
      burst.t = now;
      onFitRef.current(resizeFit(fitRef.current, wheelFactor(e.deltaY, e.deltaMode), anchorRef.current));
    };
    // Close the burst into one undo step once the wheel rests.
    const id = window.setInterval(() => {
      if (burst !== null && performance.now() - burst.t > 450) {
        const b = burst.fit;
        burst = null;
        if (!fitsEqual(b, fitRef.current)) setPast((p) => pushUndo(p, b));
      }
    }, 200);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); window.clearInterval(id); };
  }, []);

  const startDrag = (id: number, p: Vec2): boolean => {
    const h = api.current?.wornHandle() ?? null;
    if (h === null) return false;
    gesture.current = { kind: 'drag', id, x: p.x, y: p.y, fit: fitRef.current, axes: h.axes };
    return true;
  };
  const endGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g !== null && !fitsEqual(g.fit, fitRef.current)) setPast((p) => pushUndo(p, g.fit));
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, p);
    const ids = [...pointers.current.keys()];
    if (ids.length === 1) {
      if (startDrag(e.pointerId, p)) setDragging(true);
    } else if (ids.length === 2) {
      // A second finger: the drag so far becomes one undo step, a pinch starts.
      endGesture();
      const [a, b] = ids;
      gesture.current = { kind: 'pinch', a, b, a0: pointers.current.get(a)!, b0: pointers.current.get(b)!, fit: fitRef.current };
      setDragging(true);
    }
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g === null) return;
    if (g.kind === 'drag') {
      if (g.id !== e.pointerId) return;
      onFit(dragFit(g.fit, g.axes, e.clientX - g.x, e.clientY - g.y, anchor));
      return;
    }
    const a1 = pointers.current.get(g.a), b1 = pointers.current.get(g.b);
    if (a1 === undefined || b1 === undefined) return;
    const k = pinchFactor(Math.hypot(g.b0.x - g.a0.x, g.b0.y - g.a0.y), Math.hypot(b1.x - a1.x, b1.y - a1.y));
    onFit(rotateFit(resizeFit(g.fit, k, anchor), 'roll', twistRoll(g.a0, g.b0, a1, b1), anchor));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    endGesture();
    // One finger left after a pinch: it carries on as a drag from here.
    const rest = [...pointers.current.entries()];
    if (rest.length === 1 && startDrag(rest[0][0], rest[0][1])) return;
    if (rest.length === 0) setDragging(false);
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const s = e.shiftKey ? NUDGE_COARSE : step;
    const map: Record<string, NudgeDir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', PageUp: 'forward', PageDown: 'back' };
    const d = map[e.key];
    if (d !== undefined) { e.preventDefault(); commit(nudgeFit(fitRef.current, d, s, anchor)); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); size(true); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); size(false); }
    else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }
  };

  const sideways = lateralAxis(axesForYaw(yaw, 1)) === 0 ? 'left and right' : 'back and forward (he is turned)';
  const preview = { ...look, fit };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={panelRef}
        {...dialogProps}
        className="liquid-glass-raised flex h-full w-full flex-col overflow-hidden sm:h-auto sm:max-h-[92vh] sm:max-w-5xl sm:rounded-3xl"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <Move className="h-4 w-4 shrink-0 text-brand-muted/70" />
          <div className="min-w-0">
            <h2 className="truncate font-serif text-lg text-brand-fg">Adjust on Beamy</h2>
            <p className="truncate font-sans text-[11px] text-brand-muted/75">{look.name} · {ANCHOR_PRESETS[anchor].label}</p>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-1">
          <div className="p-3 lg:p-4">
            <BeamyPreview
              look={preview}
              mode={mode}
              boxClass="h-[46vh] min-h-[260px] lg:h-[min(66vh,620px)]"
              yaw={yaw}
              onYaw={setYaw}
              turnLocked={dragging}
              apiOut={api}
            >
              <div
                ref={surface}
                role="application"
                aria-label={`Drag to move ${look.name}. Arrow keys nudge it, plus and minus resize it.`}
                tabIndex={0}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onKeyDown={onKey}
                className={`absolute inset-0 z-10 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/60 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              >
                {/* The anchor: where the prop is pinned on him. */}
                <div ref={marker} aria-hidden className="pointer-events-none absolute left-0 top-0 opacity-0">
                  <span className="absolute -left-3 -top-3 block h-6 w-6 rounded-full border-2 border-white/85 shadow-[0_0_0_2px_rgba(0,0,0,0.35)]" />
                  <span className="absolute -left-[3px] -top-[3px] block h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent)]" />
                </div>
              </div>
            </BeamyPreview>
            <p className="mt-2 font-sans text-[11px] leading-relaxed text-brand-muted/75">
              Drag on the stage to move it. Scroll or pinch to resize, twist two fingers to rotate. Sideways drags move it {sideways}.
            </p>
          </div>

          <div className="min-h-0 space-y-4 overflow-y-auto border-t border-white/[0.06] px-4 py-4 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between gap-2">
              <span className={labelCls}>Step</span>
              <div role="group" aria-label="Step size" className="flex gap-1.5">
                {([false, true] as const).map((c) => (
                  <button key={String(c)} type="button" aria-pressed={coarse === c} onClick={() => setCoarse(c)}
                    className={`${textBtn} ${coarse === c ? '!border-[color:var(--color-accent)]/60 !bg-[color:var(--color-accent)]/15' : ''}`}>
                    {c ? 'Coarse 1 cm' : 'Fine 2 mm'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Nudge">
                <span />
                <button type="button" className={padBtn} aria-label="Move up" onClick={() => nudge('up')}><ArrowUp className="h-4 w-4" /></button>
                <span />
                <button type="button" className={padBtn} aria-label="Move left" onClick={() => nudge('left')}><ArrowLeft className="h-4 w-4" /></button>
                <span className="grid h-11 w-11 place-items-center"><Move className="h-4 w-4 text-brand-muted/50" /></span>
                <button type="button" className={padBtn} aria-label="Move right" onClick={() => nudge('right')}><ArrowRight className="h-4 w-4" /></button>
                <span />
                <button type="button" className={padBtn} aria-label="Move down" onClick={() => nudge('down')}><ArrowDown className="h-4 w-4" /></button>
                <span />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <button type="button" className={`${textBtn} w-full`} onClick={() => nudge('forward')}>Forward</button>
                <button type="button" className={`${textBtn} w-full`} onClick={() => nudge('back')}>Back</button>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 font-sans text-[11px] text-brand-muted/80">
              <div><dt className={labelCls}>Left/right</dt><dd className="tabular-nums text-brand-fg/85">{offsetCm(fit, anchor, 0)}</dd></div>
              <div><dt className={labelCls}>Up/down</dt><dd className="tabular-nums text-brand-fg/85">{offsetCm(fit, anchor, 1)}</dd></div>
              <div><dt className={labelCls}>Back/fwd</dt><dd className="tabular-nums text-brand-fg/85">{offsetCm(fit, anchor, 2)}</dd></div>
            </dl>

            <div className="space-y-2">
              <Stepper label="Size" value={`${sizePercent(fit, anchor)}%`} onDown={() => size(false)} onUp={() => size(true)} downLabel="Smaller" upLabel="Bigger" />
              <Stepper label="Rotate" value={`${degrees(fit.roll)}°`} onDown={() => turn('roll', -1)} onUp={() => turn('roll', 1)}
                downLabel="Rotate clockwise" upLabel="Rotate counterclockwise" downIcon={<RotateCw className="h-4 w-4" />} upIcon={<RotateCcw className="h-4 w-4" />} />
              <Stepper label="Tilt" value={`${degrees(fit.tilt)}°`} onDown={() => turn('tilt', -1)} onUp={() => turn('tilt', 1)} downLabel="Tilt back" upLabel="Tilt forward" />
              {fit.pair !== undefined && (
                <Stepper label="Ear spacing" value={`${Math.round(fit.pair * 100)} cm`} onDown={() => commit(spaceFit(fitRef.current, -step, anchor))}
                  onUp={() => commit(spaceFit(fitRef.current, step, anchor))} downLabel="Closer together" upLabel="Further apart" />
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={textBtn} disabled={past.length === 0} onClick={undo}><Undo2 className="h-3.5 w-3.5" /> Undo</button>
              <button type="button" className={textBtn} disabled={fitsEqual(fit, presetFit(anchor))} onClick={() => commit(presetFit(anchor))}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset to preset
              </button>
            </div>
            <p className="font-sans text-[11px] leading-relaxed text-brand-muted/70">
              Your placement goes into this draft. Save draft, then Publish, to put it on the homepage.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
          <button type="button" className={textBtn} onClick={cancel}>Cancel</button>
          <button type="button" onClick={onDone}
            className="pressable min-h-11 rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[10px] text-[color:var(--on-accent)]">
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
