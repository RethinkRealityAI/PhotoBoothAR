/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ShareActions — the guest link's QR plus "Download QR" (a print-size PNG),
 * "Share" (the phone's own share sheet via navigator.share) and "Copy link".
 * Share falls back to copying when the browser has no share sheet or the
 * host cancels it, so the button always does something visible.
 */
import { useRef, useState } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Download, Share2 } from 'lucide-react';
import { copyText } from '../../lib/clipboard';

interface Props {
  url: string;
  /** Used for the PNG file name and the share sheet title. */
  eventName: string;
  slug: string;
  /** On-screen QR size in CSS px. */
  qrSize?: number;
  /**
   * 'row' (default): QR beside the link and three buttons.
   * 'stacked': Download QR full-width under the QR; the link, Copy link and
   * Share stacked beside it — no button text ever wraps.
   */
  layout?: 'row' | 'stacked';
}

const BTN =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-[13px] font-semibold text-brand-fg transition hover:bg-white/[0.06] active:scale-[0.98]';

export default function ShareActions({ url, eventName, slug, qrSize = 132, layout = 'row' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const flash = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote(null), 2500);
  };

  const copy = async () => {
    const ok = await copyText(url);
    flash(ok ? 'Link copied' : 'Couldn’t copy — press and hold the link to copy it');
  };

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: eventName, text: `Join ${eventName} on Beamwall`, url });
        return;
      } catch (e) {
        // AbortError = the host closed the sheet; anything else = no sheet.
        if ((e as { name?: string }).name === 'AbortError') return;
      }
    }
    await copy();
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${slug}-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      flash('QR code downloaded');
    } catch {
      flash('Couldn’t make the QR image — use Print signage instead');
    }
  };

  if (layout === 'stacked') {
    const wide = `${BTN} w-full whitespace-nowrap`;
    return (
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col gap-2" style={{ width: qrSize + 20 }}>
          <div className="rounded-xl bg-[#faf6ef] p-2.5">
            <QRCodeSVG value={url} size={qrSize} bgColor="#faf6ef" fgColor="#1a1108" level="M" title={`QR code for ${eventName}`} />
          </div>
          <button type="button" onClick={download} className={wide}>
            <Download className="h-4 w-4 shrink-0" aria-hidden /> Download QR
          </button>
        </div>
        <QRCodeCanvas ref={canvasRef} value={url} size={1024} marginSize={4} bgColor="#ffffff" fgColor="#000000" level="M" className="hidden" aria-hidden />
        <div className="flex w-full min-w-0 flex-col gap-2 sm:max-w-[300px]">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-brand-muted">Guest link</p>
          <p className="break-all font-mono text-[12.5px] text-brand-fg/90 rounded-xl bg-white/[0.06] px-3 py-2.5">{url.replace(/^https?:\/\//, '')}</p>
          <button type="button" onClick={() => void copy()} className={wide}>
            {note === 'Link copied' ? <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> : <Copy className="h-4 w-4 shrink-0" aria-hidden />} Copy link
          </button>
          <button type="button" onClick={() => void share()} className={wide}>
            <Share2 className="h-4 w-4 shrink-0" aria-hidden /> Share
          </button>
          <p role="status" aria-live="polite" className="min-h-[1.25rem] text-[12px] text-brand-muted">{note}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <div className="shrink-0 rounded-xl bg-[#faf6ef] p-2.5">
        <QRCodeSVG value={url} size={qrSize} bgColor="#faf6ef" fgColor="#1a1108" level="M" title={`QR code for ${eventName}`} />
      </div>
      {/* Print-size source for the PNG (1024px + quiet zone), never shown. */}
      <QRCodeCanvas ref={canvasRef} value={url} size={1024} marginSize={4} bgColor="#ffffff" fgColor="#000000" level="M" className="hidden" aria-hidden />
      <div className="flex w-full min-w-0 flex-col gap-2">
        <p className="break-all font-mono text-[12px] text-brand-muted">{url.replace(/^https?:\/\//, '')}</p>
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
          <button type="button" onClick={() => void share()} className={BTN}>
            <Share2 className="h-4 w-4" aria-hidden /> Share
          </button>
          <button type="button" onClick={() => void copy()} className={BTN}>
            {note === 'Link copied' ? <Check className="h-4 w-4 text-emerald-400" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} Copy link
          </button>
          <button type="button" onClick={download} className={BTN}>
            <Download className="h-4 w-4" aria-hidden /> Download QR
          </button>
        </div>
        <p role="status" aria-live="polite" className="min-h-[1.25rem] text-[12px] text-brand-muted">{note}</p>
      </div>
    </div>
  );
}
