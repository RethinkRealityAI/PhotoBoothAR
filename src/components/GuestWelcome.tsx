/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /e/:slug/welcome — the event's guest landing page: what this is, what you
 * can do here, one tap into each surface (booth / wall / upload / challenges),
 * plus a share block with the event QR. Designed to read equally well on a
 * guest's phone and on a venue screen or printed table card (hosts can point
 * signage QR codes at this route so guests land on instructions, not a
 * camera permission prompt).
 */
import { Link, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Album, Camera, Check, ChevronRight, Images, Link2, Trophy, UploadCloud } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Emblem } from './ui/EventLogo';
import EventBackground from './ui/EventBackground';
import ReportIssueButton from './support/ReportIssueButton';
import LiveWallField from './theme/LiveWallField';
import { WALL_FIELD_SAMPLES } from './theme/samplePhotos';
import BoothViewfinder, { VF_HEIGHT_PER_WIDTH } from './theme/BoothViewfinder';
import PageBorder from './theme/PageBorder';
import ThemePackBackdrop, { hasThemeBackdrop } from './theme/ThemePackBackdrop';
import { useBoothScreen } from './theme/useBoothShot';
import { useEvent } from '../events/EventContext';
import { useStore } from '../store';
import { useEntitlements } from '../lib/entitlements';
import { resolveScene } from '../lib/sceneThemes';
import { themeTone } from '../lib/themePacks';
import { wallFieldPhotos } from '../lib/scenePage';
import { subscribeToPosts } from '../lib/db';
import { FROM_WELCOME_STATE } from '../lib/guestFlow';
import { PrivacyLine } from './booth/Welcome';
import { isPlatformBooth, useViewportLock } from '../lib/boothViewport';
import type { Post } from '../types';

/** Platform events get the immersive page; coded legacy events keep the
 *  original page below exactly as it shipped. */
export default function GuestWelcome() {
  const { source } = useEvent();
  return source === 'db' ? <SceneGuestWelcome /> : <LegacyGuestWelcome />;
}

/**
 * The platform page reads as the event's booth and wall, not a landing page:
 * the whole background is the live photo wall (LiveWallField), the hero is a
 * preview of the booth whose shutter is the way in (BoothViewfinder), and the
 * host may put a border round it all (PageBorder).
 */
