/**
 * Booth entrance. Gates the camera start behind a tap (more reliable on iOS,
 * and a more magical arrival than jumping straight to a permission prompt).
 *
 * The hero sits inside an ornate card with an animated accent sheen border that
 * slowly sweeps light around the frame — a premium, magical first impression.
 */
import { useEffect, useMemo, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Camera, Images } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Emblem, Wordmark } from '../ui/EventLogo';
import GoldFrameCard from '../ui/GoldFrameCard';
import { MediaStackIcon } from '../ui/MediaIcons';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';
import { resolveScene } from '../../lib/sceneThemes';
import SceneBackdrop from '../theme/SceneBackdrop';
import LiveWallField from '../theme/LiveWallField';
import { WALL_FIELD_SAMPLES } from '../theme/samplePhotos';
import BoothViewfinder from '../theme/BoothViewfinder';
import PageBorder from '../theme/PageBorder';
import { useBoothScreen } from '../theme/useBoothShot';
import EventBackground from '../ui/EventBackground';
import PostImage from '../ui/PostImage';
import { recentWallPhotos, wallFieldPhotos } from '../../lib/scenePage';

/** Platform legal routes (/privacy, /terms) only exist in runtime multi-tenant
 *  builds — legacy single-event builds (VITE_EVENT set) keep their microcopy
 *  byte-identical and never link to a route that would redirect to "/". */
const IS_LEGACY_BUILD = (((import.meta.env.VITE_EVENT as string | undefined) ?? '')).trim() !== '';

/** Platform events get the scene-dressed splash; coded legacy events keep
 *  the gold-framed card below exactly as it shipped. */
export default function Welcome(props: { onStart: () => void }) {
  const { source } = useEvent();
  return source === 'db' ? <SceneWelcome {...props} /> : <LegacyWelcome {...props} />;
}

/**
 * The booth's front door on a platform event: ONE full-bleed composition,
 * never a card inside the booth's dark camera box. It paints its own
 * opaque backdrop (the host's scene, or the event's background) with the
 * event's living photo wall over it, framed by the host's page border or,
 * when none is set, a glow rim with corner brackets. The booth preview's
 * shutter is the "Step inside" button. Everything follows the Event page
 * look from Branding; there are no splash-only settings.
 */
