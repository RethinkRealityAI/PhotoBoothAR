/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MyPhotos — guest "My Media" download portal at /me (and /gallery).
 * (Export stays named `MyPhotos` for App.tsx; the UI reads "My Media".)
 *
 * Sources photos from:
 *   1. getSavedPhotos()  — localStorage, instant, persists on this device
 *   2. fetchMyPosts()    — server posts tagged with this device's session_id
 *
 * Merges + dedupes by id, sorts newest first.
 * Listens for 'gallery:changed' window event to refresh.
 *
 * Features:
 *   - Tap-to-enlarge lightbox (image AND video)
 *   - Per-photo/video Download (fetch→blob→anchor, .jpg / .webm / .mp4)
 *   - Per-photo/video Share (navigator.share)
 *   - "Download all" batch button
 *   - Video: inline autoplay preview + play-badge in grid
 *   - Custom on-theme SVG icons (see ./ui/MediaIcons) — no emoji/text glyphs
 *   - Elegant on-theme mobile-first layout
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { getSavedPhotos } from '../lib/session';
import { fetchMyPosts } from '../lib/db';
import { SavedPhoto, Post, MediaType } from '../types';
import { useEvent } from '../events/EventContext';
import { useStore } from '../store';
import EventBackground from './ui/EventBackground';
import { Wordmark } from './ui/EventLogo';
import {
  CameraIcon,
  PhotoIcon,
  VideoIcon,
  DownloadIcon,
  ShareIcon,
  ExpandIcon,
  CloseIcon,
  BackIcon,
  GalleryIcon,
} from './ui/MediaIcons';

// ----------------------------------------------------------------
// Unified media type for this view
// ----------------------------------------------------------------
interface GalaMedia {
  id: string;
  image_url: string;
  media_type: MediaType;
  message?: string | null;
  createdAt: number; // ms epoch
}

function postToMedia(p: Post): GalaMedia {
  return {
    id: p.id,
    image_url: p.image_url,
    media_type: p.media_type ?? 'image',
    message: p.message,
    createdAt: new Date(p.created_at).getTime(),
  };
}

function savedToMedia(s: SavedPhoto): GalaMedia {
  return {
    id: s.id,
    image_url: s.image_url,
    media_type: s.media_type ?? 'image',
    message: s.message,
    createdAt: s.createdAt,
  };
}

// ----------------------------------------------------------------
// Download helper: fetch → blob → anchor click
// ----------------------------------------------------------------
async function downloadMedia(media: GalaMedia, filePrefix: string): Promise<void> {
  const isVideo = media.media_type === 'video';
  // Determine best extension from URL or type
  let ext = 'jpg';
  if (isVideo) {
    ext = media.image_url.includes('.mp4') ? 'mp4' : 'webm';
  }
  const filename = `${filePrefix}_${media.id.slice(0, 8)}.${ext}`;
  try {
    const resp = await fetch(media.image_url, { mode: 'cors' });
    if (!resp.ok) throw new Error('fetch failed');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    window.open(media.image_url, '_blank', 'noopener');
    console.error('[MyPhotos] download error', err);
  }
}