function SceneGuestWelcome() {
  const { config, basePath, eventId, source } = useEvent();
  const fromLanding = new URLSearchParams(useLocation().search).get('from') === 'beamy-qr';
  const { videoEnabled } = useEntitlements();
  // The page scrolls inside its own scroller; pin the DOCUMENT so iOS's
  // 100vh-vs-visible gap can't double-scroll it, and the booth opens from the
  // top. Scroll lock only — pinch-zoom stays available here (WCAG 1.4.4).
  useViewportLock(isPlatformBooth(source), false);
  const {
    wallSettings, fetchWallSettings,
    posts, fetchPosts, prependPost, updatePost, removePost,
    challenges, challengesLoaded, fetchChallenges,
    experiencesLoaded, fetchExperiences, fetchPresetOverrides,
  } = useStore();
  useEffect(() => {
    fetchWallSettings();
    void fetchPosts();
  }, [fetchWallSettings, fetchPosts]);
  useEffect(() => {
    if (!challengesLoaded) void fetchChallenges(true);
  }, [challengesLoaded, fetchChallenges]);
  // The booth's catalogue, for the frame drawn over the preview.
  useEffect(() => {
    if (!experiencesLoaded) void fetchExperiences(true);
    void fetchPresetOverrides();
  }, [experiencesLoaded, fetchExperiences, fetchPresetOverrides]);

  // Photos snapped while this page is open beam onto the wall at once.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const arrive = (p: Post) => {
      if (!p.approved || p.hidden) return;
      setFresh((prev) => new Set(prev).add(p.id));
      prependPost(p);
    };
    return subscribeToPosts(eventId, {
      onInsert: arrive,
      onUpdate: (p) => {
        // A pre-moderated post approved just now is an arrival, not an edit.
        if (useStore.getState().posts.some((x) => x.id === p.id)) updatePost(p);
        else arrive(p);
      },
      onDelete: removePost,
    }, { visibleOnly: true });
  }, [eventId, prependPost, updatePost, removePost]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const eventUrl = `${origin}${basePath || ''}/welcome`;
  // Same gates as the original page (and GuestNav): never a door to an empty room.
  const hasChallenges =
    wallSettings.showChallenges !== false && challenges.some((c) => c.active);
  const slug = /^\/e\/([^/]+)/.exec(basePath)?.[1] ?? null;

  // A full theme pack (lib/themePacks) dresses the whole page: its own
  // paper-cut scene replaces the scene, the living wall and the border.
  const theme = source === 'db' && hasThemeBackdrop(config.theme) ? config.theme : undefined;
  // No scene = the event's own background and today's dark ink.
  const scene = !theme && config.scene ? resolveScene(config.scene) : null;
  const tone = themeTone(theme) ?? scene?.tone ?? 'dark';
  const vars = { '--sc-accent': scene?.accent ?? 'var(--color-accent)' } as CSSProperties;
  const wallPhotos = useMemo(() => wallFieldPhotos(posts), [posts]);
  // Until the first photo lands the wall shows stand-ins, never bare glass.
  const fieldPhotos = wallPhotos.length > 0 ? wallPhotos : WALL_FIELD_SAMPLES;
  // The phone shows the event's frame on a stand-in guest (or a finished
  // look), never a wall photo: the wall behind already shows the room.
  const screen = useBoothScreen();
  // Desktop: the phone is exactly as tall as the left column (title to the
  // last row of cards), so its top and bottom line up with them.
  const leftRef = useRef<HTMLDivElement>(null);
  const phoneWidth = useColumnPhoneWidth(leftRef);
  // The host's own words only: the page no longer explains itself by default.
  const intro =
    typeof config.copy.welcomeIntro === 'string' && config.copy.welcomeIntro.trim() !== ''
      ? config.copy.welcomeIntro
      : null;

  const actions = [
    { to: `${basePath}/wall`, icon: Images, title: 'Live photo wall' },
    { to: `${basePath}/me`, icon: Album, title: videoEnabled ? 'My photos and videos' : 'My photos' },
    { to: `${basePath}/upload`, icon: UploadCloud, title: 'Share a photo' },
    ...(hasChallenges ? [{ to: `${basePath}/challenges`, icon: Trophy, title: 'Photo challenges' }] : []),
  ];


  // The QR's companion: copy the page link. navigator.clipboard is undefined
  // outside a secure context and writeText rejects when the page is not
  // focused, so a failure shows the link itself to copy by hand.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copyState !== 'copied') return;
    const t = setTimeout(() => setCopyState('idle'), 2200);
    return () => clearTimeout(t);
  }, [copyState]);
  const copyLink = () => {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip?.writeText) { setCopyState('failed'); return; }
    clip.writeText(eventUrl).then(() => setCopyState('copied'), () => setCopyState('failed'));
  };

  const scanToJoin = (
    <div className="sc-glass flex w-full max-w-[440px] items-center gap-5 rounded-[26px] p-3 pr-5">
      <span className="sc-rim" aria-hidden style={{ ['--rim-d' as string]: '-3.4s' }}><span /></span>
      <div className="shrink-0 rounded-[16px] bg-white p-2">
        <QRCodeSVG value={eventUrl} size={128} bgColor="#FFFFFF" fgColor={theme ? (config.themeVars?.['--color-brand-bg'] ?? '#1A1740') : '#1A1740'} level="M" title="QR code for this event page" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-sans text-[18px] font-semibold sc-ink">Scan to join</p>
        <button
          type="button"
          onClick={copyLink}
          className="sc-chip pressable mt-2 inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 font-sans text-[13px] font-medium"
        >
          {copyState === 'copied' ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
          {copyState === 'copied' ? 'Link copied' : 'Copy link'}
        </button>
        <span className="sr-only" aria-live="polite">{copyState === 'copied' ? 'Link copied' : ''}</span>
        {copyState === 'failed' && (
          <p className="mt-2 select-all break-all font-sans text-[12px] leading-snug sc-muted">{eventUrl}</p>
        )}
      </div>
    </div>
  );

  return (
    <div
      data-scene-ui={tone}
      style={vars}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-noir-900"
    >
      {theme ? (
        // The pack's scene stays put while the page scrolls over it.
        <div className="pointer-events-none fixed inset-0 z-0">
          <ThemePackBackdrop theme={theme} />
        </div>
      ) : (
        <>
          <EventBackground density={40} sparkle={0.6} />
          {/* The wall stays put while the page scrolls over it. */}
          <div className="pointer-events-none fixed inset-0 z-0">
            <LiveWallField photos={fieldPhotos} fresh={fresh} />
          </div>
          {config.scene?.border && <PageBorder border={config.scene.border} />}
        </>
      )}
      <div className="relative z-10 mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 sm:px-8 pt-safe-top [--safe-top:1.25rem] pb-safe-bottom [--safe-bottom:1.5rem]">

        {fromLanding && (
          <p role="status" className="sc-glass mt-3 rounded-2xl px-4 py-3 text-center font-sans text-[14px] leading-relaxed sc-ink lg:mt-5">
            Oh, you scanned it for real. Thanks for trying it out! This is a live demo event: step into the booth, then watch your shot land on the wall.
          </p>
        )}

        {/* Phones: one column, name, phone, cards. Desktop: the left column
            (title, QR, cards) sits in one block centred in the viewport and
            the phone matches its height exactly (useColumnPhoneWidth). */}
        <main className="grid flex-1 grid-cols-[minmax(0,1fr)] items-start gap-x-14 gap-y-5 pb-6 pt-1 [grid-template-areas:'head'_'vf'_'qr'_'rest'] lg:flex lg:items-center lg:justify-between lg:py-8">
          <div ref={leftRef} className="contents lg:flex lg:h-[min(calc(100dvh-176px),820px)] lg:min-h-[480px] lg:min-w-0 lg:max-w-[640px] lg:flex-1 lg:flex-col lg:justify-between">
          {/* ── Hero: the name first ── */}
          <section className="flex min-w-0 flex-col items-center text-center animate-rise-in [grid-area:head] lg:items-start lg:text-left">
            <h1 className="sc-display max-w-[14ch] text-[clamp(38px,11vw,92px)] font-semibold leading-[0.96] sc-ink break-words lg:text-[clamp(44px,min(6.2vw,10vh),96px)]">
              {config.copy.fullName}
            </h1>
            {config.copy.tagline && (
              <p className="sc-tagline mt-2 max-w-xl font-sans text-[clamp(16px,2.2vw,22px)] leading-snug sc-muted lg:mt-4">{config.copy.tagline}</p>
            )}
          </section>

          {/* Desktop: Scan to join between the name and the cards; the
              column spreads the three evenly down the phone's height. */}
          <div className="hidden w-full lg:block">{scanToJoin}</div>

          {/* Tablets: Scan to join under the phone. Never on a phone: the
              guest is already holding the device the QR would open. */}
          <div className="hidden justify-center [grid-area:qr] sm:flex lg:hidden">{scanToJoin}</div>

          <section className="flex min-w-0 flex-col items-start animate-rise-in [grid-area:rest]">
            {intro && <p className="mb-5 max-w-lg font-sans text-[15px] leading-relaxed sc-muted">{intro}</p>}
            <nav aria-label="More to do here" className="grid w-full grid-cols-2 gap-3 lg:gap-4">
              {actions.map((a, i) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="sc-glass sc-card group flex min-h-[60px] items-center lg:min-h-[72px] gap-3 rounded-2xl px-3.5 py-3"
                >
                  <span className="sc-rim" aria-hidden style={{ ['--rim-d' as string]: `-${(i * 1.7).toFixed(1)}s` }}><span /></span>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'color-mix(in srgb, var(--sc-accent) 18%, transparent)', color: 'var(--sc-accent)' }}
                  >
                    <a.icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 font-sans text-[14px] font-semibold leading-tight sc-ink">{a.title}</span>
                  <ChevronRight className="hidden h-4 w-4 shrink-0 sc-faint transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden />
                </Link>
              ))}
            </nav>
          </section>
          </div>

          {/* ── The booth, previewed ── */}
          <div
            className="flex min-w-0 flex-col items-center animate-rise-in [grid-area:vf] lg:shrink-0"
            style={phoneWidth ? { width: phoneWidth } : undefined}
          >
            <BoothViewfinder
              to={`${basePath}/booth`}
              // The booth skips its own "Step inside" splash for this tap,
              // so the camera line that splash carried is shown below.
              linkState={FROM_WELCOME_STATE}
              frameUrl={screen.frame}
              previewUrl={screen.photo}
              widthClass="w-[min(80vw,330px)] lg:w-full"
            />
            {/* Desktop carries this line in the footer, so the phone's bottom
                stays level with the action cards. */}
            <div className="mt-4 text-center lg:hidden">
              <PrivacyLine />
            </div>
          </div>

        </main>

        <footer className="flex flex-col items-center gap-x-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="hidden max-w-[760px] lg:block [&_p]:max-w-none">
            <PrivacyLine />
          </div>
          {slug !== null && (
            <ReportIssueButton
              label="Something not working? Report a problem"
              iconSize={14}
              prefill={{ source: 'guest_booth', eventSlug: slug }}
              className="pressable flex min-h-11 shrink-0 items-center gap-2 font-sans text-[13px] sc-faint hover:underline"
            />
          )}
        </footer>
      </div>
    </div>
  );
}

