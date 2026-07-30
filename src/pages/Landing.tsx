/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Beamwall marketing landing page — an immersive scroll experience on the
 * platform's black "beam wall" identity. A fixed WebGL spectrum field and
 * parallax ghost-frames sit behind everything; the hero's glass frames beam
 * in on load; each product pillar (AR booth, live wall, challenges, keepsake
 * cards) gets a full feature section whose transparent-cutout artwork floats
 * and drifts with scroll (GSAP ScrollTrigger + Framer Motion). Honest and
 * dark-pattern-free: real prices, no fake urgency, every CTA leads to sign-up.
 *
 * Scroll architecture: App's shell is h-screen overflow-hidden, so THIS
 * component owns scrolling via its root (h-full overflow-y-auto). All
 * ScrollTriggers therefore pass that root as their `scroller`.
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import ReportIssueButton from '../components/support/ReportIssueButton';
import { Check, ChevronDown, Play } from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import SpectrumField from '../components/ui/SpectrumField';
import LiveHeroCarousel from '../components/ui/LiveHeroCarousel';
import { BoothIcon, WallIcon, ChallengeIcon, CardIcon, type BeamIconProps } from '../components/ui/BeamIcons';
import {
  BOOTH_GUY_CUTOUT,
  TROPHY_CUTOUT,
  CARD_CUTOUT,
  FRAME_CLUSTER_CUTOUT,
  STEP_CREATE_CUTOUT,
  STEP_QR_CUTOUT,
  STEP_WALL_CUTOUT,
  EVENT_CONFERENCE,
  EVENT_TRADESHOW,
  EVENT_WEDDING,
  EVENT_GALA,
  EVENT_BIRTHDAY,
  EVENT_ACTIVATION,
} from '../lib/landingAssets';
import { BORDER_MAP, toDataUrl } from '../lib/borders';
import { usePageTitle } from '../lib/usePageTitle';
import {
  normalizeLandingContent,
  resolveMediaUrl,
  type LandingContent,
  type LandingFeatureContent,
  type LandingEventTypeContent,
} from '../lib/landingContent';
import { fetchLandingContent } from '../lib/landingContentClient';
import boothFeatureVideo from '../assets/landing/booth-feature.mp4';
import boothFeaturePoster from '../assets/landing/booth-feature-poster.jpg';
import wallFeatureVideo from '../assets/landing/wall-feature.mp4';
import wallFeaturePoster from '../assets/landing/wall-feature-poster.jpg';
import challengesFeatureVideo from '../assets/landing/challenges-feature.mp4';
import challengesFeaturePoster from '../assets/landing/challenges-feature-poster.jpg';
import cardsFeatureVideo from '../assets/landing/cards-feature.mp4';
import cardsFeaturePoster from '../assets/landing/cards-feature-poster.jpg';
import { ENTITLEMENTS, formatPostCap, formatRetention } from '../lib/plans';

gsap.registerPlugin(ScrollTrigger);

// Code-split: the interactive showcase drags in the AR stack (camera, WebGL
// shaders, MediaPipe, Three) — loaded only when the section approaches the
// viewport.
const InteractiveShowcase = lazy(() => import('../components/landing/InteractiveShowcase'));

/* ── Content ────────────────────────────────────────────────────────── */

/* Feature COPY (eyebrow/title/one-liner/highlights) now lives in
 * src/lib/landingContent.ts (CMS-overridable, defaults = the shipped strings).
 * What stays here is PRESENTATION — icons, gradient colors, the decor
 * discriminator and the BUNDLED media imports the CMS falls back to. These are
 * code, not data: an admin can swap a film or a cutout, but not turn a section
 * into a different component. */
interface FeaturePresentation {
  id: 'booth' | 'wall' | 'challenges' | 'cards';
  Icon: ComponentType<BeamIconProps>;
  from: string;
  to: string;
  /** "r, g, b" of `from`, for glows. */
  rgb: string;
  /** Decor art behind the film: a transparent cutout image, or (for the wall)
   *  a fanned pair of REAL frame designs rendered from their SVGs. */
  decor: 'cutout' | 'frames';
  image?: string;
  /** Which corner the decor art leans out from behind the film. */
  flip?: boolean;
  /** Bundled feature film + poster — the fallback when no CMS override is set.
   *  Rendered by the HyperFrames video studio (hyperframes/studio/<id>). */
  video: string;
  videoPoster: string;
}

const FEATURES: FeaturePresentation[] = [
  {
    id: 'booth',
    Icon: BoothIcon,
    from: '#5B8CFF',
    to: '#7C6CF7',
    rgb: '91, 140, 255',
    image: BOOTH_GUY_CUTOUT,
    decor: 'cutout',
    video: boothFeatureVideo,
    videoPoster: boothFeaturePoster,
  },
  {
    id: 'wall',
    Icon: WallIcon,
    from: '#22D3EE',
    to: '#38BDF8',
    rgb: '34, 211, 238',
    decor: 'frames',
    flip: true,
    video: wallFeatureVideo,
    videoPoster: wallFeaturePoster,
  },
  {
    id: 'challenges',
    Icon: ChallengeIcon,
    from: '#FB923C',
    to: '#F59E0B',
    rgb: '251, 146, 60',
    image: TROPHY_CUTOUT,
    decor: 'cutout',
    video: challengesFeatureVideo,
    videoPoster: challengesFeaturePoster,
  },
  {
    id: 'cards',
    Icon: CardIcon,
    from: '#E879F9',
    to: '#C084FC',
    rgb: '232, 121, 249',
    image: CARD_CUTOUT,
    decor: 'cutout',
    flip: true,
    video: cardsFeatureVideo,
    videoPoster: cardsFeaturePoster,
  },
];

