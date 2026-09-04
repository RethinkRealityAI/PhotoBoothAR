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
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Album, Camera, Images, Trophy, UploadCloud } from 'lucide-react';
import { useEffect } from 'react';
import EventBackground from './ui/EventBackground';
import { Emblem } from './ui/EventLogo';
import ReportIssueButton from './support/ReportIssueButton';
import { useEvent } from '../events/EventContext';
import { useStore } from '../store';

export default function GuestWelcome() {
  const { config, basePath } = useEvent();
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
      title: 'My Photos & Videos',
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
            Try on live filters, frames &amp; 3D pieces — snap a photo or video.
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
