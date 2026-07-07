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
import { Camera, Images, Trophy, UploadCloud } from 'lucide-react';
import { useEffect } from 'react';
import EventBackground from './ui/EventBackground';
import { Emblem } from './ui/EventLogo';
import { useEvent } from '../events/EventContext';
import { useStore } from '../store';

export default function GuestWelcome() {
  const { config, basePath } = useEvent();
  const { wallSettings, fetchWallSettings } = useStore();
  useEffect(() => {
    fetchWallSettings();
  }, [fetchWallSettings]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const eventUrl = `${origin}${basePath || ''}/welcome`;

  const actions = [
    {
      to: `${basePath}/booth`,
      icon: Camera,
      title: 'AR Photo Booth',
      blurb: 'Try on live filters, frames & 3D pieces — snap a photo or video.',
    },
    {
      to: `${basePath}/wall`,
      icon: Images,
      title: 'Live Photo Wall',
      blurb: 'Watch everyone’s moments appear on the big screen in real time.',
    },
    {
      to: `${basePath}/upload`,
      icon: UploadCloud,
      title: 'Share a Photo',
      blurb: 'Already took one? Send any photo from your camera roll to the wall.',
    },
    ...(wallSettings.showChallenges
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
      <div className="relative z-10 max-w-md mx-auto px-5 pt-safe-top pt-10 pb-14 flex flex-col items-center gap-7">

        <div className="flex flex-col items-center gap-3 text-center animate-rise-in">
          <Emblem size={56} className="drop-shadow-[0_0_14px_rgba(var(--accent-rgb),0.4)]" />
          <div>
            <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/50">Welcome to</p>
            <h1 className="mt-1 font-serif text-3xl leading-tight text-foil-static">{config.copy.fullName}</h1>
            {config.copy.tagline && (
              <p className="mt-1.5 font-sans text-[13px] text-champagne/60">{config.copy.tagline}</p>
            )}
          </div>
          <p className="font-sans text-[12px] leading-relaxed text-champagne/50 max-w-xs">
            This event has its own AR photo booth and live photo wall — everything runs
            right here in your browser. No app to install.
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
                <p className="mt-0.5 font-sans text-[11.5px] leading-snug text-champagne/55">{a.blurb}</p>
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
            <p className="mt-1 font-sans text-[11.5px] leading-relaxed text-champagne/50">
              Have them point their camera at this code — it opens this page on their phone.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