interface Tier {
  name: string;
  price: string;
  unit: string;
  blurb: string;
  features: string[];
  popular?: boolean;
}

/* Features are written against ENTITLEMENTS, not from memory.
 *
 * Two things were wrong here originally: Essentials advertised a "Video
 * guestbook" while ENTITLEMENTS.essentials.cardsStandard is false, and no tier
 * disclosed retention at all — so a prospect chose Free without being told
 * photos expire after a week, and only met "7-day storage" once inside.
 *
 * On the two service promises that used to be absent: there was no contact or
 * support route anywhere on the marketing surface, so "Priority support" and
 * "White-glove setup" were both claims we could not honour.
 *
 * "Priority support" is BACK, because it is now true: there is a real desk
 * (/host/support, /admin/support), tickets carry a priority the operator sets,
 * and the footer has a contact route. "White-glove setup" stays OUT — that is
 * a promise about a human doing the setup for you, and shipping a ticket
 * system does not make it true. Put it back when somebody is actually
 * committed to doing it, not before. */
const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    unit: 'to try it',
    blurb: 'Spin up a booth and see the magic.',
    features: [
      '1 live event',
      'Photo booth + live wall',
      formatPostCap(ENTITLEMENTS.free.maxPosts, ENTITLEMENTS.free.videoEnabled),
      formatRetention(ENTITLEMENTS.free.retentionDays),
      'A subtle Beamwall credit',
    ],
  },
  {
    name: 'Essentials',
    price: '$49',
    unit: 'per event',
    blurb: 'Everything a small celebration needs.',
    features: [
      formatPostCap(ENTITLEMENTS.essentials.maxPosts, ENTITLEMENTS.essentials.videoEnabled),
      'Every frame & effect',
      'No watermark',
      formatRetention(ENTITLEMENTS.essentials.retentionDays),
    ],
  },
  {
    name: 'Premium',
    price: '$99',
    unit: 'per event',
    blurb: 'The full experience, most hosts pick this.',
    features: [
      'Unlimited photos & video',
      'AI event studio',
      'Greeting cards',
      formatRetention(ENTITLEMENTS.premium.retentionDays),
      'Priority support',
    ],
    popular: true,
  },
  {
    name: 'Deluxe',
    price: '$169',
    unit: 'per event',
    blurb: 'A keepsake film, and every finishing touch.',
    features: [
      'Everything in Premium',
      'Keepsake highlight film',
      'Premium card renders',
      formatRetention(ENTITLEMENTS.deluxe.retentionDays),
    ],
  },
];

/** "How it works" PRESENTATION — copy comes from content.howSteps (same fixed
 *  length 3, merged by index). `image` is the bundled cutout the CMS override
 *  falls back to; the tilt/parallax numbers are choreography, not content. */
const HOW_STEPS = [
  { n: '1', image: STEP_CREATE_CUTOUT, rgb: '91, 140, 255', tilt: 11, depth: 0.1 },
  { n: '2', image: STEP_QR_CUTOUT, rgb: '34, 211, 238', tilt: -9, depth: 0.16 },
  { n: '3', image: STEP_WALL_CUTOUT, rgb: '232, 121, 249', tilt: 11, depth: 0.1 },
];

/** Event-type PRESENTATION — label/blurb/imageUrl come from content.eventTypes
 *  (fixed length 6, merged by index). `image` is the bundled Higgsfield scene
 *  card (vendored via remote-assets); a tinted glow paints the card until it
 *  loads or if it ever fails. */
const EVENT_TYPES = [
  { rgb: '91, 140, 255', image: EVENT_CONFERENCE },
  { rgb: '34, 211, 238', image: EVENT_TRADESHOW },
  { rgb: '232, 121, 249', image: EVENT_WEDDING },
  { rgb: '212, 175, 55', image: EVENT_GALA },
  { rgb: '251, 146, 60', image: EVENT_BIRTHDAY },
  { rgb: '124, 108, 247', image: EVENT_ACTIVATION },
];

/** One event-type photo card — image cover + dark gradient + label; degrades
 *  to a branded glow card when there's no image (or it fails to load). A CMS
 *  override (validated by resolveMediaUrl) wins over the bundled scene card;
 *  failure is tracked PER SRC so a bad bundled image cannot poison a good
 *  override that arrives after it. */
