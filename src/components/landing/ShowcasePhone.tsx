/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ShowcasePhone — a modern-smartphone mockup whose screen runs the REAL booth
 * camera pipeline. It is the interactive half of the landing page's
 * InteractiveShowcase centerpiece: the same client-side cut of the guest booth
 * that DemoBooth pioneered (live camera → WebGL effect → face-tracked 3D prop →
 * frame overlay, with capture / native share / local download), wrapped in a
 * device chrome and driven by the parent's `appState` machine.
 *
 * The in-camera UI keeps DemoBooth's idiom verbatim (category tabs Frame ·
 * Effect · 3D over an orb carousel over the shutter, on a bottom scrim) so the
 * demo IS the product. The parent owns the beam-to-wall ceremony; this
 * component only OWNS the live booth + the captured-shot review, and hands the
 * finished shot up via `onBeam`. The camera stream is bound to
 * `appState === 'camera'` so beaming/wall states release the device camera.
 *
 * Reduced-motion policy (mirrors DemoBooth): ambient HUD motion (scan line,
 * idle glow pulse) respects prefers-reduced-motion; the user-initiated capture
 * flash still fires because it is a direct response to a tap.
 *
 * The demo choice data (frames / effects / props) is re-declared here rather
 * than imported from DemoBooth, which is being retired.
 */
import {
  useCallback, useEffect, useRef, useState, type ReactNode,
} from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Ban, Crown, Glasses, Sparkles, X } from 'lucide-react';
import { useCameraStream } from '../booth/useCameraStream';
import StageCanvas, { type StageCanvasHandle } from '../booth/StageCanvas';
import Overlay3D from '../booth/Overlay3D';
import { dataUrlToBlob } from '../booth/capture';
import { toDataUrl } from '../../lib/borders';
import { SHADER_MAP } from '../../lib/shaders';
import { HEAD_PIECE_MAP } from '../../lib/headPieces';
import { initializeFaceLandmarker } from '../../lib/faceTracking';
import { BoothIcon } from '../ui/BeamIcons';

/* ── The seven-hue brand spectrum, shared with the parent light show. ─── */
export const SPECTRUM = ['#5B8CFF', '#22D3EE', '#34D399', '#FB923C', '#E879F9', '#7C6CF7', '#38BDF8'];

/* ── Demo frames — beam-branded, text-free, 1080×1920 like borders.ts ── */

