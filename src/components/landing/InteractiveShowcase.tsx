/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InteractiveShowcase — the landing page's demo centerpiece. A two-column,
 * fully interactive AR demo: a copy column on the left, and on the right a
 * cinematic scene where a smartphone (running the REAL booth camera, via
 * ShowcasePhone) beams a captured shot across the frame onto a live wall.
 *
 * It supersedes DemoBooth (which stays for reference) by dramatising the
 * product's core loop — capture → beam → land on the wall — as a single
 * staged ceremony. A finite state machine drives it:
 *
 *   idle ── Open Camera ─▶ camera ── Beam it ─▶ beaming ── land ─▶ wall
 *     ▲                       │                                     │
 *     └──────── X close ──────┘                Capture again ───────┘
 *
 * The beam strike (light column + flying photo + arrival burst) reuses
 * DemoBooth's WAAPI choreography idiom, including its StrictMode-safe cleanup
 * (cancel only, never commit) and its reduced-motion policy: a user-initiated
 * beam plays even under prefers-reduced-motion, while ambient motion (phone
 * float, wall shimmer, HUD scan line, LIVE pulse) respects it.
 *
 * Layout is switched with Tailwind `lg:` utilities: two columns with an
 * absolutely-positioned overlapping scene on desktop; a single stacked column
 * (copy → phone → wall) with a downward beam on mobile.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import ShowcasePhone, { SPECTRUM } from './ShowcasePhone';
import { beamPath, centerOf, polaroidTilt, type Rect } from '../../lib/beamGeometry';

type AppState = 'idle' | 'camera' | 'beaming' | 'wall';

/** The live wall holds a 4×2 grid; captures beyond that shift the grid left. */
const TILE_COUNT = 8;
const MAX_WALL = 8;

/** A beam in flight: the shot travelling from the phone screen to a wall tile. */
interface Flight { shot: string; from: Rect; to: Rect; }
/** The freshest landing, kept through the 'wall' state to place the polaroid.
 *  x/y are the polaroid's centre in scene space, already clamped inside the
 *  wall grid (a raw tile centre lets the leftmost column's polaroid hang past
 *  the scene edge on phones, where Landing's overflow-x-clip cuts it off). */
interface Landing { shot: string; x: number; y: number; width: number; index: number; }

/* ── matchMedia hook: desktop drives the 3D tilt / absolute layout ────── */

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

/* ── BeamStrike — the showpiece light show (phone → wall tile) ─────────── */

/**
 * Renders the beam ceremony in a scene-spanning, pointer-events-none overlay:
 *  (a) a portal flash burst where the phone collapses,
 *  (b) an angled multicolor beam (blurred aura → saturated band → white-hot
 *      core) wiping from the phone to the tile,
 *  (c) the captured shot flying along that path, shrinking + energising,
 *  (d) an arrival burst (conic spectrum ring + seven hue sparks) at the tile.
 *
 * Pure Web-Animations choreography (~1.55s). `onLand` fires as the shot
 * touches down (the caller commits it to the wall + advances to 'wall');
 * `onFinished` fires once the burst has played and the overlay can unmount.
 * Cleanup ONLY cancels the animations — it must never call onLand, or
 * StrictMode's dev double-mount would double-commit the shot (DemoBooth idiom).
 * Plays regardless of prefers-reduced-motion because it is a direct response to
 * the user's tap; suppressing an explicitly requested animation reads as broken.
 */