function EventTypeCard({
  rgb,
  image,
  content,
}: {
  rgb: string;
  image?: string;
  content: LandingEventTypeContent;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = resolveMediaUrl(content.imageUrl, 'image') ?? image;
  const showImage = src !== undefined && failedSrc !== src;
  return (
    <div
      className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10"
      style={{ boxShadow: `0 0 30px -10px rgba(${rgb}, 0.4), 0 18px 44px -20px rgba(0,0,0,0.7)` }}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 90% at 50% 20%, rgba(${rgb}, 0.32), rgba(${rgb}, 0.08) 55%, transparent 80%), linear-gradient(180deg, rgba(24,26,38,0.9), rgba(8,9,15,0.95))`,
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-3.5 sm:p-4">
        <p className="font-serif text-base leading-tight text-brand-fg sm:text-lg">{content.label}</p>
        <p className="mt-0.5 text-[11px] text-brand-muted/80 sm:text-xs">{content.blurb}</p>
      </div>
    </div>
  );
}

/** Ghost frames drifting at different depths behind the whole page. */
const GHOST_FRAMES = [
  { left: '6%', top: '18%', w: 110, h: 165, rgb: '91, 140, 255', depth: 0.35, rot: -8 },
  { left: '88%', top: '12%', w: 90, h: 135, rgb: '34, 211, 238', depth: 0.55, rot: 10 },
  { left: '80%', top: '55%', w: 130, h: 195, rgb: '232, 121, 249', depth: 0.25, rot: -6 },
  { left: '10%', top: '68%', w: 84, h: 126, rgb: '251, 146, 60', depth: 0.6, rot: 12 },
  { left: '45%', top: '85%', w: 100, h: 150, rgb: '124, 108, 247', depth: 0.45, rot: -12 },
];

/* ── Building blocks ────────────────────────────────────────────────── */

/**
 * Film embed with managed playback: plays only while ~40% in view, pauses
 * offscreen. Five looping videos on one page would otherwise decode (and
 * drain batteries) simultaneously — iOS Safari also caps concurrent video
 * pipelines, which silently freezes whichever films exceed the cap.
 */
function FilmEmbed({ src, poster, label }: { src: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  // prefers-reduced-motion: never autoplay — the poster stays, and native
  // controls let the visitor play the film deliberately instead.
  const [reducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useLayoutEffect(() => {
    if (reducedMotion) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.play().catch(() => { /* autoplay blocked — poster stays */ });
        else el.pause();
      },
      // 0.25 (was 0.4): the film starts playing DURING its screen-tilt
      // entrance rather than after it settles — "the video plays as it tilts".
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reducedMotion]);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      controls={reducedMotion}
      preload="metadata"
      className="block h-auto w-full"
      aria-label={label}
    />
  );
}

/** The floating cutout inside a "how it works" step. Tiny by design — its
 *  parent owns the 3D tilt and the scroll parallax; this just floats (with a
 *  per-step phase offset) and degrades to a soft glow if the art fails to load. */
function StepArt({ src, rgb, delay }: { src: string; rgb: string; delay: number }) {
  // Per-src failure so a failed bundled cutout can't hide a CMS override
  // swapped in after it (and vice versa).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  if (failed) {
    return (
      <div
        className="animate-float h-48 w-40 rounded-3xl"
        style={{ background: `radial-gradient(circle, rgba(${rgb}, 0.28), transparent 70%)`, animationDelay: `${delay}s` }}
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      onError={() => setFailedSrc(src)}
      className="animate-float max-h-56 w-auto max-w-full object-contain drop-shadow-[0_24px_50px_rgba(0,0,0,0.6)] sm:max-h-64"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

/**
 * One feature pillar as a stacked cinematic block: centred heading (icon →
 * eyebrow → title → ONE succinct line), then the feature film at
 * full-experience width, leaning back like a screen as it scrolls in
 * ([data-screen-tilt], scrubbed by the page's GSAP choreography). The film
 * itself carries the detail (the old bullet lists) as in-video callouts.
 * The pillar's cutout art now peeks small and angled from BEHIND a top
 * corner of the film ([data-decor-pop] — pops in on scroll; z-0 under the
 * film's z-10 so it decorates without distracting).
 */
/** The wall section's decor: two REAL frame designs (their actual SVGs,
 *  transparent) fanned like a hand of cards — frames poking out from behind
 *  the film instead of a boxed scene photo. */
function FramePairDecor() {
  const neon = BORDER_MAP['jj-neon-frame'];
  const gold = BORDER_MAP['frame-classic-gold'];
  return (
    <div className="relative aspect-[9/14]">
      {gold && (
        <img
          src={toDataUrl(gold.svg)}
          alt=""
          draggable={false}
          className="absolute left-[30%] top-[8%] w-[72%] rotate-[13deg] opacity-95 drop-shadow-[0_18px_44px_rgba(0,0,0,0.6)]"
        />
      )}
      {neon && (
        <img
          src={toDataUrl(neon.svg)}
          alt=""
          draggable={false}
          className="absolute left-0 top-0 w-[78%] -rotate-6 drop-shadow-[0_18px_44px_rgba(0,0,0,0.65)]"
        />
      )}
    </div>
  );
}

function FeatureSection({ feature, content }: { feature: FeaturePresentation; content: LandingFeatureContent }) {
  // Decor failure is tracked per-src so a failed bundled cutout cannot hide a
  // CMS override that arrives after it.
  const [failedArtSrc, setFailedArtSrc] = useState<string | null>(null);
  const left = !feature.flip; // which side the decor art leans out from

  // CMS overrides, validated at the render boundary; undefined = bundled.
  const decorOverride = resolveMediaUrl(content.decorImageUrl, 'image');
  const videoSrc = resolveMediaUrl(content.videoUrl, 'video') ?? feature.video;
  const posterSrc = resolveMediaUrl(content.posterUrl, 'image') ?? feature.videoPoster;
  // An override image beats the discriminator (it can replace even the wall's
  // frame-pair); with no override, 'frames' keeps its SVG fan, 'cutout' its
  // bundled art. The discriminator itself is code, not CMS data.
  const decorImgSrc = decorOverride ?? (feature.decor === 'frames' ? undefined : feature.image);
  const showFramePair = decorOverride === undefined && feature.decor === 'frames';
  const artFailed = decorImgSrc !== undefined && failedArtSrc === decorImgSrc;

  return (
    <section data-parallax-scope className="w-full">
      <div data-reveal className="flex flex-col items-center text-center">
        <div
          className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            background: `linear-gradient(140deg, rgba(${feature.rgb}, 0.18), rgba(${feature.rgb}, 0.05))`,
            border: `1px solid rgba(${feature.rgb}, 0.35)`,
            boxShadow: `0 0 24px -6px rgba(${feature.rgb}, 0.45)`,
          }}
        >
          <feature.Icon size={26} from={feature.from} to={feature.to} />
        </div>
        <p className="font-label uppercase tracking-luxe text-[10px]" style={{ color: feature.from }}>
          {content.eyebrow}
        </p>
        <h2 className="mt-3 font-serif text-3xl leading-tight text-brand-fg sm:text-4xl">{content.title}</h2>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-brand-muted/80">{content.copy}</p>
        {/* Compact visible text alternative to the film's in-video callouts. */}
        {content.highlights.length > 0 && (
          <p className="mt-2 max-w-xl font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">
            {content.highlights.join(' · ')}
          </p>
        )}
      </div>

      <div
        className="relative mx-auto mt-10 w-full max-w-5xl"
        style={{ perspective: '1400px' }}
        data-parallax-depth="0.06"
      >
        {/* tinted glow the film floats over */}
        <div
          aria-hidden
          className="absolute -inset-8 -z-10 rounded-[4rem] blur-3xl"
          style={{ background: `radial-gradient(circle at 50% 42%, rgba(${feature.rgb}, 0.26), transparent 70%)` }}
        />

        {/* decor art — a large angled piece leaning out from BEHIND the film
            (z-0 under the film's z-10) so the two read as one composition;
            hidden entirely if the asset fails (a fallback icon back there
            would read as a bug). Corners alternate left/right per section. */}
        {!artFailed && (
          <div
            data-decor-pop
            aria-hidden
            className={`absolute z-0 w-36 sm:w-52 lg:w-60 ${
              left
                ? '-left-8 -top-14 sm:-left-20 sm:-top-20'
                : '-right-8 -top-14 sm:-right-20 sm:-top-20'
            }`}
          >
            {/* Static 3D angle on this wrapper; the float lives on a CHILD so
                the float-y keyframes (which write `transform`) can't stomp it. */}
            <div
              style={{
                transform: `rotate(${left ? -10 : 10}deg) rotateY(${left ? 20 : -20}deg)`,
                transformStyle: 'preserve-3d',
              }}
            >
              <div className="animate-float" style={{ animationDelay: '-2.5s' }}>
                {feature.decor === 'frames' ? (
                  <FramePairDecor />
                ) : (
                  <img
                    src={decorImgSrc}
                    alt=""
                    className="w-full object-contain drop-shadow-[0_18px_44px_rgba(0,0,0,0.6)]"
                    loading="lazy"
                    onError={() => { if (decorImgSrc !== undefined) setFailedArtSrc(decorImgSrc); }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* the film — full-experience width, screen-tilt scrubbed on scroll */}
        <div
          data-screen-tilt
          className="relative z-10 overflow-hidden rounded-3xl"
          style={{
            border: `1px solid rgba(${feature.rgb}, 0.45)`,
            boxShadow: `0 0 56px -12px rgba(${feature.rgb}, 0.45), 0 34px 90px -32px rgba(0,0,0,0.85)`,
            transformStyle: 'preserve-3d',
          }}
        >
          {/* key remounts the video (and its IntersectionObserver) when a CMS
              override swaps the film in — a bare src change on a playing
              <video> can leave the old frame up until the next play(). */}
          <FilmEmbed key={videoSrc} src={videoSrc} poster={posterSrc} label={`${content.title} — feature film`} />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(155deg, rgba(255,255,255,0.10), transparent 34%)' }}
          />
        </div>
      </div>
    </section>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */

export default function Landing() {
  usePageTitle('Beamwall · AR photo booth & live wall for events');
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Tri-state: null until the carousel's pools resolve. This used to start at
  // `true` to avoid a flash from the weaker caption to the stronger one — but
  // that meant a pulsing red LIVE dot sat over empty branded frames for the
  // whole fetch, which is the overclaim it was trying to avoid, just earlier.
  // Unknown now renders the modest caption and no dot; learning that the strip
  // IS live and saying so is an honest change, in the direction that costs
  // nobody anything if the fetch fails.
  const [hasLiveMedia, setHasLiveMedia] = useState<boolean | null>(null);

  // CMS content: render the bundled defaults IMMEDIATELY (zero layout shift —
  // the defaults ARE the shipped page), then swap in validated overrides if
  // the published row has any. fetchLandingContent never throws and returns
  // the same defaults on any failure, so this can only ever be a no-op or an
  // in-place text/media swap. Fixed slot counts (3 steps · 4 features ·
  // 6 event types) are guaranteed by normalizeLandingContent, so the GSAP
  // node sets registered in the effect below stay stable.
  const [content, setContent] = useState<LandingContent>(() => normalizeLandingContent(undefined));
  useEffect(() => {
    let alive = true;
    void fetchLandingContent().then((c) => {
      if (alive) setContent(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Scroll choreography. [data-reveal="up|left|right"] slide in on entry,
  // [data-reveal-stagger] cascades its children, [data-parallax-depth] drifts
  // with scroll, ghost frames + the big frame-cluster sweep across the whole
  // page. Every trigger uses this component's own scroll container. Under
  // prefers-reduced-motion everything becomes a plain opacity fade (no
  // movement) instead of disappearing entirely; mm.revert() cleans up.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const OFFSETS: Record<string, { x: number; y: number }> = {
        up: { x: 0, y: 64 },
        left: { x: -80, y: 0 },
        right: { x: 80, y: 0 },
      };
      gsap.utils.toArray<HTMLElement>('[data-reveal]', content).forEach((el) => {
        const o = OFFSETS[el.dataset.reveal || 'up'] ?? OFFSETS.up;
        gsap.fromTo(
          el,
          { x: o.x, y: o.y, opacity: 0 },
          {
            x: 0,
            y: 0,
            opacity: 1,
            duration: 1,
            ease: 'power3.out',
            scrollTrigger: { trigger: el, scroller, start: 'top 85%' },
          },
        );
      });
      gsap.utils.toArray<HTMLElement>('[data-reveal-stagger]', content).forEach((group) => {
        gsap.fromTo(
          group.children,
          { y: 30, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            stagger: 0.09,
            ease: 'power2.out',
            scrollTrigger: { trigger: group, scroller, start: 'top 88%' },
          },
        );
      });
      // How-it-works steps get their own, punchier stagger (bigger rise +
      // wider gap between steps) than the generic [data-reveal-stagger] used
      // for bullet lists / pricing tiers, so the three steps read as a
      // deliberate sequence rather than the page's default cascade.
      gsap.utils.toArray<HTMLElement>('[data-steps-reveal]', content).forEach((group) => {
        gsap.fromTo(
          group.children,
          { y: 56, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.9,
            stagger: 0.16,
            ease: 'power3.out',
            scrollTrigger: { trigger: group, scroller, start: 'top 85%' },
          },
        );
      });
      // Feature films lean back like a screen settling upright: a scrubbed
      // rotateX from a deep recline to a slight resting tilt as the film
      // scrolls up into view (perspective lives on the film's wrapper).
      gsap.utils.toArray<HTMLElement>('[data-screen-tilt]', content).forEach((el) => {
        gsap.fromTo(
          el,
          // Deeper entry + a longer scrub window (98%→35%) + snappier scrub:
          // on phones a fast flick used to blow through the old 95→40 range
          // before a frame rendered, so the tilt was never seen on mobile.
          { rotateX: 24, scale: 0.93, transformOrigin: 'center 85%' },
          {
            rotateX: 5,
            scale: 1,
            ease: 'power2.out',
            scrollTrigger: { trigger: el, scroller, scrub: 0.35, start: 'top 98%', end: 'top 35%' },
          },
        );
      });
      // Corner decor art pops from behind the film — small overshoot so it
      // reads as arriving, then the CSS float keeps it alive.
      gsap.utils.toArray<HTMLElement>('[data-decor-pop]', content).forEach((el) => {
        gsap.fromTo(
          el,
          { opacity: 0, scale: 0.4, y: 26 },
          {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: 0.8,
            ease: 'back.out(1.7)',
            scrollTrigger: { trigger: el, scroller, start: 'top 88%' },
          },
        );
      });
      gsap.utils.toArray<HTMLElement>('[data-parallax-depth]', content).forEach((el) => {
        const depth = parseFloat(el.dataset.parallaxDepth ?? '0.15');
        gsap.to(el, {
          yPercent: -depth * 100,
          ease: 'none',
          scrollTrigger: {
            trigger: el.closest('[data-parallax-scope]') ?? el,
            scroller,
            scrub: 0.6,
            start: 'top bottom',
            end: 'bottom top',
          },
        });
      });
      gsap.utils.toArray<HTMLElement>('[data-ghost-depth]').forEach((el) => {
        const depth = parseFloat(el.dataset.ghostDepth ?? '0.4');
        gsap.to(el, {
          yPercent: -depth * 220,
          ease: 'none',
          scrollTrigger: { trigger: content, scroller, scrub: 1.2, start: 'top top', end: 'bottom bottom' },
        });
      });
      // The frame cluster sweeps from the right edge toward center-left and
      // downward across the whole page — a slow, deep background traveler.
      const cluster = document.querySelector('[data-cluster]');
      if (cluster) {
        gsap.fromTo(
          cluster,
          { xPercent: 12, yPercent: -8, rotate: 8 },
          {
            xPercent: -115,
            yPercent: 60,
            rotate: -8,
            ease: 'none',
            scrollTrigger: { trigger: content, scroller, scrub: 1.4, start: 'top top', end: 'bottom bottom' },
          },
        );
      }
    });
    mm.add('(prefers-reduced-motion: reduce)', () => {
      gsap.utils.toArray<HTMLElement>('[data-reveal], [data-reveal-stagger], [data-steps-reveal], [data-decor-pop]', content).forEach((el) => {
        gsap.fromTo(
          el,
          { opacity: 0 },
          { opacity: 1, duration: 0.5, scrollTrigger: { trigger: el, scroller, start: 'top 90%' } },
        );
      });
      // Screens rest at their settled tilt — no scrubbed motion.
      gsap.utils.toArray<HTMLElement>('[data-screen-tilt]', content).forEach((el) => {
        gsap.set(el, { rotateX: 5, transformOrigin: 'center 85%' });
      });
    });
    return () => mm.revert();
  }, []);

  // The scroller stays overflow-x-hidden; the real x-overflow guard is the
  // overflow-x-clip on <main> below. clip on the scroller itself would be
  // futile — CSS demotes clip to hidden when the other axis is a scroll
  // container — and hidden still lets programmatic scrollIntoView (anchor
  // jumps, a11y focus) shift the page sideways and strand it there, because
  // decorative art overflows the right edge on phones. Clipping at <main>
  // (not a scroll container) removes that overflow at the source.
  return (
    <div ref={scrollRef} className="relative h-full w-full overflow-x-hidden overflow-y-auto scroll-smooth bg-brand-bg text-brand-fg">
      {/* Fixed immersive backdrop: WebGL spectrum, parallax ghost frames, and
          the big frame-cluster art slowly sweeping right → center-left. */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <SpectrumField />
        <img
          data-cluster
          src={FRAME_CLUSTER_CUTOUT}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute top-[14%] hidden w-[28rem] opacity-[0.15] blur-[2px] md:block"
          style={{ right: '-12%' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        {GHOST_FRAMES.map((g, i) => (
          <div
            key={i}
            data-ghost-depth={g.depth}
            className="absolute rounded-2xl opacity-30"
            style={{
              left: g.left,
              top: g.top,
              width: g.w,
              height: g.h,
              border: `1px solid rgba(${g.rgb}, 0.35)`,
              boxShadow: `0 0 26px -6px rgba(${g.rgb}, 0.28), inset 0 0 24px -8px rgba(${g.rgb}, 0.22)`,
              background: `radial-gradient(120% 90% at 50% 20%, rgba(${g.rgb}, 0.06), transparent 70%)`,
              transform: `rotate(${g.rot}deg)`,
              filter: 'blur(1.5px)',
            }}
          />
        ))}
        {/* Readability scrim — a deep dark veil over the spectrum so copy reads
            cleanly and section content pops. Pools deeper behind the top-centre
            hero headline, never fully clears (≥0.48) so text stays legible the
            whole scroll; the beams survive as a subtle ambience. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(135% 105% at 50% 16%, rgba(3,4,10,0.72) 0%, rgba(3,4,10,0.55) 46%, rgba(3,4,10,0.48) 100%)',
          }}
        />
      </div>

      <div ref={contentRef} className="relative z-10 mx-auto flex w-full max-w-6xl flex-col px-6 py-8">
        {/* Top bar — sticky so the primary CTA stays reachable down the whole
            page (a long scroll should never leave a visitor without a way to
            convert). Blurred glass so content reads as it passes underneath. */}
        <header className="sticky top-0 z-40 -mx-6 flex items-center justify-between border-b border-white/5 bg-brand-bg/70 px-6 py-3 backdrop-blur-md">
          <span className="font-serif text-xl sm:text-2xl font-semibold tracking-wide text-foil-static">Beamwall</span>
          <nav className="liquid-glass flex items-center gap-1.5 rounded-full p-1.5">
            <a href="#demo" className="hidden sm:inline rounded-full px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70 hover:text-brand-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]">
              Demo
            </a>
            <a href="#pricing" className="hidden sm:inline rounded-full px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70 hover:text-brand-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]">
              Pricing
            </a>
            {/* Sign in stays reachable on phones too (tighter padding <sm);
                Create your event keeps the primary treatment. Both pills are
                nowrap with a short signup label <sm — at 390px the wrapped
                two-line pills collided with the wordmark. */}
            <Link
              to="/login"
              className="inline-flex whitespace-nowrap rounded-full border border-white/15 bg-white/[0.04] px-3 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:px-5"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="whitespace-nowrap rounded-full bg-foil px-3 py-2 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:px-5"
            >
              <span className="sm:hidden">Create event</span>
              <span className="hidden sm:inline">Create your event</span>
            </Link>
          </nav>
        </header>

        {/* Hero — copy floats ABOVE the frame arc (z-20 vs z-10); the arc is
            pulled up behind it and the two move at different parallax depths
            for a 3D layered feel. The copy wrapper is pointer-events-none so
            frame clicks pass through; its links opt back in. */}
        <main className="flex flex-1 flex-col items-center overflow-x-clip text-center">
          <section data-parallax-scope className="relative flex w-full flex-col items-center pt-8 sm:pt-10">
            <div className="pointer-events-none relative z-20 flex flex-col items-center" data-parallax-depth="-0.05">
              {/* Free badge — the "it costs nothing to try" promise, front and centre. */}
              <div className="mb-5 flex items-center gap-2 rounded-full liquid-glass px-4 py-1.5">
                <span className="h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-emerald-400" aria-hidden />
                <span className="font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg">
                  {content.hero.badge}
                </span>
              </div>
              <h1 className="max-w-3xl font-serif text-5xl leading-[1.05] text-shadow-lux sm:text-6xl">
                {content.hero.titlePre}{' '}
                <span className="text-foil-static">{content.hero.titleHighlight}</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-brand-muted/85 sm:text-lg">
                {content.hero.tagline}
              </p>

              <div className="mt-6 flex flex-col items-center gap-3">
                <div className="flex flex-col items-center gap-3 sm:flex-row">
                  <Link
                    to="/signup"
                    className="pointer-events-auto rounded-full bg-foil px-10 py-4 font-label uppercase tracking-luxe text-[12px] font-bold text-white glow-accent transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                  >
                    {content.hero.primaryCta}
                  </Link>
                  {/* Demo CTA — promoted to a first-class button: play chip,
                      accent ring + glow, so "see it now" reads as inviting as
                      "sign up" without stealing the primary's job. */}
                  <a
                    href="#demo"
                    className="group pointer-events-auto flex items-center gap-2.5 rounded-full border px-8 py-3.5 font-label uppercase tracking-luxe text-[12px] font-semibold text-brand-fg transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-accent) 45%, transparent)',
                      background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                      boxShadow: '0 0 26px -8px color-mix(in srgb, var(--color-accent) 65%, transparent)',
                    }}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foil transition group-hover:scale-110">
                      <Play className="ml-0.5 h-3 w-3 fill-current text-white" />
                    </span>
                    {content.hero.secondaryCta}
                  </a>
                </div>
                {/* The free promise lives ONCE, in the badge above the title —
                    the old fine-print line here repeated it word for word. */}
              </div>
            </div>

            {/* Focal visual — a live, auto-scrolling coverflow of real event
                frames streaming actual moderated moments from those events'
                walls. mt-12 on mobile keeps it clear of the hero fine print. */}
            {/* sm:mt-12 clears the hero fine print — the coverflow's focal card
                scales up + lifts, so its top edge rises above the strip. */}
            <div className="relative z-10 mt-10 w-full max-w-6xl sm:mt-12" data-parallax-depth="0.08">
              <LiveHeroCarousel className="w-full" onHasMedia={setHasLiveMedia} />
            </div>
            {/* Prominent proof line — this strip is real events, not stock. */}
            <div className="mt-5 flex items-center justify-center">
              <p className="flex items-center gap-2.5 rounded-full liquid-glass px-5 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg/85 sm:text-[11px]">
                {hasLiveMedia === true && (
                  <span className="relative flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-rose-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
                  </span>
                )}
                {hasLiveMedia === true ? 'Live moments from real Beamwall events' : 'Frame styles from real Beamwall events'}
              </p>
            </div>
          </section>

          {/* How it works — three plain steps, up high, so a first-time
              visitor grasps the whole loop before scrolling the details.
              Tight gap to the hero: the carousel's own py already pads it. */}
          <section data-parallax-scope className="mt-12 w-full sm:mt-14">
            <div data-reveal className="flex flex-col items-center text-center">
              <h2 className="font-serif text-3xl text-foil-static sm:text-4xl">How it works</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-brand-muted/70">
                From sign-up to a wall full of moments — three steps, no app, no queue.
              </p>
            </div>
            <div data-steps-reveal className="mx-auto mt-14 grid w-full max-w-5xl gap-10 sm:grid-cols-3 sm:gap-8">
              {/* content.howSteps is normalized to EXACTLY three entries, so this
                  zip keeps the [data-steps-reveal] node set stable. */}
              {HOW_STEPS.map((s, i) => (
                <div key={s.n} className="flex flex-col items-center text-center">
                  {/* Floating, 3D-tilted, parallax hero. The parallax drift lives
                      on the wrapper (GSAP yPercent); the 3D tilt on the middle
                      layer; the float on the image itself — three separate
                      elements so none of the transforms fight each other. */}
                  <div
                    className="relative mb-6 flex h-56 w-full items-center justify-center sm:h-64"
                    data-parallax-depth={s.depth}
                    style={{ perspective: '1000px' }}
                  >
                    <div
                      aria-hidden
                      className="absolute inset-6 rounded-full blur-3xl"
                      style={{ background: `radial-gradient(circle, rgba(${s.rgb}, 0.34), transparent 68%)` }}
                    />
                    <div style={{ transform: `rotateY(${s.tilt}deg) rotateX(6deg)`, transformStyle: 'preserve-3d' }}>
                      <StepArt
                        src={resolveMediaUrl(content.howSteps[i]?.imageUrl, 'image') ?? s.image}
                        rgb={s.rgb}
                        delay={i * -1.6}
                      />
                    </div>
                    {/* grounding shadow puddle */}
                    <div
                      aria-hidden
                      className="absolute bottom-1 left-1/2 h-4 w-2/5 -translate-x-1/2 rounded-full blur-xl"
                      style={{ background: `rgba(${s.rgb}, 0.4)` }}
                    />
                  </div>
                  {/* "STEP N" chip — a labelled pill instead of a bare number
                      squeezed in a small circle, so the sequence reads at a glance. */}
                  <span className="rounded-full bg-foil px-4 py-1.5 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent">
                    Step {s.n}
                  </span>
                  <h3 className="mt-3 font-serif text-2xl text-brand-fg">{content.howSteps[i]?.title}</h3>
                  <p className="mt-2.5 max-w-xs text-sm leading-relaxed text-brand-muted/75">{content.howSteps[i]?.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Feature stories — one immersive section per pillar. Tighter
              rhythm on mobile where each section already stacks tall. */}
          <div className="mt-24 flex w-full max-w-5xl flex-col gap-20 sm:mt-36 sm:gap-36">
            {/* content.features is normalized to the same four ids, in order. */}
            {FEATURES.map((f, i) => (
              <FeatureSection key={f.id} feature={f} content={content.features[i]} />
            ))}
          </div>

          {/* Who it's for — replaces the retired promo-film section (the intro
              film is archived for socials; see hyperframes/studio/intro).
              Audiences as glass chips, event types as photo cards. */}
          <section data-parallax-scope className="mt-32 w-full">
            <div data-reveal className="flex flex-col items-center text-center">
              <p className="font-label uppercase tracking-luxe text-[10px] text-accent">Who it&rsquo;s for</p>
              <h2 className="mt-3 font-serif text-3xl text-foil-static sm:text-4xl">
                Made for every room worth remembering
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-brand-muted/70">
                Built for the people who bring events to life — and the events they dream up.
              </p>
            </div>
            {/* Audience chips are VARIABLE-length CMS content, so the reveal
                lives on the CONTAINER (data-reveal), not per-child stagger —
                a per-child GSAP set registered at mount would miss chips the
                CMS adds after the fetch resolves. */}
            <div data-reveal className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-2.5">
              {content.audiences.map((a) => (
                <span
                  key={a}
                  className="rounded-full liquid-glass px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg/85"
                >
                  {a}
                </span>
              ))}
            </div>
            {/* content.eventTypes is normalized to exactly six entries, so this
                stagger's node set stays stable. */}
            <div data-reveal-stagger className="mx-auto mt-10 grid w-full max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3">
              {EVENT_TYPES.map((e, i) => (
                <EventTypeCard key={i} rgb={e.rgb} image={e.image} content={content.eventTypes[i]} />
              ))}
            </div>
          </section>

          {/* Interactive showcase — the product itself, embedded as a staged
              two-column demo (copy · phone → beam → live wall). Placed BEFORE
              pricing so a visitor experiences the magic before they see a price.
              Camera only starts on an explicit tap inside ShowcasePhone; the
              heavy AR chunk (MediaPipe/Three) is code-split behind React.lazy.
              It owns its copy, so the section has no header of its own. */}
          <section id="demo" data-parallax-scope data-showcase-root className="mt-32 w-full scroll-mt-24">
            <div data-reveal className="w-full">
              <Suspense
                fallback={
                  <div className="mx-auto h-[420px] w-full max-w-6xl motion-safe:animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] lg:h-[560px]" />
                }
              >
                <InteractiveShowcase />
              </Suspense>
            </div>
          </section>

          {/* Pricing */}
          <section id="pricing" className="mt-32 w-full scroll-mt-8">
            <div data-reveal>
              <h2 className="font-serif text-3xl text-foil-static sm:text-4xl">Simple pricing, per event</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-brand-muted/70">
                Pay only for the events you host — no subscription required. Start free, upgrade an event
                whenever you like. Frequent host? Beamwall Pro is <span className="text-brand-fg">$79/month</span> for
                premium features across every event.
              </p>
            </div>

            <div data-reveal-stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TIERS.map((t) => (
                <div
                  key={t.name}
                  className={`relative flex flex-col rounded-2xl border p-6 text-left transition ${
                    t.popular
                      ? 'border-[color:var(--color-accent)]/50 bg-[color:var(--color-accent)]/[0.06] shadow-[0_20px_70px_-20px_rgba(0,0,0,0.6)]'
                      : 'border-white/10 bg-white/[0.02]'
                  }`}
                >
                  {t.popular && (
                    <span className="absolute -top-2.5 left-6 rounded-full bg-foil px-3 py-1 font-label uppercase tracking-luxe text-[10px] font-bold text-[color:var(--on-accent)]">
                      Most popular
                    </span>
                  )}
                  <h3 className="font-label uppercase tracking-luxe text-[11px] text-brand-muted/70">{t.name}</h3>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="font-serif text-4xl text-foil-static">{t.price}</span>
                    <span className="font-sans text-xs text-brand-muted/70">{t.unit}</span>
                  </div>
                  <p className="mt-2 font-sans text-[12px] leading-relaxed text-brand-muted/70">{t.blurb}</p>
                  <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[13px] text-brand-fg/90">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/signup"
                    className={`mt-6 rounded-full px-5 py-3 text-center font-label uppercase tracking-luxe text-[10px] font-bold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
                      t.popular
                        ? 'bg-foil text-white glow-accent'
                        : 'border border-white/15 bg-white/[0.04] text-brand-fg hover:bg-white/[0.08]'
                    }`}
                  >
                    {t.name === 'Free' ? 'Start free' : 'Get started'}
                  </Link>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ — honest objection handling, native details/summary so it
              needs no JS and stays accessible + keyboard-friendly. */}
          <section className="mx-auto mt-32 w-full max-w-3xl">
            <div data-reveal className="text-center">
              <h2 className="font-serif text-3xl text-foil-static sm:text-4xl">Questions, answered</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-brand-muted/70">
                The things hosts ask before their first event.
              </p>
            </div>
            {/* FAQs are VARIABLE-length CMS content (add/remove up to 12), so —
                like the audience chips — the reveal moved from a per-child
                stagger to the CONTAINER: the entries themselves are native
                details/summary with no JS or GSAP dependency of their own. */}
            <div data-reveal className="mt-10 flex flex-col gap-3">
              {content.faqs.map((f) => (
                <details key={f.q} className="group rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 transition open:bg-white/[0.03]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-serif text-base text-brand-fg">
                    {f.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-brand-muted/60 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-brand-muted/75">{f.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* Closing CTA */}
          <div data-reveal className="mt-32 flex w-full max-w-2xl flex-col items-center rounded-3xl liquid-glass px-8 py-12 text-center">
            <h2 className="font-serif text-3xl text-foil-static">{content.closing.title}</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-brand-muted/75">
              {content.closing.body}
            </p>
            <Link
              to="/signup"
              className="mt-7 rounded-full bg-foil px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
            >
              {content.closing.cta}
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="flex flex-col items-center gap-3 pb-6 pt-20 text-center">
          <span className="font-serif text-lg text-foil-static">Beamwall</span>
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">
            {content.footerTagline}
          </p>
          <nav className="flex items-center gap-4 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">
            <Link to="/privacy" className="rounded transition hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]">Privacy</Link>
            <span className="text-brand-muted/25" aria-hidden>·</span>
            <Link to="/terms" className="rounded transition hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]">Terms</Link>
            <span className="text-brand-muted/25" aria-hidden>·</span>
            {/* The marketing surface had no contact route at all — see the note
                above the pricing bullets about claims we could not honour. */}
            <ReportIssueButton
              label="Contact"
              showIcon={false}
              prefill={{ source: 'landing' }}
              className="rounded transition hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
            />
          </nav>
        </footer>
      </div>
    </div>
  );
}
