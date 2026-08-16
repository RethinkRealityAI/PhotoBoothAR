/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MyPhotos — the guest keepsake gallery at /e/:slug/me (and /gallery).
 * (Export stays named `MyPhotos` for App.tsx.)
 *
 * This is the screen a guest opens the morning after, to get the photos they
 * actually came for. Three things it has to get right:
 *
 *  1. SAVING ACTUALLY WORKS. The previous "Download all" clicked one synthetic
 *     anchor per file, 600 ms apart. Mobile Safari honours the first and drops
 *     the rest in silence, so the guest got one photo and a spinner that never
 *     finished. Bulk saving now collects the bytes once (with honest progress)
 *     and hands them over as either a native multi-file share — which lands
 *     photos in Photos on iOS — or a single zip built in `lib/zipStore.ts`.
 *     Both paths are driven by a fresh tap, because `navigator.share()` needs
 *     transient activation that a dozen fetches would have outlived.
 *
 *  2. THE VIDEOS BEHAVE. Every clip used to autoplay the moment it mounted.
 *     Platform decoder limits mean the extras paint black instead of erroring,
 *     which is the "some of my videos are broken" report. Playback is now
 *     intersection-gated and capped (`lib/keepsake.ts`), and switched off
 *     entirely under `prefers-reduced-motion`.
 *
 *  3. IT FEELS LIKE THE PAYOFF. Day headings, a featured opening frame,
 *     captions on the tiles, and an empty state that tells a guest with nothing
 *     yet what to do next.
 *
 * Sources: `getSavedPhotos()` (this device, instant) merged over
 * `fetchMyPostsResult()` (server posts tagged with this device's session id),
 * deduped by id, newest first. Refreshes on the `gallery:changed` event.
 *
 * Colours come from the semantic theme tokens only — these guest surfaces
 * render inside EventProvider, so an event's own palette drives them.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { clearGallery, getSavedPhotos, savePhoto } from '../lib/session';
import { deleteMyPost, fetchMyPostsResult } from '../lib/db';
import ConfirmModal from './ui/ConfirmModal';
import { SavedPhoto, Post, MediaType } from '../types';
import { useEvent } from '../events/EventContext';
import { useStore } from '../store';
import EventBackground from './ui/EventBackground';
import PostImage from './ui/PostImage';
import { useDialog } from '../lib/useDialog';
import { Wordmark } from './ui/EventLogo';
import GuestNav from './ui/GuestNav';
import FetchFailed from './ui/FetchFailed';
import { haptic } from '../lib/haptics';
import { StreamRecorder, buildRecordStream } from '../lib/recorder';
import {
  montagePlan,
  montageSupported,
  slideAt,
  slideAlpha,
  kenBurns,
  coverRect,
  recapFileName,
  MAX_MONTAGE_SLIDES,
} from '../lib/montage';
import {
  KeepsakeItem,
  summarize,
  summaryLine,
  groupByDay,
  playableVideoIds,
  pickBulkSaveMode,
  keepsakeFileName,
  formatBytes,
  progressLabel,
  archiveName,
} from '../lib/keepsake';
import {
  collectFiles,
  archiveOf,
  canShareFiles,
  shareFiles,
  downloadBlob,
  CollectedFile,
  CollectFailure,
} from '../lib/bulkSave';
import {
  CameraIcon,
  PhotoIcon,
  VideoIcon,
  DownloadIcon,
  ShareIcon,
  ExpandIcon,
  CloseIcon,
  BackIcon,
  PlayIcon,
} from './ui/MediaIcons';
import { Film, Trash2 } from 'lucide-react';

/** Matches the MediaIcons call shape so the recap button sits with the rest. */
function FilmIcon({ size = 16 }: { size?: number }) {
  return <Film width={size} height={size} strokeWidth={1.7} />;
}

// ----------------------------------------------------------------
// Unified media type for this view
// ----------------------------------------------------------------
interface GalaMedia {
  id: string;
  image_url: string;
  media_type: MediaType;
  message?: string | null;
  createdAt: number; // ms epoch
  /** Where this entry came from. 'db' is a real wall post (it can be removed
   *  from the wall); 'local' exists only in this device's gallery — usually a
   *  capture whose upload never landed — so removing it is a local erase. */
  origin: 'db' | 'local';
}

function postToMedia(p: Post): GalaMedia {
  return {
    id: p.id,
    image_url: p.image_url,
    media_type: p.media_type ?? 'image',
    message: p.message,
    createdAt: new Date(p.created_at).getTime(),
    origin: 'db',
  };
}

function savedToMedia(s: SavedPhoto): GalaMedia {
  return {
    id: s.id,
    image_url: s.image_url,
    media_type: s.media_type ?? 'image',
    message: s.message,
    createdAt: s.createdAt,
    origin: 'local',
  };
}

/**
 * Drop one entry from this device's gallery.
 *
 * session.ts owns the localStorage key scheme (and its one-time legacy-key
 * migration) and exposes no per-photo removal, so this goes through its public
 * API rather than reaching for the key itself — a second copy of
 * `pbar.<eventId>.gallery` in this file is exactly how the two drift apart.
 * `savePhoto` UNSHIFTS, so the survivors are replayed oldest-first to land in
 * their original order. Every call is synchronous localStorage work, so nothing
 * can interleave between the clear and the replay.
 */
function forgetLocalPhoto(eventId: string, id: string): void {
  const kept = getSavedPhotos(eventId).filter((p) => p.id !== id);
  clearGallery(eventId);
  for (let i = kept.length - 1; i >= 0; i--) savePhoto(eventId, kept[i]);
}

/** The shape the pure keepsake helpers work in. */
function toKeepsake(m: GalaMedia): KeepsakeItem {
  return {
    id: m.id,
    url: m.image_url,
    kind: m.media_type === 'video' ? 'video' : 'image',
    createdAt: m.createdAt,
  };
}

/** Live `prefers-reduced-motion`, so a guest toggling it mid-visit is obeyed. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

// ----------------------------------------------------------------
// Single-file save / share
// ----------------------------------------------------------------

/**
 * Save one capture.
 *
 * A single programmatic download IS permitted on mobile — it was only the loop
 * that broke. The last-resort branch opens the media in a new tab so the guest
 * can long-press it, rather than leaving a button that appears to do nothing.
 */
async function downloadOne(media: GalaMedia, filePrefix: string): Promise<boolean> {
  const item = toKeepsake(media);
  const filename = keepsakeFileName(filePrefix, item, 0, 1);
  try {
    const resp = await fetch(media.image_url, { mode: 'cors' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    downloadBlob(blob, filename);
    return true;
  } catch (err) {
    console.error('[MyPhotos] download failed, opening directly', err);
    window.open(media.image_url, '_blank', 'noopener');
    return false;
  }
}

/**
 * Share one capture.
 *
 * Sharing the FILE rather than the URL is the whole point on a phone: a shared
 * URL arrives in the group chat as a link nobody taps, a shared file arrives as
 * the photo. The URL share stays as the fallback for browsers that cannot take
 * files, and both are behind the same feature detection.
 */
async function shareOne(
  media: GalaMedia,
  filePrefix: string,
  meta: { title: string; text: string },
): Promise<void> {
  const item = toKeepsake(media);
  if (canShareFiles()) {
    const res = await collectFiles([item], { filePrefix });
    if (res.files.length > 0) {
      const out = await shareFiles(res.files, meta);
      // A cancel is a decision, not a failure — do not fall back to a link
      // share the guest just declined.
      if (out === 'shared' || out === 'cancelled') return;
    }
  }
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: meta.title, text: meta.text, url: media.image_url });
    } catch {
      /* cancelled or unsupported — nothing useful to say */
    }
  }
}

