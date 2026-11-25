/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /m/:slug — day-of staff console (moderation + wall settings), authenticated
 * by a manager access token (see host ManagerAccess). No EventProvider and no
 * event theming: it wears the platform's own dusk field and glass (opted in
 * with data-platform), with mint for "approved" as in the setup wizard.
 *
 * Token intake: ?t= param (persisted to sessionStorage, then stripped from the
 * URL to avoid shoulder-surfing) → stored value → manual entry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown, Check, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Settings2,
  ShieldCheck, ShieldOff, Trash2, Undo2, WifiOff, X,
} from 'lucide-react';
import ReportIssueButton from '../../components/support/ReportIssueButton';
import { callManagerApi } from '../../lib/managerApi';
import { useDialog } from '../../lib/useDialog';
import {
  QUEUE_FILTERS,
  filterPosts,
  mergeIncoming,
  moveIndex,
  nextPollDelayMs,
  queueCounts,
  undoEntryFor,
  type QueueFilter,
  type UndoEntry,
} from '../../lib/managerQueue';
import { listState } from '../../lib/listState';
import type { Post, WallSettings } from '../../types';

const storageKey = (slug: string) => `pbar.mgr.${slug}`;

/** Mirrors db.ts DEFAULT_WALL_SETTINGS so saves send a full merged object. */
const DEFAULT_WALL_SETTINGS: WallSettings = {
  showQR: true,
  showLeaderboard: true,
  showChallenges: true,
  galleryScroll: false,
  galleryScrollSpeed: 1,
  slideshowInterval: 6,
  featuredSpotlight: true,
  featuredIntervalSec: 45,
  defaultExperienceId: null,
};

type Phase = 'boot' | 'entry' | 'checking' | 'invalid' | 'ready';

/** The approve colour: the setup wizard's solid mint tick, dark ink on it. */
const MINT_SOLID = 'bg-[#5FD9A8] text-[#0B3B2C] hover:bg-[#74E2B6]';
const MINT_SOFT = 'bg-[#5FD9A8]/15 text-[color:var(--bw-success)] hover:bg-[#5FD9A8]/25';
/** Every full-screen state shares one root: the platform field, work-screen depth. */
const ROOT = 'absolute inset-0 app-bg text-brand-fg';

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

/* ── Post card ─────────────────────────────────────────────────────── */