function BeamStrike({
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
    const path = beamPath(from, to);
    const rot = path.angleDeg;
    const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const anims: Animation[] = [];

    // (c) The shot itself: energise, arc slightly, then dive into the tile.
    const clone = box.querySelector<HTMLElement>('[data-fx="clone"]');
    if (clone) {
      const midLeft = from.left + (to.left - from.left) * 0.28;
      const midTop = from.top + (to.top - from.top) * 0.28 - 14;
      const midW = from.width + (to.width - from.width) * 0.28;
      const midH = from.height + (to.height - from.height) * 0.28;
      anims.push(clone.animate(
        [
          { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: '1.4rem', filter: 'brightness(1.7) saturate(1.5)', opacity: 1 },
          { left: `${midLeft}px`, top: `${midTop}px`, width: `${midW}px`, height: `${midH}px`, borderRadius: '1rem', filter: 'brightness(2.1) saturate(1.7)', opacity: 1, offset: 0.28 },
          { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: '0.5rem', filter: 'brightness(2.4) saturate(1.85)', opacity: 0.95 },
        ],
        { duration: 900, delay: 180, easing: EASE, fill: 'both' },
      ));
    }

    // (b) The angled beam — aura, band and core wipe from phone → tile.
    for (const sel of ['aura', 'band', 'core']) {
      const el = box.querySelector<HTMLElement>(`[data-fx="${sel}"]`);
      if (!el) continue;
      anims.push(el.animate(
        [
          { transform: `rotate(${rot}deg) scaleX(0)`, opacity: 0 },
          { transform: `rotate(${rot}deg) scaleX(1)`, opacity: 1, offset: 0.4 },
          { transform: `rotate(${rot}deg) scaleX(1)`, opacity: 1, offset: 0.75 },
          { transform: `rotate(${rot}deg) scaleX(1)`, opacity: 0 },
        ],
        { duration: 950, delay: 120, easing: 'ease-out', fill: 'both' },
      ));
    }

    // (a) Portal flash burst where the phone collapses.
    const flash = box.querySelector<HTMLElement>('[data-fx="flash"]');
    if (flash) {
      anims.push(flash.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.95, offset: 0.3 },
          { transform: 'translate(-50%, -50%) scale(2)', opacity: 0 },
        ],
        { duration: 540, easing: 'ease-out', fill: 'both' },
      ));
    }

    // (d) Arrival: expanding conic spectrum ring + hue sparks at the tile.
    const ring = box.querySelector<HTMLElement>('[data-fx="ring"]');
    if (ring) {
      anims.push(ring.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0.95 },
          { transform: 'translate(-50%, -50%) scale(1.45)', opacity: 0 },
        ],
        { duration: 520, delay: 920, easing: 'ease-out', fill: 'both' },
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
        { duration: 560, delay: 940 + i * 24, easing: 'ease-out', fill: 'both' },
      ));
    });

    // The shot materialises on the wall as the clone touches down (onLand),
    // then the overlay lingers while the arrival burst plays over the settled
    // tile. Cleanup only cancels — it must never fire onLand/onFinished.
    const landTimer = window.setTimeout(() => landRef.current(), 1000);
    const finishTimer = window.setTimeout(() => finishRef.current(), 1560);
    return () => {
      window.clearTimeout(landTimer);
      window.clearTimeout(finishTimer);
      anims.forEach((a) => a.cancel());
    };
  }, [flight]);

  const { from, to } = flight;
  const path = beamPath(from, to);
  const toCx = to.left + to.width / 2;
  const toCy = to.top + to.height / 2;
  const AURA_H = 40;
  const BAND_H = 12;
  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-50" aria-hidden>
      <img
        data-fx="clone"
        src={flight.shot}
        alt=""
        className="absolute object-cover"
        style={{ left: from.left, top: from.top, width: from.width, height: from.height, borderRadius: '1.4rem' }}
      />
      <span
        data-fx="aura"
        className="absolute"
        style={{
          left: path.x, top: path.y - AURA_H / 2, width: path.length, height: AURA_H,
          transformOrigin: 'left center', transform: `rotate(${path.angleDeg}deg)`,
          background: `linear-gradient(90deg, ${SPECTRUM[0]}22, ${SPECTRUM[1]}AA 30%, ${SPECTRUM[5]}CC 70%, ${SPECTRUM[4]}EE)`,
          filter: 'blur(14px)', opacity: 0,
        }}
      />
      <span
        data-fx="band"
        className="absolute"
        style={{
          left: path.x, top: path.y - BAND_H / 2, width: path.length, height: BAND_H,
          transformOrigin: 'left center', transform: `rotate(${path.angleDeg}deg)`,
          background: `linear-gradient(90deg, ${SPECTRUM[0]}, ${SPECTRUM[2]}, ${SPECTRUM[4]}, ${SPECTRUM[6]})`,
          filter: 'blur(3px)', opacity: 0,
        }}
      />
      <span
        data-fx="core"
        className="absolute"
        style={{
          left: path.x, top: path.y - 1.5, width: path.length, height: 3,
          transformOrigin: 'left center', transform: `rotate(${path.angleDeg}deg)`,
          background: 'linear-gradient(90deg, rgba(238,243,255,0.4), rgba(255,255,255,0.98))',
          boxShadow: '0 0 14px 3px rgba(238,243,255,0.7)', opacity: 0,
        }}
      />
      <span
        data-fx="flash"
        className="absolute rounded-full"
        style={{
          left: path.x, top: path.y, width: 130, height: 130,
          transform: 'translate(-50%, -50%) scale(0.3)',
          background: `radial-gradient(circle, rgba(255,255,255,0.95), ${SPECTRUM[0]}88 40%, transparent 70%)`,
          opacity: 0,
        }}
      />
      <span
        data-fx="ring"
        className="absolute rounded-full"
        style={{
          left: toCx, top: toCy, width: to.width * 2.0, height: to.width * 2.0,
          background: `conic-gradient(${SPECTRUM.join(',')}, ${SPECTRUM[0]})`,
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
          transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0,
        }}
      />
      {SPECTRUM.map((hue) => (
        <span
          key={hue}
          data-fx="spark"
          className="absolute h-1.5 w-1.5 rounded-full"
          style={{ left: toCx, top: toCy, background: hue, boxShadow: `0 0 8px 2px ${hue}`, transform: 'translate(-50%, -50%)', opacity: 0 }}
        />
      ))}
    </div>
  );
}

