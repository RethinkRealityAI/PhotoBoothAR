/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Beamwall marketing landing page — an immersive scroll experience on the
 * platform's black "beam wall" identity. A fixed, scrim-darkened WebGL
 * spectrum field and parallax ghost-frames sit behind everything; the hero's
 * glass frames beam in on load and now show real Detola & Wuyi / Hope Gala /
 * Jenna & Jake frame designs (FrameShowcase's rotating FRAME_POOL) instead of
 * app-pillar art. Each product pillar (AR booth, live wall, challenges,
 * keepsake cards) gets a full feature section whose art + feature film pair
 * up as a single tilted `MediaDuo` (phone-and-wall-style), alternating sides
 * per pillar; the image fades in via a converging particle burst
 * (ImageParticles) while the video rises and settles into its tilt — both
 * driven by GSAP ScrollTrigger alongside the rest of the page's scroll
 * choreography. Honest and dark-pattern-free: real prices, no fake urgency,
 * every CTA leads to sign-up.
 *
 * Scroll architecture: App's shell is h-screen overflow-hidden, so THIS
 * component owns scrolling via its root (h-full overflow-y-auto). All
 * ScrollTriggers therefore pass that root as their `scroller`.
 */
import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { EVENT_TEMPLATES } from '../lib/eventTemplates';
import TemplatePreview from '../components/ui/TemplatePreview';
import SpectrumField from '../components/ui/SpectrumField';
import FrameShowcase from '../components/ui/FrameShowcase';
import { BoothIcon, WallIcon, ChallengeIcon, CardIcon, type BeamIconProps } from '../components/ui/BeamIcons';
import { BOOTH_CUTOUT, WALL_SCENE, TROPHY_CUTOUT, CARD_CUTOUT, FRAME_CLUSTER_CUTOUT } from '../lib/landingAssets';
import promoVideo from '../assets/landing/beamwall-promo.mp4';
import promoPoster from '../assets/landing/beamwall-promo-poster.jpg';
import boothFeatureVideo from '../assets/landing/booth-feature.mp4';
import boothFeaturePoster from '../assets/landing/booth-feature-poster.jpg';
import wallFeatureVideo from '../assets/landing/wall-feature.mp4';
import wallFeaturePoster from '../assets/landing/wall-feature-poster.jpg';
import challengesFeatureVideo from '../assets/landing/challenges-feature.mp4';
import challengesFeaturePoster from '../assets/landing/challenges-feature-poster.jpg';
import cardsFeatureVideo from '../assets/landing/cards-feature.mp4';
import cardsFeaturePoster from '../assets/landing/cards-feature-poster.jpg';

gsap.registerPlugin(ScrollTrigger);

// Code-split: the interactive showcase drags in the AR stack (camera, WebGL
// shaders, MediaPipe, Three) — loaded only when the section approaches the
// viewport.
const InteractiveShowcase = lazy(() => import('../components/landing/InteractiveShowcase'));

/* ── Content ────────────────────────────────────────────────────────── */

interface Feature {
  id: string;
  eyebrow: string;
  title: string;
  copy: string;
  bullets: string[];
  Icon: ComponentType<BeamIconProps>;
  from: string;
  to: string;
  /** "r, g, b" of `from`, for glows. */
  rgb: string;
  image: string;
  /** Cutouts float free over a glow; scenes render inside a glass frame. */
  imageStyle: 'cutout' | 'framed';
  flip?: boolean;
  /** 30s feature film — rendered by the HyperFrames video studio (hyperframes/studio/<id>). */
  video: string;
  videoPoster: string;
}

const FEATURES: Feature[] = [
  {
    id: 'booth',
    eyebrow: 'Immersive AR booth',
    title: 'A photo booth that lives in every pocket',
    copy:
      'Guests scan one QR code and step straight into an AR photo booth in their browser — no app, no queue. Face-tracked 3D props, live WebGL effects and your event’s frames follow every smile.',
    bullets: ['Face-tracked 3D props & frames', 'Cinematic live effects', 'Photo & video capture, no app'],
    Icon: BoothIcon,
    from: '#5B8CFF',
    to: '#7C6CF7',
    rgb: '91, 140, 255',
    image: BOOTH_CUTOUT,
    imageStyle: 'cutout',
    video: boothFeatureVideo,
    videoPoster: boothFeaturePoster,
  },
  {
    id: 'wall',
    eyebrow: 'Live photo wall',
    title: 'Every shot beams onto the wall, live',
    copy:
      'The moment a guest captures a photo it beams onto a cinematic wall the whole room watches — mosaic, slideshow and marquee views with moderation you control from your phone.',
    bullets: ['Realtime beam-in animations', 'Mosaic, slideshow & marquee views', 'One-tap moderation'],
    Icon: WallIcon,
    from: '#22D3EE',
    to: '#38BDF8',
    rgb: '34, 211, 238',
    image: WALL_SCENE,
    imageStyle: 'framed',
    flip: true,
    video: wallFeatureVideo,
    videoPoster: wallFeaturePoster,
  },
  {
    id: 'challenges',
    eyebrow: 'Challenges',
    title: 'Turn the room into the game',
    copy:
      'Set photo challenges — “catch the first dance”, “selfie with a stranger” — and watch the leaderboard light the wall up. Guests play, the wall fills, the room comes alive.',
    bullets: ['Custom photo challenges', 'Live leaderboard on the wall', 'Prizes decided by the crowd'],
    Icon: ChallengeIcon,
    from: '#FB923C',
    to: '#F59E0B',
    rgb: '251, 146, 60',
    image: TROPHY_CUTOUT,
    imageStyle: 'cutout',
    video: challengesFeatureVideo,
    videoPoster: challengesFeaturePoster,
  },
  {
    id: 'cards',
    eyebrow: 'Keepsake cards & guestbook',
    title: 'The morning-after keepsake',
    copy:
      'Guests leave short video messages and sign a collective greeting card. It all becomes a keepsake you keep forever — with a highlight film rendered overnight on premium plans.',
    bullets: ['Video guestbook messages', 'Collaborative greeting cards', 'Keepsake highlight film'],
    Icon: CardIcon,
    from: '#E879F9',
    to: '#C084FC',
    rgb: '232, 121, 249',
    image: CARD_CUTOUT,
    imageStyle: 'cutout',
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

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    unit: 'to try it',
    blurb: 'Spin up a booth and see the magic.',
    features: ['1 live event', 'Up to 25 photos', 'AR booth + live wall', 'A subtle Beamwall credit'],
  },
  {
    name: 'Essentials',
    price: '$49',
    unit: 'per event',
    blurb: 'Everything a small celebration needs.',
    features: ['Up to 500 photos', 'Video guestbook', 'No watermark', 'Every frame & effect'],
  },
  {
    name: 'Premium',
    price: '$99',
    unit: 'per event',
    blurb: 'The full experience, most hosts pick this.',
    features: ['Unlimited photos & video', 'AI event studio', 'Greeting cards', 'Priority support'],
    popular: true,
  },
  {
    name: 'Deluxe',
    price: '$169',
    unit: 'per event',
    blurb: 'A keepsake film and white-glove polish.',
    features: ['Everything in Premium', 'Keepsake highlight film', 'Premium card renders', 'White-glove setup'],
  },
];

const SHOWCASE = ['wedding', 'party', 'gala'];

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
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.play().catch(() => { /* autoplay blocked — poster stays */ });
        else el.pause();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      className="block h-auto w-full"
      aria-label={label}
    />
  );
}

