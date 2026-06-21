/**
 * Send-off animation — a premium, magical "your photo dissolves into gold dust
 * and beams up to the live wall" moment, then an elegant success screen.
 *
 * Photo path: the captured still is rendered through the `golden-disintegration`
 * WebGL shader (uFade 0→1, easeInOutCubic) on a canvas overlay that simultaneously
 * floats up + scales as a radial gold bloom blooms beneath it, so it reads as
 * "beaming up". A cinematic column of light with travelling sparks rises, and
 * gold motes drift upward as the dissolve finishes. Video (which can't use the
 * pixel dissolve) gets an equally premium beam + scale-up treatment.
 *
 * Then a smooth cross-fade into a refined success state: an animated SCAGO emblem,
 * a tasteful "Sent!" reveal, gentle ongoing sparkle and layered, classy gold confetti.
 *
 * Uses ShaderRunner/defaultParams from ../../lib/shaders, confetti from
 * canvas-confetti, motion/react, and <ScagoMark> for the success emblem.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { LayoutGrid, Film } from 'lucide-react';
import { ShaderRunner, defaultParams } from '../../lib/shaders';
import ScagoMark from '../ui/ScagoMark';

interface Props {
  dataUrl: string;
  mediaType?: 'image' | 'video';
  uploading: boolean;
  success: boolean;
  onTakeAnother: () => void;
}

const GOLD_COLORS = ['#D4AF37', '#E8C766', '#FBF3D9'];
const GOLD_DEEP = ['#B8860B', '#D4AF37', '#E8C766', '#FBF3D9'];
const DISSOLVE_MS = 2800;

/** Smooth in-out curve — slow start, accelerates through the middle, eases out. */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
/** Gentle accelerate-out used for the photo's beam-up float/scale. */
function easeInQuart(t: number) {
  return t * t * t * t;
}

/** A rising column of light with shimmer + sparks travelling upward. */
function GoldBeam({ play }: { play: boolean }) {
  // Deterministic spark layout so it doesn't reshuffle on re-render.
  const sparks = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        x: 50 + (Math.sin(i * 2.4) * 0.5 + (i % 3) - 1) * 26, // % across the beam
        size: 2 + (i % 4),
        delay: (i % 7) * 0.13,
        dur: 1.1 + (i % 5) * 0.22,
        drift: (Math.cos(i * 1.7) * 16), // px lateral wander
      })),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1/2 flex justify-center" aria-hidden>
      {/* Core column of light */}
      <motion.div
        initial={{ scaleY: 0, opacity: 0 }}
        animate={play ? { scaleY: [0, 1, 1, 0.92], opacity: [0, 0.95, 0.8, 0] } : {}}
        transition={{ duration: 2.2, times: [0, 0.25, 0.7, 1], ease: 'easeInOut' }}
        className="absolute bottom-0 h-[60vh] w-24 origin-bottom"
        style={{
          background:
            'linear-gradient(to top, rgba(251,243,217,0.0), rgba(212,175,55,0.55) 12%, rgba(232,199,102,0.28) 55%, rgba(212,175,55,0))',
          filter: 'blur(8px)',
          maskImage: 'linear-gradient(to top, transparent, #000 14%, #000 70%, transparent)',
          WebkitMaskImage: 'linear-gradient(to top, transparent, #000 14%, #000 70%, transparent)',
        }}
      />
      {/* Bright inner shimmer */}
      <motion.div
        initial={{ scaleY: 0, opacity: 0 }}
        animate={play ? { scaleY: [0, 1, 1, 0.9], opacity: [0, 0.9, 0.55, 0], x: [-3, 2, -2, 0] } : {}}
        transition={{ duration: 2.2, times: [0, 0.3, 0.7, 1], ease: 'easeInOut' }}
        className="absolute bottom-0 h-[58vh] w-2 origin-bottom rounded-full"
        style={{
          background: 'linear-gradient(to top, rgba(255,253,242,0.0), rgba(255,253,242,0.95) 30%, rgba(255,253,242,0))',
          filter: 'blur(1.5px)',
        }}
      />
      {/* Sparks travelling upward */}
      {play &&
        sparks.map((s) => (
          <motion.span
            key={s.id}
            className="absolute bottom-0 rounded-full"
            style={{
              left: `${s.x}%`,
              width: s.size,
              height: s.size,
              background: 'radial-gradient(circle, #FBF3D9 0%, #E8C766 45%, rgba(212,175,55,0) 75%)',
              boxShadow: '0 0 6px rgba(232,199,102,0.8)',
            }}
            initial={{ y: 0, x: 0, opacity: 0, scale: 0.4 }}
            animate={{ y: ['-2vh', '-58vh'], x: [0, s.drift], opacity: [0, 1, 1, 0], scale: [0.4, 1, 0.6] }}
            transition={{
              duration: s.dur,
              delay: 0.35 + s.delay,
              ease: 'easeOut',
              repeat: 1,
              repeatDelay: 0.2,
            }}
          />
        ))}
    </div>
  );
}

