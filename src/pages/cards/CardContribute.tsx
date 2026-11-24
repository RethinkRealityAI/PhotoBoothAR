/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /c/:publicId/contribute?t=<token> — guest contribution page for a greeting
 * card. The ?t token is the credential (validated by the card-contribute edge
 * function); mobile-first, GoldFrameCard-style premium framing with neutral
 * platform styling (works outside EventProvider).
 *
 * Flow: load meta by token → name (required) + message (optional ≤600) →
 * EITHER record in the AR BOOTH (the same camera as the landing demo: frames,
 * effects and face-tracked 3D props; photo or a ≤20s video, full screen), or
 * the plain CaptureSurface camera as a fallback for devices the booth can't
 * run on, OR upload a file, OR send a text-only note → init/upload/finalize
 * → warm success screen.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Camera, Check, Heart, Loader2, PenLine, RotateCcw, Sparkles, Upload, Video } from 'lucide-react';
import GoldFrameCard from '../../components/ui/GoldFrameCard';
import CaptureSurface, { type CaptureMeta } from '../../components/capture/CaptureSurface';
import { dataUrlToBlob } from '../../components/booth/capture';
import { cardBoothKit } from '../../lib/demoKits';

// The booth carries three.js + the face tracker: load it only when a guest
// actually opens it, so the contribute form itself stays light.
const CameraExperience = lazy(() => import('../../components/landing/CameraExperience'));
import { getSessionId } from '../../lib/session';
import {
  fetchContributeMeta,
  submitContribution,
  type CardsError,
  type ContributeMeta,
} from '../../lib/cards';
import { useCardTheme } from '../../components/cards/useCardTheme';

const CARD_VIDEO_MAX_SEC = 20;
const MESSAGE_MAX = 600;
const MAX_PHOTO_MB = 8;
const MAX_VIDEO_MB = 60;

type MediaTab = 'record' | 'upload' | 'text';
type RecordMode = 'photo' | 'video';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'closed'; meta: ContributeMeta }
  | { phase: 'ready'; meta: ContributeMeta };

interface CapturedMedia {
  blob: Blob;
  mediaType: 'photo' | 'video';
  durationSeconds?: number;
  previewUrl: string;
}

function errorCopy(err: CardsError): string {
  switch (err) {
    case 'quota_exceeded':
      return "You've added quite a few already — please try again in a little while.";
    case 'object_too_large':
      return `That file is too large (photos up to ${MAX_PHOTO_MB} MB, videos up to ${MAX_VIDEO_MB} MB).`;
    case 'card_closed':
    case 'deadline_passed':
      return 'This card just stopped collecting messages.';
    case 'message_required':
      return 'Please write a message for your note.';
    case 'network':
      return 'Connection hiccup — check your network and try again.';
    default:
      return "Something went wrong sending your message. Please try again.";
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 app-bg overflow-y-auto">
      <div
        className="pointer-events-none fixed inset-0"
        style={{ background: 'radial-gradient(90% 60% at 50% 0%, rgba(var(--accent-rgb),0.07) 0%, transparent 60%)' }}
        aria-hidden
      />
      <div className="relative mx-auto w-full max-w-md px-4 py-8 min-h-full flex flex-col justify-center">
        {children}
      </div>
    </div>
  );
}

function CenterCard({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <Shell>
      <GoldFrameCard contentClassName="px-8 py-12">
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">{eyebrow}</p>
        <h1 className="mt-3 font-serif italic text-3xl text-foil-static">{title}</h1>
        {body && <p className="mt-3 font-sans text-sm text-brand-muted/60 leading-relaxed">{body}</p>}
      </GoldFrameCard>
    </Shell>
  );
}

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60 ' +
  'focus:bg-white/[0.06]';

