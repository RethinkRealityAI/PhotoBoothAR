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
import { Album, Camera, ChevronRight, Images, Trophy, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import EventBackground from './ui/EventBackground';
import { Emblem } from './ui/EventLogo';
import ReportIssueButton from './support/ReportIssueButton';
import LiveWallField from './theme/LiveWallField';
import BoothViewfinder from './theme/BoothViewfinder';
import PageBorder from './theme/PageBorder';
import { useEvent } from '../events/EventContext';
import { useStore } from '../store';
import { useEntitlements } from '../lib/entitlements';
import { resolveScene } from '../lib/sceneThemes';
import { heroFrameUrl, wallFieldPhotos } from '../lib/scenePage';
import { buildCatalog } from '../lib/catalog';
import { effectiveOpeningLookId } from '../lib/openingLook';
import { subscribeToPosts } from '../lib/db';
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
  const { config, basePath, eventId } = useEvent();
  const fromLanding = new URLSearchParams(useLocation().search).get('from') === 'beamy-qr';
  const { videoEnabled } = useEntitlements();
  const {
    wallSettings, fetchWallSettings,
    posts, fetchPosts, prependPost, updatePost, removePost,
    challenges, challengesLoaded, fetchChallenges,
    experiences, linkedGlobals, experiencesLoaded, fetchExperiences,
    presetOverrides, fetchPresetOverrides,
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

  // No scene = the event's own background and today's dark ink.
  const scene = config.scene ? resolveScene(config.scene) : null;
  const tone = scene?.tone ?? 'dark';
  const vars = { '--sc-accent': scene?.accent ?? 'var(--color-accent)' } as CSSProperties;
  const wallPhotos = useMemo(() => wallFieldPhotos(posts), [posts]);
  const newest = wallPhotos[wallPhotos.length - 1];
  const frameUrl = useMemo(() => {
    const catalog = buildCatalog(
      config.arContent,
      experiencesLoaded ? experiences : [],
      presetOverrides,
      experiencesLoaded ? linkedGlobals : [],
      true,
    );
    return heroFrameUrl(catalog, effectiveOpeningLookId(wallSettings.defaultExperienceId, config.defaultExperienceId));
  }, [config.arContent, config.defaultExperienceId, experiences, experiencesLoaded, linkedGlobals, presetOverrides, wallSettings.defaultExperienceId]);
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

  const moments = posts.length;

  return (
    <div
      data-scene-ui={tone}
      style={vars}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-noir-900"
    >
      <EventBackground density={40} sparkle={0.6} />
      {/* The wall stays put while the page scrolls over it. */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <LiveWallField photos={wallPhotos} fresh={fresh} />
      </div>
      {config.scene?.border && <PageBorder border={config.scene.border} />}
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

        <main className="grid flex-1 grid-cols-[minmax(0,1fr)] items-start gap-x-16 gap-y-8 py-8 sm:py-12 [grid-template-areas:'head'_'vf'_'rest'_'qr'] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:grid-rows-[auto_1fr_auto] lg:[grid-template-areas:'head_vf'_'rest_vf'_'rest_qr']">
          {/* ── Hero: the room's pulse, then the name ── */}
          <section className="flex min-w-0 flex-col items-start animate-rise-in [grid-area:head] lg:pt-6">
            {moments > 0 ? (
              <Link
                to={`${basePath}/wall`}
                aria-live="polite"
                className="sc-chip pressable inline-flex min-h-11 items-center gap-2.5 rounded-full px-4 font-sans text-[14px] font-semibold"
              >
                <span aria-hidden className="sc-live-dot h-2.5 w-2.5 rounded-full" style={{ background: 'var(--sc-accent)', boxShadow: '0 0 12px var(--sc-accent)' }} />
                Guests are snapping
                <span className="sc-faint font-medium">· {moments} {moments === 1 ? 'moment' : 'moments'}</span>
              </Link>
            ) : (
              <div className="sc-glass flex items-center gap-3 rounded-2xl py-3 pl-3 pr-5">
                <span
                  aria-hidden
                  className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--sc-accent) 20%, transparent)', color: 'var(--sc-accent)' }}
                >
                  <span className="sc-live-dot absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 0 1.5px var(--sc-accent)' }} />
                  <Images className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-sans text-[15px] font-semibold sc-ink">Time to fill the wall</span>
                  <span className="block font-sans text-[13px] leading-snug sc-muted">Your photo could be the first one up here.</span>
                </span>
              </div>
            )}
            <p className="mt-7 font-sans text-[13px] font-medium sc-faint">Welcome to</p>
            <h1 className="sc-display mt-2 max-w-[14ch] text-[clamp(42px,9.5vw,92px)] font-semibold leading-[0.96] sc-ink break-words">
              {config.copy.fullName}
            </h1>
            {config.copy.tagline && (
              <p className="mt-4 max-w-xl font-sans text-[clamp(17px,2.2vw,22px)] leading-snug sc-muted">{config.copy.tagline}</p>
            )}
          </section>

          {/* ── The booth, previewed: its shutter is the way in ── */}
          <div className="flex min-w-0 flex-col items-center gap-4 animate-rise-in [grid-area:vf] lg:items-end lg:justify-center lg:self-center">
            <BoothViewfinder
              to={`${basePath}/booth`}
              frameUrl={frameUrl}
              previewUrl={newest?.image_url}
              previewAlt={newest ? (newest.guest_name ? `The newest photo, by ${newest.guest_name}` : 'The newest guest photo') : undefined}
            />
          </div>

          <section className="flex min-w-0 flex-col items-start animate-rise-in [grid-area:rest]">
            <p className="max-w-lg font-sans text-[15px] leading-relaxed sc-muted">{intro}</p>
            <p className="mt-3 max-w-lg font-sans text-[14px] leading-relaxed sc-faint">
              {/* Same capability the booth reads: a photos-only plan must
                  not promise video. */}
              {videoEnabled
                ? 'Try on live filters, frames and 3D pieces, then snap a photo or video for the wall.'
                : 'Try on live filters, frames and 3D pieces, then snap a photo for the wall.'}
            </p>

            <nav aria-label="More to do here" className="mt-7 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
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

          {/* ── Bring a friend ── */}
          <aside className="flex min-w-0 flex-col animate-rise-in [grid-area:qr] lg:ml-auto lg:w-full lg:max-w-[420px]">
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