function SceneWelcome({ onStart }: { onStart: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const { basePath, config } = useEvent();
  const eventName = useStore((s) => s.copy.eventName);
  const posts = useStore((s) => s.posts);
  const postsLoaded = useStore((s) => s.postsLoaded);
  const fetchPosts = useStore((s) => s.fetchPosts);
  useEffect(() => {
    if (!postsLoaded) void fetchPosts();
  }, [postsLoaded, fetchPosts]);
  const scene = config.scene ? resolveScene(config.scene) : null;
  const tone = scene?.tone ?? 'dark';
  const vars = { '--sc-accent': scene?.accent ?? 'var(--color-accent)' } as CSSProperties;
  const wallPhotos = useMemo(() => wallFieldPhotos(posts), [posts]);
  // Until the first photo lands the wall shows stand-ins, never bare glass.
  const fieldPhotos = wallPhotos.length > 0 ? wallPhotos : WALL_FIELD_SAMPLES;
  const latest = useMemo(() => recentWallPhotos(posts, 4), [posts]);
  // The event's frame on a stand-in guest, never a wall photo.
  const screen = useBoothScreen();
  const moments = posts.length;
  const at = (delay: number) =>
    reduced ? { delay: 0, duration: 0.2 } : { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] as const };
  return (
    <motion.div
      data-scene-ui={tone}
      style={vars}
      className="absolute inset-0 z-40 overflow-hidden bg-noir-900"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Opaque and full-bleed, so the booth's stage box never shows through. */}
      {scene ? <SceneBackdrop scene={scene} /> : <EventBackground density={44} sparkle={0.7} />}
      <LiveWallField photos={fieldPhotos} fresh={NO_FRESH} />
      {config.scene?.border ? <PageBorder border={config.scene.border} /> : <SplashFrame />}

      <div className="relative z-40 h-full overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center gap-x-14 gap-y-5 px-7 pt-safe-top pb-safe-bottom [--safe-top:2rem] [--safe-bottom:1.75rem] sm:px-12 lg:flex-row">
          {/* ── The name and the room's pulse ── */}
          <div className="flex min-w-0 flex-col items-center text-center lg:flex-1 lg:items-start lg:text-left">
            <motion.div className="flex items-center gap-2.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={at(0.04)}>
              <Emblem size={30} className="shrink-0" />
              <span className="font-sans text-[13px] font-medium sc-faint">Photo booth</span>
            </motion.div>
            <motion.h1
              className="sc-display mt-3 max-w-[13ch] break-words text-[clamp(38px,10vw,84px)] font-semibold leading-[0.98] sc-ink"
              initial={{ opacity: 0, y: reduced ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={at(0.1)}
            >
              {eventName}
            </motion.h1>
            <motion.p
              className="sc-chip relative mt-4 inline-flex min-h-10 items-center gap-2.5 rounded-full px-4 font-sans text-[14px] font-semibold"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={at(0.16)}
            >
              <span className="sc-rim" aria-hidden><span /></span>
              <span aria-hidden className="sc-live-dot h-2.5 w-2.5 rounded-full" style={{ background: 'var(--sc-accent)', boxShadow: '0 0 12px var(--sc-accent)' }} />
              {moments > 0 ? `${moments} ${moments === 1 ? 'moment' : 'moments'} on the wall` : 'Be the first on the wall'}
            </motion.p>

            {latest.length > 0 && (
              <motion.ul
                aria-label="Latest photos on the wall"
                className="mt-5 hidden gap-2 lg:flex"
                initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={at(0.22)}
              >
                {latest.map((p) => (
                  <li key={p.id} className="sc-glass relative w-[58px] overflow-hidden rounded-[12px] p-[3px]">
                    <PostImage src={p.image_url} alt="" displayWidth={58} className="aspect-[9/16] w-full rounded-[9px] object-cover" />
                  </li>
                ))}
              </motion.ul>
            )}

            <motion.div className="mt-5 hidden items-center gap-2 lg:flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={at(0.28)}>
              <SplashLinks basePath={basePath} />
            </motion.div>
            <motion.div className="mt-4 hidden lg:block" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={at(0.32)}>
              <PrivacyLine />
            </motion.div>
          </div>

          {/* ── The booth itself: its shutter is the way in ── */}
          <motion.div
            className="flex shrink-0 flex-col items-center"
            initial={{ opacity: 0, y: reduced ? 0 : 14, scale: reduced ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={at(0.14)}
          >
            <BoothViewfinder
              to=""
              onShutter={onStart}
              shutterLabel="Step inside"
              frameUrl={screen.frame}
              previewUrl={screen.photo}
              widthClass="w-[min(58vw,calc(44svh*0.5625),300px)] lg:w-[min(24vw,calc(62vh*0.5625),330px)]"
            />
          </motion.div>

          {/* Phones: the latest row, the ways out and the promise sit under the booth. */}
          <motion.div className="flex flex-col items-center lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={at(0.26)}>
            {latest.length > 0 && (
              <ul aria-label="Latest photos on the wall" className="flex gap-1.5">
                {latest.map((p) => (
                  <li key={p.id} className="sc-glass relative w-[40px] overflow-hidden rounded-[9px] p-[2px]">
                    <PostImage src={p.image_url} alt="" displayWidth={40} className="aspect-[9/16] w-full rounded-[7px] object-cover" />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center justify-center gap-1">
              <SplashLinks basePath={basePath} />
            </div>
            <div className="mt-1 text-center">
              <PrivacyLine />
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

const NO_FRESH: ReadonlySet<string> = new Set();

/** The splash's own frame when the host set no page border: a glow rim
 *  that travels round the screen, plus camera-style corner brackets. */
function SplashFrame() {
  return (
    <>
      <PageBorder border="glow" />
      <div aria-hidden className="splash-corners pointer-events-none fixed inset-0 z-30">
        <span /><span /><span /><span />
      </div>
    </>
  );
}

/** Ways out before the camera, so this gate is never a dead end. */
function SplashLinks({ basePath }: { basePath: string }) {
  return (
    <>
      <Link
        to={`${basePath}/wall`}
        className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-sans text-[13px] font-medium sc-muted hover:underline"
      >
        <Images className="h-4 w-4" aria-hidden />
        See the live wall
      </Link>
      <Link
        to={`${basePath}/me`}
        className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-sans text-[13px] font-medium sc-muted hover:underline"
      >
        <MediaStackIcon size={16} />
        My photos
      </Link>
    </>
  );
}

/** The pre-camera disclosure — same promise as the original card, plus where a
 *  sent photo goes. Platform events only (this splash is the `source === 'db'`
 *  one): a sent photo plays on the projector wall AND in the public post-event
 *  album at /r/<slug>, which anyone holding the link can open — guests should
 *  hear that before their first shot, not discover it afterwards. Also shown
 *  by the welcome page beside its booth CTA, which skips this splash. */
export function PrivacyLine() {
  return (
    <p className="max-w-[40ch] font-sans text-[12px] leading-relaxed sc-faint">
      The camera runs on your device. Your photo only leaves it when you send it to the wall.
      {!IS_LEGACY_BUILD && (
        <>
          {' '}Photos you send show on the event’s big screen and in its online album, which anyone with the link can view.
          {' '}By continuing you agree to our{' '}
          <Link to="/privacy" className="underline underline-offset-2 sc-muted">
            privacy policy
          </Link>
          .
        </>
      )}
    </p>
  );
}

function LegacyWelcome({ onStart }: { onStart: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const { basePath } = useEvent();
  /* The staged reveal used to span ~1.85s, which read as an empty dark frame
     while it played. It now completes in ~0.7s (and is instant under
     prefers-reduced-motion), so the card never lingers half-built. */
  const at = (delay: number) =>
    reduced
      ? { delay: 0, duration: 0.2 }
      : { delay, duration: 0.55, ease: [0.16, 1, 0.3, 1] as const };
  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center px-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Themed ambience behind the card — the entrance previously sat on a
          flat near-black field, which guests read as a broken black box. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(85% 60% at 50% 38%, rgba(var(--accent-rgb), 0.16), transparent 62%),' +
            'radial-gradient(120% 50% at 50% 112%, rgba(var(--accent-rgb), 0.10), transparent 65%)',
        }}
      />
      <motion.div
        className="relative w-full max-w-sm"
        initial={reduced ? { opacity: 0 } : { y: 20, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: reduced ? 0.2 : 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <GoldFrameCard>
          <motion.div
            initial={reduced ? { opacity: 0 } : { y: 14, opacity: 0, scale: 0.92 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={at(0.08)}
          >
            <Wordmark size="lg" />
          </motion.div>

          <motion.p
            className="mt-7 max-w-xs font-serif italic text-lg text-brand-muted/80 leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={at(0.2)}
          >
            Step into the booth and capture a moment to remember.
          </motion.p>

          <motion.button
            onClick={onStart}
            whileTap={{ scale: 0.96 }}
            className="mt-9 flex items-center gap-3 px-9 py-4 bg-foil text-[color:var(--on-accent)] rounded-full font-label uppercase tracking-luxe text-[11px] font-bold glow-accent animate-pulse-glow"
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={at(0.32)}
          >
            <Camera className="w-4 h-4" />
            Step Inside
          </motion.button>

          {/* Ways out BEFORE the camera. This gate used to be a dead end: a
              guest who didn't want to turn a camera on had nowhere to go. */}
          <motion.div
            className="mt-4 flex items-center justify-center gap-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={at(0.38)}
          >
            <Link
              to={`${basePath}/wall`}
              className="pressable flex min-h-11 items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 hover:text-brand-fg transition-colors"
            >
              <Images className="w-3.5 h-3.5" />
              See the live wall
            </Link>
            <Link
              to={`${basePath}/me`}
              className="pressable flex min-h-11 items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 hover:text-brand-fg transition-colors"
            >
              <MediaStackIcon size={14} />
              My photos
            </Link>
          </motion.div>

          {/* The pre-camera disclosure. This was 8px uppercase at 30% opacity
              with 0.28em tracking — not a legible disclosure by any measure,
              on the one screen where a guest decides whether to turn on their
              camera. Now sentence case at a readable size and contrast.
              The claim itself was also softened from "only shared when you
              choose": on a photo challenge the shot is uploaded for an
              automatic check as soon as the guest presses send, so "leaves
              this device when you send it" is what actually happens. */}
          <motion.p
            className="mt-6 max-w-xs font-sans text-[13px] text-brand-muted/75 leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={at(0.44)}
          >
            The camera runs on your device. Your photo only leaves it when you send it to the wall.
            {!IS_LEGACY_BUILD && (
              <>
                {' '}By continuing you agree to our{' '}
                <Link to="/privacy" className="underline underline-offset-2 text-brand-fg/80 hover:text-brand-fg">
                  privacy policy
                </Link>
                .
              </>
            )}
          </motion.p>
        </GoldFrameCard>
      </motion.div>
    </motion.div>
  );
}
