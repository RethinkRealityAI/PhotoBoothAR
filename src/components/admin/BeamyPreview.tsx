/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamyPreview — /admin/home-assets' live preview: the homepage's own Beamy
 * (pages/beamy/BeamyStage, the same rig, fits and AR mask) wearing the look
 * being edited, so a prop's anchor, size and offset can be judged before
 * publishing.
 *
 * The stage is a `position: fixed; inset: 0` canvas that speaks in viewport
 * px; here it sits in a box with a transform, which makes that box its
 * containing block, so "viewport px" are simply this box's px and nothing
 * about the stage had to change. Two modes, as the homepage uses them:
 *   • hero: he wears the look himself (a frame stands behind him, a worn-with
 *     prop on his head), as in the hero's try-on;
 *   • ar:   the AR step's one stage (lib/beamyAssets arStage). A frame is a
 *     page image IN FRONT of him with his body masked to its window
 *     (decor.arOver), a prop is shrunk to that stage (arPropScale), a filter
 *     tints him, an effect plays round him.
 *
 * A prop's fit is applied LIVE (BeamyApi.refit: same model, new placement,
 * no pop-in), so a slider or the adjust mode's drag moves it as you go; a
 * different look (or a prop turning into an earring pair) is put on afresh.
 * /admin/home-assets' "Adjust on Beamy" mode (BeamyAdjust) reuses this
 * preview bigger, with its drag surface laid over the stage (`children`).
 */
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import BeamyStage, { type BeamyApi, type StageDecor, type StageLayout } from '../../pages/beamy/BeamyStage';
import ArFx from '../beamy/ArFx';
import { arPropScale, arStage, arTitle, lookAction, toBeamyLook, type HomeLook } from '../../lib/beamyAssets';
import type { PropFit } from '../../lib/beamyLooks';

/** The turn buttons' step and reach (radians). */
export const PREVIEW_YAW_STEP = 0.45;
export const PREVIEW_YAW_MAX = 0.9;

/** The fit of the prop this look puts on him in `mode` (a prop, or a hero frame's worn-with prop), else null. */
function wornFit(look: HomeLook | null, mode: 'hero' | 'ar'): PropFit | null {
  if (look === null) return null;
  const b = toBeamyLook(look);
  if (b.kind === 'prop') return b.fit ?? null;
  if (b.kind === 'frame' && mode === 'hero') return b.prop?.fit ?? null;
  return null;
}

type Geo = { frame: { left: number; top: number; h: number }; stand: { x: number; y: number; heightPx: number } };

/** Where he stands in a w×h box: the AR step's stage, or the hero's (feet near the bottom, ~60% tall). */
function geoFor(mode: 'hero' | 'ar', w: number, h: number): Geo {
  if (mode === 'ar') return arStage({ box: { top: 30, bottom: h - 8, left: 8, right: w - 8 } });
  const heightPx = Math.max(60, Math.min(h * 0.58, w * 0.62));
  return { frame: { left: 0, top: 0, h }, stand: { x: w / 2, y: h * 0.93, heightPx } };
}

