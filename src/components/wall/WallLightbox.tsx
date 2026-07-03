/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WallLightbox — tap a photo on the wall to view it large and download/share it.
 * Lets guests grab their shot straight from the wall without finding /me.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { Download, Share2, X, Check } from 'lucide-react';
import { Post } from '../../types';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';

export default function WallLightbox({ post, onClose }: { post: Post; onClose: () => void }) {
  const { config } = useEvent();
  const copy = useStore((s) => s.copy);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const isVideo = post.media_type === 'video';
  const ext = isVideo ? (post.image_url.includes('.mp4') ? 'mp4' : 'webm') : 'jpg';
  const filename = `${config.copy.filePrefix}-${post.id.slice(0, 8)}.${ext}`;

  async function download() {
    setBusy(true);
    try {
      const blob = await (await fetch(post.image_url, { mode: 'cors' })).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
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
      <motion.div
        className="relative max-w-[92vw] max-h-[78vh] flex flex-col items-center"
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 16 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        {isVideo ? (
          <video src={post.image_url} autoPlay loop muted playsInline className="max-w-[92vw] max-h-[64vh] object-contain rounded-2xl shadow-2xl" style={{ border: '1px solid rgba(var(--accent-rgb),0.25)' }} />
        ) : (
          <img src={post.image_url} alt={post.guest_name ?? 'Moment'} className="max-w-[92vw] max-h-[64vh] object-contain rounded-2xl shadow-2xl" style={{ border: '1px solid rgba(var(--accent-rgb),0.25)' }} />
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
            className="bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl px-5 py-3 flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 disabled:opacity-60"
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