/** A small burst of hue-tinted sparks that converge toward the image as it
 *  reveals, then dissolve — the "particle effect" fade-in. Positions are
 *  memoized per mount (stable, not re-rolled on re-render); the scroll
 *  choreography effect below reads each dot's --dx/--dy via data attributes. */
function ImageParticles({ rgb }: { rgb: string }) {
  const particles = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => {
        const angle = (i / 10) * Math.PI * 2 + (i % 2 ? 0.3 : -0.2);
        const dist = 58 + (i % 4) * 24;
        return { id: i, dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist), size: 3 + (i % 3) * 2 };
      }),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      {particles.map((p) => (
        <span
          key={p.id}
          data-particle
          data-dx={p.dx}
          data-dy={p.dy}
          className="absolute rounded-full opacity-0"
          style={{
            width: p.size,
            height: p.size,
            background: `rgba(${rgb}, 0.95)`,
            boxShadow: `0 0 8px 2px rgba(${rgb}, 0.65)`,
          }}
        />
      ))}
    </div>
  );
}

/** Transparent-cutout artwork that floats over a tinted glow. `rotate` tilts
 *  the whole piece (set by MediaDuo, opposite the paired video); the bob
 *  animation lives on an inner wrapper so it composes with that static tilt
 *  instead of the CSS keyframe overwriting it every frame. */