/** Phone outer width (px) whose height equals the measured column's, on
 *  desktop only (undefined on narrower screens, where CSS sizes it). The
 *  device's height is VF_HEIGHT_PER_WIDTH times its width. */
const DESKTOP_MQ = '(min-width: 1024px)';
function useColumnPhoneWidth(ref: RefObject<HTMLDivElement | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;
    const mq = window.matchMedia(DESKTOP_MQ);
    const measure = () => {
      if (!mq.matches) { setWidth(undefined); return; }
      const h = el.getBoundingClientRect().height;
      if (h <= 0) return;
      setWidth(Math.round(h / VF_HEIGHT_PER_WIDTH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    mq.addEventListener('change', measure);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', measure);
    };
  }, [ref]);
  return width;
}

function LegacyGuestWelcome() {
  const { config, basePath } = useEvent();
  /** Arrived from the landing page's real QR code (its Easter egg): say hello. */
  const fromLanding = new URLSearchParams(useLocation().search).get('from') === 'beamy-qr';
  const { videoEnabled } = useEntitlements();
  const {
    wallSettings, fetchWallSettings,
    posts, fetchPosts,
    challenges, challengesLoaded, fetchChallenges,
  } = useStore();
  useEffect(() => {
    fetchWallSettings();
    // Powers the live "N moments so far" line under the booth CTA.
    void fetchPosts();
  }, [fetchWallSettings, fetchPosts]);
  useEffect(() => {
    if (!challengesLoaded) void fetchChallenges(true);
  }, [challengesLoaded, fetchChallenges]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const eventUrl = `${origin}${basePath || ''}/welcome`;
  /** Same gate as GuestNav: the setting must not be off AND the event must
   *  actually have authored, active challenges — never a door to an empty room. */
  const hasChallenges =
    wallSettings.showChallenges !== false && challenges.some((c) => c.active);
  /** `/e/<slug>` → slug; only platform events have a support desk. */
  const slug = /^\/e\/([^/]+)/.exec(basePath)?.[1] ?? null;

  const actions = [
    {
      to: `${basePath}/wall`,
      icon: Images,
      title: 'Live Photo Wall',
      blurb: 'Watch everyone’s moments appear on the big screen in real time.',
    },
    {
      // The one thing a guest comes BACK for. /e/:slug/me was reachable only
      // from inside the review panel and the send-off screen, i.e. only in the
      // ~30 seconds after taking a shot — so a guest who closed the tab and
      // returned later had no route to their own photos from the hub at all.
      to: `${basePath}/me`,
      icon: Album,
      // Same capability as the booth sentence below: a photos-only plan must
      // not promise videos (legacy resolves video on → the old title).
      title: videoEnabled ? 'My Photos & Videos' : 'My Photos',
      blurb: 'Everything you’ve taken here — save it, share it, or send more.',
    },
    {
      to: `${basePath}/upload`,
      icon: UploadCloud,
      title: 'Share a Photo',
      blurb: 'Already took one? Send any photo from your camera roll to the wall.',
    },
    ...(hasChallenges
      ? [{
          to: `${basePath}/challenges`,
          icon: Trophy,
          title: 'Photo Challenges',
          blurb: 'Complete the event’s photo missions — every shot counts.',
        }]
      : []),
  ];

  return (
    <div className="absolute inset-0 overflow-y-auto bg-noir-900">
      <EventBackground density={40} sparkle={0.6} />
      <div className="relative z-10 max-w-md mx-auto px-5 pt-safe-top [--safe-top:2.5rem] pb-safe-bottom [--safe-bottom:3.5rem] flex flex-col items-center gap-7">

        {fromLanding && (
          <p role="status" className="w-full glass rounded-2xl px-4 py-3 text-center font-sans text-[13px] leading-relaxed text-ivory">
            Oh, you scanned it for real. Thanks for trying it out! This is a live demo event: step into the booth, then watch your shot land on the wall.
          </p>
        )}

        <div className="flex flex-col items-center gap-3 text-center animate-rise-in">
          <Emblem size={56} className="drop-shadow-[0_0_14px_rgba(var(--accent-rgb),0.4)]" />
          <div>
            <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/50">Welcome to</p>
            <h1 className="mt-1 font-serif text-3xl leading-tight text-foil-static">{config.copy.fullName}</h1>
            {config.copy.tagline && (
              <p className="mt-1.5 font-sans text-[13px] text-champagne/60">{config.copy.tagline}</p>
            )}
          </div>
          <p className="font-sans text-[13px] leading-relaxed text-champagne/70 max-w-xs">
            {/* Generated/host-edited intro (DB events with config.copy.welcomeIntro);
                legacy coded events have no such key and keep the exact literal. */}
            {typeof config.copy.welcomeIntro === 'string' && config.copy.welcomeIntro.trim() !== '' ? (
              config.copy.welcomeIntro
            ) : (
              <>
                This event has its own AR photo booth and live photo wall — everything runs
                right here in your browser. No app to install.
              </>
            )}
          </p>
        </div>

        {/* THE thing to do here — one big primary door into the booth, with a
            live pulse of the room underneath it. */}
        <div className="w-full flex flex-col gap-2">
          <Link
            to={`${basePath}/booth`}
            className="pressable w-full bg-foil text-[color:var(--on-accent)] rounded-2xl px-5 py-4 flex items-center justify-center gap-3 glow-accent font-label uppercase tracking-luxe text-[12px] font-bold active:scale-[0.99] transition-all"
          >
            <Camera className="w-5 h-5" />
            Step into the AR Photo Booth
          </Link>
          <p className="text-center font-sans text-[12.5px] text-champagne/70">
            {/* Same capability the booth reads (Booth.tsx videoAllowed): a
                photos-only plan must not promise video. Legacy sites resolve
                LEGACY_ENTITLEMENTS (video on), so their copy is unchanged. */}
            {videoEnabled
              ? <>Try on frames, props, face paint &amp; effects — snap a photo or video.</>
              : <>Try on frames, props, face paint &amp; effects — and snap a photo.</>}
            {posts.length > 0 && (
              <>
                {' '}
                <span className="text-[color:var(--color-accent)]">
                  {posts.length} {posts.length === 1 ? 'moment' : 'moments'} on the wall so far.
                </span>
              </>
            )}
          </p>
        </div>

        <div className="w-full flex flex-col gap-3">
          {actions.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="group flex items-center gap-4 glass rounded-2xl p-4 border border-transparent hover:border-gold-400/30 transition-all active:scale-[0.99]"
            >
              <div className="w-11 h-11 shrink-0 rounded-full bg-foil glow-accent flex items-center justify-center">
                <a.icon className="w-5 h-5 text-noir-900" />
              </div>
              <div className="min-w-0">
                <p className="font-label uppercase tracking-wide text-[11px] text-ivory group-hover:text-gold-300 transition-colors">{a.title}</p>
                <p className="mt-0.5 font-sans text-[12.5px] leading-snug text-champagne/70">{a.blurb}</p>
              </div>
            </Link>
          ))}
        </div>

        <div className="w-full glass rounded-2xl p-5 flex items-center gap-4">
          <div className="rounded-xl p-2 bg-ivory/95 shrink-0">
            <QRCodeSVG value={eventUrl} size={92} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
          </div>
          <div className="min-w-0">
            <p className="font-label uppercase tracking-wide text-[10px] text-champagne/70">Bring a friend in</p>
            <p className="mt-1 font-sans text-[12.5px] leading-relaxed text-champagne/70">
              Have them point their camera at this code — it opens this page on their phone.
            </p>
          </div>
        </div>

        {/* Footer — a quiet human way out when something's broken. Only
            platform events have a support desk (same gate as BoothTopBar). */}
        {slug !== null && (
          <ReportIssueButton
            label="Something not working? Report a problem"
            iconSize={13}
            prefill={{ source: 'guest_booth', eventSlug: slug }}
            className="pressable flex min-h-11 items-center gap-2 font-label uppercase tracking-luxe text-[10px] text-champagne/45 hover:text-ivory transition-colors"
          />
        )}

      </div>
    </div>
  );
}
