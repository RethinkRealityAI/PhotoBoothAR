/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DemoBooth — the Landing page's live "try it now" sandbox booth.
 *
 * A trimmed-down, fully client-side cut of the real guest booth: live camera →
 * WebGL filter → face-tracked 3D prop → frame overlay, with photo capture,
 * native share and local download. No auth, no upload, no event — everything
 * stays on-device. Reuses the production pipeline (useCameraStream /
 * StageCanvas / Overlay3D) so the demo IS the product, not a mock. Camera
 * starts only on explicit tap.
 *
 * UI lives INSIDE the camera like a real camera app (same idiom as the booth's
 * FilterOrbs): category tabs (Frame · Effect · 3D) over an orb carousel over
 * the shutter, all on a bottom scrim. Captures can "beam" onto a mini live
 * wall under the stage — the product's core loop, demonstrated in place.
 * Face-landmarker failure (offline/CDN blocked) keeps camera + filters +
 * frames working — only the 3D props quietly no-op.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Ban, Crown, Glasses, Sparkles } from 'lucide-react';
import { useCameraStream } from '../booth/useCameraStream';
import StageCanvas, { type StageCanvasHandle } from '../booth/StageCanvas';
import Overlay3D from '../booth/Overlay3D';
import { dataUrlToBlob } from '../booth/capture';
import { toDataUrl } from '../../lib/borders';
import { SHADER_MAP } from '../../lib/shaders';
import { HEAD_PIECE_MAP } from '../../lib/headPieces';
import { initializeFaceLandmarker } from '../../lib/faceTracking';
import { BoothIcon } from '../ui/BeamIcons';

/* ── Demo frames — beam-branded, text-free, 1080×1920 like borders.ts ── */