function CutoutArt({ feature, rotate = 0 }: { feature: Feature; rotate?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className="relative mx-auto flex aspect-square w-full max-w-[18rem] items-center justify-center sm:max-w-[22rem]"
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <div
        className="absolute inset-[8%] rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, rgba(${feature.rgb}, 0.32), transparent 68%)` }}
      />
      <div data-particle-target className="animate-float relative flex h-full w-full items-center justify-center">
        {!failed ? (
          <img
            src={feature.image}
            alt=""
            aria-hidden
            className="relative max-h-full w-auto max-w-full object-contain drop-shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <feature.Icon size={96} from={feature.from} to={feature.to} className="relative" />
        )}
      </div>
      <ImageParticles rgb={feature.rgb} />
      {/* grounding glow puddle */}
      <div
        className="absolute bottom-[6%] left-1/2 h-6 w-3/5 -translate-x-1/2 rounded-full blur-2xl"
        style={{ background: `rgba(${feature.rgb}, 0.35)` }}
      />
    </div>
  );
}

/** Photographic artwork inside a glowing glass frame. Same rotate/particle
 *  contract as CutoutArt. */
function FramedArt({ feature, rotate = 0 }: { feature: Feature; rotate?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative mx-auto w-full max-w-[18rem] sm:max-w-[20rem]" style={{ transform: `rotate(${rotate}deg)` }}>
      <div
        data-particle-target
        className="animate-float relative aspect-[4/5] overflow-hidden rounded-3xl"
        style={{
          border: `1px solid rgba(${feature.rgb}, 0.5)`,
          boxShadow: `0 0 46px -8px rgba(${feature.rgb}, 0.5), 0 30px 80px -30px rgba(0,0,0,0.8)`,
        }}
      >
        {!failed ? (
          <img
            src={feature.image}
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: `radial-gradient(120% 90% at 50% 25%, rgba(${feature.rgb}, 0.3), rgba(6,7,13,0.8) 70%)` }}
          >
            <feature.Icon size={80} from={feature.from} to={feature.to} />
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(165deg, rgba(255,255,255,0.12), transparent 32%)' }}
        />
      </div>
      <ImageParticles rgb={feature.rgb} />
    </div>
  );
}

/** Image + video paired like the hero demo's phone-and-wall: the photographic
 *  cutout/frame and the feature film sit side by side, each tilted the
 *  opposite way, the video overlapping toward the text column. Stacks on
 *  mobile. `data-reveal-video`'s tilt is read from `data-tilt` by the page's
 *  scroll choreography (rises then settles into its angle); the image's
 *  entrance is driven by ImageParticles + `data-particle-target` above. */
function MediaDuo({ feature }: { feature: Feature }) {
  const rotArt = feature.flip ? 5 : -5;
  const rotVideo = feature.flip ? -4 : 4;
  const edge = feature.flip ? 'right' : 'left';
  const innerEdge = feature.flip ? 'left' : 'right';
  return (
    <div
      data-parallax-depth="0.14"
      className="relative mx-auto flex w-full max-w-sm flex-col items-center gap-8 sm:block sm:h-[420px] sm:max-w-none md:h-[460px]"
    >
      <div className="relative z-10 w-[80%] sm:absolute sm:top-0 sm:w-[66%]" style={{ [edge]: '0%' }}>
        {feature.imageStyle === 'cutout' ? (
          <CutoutArt feature={feature} rotate={rotArt} />
        ) : (
          <FramedArt feature={feature} rotate={rotArt} />
        )}
      </div>
      <div
        data-reveal-video
        data-tilt={rotVideo}
        className="relative z-20 w-[70%] sm:absolute sm:bottom-0 sm:w-[52%]"
        style={{ [innerEdge]: '4%' }}
      >
        <div
          className="overflow-hidden rounded-2xl"
          style={{
            border: `1px solid rgba(${feature.rgb}, 0.4)`,
            boxShadow: `0 0 34px -10px rgba(${feature.rgb}, 0.5), 0 20px 60px -24px rgba(0,0,0,0.8)`,
          }}
        >
          <FilmEmbed src={feature.video} poster={feature.videoPoster} label={`${feature.title} — feature film`} />
        </div>
      </div>
    </div>
  );
}