/** Gold motes that drift gently up after the dissolve — soft ambient afterglow. */
function GoldMotes({ play }: { play: boolean }) {
  const motes = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        x: (i * 53) % 100,
        size: 2 + ((i * 7) % 4),
        delay: (i % 9) * 0.22,
        dur: 3.2 + (i % 5) * 0.7,
        drift: ((i % 5) - 2) * 22,
      })),
    [],
  );
  if (!play) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {motes.map((m) => (
        <motion.span
          key={m.id}
          className="absolute rounded-full"
          style={{
            left: `${m.x}%`,
            bottom: '38%',
            width: m.size,
            height: m.size,
            background: 'radial-gradient(circle, #FBF3D9 0%, #E8C766 50%, rgba(212,175,55,0) 78%)',
            boxShadow: '0 0 8px rgba(232,199,102,0.6)',
          }}
          initial={{ y: 0, opacity: 0, scale: 0.5 }}
          animate={{ y: [0, -260], x: [0, m.drift], opacity: [0, 0.9, 0], scale: [0.5, 1, 0.7] }}
          transition={{ duration: m.dur, delay: m.delay, ease: 'easeOut', repeat: Infinity, repeatDelay: 1.4 }}
        />
      ))}
    </div>
  );
}

export default function SendOff({ dataUrl, mediaType = 'image', uploading, success, onTakeAnother }: Props) {
  const dissolveCanvasRef = useRef<HTMLCanvasElement>(null);
  const dissolveRunnerRef = useRef<ShaderRunner | null>(null);
  const rafRef = useRef<number>(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [dissolving, setDissolving] = useState(false);
  const [dissolveDone, setDissolveDone] = useState(false);
  /** 0→1 progress driving the JS-side photo float/scale + bloom (mirrors uFade). */
  const [progress, setProgress] = useState(0);

  const isVideo = mediaType === 'video';

  // Load source image for the photo dissolve.
  useEffect(() => {
    if (!uploading || isVideo) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setDissolving(true);
    };
    img.src = dataUrl;
  }, [uploading, dataUrl, isVideo]);

  // Run the golden-disintegration dissolve (photo only).
  useEffect(() => {
    if (!dissolving || !dissolveCanvasRef.current || !imgRef.current) return;
    const canvas = dissolveCanvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;

    const runner = new ShaderRunner(canvas.width, canvas.height);
    dissolveRunnerRef.current = runner;
    const startTs = performance.now();
    const params = { ...defaultParams('golden-disintegration'), uFade: 0, uIntensity: 1, uWarmth: 0.85 };

    const tick = () => {
      const elapsed = performance.now() - startTs;
      const linear = Math.min(elapsed / DISSOLVE_MS, 1);
      const fade = easeInOutCubic(linear);
      params.uFade = fade;
      setProgress(linear);

      const result = runner.draw(imgRef.current!, 'golden-disintegration', params);
      if (result) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(result, 0, 0, canvas.width, canvas.height);
        }
      }
      if (linear < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDissolveDone(true);
        runner.dispose();
        dissolveRunnerRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      runner.dispose();
      dissolveRunnerRef.current = null;
    };
  }, [dissolving]);

  // Layered, classy gold confetti on success.
  useEffect(() => {
    if (!success) return;
    const fire = (opts: confetti.Options) => confetti({ disableForReducedMotion: true, ...opts });

    // Opening shimmer: a wide, gentle fall of fine gold flakes.
    fire({
      particleCount: 70,
      spread: 100,
      startVelocity: 32,
      gravity: 0.85,
      scalar: 0.85,
      ticks: 260,
      origin: { y: 0.42 },
      colors: GOLD_DEEP,
    });

    const schedule = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms);
      timeoutsRef.current.push(id);
    };

    // Symmetric side bursts a beat later.
    schedule(420, () => {
      fire({ particleCount: 50, angle: 60, spread: 70, startVelocity: 45, origin: { x: 0, y: 0.55 }, colors: GOLD_COLORS });
      fire({ particleCount: 50, angle: 120, spread: 70, startVelocity: 45, origin: { x: 1, y: 0.55 }, colors: GOLD_COLORS });
    });

    // A final, slow drift of large flakes for a luxurious settle.
    schedule(950, () => {
      fire({ particleCount: 28, spread: 120, startVelocity: 20, gravity: 0.6, scalar: 1.25, ticks: 320, origin: { y: 0.3 }, colors: GOLD_DEEP });
    });

    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, [success]);

  // Clear any lingering timeouts on unmount.
  useEffect(() => () => timeoutsRef.current.forEach(clearTimeout), []);

  // Photo beam-up transform — float up + scale + slight perspective tilt.
  const beam = easeInQuart(progress);
  const photoStyle: React.CSSProperties = {
    transform: `translateY(${-beam * 64}px) scale(${1 + beam * 0.12})`,
    filter: `brightness(${1 + beam * 0.35})`,
  };
  // Radial gold bloom that blooms during dissolve and fades as it completes.
  const bloomOpacity = Math.sin(Math.min(progress, 1) * Math.PI) * 0.9;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-noir-900/95 vignette">
      <AnimatePresence mode="wait">
        {!success ? (
          <motion.div
            key="sending"
            exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } }}
            className="relative flex w-full flex-col items-center gap-6 px-10"
          >
            {/* Soft radial gold bloom behind the subject */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 h-[120vmin] w-[120vmin] -translate-x-1/2 -translate-y-[58%] rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(232,199,102,0.30) 0%, rgba(212,175,55,0.12) 30%, transparent 62%)',
                opacity: bloomOpacity,
              }}
            />

            {/* Cinematic rising beam of light */}
            <GoldBeam play={dissolving || isVideo} />
            {/* Ambient motes after the dissolve / during video beam-up */}
            <GoldMotes play={dissolveDone || isVideo} />

            {/* Subject (photo dissolve or video beam-up) */}
            <div className="relative aspect-[9/16] h-auto max-h-72 w-52">
              {isVideo ? (
                /* Video: premium beam + scale-up (no pixel dissolve available) */
                <motion.div
                  initial={{ scale: 1, opacity: 1, rotateX: 0, y: 0, filter: 'brightness(1)' }}
                  animate={{
                    scale: [1, 1.06, 0.04],
                    opacity: [1, 1, 0],
                    rotateX: [0, 6, 26],
                    y: [0, -10, -380],
                    filter: ['brightness(1)', 'brightness(1.4)', 'brightness(2.2)'],
                  }}
                  transition={{ duration: 2.2, times: [0, 0.35, 1], ease: [0.5, 0, 0.2, 1] }}
                  style={{ perspective: '900px', transformStyle: 'preserve-3d' }}
                  className="h-full w-full"
                >
                  <div className="glass-strong flex h-full w-full items-center justify-center rounded-2xl border border-gold-400/25 glow-gold">
                    <Film className="h-9 w-9 text-gold-300/70" />
                  </div>
                </motion.div>
              ) : (
                /* Photo: WebGL shader dissolve with beam-up float/scale */
                <>
                  {!dissolving && (
                    <motion.img
                      src={dataUrl}
                      alt=""
                      className="w-full rounded-2xl shadow-2xl"
                      style={{ border: '1px solid rgba(212,175,55,0.3)' }}
                    />
                  )}
                  <canvas
                    ref={dissolveCanvasRef}
                    className="absolute inset-0 h-full w-full rounded-2xl"
                    style={{
                      display: dissolving ? 'block' : 'none',
                      ...photoStyle,
                      willChange: 'transform, filter',
                    }}
                  />
                </>
              )}
            </div>

            <div className="space-y-1 text-center">
              <p className="font-serif text-xl italic text-champagne/70">
                {isVideo ? 'Beaming your video up…' : 'Sending to the wall…'}
              </p>
              <div className="flex justify-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-gold-400/70"
                    animate={{ opacity: [0.25, 1, 0.25], scale: [0.85, 1.1, 0.85] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          /* Success state */
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.94, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex flex-col items-center gap-8 px-8 text-center"
          >
            {/* Gentle ongoing ambient sparkle behind the emblem */}
            <GoldMotes play />

            {/* Animated SCAGO emblem in a glowing foil halo */}
            <motion.div
              initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ delay: 0.1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="relative flex h-28 w-28 items-center justify-center"
            >
              <div className="absolute inset-0 rounded-full bg-foil opacity-90 glow-gold animate-pulse-glow" />
              <div className="absolute inset-[3px] rounded-full bg-noir-900/90" />
              <ScagoMark size={66} variant="gold" animated title="SCAGO" className="relative" />
            </motion.div>

            <div className="space-y-3">
              {/* Tasteful staggered reveal of "Sent!" */}
              <motion.h2
                initial={{ opacity: 0, y: 14, letterSpacing: '0.4em' }}
                animate={{ opacity: 1, y: 0, letterSpacing: '0em' }}
                transition={{ delay: 0.35, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="font-serif text-4xl gold-foil"
              >
                Sent!
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.6 }}
                className="mx-auto max-w-xs font-sans text-sm leading-relaxed text-champagne/70"
              >
                Your {isVideo ? 'video' : 'photo'} is on its way to the live wall.
                Thank you for being part of the Hope Gala!
              </motion.p>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="flex w-full max-w-xs flex-col gap-3"
            >
              <button
                onClick={onTakeAnother}
                className="rounded-xl bg-foil px-6 py-4 font-label text-xs uppercase tracking-luxe text-noir-900 glow-gold transition-all hover:brightness-110 active:scale-95"
              >
                Take Another
              </button>
              <a
                href="/wall"
                className="glass flex items-center justify-center gap-2 rounded-xl px-6 py-4 font-label text-xs uppercase tracking-wide text-champagne/70 transition-colors hover:text-ivory"
              >
                <LayoutGrid className="h-4 w-4" />
                View the Live Wall
              </a>
              <a
                href="/me"
                className="glass flex items-center justify-center gap-2 rounded-xl px-6 py-4 font-label text-xs uppercase tracking-wide text-champagne/70 transition-colors hover:text-ivory"
              >
                <Film className="h-4 w-4" />
                My Media
              </a>
            </motion.div>

            {/* Footer lockup — SCAGO above the event name, never below */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9, duration: 0.6 }}
              className="flex flex-col items-center gap-0.5"
            >
              <p className="font-label text-[10px] uppercase tracking-luxe text-gold-300/60">SCAGO</p>
              <p className="font-label text-[9px] uppercase tracking-luxe text-champagne/30">Hope Gala &amp; Awards 2026</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
