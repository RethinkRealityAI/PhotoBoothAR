/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wall Moderation — review, show/hide, and delete guest photo posts.
 * Realtime via subscribeToPosts; controls what the projected wall displays.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { Eye, EyeOff, Trash2, RefreshCw, Check, X, Wifi, Play } from 'lucide-react';
import GalaBackground from '../ui/GalaBackground';
import { fetchPosts, setPostHidden, deletePost, subscribeToPosts } from '../../lib/db';
import type { Post } from '../../types';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/* ------------------------------------------------------------------ */
/* Post Card                                                            */
/* ------------------------------------------------------------------ */

interface PostCardProps {
  post: Post;
  onRefresh: () => void;
  onDelete: (id: string) => void;
  onUpdate: (p: Post) => void;
}

function PostCard({ post, onRefresh, onDelete, onUpdate }: PostCardProps) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggleHidden = async () => {
    setBusy(true);
    const ok = await setPostHidden(post.id, !post.hidden);
    if (ok) onUpdate({ ...post, hidden: !post.hidden });
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    const ok = await deletePost(post.id);
    if (ok) onDelete(post.id);
    setBusy(false);
  };

  return (
    <div
      className={`relative rounded-2xl border overflow-hidden flex flex-col transition-all duration-300 ${
        post.hidden
          ? 'border-white/8 opacity-50 bg-noir-800/30'
          : 'border-gold-400/20 glass'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative">
        {post.media_type === 'video' ? (
          <video
            src={post.image_url}
            muted
            playsInline
            preload="metadata"
            className={`w-full aspect-[9/16] object-cover transition-all ${post.hidden ? 'grayscale' : ''}`}
          />
        ) : (
          <img
            src={post.image_url}
            alt={post.guest_name ?? 'Guest photo'}
            className={`w-full aspect-[9/16] object-cover transition-all ${post.hidden ? 'grayscale' : ''}`}
            loading="lazy"
          />
        )}
        {/* Video play glyph */}
        {post.media_type === 'video' && !post.hidden && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 rounded-full bg-noir-900/60 backdrop-blur-sm flex items-center justify-center">
              <Play className="w-4 h-4 text-ivory fill-ivory" />
            </div>
          </div>
        )}
        {/* Media type badge */}
        {post.media_type === 'video' && (
          <div className="absolute top-2 right-2 text-[8px] font-label uppercase tracking-widest px-2 py-0.5 rounded-full bg-noir-800/80 text-blue-300">
            Video
          </div>
        )}
        {post.hidden && (
          <div className="absolute inset-0 flex items-center justify-center bg-noir-900/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-1">
              <EyeOff className="w-6 h-6 text-champagne/40" />
              <span className="text-[9px] font-label uppercase tracking-widest text-champagne/40">Hidden</span>
            </div>
          </div>
        )}
        {/* Status badge */}
        <div className={`absolute top-2 left-2 text-[8px] font-label uppercase tracking-widest px-2 py-0.5 rounded-full ${post.hidden ? 'bg-noir-800/80 text-champagne/40' : 'bg-emerald-900/80 text-emerald-400'}`}>
          {post.hidden ? 'Hidden' : 'Visible'}
        </div>
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2">
        <div>
          <p className="font-sans text-xs text-ivory font-medium leading-tight truncate">
            {post.guest_name ?? 'Anonymous Guest'}
          </p>
          <p className="font-sans text-[9px] text-champagne/40 mt-0.5">{timeAgo(post.created_at)}</p>
        </div>
        {post.message && (
          <p className="font-sans text-[10px] text-champagne/60 italic line-clamp-2 leading-relaxed">
            "{post.message}"
          </p>
        )}
        {/* Actions */}
        <div className="flex gap-1.5 mt-1">
          <button
            onClick={toggleHidden}
            disabled={busy}
            className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[9px] font-label uppercase tracking-widest transition-colors ${
              post.hidden
                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                : 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
            } disabled:opacity-40`}
          >
            {post.hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {post.hidden ? 'Show' : 'Hide'}
          </button>
          {confirmDelete ? (
            <div className="flex gap-0.5">
              <button
                onClick={handleDelete}
                disabled={busy}
                className="px-2 py-2 rounded-xl bg-red-500/25 text-red-400 hover:bg-red-500/40 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-2 rounded-xl glass text-champagne/40 hover:text-ivory transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleDelete}
              disabled={busy}
              title="Delete"
              className="px-2 py-2 glass rounded-xl text-champagne/30 hover:text-red-400 transition-colors disabled:opacity-30"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Moderation                                                      */
/* ------------------------------------------------------------------ */

export default function Moderation() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchPosts({ includeHidden: true });
    // Newest first
    setPosts(data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    setLoading(false);
  }, []);

  // Realtime subscription
  useEffect(() => {
    load();
    const unsub = subscribeToPosts({
      onInsert: (p) => {
        setConnected(true);
        setPosts((prev) => {
          if (prev.some((x) => x.id === p.id)) return prev;
          return [p, ...prev];
        });
      },
      onUpdate: (p) => {
        setConnected(true);
        setPosts((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      },
      onDelete: (id) => {
        setConnected(true);
        setPosts((prev) => prev.filter((x) => x.id !== id));
      },
    });
    unsubRef.current = unsub;
    // Mark connected after a tick (subscription fires immediately on success)
    const tid = setTimeout(() => setConnected(true), 1200);
    return () => {
      clearTimeout(tid);
      unsub();
    };
  }, [load]);

  const handleUpdate = useCallback((p: Post) => {
    setPosts((prev) => prev.map((x) => (x.id === p.id ? p : x)));
  }, []);

  const handleDelete = useCallback((id: string) => {
    setPosts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const visible = posts.filter((p) => !p.hidden).length;
  const hidden = posts.filter((p) => p.hidden).length;
  const videos = posts.filter((p) => p.media_type === 'video').length;

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <GalaBackground density={24} />
      <div className="relative z-10 p-6 md:p-8 flex flex-col gap-6">

        {/* Header */}
        <header className="flex items-center justify-between animate-rise-in">
          <div>
            <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40 mb-1">AR Studio</p>
            <h1 className="font-serif italic text-3xl gold-foil-static">Wall Moderation</h1>
            <p className="font-sans text-xs text-champagne/45 mt-1">
              Controls what guests see on the projected photo wall.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Realtime indicator */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-label uppercase tracking-widest ${connected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-champagne/10 text-champagne/30'}`}>
              <Wifi className={`w-3 h-3 ${connected ? 'animate-pulse' : ''}`} />
              {connected ? 'Live' : 'Connecting…'}
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="p-2 glass rounded-xl text-champagne/40 hover:text-gold-300 transition-colors disabled:opacity-30"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {/* Stats bar */}
        {!loading && posts.length > 0 && (
          <div className="flex items-center gap-4 p-4 glass rounded-2xl border border-gold-400/10">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse-glow" />
              <span className="font-label uppercase tracking-widest text-[10px] text-champagne/60">
                <span className="font-sans font-bold text-emerald-400 text-base mr-1">{visible}</span>
                Showing on wall
              </span>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="flex items-center gap-2">
              <EyeOff className="w-3.5 h-3.5 text-champagne/30" />
              <span className="font-label uppercase tracking-widest text-[10px] text-champagne/40">
                <span className="font-sans font-bold text-champagne/50 text-base mr-1">{hidden}</span>
                Hidden
              </span>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="font-label uppercase tracking-widest text-[10px] text-champagne/40">
                <span className="font-sans font-bold text-gold-400 text-base mr-1">{posts.length}</span>
                Total
              </span>
            </div>
            {videos > 0 && (
              <>
                <div className="w-px h-8 bg-white/10" />
                <div className="flex items-center gap-2">
                  <Play className="w-3.5 h-3.5 text-blue-300" />
                  <span className="font-label uppercase tracking-widest text-[10px] text-champagne/40">
                    <span className="font-sans font-bold text-blue-300 text-base mr-1">{videos}</span>
                    Videos
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Posts grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="glass rounded-2xl border border-gold-400/10 aspect-[9/16] animate-pulse" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="glass rounded-2xl border border-gold-400/10 p-16 text-center">
            <p className="font-serif italic text-2xl gold-foil-static mb-2">No posts yet</p>
            <p className="font-sans text-sm text-champagne/40">
              Guest photos will appear here in real-time as they are submitted at the booth.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onRefresh={load}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
