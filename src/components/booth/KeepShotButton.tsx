/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KeepShotButton — one tap to keep the shot the guest just took.
 *
 * Where the browser can share FILES (iPhone, Android Chrome) the button opens
 * the native share sheet with the actual photo or clip, which is where "Save
 * to Photos", Instagram, WhatsApp and AirDrop live. Everywhere else it saves
 * the file. The File is built the moment the button mounts, so the tap calls
 * `navigator.share()` with nothing awaited first (see lib/captureShare.ts).
 *
 * Platform screens only — the legacy review keeps its two icon buttons.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, Share } from 'lucide-react';
import { canShareFiles, downloadBlob } from '../../lib/bulkSave';
import {
  captureFileName,
  keepLabel,
  keepMode,
  keepOutcomeNote,
  shareMessage,
  type CaptureMedia,
} from '../../lib/captureShare';
import { haptic } from '../../lib/haptics';
import { useEvent } from '../../events/EventContext';

interface Props {
  /** Data URL (photo) or object URL (video) of the capture. */
  dataUrl: string;
  /** The in-memory bytes when the booth still holds them (videos). Saves a
   *  re-read of the object URL. */
  blob?: Blob | null;
  mediaType: CaptureMedia;
  /** `primary` = the foil call to action; `glass` = a quieter secondary. */
  tone?: 'primary' | 'glass';
  className?: string;
}

function canShareThis(file: File | null): boolean {
  if (!file || !canShareFiles()) return false;
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    return nav.canShare ? nav.canShare({ files: [file] }) : false;
  } catch {
    return false;
  }
}

export default function KeepShotButton({ dataUrl, blob, mediaType, tone = 'primary', className = '' }: Props) {
  const { config } = useEvent();
  const [file, setFile] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const busyRef = useRef(false);
  // Before the File exists, guess from the probe so the label doesn't flip.
  const [mode, setMode] = useState(() => keepMode(canShareFiles()));

  useEffect(() => {
    let alive = true;
    setFile(null);
    setFailed(false);
    (async () => {
      try {
        const bytes = blob ?? (await (await fetch(dataUrl)).blob());
        const type = bytes.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
        const name = captureFileName(config.copy.filePrefix, mediaType, type, Date.now());
        const f = new File([bytes], name, { type });
        if (!alive) return;
        setFile(f);
        // The real file decides: some browsers share photos but refuse WebM.
        setMode(keepMode(canShareThis(f)));
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [dataUrl, blob, mediaType, config.copy.filePrefix]);

  function save(f: File, fallback: boolean) {
    downloadBlob(f, f.name);
    setNote(keepOutcomeNote(fallback ? 'failed' : 'downloaded', mediaType));
  }

  async function handleTap() {
    if (busyRef.current) return;
    haptic('tap');
    setNote(null);
    if (!file) {
      // Still preparing (rare: a few ms) or the local read failed.
      setNote(failed ? `Couldn’t read the ${mediaType === 'video' ? 'video' : 'photo'} on this phone.` : 'One moment…');
      return;
    }
    if (mode === 'download') { save(file, false); return; }
    busyRef.current = true;
    try {
      const text = shareMessage(config.copy.shareText, config.copy.eventName);
      const payload: ShareData = { files: [file] };
      if (config.copy.shareTitle) payload.title = config.copy.shareTitle;
      if (text) payload.text = text;
      await navigator.share(payload);
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      // Closing the sheet is a choice, not an error.
      if (name !== 'AbortError') save(file, true);
    } finally {
      busyRef.current = false;
    }
  }

  const Icon = mode === 'share' ? Share : Download;
  const toneClass = tone === 'primary'
    ? 'bg-foil text-[color:var(--on-accent)] glow-accent font-label uppercase tracking-luxe hover:brightness-110'
    : 'glass text-champagne/80 font-label uppercase tracking-wide hover:text-ivory';

  return (
    <div className={`flex flex-col items-stretch gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={handleTap}
        aria-describedby={note ? 'keep-shot-note' : undefined}
        className={`pressable flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-xs transition-all active:scale-95 ${toneClass}`}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {keepLabel(mode, mediaType)}
      </button>
      {note && (
        <p id="keep-shot-note" role="status" className="text-center font-sans text-[11px] leading-snug text-champagne/60">
          {note}
        </p>
      )}
    </div>
  );
}
