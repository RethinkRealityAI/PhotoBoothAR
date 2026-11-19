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
import { Album, ArrowRight, Camera, ChevronRight, Images, Trophy, UploadCloud } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import EventBackground from './ui/EventBackground';
import { Emblem } from './ui/EventLogo';
import PostImage from './ui/PostImage';
import ReportIssueButton from './support/ReportIssueButton';
import { useEvent } from '../events/EventContext';
import { useStore } from '../store';
import { useEntitlements } from '../lib/entitlements';
import { resolveScene } from '../lib/sceneThemes';
import { recentWallPhotos } from '../lib/scenePage';

/** Platform events get the immersive page; coded legacy events keep the
 *  original page below exactly as it shipped. */
export default function GuestWelcome() {
  const { source } = useEvent();
  return source === 'db' ? <SceneGuestWelcome /> : <LegacyGuestWelcome />;
}

function SceneGuestWelcome() {
  const { config, basePath } = useEvent();
  const fromLanding = new URLSearchParams(useLocation().search).get('from') === 'beamy-qr';
  const { videoEnabled } = useEntitlements();
  const {
    wallSettings, fetchWallSettings,
    posts, fetchPosts,
    challenges, challengesLoaded, fetchChallenges,
  } = useStore();
  useEffect(() => {
    fetchWallSettings();
    void fetchPosts();
  }, [fetchWallSettings, fetchPosts]);
  useEffect(() => {
    if (!challengesLoaded) void fetchChallenges(true);
  }, [challengesLoaded, fetchChallenges]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const eventUrl = `${origin}${basePath || ''}/welcome`;
  // Same gates as the original page (and GuestNav): never a door to an empty room.
  const hasChallenges =
    wallSettings.showChallenges !== false && challenges.some((c) => c.active);
  const slug = /^\/e\/([^/]+)/.exec(basePath)?.[1] ?? null;

  // No scene = the event's own background and today's dark ink.
  const scene = config.scene ? resolveScene(config.scene) : null;
  const tone = scene?.tone ?? 'dark';
  const vars = { '--sc-accent': scene?.accent ?? 'var(--color-accent)' } as CSSProperties;
  const photos = recentWallPhotos(posts, 8);
  const intro =
    typeof config.copy.welcomeIntro === 'string' && config.copy.welcomeIntro.trim() !== ''
      ? config.copy.welcomeIntro
      : 'This event has its own AR photo booth and live photo wall. Everything runs right here in your browser, no app to install.';

  const actions = [
    {
      to: `${basePath}/wall`,
      icon: Images,
      title: 'Live photo wall',
      blurb: 'Watch everyone’s moments land on the big screen in real time.',
    },
    {
      to: `${basePath}/me`,
      icon: Album,
      title: videoEnabled ? 'My photos and videos' : 'My photos',
      blurb: 'Everything you’ve taken here. Save it, share it, or send more.',
    },
    {
      to: `${basePath}/upload`,
      icon: UploadCloud,
      title: 'Share a photo',
      blurb: 'Already took one? Send it from your camera roll to the wall.',
    },
    ...(hasChallenges
      ? [{
          to: `${basePath}/challenges`,
          icon: Trophy,
          title: 'Photo challenges',
          blurb: 'Complete the event’s photo missions. Every shot counts.',
        }]
      : []),
  ];

  /** The room, live. Phones get a swipeable strip right under the CTA;
   *  desktop gets a collage beside the hero (newest photo large). Only one
   *  is displayed, and lazy images under display:none are never fetched. */
  const renderWall = (desk: boolean) => (
    <div className={`sc-glass rounded-[28px] p-4 sm:p-5 ${desk ? 'hidden lg:block' : 'mt-8 w-full lg:hidden'}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-sans text-[14px] font-semibold sc-ink">
          <span aria-hidden className="sc-live-dot h-2 w-2 rounded-full" style={{ background: 'var(--sc-accent)' }} />
          Live from the wall
        </p>
        <Link to={`${basePath}/wall`} className="inline-flex min-h-11 items-center gap-1 font-sans text-[13px] font-medium sc-muted hover:underline">
          Open the wall <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      {photos.length === 0 ? (
        <div className="flex aspect-[16/9] flex-col items-center justify-center gap-2 rounded-2xl text-center" style={{ boxShadow: 'inset 0 0 0 1px var(--sc-hair)' }}>
          <Images className="h-6 w-6 sc-faint" aria-hidden />
          <p className="max-w-[24ch] font-sans text-[14px] leading-snug sc-muted">The wall is waiting for its first photo. Yours could be it.</p>
        </div>
      ) : desk ? (
        <div className="grid grid-cols-3 gap-2.5">
          {/* One large (2×2) + five small fills the 3×3 grid exactly. */}
          {photos.slice(0, 6).map((p, i) => (
            <PostImage
              key={p.id}
              src={p.image_url}
              alt={p.guest_name ? `Photo by ${p.guest_name}` : 'A guest photo'}
              displayWidth={i === 0 ? 320 : 160}
              eager={i < 4}
              className={`h-full w-full rounded-2xl object-cover ${i === 0 ? 'col-span-2 row-span-2 aspect-square' : 'aspect-square'}`}
            />
          ))}
        </div>
      ) : (
        <div className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1 hide-scrollbar">
          {photos.map((p, i) => (
            <PostImage
              key={p.id}
              src={p.image_url}
              alt={p.guest_name ? `Photo by ${p.guest_name}` : 'A guest photo'}
              displayWidth={128}
              eager={i < 3}
              className="aspect-[3/4] w-32 shrink-0 snap-start rounded-2xl object-cover"
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      data-scene-ui={tone}
      style={vars}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-noir-900"
    >
      <EventBackground density={40} sparkle={0.6} />
      <div className="relative z-10 mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 sm:px-8 pt-safe-top [--safe-top:1.25rem] pb-safe-bottom [--safe-bottom:1.5rem]">

        {/* Top line: who this is, and the wall one tap away. */}
        <div className="flex items-center justify-between gap-3 animate-rise-in">
          <div className="flex min-w-0 items-center gap-2.5">
            <Emblem size={34} className="shrink-0" />
            <span className="truncate font-sans text-[14px] font-medium sc-muted">{config.copy.eventName}</span>
          </div>
          <Link
            to={`${basePath}/wall`}
            className="sc-chip pressable inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 font-sans text-[13px] font-medium"
          >
            <span aria-hidden className="sc-live-dot h-2 w-2 rounded-full" style={{ background: 'var(--sc-accent)' }} />
            Live wall
          </Link>
        </div>

        {fromLanding && (
          <p role="status" className="sc-glass mt-5 rounded-2xl px-4 py-3 text-center font-sans text-[14px] leading-relaxed sc-ink">
            Oh, you scanned it for real. Thanks for trying it out! This is a live demo event: step into the booth, then watch your shot land on the wall.
          </p>
        )}

        <main className="grid flex-1 grid-cols-[minmax(0,1fr)] items-center gap-10 py-8 sm:py-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-16">
          {/* ── Hero ── */}
          <section className="flex min-w-0 flex-col items-start animate-rise-in">
            <p className="font-sans text-[13px] font-medium sc-faint">Welcome to</p>
            <h1 className="sc-display mt-2 max-w-[14ch] text-[clamp(40px,9vw,84px)] font-semibold leading-[0.98] sc-ink break-words">
              {config.copy.fullName}
            </h1>
            {config.copy.tagline && (
              <p className="mt-4 max-w-xl font-sans text-[clamp(17px,2.2vw,21px)] leading-snug sc-muted">{config.copy.tagline}</p>
            )}
            <p className="mt-4 max-w-lg font-sans text-[15px] leading-relaxed sc-faint">{intro}</p>

            <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:items-start">
              <Link
                to={`${basePath}/booth`}
                className="sc-cta pressable group inline-flex min-h-[60px] items-center justify-center gap-3 rounded-full px-8 font-sans text-[17px] font-semibold"
              >
                <Camera className="h-5 w-5" aria-hidden />
                Step into the booth
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <p className="font-sans text-[14px] leading-relaxed sc-faint">
                {/* Same capability the booth reads: a photos-only plan must
                    not promise video. */}
                {videoEnabled
                  ? 'Try on live filters, frames and 3D pieces, then snap a photo or video.'
                  : 'Try on live filters, frames and 3D pieces, then snap a photo.'}
                {posts.length > 0 && (
                  <>
                    {' '}
                    <span className="font-medium" style={{ color: 'var(--sc-accent)' }}>
                      {posts.length} {posts.length === 1 ? 'moment' : 'moments'} on the wall so far.
                    </span>
                  </>
                )}
              </p>
            </div>

            {renderWall(false)}

            <nav aria-label="More to do here" className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:mt-10">
              {actions.map((a) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="sc-glass sc-card group flex min-h-[76px] items-center gap-4 rounded-2xl p-4"
                >
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'color-mix(in srgb, var(--sc-accent) 18%, transparent)', color: 'var(--sc-accent)' }}
                  >
                    <a.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-sans text-[15px] font-semibold sc-ink">{a.title}</span>
                    <span className="mt-0.5 block font-sans text-[13px] leading-snug sc-faint">{a.blurb}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 sc-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              ))}
            </nav>
          </section>

          {/* ── The room, live: recent photos + bring a friend ── */}
          <aside className="flex min-w-0 flex-col gap-4 animate-rise-in">
            {renderWall(true)}

            <div className="sc-glass flex items-center gap-4 rounded-[28px] p-4 sm:p-5">
              <div className="shrink-0 rounded-2xl bg-white p-2.5">
                <QRCodeSVG value={eventUrl} size={96} bgColor="#FFFFFF" fgColor="#1A1740" level="M" />
              </div>
              <div className="min-w-0">
                <p className="font-sans text-[15px] font-semibold sc-ink">Bring a friend in</p>
                <p className="mt-1 font-sans text-[13px] leading-relaxed sc-faint">
                  Have them point their camera at this code. It opens this page on their phone.
                </p>
              </div>
            </div>
          </aside>
        </main>

        {slug !== null && (
          <div className="flex justify-center">
            <ReportIssueButton
              label="Something not working? Report a problem"
              iconSize={14}
              prefill={{ source: 'guest_booth', eventSlug: slug }}
              className="pressable flex min-h-11 items-center gap-2 font-sans text-[13px] sc-faint hover:underline"
            />
          </div>
        )}
      </div>
    </div>
  );
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
              ? <>Try on live filters, frames &amp; 3D pieces — snap a photo or video.</>
              : <>Try on live filters, frames &amp; 3D pieces — and snap a photo.</>}
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
