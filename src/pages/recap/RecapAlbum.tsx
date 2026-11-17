/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The album: this device's own shots pinned at the top, then the whole night.
 *
 * WHY THIS IS NOT `WallLightbox`. That component is the right one and it is
 * already written — but it calls `useEvent()`, and the recap deliberately mounts
 * OUTSIDE `EventProvider` so it survives the event ending (the provider renders
 * an "ended" screen instead of its children for a signed-out guest). Reaching
 * for it would have meant either a second provider on a finished event or
 * threading event config through a component that reads it from context, both of
 * which are bigger changes than the small viewer below.
 *
 * SAVING A PHOTO. The anchor carries a real `href` and a real `download`, so
 * right-click-save and the no-JS path both work. But photos are served from
 * Supabase Storage, a different origin from the app, and browsers IGNORE
 * `download` cross-origin — the plain anchor would open the picture instead of
 * saving it. So the click is intercepted and the file is fetched to a blob first
 * (the same procedure WallLightbox uses); if that fetch fails, the interception
 * stands down and the browser follows the href, which at worst opens the photo
 * in a tab where a long-press still saves it. Never a dead button.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Download, X } from 'lucide-react';
import type { Post } from '../../types';
import PostImage from '../../components/ui/PostImage';
import { useDialog } from '../../lib/useDialog';
import { recapPhotoFileName } from '../../lib/eventRecap';

/* ── Saving ─────────────────────────────────────────────────────────── */

function SaveLink({
  post,
  filePrefix,
  className,
  children,
  label,
}: {
  post: Post;
  filePrefix: string;
  className?: string;
  children?: React.ReactNode;
  label: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const filename = recapPhotoFileName(filePrefix, post, post.image_url);

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Modified clicks are the user asking the browser for something specific
    // (new tab, new window) — never hijack those.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setState('busy');
    try {
      const res = await fetch(post.image_url, { mode: 'cors' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setState('done');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      // CORS, offline, a storage hiccup — fall back to plain navigation so the
      // guest still reaches their photo.
      setState('idle');
      window.open(post.image_url, '_blank', 'noopener');
    }
  }

  return (
    <a
      href={post.image_url}
      download={filename}
      onClick={(e) => void onClick(e)}
      aria-label={label}
      className={className}
    >
      {state === 'done'
        ? <Check className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden />
        : <Download className={`w-4 h-4 shrink-0 ${state === 'busy' ? 'animate-pulse' : ''}`} aria-hidden />}
      {children}
    </a>
  );
}

/* ── Tiles ──────────────────────────────────────────────────────────── */

function Tile({
  post,
  displayWidth,
  eager,
  onOpen,
}: {
  post: Post;
  displayWidth: number;
  eager?: boolean;
  onOpen: (p: Post) => void;
}) {
  const isVideo = post.media_type === 'video';
  return (
    <button
      type="button"
      onClick={() => onOpen(post)}
      className="group relative block w-full overflow-hidden rounded-2xl border border-white/10 bg-black/30 transition-transform duration-300 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
      style={{ aspectRatio: '3 / 4' }}
      aria-label={post.guest_name ? `Open ${post.guest_name}’s moment` : 'Open this moment'}
    >
      {isVideo ? (
        <video
          src={post.image_url}
          className="h-full w-full object-cover"
          preload="metadata"
          muted
          playsInline
          aria-hidden
        />
      ) : (
        <PostImage
          src={post.image_url}
          alt={post.guest_name ? `A moment by ${post.guest_name}` : 'A moment from the event'}
          displayWidth={displayWidth}
          eager={eager}
          className="h-full w-full object-cover"
        />
      )}
      {isVideo && (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/80">
          Clip
        </span>
      )}
    </button>
  );
}

/* ── The full-bleed viewer ──────────────────────────────────────────── */

function Viewer({
  post,
  filePrefix,
  onClose,
}: {
  post: Post;
  filePrefix: string;
  onClose: () => void;
}) {
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, 'Moment');
  const isVideo = post.media_type === 'video';
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/88 p-4 animate-rise-in">
      <div ref={panelRef} {...dialogProps} className="flex w-full max-w-3xl flex-col items-center gap-4">
        {isVideo ? (
          <video
            src={post.image_url}
            className="max-h-[70vh] w-auto max-w-full rounded-2xl"
            controls
            autoPlay
            playsInline
          />
        ) : (
          <img
            src={post.image_url}
            alt={post.guest_name ? `A moment by ${post.guest_name}` : 'A moment from the event'}
            className="max-h-[70vh] w-auto max-w-full rounded-2xl"
          />
        )}
        {post.message !== null && post.message !== '' && (
          <p className="max-w-lg text-center font-serif italic text-sm text-brand-fg/80">“{post.message}”</p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <SaveLink
            post={post}
            filePrefix={filePrefix}
            label="Save this photo"
            className="flex min-h-11 items-center gap-2 rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[11px] text-[color:var(--on-accent)]"
          >
            Save
          </SaveLink>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full glass px-5 font-label uppercase tracking-luxe text-[11px] text-brand-muted/80"
          >
            <X className="w-4 h-4" aria-hidden /> Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── The album ──────────────────────────────────────────────────────── */

export default function RecapAlbum({
  photos,
  ownPhotos,
  filePrefix,
}: {
  /** Every wall-visible post, newest first. */
  photos: readonly Post[];
  /** The subset this device took, in the same order. */
  ownPhotos: readonly Post[];
  filePrefix: string;
}) {
  const [open, setOpen] = useState<Post | null>(null);
  const onOpen = useCallback((p: Post) => setOpen(p), []);

  // The viewer is a full-screen overlay on a page that scrolls; letting the page
  // scroll underneath it is the classic mobile overlay bug.
  useEffect(() => {
    if (open === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      {ownPhotos.length > 0 && (
        <section data-reveal className="flex flex-col gap-3" aria-labelledby="recap-yours-heading">
          <header className="flex flex-col gap-1">
            <p className="font-label uppercase tracking-luxe text-[10px] text-accent">Yours</p>
            <h2 id="recap-yours-heading" className="font-serif italic text-2xl text-foil-static">
              The ones you took
            </h2>
            <p className="font-sans text-xs text-brand-muted/60 leading-relaxed">
              Saved on this device from the night. Tap one to see it big, or save it straight from here.
            </p>
          </header>
          {/* A rail rather than a grid: it says "these are yours, the album is
              below" without needing a divider, and it stays one swipe on a
              phone however many the guest took. */}
          <ul className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 hide-scrollbar">
            {ownPhotos.map((p) => (
              <li key={p.id} className="w-36 shrink-0 snap-start sm:w-44">
                <Tile post={p} displayWidth={176} eager onOpen={onOpen} />
                <SaveLink
                  post={p}
                  filePrefix={filePrefix}
                  label="Save this photo"
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl glass font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 transition-colors hover:text-accent"
                >
                  Save
                </SaveLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section data-reveal className="flex flex-col gap-3" aria-labelledby="recap-album-heading">
        <header className="flex flex-col gap-1">
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">The album</p>
          <h2 id="recap-album-heading" className="font-serif italic text-2xl text-foil-static">
            Everything from the night
          </h2>
        </header>
        {/* Deliberately NOT [data-reveal-stagger]: that cascades every child at
            0.09s apart, which on a hundred-photo album would take nine seconds
            to finish revealing. The section reveals as one; the tiles fade in
            as their lazy images decode. */}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.id}>
              <Tile post={p} displayWidth={360} eager={i < 4} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      </section>

      {open !== null && <Viewer post={open} filePrefix={filePrefix} onClose={() => setOpen(null)} />}
    </>
  );
}
