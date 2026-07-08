/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DemoBooth — the Landing page's live "try it now" sandbox booth.
 *
 * A trimmed-down, fully client-side cut of the real guest booth: live camera →
 * WebGL filter → face-tracked 3D prop → frame overlay, with photo capture and
 * local download. No auth, no upload, no event — everything stays on-device.
 * Reuses the production pipeline (useCameraStream / StageCanvas / Overlay3D)
 * so the demo IS the product, not a mock. Camera starts only on explicit tap.
 *
 * Curated to exactly 3 frames × 3 filters × 3 props (tap again to clear), all
 * beam-branded: frames are demo-local SVGs, filters/props are the same
 * built-ins guests get. Face-landmarker failure (offline/CDN blocked) keeps
 * camera + filters + frames working — only the 3D props quietly no-op.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraStream } from '../booth/useCameraStream';
import StageCanvas, { type StageCanvasHandle } from '../booth/StageCanvas';
import Overlay3D from '../booth/Overlay3D';
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
  { id: 'neon-shades', name: 'Neon Shades', hue: '#7C6CF7' },
  { id: 'queen-tiara', name: 'Tiara', hue: '#38BDF8' },
  { id: 'cheek-stars', name: 'Sparkles', hue: '#FB923C' },
];

const FRAME_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(DEMO_FRAME_SVGS).map(([id, svg]) => [id, toDataUrl(svg)]),
);

function ChipRow({
  label, options, selected, onPick,
}: {
  label: string;
  options: Choice[];
  selected: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
      <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60 sm:w-14 sm:text-right">
        {label}
      </span>
      <div className="flex flex-wrap justify-center gap-2">
        {options.map((o) => {
          const on = selected === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(on ? null : o.id)}
              aria-pressed={on}
              className="rounded-full px-4 py-1.5 font-label text-[11px] uppercase tracking-[0.18em] transition-all duration-200"
              style={{
                color: on ? '#EEF3FF' : 'rgba(169,180,204,0.85)',
                background: on ? `linear-gradient(135deg, ${o.hue}33, ${o.hue}14)` : 'rgba(18,20,31,0.6)',
                border: `1px solid ${on ? o.hue : 'rgba(169,180,204,0.22)'}`,
                boxShadow: on ? `0 0 22px -6px ${o.hue}` : 'none',
              }}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DemoBooth() {
  const [started, setStarted] = useState(false);
  const [frameId, setFrameId] = useState<string | null>('beam');
  const [effectId, setEffectId] = useState<string | null>(null);
  const [propId, setPropId] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [trackerReady, setTrackerReady] = useState(false);

  const stageRef = useRef<StageCanvasHandle>(null);
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

  const anchor = propId ? HEAD_PIECE_MAP[propId]?.config : null;
  // Curated demo filters are real built-ins; fall back to none if renamed.
  const activeEffect = effectId && SHADER_MAP[effectId] ? effectId : 'none';

  return (
    <div className="flex w-full flex-col items-center">
      {/* Stage */}
      <div
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
              <div className="absolute inset-0 z-30 flex flex-col bg-void-900/80 backdrop-blur-sm">
                <img src={shot} alt="Your captured demo photo" className="min-h-0 flex-1 object-contain" />
                <div className="flex items-center justify-center gap-3 py-4">
                  <a
                    href={shot}
                    download="beamwall-demo.jpg"
                    className="bg-foil rounded-full px-5 py-2 font-label text-[11px] uppercase tracking-luxe text-white"
                  >
                    Save photo
                  </a>
                  <button
                    type="button"
                    onClick={() => setShot(null)}
                    className="rounded-full border border-brand-muted/40 px-5 py-2 font-label text-[11px] uppercase tracking-luxe text-brand-fg"
                  >
                    Retake
                  </button>
                </div>
              </div>
            )}

            {/* Shutter + flip */}
            {!shot && (
              <div className="absolute bottom-5 left-0 right-0 z-20 flex items-center justify-center gap-6">
                <button
                  type="button"
                  onClick={capture}
                  disabled={!ready}
                  aria-label="Take photo"
                  className="h-16 w-16 rounded-full border-4 border-white/90 bg-white/25 backdrop-blur-sm transition-transform active:scale-90 disabled:opacity-40"
                  style={{ boxShadow: '0 0 34px -6px rgba(238,243,255,0.9)' }}
                />
                {canFlip && (
                  <button
                    type="button"
                    onClick={flipCamera}
                    aria-label="Flip camera"
                    className="absolute right-6 flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-void-900/50 text-brand-fg backdrop-blur-sm"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8v4h4M21 16v-4h-4" />
                      <path d="M20.5 9A8.5 8.5 0 0 0 6 5.5L3 8M3.5 15A8.5 8.5 0 0 0 18 18.5l3-2.5" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Pickers */}
      <div className="mt-8 flex w-full max-w-xl flex-col gap-4">
        <ChipRow label="Frame" options={FRAMES} selected={frameId} onPick={setFrameId} />
        <ChipRow label="Effect" options={FILTERS} selected={effectId} onPick={setEffectId} />
        <ChipRow label="3D Prop" options={PROPS} selected={propId} onPick={setPropId} />
      </div>
    </div>
  );
}