export default function BeamyPreview({ look, mode, boxClass = 'h-[340px]', yaw: yawIn, onYaw, turnLocked = false, apiOut, children }: {
  look: HomeLook | null;
  mode: 'hero' | 'ar';
  /** The stage box's height classes. */
  boxClass?: string;
  /** Controlled turn (radians); omit to let the preview keep its own. */
  yaw?: number;
  onYaw?: (yaw: number) => void;
  /** The turn buttons are off (a drag is in progress). */
  turnLocked?: boolean;
  /** The stage's API, for a caller that reads the worn prop's handle. */
  apiOut?: MutableRefObject<BeamyApi | null>;
  /** Laid over the stage, inside its box (the adjust mode's drag surface). */
  children?: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const api = useRef<BeamyApi | null>(null);
  const layoutRef = useRef<StageLayout>({ home: { x: 160, y: 300 }, heightPx: 180, bubbleMinY: 6 });
  const decorRef = useRef<StageDecor>({ panel: null, stand: null, phone: false, scroll: 0 });
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const hitRef = useRef<HTMLButtonElement | null>(null);
  const frameTick = useRef<(() => void) | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ownYaw, setOwnYaw] = useState(0);
  const yaw = yawIn ?? ownYaw;
  const setYaw = (f: (y: number) => number) => { const v = f(yaw); if (onYaw !== undefined) onYaw(v); else setOwnYaw(v); };

  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = size.w > 0 ? geoFor(mode, size.w, size.h) : null;
  const action = look === null ? ({ kind: 'none' } as const) : lookAction(look);
  const arFrame = mode === 'ar' && action.kind === 'frame' ? action.url : null;

  // Every stage frame: where he stands, his turn, the AR mask and the AR prop scale.
  const live = useRef({ geo, yaw, arFrame });
  live.current = { geo, yaw, arFrame };
  frameTick.current = () => {
    const { geo: g, yaw: y, arFrame: f } = live.current;
    if (g === null) return;
    const L = layoutRef.current;
    L.home = { x: g.stand.x, y: g.stand.y };
    L.heightPx = g.stand.heightPx;
    L.yaw = y;
    decorRef.current.arOver = f !== null
      ? { frames: [{ url: f, left: g.frame.left, top: g.frame.top, width: (g.frame.h * 9) / 16, height: g.frame.h, a: 1 }], holes: [] }
      : undefined;
    const b = api.current;
    if (apiOut !== undefined) apiOut.current = b;
    if (b !== null && mode === 'ar') {
      const hp = g.stand.heightPx;
      b.wornScale(arPropScale({ stand: g.stand, frame: g.frame, lift: b.wornLiftAt(1) * hp, liftBase: b.wornLiftAt(0) * hp }));
    } else if (b !== null) b.wornScale(1);
  };

  // The fit he should be wearing now (read when a fresh look finishes loading).
  const fit = wornFit(look, mode);
  const fitNow = useRef(fit);
  fitNow.current = fit;
  // Put the look on (debounced: picking through tiles fires fast). The key is
  // the look WITHOUT its placement, so moving a prop never reloads it; only
  // a prop becoming (or ceasing to be) a split earring pair does.
  const key = look === null ? '' : JSON.stringify({ ...look, fit: undefined, pair: fit?.pair !== undefined });
  useEffect(() => {
    const b = api.current;
    if (!ready || b === null) return;
    const id = window.setTimeout(() => {
      const l = look;
      const a = l === null ? null : lookAction(l);
      if (l === null || a === null) { void b.wear(null); b.tint(null); return; }
      if (mode === 'hero' || a.kind === 'prop') {
        void b.wear(toBeamyLook(l)).then(() => {
          // A fit changed while the model loaded: place it where it is now.
          if (fitNow.current !== null) b.refit(fitNow.current);
        });
      } else void b.wear(null);
      b.tint(a.kind === 'tint' ? a.color : null);
    }, 140);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the look's content
  }, [ready, key, mode]);
  // A new placement of the same prop: re-place it at once (sliders, drags).
  const fitKey = fit === null ? '' : JSON.stringify(fit);
  useEffect(() => {
    const b = api.current;
    if (!ready || b === null || fitNow.current === null) return;
    b.refit(fitNow.current);
  }, [ready, fitKey]);

  // The sparkle burst is the stage's own; every other effect is drawn round him.
  const sparkles = action.kind === 'fx' && action.fx === 'sparkles';
  useEffect(() => {
    const b = api.current;
    if (!ready || b === null || !sparkles) return;
    b.sparkle('burst');
    const id = window.setInterval(() => b.sparkle('burst'), 1300);
    return () => window.clearInterval(id);
  }, [ready, sparkles]);
  const fxKind = action.kind === 'fx' && action.fx !== 'sparkles' ? action.fx : null;
  const line = mode === 'hero' && look !== null ? (look.line ?? '') : '';

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={boxRef}
        className={`relative ${boxClass} w-full overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_50%_80%,rgba(140,150,255,0.22),rgba(10,12,30,0.9)_70%)]`}
        style={{ transform: 'translateZ(0)' }}
      >
        {arFrame !== null && geo !== null && (
          <>
            <p className="absolute inset-x-0 top-1.5 truncate px-3 text-center font-sans text-xs font-semibold text-white/85">
              {look !== null ? arTitle('frame', look) : ''}
            </p>
            <img
              src={arFrame}
              alt=""
              className="pointer-events-none absolute"
              style={{ left: geo.frame.left, top: geo.frame.top, height: geo.frame.h, width: (geo.frame.h * 9) / 16 }}
            />
          </>
        )}
        {fxKind !== null && <ArFx kind={fxKind} reduced={false} className="pointer-events-none absolute inset-0 h-full w-full" />}
        {!failed && size.w > 0 && (
          <BeamyStage
            apiRef={api}
            layoutRef={layoutRef}
            bubbleRef={bubbleRef}
            hitRef={hitRef}
            decorRef={decorRef}
            frameRef={frameTick}
            onReady={() => setReady(true)}
            onError={() => setFailed(true)}
          />
        )}
        <div
          ref={bubbleRef}
          aria-hidden
          className={`pointer-events-none absolute left-0 top-0 max-w-[70%] rounded-2xl bg-white px-3 py-2 font-sans text-xs leading-snug text-[#141432] shadow-lg transition-opacity data-[away=true]:opacity-0 ${line === '' ? 'hidden' : ''}`}
        >
          {line}
        </div>
        <button ref={hitRef} type="button" tabIndex={-1} aria-hidden className="pointer-events-none absolute left-0 top-0 opacity-0" />
        {action.kind === 'media' && (
          <img src={action.url} alt="" className="absolute bottom-2 right-2 h-14 w-14 rounded-lg border border-white/20 object-cover" />
        )}
        {children}
        {(failed || !ready) && (
          <p className="absolute inset-x-0 bottom-3 text-center font-sans text-xs text-white/70">
            {failed ? 'The 3D preview could not start on this device.' : 'Loading Beamy…'}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-sans text-[11px] text-brand-muted/70">
          {mode === 'ar' ? 'As on the AR step' : 'As in the hero'}{look !== null ? ` · ${look.name}` : ' · nothing on'}
        </span>
        <div className="flex gap-1.5">
          <button type="button" aria-label="Turn Beamy left" disabled={turnLocked || yaw <= -PREVIEW_YAW_MAX} onClick={() => setYaw((y) => Math.max(-PREVIEW_YAW_MAX, y - PREVIEW_YAW_STEP))}
            className="pressable grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-brand-muted/80 hover:text-brand-fg disabled:opacity-35">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Turn Beamy right" disabled={turnLocked || yaw >= PREVIEW_YAW_MAX} onClick={() => setYaw((y) => Math.min(PREVIEW_YAW_MAX, y + PREVIEW_YAW_STEP))}
            className="pressable grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-brand-muted/80 hover:text-brand-fg disabled:opacity-35">
            <RotateCw className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
