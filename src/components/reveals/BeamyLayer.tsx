/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamyLayer — Beamy on the reveal page, behind one small controller
 * (`BeamyCtl`) so the experience never cares which Beamy is showing:
 *
 *   3D   the real rig (pages/beamy/BeamyStage): a fixed full-viewport canvas;
 *        he glides to whatever `spot` says (the page's layout maths)
 *   2D   a flat crystal (SVG) with CSS hops, used when WebGL is missing, the
 *        model fails to load, or it has not loaded after LOAD_TIMEOUT_MS; every
 *        unlock keeps working, and a beam is drawn as a DOM bar
 *
 * The speech bubble and the hit target are the page's own (positioned from
 * the layout), so the stage gets refs that stay null.
 */
import { lazy, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { BeamyApi, BeamyClip, StageDecor, StageLayout } from '../../pages/beamy/BeamyStage';
import type { BeamySpot } from '../../lib/reveals/revealScene';

const BeamyStage = lazy(() => import('../../pages/beamy/BeamyStage'));

export interface Pt { x: number; y: number }

export interface BeamyCtl {
  play(clip: BeamyClip): void;
  sparkle(level: 'sparkle' | 'burst'): void;
  spin(): void;
  tint(color: string | null): void;
  face(x: number | null): void;
  /** The BeamyBlast at `to`; `onFire` the moment the beam lights. */
  beam(to: Pt, onFire: () => void): Promise<void>;
  /** A short beam from his mouth (no clip). */
  zap(to: Pt, ms: number): Promise<void>;
  arrive(): Promise<void>;
  mouth(): Pt;
}

const LOAD_TIMEOUT_MS = 15000;

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return (c.getContext('webgl2') ?? c.getContext('webgl')) !== null;
  } catch {
    return false;
  }
}

