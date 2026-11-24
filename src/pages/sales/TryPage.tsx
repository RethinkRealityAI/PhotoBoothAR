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
 *
 * Brand v2 (2026-11-24): the periwinkle field (`app-bg`) and liquid glass
 * instead of the old near-black page, the wall in the site's `.bw-wall`
 * glass, sentence-case labels (no wide-tracked caps), white pill actions.
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
const DISPLAY = 'font-[family-name:var(--bw-font-display)] tracking-[-0.022em]';
/** The booth's well before the camera starts: frosted indigo glass. */
const WELL = 'bg-[rgba(36,32,120,0.42)] backdrop-blur-xl shadow-[inset_1px_1px_0_rgba(255,255,255,0.55),inset_-1px_-1px_0_rgba(255,255,255,0.10),inset_0_0_0_1px_rgba(255,255,255,0.14),0_30px_60px_-30px_rgba(22,18,78,0.7)]';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

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
      className="bw-wall relative flex h-full min-h-0 flex-col overflow-hidden !rounded-[22px] !p-3"
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="flex items-center gap-2 text-[13px] font-medium text-white">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--bw-danger)] opacity-70 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--bw-danger)]" />
          </span>
          Live wall
        </p>
        <p className="text-[12px] text-white/80">{shots.length === 0 ? 'Waiting for you' : `${shots.length} from you`}</p>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-3 gap-2">
        {tiles.map((t, i) => (
          <div
            key={`${t.key}-${i}`}
            className={`bw-tile ${t.mine && i === 0 ? 'try-arrive' : ''}`}
            style={t.mine ? { boxShadow: '0 0 0 2px #FFFFFF, 0 0 28px -2px rgba(212,214,255,0.95)' } : undefined}
          >
            {t.src !== '' && <img src={t.src} alt={t.mine ? 'Your photo on the wall' : ''} className="h-full w-full object-cover" draggable={false} />}
            {t.mine && (
              <span className="absolute bottom-1 left-1 z-10 rounded-full bg-[rgba(26,23,64,0.72)] px-2 py-0.5 text-[11px] font-semibold text-white">
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
          className={`mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-foil px-5 text-[15px] font-semibold active:scale-[0.98] ${FOCUS}`}
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
            className="h-36 w-[81px] rounded-xl object-cover shadow-[0_20px_40px_-18px_rgba(22,18,78,0.85)] ring-1 ring-white/30"
            style={{ transform: `rotate(${(i - 1) * 7}deg) translateY(${i === 1 ? -8 : 0}px)` }}
          />
        ))}
      </div>
      <div>
        <p className="text-[14px] font-medium text-white/[0.86]">Try it yourself</p>
        <h1 className={`mt-1.5 text-[30px] font-[720] leading-tight text-white ${DISPLAY}`}>The {kit.label.toLowerCase()} booth</h1>
        <p className="mx-auto mt-2 max-w-[30ch] text-[15px] leading-snug text-white/[0.86]">{kit.blurb}</p>
      </div>
      <button
        type="button"
        onClick={() => setStarted(true)}
        className={`inline-flex min-h-12 items-center gap-2 rounded-full bg-foil px-7 text-[16px] font-semibold active:scale-[0.98] ${FOCUS}`}
      >
        <Camera className="h-5 w-5" aria-hidden /> Start the camera
      </button>
      <p className="max-w-[32ch] text-balance text-[13px] leading-snug text-white/80">
        <Lock className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px align-middle" aria-hidden />Your photos stay on this device. Nothing is uploaded.
      </p>
    </div>
  );

  const booth = (
    <div className={`relative h-full w-full overflow-hidden rounded-[22px] ${started ? 'bg-[#1A1740]' : WELL}`}>
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
    <div className={`app-bg flex flex-col text-white [font-family:var(--bw-font-text)] ${embed ? 'h-[100dvh] p-2' : 'h-[100dvh] p-3 sm:p-5'}`}>
      <style>{ARRIVE_CSS}</style>
      {!embed && (
        <header className="mx-auto mb-3 flex w-full max-w-[1100px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-white/70 bg-[rgba(26,23,64,0.12)] px-4 text-[14px] font-semibold text-white hover:border-white ${FOCUS}`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
          <Link to="/" className={`inline-flex min-h-11 items-center rounded text-[22px] font-[750] leading-none tracking-[-0.035em] text-white ${FOCUS} font-[family-name:var(--bw-font-display)]`}>Beamwall</Link>
        </header>
      )}
      {body}
    </div>
  );
}