/* ── LiveWall — the cinematic glass wall the shots beam onto ───────────── */

/** Pulsing "LIVE" dot — ambient, so it stills under prefers-reduced-motion. */
function LiveDot({ reduced }: { reduced: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {!reduced && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: SPECTRUM[2] }}
          animate={{ scale: [1, 2.2, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <span className="relative h-2 w-2 rounded-full" style={{ background: SPECTRUM[2], boxShadow: `0 0 8px ${SPECTRUM[2]}` }} />
    </span>
  );
}

function LiveWall({
  shots, gridRef, reduced,
}: {
  shots: string[];
  gridRef: React.Ref<HTMLDivElement>;
  reduced: boolean;
}) {
  // Freshly landed tiles flash hot then settle — the BeamStrike clone already
  // did the travel, so arrival is a settling flare, not a drop (DemoBooth).
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

  return (
    <div className="relative">
      {/* Inline beam-dark surface (not .glass-strong: legacy gold tint, and
          backdrop-filter under an animated 3D transform is a Safari hazard). */}
      <div
        className="relative rounded-3xl p-4 sm:p-5"
        style={{
          border: '1px solid rgba(91,140,255,0.28)',
          background: 'linear-gradient(160deg, rgba(13,16,28,0.92), rgba(5,6,11,0.96))',
        }}
      >
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LiveDot reduced={reduced} />
            <span className="font-label text-[10px] uppercase tracking-luxe text-brand-fg">Beamwall · Live wall</span>
          </div>
          <span className="font-label text-[10px] uppercase tracking-luxe text-brand-muted/55">
            {shots.length} photo{shots.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* 4×2 grid — filled tiles show past shots, empties shimmer. */}
        <div ref={gridRef} className="grid grid-cols-4 gap-2 sm:gap-2.5">
          {Array.from({ length: TILE_COUNT }, (_, i) => {
            const img = shots[i];
            return img !== undefined ? (
              <div
                key={`${i}-${img.length}`}
                ref={beamTileIn}
                className="aspect-[9/16] overflow-hidden rounded-lg"
                style={{ border: '1px solid rgba(91,140,255,0.5)', boxShadow: '0 0 18px -4px rgba(91,140,255,0.55)' }}
              >
                <img src={img} alt="" aria-hidden className="h-full w-full object-cover" />
              </div>
            ) : (
              <div
                key={`empty-${i}`}
                className="aspect-[9/16] overflow-hidden rounded-lg border border-dashed border-white/12 bg-white/[0.02]"
              >
                {!reduced && (
                  <div
                    className="h-full w-full animate-pulse"
                    style={{ background: 'linear-gradient(135deg, rgba(91,140,255,0.06), transparent 60%)' }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Floor reflection — a softened, flipped glow beneath the wall. */}
      <div
        aria-hidden
        className="pointer-events-none mx-auto mt-1 h-16 w-[86%] blur-[2px]"
        style={{
          transform: 'scaleY(-1)',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent 78%)',
          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent 78%)',
          background: 'linear-gradient(to bottom, rgba(91,140,255,0.16), rgba(34,211,238,0.10) 40%, transparent 75%)',
        }}
      />
    </div>
  );
}

/* ── The 3-step how-it-works list, hued from the spectrum ─────────────── */

const STEPS: { n: number; hue: string; title: string; body: string }[] = [
  { n: 1, hue: SPECTRUM[0], title: 'Activate the camera', body: 'One tap — it runs right in your browser, on your device.' },
  { n: 2, hue: SPECTRUM[2], title: 'Frame your shot', body: 'Pick a frame, an effect and a 3D prop, then hit the shutter.' },
  { n: 3, hue: SPECTRUM[4], title: 'Watch the live wall', body: 'Beam it up and watch it land, in real time, on the wall.' },
];

/* ── Component ────────────────────────────────────────────────────────── */

export default function InteractiveShowcase() {
  const reduced = useReducedMotion() ?? false;
  const isDesktop = useIsDesktop();

  const [appState, setAppState] = useState<AppState>('idle');
  const [wallShots, setWallShots] = useState<string[]>([]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);

  const sceneRef = useRef<HTMLDivElement>(null);
  const phoneScreenRef = useRef<HTMLDivElement>(null);
  const wallGridRef = useRef<HTMLDivElement>(null);
  // Latest flight, read by the (ref-stored) land handler without a stale closure.
  const flightRef = useRef<Flight | null>(flight);
  flightRef.current = flight;
  // Monotonic capture counter → a stable, ever-varying polaroid tilt seed.
  const captureCountRef = useRef(0);

  const commitShot = useCallback((img: string) => {
    setWallShots((prev) => [...prev, img].slice(-MAX_WALL));
  }, []);

  const openCamera = useCallback(() => setAppState('camera'), []);
  const closeCamera = useCallback(() => setAppState('idle'), []);
  const captureAgain = useCallback(() => setAppState('camera'), []);

  /** Measure phone-screen → target-tile rects in scene space and start the
   *  beam; on measurement failure, commit directly (DemoBooth fallback). */
  const handleBeam = useCallback((shot: string) => {
    const scene = sceneRef.current;
    const screen = phoneScreenRef.current;
    const grid = wallGridRef.current;
    // Ensure the wall is on-screen before measuring (mobile: it sits below the
    // phone); instant + nearest = minimal jump, matching the settled layout.
    grid?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    const slot = Math.min(wallShots.length, TILE_COUNT - 1);
    const tile = grid?.children[slot] as HTMLElement | undefined;
    if (!scene || !screen || !tile) {
      commitShot(shot);
      setLanding(null);
      setAppState('wall');
      return;
    }
    const sceneBox = scene.getBoundingClientRect();
    const rel = (r: DOMRect): Rect => ({
      left: r.left - sceneBox.left, top: r.top - sceneBox.top, width: r.width, height: r.height,
    });
    setFlight({ shot, from: rel(screen.getBoundingClientRect()), to: rel(tile.getBoundingClientRect()) });
    setAppState('beaming');
  }, [wallShots.length, commitShot]);

  const handleLand = useCallback(() => {
    const f = flightRef.current;
    if (f === null) return;
    commitShot(f.shot);
    const index = captureCountRef.current;
    captureCountRef.current += 1;
    // Clamp the polaroid's centre so its whole card stays inside the wall
    // grid (small slack for the tilt): keeps it out of the header row and,
    // on phones, away from the clipped scene edges. The wall still has its
    // BACK geometry here (the forward spring starts on 'wall'), so these
    // rects match the ones the flight was measured against.
    const width = Math.max(96, f.to.width * 1.32);
    let { x, y } = centerOf(f.to);
    const scene = sceneRef.current;
    const grid = wallGridRef.current;
    if (scene !== null && grid !== null) {
      const sb = scene.getBoundingClientRect();
      const gb = grid.getBoundingClientRect();
      const g: Rect = { left: gb.left - sb.left, top: gb.top - sb.top, width: gb.width, height: gb.height };
      const halfW = width / 2 + 6;
      const height = width * (16 / 9) + width * 0.28; // photo + caption strip
      x = Math.min(Math.max(x, g.left + halfW), g.left + g.width - halfW);
      y = Math.min(Math.max(y, g.top + height / 2 - 8), g.top + g.height - height / 2 + 16);
    }
    setLanding({ shot: f.shot, x, y, width, index });
    setAppState('wall');
  }, [commitShot]);

  const handleFinished = useCallback(() => setFlight(null), []);

  // Mobile: the collapsed phone leaves the viewport staring at empty space
  // and the wall below the fold — follow the shot down to its landing. The
  // scroll is part of the user-initiated ceremony, so it plays smooth unless
  // motion is reduced. Desktop never scrolls (the wall is already in view).
  useEffect(() => {
    if (appState !== 'wall' || isDesktop) return;
    wallGridRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }, [appState, isDesktop, reduced]);

  /* Variants — 3D tilt/float only on desktop; float stilled under reduced. */
  const phoneVariants: Variants = {
    idle: {
      rotateX: isDesktop ? 4 : 0,
      rotateY: isDesktop ? -12 : 0,
      scaleX: 1, scaleY: 1, opacity: 1,
      y: reduced || !isDesktop ? 0 : [0, -12, 0],
      transition: {
        y: reduced || !isDesktop ? undefined : { duration: 6, repeat: Infinity, ease: 'easeInOut' },
        default: { type: 'spring', stiffness: 140, damping: 18 },
      },
    },
    camera: {
      rotateX: 0, rotateY: 0, scaleX: 1.05, scaleY: 1.05, y: 0, opacity: 1,
      transition: { type: 'spring', stiffness: 170, damping: 20 },
    },
    beaming: {
      rotateX: 45, rotateY: 0, scaleX: 0.05, scaleY: 0.5, y: -100, opacity: 0,
      transition: { duration: 0.55, ease: 'easeIn' },
    },
    wall: {
      rotateX: 0, rotateY: 0, scaleX: 0.05, scaleY: 0.5, y: -100, opacity: 0,
      transition: { duration: 0.2 },
    },
  };

  const wallVariants: Variants = {
    back: {
      rotateY: isDesktop ? 10 : 0, scale: 1, z: 0, opacity: 0.82, filter: 'brightness(0.82)',
      boxShadow: '0 0px 0px -10px rgba(91,140,255,0), 0 30px 90px -40px rgba(0,0,0,0.9)',
      transition: { type: 'spring', stiffness: 120, damping: 18 },
    },
    // Anticipation while the beam is in flight: the wall lights up but keeps
    // its BACK geometry — any scale/rotate here would move the target tile
    // away from the rect the flight was measured against.
    charged: {
      rotateY: isDesktop ? 10 : 0, scale: 1, z: 0, opacity: 1, filter: 'brightness(1.04)',
      boxShadow: `0 0 54px -12px ${SPECTRUM[1]}55, 0 30px 90px -40px rgba(0,0,0,0.9)`,
      transition: { duration: 0.6, ease: 'easeOut' },
    },
    forward: {
      rotateY: isDesktop ? 2 : 0, scale: isDesktop ? 1.07 : 1.03, z: isDesktop ? 60 : 0, opacity: 1, filter: 'brightness(1)',
      boxShadow: `0 0 70px -10px ${SPECTRUM[0]}66, 0 40px 110px -40px rgba(0,0,0,0.9)`,
      transition: { type: 'spring', stiffness: 140, damping: 16 },
    },
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
      {/* ── Left column: copy ─────────────────────────────────────────── */}
      <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
        <motion.span
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="mb-5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 font-label text-[9px] uppercase tracking-luxe text-brand-muted/70"
        >
          Live demo — no sign-up
        </motion.span>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="font-serif text-4xl leading-tight text-brand-fg sm:text-5xl"
        >
          Try it out. <span className="text-foil-static">Right here.</span>
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mt-4 max-w-md text-sm leading-relaxed text-brand-muted/75"
        >
          Activate the camera, take a shot, and watch it beam onto the live wall — the exact loop
          your guests get at the event. It all runs in your browser; nothing leaves your device.
        </motion.p>

        <ol className="mt-8 flex w-full max-w-md flex-col gap-4">
          {STEPS.map((step, i) => (
            <motion.li
              key={step.n}
              initial={{ opacity: 0, x: -14 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.5, delay: 0.15 + i * 0.08 }}
              className="flex items-start gap-3.5"
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-label text-[13px] font-semibold"
                style={{ border: `1.5px solid ${step.hue}`, color: step.hue, boxShadow: `0 0 16px -6px ${step.hue}` }}
              >
                {step.n}
              </span>
              <div className="pt-0.5">
                <p className="font-label text-[12px] uppercase tracking-wide text-brand-fg">{step.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-brand-muted/60">{step.body}</p>
              </div>
            </motion.li>
          ))}
        </ol>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-9"
        >
          {appState === 'idle' && (
            <button
              type="button"
              onClick={openCamera}
              className="bg-foil rounded-full px-8 py-3.5 font-label text-[11px] font-bold uppercase tracking-luxe text-white glow-accent transition active:scale-[0.98]"
            >
              Open Camera
            </button>
          )}
          {appState === 'camera' && (
            <p className="flex items-center justify-center gap-2 font-label text-[11px] uppercase tracking-luxe text-brand-fg lg:justify-start">
              <LiveDot reduced={reduced} />
              Camera is live — take your shot
            </p>
          )}
          {appState === 'beaming' && (
            <p className="font-label text-[11px] uppercase tracking-luxe text-brand-muted/70">
              Beaming to the wall…
            </p>
          )}
          {appState === 'wall' && (
            <p className="flex items-center justify-center gap-2 font-label text-[11px] uppercase tracking-luxe text-brand-fg lg:justify-start">
              <LiveDot reduced={reduced} />
              Landed — it&apos;s on the wall
            </p>
          )}
        </motion.div>
      </div>

      {/* ── Right column: the scene ───────────────────────────────────── */}
      {/* Each 3D element gets its OWN perspective wrapper (no shared
          preserve-3d context): inside one 3D rendering context the browser
          depth-sorts by translateZ and ignores z-index, so the tilted wall
          plane could slice in front of the phone — and Safari flattens
          preserve-3d under overflow/filter children anyway. Separate
          vanishing points are imperceptible at these tilt angles. */}
      <div
        ref={sceneRef}
        className="relative flex w-full flex-col items-center gap-8 lg:block lg:h-[min(680px,72vh)] lg:gap-0"
      >
        {/* Phone — right/front on desktop, top on mobile. */}
        <div
          className="relative z-30 flex w-full justify-center lg:absolute lg:inset-y-0 lg:right-[1%] lg:w-[clamp(220px,24vw,270px)] lg:items-center lg:justify-end"
          style={{ perspective: '1200px' }}
        >
          <motion.div
            className="w-full max-w-[290px] lg:max-w-none"
            variants={phoneVariants}
            animate={appState}
            initial={false}
          >
            <ShowcasePhone
              appState={appState}
              screenRef={phoneScreenRef}
              onOpenCamera={openCamera}
              onClose={closeCamera}
              onBeam={handleBeam}
            />
          </motion.div>
        </div>

        {/* Live wall — left/back on desktop, below the phone on mobile. */}
        <div
          className="relative z-10 w-full lg:absolute lg:inset-y-0 lg:left-0 lg:flex lg:w-[76%] lg:items-center"
          style={{ perspective: '1200px' }}
        >
          <motion.div
            className="w-full"
            variants={wallVariants}
            animate={appState === 'wall' ? 'forward' : appState === 'beaming' ? 'charged' : 'back'}
            initial={false}
          >
            <LiveWall shots={wallShots} gridRef={wallGridRef} reduced={reduced} />
          </motion.div>
        </div>

        {/* Featured polaroid — the fresh shot drops onto the wall. */}
        {appState === 'wall' && landing !== null && (
          <div
            className="pointer-events-none absolute z-40"
            style={{ left: landing.x, top: landing.y }}
          >
            <div style={{ transform: 'translate(-50%, -50%)' }}>
              <motion.div
                className="bg-white p-1.5 pb-5 shadow-2xl"
                style={{ width: landing.width, borderRadius: 5, boxShadow: `0 0 44px -10px ${SPECTRUM[0]}88, 0 20px 50px -20px rgba(0,0,0,0.7)` }}
                initial={{ y: -160, rotate: -9, opacity: 0 }}
                animate={{ y: 0, rotate: polaroidTilt(landing.index), opacity: 1 }}
                transition={{ type: 'spring', stiffness: 230, damping: 19 }}
              >
                <img src={landing.shot} alt="" aria-hidden className="aspect-[9/16] w-full rounded-[2px] object-cover" />
                <p className="mt-1.5 text-center font-label text-[8px] uppercase tracking-luxe text-void-900/70">New memory</p>
              </motion.div>
            </div>
          </div>
        )}

        {/* "Capture again" fades in at the bottom of the scene (PRD): in-flow
            under the wall on mobile, floated bottom-centre on desktop. */}
        {appState === 'wall' && (
          <div className="relative z-40 flex w-full justify-center lg:absolute lg:inset-x-0 lg:-bottom-2">
            <motion.button
              type="button"
              onClick={captureAgain}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.4 }}
              className="rounded-full border border-white/15 bg-white/[0.05] px-8 py-3.5 font-label text-[11px] font-bold uppercase tracking-luxe text-brand-fg backdrop-blur-sm transition hover:bg-white/[0.09] active:scale-[0.98]"
            >
              Capture again
            </motion.button>
          </div>
        )}

        {/* The beam ceremony overlay. */}
        {flight !== null && (
          <BeamStrike flight={flight} onLand={handleLand} onFinished={handleFinished} />
        )}
      </div>
    </div>
  );
}
