/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The hub's Showcase tab: real events to send a prospect as proof. Each card
 * switches between the guest booth and the live wall, and gives a copyable
 * link, the native share sheet, and a QR that scans off the screen in a
 * meeting or downloads as a print-ready PNG for a slide or flyer.
 */
import { useRef, useState } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { Download, ExternalLink, Share2, ShieldAlert } from 'lucide-react';
import {
  SHOWCASE_EVENTS, SHOWCASE_LINK_LABEL, qrFileName, showcaseShareText, type ShowcaseEvent, type ShowcaseLinkId,
} from '../../../lib/salesShowcase';
import { salesImage } from '../salesImages';
import CopyButton from './CopyButton';

const TIER_LABEL: Record<ShowcaseEvent['tier'], string> = {
  flagship: 'Flagship',
  demo: 'Demo event',
  legacy: 'Past client',
};

const ROUND =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-brand-fg transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]';

function ShowcaseCard({ ev }: { ev: ShowcaseEvent }) {
  const [link, setLink] = useState<ShowcaseLinkId>('booth');
  const [note, setNote] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const url = ev.links[link];
  const art = salesImage(ev.image);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote(null), 2200);
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    try {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = qrFileName(ev, link);
      document.body.appendChild(a);
      a.click();
      a.remove();
      flash('QR code downloaded');
    } catch {
      flash('Couldn’t make the QR image. Screenshot the code instead.');
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: ev.name, text: showcaseShareText(ev, link), url });
    } catch (e) {
      // AbortError = closed the sheet on purpose; anything else = say so.
      if ((e as { name?: string }).name !== 'AbortError') flash('Sharing isn’t available here. Use Copy link.');
    }
  };

  return (
    <article className="flex flex-col overflow-hidden rounded-[26px] liquid-glass">
      {/* Art */}
      <div className="relative h-40 overflow-hidden sm:h-44">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: `radial-gradient(120% 90% at 70% 100%, rgba(${ev.rgb}, 0.38), transparent 62%), linear-gradient(160deg, rgba(255,255,255,0.05), transparent)` }}
        />
        {art !== null && (
          <img
            src={art.src}
            width={art.width}
            height={art.height}
            alt=""
            loading="lazy"
            className="absolute bottom-0 right-3 h-[94%] w-auto max-w-[46%] object-contain object-bottom drop-shadow-[0_18px_30px_rgba(0,0,0,0.45)]"
          />
        )}
        <div className="relative p-5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-brand-fg backdrop-blur"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: `rgb(${ev.rgb})`, boxShadow: `0 0 8px rgb(${ev.rgb})` }} aria-hidden />
            {TIER_LABEL[ev.tier]}
          </span>
          <p className="mt-3 font-label text-[10.5px] font-semibold uppercase tracking-[0.22em] text-brand-muted">{ev.kind}</p>
          <h3 className="mt-1 max-w-[56%] font-serif text-[26px] font-semibold leading-[1.05] text-brand-fg">{ev.name}</h3>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5 pt-4">
        <p className="text-[14px] leading-snug text-brand-fg/85">{ev.pitch}</p>

        <div role="radiogroup" aria-label={`${ev.name} link`} className="liquid-glass-inset flex rounded-full p-1">
          {(Object.keys(SHOWCASE_LINK_LABEL) as ShowcaseLinkId[]).map((id) => {
            const on = id === link;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setLink(id)}
                className={`min-h-10 flex-1 rounded-full px-3 font-label text-[10.5px] font-bold uppercase tracking-[0.14em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
                  on ? 'bg-foil text-white shadow-[0_6px_20px_-8px_rgba(91,140,255,0.8)]' : 'text-brand-muted hover:text-brand-fg'
                }`}
              >
                {SHOWCASE_LINK_LABEL[id]}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4">
          <div className="shrink-0 rounded-2xl bg-white p-2.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)]">
            <QRCodeSVG value={url} size={112} bgColor="#ffffff" fgColor="#0b0d17" level="M" title={`QR code: ${ev.name} ${SHOWCASE_LINK_LABEL[link]}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-brand-muted">
              {link === 'booth' ? 'Scan to try the booth on a phone.' : 'Open on a laptop or TV to see the wall.'}
            </p>
            <p className="mt-1 break-all font-mono text-[12px] leading-snug text-brand-fg/80">{url.replace(/^https:\/\//, '')}</p>
          </div>
        </div>
        <QRCodeCanvas ref={canvasRef} value={url} size={1024} marginSize={4} bgColor="#ffffff" fgColor="#000000" level="M" className="hidden" aria-hidden />

        {link === 'wall' && ev.realGuests && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-3 py-2 text-[12px] leading-snug text-amber-50/85">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" aria-hidden />
            Real guests’ photos. Show it in a meeting freely; ask the host before sending the wall link on.
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2">
          <CopyButton text={url} label="Copy link" ariaLabel={`Copy ${SHOWCASE_LINK_LABEL[link]} link for ${ev.name}`} />
          {canShare && (
            <button type="button" onClick={() => void share()} aria-label={`Share ${ev.name}`} className={ROUND}>
              <Share2 className="h-4 w-4" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={download}
            aria-label={`Download the QR code for ${ev.name} ${SHOWCASE_LINK_LABEL[link]}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 font-label text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-fg transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
          >
            <Download className="h-4 w-4" aria-hidden /> QR
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${ev.name} ${SHOWCASE_LINK_LABEL[link]} in a new tab`} className={ROUND}>
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
        <p role="status" aria-live="polite" className="min-h-[1.25rem] text-[12px] text-emerald-300/90">{note ?? ''}</p>
      </div>
    </article>
  );
}

export default function HubShowcase() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {SHOWCASE_EVENTS.map((ev) => <ShowcaseCard key={ev.id} ev={ev} />)}
    </div>
  );
}
