/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host/events/:id/share — the Share & Print kit (roadmap Phase 2).
 *
 * One QR card per guest surface (welcome, booth, wall, upload, challenges)
 * with copy-link buttons, plus a print mode: `window.print()` + the
 * #share-print-root rules in index.css turn the grid into clean table-card /
 * signage sheets. Signage should point at /welcome so guests land on
 * instructions rather than a camera-permission prompt.
 */
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Camera, Check, Copy, Images, Info, Printer, Trophy, UploadCloud } from 'lucide-react';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';
import EventBackground from '../../components/ui/EventBackground';

interface Surface {
  path: string;
  title: string;
  guestLine: string;
  icon: typeof Camera;
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      className="print:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass text-[10px] font-mono text-champagne/60 hover:text-gold-300 transition-colors w-full justify-center"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
      <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
    </button>
  );
}

export default function ShareKit() {
  const { config, basePath } = useEvent();
  const { wallSettings, fetchWallSettings } = useStore();
  useEffect(() => {
    fetchWallSettings();
  }, [fetchWallSettings]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = (path: string) => `${origin}${basePath}${path}`;

  const surfaces: Surface[] = [
    { path: '/welcome', title: 'Event Welcome', guestLine: 'Start here — everything the event offers, one scan away.', icon: Info },
    { path: '/booth', title: 'AR Photo Booth', guestLine: 'Snap photos & videos with live AR filters and frames.', icon: Camera },
    { path: '/wall', title: 'Live Photo Wall', guestLine: 'Watch everyone’s moments appear on screen in real time.', icon: Images },
    { path: '/upload', title: 'Share a Photo', guestLine: 'Send any photo from your camera roll to the wall.', icon: UploadCloud },
    ...(wallSettings.showChallenges
      ? [{ path: '/challenges', title: 'Photo Challenges', guestLine: 'Complete the event’s photo missions.', icon: Trophy }]
      : []),
  ];

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <EventBackground density={30} />
      <div className="relative z-10 min-h-full p-6 md:p-10 flex flex-col gap-6 max-w-5xl mx-auto w-full">

        <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
          <div>
            <h1 className="font-serif text-2xl text-foil-static">Share &amp; Print kit</h1>
            <p className="mt-1 font-sans text-xs text-champagne/55 max-w-lg leading-relaxed">
              Every guest surface as a scannable card. Print the sheet for table cards and
              signage — the <span className="text-gold-300">Welcome</span> code is the best
              one to post at the venue: it lands guests on instructions, not a permission prompt.
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-full bg-foil text-noir-900 px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold glow-accent transition active:scale-[0.98]"
          >
            <Printer className="w-4 h-4" /> Print signage
          </button>
        </header>

        <div id="share-print-root" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pb-10">
          {surfaces.map((s) => (
            <div
              key={s.path}
              className="share-card glass-strong rounded-3xl border border-gold-400/20 p-5 flex flex-col items-center text-center gap-3"
            >
              <div className="flex items-center gap-2">
                <s.icon className="w-4 h-4 text-gold-300" />
                <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/80">{s.title}</p>
              </div>
              <p className="font-serif italic text-base text-ivory leading-tight">{config.copy.fullName}</p>
              <div className="rounded-2xl p-3 bg-ivory">
                <QRCodeSVG value={url(s.path)} size={148} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
              </div>
              <p className="font-sans text-[11px] leading-snug text-champagne/55 min-h-[2.5em]">{s.guestLine}</p>
              <p className="hidden print:block font-sans text-[10px] text-noir-800">Scan with your phone camera</p>
              <CopyLink url={url(s.path)} />
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
