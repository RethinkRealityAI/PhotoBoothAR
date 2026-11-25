/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Take it home" — every way a guest can leave with the night, in the order the
 * owner asked for: the CHOICES first (film / collage / every photo, and the
 * collage's style), then ONE download button, then the preview of what that
 * button will give you (the film itself, the collage canvas, or the photos).
 *
 * Which choices exist is the host's call (`settings.downloads`, filtered by
 * what is actually available — lib/recapKeepsake.takeHomeChoices). With a
 * single option there is no chooser at all, just the button and its preview.
 *
 * "Every photo" reuses lib/bulkSave — the procedure MyPhotos uses — because
 * mobile Safari honours ONE programmatic download per gesture: the bytes are
 * collected once (with honest progress), then a fresh tap hands them to the
 * share sheet (iOS → Photos) or saves a single .zip.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Clapperboard, Download, Images, LayoutGrid, Loader2, Share } from 'lucide-react';
import type { Post } from '../../types';
import type { KeepsakeDownloadId } from '../../lib/keepsakeSettings';
import { COLLAGE_BLURBS, COLLAGE_LABELS, COLLAGE_TEMPLATES, type CollageTemplate } from '../../lib/recapCollage';
import { TAKE_HOME_LABELS } from '../../lib/recapKeepsake';
import {
  ArchiveTooBigError,
  ZipLimitError,
  archiveOf,
  canShareFiles,
  collectFiles,
  downloadBlob,
  shareFiles,
  type CollectedFile,
} from '../../lib/bulkSave';
import PostImage from '../../components/ui/PostImage';
import { shareableVideo } from '../../lib/mp4Export';
import RecapCollageCard, { type CollageHandle, type CollagePhase } from './RecapCollageCard';
import { K_BODY, K_EYEBROW, K_GLASS, K_H2, K_PRIMARY, K_SECONDARY } from './recapStyles';

const ICONS: Record<KeepsakeDownloadId, typeof Clapperboard> = {
  film: Clapperboard,
  collage: LayoutGrid,
  photos: Images,
};

const BLURBS: Record<KeepsakeDownloadId, string> = {
  film: 'The night as a short movie',
  collage: 'One picture to frame',
  photos: 'Every shot, full size',
};

type PhotoSave =
  | { phase: 'idle' }
  | { phase: 'collecting'; done: number; total: number }
  | { phase: 'ready'; files: CollectedFile[]; failed: number }
  | { phase: 'error'; message: string };