const DEMO_FRAME_SVGS: Record<string, string> = {
  beam: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="sbeam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#38BDF8"/><stop offset="0.5" stop-color="#5B8CFF"/><stop offset="1" stop-color="#7C6CF7"/>
    </linearGradient>
  </defs>
  <rect x="34" y="34" width="1012" height="1852" rx="56" fill="none" stroke="url(#sbeam)" stroke-width="10" opacity="0.95"/>
  <rect x="58" y="58" width="964" height="1804" rx="42" fill="none" stroke="url(#sbeam)" stroke-width="2.5" opacity="0.55"/>
  <circle cx="90" cy="90" r="7" fill="#38BDF8" opacity="0.9"/><circle cx="990" cy="90" r="7" fill="#5B8CFF" opacity="0.9"/>
  <circle cx="90" cy="1830" r="7" fill="#7C6CF7" opacity="0.9"/><circle cx="990" cy="1830" r="7" fill="#38BDF8" opacity="0.9"/>
</svg>`,
  prism: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="sprsm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#E879F9"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#sprsm)" stroke-width="12" stroke-linecap="round" opacity="0.95">
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
    <linearGradient id="sspec" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5B8CFF"/><stop offset="0.17" stop-color="#22D3EE"/><stop offset="0.34" stop-color="#34D399"/>
      <stop offset="0.5" stop-color="#FB923C"/><stop offset="0.67" stop-color="#E879F9"/><stop offset="0.84" stop-color="#7C6CF7"/>
      <stop offset="1" stop-color="#38BDF8"/>
    </linearGradient>
  </defs>
  <rect x="30" y="30" width="1020" height="1860" rx="48" fill="none" stroke="url(#sspec)" stroke-width="6" opacity="0.8"/>
  <rect x="70" y="1790" width="940" height="14" rx="7" fill="url(#sspec)" opacity="0.95"/>
  <rect x="70" y="116" width="940" height="4" rx="2" fill="url(#sspec)" opacity="0.5"/>
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

/* ── In-camera orb (FilterOrbs idiom, beam-branded + phone-scaled) ────── */

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
      className="group flex w-[48px] shrink-0 flex-col items-center gap-1 focus:outline-none"
    >
      <span
        className="relative flex h-[42px] w-[42px] items-center justify-center overflow-hidden rounded-full transition-all duration-200 group-active:scale-90"
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
        className="max-w-[48px] truncate text-center font-label text-[7.5px] uppercase tracking-wide leading-none"
        style={{ color: active ? hue : 'rgba(169,180,204,0.6)' }}
      >
        {label}
      </span>
    </button>
  );
}

function OrbThumb({ category, choice }: { category: Category; choice: Choice }) {
  if (category === 'frame') {
    // A tiny frame-shaped glyph reads better at 42px than the real 9:16 SVG.
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

/* ── AR HUD (idle-screen decoration) ──────────────────────────────────── */

/** Four corner brackets + a slow scan line + an "AR READY" chip. The scan
 *  line is ambient, so it only animates when motion is allowed. */
function ArHud({ reduced }: { reduced: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {/* corner brackets */}
      {[
        'left-4 top-4 border-l-2 border-t-2',
        'right-4 top-4 border-r-2 border-t-2',
        'left-4 bottom-24 border-l-2 border-b-2',
        'right-4 bottom-24 border-r-2 border-b-2',
      ].map((pos) => (
        <span
          key={pos}
          className={`absolute h-5 w-5 rounded-[3px] ${pos}`}
          style={{ borderColor: 'rgba(91,140,255,0.5)' }}
        />
      ))}
      {/* slow vertical scan line */}
      {!reduced && (
        <motion.span
          className="absolute inset-x-6 h-px"
          style={{ background: 'linear-gradient(to right, transparent, rgba(91,140,255,0.7), transparent)' }}
          initial={{ top: '16%', opacity: 0 }}
          animate={{ top: ['16%', '78%', '16%'], opacity: [0, 0.9, 0] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {/* AR READY chip */}
      <span
        className="absolute left-1/2 top-[14%] -translate-x-1/2 rounded-full border px-2.5 py-1 font-label text-[7px] uppercase tracking-luxe"
        style={{ borderColor: 'rgba(91,140,255,0.35)', background: 'rgba(9,11,20,0.5)', color: 'rgba(169,180,204,0.85)' }}
      >
        ● AR Ready
      </span>
    </div>
  );
}

/* ── Component ────────────────────────────────────────────────────────── */

export interface ShowcasePhoneProps {
  /** idle → glowing Open Camera screen; camera → live booth; other states:
   *  screen dark (parent hides / collapses the phone). */
  appState: 'idle' | 'camera' | 'beaming' | 'wall';
  onOpenCamera: () => void;
  onClose: () => void;
  onBeam: (shot: string) => void;
  /** Ref to the inner SCREEN element so the parent can measure the beam origin. */
  screenRef: React.Ref<HTMLDivElement>;
}

export default function ShowcasePhone({
  appState, onOpenCamera, onClose, onBeam, screenRef,
}: ShowcasePhoneProps) {
  const reduced = useReducedMotion() ?? false;
  const cameraOn = appState === 'camera';

  const [category, setCategory] = useState<Category>('frame');
  const [frameId, setFrameId] = useState<string | null>('beam');
  const [effectId, setEffectId] = useState<string | null>(null);
  const [propId, setPropId] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [trackerReady, setTrackerReady] = useState(false);
  const [canShare, setCanShare] = useState(false);

  const stageRef = useRef<StageCanvasHandle>(null);
  const { videoRef, ready, error, retry, facingMode, flipCamera, canFlip } = useCameraStream(cameraOn, false);
  const mirror = facingMode === 'user';

  // Face tracking boots in the background once the camera opens; if it can't
  // (offline, model CDN unreachable) the booth still runs — props simply never
  // attach. Failure is swallowed silently (filters + frames keep working).
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    initializeFaceLandmarker()
      .then(() => { if (!cancelled) setTrackerReady(true); })
      .catch(() => { /* filters + frames keep working without 3D */ });
    return () => { cancelled = true; };
  }, [cameraOn]);

  // navigator.share with files is mobile-mostly; probe once with a dummy file.
  useEffect(() => {
    try {
      const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' });
      setCanShare(typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [probe] }));
    } catch {
      setCanShare(false);
    }
  }, []);

  // Leaving the camera clears any in-progress review so a re-open starts clean.
  useEffect(() => {
    if (!cameraOn && shot !== null) setShot(null);
  }, [cameraOn, shot]);

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

  const share = useCallback(async () => {
    if (shot === null) return;
    try {
      const file = new File([dataUrlToBlob(shot)], 'beamwall-demo.jpg', { type: 'image/jpeg' });
      await navigator.share({ files: [file], title: 'Beamwall' });
    } catch {
      /* user dismissed the sheet, or share failed — nothing to clean up */
    }
  }, [shot]);

  const beam = useCallback(() => {
    if (shot === null) return;
    onBeam(shot);
    setShot(null); // parent takes over the ceremony
  }, [shot, onBeam]);

  const anchor = propId !== null ? HEAD_PIECE_MAP[propId]?.config : null;
  // Curated demo effects are real built-ins; fall back to none if renamed.
  const activeEffect = effectId !== null && SHADER_MAP[effectId] ? effectId : 'none';
  const selectedOf: Record<Category, string | null> = { frame: frameId, effect: effectId, prop: propId };
  const setterOf: Record<Category, (id: string | null) => void> = {
    frame: setFrameId,
    effect: setEffectId,
    prop: setPropId,
  };
  const activeCat = CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0];
  const catHue = (key: Category): string | null => {
    const sel = selectedOf[key];
    if (sel === null) return null;
    return CATEGORIES.find((c) => c.key === key)?.options.find((o) => o.id === sel)?.hue ?? null;
  };

  return (
    <div className="relative mx-auto w-full" style={{ aspectRatio: '9 / 19.4' }}>
      {/* Side-button nubs */}
      <span aria-hidden className="absolute -left-[2px] top-[20%] h-8 w-[3px] rounded-full bg-white/15" />
      <span aria-hidden className="absolute -left-[2px] top-[32%] h-14 w-[3px] rounded-full bg-white/15" />
      <span aria-hidden className="absolute -right-[2px] top-[26%] h-16 w-[3px] rounded-full bg-white/15" />

      {/* Chrome — a beam-tinted metallic rim over void, with a thin inner
          bezel. Inline (not .glass): that utility is legacy gold-tinted AND
          backdrop-filter inside an animated 3D transform is a Safari hazard. */}
      <div
        className="relative h-full w-full rounded-[2.75rem] p-[5px]"
        style={{
          background: 'linear-gradient(145deg, rgba(238,243,255,0.16), rgba(91,140,255,0.07) 40%, rgba(238,243,255,0.04))',
          border: '1px solid rgba(238,243,255,0.16)',
          boxShadow: '0 0 60px -14px rgba(91,140,255,0.5), 0 40px 90px -30px rgba(0,0,0,0.9)',
        }}
      >
        <div className="h-full w-full rounded-[2.4rem] p-[2px]" style={{ background: 'rgba(3,4,9,0.9)' }}>
          {/* Screen. The parent's beam-origin ref lives on the viewfinder
              below (it matches the reviewed photo's on-screen rect). */}
          <div
            className="relative h-full w-full overflow-hidden rounded-[2.2rem]"
            style={{ background: 'radial-gradient(120% 90% at 50% 20%, rgba(91,140,255,0.14), rgba(5,6,11,0.97) 65%)' }}
          >
            {/* Idle — glowing Open Camera screen + privacy line + AR HUD. */}
            {appState === 'idle' && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 px-6 text-center">
                <ArHud reduced={reduced} />
                <motion.button
                  type="button"
                  onClick={onOpenCamera}
                  className="group relative z-20 flex h-[76px] w-[76px] items-center justify-center rounded-full"
                  style={{
                    background: 'linear-gradient(135deg, rgba(91,140,255,0.28), rgba(124,108,247,0.12))',
                    border: '1px solid rgba(91,140,255,0.6)',
                  }}
                  animate={reduced ? undefined : { boxShadow: [
                    '0 0 26px -8px rgba(91,140,255,0.7)',
                    '0 0 46px -4px rgba(91,140,255,0.95)',
                    '0 0 26px -8px rgba(91,140,255,0.7)',
                  ] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  whileTap={{ scale: 0.94 }}
                >
                  <BoothIcon size={36} from="#5B8CFF" to="#7C6CF7" />
                </motion.button>
                <div className="relative z-20 flex flex-col items-center gap-2">
                  <span className="font-label text-[11px] uppercase tracking-luxe text-brand-fg">Open Camera</span>
                  <span className="max-w-[210px] text-[11px] leading-relaxed text-brand-muted/70">
                    Your camera stays on your device — nothing is uploaded.
                  </span>
                </div>
              </div>
            )}

            {/* Camera — the real booth pipeline. */}
            {appState === 'camera' && (
              <>
                {error !== null && (
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
                    <button
                      type="button"
                      onClick={onClose}
                      className="font-label text-[10px] uppercase tracking-luxe text-brand-muted/60 underline underline-offset-2"
                    >
                      Close
                    </button>
                  </div>
                )}

                {error === null && (
                  <>
                    {/* 9:16 viewfinder, letterboxed camera-app style in the
                        taller screen: StageCanvas composites a 9:16 frame, so
                        matching its aspect keeps the AR frame's side edges
                        visible (object-cover in the full 9:19.4 screen would
                        crop them) and keeps Overlay3D's prop canvas aligned
                        with the feed. */}
                    <div ref={screenRef} className="absolute inset-x-0 top-1/2 aspect-[9/16] -translate-y-1/2 overflow-hidden">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        id="showcase-booth-video"
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
                      {propId !== null && anchor && (
                        <Overlay3D proceduralId={propId} anchor={anchor} videoId="showcase-booth-video" mirror={mirror} />
                      )}
                      <StageCanvas
                        ref={stageRef}
                        videoRef={videoRef}
                        effectId={activeEffect}
                        mirror={mirror}
                        overlayUrl={frameId !== null ? FRAME_URLS[frameId] : null}
                        threeCanvasId={propId !== null ? 'booth-3d-layer' : null}
                        watermark={false}
                        active={shot === null}
                      />
                      {propId !== null && !trackerReady && (
                        <p className="absolute left-0 right-0 top-3 z-20 text-center font-label text-[9px] uppercase tracking-luxe text-brand-muted/60">
                          Looking for your face…
                        </p>
                      )}

                      {/* Capture flash */}
                      <div
                        className="pointer-events-none absolute inset-0 z-40 bg-white transition-opacity duration-200"
                        style={{ opacity: flash ? 0.85 : 0 }}
                      />
                    </div>

                    {/* Top bar — flip + close (small glass circles), live only. */}
                    {shot === null && (
                      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-3 pt-3">
                        {canFlip ? (
                          <button
                            type="button"
                            onClick={flipCamera}
                            aria-label="Flip camera"
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-void-900/55 text-brand-fg"
                          >
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 8v4h4M21 16v-4h-4" />
                              <path d="M20.5 9A8.5 8.5 0 0 0 6 5.5L3 8M3.5 15A8.5 8.5 0 0 0 18 18.5l3-2.5" />
                            </svg>
                          </button>
                        ) : (
                          <span className="h-8 w-8" />
                        )}
                        <button
                          type="button"
                          onClick={onClose}
                          aria-label="Close camera"
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-void-900/55 text-brand-fg"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    {/* Captured-shot review. */}
                    {shot !== null && (
                      <div className="absolute inset-0 z-30 flex flex-col bg-void-900/85 backdrop-blur-sm">
                        <img
                          src={shot}
                          alt="Your captured demo photo"
                          className="min-h-0 flex-1 object-contain"
                        />
                        <div className="flex flex-col items-center gap-2.5 px-3 pb-4 pt-3">
                          <button
                            type="button"
                            onClick={beam}
                            className="bg-foil w-full max-w-[220px] rounded-full px-5 py-2.5 font-label text-[11px] uppercase tracking-luxe text-white glow-accent transition active:scale-[0.98]"
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

                    {/* In-camera controls: category tabs → orb carousel → shutter. */}
                    {shot === null && (
                      <div
                        className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-3 pb-4 pt-10"
                        style={{ background: 'linear-gradient(to top, rgba(5,6,11,0.9) 30%, rgba(5,6,11,0.45) 70%, transparent)' }}
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
                                {dot !== null && (
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

                        <div className="flex items-start justify-center gap-1.5">
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

                        <button
                          type="button"
                          onClick={capture}
                          disabled={!ready}
                          aria-label="Take photo"
                          className="mt-1 h-14 w-14 rounded-full border-4 border-white/90 bg-white/25 backdrop-blur-sm transition-transform active:scale-90 disabled:opacity-40"
                          style={{ boxShadow: '0 0 30px -6px rgba(238,243,255,0.9)' }}
                        />
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* Beaming / wall — screen dark; the parent collapses the phone. */}
            {(appState === 'beaming' || appState === 'wall') && (
              <div className="absolute inset-0 flex items-center justify-center bg-void-900">
                <BoothIcon size={30} from="#5B8CFF" to="#7C6CF7" className="opacity-20" />
              </div>
            )}

            {/* Dynamic-island pill. */}
            <div
              aria-hidden
              className="absolute left-1/2 top-2.5 z-40 h-6 w-24 -translate-x-1/2 rounded-full"
              style={{ background: 'rgba(2,3,7,0.95)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' }}
            />
            {/* Screen glare — a subtle glass reflection over everything. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[45] rounded-[2.2rem]"
              style={{ background: 'linear-gradient(150deg, rgba(255,255,255,0.10), transparent 26%, transparent 82%, rgba(255,255,255,0.05))' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