// ----------------------------------------------------------------
// Bulk save
// ----------------------------------------------------------------

type SavePhase = 'idle' | 'collecting' | 'ready' | 'error';

interface SaveState {
  phase: SavePhase;
  done: number;
  total: number;
  files: CollectedFile[];
  failures: CollectFailure[];
  bytes: number;
  error: string;
  /** Set once the guest has taken the archive, so the panel can congratulate. */
  saved: boolean;
}

const IDLE_SAVE: SaveState = {
  phase: 'idle', done: 0, total: 0, files: [], failures: [], bytes: 0, error: '', saved: false,
};

function SaveAllPanel({
  media,
  filePrefix,
  shareMeta,
}: {
  media: GalaMedia[];
  filePrefix: string;
  shareMeta: { title: string; text: string };
}) {
  const [state, setState] = useState<SaveState>(IDLE_SAVE);
  const abortRef = useRef<AbortController | null>(null);
  const shareable = useMemo(() => canShareFiles(), []);
  const mode = pickBulkSaveMode({ canShareFiles: shareable, count: media.length });

  // A gallery that changed under a prepared archive would hand the guest a
  // stale batch — drop back to idle instead.
  useEffect(() => {
    setState(IDLE_SAVE);
  }, [media.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async () => {
    haptic('tap');
    if (media.length === 1) {
      setState({ ...IDLE_SAVE, phase: 'collecting', total: 1 });
      const ok = await downloadOne(media[0], filePrefix);
      setState(ok
        ? { ...IDLE_SAVE, saved: true }
        : { ...IDLE_SAVE, phase: 'error', error: 'We couldn’t reach that one. Opened it in a new tab instead.' });
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ ...IDLE_SAVE, phase: 'collecting', total: media.length });
    try {
      const res = await collectFiles(media.map(toKeepsake), {
        filePrefix,
        signal: ctrl.signal,
        onProgress: (done, total) =>
          setState((s) => (s.phase === 'collecting' ? { ...s, done, total } : s)),
      });
      if (ctrl.signal.aborted) {
        setState(IDLE_SAVE);
        return;
      }
      if (res.files.length === 0) {
        setState({
          ...IDLE_SAVE,
          phase: 'error',
          error: 'We couldn’t download any of them — this is usually the venue’s wifi. Try again in a moment.',
        });
        return;
      }
      setState({
        phase: 'ready',
        done: res.files.length,
        total: media.length,
        files: res.files,
        failures: res.failures,
        bytes: res.totalBytes,
        error: '',
        saved: false,
      });
    } catch (err) {
      console.error('[MyPhotos] bulk collect failed', err);
      setState({
        ...IDLE_SAVE,
        phase: 'error',
        error: 'That’s more than this browser can hold at once. Save them a few at a time.',
      });
    }
  }, [media, filePrefix]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE_SAVE);
  }, []);

  const doShare = useCallback(async () => {
    haptic('tap');
    const out = await shareFiles(state.files, shareMeta);
    if (out === 'shared') {
      setState((s) => ({ ...s, saved: true }));
      return;
    }
    if (out === 'cancelled') return; // the guest closed the sheet
    setState((s) => ({
      ...s,
      error: 'Your phone wouldn’t take them that way — the download below still works.',
    }));
  }, [state.files, shareMeta]);

  const doZip = useCallback(() => {
    haptic('tap');
    try {
      downloadBlob(archiveOf(state.files), archiveName(filePrefix));
      setState((s) => ({ ...s, saved: true }));
    } catch (err) {
      console.error('[MyPhotos] archive failed', err);
      setState((s) => ({
        ...s,
        error: 'The archive was too big to build here. Save them a few at a time.',
      }));
    }
  }, [state.files, filePrefix]);

  if (media.length === 0) return null;

  const primaryLabel = media.length === 1 ? 'Save your moment' : `Save all ${media.length}`;
  // Idle is one button that shares a row with the recap button; the working and
  // ready panels need the full column.
  const compact = state.phase === 'idle' || state.phase === 'error';

  return (
    <div className={compact ? '' : 'w-full max-w-sm'}>
      <AnimatePresence mode="wait" initial={false}>
        {/* ── Idle: the one button ── */}
        {(state.phase === 'idle' || state.phase === 'error') && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center gap-3"
          >
            <button
              onClick={start}
              className="pressable inline-flex items-center justify-center gap-2 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] px-8 min-h-12 rounded-2xl glow-accent"
            >
              <DownloadIcon size={15} strokeWidth={1.8} />
              {primaryLabel}
            </button>
            {state.saved && (
              <p className="font-sans text-xs text-[color:var(--color-accent)]">
                Saved — they’re on your device.
              </p>
            )}
            {state.phase === 'error' && (
              <p className="font-sans text-xs text-brand-muted/80 text-center leading-relaxed max-w-xs">
                {state.error}
              </p>
            )}
          </motion.div>
        )}

        {/* ── Collecting: real progress, always cancellable ── */}
        {state.phase === 'collecting' && (
          <motion.div
            key="collecting"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="liquid-glass rounded-2xl p-4 flex flex-col items-center gap-3"
          >
            <div className="flex items-center gap-2.5">
              <span className="block w-4 h-4 rounded-full border-2 border-[color:var(--color-accent)]/30 border-t-[color:var(--color-accent)] animate-spin" />
              <span className="font-label uppercase tracking-luxe text-[10px] text-brand-fg">
                {progressLabel(state.done, state.total)}
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-foil transition-[width] duration-300"
                style={{ width: `${state.total ? (state.done / state.total) * 100 : 0}%` }}
              />
            </div>
            <button
              onClick={cancel}
              className="min-h-11 px-4 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 hover:text-brand-fg transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        )}

        {/* ── Ready: a fresh tap drives the handoff (share needs activation) ── */}
        {state.phase === 'ready' && (
          <motion.div
            key="ready"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="liquid-glass rounded-2xl p-4 flex flex-col gap-3"
          >
            <p className="font-label uppercase tracking-luxe text-[10px] text-brand-fg text-center">
              {state.files.length} ready
              {state.bytes > 0 && (
                <span className="text-brand-muted/60"> · {formatBytes(state.bytes)}</span>
              )}
            </p>

            {shareable && (
              <button
                onClick={doShare}
                className="pressable inline-flex items-center justify-center gap-2 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] min-h-12 rounded-xl glow-accent"
              >
                <ShareIcon size={15} />
                {mode === 'share' ? 'Save to photos' : 'Share'}
              </button>
            )}

            <button
              onClick={doZip}
              className={`pressable inline-flex items-center justify-center gap-2 min-h-12 rounded-xl font-label uppercase tracking-luxe text-[11px] ${
                shareable
                  ? 'text-brand-fg bg-white/[0.07] border border-white/10'
                  : 'bg-foil text-[color:var(--on-accent)] glow-accent'
              }`}
            >
              <DownloadIcon size={15} strokeWidth={1.8} />
              Download .zip
            </button>

            {state.failures.length > 0 && (
              <p className="font-sans text-[11px] text-brand-muted/70 text-center leading-relaxed">
                {state.failures.length} of {state.total} couldn’t be downloaded —{' '}
                {state.failures[0].reason}.
              </p>
            )}
            {state.error && (
              <p className="font-sans text-[11px] text-brand-muted/80 text-center leading-relaxed">
                {state.error}
              </p>
            )}
            {state.saved && (
              <p className="font-sans text-[11px] text-[color:var(--color-accent)] text-center">
                Saved — they’re on your device.
              </p>
            )}

            <button
              onClick={() => setState(IDLE_SAVE)}
              className="min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 hover:text-brand-fg transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ----------------------------------------------------------------
// The recap — a shareable clip of the guest's own night
// ----------------------------------------------------------------

/**
 * Render the guest's photos to a short clip, on their own device.
 *
 * Strictly additive and gated three ways: the browser must pass
 * `montageSupported()`, there must be enough photos to be worth watching, and
 * nothing starts until the guest taps. Every image is decoded from bytes we
 * fetched ourselves into a Blob, so the canvas is never tainted by a
 * cross-origin draw and `captureStream()` can never be refused for it.
 *
 * Throws only for "there is nothing to render"; every other failure is turned
 * into a message.
 */
async function renderRecap(
  items: KeepsakeItem[],
  filePrefix: string,
  eventName: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; ext: string }> {
  const plan = montagePlan(items.length);
  if (plan.slides.length === 0) throw new Error('nothing to render');

  // ── 1. Fetch and decode. Half the progress bar. ──
  const collected = await collectFiles(items.slice(0, plan.slides.length), {
    filePrefix,
    signal,
    onProgress: (done, total) => onProgress(total ? (done / total) * 0.5 : 0),
  });
  if (signal.aborted) throw new Error('cancelled');

  const bitmaps: ImageBitmap[] = [];
  for (const file of collected.files) {
    try {
      bitmaps.push(await createImageBitmap(new Blob([file.bytes.slice()], { type: file.type })));
    } catch (err) {
      // One undecodable photo should shorten the film, not cancel it.
      console.warn('[recap] skipping an image that would not decode', err);
    }
  }
  if (bitmaps.length === 0) throw new Error('no images could be decoded');
  const live = montagePlan(bitmaps.length);

  // ── 2. Record the canvas in real time. ──
  const canvas = document.createElement('canvas');
  canvas.width = live.width;
  canvas.height = live.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmaps.forEach((b) => b.close?.());
    throw new Error('no 2d context');
  }

  const drawSlide = (i: number, progress: number, alpha: number) => {
    const bmp = bitmaps[i];
    if (!bmp || alpha <= 0) return;
    const kb = kenBurns(progress, i);
    const r = coverRect(bmp.width, bmp.height, live.width, live.height, kb);
    ctx.globalAlpha = alpha;
    ctx.drawImage(bmp, r.sx, r.sy, r.sw, r.sh, 0, 0, live.width, live.height);
    ctx.globalAlpha = 1;
  };

  // Paint one frame before recording starts, so the clip never opens on black.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, live.width, live.height);
  drawSlide(0, 0, 1);

  const recorder = new StreamRecorder({
    maxMs: live.durationMs + 1500,
    videoBitsPerSecond: 3_500_000,
  });
  const stream = buildRecordStream(canvas, null, live.fps);
  recorder.start(stream);

  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    const frame = () => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const t = performance.now() - startedAt;
      const at = slideAt(live, Math.min(t, live.durationMs - 1));

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, live.width, live.height);
      if (at) {
        // The outgoing slide stays underneath at full opacity while the next
        // one fades in on top — otherwise the black fill shows through the
        // transition and the film flickers.
        if (at.index > 0) drawSlide(at.index - 1, 1, 1);
        drawSlide(at.index, at.progress, slideAlpha(live, at.progress));
      }

      // A quiet signature so the clip still says where it came from when it is
      // three shares deep into someone's group chat.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, live.height - 96, live.width, 96);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '500 30px Inter, system-ui, sans-serif';
      ctx.fillText(eventName.slice(0, 34), live.width / 2, live.height - 50);
      ctx.font = '400 20px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(
        `${bitmaps.length} ${bitmaps.length === 1 ? 'moment' : 'moments'}`,
        live.width / 2,
        live.height - 22,
      );

      onProgress(0.5 + Math.min(1, t / live.durationMs) * 0.5);
      if (t >= live.durationMs) {
        resolve();
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  const blob = await recorder.stop();
  recorder.dispose();
  stream.getTracks().forEach((t) => t.stop());
  bitmaps.forEach((b) => b.close?.());

  if (signal.aborted) throw new Error('cancelled');
  if (!blob || blob.size === 0) throw new Error('the recording came back empty');
  const ext = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
  return { blob, ext };
}

function RecapPanel({
  media,
  filePrefix,
  eventName,
}: {
  media: GalaMedia[];
  filePrefix: string;
  eventName: string;
}) {
  const supported = useMemo(montageSupported, []);
  const photos = useMemo(
    () => media.filter((m) => m.media_type !== 'video').slice(0, MAX_MONTAGE_SLIDES),
    [media],
  );
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [pct, setPct] = useState(0);
  const [clip, setClip] = useState<{ url: string; blob: Blob; ext: string } | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  // Two photos is a slideshow, not a recap.
  if (!supported || photos.length < 3) return null;

  const make = async () => {
    haptic('tap');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('working');
    setPct(0);
    setError('');
    try {
      const out = await renderRecap(
        photos.map(toKeepsake),
        filePrefix,
        eventName,
        setPct,
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(out.blob);
      urlRef.current = url;
      setClip({ url, blob: out.blob, ext: out.ext });
      setPhase('done');
    } catch (err) {
      if (ctrl.signal.aborted) {
        setPhase('idle');
        return;
      }
      console.error('[recap] render failed', err);
      setError('We couldn’t make the recap on this device. Your photos are all still here.');
      setPhase('error');
    }
  };

  const saveClip = () => {
    if (!clip) return;
    haptic('tap');
    downloadBlob(clip.blob, recapFileName(filePrefix, clip.ext));
  };

  const shareClip = async () => {
    if (!clip) return;
    haptic('tap');
    const name = recapFileName(filePrefix, clip.ext);
    const file: CollectedFile = {
      id: 'recap',
      name,
      type: clip.blob.type || 'video/webm',
      bytes: new Uint8Array(await clip.blob.arrayBuffer()),
    };
    const out = await shareFiles([file], { title: eventName, text: `My night at ${eventName}` });
    if (out === 'shared' || out === 'cancelled') return;
    saveClip();
  };

  return (
    <div className={phase === 'idle' || phase === 'error' ? '' : 'w-full max-w-sm'}>
      {phase === 'idle' || phase === 'error' ? (
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={make}
            className="pressable inline-flex items-center gap-2 min-h-11 px-5 rounded-2xl liquid-glass text-brand-fg font-label uppercase tracking-luxe text-[10px]"
          >
            <FilmIcon size={14} />
            Recap clip
          </button>
          {phase === 'error' && (
            <p className="font-sans text-[11px] text-brand-muted/75 text-center leading-relaxed max-w-xs">
              {error}
            </p>
          )}
        </div>
      ) : phase === 'working' ? (
        <div className="liquid-glass rounded-2xl p-4 flex flex-col items-center gap-2.5">
          <span className="font-label uppercase tracking-luxe text-[10px] text-brand-fg">
            Cutting your recap…
          </span>
          <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-foil transition-[width] duration-200"
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          </div>
          <p className="font-sans text-[11px] text-brand-muted/60 text-center">
            It records in real time, so this takes about as long as the clip.
          </p>
        </div>
      ) : (
        clip && (
          <div className="liquid-glass rounded-2xl p-3 flex flex-col gap-3">
            <video
              src={clip.url}
              controls
              autoPlay
              loop
              muted
              playsInline
              // A 9:16 clip at full column width is taller than the phone, so
              // the Share button lands off-screen — cap it and letterbox.
              className="w-full max-h-[42vh] object-contain rounded-xl"
              style={{ background: '#000' }}
            />
            <div className="flex gap-2">
              <button
                onClick={shareClip}
                className="pressable flex-1 inline-flex items-center justify-center gap-2 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] min-h-11 rounded-xl glow-accent"
              >
                <ShareIcon size={14} />
                Share recap
              </button>
              <button
                onClick={saveClip}
                className="pressable inline-flex items-center justify-center gap-2 text-brand-fg font-label uppercase tracking-luxe text-[10px] min-h-11 px-4 rounded-xl bg-white/[0.07] border border-white/10"
              >
                <DownloadIcon size={14} strokeWidth={1.8} />
                Save
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Tiles
// ----------------------------------------------------------------

/**
 * `liquid-glass` is designed to sit on the dark app background; over a bright
 * photo it disappears. These chips need a floor of their own opacity to stay
 * legible on a white dress or a spotlit stage.
 */
const CHIP_STYLE: React.CSSProperties = {
  width: 26,
  height: 26,
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.22)',
};

function TypeChip({ isVideo }: { isVideo: boolean }) {
  return (
    <div
      className="absolute top-2 left-2 flex items-center justify-center rounded-full text-white"
      style={CHIP_STYLE}
      aria-hidden
    >
      {isVideo ? <VideoIcon size={13} /> : <PhotoIcon size={13} />}
    </div>
  );
}

/**
 * A clip in the grid.
 *
 * `preload="metadata"` plus a `#t=0.1` media fragment gives a real first frame
 * instead of a black rectangle, at the cost of a few kilobytes rather than the
 * whole file. Playback only starts when the parent says this clip is one of the
 * few on screen (see `playableVideoIds`), and pausing releases the decoder.
 */
function VideoTile({
  media,
  playing,
  register,
}: {
  media: GalaMedia;
  playing: boolean;
  register: (id: string, el: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      // Autoplay can still be refused (low-power mode, data saver). That is a
      // fine outcome — the poster frame stays and the play badge still reads.
      void el.play().catch(() => {});
    } else if (!el.paused) {
      el.pause();
    }
  }, [playing]);

  return (
    <video
      ref={(el) => {
        ref.current = el;
        register(media.id, el);
      }}
      data-media-id={media.id}
      src={`${media.image_url}#t=0.1`}
      preload="metadata"
      loop
      muted
      playsInline
      className="w-full h-full block object-cover"
      style={{ background: 'rgba(0,0,0,0.6)' }}
    />
  );
}

function MediaCard({
  media,
  featured,
  playing,
  register,
  onView,
  filePrefix,
  onRemove,
  removing = false,
}: {
  media: GalaMedia;
  featured: boolean;
  playing: boolean;
  register: (id: string, el: HTMLVideoElement | null) => void;
  onView: (m: GalaMedia) => void;
  filePrefix: string;
  /** Absent = no remove control at all (frozen legacy events pass nothing). */
  onRemove?: (m: GalaMedia) => void;
  removing?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const isVideo = media.media_type === 'video';

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic('tap');
    setDownloading(true);
    await downloadOne(media, filePrefix);
    setDownloading(false);
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canShare) return;
    haptic('tap');
    setSharing(true);
    const copy = useStore.getState().copy;
    await shareOne(media, filePrefix, {
      title: copy.momentTitle,
      text: media.message ?? copy.shareText,
    });
    setSharing(false);
  };

  return (
    <motion.div
      // The double-size opener is a DESKTOP treatment. In the two-column phone
      // grid `col-span-2 row-span-2` is the whole viewport, which buries every
      // other moment below the fold — the exact problem this page had.
      className={`group relative rounded-2xl overflow-hidden cursor-pointer liquid-glass ${
        featured ? 'sm:col-span-2 sm:row-span-2' : ''
      }`}
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onView(media)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onView(media);
        }
      }}
      aria-label={isVideo ? 'Open video' : 'Open photo'}
      style={{ aspectRatio: '9 / 16' }}
    >
      {/* A tile renders ~180px wide on a phone and ~300px featured; fetching the
          full 1080px capture for each was roughly eight times the pixels, on the
          surface most likely to be on venue wifi. The original is still what the
          viewer opens and what Save downloads. */}
      {isVideo ? (
        <VideoTile media={media} playing={playing} register={register} />
      ) : (
        <PostImage
          src={media.image_url}
          alt={media.message || 'Your moment'}
          displayWidth={featured ? 520 : 280}
          eager={featured}
          className="w-full h-full block object-cover"
        />
      )}

      <TypeChip isVideo={isVideo} />

      {isVideo && (
        <div
          className="absolute top-2 right-2 z-10 flex items-center justify-center rounded-full text-[color:var(--color-accent)]"
          style={CHIP_STYLE}
          aria-hidden
        >
          <PlayIcon size={12} />
        </div>
      )}

      {/* Caption + actions, always visible: a phone has no hover, and a control
          that only appears on hover is a control a guest never finds. */}
      <div
        className="absolute bottom-0 inset-x-0 flex flex-col gap-2 p-2.5 pt-8"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.45) 55%, transparent 100%)',
        }}
      >
        {media.message && (
          <p className="font-serif italic text-[13px] text-brand-fg/90 leading-snug line-clamp-2 px-0.5">
            {media.message}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="pressable flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] min-h-11 rounded-xl glow-accent disabled:opacity-60"
            aria-label={isVideo ? 'Save video' : 'Save photo'}
          >
            {downloading ? (
              <span className="block w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
            ) : (
              <>
                <DownloadIcon size={13} strokeWidth={1.8} />
                <span className="truncate">Save</span>
              </>
            )}
          </button>

          {canShare && (
            <button
              onClick={handleShare}
              disabled={sharing}
              className="pressable shrink-0 inline-flex items-center justify-center text-brand-fg rounded-xl bg-white/[0.10] border border-white/15 disabled:opacity-60"
              style={{ width: 44, minHeight: 44 }}
              aria-label="Share"
            >
              {sharing ? (
                <span className="block w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
              ) : (
                <ShareIcon size={15} />
              )}
            </button>
          )}

          {/* Remove. Deliberately the quietest control on the tile — Save is
              what a guest came for — but always visible, because a phone has no
              hover and the whole point is that it can be found without asking
              anyone. Same 44px target as its neighbours. */}
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); haptic('tap'); onRemove(media); }}
              disabled={removing}
              className="pressable shrink-0 inline-flex items-center justify-center text-brand-muted/70 hover:text-red-300 rounded-xl bg-white/[0.06] border border-white/10 transition-colors disabled:opacity-60"
              style={{ width: 44, minHeight: 44 }}
              aria-label={isVideo ? 'Remove video' : 'Remove photo'}
            >
              {removing ? (
                <span className="block w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
              ) : (
                <Trash2 className="w-[15px] h-[15px]" strokeWidth={1.8} />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Enlarge affordance — pointer only; touch users tap the tile. */}
      <div className="hidden sm:flex absolute inset-0 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
        <div
          className="flex items-center justify-center rounded-full liquid-glass text-brand-fg"
          style={{ width: 44, height: 44 }}
        >
          <ExpandIcon size={20} />
        </div>
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------------
// Lightbox (image + video)
// ----------------------------------------------------------------
function Lightbox({
  media,
  filePrefix,
  onClose,
}: {
  media: GalaMedia;
  filePrefix: string;
  onClose: () => void;
}) {
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, 'Your moment');
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const isVideo = media.media_type === 'video';

  const handleDownload = async () => {
    setDownloading(true);
    await downloadOne(media, filePrefix);
    setDownloading(false);
  };

  const handleShare = async () => {
    if (!canShare) return;
    setSharing(true);
    const copy = useStore.getState().copy;
    await shareOne(media, filePrefix, {
      title: copy.momentTitle,
      text: media.message ?? copy.shareText,
    });
    setSharing(false);
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-safe-bottom [--safe-bottom:1rem]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(14px)' }}
    >
      {/* A full-bleed viewer, so not Modal-shaped — but a dialog all the same,
          and it had no Escape and no focus trap. */}
      <motion.div
        ref={panelRef}
        {...dialogProps}
        className="relative max-w-sm w-full"
        initial={{ scale: 0.9, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 18 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        {isVideo ? (
          <video
            src={media.image_url}
            autoPlay
            loop
            muted
            playsInline
            controls
            preload="auto"
            className="w-full rounded-2xl"
            style={{ background: 'rgba(0,0,0,0.6)', boxShadow: '0 0 60px rgba(var(--accent-rgb),0.18)' }}
          />
        ) : (
          <img
            src={media.image_url}
            alt={media.message || 'Your moment'}
            className="w-full rounded-2xl"
            style={{ boxShadow: '0 0 60px rgba(var(--accent-rgb),0.18)' }}
          />
        )}

        {media.message && (
          <p className="mt-3 text-center font-serif italic text-brand-fg/85 text-sm px-4">
            {media.message}
          </p>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="pressable flex-1 inline-flex items-center justify-center gap-2 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] min-h-12 rounded-xl glow-accent disabled:opacity-60"
            aria-label={isVideo ? 'Download video' : 'Download photo'}
          >
            {downloading ? (
              <>
                <span className="block w-4 h-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                Saving
              </>
            ) : (
              <>
                <DownloadIcon size={15} strokeWidth={1.8} />
                Save
              </>
            )}
          </button>
          {canShare && (
            <button
              onClick={handleShare}
              disabled={sharing}
              className="pressable inline-flex items-center justify-center gap-2 text-brand-fg font-label uppercase tracking-luxe text-[11px] min-h-12 px-5 rounded-xl bg-white/[0.10] border border-white/15 disabled:opacity-60"
              aria-label="Share"
            >
              <ShareIcon size={15} />
              Share
            </button>
          )}
        </div>

        <button
          onClick={onClose}
          className="pressable absolute -top-3 -right-3 liquid-glass w-11 h-11 rounded-full flex items-center justify-center text-brand-fg"
          aria-label="Close"
        >
          <CloseIcon size={16} />
        </button>
      </motion.div>
    </motion.div>
  );
}

// ----------------------------------------------------------------
// Main component
// ----------------------------------------------------------------
export default function MyPhotos() {
  const { eventId, config, basePath, source } = useEvent();
  const [media, setMedia] = useState<GalaMedia[]>([]);
  const [loading, setLoading] = useState(true);
  /** The server read failed. Locally-saved captures may still be shown. */
  const [serverFailed, setServerFailed] = useState(false);
  const [lightbox, setLightbox] = useState<GalaMedia | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  /* ── Removing a moment ─────────────────────────────────────────────
     Gated on `source === 'db'`: the three frozen coded events keep this
     screen byte-identical, and their posts were written by a pinned build
     through a path the delete op deliberately refuses. */
  const canRemove = source === 'db';
  const [removeTarget, setRemoveTarget] = useState<GalaMedia | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  /** One-line outcome strip. Guest surfaces have no ToastProvider — it is
   *  mounted on /admin and the host studio only — and a fixed toast would sit
   *  on top of the phone tab bar this page already portals in. So the answer
   *  appears where the page already answers: the same strip the failed server
   *  read uses. */
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  /** Set while the local gallery is being rewritten: `savePhoto` fires
   *  `gallery:changed` per entry, and the listener below would otherwise run a
   *  full re-fetch for every surviving photo. dispatchEvent is synchronous, so
   *  every one of those events lands inside the flag's window. */
  const ignoreGalleryEvents = useRef(false);

  const fetchAndMerge = useCallback(async () => {
    const [saved, server] = await Promise.all([
      Promise.resolve(getSavedPhotos(eventId)),
      fetchMyPostsResult(eventId),
    ]);
    // A failed server read used to be indistinguishable from "you have no
    // photos" — this page would tell a guest their own moments don't exist.
    setServerFailed(server.failed);
    const serverPosts = server.rows;

    const map = new Map<string, GalaMedia>();

    // Server posts first (more authoritative)
    serverPosts.forEach((p) => map.set(p.id, postToMedia(p)));

    // Local saved fills gaps / adds any not on server yet
    saved.forEach((s) => {
      if (!map.has(s.id)) map.set(s.id, savedToMedia(s));
    });

    const merged = [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
    setMedia(merged);
    setLoading(false);
  }, [eventId]);

  // Initial fetch
  useEffect(() => {
    fetchAndMerge();
  }, [fetchAndMerge]);

  // Listen for gallery:changed events
  useEffect(() => {
    const handler = () => { if (!ignoreGalleryEvents.current) fetchAndMerge(); };
    window.addEventListener('gallery:changed', handler);
    return () => window.removeEventListener('gallery:changed', handler);
  }, [fetchAndMerge]);

  // A good-news strip clears itself; a failure waits to be read and dismissed
  // (the rule Toast.tsx settled on — an error nobody saw is an error nobody fixed).
  useEffect(() => {
    if (!notice || notice.tone === 'error') return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /**
   * Remove one moment: off the wall, out of storage, out of this device's
   * gallery. Not optimistic — a tile that vanished and came back would read as
   * "my photo is still up there somewhere", which is the opposite of the
   * reassurance this control exists to give.
   */
  const removeMedia = async (m: GalaMedia) => {
    setRemovingId(m.id);
    // A local-only entry never reached the wall, so there is nothing to ask the
    // server for — this is purely a local erase.
    const res = m.origin === 'db'
      ? await deleteMyPost(eventId, m.id)
      : { deleted: true, error: null as null };

    // 'post_not_found' is the guest's goal already achieved (a second tab, or a
    // retry after a lost response) — finish the local half rather than reporting
    // a failure for something that is genuinely gone.
    if (!res.deleted && res.error !== 'post_not_found') {
      setRemovingId(null);
      setRemoveTarget(null);
      const text =
        res.error === 'not_yours'
          ? 'That moment was posted from another device — open your gallery on the phone you used at the booth.'
          : res.error === 'rate_limited'
            ? 'That’s a lot of removals at once. Try again in a few minutes.'
            : res.error === 'storage_failed'
              ? 'We couldn’t remove the file, so nothing was deleted. Try again in a moment.'
              : 'Couldn’t remove that just now — check your connection and try again.';
      setNotice({ text, tone: 'error' });
      return;
    }

    ignoreGalleryEvents.current = true;
    try {
      forgetLocalPhoto(eventId, m.id);
    } finally {
      ignoreGalleryEvents.current = false;
    }
    setMedia((list) => list.filter((x) => x.id !== m.id));
    setLightbox((cur) => (cur && cur.id === m.id ? null : cur));
    setRemovingId(null);
    setRemoveTarget(null);
    setNotice({
      text: m.origin === 'db' ? 'Removed — it’s off the wall too.' : 'Removed from this device.',
      tone: 'ok',
    });
  };

  // ── Video playback gate ────────────────────────────────────────────
  // One observer for the whole grid. It is created lazily inside the register
  // callback rather than in an effect, because refs attach during commit —
  // before the parent's effects run — so an effect-built observer would miss
  // every tile on the first paint.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleRef = useRef<Set<string>>(new Set());
  const orderRef = useRef<string[]>([]);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);

  const videoOrder = useMemo(
    () => media.filter((m) => m.media_type === 'video').map((m) => m.id),
    [media],
  );
  orderRef.current = videoOrder;

  const syncVisible = useCallback(() => {
    setVisibleIds(orderRef.current.filter((id) => visibleRef.current.has(id)));
  }, []);

  const register = useCallback(
    (id: string, el: HTMLVideoElement | null) => {
      if (!el) {
        visibleRef.current.delete(id);
        return;
      }
      if (typeof IntersectionObserver === 'undefined') {
        // No observer (very old browser, or a test environment): fall back to
        // "everything counts as visible" and let the cap do the limiting.
        visibleRef.current.add(id);
        syncVisible();
        return;
      }
      if (!observerRef.current) {
        observerRef.current = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const key = (entry.target as HTMLElement).dataset.mediaId;
              if (!key) continue;
              if (entry.isIntersecting) visibleRef.current.add(key);
              else visibleRef.current.delete(key);
            }
            syncVisible();
          },
          // A third of the tile on screen is enough to be worth playing, and
          // the margin starts the clip just before it scrolls into view.
          { threshold: 0.35, rootMargin: '80px 0px' },
        );
      }
      observerRef.current.observe(el);
    },
    [syncVisible],
  );

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  const playingIds = useMemo(
    () => new Set(playableVideoIds(visibleIds, { reducedMotion })),
    [visibleIds, reducedMotion],
  );

  // ── Derived view model ─────────────────────────────────────────────
  const stats = useMemo(() => summarize(media.map(toKeepsake)), [media]);
  const groups = useMemo(() => groupByDay(media.map(toKeepsake)), [media]);
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const shareMeta = useMemo(() => {
    const copy = useStore.getState().copy;
    return { title: copy.momentTitle, text: copy.shareText };
  }, []);

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar app-bg">
      <EventBackground density={22} />

      {/* Cross-page navigation — top pill on desktop; on mobile GuestNav renders
          a fixed bottom tab bar instead (via portal), so this strip hides on
          small screens while the bottom bar still appears. */}
      <div
        className="hidden sm:flex sticky top-0 z-30 justify-center px-3 pt-4 pb-2"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)' }}
      >
        <GuestNav current="photos" />
      </div>

      {/* Header. Deliberately compact on phones — the old one filled the whole
          first screen, so a guest arriving for their photos saw none of them. */}
      <div className="relative z-10 flex flex-col items-center pb-4 sm:pb-5 px-4 text-center pt-safe-top [--safe-top:0.75rem]">
        {/* The event lockup is the guest's first proof they're in the right
            place, so it stays — but at 72% on a phone it costs ~90px instead of
            ~130px, and the first photos land above the fold. */}
        <div className="scale-[0.72] sm:scale-100 origin-top -mb-6 sm:mb-0">
          <Wordmark size="md" />
        </div>

        <p className="mt-3 sm:mt-4 font-label uppercase tracking-luxe text-[10px] text-[color:var(--color-accent)]/75">
          Your keepsakes
        </p>
        <p className="mt-1.5 font-serif italic text-[26px] sm:text-3xl text-foil-static leading-tight">
          Your moments
        </p>
        <span
          className="mt-3 h-px w-16 block"
          style={{ background: 'linear-gradient(to right, transparent, rgba(var(--accent-rgb),0.6), transparent)' }}
          aria-hidden
        />

        {stats.total > 0 && (
          <p className="mt-3 font-label uppercase tracking-luxe text-[9px] text-brand-muted/55">
            {summaryLine(stats)}
          </p>
        )}

        {!loading && stats.total > 0 && (
          /* One row while both are idle, so the first photos stay above the
             fold; either control takes the column when it opens a panel. */
          <div className="mt-5 w-full max-w-sm mx-auto flex flex-wrap items-center justify-center gap-2.5">
            <SaveAllPanel media={media} filePrefix={config.copy.filePrefix} shareMeta={shareMeta} />
            {/* Hides itself entirely when the browser cannot record a canvas or
                there are too few photos — see RecapPanel. */}
            <RecapPanel
              media={media}
              filePrefix={config.copy.filePrefix}
              eventName={config.copy.eventName}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="relative z-10 px-3 sm:px-6 pb-32 sm:pb-16 max-w-6xl mx-auto pb-safe-bottom [--safe-bottom:7rem]">
        {/* Locally-saved captures are still shown when the server read fails,
            but the guest is told the list is incomplete rather than being left
            to assume some of their photos vanished. */}
        {serverFailed && media.length > 0 && (
          <div className="mb-4 rounded-xl liquid-glass px-4 py-3 flex items-center justify-between gap-3">
            <p className="font-sans text-xs text-brand-muted/80 leading-relaxed">
              Showing what’s saved on this device — we couldn’t reach the event for the rest.
            </p>
            <button
              onClick={fetchAndMerge}
              className="pressable shrink-0 min-h-11 px-4 rounded-lg font-label uppercase tracking-luxe text-[10px] text-brand-fg bg-white/[0.07]"
            >
              Retry
            </button>
          </div>
        )}

        {/* Outcome of the last removal. Same strip as the failed-read notice
            above it, so the page answers in one voice. */}
        {notice && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-xl liquid-glass px-4 py-3 flex items-center justify-between gap-3"
          >
            <p
              className={`font-sans text-xs leading-relaxed ${
                notice.tone === 'error' ? 'text-amber-300' : 'text-brand-muted/80'
              }`}
            >
              {notice.text}
            </p>
            <button
              onClick={() => setNotice(null)}
              className="pressable shrink-0 min-h-11 px-4 rounded-lg font-label uppercase tracking-luxe text-[10px] text-brand-fg bg-white/[0.07]"
            >
              OK
            </button>
          </div>
        )}

        {loading ? (
          /* A skeleton in the real grid shape, so the page does not jump when
             the photos land. */
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="rounded-2xl liquid-glass animate-pulse"
                style={{ aspectRatio: '9 / 16', animationDelay: `${i * 90}ms` }}
              />
            ))}
          </div>
        ) : media.length === 0 && serverFailed ? (
          /* The server read failed and nothing was saved locally — say so
             rather than claiming the guest has never taken a photo. */
          <FetchFailed what="your moments" onRetry={fetchAndMerge} />
        ) : media.length === 0 ? (
          <EmptyKeepsakes basePath={basePath} />
        ) : (
          <div className="flex flex-col gap-7">
            {groups.map((group, gi) => (
              <section key={`${group.key}-${gi}`}>
                {/* One group means one obvious evening — no heading needed. */}
                {groups.length > 1 && (
                  <h2 className="mb-2.5 flex items-center gap-3 font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">
                    {group.label}
                    <span className="flex-1 h-px bg-white/10" aria-hidden />
                    <span className="text-brand-muted/40">{group.items.length}</span>
                  </h2>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 auto-rows-auto">
                  {group.items.map((item, i) => {
                    const m = byId.get(item.id);
                    if (!m) return null;
                    // The newest capture opens the gallery at double size. It
                    // is the one the guest is looking for, and it gives the
                    // page a focal point instead of a uniform contact sheet.
                    const featured = gi === 0 && i === 0 && group.items.length >= 3;
                    return (
                      <MediaCard
                        key={m.id}
                        media={m}
                        featured={featured}
                        playing={playingIds.has(m.id)}
                        register={register}
                        onView={setLightbox}
                        filePrefix={config.copy.filePrefix}
                        onRemove={canRemove ? setRemoveTarget : undefined}
                        removing={removingId === m.id}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Footer link */}
      {!loading && media.length > 0 && (
        <div className="relative z-10 text-center pb-28 sm:pb-10">
          <Link
            to={`${basePath}/booth`}
            className="pressable inline-flex items-center gap-2 min-h-11 px-4 font-label uppercase tracking-luxe text-[10px] text-brand-muted/50 hover:text-brand-fg transition-colors"
          >
            <BackIcon size={13} />
            Back to the booth
          </Link>
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <Lightbox
            key={lightbox.id}
            media={lightbox}
            filePrefix={config.copy.filePrefix}
            onClose={() => setLightbox(null)}
          />
        )}
      </AnimatePresence>

      {/* Remove confirmation. Short, and it names the consequence a guest
          cannot see from here: the wall. */}
      {removeTarget && (
        <ConfirmModal
          title={removeTarget.media_type === 'video' ? 'Remove this video?' : 'Remove this photo?'}
          tone="danger"
          confirmLabel="Remove"
          busy={removingId === removeTarget.id}
          body={
            removeTarget.origin === 'db' ? (
              <>
                It disappears from the wall too. This can’t be undone.
                <span className="block mt-2 text-brand-muted/50">
                  Save it first if you want to keep a copy.
                </span>
              </>
            ) : (
              <>
                This one only exists on this device — it never reached the wall. Removing it
                can’t be undone.
              </>
            )
          }
          onConfirm={() => { void removeMedia(removeTarget); }}
          onCancel={() => {
            if (removingId) return; // don't abandon a removal mid-flight
            setRemoveTarget(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Nothing here yet.
 *
 * The old copy said "No media yet" and pointed at the booth. A guest reaching
 * this screen with nothing usually has one of two problems — they haven't been
 * to the booth, or they used a different phone — and the second one is
 * invisible unless someone says it out loud.
 */
function EmptyKeepsakes({ basePath }: { basePath: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center py-14 text-center px-4"
    >
      <div
        className="relative w-24 h-24 rounded-full liquid-glass flex items-center justify-center mb-6 glow-accent"
      >
        <CameraIcon size={40} className="text-[color:var(--color-accent)]" strokeWidth={1.4} />
      </div>
      <p className="font-serif italic text-2xl text-foil-static mb-3">Nothing here yet</p>
      <p className="font-sans text-brand-muted/70 text-sm mb-7 leading-relaxed max-w-xs">
        Step up to the booth and take your first shot — it lands here the moment you post it.
      </p>

      <Link
        to={`${basePath}/booth`}
        className="pressable inline-flex items-center gap-2 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] px-8 min-h-12 rounded-2xl glow-accent"
      >
        <CameraIcon size={15} strokeWidth={1.8} />
        Open the booth
      </Link>

      <div className="mt-8 max-w-xs liquid-glass rounded-2xl px-4 py-3.5 text-left">
        <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60 mb-1.5">
          Taken photos already?
        </p>
        <p className="font-sans text-xs text-brand-muted/75 leading-relaxed">
          This page shows the moments from <em>this</em> phone or browser. If you used a different
          one — or a private window — open the booth link there and they’ll be waiting.
        </p>
        <Link
          to={`${basePath}/wall`}
          className="pressable mt-3 inline-flex items-center gap-2 min-h-11 font-label uppercase tracking-luxe text-[10px] text-[color:var(--color-accent)]"
        >
          See the live wall instead
        </Link>
      </div>
    </motion.div>
  );
}
