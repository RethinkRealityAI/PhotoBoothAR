/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /m/:slug — day-of staff console (moderation + wall settings), authenticated
 * by a manager access token (see host ManagerAccess). Deliberately plain
 * internal-tool styling: no EventProvider, no event theming.
 *
 * Token intake: ?t= param (persisted to sessionStorage, then stripped from the
 * URL to avoid shoulder-surfing) → stored value → manual entry.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Check, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Settings2,
  ShieldCheck, ShieldOff, Trash2, X,
} from 'lucide-react';
import { callManagerApi } from '../../lib/managerApi';
import type { Post, WallSettings } from '../../types';

const storageKey = (slug: string) => `pbar.mgr.${slug}`;

/** Mirrors db.ts DEFAULT_WALL_SETTINGS so saves send a full merged object. */
const DEFAULT_WALL_SETTINGS: WallSettings = {
  showQR: false,
  showLeaderboard: true,
  showChallenges: true,
  galleryScroll: false,
  galleryScrollSpeed: 1,
  slideshowInterval: 6,
  defaultExperienceId: null,
};

type Phase = 'boot' | 'entry' | 'checking' | 'invalid' | 'ready';

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

/* ── Post card ─────────────────────────────────────────────────────── */

function PostCard({
  post, busy, onHide, onApprove, onDelete,
}: {
  post: Post;
  busy: boolean;
  onHide: (v: boolean) => void;
  onApprove: (v: boolean) => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className={`rounded-2xl border overflow-hidden flex flex-col bg-white/[0.03] ${post.hidden ? 'border-white/5 opacity-60' : 'border-white/10'}`}>
      <div className="relative aspect-[3/4] bg-black/40">
        {post.media_type === 'video' ? (
          <video src={post.image_url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        ) : (
          <img src={post.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
        )}
        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          {post.hidden && (
            <span className="px-2 py-0.5 rounded-full bg-black/70 text-[9px] font-semibold uppercase tracking-widest text-red-300">Hidden</span>
          )}
          {!post.approved && (
            <span className="px-2 py-0.5 rounded-full bg-black/70 text-[9px] font-semibold uppercase tracking-widest text-amber-300">Unapproved</span>
          )}
          {post.media_type === 'video' && (
            <span className="px-2 py-0.5 rounded-full bg-black/70 text-[9px] font-semibold uppercase tracking-widest text-sky-300">Video</span>
          )}
        </div>
      </div>
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs text-white/80 font-medium truncate">{post.guest_name || 'Anonymous'}</p>
          <p className="text-[10px] text-white/35 shrink-0">{fmtTime(post.created_at)}</p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onHide(!post.hidden)}
            disabled={busy}
            title={post.hidden ? 'Show on wall' : 'Hide from wall'}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-[9px] font-semibold uppercase tracking-widest text-white/60 transition-colors disabled:opacity-40"
          >
            {post.hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {post.hidden ? 'Show' : 'Hide'}
          </button>
          <button
            onClick={() => onApprove(!post.approved)}
            disabled={busy}
            title={post.approved ? 'Unapprove' : 'Approve'}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[9px] font-semibold uppercase tracking-widest transition-colors disabled:opacity-40 ${
              post.approved ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' : 'bg-white/[0.05] text-white/60 hover:bg-white/[0.1]'
            }`}
          >
            {post.approved ? <ShieldCheck className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
            {post.approved ? 'OK' : 'Approve'}
          </button>
          {confirmDelete ? (
            <div className="flex gap-0.5">
              <button onClick={onDelete} disabled={busy} className="p-1.5 rounded-lg bg-red-500/25 text-red-300 hover:bg-red-500/40 transition-colors">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setConfirmDelete(false)} className="p-1.5 rounded-lg bg-white/[0.05] text-white/50 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              title="Delete"
              className="p-1.5 rounded-lg bg-white/[0.05] text-white/40 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Wall settings drawer ──────────────────────────────────────────── */

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <p className="text-sm text-white/80">{label}</p>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-white/15'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-black/80 shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function WallSettingsDrawer({
  slug, token, onClose,
}: {
  slug: string;
  token: string;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<WallSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    callManagerApi<Partial<WallSettings> | null>(slug, token, 'get_wall_settings').then(({ data }) => {
      if (!alive) return;
      setSettings({ ...DEFAULT_WALL_SETTINGS, ...(data ?? {}) });
    });
    return () => { alive = false; };
  }, [slug, token]);

  const patch = (p: Partial<WallSettings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    // Full merged object — the wall's realtime settings subscription picks it up.
    const { error } = await callManagerApi(slug, token, 'set_wall_settings', { value: settings });
    setSaving(false);
    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm h-full bg-[#101014] border-l border-white/10 p-6 overflow-y-auto flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-white/70">Wall settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/[0.05] text-white/50 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {!settings ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
          </div>
        ) : (
          <>
            <div>
              <Toggle label="Show QR code" checked={settings.showQR} onChange={(v) => patch({ showQR: v })} />
              <Toggle label="Show leaderboard" checked={settings.showLeaderboard} onChange={(v) => patch({ showLeaderboard: v })} />
              <Toggle label="Challenges mode" checked={settings.showChallenges} onChange={(v) => patch({ showChallenges: v })} />
              <Toggle label="Scrolling rows (marquee)" checked={settings.galleryScroll} onChange={(v) => patch({ galleryScroll: v })} />
            </div>
            <div className="py-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-white/80">Slideshow interval</p>
                <span className="text-xs font-mono text-white/50">{settings.slideshowInterval}s</span>
              </div>
              <input
                type="range"
                min={3}
                max={15}
                step={1}
                value={settings.slideshowInterval}
                onChange={(e) => patch({ slideshowInterval: parseInt(e.target.value, 10) })}
                className="w-full accent-emerald-500"
              />
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="mt-auto w-full py-3 rounded-xl bg-emerald-500 text-black font-semibold text-xs uppercase tracking-widest hover:bg-emerald-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saved ? <><Check className="w-4 h-4" /> Saved</> : saving ? 'Saving…' : 'Save settings'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Console ───────────────────────────────────────────────────────── */

export default function ManagerConsole() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('boot');
  const [entryVal, setEntryVal] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Token intake: URL param → sessionStorage → manual entry.
  useEffect(() => {
    const fromUrl = searchParams.get('t');
    if (fromUrl) {
      sessionStorage.setItem(storageKey(slug), fromUrl);
      // Strip the token from the address bar (shoulder-surfing / history).
      const next = new URLSearchParams(searchParams);
      next.delete('t');
      setSearchParams(next, { replace: true });
      setToken(fromUrl);
      return;
    }
    const stored = sessionStorage.getItem(storageKey(slug));
    if (stored) {
      setToken(stored);
    } else {
      setPhase('entry');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const load = useCallback(async (tok: string, opts?: { soft?: boolean }) => {
    if (!opts?.soft) setPhase('checking');
    setRefreshing(true);
    const { data, error } = await callManagerApi<Post[]>(slug, tok, 'list_posts');
    setRefreshing(false);
    if (error === 'bad_token' || error === 'event_not_found') {
      sessionStorage.removeItem(storageKey(slug));
      setToken(null);
      setPhase('invalid');
      return;
    }
    if (error) {
      // transient — keep the console up if it was already ready
      if (!opts?.soft) setPhase('invalid');
      return;
    }
    setPosts(data ?? []);
    setPhase('ready');
  }, [slug]);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  const markBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });

  const mutatePost = async (id: string, op: 'set_post_hidden' | 'set_post_approved' | 'delete_post', patch: Partial<Post>, args: Record<string, unknown>) => {
    if (!token) return;
    markBusy(id, true);
    // optimistic
    setPosts((list) => (op === 'delete_post' ? list.filter((p) => p.id !== id) : list.map((p) => (p.id === id ? { ...p, ...patch } : p))));
    const { error } = await callManagerApi(slug, token, op, args);
    markBusy(id, false);
    if (error) load(token, { soft: true }); // reload on error
  };

  const visible = useMemo(() => posts, [posts]);

  /* ── Entry / invalid states ── */
  if (phase === 'boot' || phase === 'checking') {
    return (
      <div className="absolute inset-0 bg-[#0b0b0e] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white/40 animate-spin" />
      </div>
    );
  }

  if (phase === 'entry' || phase === 'invalid') {
    return (
      <div className="absolute inset-0 bg-[#0b0b0e] flex items-center justify-center p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = entryVal.trim();
            if (v.length < 6) return;
            sessionStorage.setItem(storageKey(slug), v);
            setEntryVal('');
            setToken(v);
          }}
          className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center"
        >
          <div className="w-12 h-12 mx-auto mb-5 rounded-full bg-white/[0.06] flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-white/60" />
          </div>
          <h1 className="text-lg font-semibold text-white/90">Manager console</h1>
          <p className="mt-1 text-xs text-white/40 font-mono">{slug}</p>
          {phase === 'invalid' && (
            <p className="mt-4 text-xs text-red-400 leading-relaxed">
              This access link is invalid or has expired — ask the event host for a new one.
            </p>
          )}
          <input
            autoFocus
            value={entryVal}
            onChange={(e) => setEntryVal(e.target.value)}
            placeholder="Enter access code"
            className="mt-6 w-full text-center rounded-xl bg-white/[0.05] border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none focus:border-white/30 transition-colors"
          />
          <button
            type="submit"
            disabled={entryVal.trim().length < 6}
            className="mt-4 w-full py-3 rounded-xl bg-white text-black font-semibold text-xs uppercase tracking-widest hover:bg-white/90 transition-colors disabled:opacity-30"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  /* ── Ready ── */
  return (
    <div className="absolute inset-0 bg-[#0b0b0e] flex flex-col overflow-hidden">
      <header className="shrink-0 h-14 flex items-center gap-3 px-4 border-b border-white/10 bg-white/[0.02]">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white/90 leading-tight">Manager console</p>
          <p className="text-[10px] font-mono text-white/35 truncate">{slug} · {posts.length} posts</p>
        </div>
        <button
          onClick={() => token && load(token, { soft: true })}
          disabled={refreshing}
          className="p-2 rounded-lg bg-white/[0.05] text-white/50 hover:text-white transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.05] text-white/70 hover:text-white text-xs font-semibold transition-colors"
        >
          <Settings2 className="w-4 h-4" /> Wall settings
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-white/35">No posts yet — they'll appear here as guests share.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {visible.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                busy={busyIds.has(post.id)}
                onHide={(hidden) => mutatePost(post.id, 'set_post_hidden', { hidden }, { postId: post.id, hidden })}
                onApprove={(approved) => mutatePost(post.id, 'set_post_approved', { approved }, { postId: post.id, approved })}
                onDelete={() => mutatePost(post.id, 'delete_post', {}, { postId: post.id })}
              />
            ))}
          </div>
        )}
      </main>

      {drawerOpen && token && (
        <WallSettingsDrawer slug={slug} token={token} onClose={() => setDrawerOpen(false)} />
      )}
    </div>
  );
}