export default function CardContribute() {
  const { publicId = '' } = useParams<{ publicId: string }>();
  const [search] = useSearchParams();
  const token = (search.get('t') ?? '').trim();

  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<MediaTab>('record');
  const [recordMode, setRecordMode] = useState<RecordMode>('video');
  const [captured, setCaptured] = useState<CapturedMedia | null>(null);
  const [boothOpen, setBoothOpen] = useState(false);
  // The plain camera, for a device the AR booth can't run on (very old phones,
  // WebGL off). Same capture contract, no AR.
  const [simpleCamera, setSimpleCamera] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Wear the event's look (snapshotted onto the card) rather than platform
  // neutral — a guest adding a message should feel like they are still at the
  // event. Older card-contribute deployments omit `theme`; that stays neutral.
  useCardTheme(state.phase === 'ready' || state.phase === 'closed' ? state.meta.theme : null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const capturedRef = useRef<CapturedMedia | null>(null);
  capturedRef.current = captured;

  useEffect(() => {
    document.title = 'Add to the card · Beamwall';
    if (!token) {
      setState({ phase: 'invalid' });
      return;
    }
    let alive = true;
    fetchContributeMeta(token).then(({ data, error: err }) => {
      if (!alive) return;
      if (err || !data) {
        setState({ phase: 'invalid' });
        return;
      }
      setState(data.status === 'collecting' ? { phase: 'ready', meta: data } : { phase: 'closed', meta: data });
    });
    return () => { alive = false; };
  }, [token]);

  // Revoke preview object URLs on unmount.
  useEffect(() => {
    return () => {
      if (capturedRef.current) URL.revokeObjectURL(capturedRef.current.previewUrl);
    };
  }, []);

  const setMedia = useCallback((media: CapturedMedia | null) => {
    setCaptured((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return media;
    });
  }, []);

  const handleCapture = useCallback((blob: Blob, meta: CaptureMeta) => {
    setMedia({
      blob,
      mediaType: meta.mediaType,
      durationSeconds: meta.durationMs !== undefined ? Math.round(meta.durationMs / 100) / 10 : undefined,
      previewUrl: URL.createObjectURL(blob),
    });
  }, [setMedia]);

  const handleBoothPhoto = useCallback((dataUrl: string) => {
    const blob = dataUrlToBlob(dataUrl);
    setMedia({ blob, mediaType: 'photo', previewUrl: URL.createObjectURL(blob) });
    setBoothOpen(false);
  }, [setMedia]);

  const handleBoothVideo = useCallback((blob: Blob, durationMs: number) => {
    setMedia({
      blob,
      mediaType: 'video',
      durationSeconds: Math.round(durationMs / 100) / 10,
      previewUrl: URL.createObjectURL(blob),
    });
    setBoothOpen(false);
  }, [setMedia]);

  // Full-screen booth: lock the page behind it and let Escape close it.
  useEffect(() => {
    if (!boothOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBoothOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [boothOpen]);

  const handleFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      setError('Please choose a photo or a video file.');
      return;
    }
    const maxMb = isVideo ? MAX_VIDEO_MB : MAX_PHOTO_MB;
    if (file.size > maxMb * 1024 * 1024) {
      setError(`That file is larger than ${maxMb} MB — please pick a smaller one.`);
      return;
    }
    setError(null);
    setMedia({
      blob: file,
      mediaType: isVideo ? 'video' : 'photo',
      previewUrl: URL.createObjectURL(file),
    });
  }, [setMedia]);

  const meta = state.phase === 'ready' || state.phase === 'closed' ? state.meta : null;
  const recipient = meta?.recipientName || 'the recipient';
  const boothKit = useMemo(() => cardBoothKit(meta?.title), [meta?.title]);
  const isText = tab === 'text';
  const canSubmit =
    Boolean(name.trim()) && !submitting && (isText ? Boolean(message.trim()) : Boolean(captured));

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const sessionId = getSessionId(`card-${publicId}`);
    const res = await submitContribution(token, sessionId, {
      contributorName: name.trim(),
      message: message.trim() || undefined,
      mediaType: isText ? 'text' : captured!.mediaType,
      blob: isText ? undefined : captured!.blob,
      durationSeconds: isText ? undefined : captured?.durationSeconds,
    });
    setSubmitting(false);
    if (res.error) {
      setError(errorCopy(res.error));
      return;
    }
    setDone(true);
  }, [canSubmit, publicId, token, name, message, isText, captured]);

  /* ── Screens ─────────────────────────────────────────────────────── */

  if (state.phase === 'loading') {
    return <CenterCard eyebrow="Greeting card" title="Setting things up…" />;
  }
  if (state.phase === 'invalid') {
    return (
      <CenterCard
        eyebrow="Greeting card"
        title="This link isn't valid"
        body="Double-check the invitation link you were given — it should include its secret key."
      />
    );
  }
  if (state.phase === 'closed') {
    return (
      <CenterCard
        eyebrow={meta?.eventName ?? 'Greeting card'}
        title="This card is no longer collecting"
        body={`The messages for ${recipient} have been gathered up. Thank you for thinking of them!`}
      />
    );
  }
  if (done) {
    return (
      <Shell>
        <GoldFrameCard contentClassName="px-8 py-12">
          <div className="w-14 h-14 rounded-full bg-foil glow-accent flex items-center justify-center">
            <Heart className="w-6 h-6 text-[color:var(--on-accent)]" />
          </div>
          <h1 className="mt-5 font-serif italic text-3xl text-foil-static">Beautifully done</h1>
          <p className="mt-3 font-sans text-sm text-brand-muted/70 leading-relaxed">
            Your message is on its way to {recipient}.
          </p>
          <button
            onClick={() => {
              setMedia(null);
              setMessage('');
              setDone(false);
            }}
            className="mt-7 min-h-11 rounded-full liquid-glass-raised px-6 py-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg transition"
          >
            Add another
          </button>
        </GoldFrameCard>
      </Shell>
    );
  }

  const tabs: { id: MediaTab; label: string; icon: typeof Camera }[] = [
    { id: 'record', label: 'Booth', icon: Sparkles },
    { id: 'upload', label: 'Upload', icon: Upload },
    { id: 'text', label: 'Note only', icon: PenLine },
  ];

  return (
    <Shell>
      {/* Header card */}
      <GoldFrameCard className="mb-5" contentClassName="px-7 py-8">
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">
          {meta?.eventName ?? 'Greeting card'}
        </p>
        <h1 className="mt-2 font-serif italic text-2xl leading-snug text-foil-static">{meta?.title}</h1>
        <p className="mt-2 font-sans text-xs text-brand-muted/65 leading-relaxed">
          Leave a photo, a short video or a note — it all goes into a card for {recipient}.
        </p>
      </GoldFrameCard>

      <div className="flex flex-col gap-4">
        {/* Name + message */}
        <label className="flex flex-col gap-1.5">
          <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Aunty Bola"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">
            {isText ? 'Your note' : 'A few words (optional)'}
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
            rows={isText ? 5 : 2}
            placeholder={`Wishing you all the joy, ${meta?.recipientName ?? 'friend'}…`}
            className={`${inputClass} resize-none`}
          />
          <span className="self-end font-mono text-[10px] text-brand-muted/40">{message.length}/{MESSAGE_MAX}</span>
        </label>

        {/* Media source tabs */}
        <div className="flex items-center gap-1 rounded-full bg-white/[0.04] border border-white/10 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex min-h-11 items-center justify-center gap-1.5 rounded-full px-2 py-2 font-label uppercase tracking-luxe text-[10px] transition ${
                tab === t.id ? 'is-selected bg-foil text-[color:var(--on-accent)] font-bold' : 'text-brand-muted/60 hover:text-brand-fg'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {/* AR booth launcher */}
        {tab === 'record' && !captured && !simpleCamera && (
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => setBoothOpen(true)}
              className="group flex w-full items-center gap-4 rounded-2xl border border-accent/30 p-4 text-left transition active:scale-[0.99]"
              style={{ background: 'radial-gradient(120% 140% at 0% 0%, rgba(var(--accent-rgb),0.16), rgba(255,255,255,0.02) 60%)' }}
              aria-label="Open the photo booth"
            >
              <span className="relative h-36 w-[81px] shrink-0 overflow-hidden rounded-xl bg-[radial-gradient(circle_at_50%_32%,rgba(var(--accent-rgb),0.55),rgba(var(--accent-rgb),0.12)_60%,rgba(255,255,255,0.04))] ring-1 ring-white/15 shadow-lg">
                {boothKit.frames[0] ? (
                  <img
                    src={boothKit.frames[0].thumb}
                    alt=""
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    draggable={false}
                  />
                ) : (
                  <span
                    className="flex h-full w-full items-center justify-center"
                    style={{ background: 'radial-gradient(circle at 50% 35%, rgba(var(--accent-rgb),0.45), transparent 75%)' }}
                  >
                    <Sparkles className="h-7 w-7 text-white/90" />
                  </span>
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="font-serif italic text-xl leading-tight text-brand-fg">Step into the booth</span>
                <span className="font-sans text-xs leading-relaxed text-brand-muted/75">
                  Frames, sparkle effects and 3D props that follow your face. Take a photo or record up to {CARD_VIDEO_MAX_SEC} seconds.
                </span>
                <span className="mt-1 inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-foil px-5 font-label uppercase tracking-luxe text-[10px] font-bold text-[color:var(--on-accent)] glow-accent">
                  <Camera className="h-4 w-4" /> Open the booth
                </span>
              </span>
            </button>
            <button
              onClick={() => setSimpleCamera(true)}
              className="min-h-11 px-3 font-sans text-[11px] text-brand-muted/60 underline underline-offset-4 hover:text-brand-fg"
            >
              Booth not working? Use the simple camera
            </button>
          </div>
        )}

        {/* Plain camera (fallback) */}
        {tab === 'record' && !captured && simpleCamera && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-center">
              <div className="flex items-center gap-1 rounded-full bg-white/[0.04] border border-white/10 p-1">
                <button
                  onClick={() => setRecordMode('photo')}
                  className={`flex min-h-11 items-center gap-1.5 rounded-full px-4 py-1.5 font-label uppercase tracking-luxe text-[10px] transition ${
                    recordMode === 'photo' ? 'bg-white/[0.14] text-brand-fg' : 'text-brand-muted/50'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" /> Photo
                </button>
                <button
                  onClick={() => setRecordMode('video')}
                  className={`flex min-h-11 items-center gap-1.5 rounded-full px-4 py-1.5 font-label uppercase tracking-luxe text-[10px] transition ${
                    recordMode === 'video' ? 'bg-white/[0.14] text-brand-fg' : 'text-brand-muted/50'
                  }`}
                >
                  <Video className="w-3.5 h-3.5" /> Video · {CARD_VIDEO_MAX_SEC}s
                </button>
              </div>
            </div>
            <CaptureSurface
              mode={recordMode}
              maxVideoSec={CARD_VIDEO_MAX_SEC}
              onCapture={handleCapture}
              className="aspect-[3/4] w-full"
            />
            <button
              onClick={() => setSimpleCamera(false)}
              className="min-h-11 self-center px-3 font-sans text-[11px] text-brand-muted/60 underline underline-offset-4 hover:text-brand-fg"
            >
              Back to the AR booth
            </button>
          </div>
        )}

        {/* Upload */}
        {tab === 'upload' && !captured && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-accent/25 bg-white/[0.02] px-6 py-12 text-center hover:border-accent/45 transition"
          >
            <Upload className="w-7 h-7 text-accent/80" />
            <span className="font-sans text-sm text-brand-muted/70">
              Choose a photo or video<br />
              <span className="text-[10px] text-brand-muted/45">
                photos up to {MAX_PHOTO_MB} MB · videos up to {MAX_VIDEO_MB} MB
              </span>
            </span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="sr-only"
          onChange={handleFile}
        />

        {/* Preview of the chosen/captured media */}
        {!isText && captured && (
          <div className="relative overflow-hidden rounded-2xl border border-accent/25 bg-black">
            {captured.mediaType === 'photo' ? (
              <img src={captured.previewUrl} alt="Your capture" className="w-full max-h-96 object-contain" />
            ) : (
              <video src={captured.previewUrl} controls playsInline className="w-full max-h-96" />
            )}
            <button
              onClick={() => {
                setMedia(null);
                // Retaking from the booth goes straight back into it.
                if (tab === 'record' && !simpleCamera) setBoothOpen(true);
              }}
              className="absolute top-3 right-3 flex min-h-11 items-center gap-1.5 rounded-full bg-black/60 border border-white/15 px-3 py-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg"
            >
              <RotateCcw className="w-3 h-3" /> Redo
            </button>
          </div>
        )}

        {error && <p role="alert" className="font-sans text-xs text-red-400">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="mt-1 w-full rounded-full bg-foil px-6 py-4 font-label uppercase tracking-luxe text-[11px] font-bold text-[color:var(--on-accent)] glow-accent transition active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {submitting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
          ) : (
            <><Check className="w-4 h-4" /> Add to the card</>
          )}
        </button>
        <p className="text-center font-sans text-[10px] text-brand-muted/40 pb-4">
          Your contribution is only visible once the host publishes the card.
        </p>
      </div>

      {/* The AR booth, full screen over the form. */}
      {boothOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-void-900"
          role="dialog"
          aria-modal="true"
          aria-label="Photo booth"
        >
          <div className="relative mx-auto min-h-0 w-full max-w-[430px] flex-1 overflow-hidden sm:my-3 sm:rounded-3xl">
            <Suspense
              fallback={
                <div className="flex h-full w-full items-center justify-center">
                  <span className="font-label text-[10px] uppercase tracking-luxe text-brand-muted/70 animate-pulse">
                    Opening the booth…
                  </span>
                </div>
              }
            >
              <CameraExperience
                enabled
                videoId="card-booth-video"
                beamLabel="Use this photo"
                onBeam={handleBoothPhoto}
                onClose={() => setBoothOpen(false)}
                kit={boothKit}
                videoMaxSec={CARD_VIDEO_MAX_SEC}
                onVideo={handleBoothVideo}
                initialMode={recordMode}
              />
            </Suspense>
          </div>
        </div>
      )}
    </Shell>
  );
}
