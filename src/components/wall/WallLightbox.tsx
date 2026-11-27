/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WallLightbox — tap a photo on the wall to view it large and download/share it.
 * Lets guests grab their shot straight from the wall without finding /me.
 */
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Download, Share2, X, Check, Trash2 } from 'lucide-react';
import { Post } from '../../types';
import { useEvent } from '../../events/EventContext';
import { useDialog } from '../../lib/useDialog';
import { useStore } from '../../store';
import { getSavedPhotos } from '../../lib/session';
import { isMp4Type, shareableVideo, withExtension } from '../../lib/mp4Export';
import { canShareFiles } from '../../lib/bulkSave';
import { isDeleteToken } from '../../lib/postDelete';
import { REACTION_EMOJIS, REACTION_LABELS, type Point, type ReactionEmoji } from '../../lib/wallReactions';

/** Extension for a fetched blob's real type (storage sets it at upload). */
function extForType(type: string, isVideo: boolean): string {
  if (isVideo) return 'mp4';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

export default function WallLightbox({ post, onClose, platform = false, onReact, onRemove }: {
  post: Post;
  onClose: () => void;
  /** Platform walls only: Share hands over the real file, not a link. Legacy
   *  walls keep the link share exactly as before. */
  platform?: boolean;
  /** Platform walls only: the emoji reaction row. `at` is the tapped button's
   *  centre, so this phone's own burst starts under the guest's finger. */
  onReact?: (emoji: ReactionEmoji, at: Point) => void;
  /** Platform phones only: take THIS device's own post down (with Undo). Shown
   *  only when this device holds the post's delete token. */
  onRemove?: (post: Post, deleteToken: string) => void;
}) {
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, 'Moment');
  const { config, eventId } = useEvent();
  /** This device took it (booth saves post ids locally at send time). */
  const mine = getSavedPhotos(eventId).find((p) => p.id === post.id);
  const isMine = mine !== undefined;
  const removeToken = onRemove && isDeleteToken(mine?.deleteToken) ? mine.deleteToken : null;
  const copy = useStore((s) => s.copy);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const isVideo = post.media_type === 'video';
  const ext = isVideo ? (post.image_url.includes('.mp4') ? 'mp4' : 'webm') : 'jpg';
  const filename = `${config.copy.filePrefix}-${post.id.slice(0, 8)}.${ext}`;

  // Share the photo itself. navigator.share must run inside the tap, and a
  // fetch inside the tap can outlive the browser's user-activation window, so
  // the bytes are fetched as the lightbox opens. Until (or unless) they arrive
  // Share falls back to the link, as it always did.
  const [shareFile, setShareFile] = useState<File | null>(null);
  useEffect(() => {
    if (!platform || !canShareFiles()) return;
    const ctrl = new AbortController();
    let live = true;
    void (async () => { // fire-and-forget: a failure leaves the link share in place
      try {
        const res = await fetch(post.image_url, { mode: 'cors', signal: ctrl.signal });
        if (!res.ok) return;
        const blob = await res.blob();
        const type = blob.type.startsWith(isVideo ? 'video/' : 'image/')
          ? blob.type
          : (isVideo ? 'video/mp4' : 'image/jpeg');
        // An older WebM clip keeps the link: many share targets refuse WebM,
        // and converting here would run the transcoder on every open.
        if (isVideo && !isMp4Type(type)) return;
        const file = new File(
          [blob],
          `${config.copy.filePrefix}-${post.id.slice(0, 8)}.${extForType(type, isVideo)}`,
          { type },
        );
        const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
        if (live && nav.canShare?.({ files: [file] }) === true) setShareFile(file);
      } catch {
        // Network, CORS or abort: the link share stands.
      }
    })();
    return () => { live = false; ctrl.abort(); };
  }, [platform, post.image_url, post.id, isVideo, config.copy.filePrefix]);

  async function download() {
    setBusy(true);
    try {
      const fetched = await (await fetch(post.image_url, { mode: 'cors' })).blob();
      // Older clips are stored as WebM; the guest keeps an MP4.
      const v = isVideo ? await shareableVideo(fetched) : null;
      const blob = v ? v.blob : fetched;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = v ? withExtension(filename, v.ext) : filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      // Cross-origin/CORS fallback: open in a new tab so the guest can long-press save.
      window.open(post.image_url, '_blank', 'noopener');
    }
    setBusy(false);
  }

  async function share() {
    if (typeof navigator === 'undefined' || !navigator.share) { download(); return; }
    if (shareFile !== null) {
      try {
        await navigator.share({ files: [shareFile], title: copy.momentTitle });
        return;
      } catch (err) {
        // The guest closed the sheet: nothing to do.
        if (err instanceof Error && err.name === 'AbortError') return;
        // Anything else (the target refused the file): try the link below.
      }
    }
    try {
      await navigator.share({ title: copy.momentTitle, text: post.message ?? copy.shareText, url: post.image_url });
    } catch { /* cancelled */ }
  }

  return (
    <motion.div
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center p-6 bg-noir-900/85 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      {/* A full-bleed photo viewer, so not Modal-shaped — but it is a dialog,
          and it had no Escape (the only way out on a keyboard) and no focus
          trap. Mounted only while open, so the hook needs no enabled flag. */}
      <motion.div
        ref={panelRef}
        {...dialogProps}
        className="relative max-w-[92vw] max-h-[78vh] flex flex-col items-center outline-none"
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 16 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        {isVideo ? (
          <video src={post.image_url} autoPlay loop muted playsInline className={`max-w-[92vw] ${onReact ? 'max-h-[54vh]' : 'max-h-[64vh]'} object-contain rounded-2xl shadow-2xl`} style={{ border: '1px solid rgba(var(--accent-rgb),0.25)' }} />
        ) : (
          <img src={post.image_url} alt={post.guest_name ?? 'Moment'} className={`max-w-[92vw] ${onReact ? 'max-h-[54vh]' : 'max-h-[64vh]'} object-contain rounded-2xl shadow-2xl`} style={{ border: '1px solid rgba(var(--accent-rgb),0.25)' }} />
        )}

        {isMine && (
          <span
            className="mt-3 rounded-full px-2.5 py-0.5 font-label text-[10px] uppercase tracking-wide"
            style={{
              background: 'rgba(10,7,3,0.72)',
              border: '1px solid rgba(var(--accent-rgb),0.55)',
              color: 'var(--color-accent)',
            }}
          >
            Yours
          </span>
        )}
        {(post.guest_name || post.message) && (
          <div className="mt-3 text-center">
            {post.guest_name && <p className="font-serif italic text-xl text-ivory/90 leading-tight">{post.guest_name}</p>}
            {post.message && <p className="font-sans text-champagne/70 text-sm mt-0.5">{post.message}</p>}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={download}
            disabled={busy}
            className="bg-foil glow-accent text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] rounded-xl px-5 py-3 flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 disabled:opacity-60"
          >
            {done ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            {done ? 'Saved' : busy ? 'Saving…' : 'Download'}
          </button>
          {typeof navigator !== 'undefined' && navigator.share && (
            <button
              onClick={share}
              className="glass rounded-xl px-5 py-3 flex items-center gap-2 text-champagne/80 hover:text-gold-300 transition-colors font-label uppercase tracking-luxe text-[11px]"
              style={{ border: '1px solid rgba(var(--accent-rgb),0.25)' }}
            >
              <Share2 className="w-4 h-4" /> Share
            </button>
          )}
        </div>

        {removeToken !== null && onRemove && (
          <button
            type="button"
            onClick={() => onRemove(post, removeToken)}
            className="mt-2 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl font-label uppercase tracking-luxe text-[10px] text-champagne/60 hover:text-red-300 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden />
            Remove from wall
          </button>
        )}

        {onReact && (
          <div
            role="group"
            aria-label="React on the Live wall"
            className="wall-glass mt-4 flex items-center gap-1 rounded-full p-1"
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`${REACTION_LABELS[emoji]}: send to the Live wall`}
                title={REACTION_LABELS[emoji]}
                className="pressable flex h-11 w-11 items-center justify-center rounded-full text-[22px] leading-none hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  onReact(emoji, { x: r.left + r.width / 2, y: r.top });
                }}
              >
                <span aria-hidden>{emoji}</span>
              </button>
            ))}
          </div>
        )}
      </motion.div>

      {/* Close */}
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-5 right-5 w-10 h-10 rounded-full glass flex items-center justify-center text-champagne/70 hover:text-ivory transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </motion.div>
  );
}