interface Props {
  spot: BeamySpot;
  phone: boolean;
  reduced: boolean;
  /** Start hidden and wait for `arrive()` (live and preview); the poster stands from the start. */
  startHidden: boolean;
  ctlRef: Ref<BeamyCtl | null>;
  /** Beamy is loaded (3D) or the fallback is up (2D). */
  onReady: (kind: '3d' | '2d') => void;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export default function BeamyLayer({ spot, phone, reduced, startHidden, ctlRef, onReady }: Props) {
  const [mode, setMode] = useState<'3d' | '2d'>(() => (hasWebGL() ? '3d' : '2d'));
  const [loaded, setLoaded] = useState(false);
  const api = useRef<BeamyApi | null>(null);
  const layoutRef = useRef<StageLayout>({ home: { x: spot.x, y: spot.feet }, heightPx: spot.h });
  layoutRef.current = { home: { x: spot.x, y: spot.feet }, heightPx: spot.h, presence: 1, bubbleAway: true, hitAway: true };
  const decorRef = useRef<StageDecor>({ panel: null, stand: null, phone, scroll: 0 });
  decorRef.current = { panel: null, stand: null, phone, scroll: 0 };
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const hitRef = useRef<HTMLButtonElement | null>(null);
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // 2D state.
  const [anim, setAnim] = useState<{ name: string; key: number } | null>(null);
  const [arrived2d, setArrived2d] = useState(!startHidden);
  const [arriving2d, setArriving2d] = useState(false);
  const [beam2d, setBeam2d] = useState<{ from: Pt; to: Pt; key: number } | null>(null);
  const animTimer = useRef(0);

  // The model must load in time, or he goes flat.
  useEffect(() => {
    if (mode !== '3d' || loaded) return;
    const t = window.setTimeout(() => setMode('2d'), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [mode, loaded]);

  useEffect(() => {
    if (mode === '2d') onReadyRef.current('2d');
  }, [mode]);

  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  const ctl = useMemo<BeamyCtl>(() => {
    const flat = () => mode === '2d' || api.current === null;
    const mouth2d = (): Pt => ({ x: spotRef.current.x, y: spotRef.current.feet - spotRef.current.h * 0.6 });
    const animate = (name: string, ms: number) => {
      window.clearTimeout(animTimer.current);
      setAnim({ name, key: Date.now() });
      animTimer.current = window.setTimeout(() => setAnim(null), ms);
    };
    const beamFlat = async (to: Pt, ms: number) => {
      setBeam2d({ from: mouth2d(), to, key: Date.now() });
      await sleep(ms);
      setBeam2d(null);
    };
    return {
      play(clip) {
        if (!flat()) { void api.current!.play(clip); return; }
        if (clip === 'Dance') animate('dance', 2400);
        else if (clip === 'Hop' || clip === 'Wave') animate('hop', 480);
      },
      sparkle(level) {
        if (!flat()) api.current!.sparkle(level);
        else animate('glow', level === 'burst' ? 700 : 300);
      },
      spin() {
        if (!flat()) api.current!.spin();
      },
      tint(color) {
        if (!flat()) api.current!.tint(color);
        else if (color !== null) animate('glow', 100000);
        else setAnim(null);
      },
      face(x) {
        if (!flat()) api.current!.face(x);
      },
      async beam(to, onFire) {
        if (!flat()) {
          await api.current!.beam(to, onFire, 'mouth');
          return;
        }
        animate('glow', 900);
        await sleep(reduced ? 80 : 420);
        onFire();
        await beamFlat(to, 380);
      },
      async zap(to, ms) {
        if (!flat()) { await api.current!.zap(to, 'mouth', ms); return; }
        await beamFlat(to, ms);
      },
      async arrive() {
        if (!flat()) { await api.current!.arrive(); return; }
        setArrived2d(true);
        setArriving2d(true);
        await sleep(reduced ? 0 : 600);
        setArriving2d(false);
      },
      mouth() {
        return flat() ? mouth2d() : api.current!.mouth();
      },
    };
  }, [mode, reduced]);

  useImperativeHandle(ctlRef, () => ctl, [ctl]);

  if (mode === '3d') {
    return (
      <Suspense fallback={null}>
        <BeamyStage
          apiRef={api}
          layoutRef={layoutRef}
          bubbleRef={bubbleRef}
          hitRef={hitRef}
          decorRef={decorRef}
          startHidden={startHidden}
          reducedMotion={reduced}
          onReady={() => { setLoaded(true); onReadyRef.current('3d'); }}
          onError={() => setMode('2d')}
        />
      </Suspense>
    );
  }

  const w = spot.h * 0.92;
  return (
    <>
      <div
        className="rv-beamy2d"
        data-anim={anim?.name}
        data-arrive={arriving2d ? 'true' : undefined}
        key={anim?.key}
        aria-hidden
        style={{ left: spot.x - w / 2, top: spot.feet - spot.h, width: w, height: spot.h, opacity: arrived2d ? 1 : 0 }}
      >
        <FlatBeamy />
      </div>
      {beam2d !== null && <BeamBar from={beam2d.from} to={beam2d.to} key={beam2d.key} />}
    </>
  );
}

/** A beam as a DOM bar (the 2D Beamy's blast). */
function BeamBar({ from, to }: { from: Pt; to: Pt }) {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  return <div className="rv-beam" aria-hidden style={{ left: from.x, top: from.y - 4, width: len, transform: `rotate(${ang}rad)` }} />;
}

/** The flat crystal Beamy: a rounded triangle, frosted blue-violet, amber core. */
function FlatBeamy() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <ellipse cx="50" cy="97" rx="30" ry="3.5" fill="#000" opacity="0.28" />
      <path d="M50 6 C54 6 56 9 58 12 L92 78 C95 85 92 92 84 92 L16 92 C8 92 5 85 8 78 L42 12 C44 9 46 6 50 6 Z" fill="#8B8FEE" />
      <path d="M50 6 C54 6 56 9 58 12 L92 78 C95 85 92 92 84 92 L50 92 Z" fill="#7377DE" />
      <path d="M50 12 L30 52 L50 46 Z" fill="#B7BAFF" opacity="0.7" />
      <path d="M50 6 C54 6 56 9 58 12 L92 78 C95 85 92 92 84 92 L16 92 C8 92 5 85 8 78 L42 12 C44 9 46 6 50 6 Z" fill="none" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="1.4" />
      <circle cx="50" cy="66" r="12" fill="#FFC46B" opacity="0.35" />
      <circle cx="50" cy="66" r="7" fill="#FFD48A" />
      <ellipse cx="42" cy="50" rx="3" ry="4.2" fill="#15133F" />
      <ellipse cx="58" cy="50" rx="3" ry="4.2" fill="#15133F" />
      <circle cx="43" cy="48.6" r="1" fill="#FFFFFF" />
      <circle cx="59" cy="48.6" r="1" fill="#FFFFFF" />
      <path d="M46 57 Q50 60 54 57" fill="none" stroke="#15133F" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
