/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /try/:kit — a themed, hands-on Beamwall booth for prospects (noindex).
 *
 * Runs the landing demo's REAL camera pipeline (CameraExperience: live camera
 * → effect → face-tracked 3D prop → frame) with a kit of real frames, then
 * "beams" the shot onto a local live-wall preview. Nothing is uploaded, posted
 * or stored: the wall lives in component state and is gone on reload.
 *
 * Two surfaces:
 *  - opened directly (a phone from the deck's QR, or "Open full screen"):
 *    full-page, with a header and a way back;
 *  - ?embed=1, inside the deck's demo slide (an iframe): no header, camera +
 *    wall side by side when there is room.
 *
 * The camera starts only on a tap — an iframe must never ask for the camera
 * just because its slide came into view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, Lock, RotateCcw } from 'lucide-react';
import CameraExperience from '../../components/landing/CameraExperience';
import { demoKit } from '../../lib/demoKits';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from './components/pageMeta';
import { salesImage } from './salesImages';

/** Other "guests" already on the wall, so the first beam lands in a room. */
const SAMPLE_TILES = ['event-wedding', 'event-birthday', 'event-gala', 'event-activation', 'event-conference', 'event-tradeshow', 'hero-wall', 'event-wedding', 'event-gala'];

interface WallShot { id: number; src: string; }

function useWide(min: number): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= min);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= min);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [min]);
  return wide;
}

function LiveWall({ shots, onAgain }: { shots: WallShot[]; onAgain?: () => void }) {
  const tiles = [
    ...shots.map((s) => ({ key: `s${s.id}`, src: s.src, mine: true })),
    ...SAMPLE_TILES.map((k) => ({ key: k, src: salesImage(k)?.src ?? '', mine: false })),
  ].slice(0, 9);
  return (
    <section
      aria-label="Live wall preview"
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/10 p-3"
      style={{ background: 'radial-gradient(120% 80% at 50% 0%, rgba(124,108,247,0.22), rgba(5,6,11,0.96) 70%)' }}
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="flex items-center gap-2 font-label text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-fg">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-70 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
          </span>
          Live wall
        </p>
        <p className="font-label text-[10px] uppercase tracking-[0.2em] text-brand-muted">{shots.length === 0 ? 'Waiting for you' : `${shots.length} from you`}</p>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-3 gap-2">
        {tiles.map((t, i) => (
          <div
            key={`${t.key}-${i}`}
            className={`relative overflow-hidden rounded-xl bg-white/[0.04] ${t.mine && i === 0 ? 'try-arrive' : ''}`}
            style={t.mine ? { boxShadow: '0 0 0 2px rgba(232,121,249,0.85), 0 0 28px -4px rgba(232,121,249,0.9)' } : undefined}
          >
            {t.src !== '' && <img src={t.src} alt={t.mine ? 'Your photo on the wall' : ''} className="h-full w-full object-cover" draggable={false} />}
            {t.mine && (
              <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5 font-label text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                {i === 0 ? 'Just now' : 'You'}
              </span>
            )}
          </div>
        ))}
      </div>
      {onAgain !== undefined && (
        <button
          type="button"
          onClick={onAgain}
          className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-foil px-5 font-label text-[12px] font-bold uppercase tracking-[0.18em] text-white glow-accent"
        >
          <RotateCcw className="h-4 w-4" aria-hidden /> Take another
        </button>
      )}
    </section>
  );
}

const ARRIVE_CSS = `
@keyframes try-arrive { 0% { transform: translateY(-40%) scale(0.6); opacity: 0; filter: blur(8px) brightness(2.2); } 60% { opacity: 1; filter: blur(0) brightness(1.4); } 100% { transform: none; filter: none; } }
.try-arrive { animation: try-arrive 900ms cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .try-arrive { animation: none; } }
`;

export default function TryPage() {
  const { kit: kitId } = useParams();
  const [params] = useSearchParams();
  const embed = params.get('embed') === '1';
  const kit = demoKit(kitId);
  const navigate = useNavigate();
  const wide = useWide(embed ? 560 : 820);
  const [started, setStarted] = useState(false);
  const [shots, setShots] = useState<WallShot[]>([]);
  const [showWall, setShowWall] = useState(false);
  const nextId = useRef(1);

  usePageTitle(`Try the ${kit.label.toLowerCase()} booth · Beamwall`);
  useNoIndex();

  const onBeam = useCallback((src: string) => {
    const id = nextId.current++;
    setShots((prev) => [{ id, src }, ...prev].slice(0, 6));
    setShowWall(true);
  }, []);

  // The camera runs only while the booth is on screen: on a narrow screen the
  // wall replaces it, so release the device camera while the wall shows.
  const cameraOn = started && (wide || !showWall);

  const start = (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex -space-x-6">
        {kit.frames.slice(0, 3).map((f, i) => (
          <img
            key={f.id}
            src={f.thumb}
            alt=""
            draggable={false}
            className="h-36 w-[81px] rounded-xl object-cover shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/15"
            style={{ transform: `rotate(${(i - 1) * 7}deg) translateY(${i === 1 ? -8 : 0}px)` }}
          />
        ))}
      </div>
      <div>
        <p className="font-label text-[11px] font-semibold uppercase tracking-[0.26em] text-[color:var(--color-accent)]">Try it yourself</p>
        <h1 className="mt-2 font-serif text-[28px] font-semibold leading-tight text-brand-fg">The {kit.label.toLowerCase()} booth</h1>
        <p className="mx-auto mt-2 max-w-[30ch] text-[14.5px] leading-snug text-brand-muted">{kit.blurb}</p>
      </div>
      <button
        type="button"
        onClick={() => setStarted(true)}
        className="inline-flex min-h-12 items-center gap-2 rounded-full bg-foil px-7 font-label text-[13px] font-bold uppercase tracking-[0.2em] text-white glow-accent active:scale-[0.98]"
      >
        <Camera className="h-5 w-5" aria-hidden /> Start the camera
      </button>
      <p className="flex items-center gap-1.5 text-[12px] text-brand-muted/80">
        <Lock className="h-3.5 w-3.5" aria-hidden /> Your photos stay on this device. Nothing is uploaded.
      </p>
    </div>
  );

  const booth = (
    <div className="relative h-full w-full overflow-hidden rounded-[22px] border border-white/10 bg-[#05060b]">
      {started ? (
        <CameraExperience
          enabled={cameraOn}
          videoId="try-booth-video"
          beamLabel="Beam to the wall"
          onBeam={onBeam}
          kit={kit}
        />
      ) : (
        start
      )}
    </div>
  );

  const body = wide ? (
    <div className={`grid min-h-0 flex-1 gap-3 ${embed ? 'grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)]' : 'mx-auto w-full max-w-[1100px] grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6'}`}>
      {booth}
      <LiveWall shots={shots} />
    </div>
  ) : (
    <div className="relative min-h-0 flex-1">
      {booth}
      {showWall && (
        <div className="absolute inset-0 z-40">
          <LiveWall shots={shots} onAgain={() => setShowWall(false)} />
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex flex-col bg-[#03040a] text-brand-fg ${embed ? 'h-[100dvh] p-2' : 'h-[100dvh] p-3 sm:p-5'}`}>
      <style>{ARRIVE_CSS}</style>
      {!embed && (
        <header className="mx-auto mb-3 flex w-full max-w-[1100px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 font-label text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-fg"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
          <Link to="/" className="inline-flex min-h-11 items-center font-label text-[13px] font-bold uppercase tracking-[0.3em] text-foil-static">Beamwall</Link>
        </header>
      )}
      {body}
    </div>
  );
}