function FeatureSection({ feature }: { feature: Feature }) {
  return (
    <section data-parallax-scope className="grid w-full items-center gap-10 sm:grid-cols-2 sm:gap-14">
      {/* Text slides in from its own side; the image+video duo from the
          opposite side — alternates per feature via `feature.flip`. */}
      <div data-reveal={feature.flip ? 'right' : 'left'} className={`text-left ${feature.flip ? 'sm:order-2' : ''}`}>
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
          {feature.eyebrow}
        </p>
        <h2 className="mt-3 font-display text-3xl leading-tight text-brand-fg sm:text-4xl">{feature.title}</h2>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-brand-muted/80">{feature.copy}</p>
        <ul data-reveal-stagger className="mt-6 flex flex-col gap-2.5">
          {feature.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm text-brand-fg/90">
              <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: feature.from }} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={feature.flip ? 'sm:order-1' : ''}>
        <MediaDuo feature={feature} />
      </div>
    </section>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */

export default function Landing() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const showcase = SHOWCASE.map((id) => EVENT_TEMPLATES.find((t) => t.id === id)!).filter(Boolean);

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
      // Feature-section image reveal: hue sparks converge toward the image
      // while it unblurs and scales in, then dissolve away — the "particle
      // effect" fade-in (ImageParticles renders the dots as a sibling of the
      // [data-particle-target] wrapper inside CutoutArt/FramedArt).
      gsap.utils.toArray<HTMLElement>('[data-particle-target]', content).forEach((img) => {
        const wrap = img.parentElement;
        if (!wrap) return;
        const dots = wrap.querySelectorAll<HTMLElement>('[data-particle]');
        const tl = gsap.timeline({ scrollTrigger: { trigger: wrap, scroller, start: 'top 85%' } });
        tl.fromTo(img, { opacity: 0, scale: 0.85, filter: 'blur(6px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.9, ease: 'power2.out' }, 0);
        dots.forEach((d, i) => {
          const dx = parseFloat(d.dataset.dx ?? '0');
          const dy = parseFloat(d.dataset.dy ?? '0');
          tl.fromTo(
            d,
            { x: dx, y: dy, opacity: 0, scale: 0.4 },
            { x: dx * 0.3, y: dy * 0.3, opacity: 1, scale: 1, duration: 0.4, ease: 'power2.out' },
            i * 0.02,
          ).to(d, { opacity: 0, scale: 0.3, duration: 0.5, ease: 'power1.in' }, '>-0.05');
        });
      });
      // Feature-section video: rises up from below the fold, then settles
      // into its paired tilt (opposite the image's — set by MediaDuo via
      // data-tilt) as it locks into place.
      gsap.utils.toArray<HTMLElement>('[data-reveal-video]', content).forEach((el) => {
        const tilt = parseFloat(el.dataset.tilt ?? '0');
        gsap.fromTo(
          el,
          { y: 90, opacity: 0, rotate: 0, scale: 0.94 },
          {
            y: 0,
            opacity: 1,
            rotate: tilt,
            scale: 1,
            duration: 1,
            ease: 'power3.out',
            scrollTrigger: { trigger: el, scroller, start: 'top 88%' },
          },
        );
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
      gsap.utils.toArray<HTMLElement>('[data-reveal], [data-reveal-stagger], [data-reveal-video], [data-particle-target]', content).forEach((el) => {
        gsap.fromTo(
          el,
          { opacity: 0 },
          { opacity: 1, duration: 0.5, scrollTrigger: { trigger: el, scroller, start: 'top 90%' } },
        );
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
          className="absolute top-[14%] hidden w-[28rem] opacity-[0.09] blur-[2px] md:block"
          style={{ right: '-12%' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        {GHOST_FRAMES.map((g, i) => (
          <div
            key={i}
            data-ghost-depth={g.depth}
            className="absolute rounded-2xl opacity-[0.16]"
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
        {/* Dimming scrim — sits above the shader/ghosts/cluster so the beams
            read as ambient depth instead of competing with the copy; darkest
            at top/bottom where headings and body text sit. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(3,4,9,0.58) 0%, rgba(3,4,9,0.34) 24%, rgba(3,4,9,0.46) 58%, rgba(3,4,9,0.7) 100%), radial-gradient(120% 65% at 50% 34%, rgba(3,4,9,0.12), rgba(3,4,9,0.6) 80%)',
          }}
        />
      </div>

      <div ref={contentRef} className="relative z-10 mx-auto flex w-full max-w-6xl flex-col px-6 py-8">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <span className="font-display text-2xl font-semibold tracking-wide text-foil-static">Beamwall</span>
          <nav className="flex items-center gap-2.5">
            <a href="#pricing" className="hidden sm:inline rounded-full px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70 hover:text-brand-fg transition-colors">
              Pricing
            </a>
            <Link
              to="/login"
              className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.08]"
            >
              Sign in
            </Link>
          </nav>
        </header>

        {/* Hero — copy floats ABOVE the frame arc (z-20 vs z-10); the arc is
            pulled up behind it and the two move at different parallax depths
            for a 3D layered feel. The copy wrapper is pointer-events-none so
            frame clicks pass through; its links opt back in. */}
        <main className="flex flex-1 flex-col items-center overflow-x-clip text-center">
          <section data-parallax-scope className="relative flex w-full flex-col items-center pt-14 sm:pt-16">
            <div className="pointer-events-none relative z-20 flex flex-col items-center" data-parallax-depth="-0.05">
              <h1 className="mt-2 max-w-3xl font-display text-5xl leading-[1.05] text-shadow-lux sm:text-6xl">
                Your event, in <span className="text-foil-static">augmented reality</span>.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-brand-muted/85 sm:text-lg">
                Give every guest a magical AR photo booth in their pocket — no app to download. Photos beam
                onto a live wall styled with frames and 3D magic you set up in minutes.
              </p>

              <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
                <Link
                  to="/signup"
                  className="pointer-events-auto rounded-full bg-foil px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
                >
                  Create your event
                </Link>
                <a
                  href="#pricing"
                  className="pointer-events-auto rounded-full border border-white/15 bg-white/[0.04] px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08] active:scale-[0.98]"
                >
                  See pricing
                </a>
              </div>
              <p className="mt-4 font-sans text-xs text-brand-muted/50">Free to start · no credit card to create your event.</p>
            </div>

            {/* Focal visual — the beam wall itself: tall glowing frames in a
                perspective arc, beams rising behind the copy, reflections on
                the floor. Tap a frame to learn about that pillar. mt-12 on
                mobile keeps the arc clear of the hero fine print (they overlap
                at mt-2 on narrow screens). */}
            <div className="relative z-10 mt-12 w-full max-w-5xl sm:-mt-12" data-parallax-depth="0.08">
              <FrameShowcase className="w-full" />
            </div>
          </section>

          {/* Feature stories — one immersive section per pillar. Tighter
              rhythm on mobile where each section already stacks tall. */}
          <div className="mt-24 flex w-full max-w-5xl flex-col gap-20 sm:mt-36 sm:gap-36">
            {FEATURES.map((f) => (
              <FeatureSection key={f.id} feature={f} />
            ))}
          </div>

          {/* Master promo film — rendered from hyperframes/studio/promo via the
              HyperFrames CLI; committed as a self-hosted asset. Muted +
              playsInline so mobile browsers allow the autoplay loop. */}
          <section data-parallax-scope className="mt-32 w-full">
            <div data-reveal className="flex flex-col items-center">
              <h2 className="font-display text-3xl text-foil-static sm:text-4xl">The full experience</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-brand-muted/70">
                One minute of what your guests experience — booth, wall, challenges and keepsakes.
              </p>
            </div>
            <div data-reveal className="mx-auto mt-10 w-full max-w-4xl">
              <div
                className="relative overflow-hidden rounded-3xl"
                style={{
                  border: '1px solid rgba(91, 140, 255, 0.4)',
                  boxShadow: '0 0 60px -12px rgba(91, 140, 255, 0.45), 0 30px 90px -30px rgba(0,0,0,0.85)',
                }}
              >
                <FilmEmbed src={promoVideo} poster={promoPoster} label="Beamwall promo video" />
              </div>
            </div>
          </section>

          {/* Live themed showcase */}
          <section data-parallax-scope className="mt-32 w-full">
            <div data-reveal className="relative flex flex-col items-center">
              <h2 className="font-display text-3xl text-foil-static sm:text-4xl">Pick a style, in one tap</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-brand-muted/70">
                Wedding, gala, birthday, corporate or party — booth, frames and wall recolor instantly, then
                fine-tune everything in the studio.
              </p>
            </div>
            <div data-reveal-stagger className="mt-10 grid w-full grid-cols-3 gap-4 sm:gap-6 mx-auto max-w-3xl">
              {showcase.map((t, i) => (
                <div key={t.id} className={`flex flex-col items-center gap-2.5 ${i === 1 ? 'sm:-translate-y-4' : ''}`}>
                  <div className="w-full">
                    <TemplatePreview template={t} />
                  </div>
                  <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">
                    {t.emoji} {t.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Pricing */}
          <section id="pricing" className="mt-32 w-full scroll-mt-8">
            <div data-reveal>
              <h2 className="font-display text-3xl text-foil-static sm:text-4xl">Simple pricing, per event</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-brand-muted/70">
                Pay only for the events you host — no subscription required. Start free, upgrade an event
                whenever you like. Frequent host? Beamwall Pro is <span className="text-brand-fg">$79/month</span> for
                premium features across every event.
              </p>
            </div>

            <div data-reveal className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                    <span className="absolute -top-2.5 left-6 rounded-full bg-foil px-3 py-1 font-label uppercase tracking-luxe text-[8px] font-bold text-white">
                      Most popular
                    </span>
                  )}
                  <h3 className="font-label uppercase tracking-luxe text-[11px] text-brand-muted/70">{t.name}</h3>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="font-display text-4xl text-foil-static">{t.price}</span>
                    <span className="font-sans text-xs text-brand-muted/50">{t.unit}</span>
                  </div>
                  <p className="mt-2 font-sans text-[12px] leading-relaxed text-brand-muted/60">{t.blurb}</p>
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
                    className={`mt-6 rounded-full px-5 py-3 text-center font-label uppercase tracking-luxe text-[10px] font-bold transition active:scale-[0.98] ${
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

          {/* Interactive showcase — the product itself, embedded as a staged
              two-column demo (copy · phone → beam → live wall). Camera only
              starts on an explicit tap inside ShowcasePhone; the heavy AR
              chunk (MediaPipe/Three) is code-split behind React.lazy. It owns
              its copy, so the section has no header of its own. */}
          <section data-parallax-scope data-showcase-root className="mt-32 w-full">
            <div data-reveal className="w-full">
              <Suspense
                fallback={
                  <div className="mx-auto h-[420px] w-full max-w-6xl animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] lg:h-[560px]" />
                }
              >
                <InteractiveShowcase />
              </Suspense>
            </div>
          </section>

          {/* Closing CTA */}
          <div data-reveal className="mt-32 flex w-full max-w-2xl flex-col items-center rounded-3xl liquid-glass px-8 py-12 text-center">
            <h2 className="font-display text-3xl text-foil-static">Ready in minutes.</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-brand-muted/75">
              Create your event, pick a style, and share the QR code. Your guests bring the moments; the
              wall brings the magic.
            </p>
            <Link
              to="/signup"
              className="mt-7 rounded-full bg-foil px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
            >
              Create your event
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="flex flex-col items-center gap-2 pb-6 pt-20 text-center">
          <span className="font-display text-lg text-foil-static">Beamwall</span>
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">
            Loved at weddings, galas &amp; milestone birthdays.
          </p>
        </footer>
      </div>
    </div>
  );
}
