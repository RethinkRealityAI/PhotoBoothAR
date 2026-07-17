/**
 * SendFailed — the honest failure screen when a wall submission didn't go
 * through (draft/ended event, plan cap, network hiccup). The capture is still
 * in Booth state, so the guest can retry the upload or save the file locally —
 * the photo is never silently lost behind a fake "Sent!".
 *
 * Purely presentational; the Booth owns the submit call and phase.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { CloudOff, Download, RefreshCw, Check } from 'lucide-react';
import { useEvent } from '../../events/EventContext';

interface Props {
  dataUrl: string;             // JPEG data-url for image; object URL for video
  mediaType?: 'image' | 'video';
  /** Failure kind from submitPostDetailed ('event_not_live', 'post_limit_reached', …). */
  errorKind?: string;
  onRetry: () => void;
}

function failureCopy(errorKind?: string): string {
  switch (errorKind) {
    case 'event_not_live':
      return "This event isn't accepting photos right now — ask your host!";
    case 'post_limit_reached':
      return 'The wall is full for this plan.';
    default:
      return "Connection hiccup — your photo didn't reach the wall.";
  }
}

export default function SendFailed({ dataUrl, mediaType = 'image', errorKind, onRetry }: Props) {
  const { config } = useEvent();
  const [saved, setSaved] = useState(false);

  // Same download affordance as ReviewPanel: resolve the real container from
  // the blob so the saved file's extension matches its bytes.
  const extFromMime = (type: string): string => {
    if (/mp4/.test(type)) return 'mp4';
    if (/webm/.test(type)) return 'webm';
    if (/png/.test(type)) return 'png';
    return mediaType === 'video' ? 'webm' : 'jpg';
  };

  async function handleSave() {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = mediaType === 'video' ? extFromMime(blob.type) : 'jpg';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.copy.filePrefix}-${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-hidden bg-noir-900/95 px-8 vignette">
      {/* Soft accent bloom */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[110vmin] w-[110vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.18) 0%, transparent 60%)' }}
      />

      {/* The capture — safe in hand, dimmed to read as "not posted yet" */}
      <div className="relative aspect-[9/16] max-h-72 w-52 overflow-hidden rounded-2xl border border-gold-400/25 shadow-2xl">
        {mediaType === 'video' ? (
          <video
            src={dataUrl}
            autoPlay
            loop
            muted
            playsInline
            className="h-full w-full object-cover"
            style={{ filter: 'brightness(0.85)' }}
          />
        ) : (
          <img
            src={dataUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{ filter: 'brightness(0.85)' }}
          />
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full max-w-xs flex-col items-center gap-4 text-center"
      >
        <div className="space-y-1.5">
          <div className="mx-auto mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-gold-400/10 border border-gold-400/25">
            <CloudOff className="h-5 w-5 text-gold-300/80" />
          </div>
          <p className="font-serif text-xl text-champagne/90">Not sent yet</p>
          <p className="font-sans text-sm leading-relaxed text-champagne/65">{failureCopy(errorKind)}</p>
          <p className="font-sans text-[11px] text-champagne/40">
            Your {mediaType === 'video' ? 'video' : 'photo'} is safe right here.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2.5">
          <button
            onClick={onRetry}
            className="flex items-center justify-center gap-2 rounded-xl bg-foil px-6 py-3.5 font-label text-xs uppercase tracking-luxe text-noir-900 glow-accent transition-all hover:brightness-110 active:scale-95"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <button
            onClick={handleSave}
            className="glass flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-label text-[11px] uppercase tracking-wide text-champagne/60 transition-colors hover:text-ivory"
          >
            {saved ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Download className="h-3.5 w-3.5" />}
            {saved ? 'Saved' : 'Save to my phone'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