function pluralize(n: number, one: string, many: string) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export default function RecapTakeHome({
  choices,
  film,
  photos,
  ownIds,
  title,
  subtitle,
  palette,
  filePrefix,
}: {
  /** Non-empty, display order (lib/recapKeepsake.takeHomeChoices). */
  choices: readonly KeepsakeDownloadId[];
  film: { filmUrl: string; posterUrl: string } | null;
  photos: readonly Post[];
  ownIds: ReadonlySet<string>;
  title: string;
  subtitle: string;
  palette: readonly string[];
  filePrefix: string;
}) {
  const [choice, setChoice] = useState<KeepsakeDownloadId>(choices[0]);
  const active: KeepsakeDownloadId = choices.includes(choice) ? choice : choices[0];
  const [template, setTemplate] = useState<CollageTemplate>('mosaic');
  const collageRef = useRef<CollageHandle>(null);
  const [collage, setCollage] = useState<{ phase: CollagePhase; count: number }>({ phase: 'loading', count: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoSave, setPhotoSave] = useState<PhotoSave>({ phase: 'idle' });
  const shareable = useMemo(() => canShareFiles(), []);

  const onCollagePhase = useCallback((phase: CollagePhase, count: number) => setCollage({ phase, count }), []);

  const pick = (id: KeepsakeDownloadId) => {
    setChoice(id);
    setError(null);
  };

  async function saveCollage() {
    setBusy(true);
    setError(null);
    try {
      const handle = collageRef.current;
      setError(handle === null ? 'Your collage is still being made — give it a moment.' : await handle.save());
    } finally {
      setBusy(false);
    }
  }

  async function collectPhotos() {
    const items = photos.map((p) => ({
      id: p.id,
      url: p.image_url,
      kind: p.media_type === 'video' ? ('video' as const) : ('image' as const),
      createdAt: Date.parse(p.created_at) || 0,
    }));
    setPhotoSave({ phase: 'collecting', done: 0, total: items.length });
    try {
      const res = await collectFiles(items, {
        filePrefix,
        prepareVideo: shareableVideo,
        onProgress: (done, total) => setPhotoSave({ phase: 'collecting', done, total }),
      });
      if (res.files.length === 0) {
        setPhotoSave({ phase: 'error', message: 'We couldn’t download any photos just now. Check your connection and try again.' });
        return;
      }
      setPhotoSave({ phase: 'ready', files: res.files, failed: res.failures.length });
    } catch (e) {
      setPhotoSave({
        phase: 'error',
        message: e instanceof ArchiveTooBigError
          ? 'That’s more than this device can hold at once — save your favourites one by one below.'
          : 'Something went wrong collecting the photos. Try again in a moment.',
      });
    }
  }

  async function handOff(mode: 'share' | 'zip') {
    if (photoSave.phase !== 'ready') return;
    setError(null);
    if (mode === 'share') {
      const out = await shareFiles(photoSave.files, { title });
      if (out === 'shared' || out === 'cancelled') return;
    }
    try {
      downloadBlob(archiveOf(photoSave.files), `${(filePrefix || 'event').replace(/[^A-Za-z0-9]+/g, '-')}-album.zip`);
    } catch (e) {
      setError(e instanceof ZipLimitError
        ? 'That’s too many photos for one file on this device — save your favourites one by one below.'
        : 'We couldn’t make the file on this device. Try another browser.');
    }
  }

  /* ── The one button ─────────────────────────────────────────────── */
  let button: React.ReactNode;
  if (active === 'film' && film !== null) {
    button = (
      <a
        // Cross-origin, so the `download` attribute alone is ignored;
        // Storage's ?download= sets the attachment header instead.
        href={`${film.filmUrl}?download=${encodeURIComponent(`${filePrefix}-film.mp4`)}`}
        download
        className={`${K_PRIMARY} w-full sm:w-auto`}
      >
        <Download className="w-4 h-4" aria-hidden /> Download the film
      </a>
    );
  } else if (active === 'collage') {
    button = (
      <button
        type="button"
        onClick={() => void saveCollage()}
        disabled={collage.phase !== 'ready' || busy}
        className={`${K_PRIMARY} w-full sm:w-auto`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}
        {busy ? 'Saving…' : 'Download collage'}
      </button>
    );
  } else if (photoSave.phase === 'ready') {
    button = (
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        {shareable && (
          <button type="button" onClick={() => void handOff('share')} className={`${K_PRIMARY} w-full sm:w-auto`}>
            <Share className="w-4 h-4" aria-hidden /> Save to Photos
          </button>
        )}
        <button
          type="button"
          onClick={() => void handOff('zip')}
          className={shareable ? `${K_SECONDARY} w-full sm:w-auto` : `${K_PRIMARY} w-full sm:w-auto`}
        >
          <Download className="w-4 h-4" aria-hidden /> Download .zip
        </button>
      </div>
    );
  } else {
    const collecting = photoSave.phase === 'collecting';
    button = (
      <button
        type="button"
        onClick={() => void collectPhotos()}
        disabled={collecting}
        className={`${K_PRIMARY} w-full sm:w-auto`}
      >
        {collecting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}
        {collecting
          ? `Collecting ${photoSave.done} of ${photoSave.total}…`
          : `Download all ${pluralize(photos.length, 'moment', 'moments')}`}
      </button>
    );
  }

  const status =
    photoSave.phase === 'ready' && active === 'photos'
      ? `${pluralize(photoSave.files.length, 'file', 'files')} ready${photoSave.failed > 0 ? ` · ${photoSave.failed} couldn’t be fetched` : ''}. Tap to save.`
      : photoSave.phase === 'error' && active === 'photos'
        ? photoSave.message
        : error;

  return (
    <section
      id="film"
      data-reveal
      aria-labelledby="recap-takehome-title"
      className={`scroll-mt-6 flex flex-col gap-5 rounded-[2rem] p-4 sm:p-7 ${K_GLASS}`}
    >
      <header className="flex flex-col gap-1.5 px-1">
        <p className={K_EYEBROW}>Take it home</p>
        <h2 id="recap-takehome-title" className={K_H2}>Keep the night</h2>
        <p className={`${K_BODY} max-w-md`}>
          {choices.length > 1 ? 'Choose how you want it, then save it to your phone.' : 'Saved straight to your phone, made just for you.'}
        </p>
      </header>

      {/* 1 — the choices */}
      {choices.length > 1 && (
        <div role="radiogroup" aria-label="What to save" className={`grid gap-2 ${choices.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {choices.map((id) => {
            const on = id === active;
            const Icon = ICONS[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(id)}
                className={`group flex min-h-[5.5rem] flex-col items-start justify-between gap-2 rounded-2xl border p-3 text-left transition sm:p-4 ${
                  on
                    ? 'border-[color:var(--k-accent)] bg-[rgba(var(--k-accent-rgb),0.14)] shadow-[0_0_0_1px_rgba(var(--k-accent-rgb),0.35),0_14px_40px_-22px_rgba(var(--k-accent-rgb),0.9)]'
                    : 'border-[color:var(--k-line)] bg-[rgba(var(--k-surface-rgb),0.45)] hover:border-[rgba(var(--k-accent-rgb),0.5)]'
                }`}
              >
                <Icon className={`h-5 w-5 ${on ? 'text-[color:var(--k-accent-text)]' : 'text-[color:var(--k-muted)]'}`} aria-hidden />
                <span className="flex flex-col gap-0.5">
                  <span className="font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-ink)]">{TAKE_HOME_LABELS[id]}</span>
                  <span className="hidden font-sans text-[11px] leading-snug text-[color:var(--k-muted)] sm:block">{BLURBS[id]}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {active === 'collage' && (
        <div role="radiogroup" aria-label="Collage style" className="flex flex-col gap-2">
          <p className="px-1 font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-muted)]">Style</p>
          <div className="grid grid-cols-3 gap-2">
            {COLLAGE_TEMPLATES.map((t) => {
              const on = t === template;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setTemplate(t)}
                  className={`min-h-11 rounded-xl border px-3 py-2 text-left transition ${
                    on
                      ? 'border-[color:var(--k-accent)] bg-[rgba(var(--k-accent-rgb),0.12)]'
                      : 'border-[color:var(--k-line)] hover:border-[rgba(var(--k-accent-rgb),0.5)]'
                  }`}
                >
                  <span className={`block font-label uppercase tracking-luxe text-[10px] ${on ? 'text-[color:var(--k-accent-text)]' : 'text-[color:var(--k-ink)]'}`}>
                    {COLLAGE_LABELS[t]}
                  </span>
                  <span className="mt-0.5 hidden font-sans text-[10px] leading-tight text-[color:var(--k-muted)] sm:block">
                    {COLLAGE_BLURBS[t]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 2 — the button */}
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
        {button}
        {status !== null && (
          <p role={photoSave.phase === 'error' || error !== null ? 'alert' : 'status'} className="font-sans text-xs leading-relaxed text-[color:var(--k-muted)]">
            {status}
          </p>
        )}
      </div>

      {/* 3 — the preview */}
      {active === 'film' && film !== null && (
        <video
          src={film.filmUrl}
          poster={film.posterUrl}
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full rounded-[1.5rem] border border-[color:var(--k-line)] bg-black shadow-[0_40px_80px_-40px_var(--k-shadow)]"
        />
      )}
      {/* Mounted (hidden) whenever collage is offered so its photos decode in
          the background and switching to it is instant. */}
      {choices.includes('collage') && (
        <div hidden={active !== 'collage'}>
          <RecapCollageCard
            ref={collageRef}
            photos={photos}
            ownIds={ownIds}
            template={template}
            title={title}
            subtitle={subtitle}
            palette={palette}
            filePrefix={filePrefix}
            onPhase={onCollagePhase}
          />
        </div>
      )}
      {active === 'photos' && <PhotosPreview photos={photos} />}
    </section>
  );
}

function PhotosPreview({ photos }: { photos: readonly Post[] }) {
  const stills = photos.filter((p) => p.media_type !== 'video').slice(0, 6);
  const clips = photos.filter((p) => p.media_type === 'video').length;
  return (
    <div className="flex flex-col items-center gap-4 rounded-[1.5rem] border border-[color:var(--k-line)] bg-[rgba(var(--k-bg-rgb),0.35)] px-4 py-8">
      <ul className="flex items-end justify-center -space-x-6" aria-hidden>
        {stills.map((p, i) => (
          <li
            key={p.id}
            className="w-16 shrink-0 overflow-hidden rounded-xl border border-[color:var(--k-line)] shadow-[0_14px_30px_-16px_var(--k-shadow)] sm:w-20"
            style={{ transform: `rotate(${(i - (stills.length - 1) / 2) * 6}deg) translateY(${Math.abs(i - (stills.length - 1) / 2) * 4}px)`, aspectRatio: '3 / 4' }}
          >
            <PostImage src={p.image_url} alt="" displayWidth={160} className="h-full w-full object-cover" />
          </li>
        ))}
      </ul>
      <p className="text-center font-sans text-xs leading-relaxed text-[color:var(--k-muted)]">
        {pluralize(photos.length - clips, 'photo', 'photos')}{clips > 0 ? ` and ${pluralize(clips, 'clip', 'clips')}` : ''} at full size.
        <br />
        On iPhone they go straight to Photos; elsewhere you get one .zip.
      </p>
    </div>
  );
}