// ----------------------------------------------------------------
// PlayBadge
// ----------------------------------------------------------------
function PlayBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'md' ? 36 : 26;
  return (
    <div
      className="absolute top-2 right-2 z-10 flex items-center justify-center rounded-full"
      style={{
        width: dim,
        height: dim,
        background: 'rgba(10,7,3,0.72)',
        border: '1px solid rgba(var(--accent-rgb),0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <svg
        width={size === 'md' ? 13 : 9}
        height={size === 'md' ? 16 : 11}
        viewBox="0 0 10 12"
        fill="none"
      >
        <path d="M1 1.5 L9 6 L1 10.5 Z" fill="#D4AF37" />
      </svg>
    </div>
  );
}

// ----------------------------------------------------------------
// MediaCard (grid)
// ----------------------------------------------------------------
function MediaCard({ media, onView }: { media: GalaMedia; onView: (m: GalaMedia) => void }) {
  const { config } = useEvent();
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const isVideo = media.media_type === 'video';

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloading(true);
    await downloadMedia(media, config.copy.filePrefix);
    setDownloading(false);
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canShare) return;
    setSharing(true);
    try {
      await navigator.share({
        title: useStore.getState().copy.momentTitle,
        text: media.message ?? useStore.getState().copy.shareText,
        url: media.image_url,
      });
    } catch {
      // User cancelled or share failed — non-fatal
    }
    setSharing(false);
  };

  return (
    <motion.div
      className="relative rounded-2xl overflow-hidden cursor-pointer group"
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onView(media)}
      style={{
        boxShadow: '0 4px 28px rgba(0,0,0,0.55)',
        border: '1px solid rgba(var(--accent-rgb),0.12)',
      }}
    >
      {isVideo ? (
        <>
          <video
            src={media.image_url}
            autoPlay
            loop
            muted
            playsInline
            className="w-full block object-cover"
            style={{ aspectRatio: '9/16', background: '#0a0703' }}
          />
          <PlayBadge />
        </>
      ) : (
        <img
          src={media.image_url}
          alt="Your gala moment"
          className="w-full block object-cover"
          style={{ aspectRatio: '9/16' }}
          loading="lazy"
          decoding="async"
        />
      )}

      {/* Hover / always-visible action bar */}
      <div
        className="absolute bottom-0 inset-x-0 flex gap-2 p-3"
        style={{
          background:
            'linear-gradient(to top, rgba(10,7,3,0.88) 0%, rgba(10,7,3,0) 100%)',
        }}
      >
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[10px] py-2 rounded-xl glow-accent transition-all disabled:opacity-60"
          style={{ border: 'none' }}
          aria-label={isVideo ? 'Save video' : 'Save photo'}
        >
          {downloading ? (
            <span className="block w-3.5 h-3.5 rounded-full border-2 border-noir-900/30 border-t-noir-900 animate-spin" />
          ) : (
            <>
              <DownloadIcon size={13} strokeWidth={1.8} />
              {isVideo ? 'Save Video' : 'Save'}
            </>
          )}
        </button>

        {canShare && (
          <button
            onClick={handleShare}
            disabled={sharing}
            className="glass inline-flex items-center justify-center text-gold-300 py-2 px-3 rounded-xl transition-all disabled:opacity-60"
            style={{ border: '1px solid rgba(var(--accent-rgb),0.22)' }}
            aria-label="Share"
          >
            {sharing ? (
              <span className="block w-3.5 h-3.5 rounded-full border-2 border-gold-300/30 border-t-gold-300 animate-spin" />
            ) : (
              <ShareIcon size={15} />
            )}
          </button>
        )}
      </div>

      {/* Media-type chip (top-left) */}
      <div
        className="absolute top-2 left-2 flex items-center justify-center rounded-full glass-strong text-gold-300"
        style={{ width: 26, height: 26, border: '1px solid rgba(var(--accent-rgb),0.3)' }}
        aria-hidden
      >
        {isVideo ? <VideoIcon size={13} /> : <PhotoIcon size={13} />}
      </div>

      {/* Gold tap-to-enlarge hint */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
        <div
          className="flex items-center justify-center rounded-full glass-strong text-gold-300"
          style={{ width: 44, height: 44, border: '1px solid rgba(var(--accent-rgb),0.35)' }}
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
function Lightbox({ media, onClose }: { media: GalaMedia; onClose: () => void }) {
  const { config } = useEvent();
  const [downloading, setDownloading] = useState(false);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const isVideo = media.media_type === 'video';

  const handleDownload = async () => {
    setDownloading(true);
    await downloadMedia(media, config.copy.filePrefix);
    setDownloading(false);
  };

  const handleShare = async () => {
    if (!canShare) return;
    try {
      await navigator.share({
        title: useStore.getState().copy.momentTitle,
        text: media.message ?? useStore.getState().copy.shareText,
        url: media.image_url,
      });
    } catch {
      // cancelled
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
      style={{ background: 'rgba(5,3,1,0.92)', backdropFilter: 'blur(12px)' }}
    >
      <motion.div
        className="relative max-w-sm w-full"
        initial={{ scale: 0.88, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.88, y: 20 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        {isVideo ? (
          <div className="relative rounded-2xl overflow-hidden" style={{ boxShadow: '0 0 60px rgba(var(--accent-rgb),0.18)' }}>
            <video
              src={media.image_url}
              autoPlay
              loop
              muted
              playsInline
              controls
              className="w-full rounded-2xl"
              style={{ background: '#0a0703' }}
            />
            <PlayBadge size="md" />
          </div>
        ) : (
          <img
            src={media.image_url}
            alt="Your gala moment"
            className="w-full rounded-2xl"
            style={{ boxShadow: '0 0 60px rgba(var(--accent-rgb),0.18)' }}
          />
        )}

        {media.message && (
          <p className="mt-3 text-center font-serif italic text-ivory/80 text-sm px-4">
            {media.message}
          </p>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] py-3 rounded-xl glow-accent transition-all disabled:opacity-60"
            aria-label={isVideo ? 'Download video' : 'Download photo'}
          >
            {downloading ? (
              <>
                <span className="block w-4 h-4 rounded-full border-2 border-noir-900/30 border-t-noir-900 animate-spin" />
                Saving
              </>
            ) : (
              <>
                <DownloadIcon size={15} strokeWidth={1.8} />
                {isVideo ? 'Download Video' : 'Download'}
              </>
            )}
          </button>
          {canShare && (
            <button
              onClick={handleShare}
              className="glass inline-flex items-center justify-center gap-2 text-gold-300 font-label uppercase tracking-luxe text-[11px] py-3 px-5 rounded-xl transition-all"
              style={{ border: '1px solid rgba(var(--accent-rgb),0.22)' }}
              aria-label="Share"
            >
              <ShareIcon size={15} />
              Share
            </button>
          )}
        </div>

        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 glass-strong w-9 h-9 rounded-full flex items-center justify-center text-champagne/80 hover:text-ivory transition-colors"
          style={{ border: '1px solid rgba(var(--accent-rgb),0.3)' }}
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
  const { eventId, config, basePath } = useEvent();
  const [media, setMedia] = useState<GalaMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<GalaMedia | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const fetchAndMerge = useCallback(async () => {
    const [saved, serverPosts] = await Promise.all([
      Promise.resolve(getSavedPhotos(eventId)),
      fetchMyPosts(eventId),
    ]);

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
    const handler = () => fetchAndMerge();
    window.addEventListener('gallery:changed', handler);
    return () => window.removeEventListener('gallery:changed', handler);
  }, [fetchAndMerge]);

  // Download all
  const handleDownloadAll = async () => {
    if (media.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    for (const item of media) {
      await downloadMedia(item, config.copy.filePrefix);
      await new Promise((r) => setTimeout(r, 600));
    }
    setDownloadingAll(false);
  };

  const total = media.length;
  const videoCount = media.filter((m) => m.media_type === 'video').length;

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar bg-noir-900">
      <EventBackground density={28} />

      {/* Top nav — always-visible way back to the booth and the live wall. */}
      <div className="relative z-20 flex items-center justify-center gap-2 px-4 pt-4">
        <a
          href={basePath || '/'}
          className="flex items-center gap-1.5 px-3.5 py-2 glass rounded-full text-[9px] font-label uppercase tracking-luxe text-champagne/70 hover:text-gold-300 transition-colors"
        >
          <CameraIcon size={14} /> Booth
        </a>
        <a
          href={`${basePath}/wall`}
          className="flex items-center gap-1.5 px-3.5 py-2 glass rounded-full text-[9px] font-label uppercase tracking-luxe text-champagne/70 hover:text-gold-300 transition-colors"
        >
          <GalleryIcon size={14} /> Live Wall
        </a>
      </div>

      {/* Header — SCAGO emblem + wordmark crown the page (SCAGO always above) */}
      <div className="relative z-10 flex flex-col items-center pt-6 pb-6 px-4 text-center">
        <Wordmark size="md" />

        {/* Page label: this is the guest's personal media collection */}
        <p className="mt-6 font-label uppercase tracking-luxe text-[10px] text-gold-300/70">
          My Media
        </p>
        <p className="mt-2 font-serif italic text-2xl text-ivory/85">Your gala moments</p>
        <span
          className="mt-3 h-px w-16 block"
          style={{ background: 'linear-gradient(to right, transparent, rgba(var(--accent-rgb),0.6), transparent)' }}
          aria-hidden
        />

        {/* Counts */}
        {total > 0 && (
          <p className="mt-3 inline-flex items-center gap-2 font-label uppercase tracking-luxe text-[9px] text-champagne/40">
            <PhotoIcon size={12} className="text-gold-400" />
            {total} {total === 1 ? 'moment' : 'moments'}
            {videoCount > 0 ? (
              <>
                <span className="text-gold-500/50">·</span>
                <VideoIcon size={12} className="text-gold-400" />
                {videoCount} {videoCount !== 1 ? 'videos' : 'video'}
              </>
            ) : null}
          </p>
        )}

        {total > 0 && (
          <button
            onClick={handleDownloadAll}
            disabled={downloadingAll}
            className="mt-5 inline-flex items-center gap-2 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] px-7 py-3 rounded-xl glow-accent transition-all disabled:opacity-60"
          >
            {downloadingAll ? (
              <>
                <span className="block w-4 h-4 rounded-full border-2 border-noir-900/30 border-t-noir-900 animate-spin" />
                {`Saving ${total} ${total !== 1 ? 'items' : 'item'}`}
              </>
            ) : (
              <>
                <DownloadIcon size={15} strokeWidth={1.8} />
                {`Download all (${total})`}
              </>
            )}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="relative z-10 px-4 pb-16">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="flex flex-col items-center gap-4 animate-rise-in">
              <div className="w-8 h-8 rounded-full border-2 border-gold-400/30 border-t-gold-400 animate-spin" />
              <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/40">
                Loading your moments…
              </p>
            </div>
          </div>
        ) : media.length === 0 ? (
          /* Empty state */
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center py-20 text-center px-6"
          >
            <div
              className="relative w-24 h-24 rounded-full glass-strong flex items-center justify-center mb-6 glow-soft"
              style={{ border: '1px solid rgba(var(--accent-rgb),0.28)' }}
            >
              <CameraIcon size={40} className="text-gold-300" strokeWidth={1.4} />
            </div>
            <p className="font-serif italic text-2xl text-foil-static mb-3">
              No media yet
            </p>
            <p className="font-sans text-champagne/60 text-sm mb-8 leading-relaxed max-w-xs">
              Step up to the booth and capture your moment — your photos and videos will appear here instantly.
            </p>
            <a
              href={basePath || '/'}
              className="inline-flex items-center gap-2 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] px-8 py-3 rounded-xl glow-accent"
            >
              <CameraIcon size={15} strokeWidth={1.8} />
              Go to the Booth
            </a>
          </motion.div>
        ) : (
          /* Grid — 2 columns on mobile, 3 on wider */
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
          >
            {media.map((item) => (
              <MediaCard key={item.id} media={item} onView={setLightbox} />
            ))}
          </div>
        )}
      </div>

      {/* Footer link */}
      {!loading && media.length > 0 && (
        <div className="relative z-10 text-center pb-10">
          <a
            href={basePath || '/'}
            className="inline-flex items-center gap-2 font-label uppercase tracking-luxe text-[10px] text-champagne/40 hover:text-champagne/70 transition-colors"
          >
            <BackIcon size={13} />
            Back to the Booth
          </a>
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <Lightbox
            key={lightbox.id}
            media={lightbox}
            onClose={() => setLightbox(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