function PostCard({
  post, busy, selected, isNew, onHide, onApprove, onDelete, onSelect,
}: {
  post: Post;
  busy: boolean;
  /** Keyboard cursor is on this card. */
  selected: boolean;
  /** Arrived in the last poll — a quiet marker so a thumb already in motion
   *  can see the grid changed under it. */
  isNew: boolean;
  onHide: (v: boolean) => void;
  onApprove: (v: boolean) => void;
  onDelete: () => void;
  onSelect: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <article
      onPointerDown={onSelect}
      data-selected={selected ? 'true' : undefined}
      className={`glass relative rounded-2xl overflow-hidden flex sm:flex-col transition-colors ${
        post.hidden ? 'opacity-60' : ''
      } ${selected ? 'ring-2 ring-[color:var(--color-accent)]/80' : ''}`}
    >
      {isNew && (
        <span className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full bg-[color:var(--color-accent)] text-[10px] font-bold uppercase tracking-widest text-[color:var(--on-accent)]">
          New
        </span>
      )}
      {/* Phone: a wide row with a thumbnail, so a full decision fits on one
          line and the buttons can be finger-sized. Tablet and up: the card
          stands up into a grid tile. */}
      <div className="relative shrink-0 w-28 sm:w-full aspect-square sm:aspect-[3/4] bg-black/40">
        {post.media_type === 'video' ? (
          <video src={post.image_url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        ) : (
          <img src={post.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
        )}
        <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
          {post.hidden && (
            <span className="px-2 py-0.5 rounded-full bg-black/70 text-[10px] font-semibold uppercase tracking-widest text-red-300">Hidden</span>
          )}
          {!post.approved && !post.hidden && (
            <span className="px-2 py-0.5 rounded-full bg-black/70 text-[10px] font-semibold uppercase tracking-widest text-amber-300">Pending</span>
          )}
          {post.media_type === 'video' && (
            <span className="px-2 py-0.5 rounded-full bg-black/70 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-accent)]">Video</span>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0 p-3 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm sm:text-xs text-brand-fg font-medium truncate">{post.guest_name || 'Anonymous'}</p>
          <p className="text-[11px] sm:text-[10px] text-brand-muted/70 shrink-0 tabular-nums">{fmtTime(post.created_at)}</p>
        </div>
        {post.message && <p className="text-[11px] text-brand-muted/80 line-clamp-2 sm:hidden">{post.message}</p>}
        {/* ≥44px on every control: this is operated one-handed, at speed, by
            someone watching a room rather than the screen. */}
        <div className="mt-auto flex gap-1.5">
          <button
            onClick={() => onApprove(!post.approved)}
            disabled={busy}
            title={post.approved ? 'Remove approval' : 'Approve for the wall'}
            className={`flex-1 flex items-center justify-center gap-1.5 min-h-11 px-2 rounded-xl text-[10px] font-semibold uppercase tracking-widest transition-colors disabled:opacity-40 ${
              post.approved ? MINT_SOFT : MINT_SOLID
            }`}
          >
            {post.approved ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
            {post.approved ? 'Approved' : 'Approve'}
          </button>
          <button
            onClick={() => onHide(!post.hidden)}
            disabled={busy}
            title={post.hidden ? 'Put back on the wall' : 'Take off the wall'}
            className="flex-1 flex items-center justify-center gap-1.5 min-h-11 px-2 rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.12] text-[10px] font-semibold uppercase tracking-widest text-brand-fg/85 transition-colors disabled:opacity-40"
          >
            {post.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            {post.hidden ? 'Show' : 'Hide'}
          </button>
          {confirmDelete ? (
            <div className="flex gap-1">
              <button
                onClick={onDelete}
                disabled={busy}
                title="Delete permanently. This cannot be undone."
                aria-label="Confirm delete"
                className="min-w-11 min-h-11 flex items-center justify-center rounded-xl bg-red-500/30 text-red-200 hover:bg-red-500/50 transition-colors"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                title="Cancel"
                aria-label="Cancel delete"
                className="min-w-11 min-h-11 flex items-center justify-center rounded-xl bg-white/[0.06] text-brand-muted/80 hover:text-brand-fg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              title="Delete permanently"
              aria-label="Delete permanently"
              className="min-w-11 min-h-11 flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-brand-muted/75 hover:text-red-300 transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/* ── Wall settings drawer ──────────────────────────────────────────── */

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <p className="text-sm text-brand-fg/90">{label}</p>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${checked ? 'bg-[#5FD9A8]' : 'bg-white/20'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform ${checked ? 'translate-x-5 bg-[#0B3B2C]' : 'translate-x-0 bg-white/90'}`} />
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
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, 'Wall settings');
  const [settings, setSettings] = useState<WallSettings | null>(null);
  /** The read failed — we do NOT know this event's settings. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoadFailed(false);
    // The `error` here used to be discarded, which made a failed read
    // indistinguishable from an event that genuinely has default settings:
    // the drawer rendered DEFAULT_WALL_SETTINGS as if they were live values,
    // and one tap on Save wrote them over the event's real configuration —
    // mid-event, in front of the room. A read we could not make is now a
    // refusal to show or write anything.
    const { data, error } = await callManagerApi<Partial<WallSettings> | null>(slug, token, 'get_wall_settings');
    if (error) { setLoadFailed(true); setSettings(null); return; }
    setSettings({ ...DEFAULT_WALL_SETTINGS, ...(data ?? {}) });
  }, [slug, token]);

  useEffect(() => {
    let alive = true;
    void loadSettings().then(() => { if (!alive) setSettings(null); });
    return () => { alive = false; };
  }, [loadSettings]);

  const patch = (p: Partial<WallSettings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setSaved(false);
    setSaveError(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setSaveError(false);
    // Full merged object — the wall's realtime settings subscription picks it up.
    const { error } = await callManagerApi(slug, token, 'set_wall_settings', { value: settings });
    setSaving(false);
    if (error) {
      // A silent failure here is the worst outcome available: the operator
      // walks away believing the wall changed, and it did not.
      setSaveError(true);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      {/* A side drawer, so not Modal-shaped — but day-of staff operating a wall
          from a laptop had no Escape and no focus trap here. */}
      <div
        ref={panelRef}
        {...dialogProps}
        className="glass-strong w-full max-w-sm h-full rounded-l-3xl border-l border-white/15 p-6 pt-safe-top [--safe-top:1.5rem] pb-safe-bottom [--safe-bottom:1.5rem] overflow-y-auto flex flex-col gap-4 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl text-foil-static">Wall settings</h2>
          <button onClick={onClose} aria-label="Close wall settings" className="grid place-items-center w-11 h-11 rounded-xl bg-white/[0.06] text-brand-muted/80 hover:text-brand-fg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {loadFailed ? (
          /* No Save button at all: writing the defaults we are showing would
             overwrite settings we were never able to read. */
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <WifiOff className="w-7 h-7 text-amber-400/70" />
            <p className="text-sm text-brand-fg/90">Couldn’t load the wall settings.</p>
            <p className="text-xs text-brand-muted/75 max-w-[16rem]">
              Nothing is shown or saved until we can read them. The wall keeps its current setup.
            </p>
            <button
              onClick={() => void loadSettings()}
              className="min-h-11 px-5 rounded-xl border border-white/10 bg-white/[0.08] text-brand-fg text-[11px] font-semibold uppercase tracking-widest"
            >
              Try again
            </button>
          </div>
        ) : !settings ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-brand-muted/70 motion-safe:animate-spin" />
          </div>
        ) : (
          <>
            <div>
              <Toggle label="QR codes on the live wall" checked={settings.qrOnWall === true} onChange={(v) => patch({ qrOnWall: v })} />
              <Toggle label="Featured spotlight" checked={settings.featuredSpotlight} onChange={(v) => patch({ featuredSpotlight: v })} />
              <Toggle label="Show leaderboard" checked={settings.showLeaderboard} onChange={(v) => patch({ showLeaderboard: v })} />
              <Toggle label="Challenges mode" checked={settings.showChallenges} onChange={(v) => patch({ showChallenges: v })} />
              <Toggle label="Scrolling rows (marquee)" checked={settings.galleryScroll} onChange={(v) => patch({ galleryScroll: v })} />
            </div>
            <div className="py-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-brand-fg/90">Slideshow interval</p>
                <span className="text-xs font-mono text-brand-muted/75">{settings.slideshowInterval}s</span>
              </div>
              <input
                type="range"
                min={3}
                max={15}
                step={1}
                value={settings.slideshowInterval}
                onChange={(e) => patch({ slideshowInterval: parseInt(e.target.value, 10) })}
                aria-label="Slideshow interval in seconds"
                className="w-full accent-[#5FD9A8]"
              />
            </div>
            <div className="mt-auto">
              {saveError && (
                <p role="alert" className="mb-2 text-xs text-amber-300 leading-relaxed">
                  Couldn’t save. The wall is still on its previous settings. Try again.
                </p>
              )}
              <button
                onClick={save}
                disabled={saving}
                className={`w-full min-h-11 py-3 rounded-xl ${MINT_SOLID} font-semibold text-xs uppercase tracking-widest transition-colors disabled:opacity-50 flex items-center justify-center gap-2`}
              >
                {saved ? <><Check className="w-4 h-4" /> Saved</> : saving ? 'Saving…' : saveError ? 'Retry save' : 'Save settings'}
              </button>
            </div>
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
  /** Three-state list semantics (lib/listState) — a poll that failed on venue
   *  wifi must never read as "no posts yet". */
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Posts that showed up in a poll while the operator was already looking. */
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<QueueFilter>('pending');
  const [cursor, setCursor] = useState(-1);
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const errorsRef = useRef(0);
  const postsRef = useRef<Post[]>(posts);
  postsRef.current = posts;
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);

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
      // Transient — keep the console up, but SAY SO. A poll that fails
      // silently is how a queue goes quiet at exactly the moment staff most
      // need to trust it.
      //
      // A transient failure on the FIRST load used to fall through to the
      // token-entry screen reading "This access link is invalid or has
      // expired" — so a 500, or venue wifi dropping, sent day-of staff off to
      // find the host and beg for a new code while their link was perfectly
      // good. Only `bad_token` / `event_not_found` (handled above) may say
      // that. Everything else opens the console on its own failed state,
      // which keeps retrying.
      errorsRef.current += 1;
      setLoadedOnce(true);
      setLoadFailed(true);
      setPhase('ready');
      return;
    }
    errorsRef.current = 0;
    setLoadedOnce(true);
    setLoadFailed(false);
    const { posts: next, arrivedIds } = mergeIncoming(postsRef.current, data ?? []);
    // Nothing is "new" on the first load — everything would be, and a screen
    // covered in New badges says nothing at all.
    if (arrivedIds.length > 0 && postsRef.current.length > 0) {
      setNewIds((prev) => {
        const merged = new Set(prev);
        for (const id of arrivedIds) merged.add(id);
        return merged;
      });
    }
    setPosts(next);
    setPhase('ready');
  }, [slug]);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  /**
   * The live feed. One poll in flight at a time, cadence from the pure
   * `nextPollDelayMs`, and a visibilitychange that cuts the current sleep short
   * so an operator returning to the tab never reads a stale queue.
   * See lib/managerQueue.ts for why this is a poll and not a realtime channel.
   */
  useEffect(() => {
    if (!token || phase !== 'ready') return;
    let alive = true;
    let timer: number | undefined;
    let wake: (() => void) | null = null;

    const sleep = (ms: number) => new Promise<void>((resolve) => {
      wake = resolve;
      timer = window.setTimeout(resolve, ms);
    });

    void (async () => {
      while (alive) {
        await sleep(nextPollDelayMs({
          consecutiveErrors: errorsRef.current,
          documentHidden: document.hidden,
        }));
        if (!alive) break;
        await load(token, { soft: true });
      }
    })();

    const onVisibility = () => {
      const resume = wake;
      if (document.hidden || !resume) return;
      window.clearTimeout(timer);
      resume();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      wake?.();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token, phase, load]);

  const markBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });

  const mutatePost = async (id: string, op: 'set_post_hidden' | 'set_post_approved' | 'delete_post', patch: Partial<Post>, args: Record<string, unknown>) => {
    if (!token) return;
    const before = postsRef.current.find((p) => p.id === id) ?? null;
    markBusy(id, true);
    // optimistic
    setPosts((list) => (op === 'delete_post' ? list.filter((p) => p.id !== id) : list.map((p) => (p.id === id ? { ...p, ...patch } : p))));
    const { error } = await callManagerApi(slug, token, op, args);
    markBusy(id, false);
    if (error) {
      setUndo(null);
      load(token, { soft: true }); // reload on error
      return;
    }
    // A delete is a hard DELETE server-side, so there is nothing to offer back.
    if (before && op !== 'delete_post') setUndo(undoEntryFor(before, patch));
  };

  const applyUndo = useCallback(async () => {
    const entry = undo;
    if (!entry || !token || undoBusy) return;
    setUndoBusy(true);
    setPosts((list) => list.map((p) => (p.id === entry.postId ? { ...p, ...entry.patch } : p)));
    const { error } = await callManagerApi(slug, token, entry.op, entry.args);
    setUndoBusy(false);
    setUndo(null);
    if (error) load(token, { soft: true });
  }, [undo, token, undoBusy, slug, load]);

  // The undo offer expires — a bar that lingers gets tapped long after the
  // operator has moved on, and undoes a decision they meant to keep.
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const counts = useMemo(() => queueCounts(posts), [posts]);
  const visible = useMemo(() => filterPosts(posts, filter), [posts, filter]);
  const newCount = useMemo(
    () => posts.reduce((n, p) => (newIds.has(p.id) ? n + 1 : n), 0),
    [posts, newIds],
  );

  // Keep the keyboard cursor inside the list it is pointing at.
  useEffect(() => { setCursor(-1); }, [filter]);
  useEffect(() => {
    setCursor((i) => (i >= visible.length ? visible.length - 1 : i));
  }, [visible.length]);

  useEffect(() => {
    if (cursor < 0 || !gridRef.current) return;
    const el = gridRef.current.querySelector('[data-selected="true"]');
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [cursor]);

  // Read by the keydown listener so it can bind once per phase instead of once
  // per render, without ever acting on a stale list.
  const liveRef = useRef({ visible, cursor, mutatePost, applyUndo });
  liveRef.current = { visible, cursor, mutatePost, applyUndo };

  useEffect(() => {
    if (phase !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const { visible: list, cursor: at, mutatePost: mutate, applyUndo: undoNow } = liveRef.current;
      const key = e.key === 'ArrowDown' ? 'j' : e.key === 'ArrowUp' ? 'k' : e.key.toLowerCase();

      if (key === 'j' || key === 'k') {
        e.preventDefault();
        setCursor((i) => moveIndex(i, key === 'j' ? 1 : -1, list.length));
        return;
      }
      if (key === 'u') { e.preventDefault(); void undoNow(); return; }

      const target = list[at];
      if (!target) return;
      if (key === 'a') {
        e.preventDefault();
        const approved = !target.approved;
        void mutate(target.id, 'set_post_approved', { approved }, { postId: target.id, approved });
      } else if (key === 'h') {
        e.preventDefault();
        const hidden = !target.hidden;
        void mutate(target.id, 'set_post_hidden', { hidden }, { postId: target.id, hidden });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  /* ── Entry / invalid states ── */
  if (phase === 'boot' || phase === 'checking') {
    return (
      <div data-platform data-surface="night" className={`${ROOT} flex items-center justify-center`}>
        <Loader2 className="w-8 h-8 text-brand-muted/70 motion-safe:animate-spin" />
      </div>
    );
  }

  if (phase === 'entry' || phase === 'invalid') {
    return (
      <div data-platform data-surface="night" className={`${ROOT} flex items-center justify-center p-6`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = entryVal.trim();
            if (v.length < 6) return;
            sessionStorage.setItem(storageKey(slug), v);
            setEntryVal('');
            setToken(v);
          }}
          className="liquid-glass w-full max-w-sm rounded-3xl p-8 text-center"
        >
          <div className="w-12 h-12 mx-auto mb-5 rounded-full bg-white/[0.08] flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-brand-fg/80" />
          </div>
          <h1 className="font-serif text-2xl text-foil-static">Manager console</h1>
          <p className="mt-1 text-xs text-brand-muted/70 font-mono">{slug}</p>
          {phase === 'invalid' && (
            <p role="alert" className="mt-4 text-xs text-red-300 leading-relaxed">
              This access link is invalid or has expired. Ask the event host for a new one.
            </p>
          )}
          <input
            autoFocus
            value={entryVal}
            onChange={(e) => setEntryVal(e.target.value)}
            placeholder="Enter access code"
            aria-label="Access code"
            className="mt-6 w-full min-h-11 text-center rounded-xl bg-white/[0.08] border border-white/15 px-4 text-sm text-brand-fg placeholder:text-brand-muted/60 outline-none focus:border-[color:var(--color-accent)]/60 transition-colors"
          />
          <button
            type="submit"
            disabled={entryVal.trim().length < 6}
            className="pressable mt-4 w-full min-h-11 rounded-full bg-foil glow-accent text-[color:var(--on-accent)] font-semibold text-sm transition disabled:opacity-40"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  /* ── Ready ── */
  const state = listState({ count: visible.length, loaded: loadedOnce, failed: loadFailed });

  return (
    <div data-platform data-surface="night" className={`${ROOT} flex flex-col overflow-hidden`}>
      <header className="liquid-glass-raised shrink-0 z-10 mx-2 mt-2 rounded-2xl pt-safe-top [--safe-top:0.5rem]">
        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="min-w-0 flex-1">
            <p className="font-serif text-base font-semibold text-foil-static leading-tight">Manager console</p>
            <p className="flex items-center gap-1.5 text-[10px] font-mono text-brand-muted/70 truncate">
              <span className="truncate">{slug}</span>
              <span aria-hidden>·</span>
              {loadFailed ? (
                <span className="inline-flex items-center gap-1 text-amber-300 shrink-0">
                  <WifiOff className="w-3 h-3" /> reconnecting
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[color:var(--bw-success)] shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5FD9A8] motion-safe:animate-pulse" /> live
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => token && load(token, { soft: true })}
            disabled={refreshing}
            aria-label="Refresh now"
            className="min-w-11 min-h-11 flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-brand-muted/80 hover:text-brand-fg transition-colors disabled:opacity-40"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`} />
          </button>
          {/* Day-of staff hit problems mid-event, on a phone, with no account —
              this is the surface where "the wall froze" needs one tap. */}
          <ReportIssueButton
            label="Report a problem"
            iconSize={16}
            prefill={{ source: 'manager_console', eventSlug: slug, category: 'bug' }}
            className="min-w-11 min-h-11 flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-brand-muted/80 hover:text-brand-fg transition-colors [&>span]:sr-only"
          />
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Wall settings"
            title="Wall settings"
            className="min-w-11 min-h-11 flex items-center justify-center gap-1.5 px-2 sm:px-3 rounded-xl border border-white/10 bg-white/[0.06] text-brand-fg/90 hover:text-brand-fg text-xs font-semibold transition-colors"
          >
            <Settings2 className="w-4 h-4" />
            <span className="hidden sm:inline">Wall settings</span>
          </button>
        </div>

        {/* The queue itself. Pending is first and default — it is the only
            bucket where a guest is waiting on a human. */}
        <div className="flex gap-1 px-3 pb-2 overflow-x-auto hide-scrollbar" role="tablist" aria-label="Moderation queue">
          {QUEUE_FILTERS.map((f) => {
            const active = filter === f;
            const n = counts[f];
            const urgent = f === 'pending' && n > 0;
            return (
              <button
                key={f}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={`shrink-0 min-h-11 px-3.5 rounded-xl text-[11px] font-semibold uppercase tracking-widest transition-colors ${
                  active ? 'is-selected bg-white/[0.14] text-brand-fg' : 'bg-white/[0.05] text-brand-muted/80 hover:text-brand-fg'
                }`}
              >
                {f === 'all' ? 'All' : f}
                <span
                  className={`ml-1.5 tabular-nums ${
                    urgent ? 'text-amber-300' : active ? 'text-brand-fg/80' : 'text-brand-muted/65'
                  }`}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      {newCount > 0 && (
        <button
          onClick={() => {
            setNewIds(new Set());
            scrollRef.current?.scrollTo({
              top: 0,
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            });
          }}
          className="pressable shrink-0 mx-3 mt-2 min-h-11 flex items-center justify-center gap-2 rounded-full bg-foil glow-accent text-[color:var(--on-accent)] text-[11px] font-bold uppercase tracking-widest"
        >
          <ArrowDown className="w-4 h-4" />
          {newCount} new {newCount === 1 ? 'post' : 'posts'} · tap to clear
        </button>
      )}

      <main ref={scrollRef} className="flex-1 overflow-y-auto p-3 pb-safe-bottom [--safe-bottom:0.75rem]">
        {state === 'loading' ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-brand-muted/70 motion-safe:animate-spin" />
          </div>
        ) : state === 'failed' ? (
          /* Never "no posts yet" on a failed read — that sentence has sent
             staff looking for a broken booth when the wifi was the problem. */
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <WifiOff className="w-7 h-7 text-amber-300/80" />
            <p className="text-sm text-brand-fg/90">Couldn’t reach the event.</p>
            <p className="text-xs text-brand-muted/75 max-w-xs">
              Retrying automatically. Posts already approved stay on the wall.
            </p>
            <button
              onClick={() => token && load(token, { soft: true })}
              className="min-h-11 px-5 rounded-xl border border-white/10 bg-white/[0.08] text-brand-fg text-[11px] font-semibold uppercase tracking-widest"
            >
              Try now
            </button>
          </div>
        ) : state === 'empty' ? (
          <div className="h-full flex items-center justify-center text-center px-6">
            <p className="text-sm text-brand-muted/75">
              {filter === 'all'
                ? 'No posts yet. They’ll appear here as guests share.'
                : `Nothing ${filter} right now.`}
            </p>
          </div>
        ) : (
          <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3">
            {visible.map((post, i) => (
              <PostCard
                key={post.id}
                post={post}
                busy={busyIds.has(post.id)}
                selected={i === cursor}
                isNew={newIds.has(post.id)}
                onSelect={() => setCursor(i)}
                onHide={(hidden) => mutatePost(post.id, 'set_post_hidden', { hidden }, { postId: post.id, hidden })}
                onApprove={(approved) => mutatePost(post.id, 'set_post_approved', { approved }, { postId: post.id, approved })}
                onDelete={() => mutatePost(post.id, 'delete_post', {}, { postId: post.id })}
              />
            ))}
          </div>
        )}
      </main>

      {/* Keyboard legend — only where there is a keyboard. */}
      <p className="hidden md:block shrink-0 px-4 py-1.5 border-t border-white/10 text-[10px] text-brand-muted/65 font-mono">
        j / k move · a approve · h hide · u undo
      </p>

      {undo && (
        <div
          role="status"
          className="glass-strong fixed inset-x-3 bottom-0 z-40 flex items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl mb-3 pb-safe-bottom [--safe-bottom:0.75rem] sm:left-auto sm:right-4 sm:w-80"
        >
          <p className="flex-1 min-w-0 text-xs text-brand-fg/90 truncate">{undo.label}</p>
          <button
            onClick={applyUndo}
            disabled={undoBusy}
            className="pressable shrink-0 min-h-11 px-4 flex items-center gap-1.5 rounded-full bg-foil glow-accent text-[color:var(--on-accent)] text-[11px] font-bold uppercase tracking-widest disabled:opacity-50"
          >
            <Undo2 className="w-4 h-4" /> Undo
          </button>
          <button
            onClick={() => setUndo(null)}
            aria-label="Dismiss"
            className="shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-xl text-brand-muted/75 hover:text-brand-fg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {drawerOpen && token && (
        <WallSettingsDrawer slug={slug} token={token} onClose={() => setDrawerOpen(false)} />
      )}
    </div>
  );
}