const DEMO_FRAME_SVGS: Record<string, string> = {
  beam: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="dbeam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#38BDF8"/><stop offset="0.5" stop-color="#5B8CFF"/><stop offset="1" stop-color="#7C6CF7"/>
    </linearGradient>
  </defs>
  <rect x="34" y="34" width="1012" height="1852" rx="56" fill="none" stroke="url(#dbeam)" stroke-width="10" opacity="0.95"/>
  <rect x="58" y="58" width="964" height="1804" rx="42" fill="none" stroke="url(#dbeam)" stroke-width="2.5" opacity="0.55"/>
  <circle cx="90" cy="90" r="7" fill="#38BDF8" opacity="0.9"/><circle cx="990" cy="90" r="7" fill="#5B8CFF" opacity="0.9"/>
  <circle cx="90" cy="1830" r="7" fill="#7C6CF7" opacity="0.9"/><circle cx="990" cy="1830" r="7" fill="#38BDF8" opacity="0.9"/>
</svg>`,
  prism: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="dprsm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#E879F9"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#dprsm)" stroke-width="12" stroke-linecap="round" opacity="0.95">
    <path d="M60 260 V120 a60 60 0 0 1 60 -60 H260"/>
    <path d="M820 60 h200 a60 60 0 0 1 60 60 v140"/>
    <path d="M1020 1660 v140 a60 60 0 0 1 -60 60 H820"/>
    <path d="M260 1860 H120 a60 60 0 0 1 -60 -60 v-140"/>
  </g>
  <g fill="#22D3EE"><path d="M540 96 l10 26 26 10 -26 10 -10 26 -10 -26 -26 -10 26 -10z" opacity="0.85"/></g>
  <g fill="#E879F9"><path d="M540 1772 l8 22 22 8 -22 8 -8 22 -8 -22 -22 -8 22 -8z" opacity="0.8"/></g>
</svg>`,
  spectrum: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="dspec" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5B8CFF"/><stop offset="0.17" stop-color="#22D3EE"/><stop offset="0.34" stop-color="#34D399"/>
      <stop offset="0.5" stop-color="#FB923C"/><stop offset="0.67" stop-color="#E879F9"/><stop offset="0.84" stop-color="#7C6CF7"/>
      <stop offset="1" stop-color="#38BDF8"/>
    </linearGradient>
  </defs>
  <rect x="30" y="30" width="1020" height="1860" rx="48" fill="none" stroke="url(#dspec)" stroke-width="6" opacity="0.8"/>
  <rect x="70" y="1790" width="940" height="14" rx="7" fill="url(#dspec)" opacity="0.95"/>
  <rect x="70" y="116" width="940" height="4" rx="2" fill="url(#dspec)" opacity="0.5"/>
</svg>`,
};

type Category = 'frame' | 'effect' | 'prop';

interface Choice { id: string; name: string; hue: string; }

const FRAMES: Choice[] = [
  { id: 'beam', name: 'Beam', hue: '#5B8CFF' },
  { id: 'prism', name: 'Prism', hue: '#22D3EE' },
  { id: 'spectrum', name: 'Spectrum', hue: '#E879F9' },
];
const FILTERS: Choice[] = [
  { id: 'prismatic-holo', name: 'Prismatic', hue: '#38BDF8' },
  { id: 'aurora-lumina', name: 'Aurora', hue: '#34D399' },
  { id: 'neon-pulse', name: 'Neon', hue: '#E879F9' },
];
const PROPS: Choice[] = [
  { id: 'neon-shades', name: 'Shades', hue: '#7C6CF7' },
  { id: 'queen-tiara', name: 'Tiara', hue: '#38BDF8' },
  { id: 'cheek-stars', name: 'Sparkle', hue: '#FB923C' },
];

const CATEGORIES: { key: Category; label: string; options: Choice[] }[] = [
  { key: 'frame', label: 'Frame', options: FRAMES },
  { key: 'effect', label: 'Effect', options: FILTERS },
  { key: 'prop', label: '3D', options: PROPS },
];

const FRAME_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(DEMO_FRAME_SVGS).map(([id, svg]) => [id, toDataUrl(svg)]),
);

const PROP_ICONS: Record<string, typeof Glasses> = {
  'neon-shades': Glasses,
  'queen-tiara': Crown,
  'cheek-stars': Sparkles,
};

const WALL_SLOTS = 6;

/** The seven-hue brand spectrum, used by the beam-flight light show. */
const SPECTRUM = ['#5B8CFF', '#22D3EE', '#34D399', '#FB923C', '#E879F9', '#7C6CF7', '#38BDF8'];

interface BeamRect { left: number; top: number; width: number; height: number; }
interface Flight { shot: string; from: BeamRect; to: BeamRect; }

/**
 * The beam-to-wall light show: the captured shot lifts off the stage, rides a
 * multicolor spectrum beam down into its wall tile, and lands in a burst of
 * hue sparkles. Pure Web-Animations choreography (~1.1s) in an overlay that
 * spans the whole demo; onLand fires when the shot should materialize on the
 * wall (as the clone touches down), onFinished once the burst has played and
 * the overlay can unmount. Skipped under prefers-reduced-motion (caller
 * commits directly).
 */
function BeamFlightFx({
  flight, onLand, onFinished,
}: {
  flight: Flight;
  onLand: () => void;
  onFinished: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const landRef = useRef(onLand);
  landRef.current = onLand;
  const finishRef = useRef(onFinished);
  finishRef.current = onFinished;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const { from, to } = flight;
    const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const anims: Animation[] = [];

    // 1 · The shot itself: energize, then dive into the tile.
    const clone = box.querySelector<HTMLElement>('[data-fx="clone"]');
    if (clone) {
      anims.push(clone.animate(
        [
          { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: '2rem', filter: 'brightness(1) saturate(1)', opacity: 1 },
          { left: `${from.left}px`, top: `${from.top - 14}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: '2rem', filter: 'brightness(1.7) saturate(1.5)', opacity: 1, offset: 0.28 },
          { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: '0.5rem', filter: 'brightness(2.4) saturate(1.8)', opacity: 0.95 },
        ],
        { duration: 820, easing: EASE, fill: 'forwards' },
      ));
    }

    // 2 · Spectrum beam trail: a light column wipes from stage to tile.
    const beam = box.querySelector<HTMLElement>('[data-fx="beam"]');
    const core = box.querySelector<HTMLElement>('[data-fx="core"]');
    for (const el of [beam, core]) {
      if (!el) continue;
      anims.push(el.animate(
        [
          { transform: 'scaleY(0)', opacity: 0 },
          { transform: 'scaleY(1)', opacity: 1, offset: 0.45 },
          { transform: 'scaleY(1)', opacity: 0 },
        ],
        { duration: 950, delay: 120, easing: 'ease-out', fill: 'both' },
      ));
    }
    if (beam) {
      anims.push(beam.animate(
        [{ filter: 'blur(10px) hue-rotate(0deg)' }, { filter: 'blur(10px) hue-rotate(50deg)' }],
        { duration: 950, delay: 120, fill: 'both' },
      ));
    }

    // 3 · Arrival: expanding spectrum ring + hue sparkles at the tile.
    const ring = box.querySelector<HTMLElement>('[data-fx="ring"]');
    if (ring) {
      anims.push(ring.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0.95 },
          { transform: 'translate(-50%, -50%) scale(1.9)', opacity: 0 },
        ],
        { duration: 520, delay: 760, easing: 'ease-out', fill: 'both' },
      ));
    }
    box.querySelectorAll<HTMLElement>('[data-fx="spark"]').forEach((sp, i) => {
      const angle = (i / SPECTRUM.length) * Math.PI * 2;
      const dist = 30 + (i % 3) * 14;
      anims.push(sp.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
          { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(1)`, opacity: 1, offset: 0.4 },
          { transform: `translate(calc(-50% + ${Math.cos(angle) * dist * 1.6}px), calc(-50% + ${Math.sin(angle) * dist * 1.6}px)) scale(0.2)`, opacity: 0 },
        ],
        { duration: 560, delay: 780 + i * 24, easing: 'ease-out', fill: 'both' },
      ));
    });

    // The shot materializes on the wall as the clone touches down so the
    // arrival burst plays OVER the settled tile; the overlay lingers until
    // the ring/sparkles finish. Cleanup only cancels — it must never fire
    // onLand (StrictMode's dev double-run would double-commit the shot).
    const landTimer = window.setTimeout(() => landRef.current(), 860);
    const finishTimer = window.setTimeout(() => finishRef.current(), 1500);
    return () => {
      window.clearTimeout(landTimer);
      window.clearTimeout(finishTimer);
      anims.forEach((a) => a.cancel());
    };
  }, [flight]);

  const { from, to } = flight;
  const toCx = to.left + to.width / 2;
  const beamTop = from.top + from.height * 0.4;
  const beamHeight = Math.max(40, to.top + to.height / 2 - beamTop);
  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-50" aria-hidden>
      <img data-fx="clone" src={flight.shot} alt="" className="absolute object-cover" />
      <span
        data-fx="beam"
        className="absolute origin-top"
        style={{
          left: toCx - 17, top: beamTop, width: 34, height: beamHeight,
          background: `linear-gradient(180deg, ${SPECTRUM[0]}00, ${SPECTRUM[1]}AA 30%, ${SPECTRUM[5]}CC 70%, ${SPECTRUM[4]})`,
          filter: 'blur(10px)',
        }}
      />
      <span
        data-fx="core"
        className="absolute origin-top"
        style={{
          left: toCx - 2, top: beamTop, width: 4, height: beamHeight,
          background: 'linear-gradient(180deg, transparent, rgba(238,243,255,0.95))',
          boxShadow: '0 0 14px 3px rgba(238,243,255,0.7)',
        }}
      />
      <span
        data-fx="ring"
        className="absolute rounded-full"
        style={{
          left: toCx, top: to.top + to.height / 2, width: to.width * 2.2, height: to.width * 2.2,
          background: `conic-gradient(${SPECTRUM.join(',')}, ${SPECTRUM[0]})`,
          // Hollow the disc into a 3px spectrum ring (interior stays see-through).
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
          opacity: 0,
        }}
      />
      {SPECTRUM.map((hue, i) => (
        <span
          key={hue}
          data-fx="spark"
          className="absolute h-1.5 w-1.5 rounded-full"
          style={{
            left: toCx, top: to.top + to.height / 2,
            background: hue, boxShadow: `0 0 8px 2px ${hue}`, opacity: 0,
            transitionDelay: `${i}ms`,
          }}
        />
      ))}
    </div>
  );
}

/* ── In-camera orb (FilterOrbs idiom, beam-branded + demo-scaled) ─────── */

function Orb({
  active, hue, label, onClick, children,
}: {
  active: boolean;
  hue: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="group flex w-[52px] shrink-0 flex-col items-center gap-1 focus:outline-none"
    >
      <span
        className="relative flex h-[46px] w-[46px] items-center justify-center overflow-hidden rounded-full transition-all duration-200 group-active:scale-90"
        style={{
          background: 'rgba(9, 11, 20, 0.65)',
          border: `1.5px solid ${active ? hue : 'rgba(238,243,255,0.18)'}`,
          boxShadow: active ? `0 0 18px -2px ${hue}` : 'none',
          transform: active ? 'scale(1.08)' : undefined,
        }}
      >
        {children}
      </span>
      <span
        className="max-w-[52px] truncate text-center font-label text-[7.5px] uppercase tracking-wide leading-none"
        style={{ color: active ? hue : 'rgba(169,180,204,0.6)' }}
      >
        {label}
      </span>
    </button>
  );
}

function OrbThumb({ category, choice }: { category: Category; choice: Choice }) {
  if (category === 'frame') {
    // A tiny frame-shaped glyph reads better at 46px than the real 9:16 SVG.
    return (
      <span
        className="h-6 w-[17px] rounded-[4px]"
        style={{ border: `2px solid ${choice.hue}`, boxShadow: `inset 0 0 6px -2px ${choice.hue}` }}
      />
    );
  }
  if (category === 'effect') {
    return (
      <span
        className="flex h-full w-full items-center justify-center"
        style={{ background: `radial-gradient(circle at 50% 35%, ${choice.hue}55, transparent 75%)` }}
      >
        <Sparkles className="h-4 w-4" style={{ color: choice.hue }} />
      </span>
    );
  }
  const Icon = PROP_ICONS[choice.id] ?? Sparkles;
  return <Icon className="h-5 w-5" style={{ color: choice.hue }} />;
}

/* ── Component ────────────────────────────────────────────────────────── */

export default function DemoBooth() {
  const [started, setStarted] = useState(false);
  const [category, setCategory] = useState<Category>('frame');
  const [frameId, setFrameId] = useState<string | null>('beam');
  const [effectId, setEffectId] = useState<string | null>(null);
  const [propId, setPropId] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [trackerReady, setTrackerReady] = useState(false);
  const [wallShots, setWallShots] = useState<string[]>([]);
  const [canShare, setCanShare] = useState(false);
  const [flight, setFlight] = useState<Flight | null>(null);

  const stageRef = useRef<StageCanvasHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageBoxRef = useRef<HTMLDivElement>(null);
  const wallGridRef = useRef<HTMLDivElement>(null);
  const { videoRef, ready, error, retry, facingMode, flipCamera, canFlip } = useCameraStream(started, false);
  const mirror = facingMode === 'user';

  // Face tracking boots in the background after start; if it can't (offline,
  // model CDN unreachable) the demo still runs — props simply never attach.
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    initializeFaceLandmarker()
      .then(() => { if (!cancelled) setTrackerReady(true); })
      .catch(() => { /* filters + frames keep working without 3D */ });
    return () => { cancelled = true; };
  }, [started]);

  // navigator.share with files is mobile-mostly; probe once with a dummy file.
  useEffect(() => {
    try {
      const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' });
      setCanShare(typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [probe] }));
    } catch {
      setCanShare(false);
    }
  }, []);

  const capture = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 260);
    try {
      setShot(await stage.capturePhoto());
    } catch {
      /* capture failed (e.g. camera lost) — stay in live view */
    }
  }, []);

  const commitToWall = useCallback((img: string) => {
    setWallShots((prev) => [...prev, img].slice(-WALL_SLOTS));
  }, []);

  const beamToWall = useCallback(() => {
    if (!shot) return;
    const root = rootRef.current;
    const stageBox = stageBoxRef.current;
    // The tile this shot will land in (grid shifts left once full).
    const slot = Math.min(wallShots.length, WALL_SLOTS - 1);
    const tile = wallGridRef.current?.children[slot] as HTMLElement | undefined;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!root || !stageBox || !tile || reduceMotion || flight) {
      commitToWall(shot);
      setShot(null);
      return;
    }
    const rootBox = root.getBoundingClientRect();
    const rel = (r: DOMRect): BeamRect => ({
      left: r.left - rootBox.left, top: r.top - rootBox.top, width: r.width, height: r.height,
    });
    setFlight({ shot, from: rel(stageBox.getBoundingClientRect()), to: rel(tile.getBoundingClientRect()) });
    setShot(null);
  }, [shot, wallShots.length, flight, commitToWall]);

  const share = useCallback(async () => {
    if (!shot) return;
    try {
      const file = new File([dataUrlToBlob(shot)], 'beamwall-demo.jpg', { type: 'image/jpeg' });
      await navigator.share({ files: [file], title: 'Beamwall' });
    } catch {
      /* user dismissed the sheet, or share failed — nothing to clean up */
    }
  }, [shot]);

  // Materialize flare for freshly landed wall tiles — the BeamFlightFx clone
  // already did the travel, so arrival is a hot flash settling, not a drop.
  const beamTileIn = useCallback((el: HTMLDivElement | null) => {
    if (!el || el.dataset.beamed) return;
    el.dataset.beamed = '1';
    el.animate(
      [
        { opacity: 0.4, transform: 'scale(0.9)', filter: 'brightness(2.6) saturate(1.6)' },
        { opacity: 1, transform: 'none', filter: 'brightness(1) saturate(1)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  }, []);

  const anchor = propId ? HEAD_PIECE_MAP[propId]?.config : null;
  // Curated demo filters are real built-ins; fall back to none if renamed.
  const activeEffect = effectId && SHADER_MAP[effectId] ? effectId : 'none';
  const selectedOf: Record<Category, string | null> = { frame: frameId, effect: effectId, prop: propId };
  const setterOf: Record<Category, (id: string | null) => void> = {
    frame: setFrameId,
    effect: setEffectId,
    prop: setPropId,
  };
  const activeCat = CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0];
  const catHue = (key: Category) => {
    const sel = selectedOf[key];
    if (!sel) return null;
    return CATEGORIES.find((c) => c.key === key)?.options.find((o) => o.id === sel)?.hue ?? null;
  };

  return (
    <div ref={rootRef} className="relative flex w-full flex-col items-center">
      {/* Stage */}
      <div
        ref={stageBoxRef}
        className="relative w-full max-w-[320px] overflow-hidden rounded-[2rem] sm:max-w-[360px]"
        style={{
          aspectRatio: '9 / 16',
          border: '1px solid rgba(91, 140, 255, 0.45)',
          boxShadow: '0 0 60px -14px rgba(91, 140, 255, 0.55), 0 30px 90px -30px rgba(0,0,0,0.85)',
          background: 'radial-gradient(120% 90% at 50% 20%, rgba(91,140,255,0.14), rgba(5,6,11,0.95) 65%)',
        }}
      >
        {!started && (
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="group absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 text-center"
          >
            <span
              className="flex h-20 w-20 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-110"
              style={{
                background: 'linear-gradient(135deg, rgba(91,140,255,0.25), rgba(124,108,247,0.12))',
                border: '1px solid rgba(91,140,255,0.6)',
                boxShadow: '0 0 44px -8px rgba(91,140,255,0.8)',
              }}
            >
              <BoothIcon size={38} from="#5B8CFF" to="#7C6CF7" />
            </span>
            <span className="font-label text-xs uppercase tracking-luxe text-brand-fg">Start the demo</span>
            <span className="max-w-[220px] text-xs leading-relaxed text-brand-muted/70">
              Your camera stays on your device — nothing is uploaded.
            </span>
          </button>
        )}

        {started && error && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-sm leading-relaxed text-brand-muted">
              Camera unavailable — check browser permissions and try again.
            </p>
            <button
              type="button"
              onClick={retry}
              className="rounded-full border border-brand-muted/40 px-5 py-2 font-label text-[11px] uppercase tracking-luxe text-brand-fg"
            >
              Retry
            </button>
          </div>
        )}

        {started && !error && (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              id="demo-booth-video"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover opacity-0"
            />
            {!ready && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <span className="font-label text-[10px] uppercase tracking-luxe text-brand-muted/70 animate-pulse">
                  Warming up…
                </span>
              </div>
            )}
            {propId && anchor && (
              <Overlay3D proceduralId={propId} anchor={anchor} videoId="demo-booth-video" mirror={mirror} />
            )}
            <StageCanvas
              ref={stageRef}
              videoRef={videoRef}
              effectId={activeEffect}
              mirror={mirror}
              overlayUrl={frameId ? FRAME_URLS[frameId] : null}
              threeCanvasId={propId ? 'booth-3d-layer' : null}
              watermark={false}
              active={!shot}
            />
            {propId && !trackerReady && (
              <p className="absolute left-0 right-0 top-4 z-20 text-center font-label text-[9px] uppercase tracking-luxe text-brand-muted/60">
                Looking for your face…
              </p>
            )}

            {/* Capture flash */}
            <div
              className="pointer-events-none absolute inset-0 z-40 bg-white transition-opacity duration-200"
              style={{ opacity: flash ? 0.85 : 0 }}
            />

            {/* Captured shot review */}
            {shot && (
              <div className="absolute inset-0 z-30 flex flex-col bg-void-900/85 backdrop-blur-sm">
                <img src={shot} alt="Your captured demo photo" className="min-h-0 flex-1 object-contain" />
                <div className="flex flex-col items-center gap-2.5 px-4 pb-4 pt-3">
                  <button
                    type="button"
                    onClick={beamToWall}
                    className="bg-foil w-full max-w-[240px] rounded-full px-5 py-2.5 font-label text-[11px] uppercase tracking-luxe text-white glow-accent transition active:scale-[0.98]"
                  >
                    Beam it to the wall
                  </button>
                  <div className="flex items-center justify-center gap-2.5">
                    <a
                      href={shot}
                      download="beamwall-demo.jpg"
                      className="rounded-full border border-brand-muted/40 px-4 py-1.5 font-label text-[10px] uppercase tracking-luxe text-brand-fg"
                    >
                      Save
                    </a>
                    {canShare && (
                      <button
                        type="button"
                        onClick={share}
                        className="rounded-full border border-brand-muted/40 px-4 py-1.5 font-label text-[10px] uppercase tracking-luxe text-brand-fg"
                      >
                        Share
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShot(null)}
                      className="rounded-full border border-brand-muted/40 px-4 py-1.5 font-label text-[10px] uppercase tracking-luxe text-brand-fg"
                    >
                      Retake
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* In-camera controls: category tabs → orb carousel → shutter,
                on a scrim so they read over any feed (FilterOrbs idiom). */}
            {!shot && (
              <div
                className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-3 pb-4 pt-10"
                style={{ background: 'linear-gradient(to top, rgba(5,6,11,0.88) 30%, rgba(5,6,11,0.45) 70%, transparent)' }}
              >
                <div className="flex items-center gap-5">
                  {CATEGORIES.map((c) => {
                    const on = category === c.key;
                    const dot = catHue(c.key);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setCategory(c.key)}
                        className="relative pb-1 font-label text-[9px] uppercase tracking-[0.28em] transition-colors"
                        style={{ color: on ? '#EEF3FF' : 'rgba(169,180,204,0.55)' }}
                      >
                        {c.label}
                        {dot && (
                          <span
                            className="absolute -right-2 top-0 h-1.5 w-1.5 rounded-full"
                            style={{ background: dot, boxShadow: `0 0 6px ${dot}` }}
                          />
                        )}
                        {on && (
                          <span className="absolute bottom-0 left-1/2 h-px w-5 -translate-x-1/2 bg-brand-fg/80" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-start justify-center gap-2">
                  <Orb
                    active={selectedOf[category] === null}
                    hue="#A9B4CC"
                    label="None"
                    onClick={() => setterOf[category](null)}
                  >
                    <Ban className="h-4 w-4 text-brand-muted/60" />
                  </Orb>
                  {activeCat.options.map((o) => (
                    <Orb
                      key={o.id}
                      active={selectedOf[category] === o.id}
                      hue={o.hue}
                      label={o.name}
                      onClick={() => setterOf[category](selectedOf[category] === o.id ? null : o.id)}
                    >
                      <OrbThumb category={category} choice={o} />
                    </Orb>
                  ))}
                </div>

                <div className="relative mt-1 flex w-full items-center justify-center">
                  <button
                    type="button"
                    onClick={capture}
                    disabled={!ready}
                    aria-label="Take photo"
                    className="h-14 w-14 rounded-full border-4 border-white/90 bg-white/25 backdrop-blur-sm transition-transform active:scale-90 disabled:opacity-40"
                    style={{ boxShadow: '0 0 30px -6px rgba(238,243,255,0.9)' }}
                  />
                  {canFlip && (
                    <button
                      type="button"
                      onClick={flipCamera}
                      aria-label="Flip camera"
                      className="absolute right-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-void-900/50 text-brand-fg backdrop-blur-sm"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8v4h4M21 16v-4h-4" />
                        <path d="M20.5 9A8.5 8.5 0 0 0 6 5.5L3 8M3.5 15A8.5 8.5 0 0 0 18 18.5l3-2.5" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Mini live wall — captures beam in exactly like at a real event. */}
      <div className="mt-8 w-full max-w-[420px]">
        <p className="mb-3 text-center font-label text-[9px] uppercase tracking-luxe text-brand-muted/60">
          The live wall — your shots beam in
        </p>
        <div ref={wallGridRef} className="grid grid-cols-6 gap-2">
          {Array.from({ length: WALL_SLOTS }, (_, i) => {
            const img = wallShots[i];
            return img ? (
              <div
                key={`${i}-${img.length}`}
                ref={beamTileIn}
                className="aspect-[9/16] overflow-hidden rounded-lg"
                style={{
                  border: '1px solid rgba(91,140,255,0.55)',
                  boxShadow: '0 0 18px -4px rgba(91,140,255,0.6)',
                }}
              >
                <img src={img} alt="" aria-hidden className="h-full w-full object-cover" />
              </div>
            ) : (
              <div
                key={`empty-${i}`}
                className="aspect-[9/16] rounded-lg border border-dashed border-white/12 bg-white/[0.02]"
              />
            );
          })}
        </div>
      </div>

      {flight && (
        <BeamFlightFx
          flight={flight}
          onLand={() => commitToWall(flight.shot)}
          onFinished={() => setFlight(null)}
        />
      )}
    </div>
  );
}
