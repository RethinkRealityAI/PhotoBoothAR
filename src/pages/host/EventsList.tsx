/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host — the member's events: guest link + QR, status toggles, Open studio,
 * and the New event CTA. Empty state sells the wizard.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '../../components/ui/Modal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { Archive, ArchiveRestore, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Copy, CopyPlus, ExternalLink, Images, LayoutGrid, List, Loader2, MoreHorizontal, Play, Plus, QrCode, Radio, RefreshCw, Search, Settings2, Square, Trash2 } from 'lucide-react';
import { fetchMyEvents, goLive, updateEventStatus, deleteEvent, duplicateEvent, eventOrgHasActivePro, invalidateProSubscriptionCache, type HostEventRow } from '../../lib/host';
import { accentOf, filterEvents, firstNameOf, formatEventDate, greetingFor, nextAction, sortEvents, spotlightOf, statusBucket, type NextAction, type SortKey, type StatusFilter } from '../../lib/eventList';
import { EVENT_TEMPLATES } from '../../lib/eventTemplates';
import PostImage from '../../components/ui/PostImage';
import beamyCutout from '../../assets/sales/beamy.webp';
import { RESTORE_STATUS, archivedLabel, canArchiveStatus, canDeleteStatus, confirmNameMatches, isArchivedStatus, partitionByArchived } from '../../lib/eventArchive';
import { setupChip, setupPath } from '../../lib/wizard/wizardModel';
import { TierPill, UpgradeModal } from './UpgradeCard';
import { entitlementsFor, normalizeTier } from '../../lib/entitlements';
import { supabase } from '../../lib/supabase';
import StatusPill from '../../components/ui/StatusPill';
import { useToast } from '../../components/ui/Toast';
import { copyText } from '../../lib/clipboard';

function CopyLinkButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { push } = useToast();
  return (
    <button
      onClick={() => copyText(text).then((ok) => { if (!ok) return; setCopied(true); push('Link copied', 'success'); setTimeout(() => setCopied(false), 2000); })}
      title="Copy guest link"
      aria-label="Copy guest link"
      className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-brand-fg/80 hover:text-brand-fg transition-colors"
    >
      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function QRModal({ url, name, draft, onClose }: { url: string; name: string; draft: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const { push } = useToast();
  return (
    // Modal, not a bare overlay: this was openable but not dismissable or
    // operable from a keyboard, and Tab walked straight through it into the page
    // behind. Modal supplies Escape, the focus trap and focus restore.
    <Modal title={name} onClose={onClose} maxWidthClass="max-w-xs">
      <div className="text-center flex flex-col items-center gap-4">
        <div className="rounded-xl p-3 bg-brand-fg/95 shadow-lg">
          <QRCodeSVG value={url} size={160} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
        </div>
        <p className="font-mono text-[11px] text-brand-muted/60 break-all">{url}</p>
        {draft && (
          <p className="font-sans text-[11px] text-amber-400/90 leading-snug">
            Guests can’t open this link until you Go live.
          </p>
        )}
        <button
          onClick={() => copyText(url).then((ok) => { if (!ok) return; setCopied(true); push('Link copied', 'success'); setTimeout(() => setCopied(false), 2000); })}
          className="w-full py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-label uppercase tracking-widest text-brand-fg/80 transition-colors flex items-center justify-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <QrCode className="w-3.5 h-3.5" />}
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
    </Modal>
  );
}

/** First-run guide gate — mirrors useStudioOnboarding's localStorage pattern. */
const HOST_ONBOARDED_KEY = 'beamwall.host.onboarded';

/** The event's post cap from its plan tier (null = unlimited → no meter). */
function capFor(ev: HostEventRow): number | null {
  return entitlementsFor(normalizeTier(ev.plan_tier)).maxPosts;
}

/** A capped event's posts-used count, or 'unknown' when the count did not load.
 *  Absent from the map = no meter belongs on that card at all. */
type PostCount = number | 'unknown';

/**
 * Posts-used counts for the capped events, keyed by event id. One head-only
 * count query per capped event, fired once per list load (no polling) — the
 * same count the submit-post edge fn caps on (all posts for the slug; RLS may
 * hide a few hidden posts from this session, close enough for a meter). An
 * active org Pro subscription lifts the cap to unlimited (mirrors submit-post),
 * so those events are skipped — that is a genuine no-meter and stays absent.
 *
 * A FAILED count is different, and used to be flattened into the same absence:
 * the meter silently disappeared, so a host near their cap saw exactly what a
 * host on an uncapped plan sees. It now records 'unknown' and the card says so.
 * Still no invented number.
 */
async function fetchPostCounts(list: HostEventRow[]): Promise<Record<string, PostCount>> {
  const capped = list.filter((ev) => capFor(ev) !== null);
  const entries = await Promise.all(
    capped.map(async (ev) => {
      try {
        if (await eventOrgHasActivePro(ev.id)) return null; // cap lifted → no meter
        const { count, error } = await supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', ev.slug);
        if (error || count === null) return [ev.id, 'unknown'] as const;
        return [ev.id, count] as const;
      } catch {
        // Includes an eventOrgHasActivePro that threw: the cap itself is then
        // unknown, so claiming a number would be a guess either way.
        return [ev.id, 'unknown'] as const;
      }
    }),
  );
  return Object.fromEntries(entries.filter((e): e is readonly [string, PostCount] => e !== null));
}

/** Compact posts-used / cap meter with an upgrade nudge from 80% full. */
function CapMeter({ used, cap, onUpgrade }: { used: PostCount; cap: number; onUpgrade: () => void }) {
  if (used === 'unknown') {
    // The track stays so the card keeps its shape, but nothing fills it and the
    // label says why — an empty bar on its own would read as "0 posts used".
    return (
      <div className="space-y-1">
        <span className="font-sans text-[11px] text-brand-muted/50">
          Usage unavailable — couldn’t count posts. {cap}-post plan.
        </span>
        <div className="h-1 rounded-full bg-white/[0.06]" />
      </div>
    );
  }
  const nearCap = cap > 0 && used / cap >= 0.8;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 100;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-sans text-[11px] ${nearCap ? 'text-amber-400/90' : 'text-brand-muted/50'}`}>
          {used} / {cap} posts on this plan
        </span>
        {nearCap && (
          <button
            onClick={onUpgrade}
            className="font-label uppercase tracking-luxe text-[11px] text-accent-2 hover:underline underline-offset-2"
          >
            {used >= cap ? 'Wall full — upgrade' : 'Almost full — upgrade'}
          </button>
        )}
      </div>
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full ${nearCap ? 'bg-amber-400/80' : 'bg-accent/60'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** An event's cover: its latest guest photos and how many moments it has.
 *  Absent from the map = still loading or the read failed — the card then
 *  shows its designed placeholder, never a broken image or an invented 0. */
interface EventCover { thumbs: string[]; count: number }

/** One read per event (newest 8 visible posts + an exact count in the same
 *  request), capped at the first 24 events so a large account cannot fan out
 *  into hundreds of requests. Videos are skipped as thumbnails (the image
 *  transformer cannot frame them) but still count as moments. */
async function fetchCovers(list: HostEventRow[]): Promise<Record<string, EventCover>> {
  const entries = await Promise.all(
    list.slice(0, 24).map(async (ev) => {
      try {
        const { data, count, error } = await supabase
          .from('posts')
          .select('image_url, media_type', { count: 'exact' })
          .eq('event_id', ev.slug)
          .eq('hidden', false)
          .order('created_at', { ascending: false })
          .limit(8);
        if (error || count === null) return null;
        const thumbs = (data ?? [])
          .filter((r: { image_url: unknown; media_type: unknown }) => r.media_type !== 'video' && typeof r.image_url === 'string')
          .map((r: { image_url: string }) => r.image_url)
          .slice(0, 4);
        return [ev.id, { thumbs, count }] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((e): e is readonly [string, EventCover] => e !== null));
}

function typeLabel(type: string | null | undefined): string {
  const t = EVENT_TEMPLATES.find((x) => x.eventType === type);
  if (t) return t.label;
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Event';
}

/** The status in a word and a dot colour — the card's at-a-glance line. */
function statusLook(ev: HostEventRow): { label: string; dot: string } {
  if (ev.status === 'archived') return { label: 'Archived', dot: 'bg-white/40' };
  const b = statusBucket(ev);
  if (b === 'live') return { label: 'Live', dot: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]' };
  if (b === 'drafts') return { label: 'Draft', dot: 'bg-amber-300' };
  if (b === 'past') return { label: 'Ended', dot: 'bg-white/45' };
  return { label: 'Upcoming', dot: 'bg-sky-300' };
}

/** The cover art: a mosaic of the latest photos, or a designed placeholder in
 *  the event's own colour with its initial, so an empty event still looks
 *  intentional. Decorative — the card's text carries the meaning. */
function Cover({ ev, cover, className = '', size = 'md' }: { ev: HostEventRow; cover: EventCover | undefined; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const big = size === 'lg';
  const thumbs = cover?.thumbs ?? [];
  const accent = accentOf(ev.config) ?? '#B9BCFF';
  if (thumbs.length === 0) {
    return (
      <div
        aria-hidden
        className={`relative overflow-hidden ${className}`}
        style={{ background: `radial-gradient(120% 90% at 18% 10%, ${accent}66, transparent 60%), radial-gradient(90% 80% at 100% 100%, rgba(150,104,160,0.55), transparent 65%), linear-gradient(160deg, rgba(74,112,186,0.55), rgba(36,32,112,0.65))` }}
      >
        <span className={`absolute inset-0 flex items-center justify-center font-serif text-white/85 ${big ? 'text-[88px]' : size === 'sm' ? 'text-[22px]' : 'text-[56px]'} leading-none`}>
          {ev.name.trim().charAt(0).toUpperCase() || 'B'}
        </span>
        {size !== 'sm' && (
          <span className="absolute bottom-2.5 left-3 flex items-center gap-1.5 text-[12px] text-white/80">
            <Images className="w-3.5 h-3.5" /> Photos appear here once guests post
          </span>
        )}
      </div>
    );
  }
  // Rows are minmax(0,1fr) so 9:16 photos fill the frame instead of growing it.
  const n = size === 'sm' ? 1 : Math.min(thumbs.length, 3);
  const layout = n === 1 ? 'grid-cols-1 grid-rows-[minmax(0,1fr)]' : n === 2 ? 'grid-cols-2 grid-rows-[minmax(0,1fr)]' : 'grid-cols-3 grid-rows-[repeat(2,minmax(0,1fr))]';
  return (
    <div aria-hidden className={`grid gap-0.5 overflow-hidden bg-black/30 ${layout} ${className}`}>
      {thumbs.slice(0, n).map((src, i) => (
        <PostImage
          key={src}
          src={src}
          alt=""
          displayWidth={big ? 480 : size === 'sm' ? 96 : 240}
          className={`h-full min-h-0 w-full object-cover ${n >= 3 && i === 0 ? 'col-span-2 row-span-2' : ''}`}
          draggable={false}
        />
      ))}
    </div>
  );
}

interface MenuItem { label: string; icon: ReactNode; onSelect: () => void; tone?: 'danger'; disabled?: boolean }

/** The ⋯ menu: the less frequent actions, out of the card's way. Same
 *  keyboard model as the host rail's More menu (HostLayout.tsx). */
function EventMenu({ label, items, className = '' }: { label: string; items: MenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div className={className || 'relative'}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="glass pressable flex h-11 w-11 items-center justify-center rounded-full text-brand-fg"
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+0.375rem)] z-40 w-60 max-w-[calc(100vw-2rem)]">
          <div ref={menu} role="menu" aria-label={label} onKeyDown={onKey} className="rim-glint rounded-2xl p-1.5 flex flex-col bg-[rgba(34,32,104,0.97)] backdrop-blur-xl shadow-[0_24px_50px_-20px_rgba(8,6,30,0.85)]">
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                tabIndex={-1}
                type="button"
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onSelect(); }}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-[14px] transition-colors disabled:opacity-40 ${it.tone === 'danger' ? 'text-red-200 hover:bg-red-500/15 focus:bg-red-500/15' : 'text-brand-fg hover:bg-white/[0.08] focus:bg-white/[0.08]'} focus:outline-none`}
              >
                <span className="shrink-0 opacity-80">{it.icon}</span> {it.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const VIEW_KEY = 'beamwall.host.eventsView';
const PAGE = 12;

export default function EventsList() {
  const [events, setEvents] = useState<HostEventRow[] | null>([]);
  const [loading, setLoading] = useState(true);
  const [qrTarget, setQrTarget] = useState<HostEventRow | null>(null);
  const [upgradeTarget, setUpgradeTarget] = useState<HostEventRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<HostEventRow | null>(null);
  /** The permanent-delete dialog: its target, what the host has typed so far,
   *  and whether the sweep is running. Typed text is state, not a ref, because
   *  the confirm button's availability is derived from it on every keystroke. */
  const [deleteTarget, setDeleteTarget] = useState<HostEventRow | null>(null);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  /** An ENDED event the host asked to re-open — confirmed first, because a
   *  bare "Go live" on a finished event re-opens a wall guests think is over. */
  const [reopenTarget, setReopenTarget] = useState<HostEventRow | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [postCounts, setPostCounts] = useState<Record<string, PostCount>>({});
  const [covers, setCovers] = useState<Record<string, EventCover>>({});
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('event-date');
  const [shown, setShown] = useState(PAGE);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(() => {
    try { return !localStorage.getItem(HOST_ONBOARDED_KEY); } catch { return false; }
  });
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { push } = useToast();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const dismissGuide = () => {
    try { localStorage.setItem(HOST_ONBOARDED_KEY, '1'); } catch { /* private mode — non-fatal */ }
    setShowGuide(false);
  };

  // EventStudio bounces here with state when the studio gate denies access.
  useEffect(() => {
    if ((location.state as { studioError?: boolean } | null)?.studioError) {
      push('Couldn’t open that event’s studio — it may have been removed, or try again.', 'error');
      navigate(location.pathname, { replace: true, state: null }); // don't re-show on refresh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await fetchMyEvents(); // null = load failure → retry state below
    setEvents(list);
    setLoading(false);
    // Covers and cap meters fill in after the cards render — one shot per
    // load, no polling; each falls back on its own if its read fails.
    if (list && list.length > 0) {
      const live = list.filter((e) => e.status !== 'archived');
      const [counts, cov] = await Promise.all([fetchPostCounts(list), fetchCovers(live)]);
      setPostCounts(counts);
      setCovers(cov);
    } else {
      setPostCounts({});
      setCovers({});
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // "Good evening, Dapo": the first name from the account, never the email.
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => { if (alive) setFirstName(firstNameOf(data.user?.user_metadata)); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const pickView = (v: 'grid' | 'list') => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode — non-fatal */ }
  };
  // A new filter starts from the first page again.
  useEffect(() => { setShown(PAGE); }, [statusFilter, typeFilter, query, sort]);

  // Checkout round-trip feedback: Stripe returns to the page the host left
  // with ?checkout=success|cancelled (UpgradeModal's returnUrl is the current
  // URL). Toast it once, refresh the plan data, and strip the param so a
  // refresh doesn't re-announce it.
  const checkoutReturn = searchParams.get('checkout');
  useEffect(() => {
    if (checkoutReturn !== 'success' && checkoutReturn !== 'cancelled') return;
    if (checkoutReturn === 'success') {
      push('Payment received — your plan and credits update within a minute of Stripe confirming.', 'success');
      invalidateProSubscriptionCache();
      void load();
    } else {
      push('Checkout cancelled — nothing was charged.', 'info');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutReturn]);

  /**
   * Optimistic lifecycle flip, reverted on failure. `done` names the outcome in
   * the host's words because the status alone cannot: a restore and an "End"
   * both write 'ended'.
   *
   * `archived_at` is mirrored locally with the same rule host.ts applies
   * server-side, so the "Archived today" line appears without re-fetching.
   */
  const setStatus = async (ev: HostEventRow, status: string, done: string) => {
    setBusyId(ev.id);
    const prev = { status: ev.status, archived_at: ev.archived_at ?? null };
    const next = { status, archived_at: status === 'archived' ? new Date().toISOString() : null };
    setEvents((list) => (list ?? []).map((e) => (e.id === ev.id ? { ...e, ...next } : e))); // optimistic
    // Going live is the ONE path every button shares (host.goLive — it also
    // generates the guest copy once); archive/restore/end stay a plain flip.
    const ok = status === 'live' ? await goLive(ev.id) : await updateEventStatus(ev.id, status);
    if (ok) {
      push(done, 'success');
    } else {
      setEvents((list) => (list ?? []).map((e) => (e.id === ev.id ? { ...e, ...prev } : e))); // revert
      push(`Couldn’t update “${ev.name}” — check your connection and try again.`, 'error');
    }
    setBusyId(null);
  };

  /**
   * Permanent delete. NOT optimistic — the opposite of `setStatus` above.
   *
   * There is nothing to revert to if this goes wrong, and the edge function has
   * a third outcome the UI has to tell the truth about: when the storage sweep
   * cannot finish it deletes NOTHING, so a card that vanished optimistically
   * would have to reappear, which reads as a bug at exactly the moment a host
   * needs to trust the screen. The card leaves the list only after the server
   * says the row is gone.
   */
  const runDelete = async (ev: HostEventRow) => {
    setDeleting(true);
    const res = await deleteEvent(ev.id, deleteTyped);
    setDeleting(false);

    if (res.deleted) {
      setEvents((list) => (list ?? []).filter((e) => e.id !== ev.id));
      setDeleteTarget(null);
      setDeleteTyped('');
      push(
        res.objectsRemoved > 0
          ? `“${ev.name}” deleted — ${res.objectsRemoved} file${res.objectsRemoved === 1 ? '' : 's'} removed`
          : `“${ev.name}” deleted`,
        'success',
      );
      return;
    }

    // Already gone (a second tab, or a retry after a lost response): the outcome
    // the host asked for is the outcome they have, so the card goes.
    if (res.error === 'not_found') {
      setEvents((list) => (list ?? []).filter((e) => e.id !== ev.id));
      setDeleteTarget(null);
      setDeleteTyped('');
      push(`“${ev.name}” was already deleted`, 'info');
      return;
    }

    if (res.error === null && res.remaining.length > 0) {
      // Partial sweep. The dialog stays open — this one is worth retrying, and
      // the event is provably intact.
      push(
        `Couldn’t clear all of “${ev.name}”’s files, so nothing was deleted. Try again in a minute.`,
        'error',
      );
      return;
    }

    const message =
      res.error === 'must_archive_first'
        ? 'Archive the event first, then delete it.'
        : res.error === 'name_mismatch'
          ? 'That name doesn’t match — check it letter for letter.'
          : res.error === 'forbidden' || res.error === 'unauthorized'
            ? 'You don’t have access to delete that event.'
            : `Couldn’t delete “${ev.name}” — check your connection and try again.`;
    push(message, 'error');
  };

  /** "Duplicate event": a fresh draft with this event's look, frames,
   *  filters, copy and branding — never its photos, posts or cards. */
  const runDuplicate = async (ev: HostEventRow) => {
    if (duplicatingId !== null) return;
    setDuplicatingId(ev.id);
    const res = await duplicateEvent(ev);
    setDuplicatingId(null);
    if (!res.event) {
      push(
        res.error === 'slug_taken' || res.error === 'reserved_slug'
          ? `Couldn’t find a free link for a copy of “${ev.name}” — create it from New event instead.`
          : `Couldn’t duplicate “${ev.name}” — check your connection and try again.`,
        'error',
      );
      return;
    }
    const copy = res.event;
    setEvents((list) => [copy, ...(list ?? [])]);
    push(
      res.partial
        ? `Created “${copy.name}”, but some of the look didn’t copy — check it in Manage.`
        : `Created “${copy.name}” as a draft — photos and cards were not copied.`,
      res.partial ? 'error' : 'success',
    );
  };

  // Archived events are retired, not deleted: they come back in the same
  // fetchMyEvents payload and are split here, so the "Archived (N)" shelf costs
  // no second query. Order is preserved (created_at desc).
  const { active, archived } = partitionByArchived(events ?? []);
  // Filter → sort → page over the active list; archived events keep their
  // own shelf below and never appear in the filters.
  const filtered = sortEvents(filterEvents(active, { status: statusFilter, type: typeFilter, query }), sort);
  const spotlight = spotlightOf(active);
  const filtersOnEarly = statusFilter !== 'all' || typeFilter !== null || query.trim() !== '';
  // Unfiltered, the spotlight already shows its event, so the grid skips it;
  // any filter brings it back so a search never hides a match.
  const listed = !filtersOnEarly && spotlight ? filtered.filter((e) => e.id !== spotlight.id) : filtered;
  const visible = listed.slice(0, shown);
  const counts = { live: 0, upcoming: 0, drafts: 0, past: 0 };
  for (const ev of active) counts[statusBucket(ev)] += 1;
  const types = Array.from(new Set(active.map((e) => e.event_type).filter((t): t is string => typeof t === 'string' && t !== '')));
  const coverCounts = Object.values(covers).map((c) => c.count);
  const moments = coverCounts.length > 0 ? coverCounts.reduce((a, b) => a + b, 0) : null;
  // One event: the spotlight IS the page; the toolbar and grid would repeat it.
  const soloSpotlight = active.length === 1 && spotlight !== null;
  const summary = [
    counts.live > 0 ? `${counts.live} live now` : null,
    counts.upcoming > 0 ? `${counts.upcoming} coming up` : null,
    counts.drafts > 0 ? `${counts.drafts} draft${counts.drafts === 1 ? '' : 's'}` : null,
    moments !== null && moments > 0 ? `${moments.toLocaleString()} moment${moments === 1 ? '' : 's'} captured` : null,
  ].filter((x): x is string => x !== null);
  const filtersOn = filtersOnEarly;
  const clearFilters = () => { setStatusFilter('all'); setTypeFilter(null); setQuery(''); };

  // Getting-started guide, derived from data already in hand: the newest event
  // (fetchMyEvents orders created_at desc) anchors the links, done-ness comes
  // from the list itself. Step 3 is optional, so the ring and the auto-hide
  // track the two required steps only. An archived event only anchors the
  // guide when there is nothing active left to point at.
  const newest = active[0] ?? (events && events.length > 0 ? events[0] : null);
  const hasEvents = newest !== null;
  const anyLive = (events ?? []).some((e) => e.status === 'live');
  const guideSteps = [
    { n: '1', title: 'Create your event', rest: 'describe it, or fill it in yourself', done: hasEvents, to: '/host/new' },
    { n: '2', title: 'Go live & share the QR', rest: 'guests need no app', done: anyLive, to: newest ? `/host/events/${newest.id}/share` : '/host/new' },
    { n: '3', title: 'Make it yours (optional)', rest: 'frames, filters, 3D props & challenges', done: false, to: newest ? `/host/events/${newest.id}/library` : '/host/new' },
  ];
  const guidePct = Math.round((([hasEvents, anyLive].filter(Boolean).length) / 2) * 100);
  const guideDone = hasEvents && anyLive;

  const welcomeUrlOf = (ev: HostEventRow) => `${origin}/e/${ev.slug}/welcome`;

  /** The one action that matters most for this event right now. */
  const renderAction = (ev: HostEventRow, size: 'lg' | 'md' = 'md') => {
    const kind: NextAction = nextAction(ev);
    const busy = busyId === ev.id;
    const cls = size === 'lg'
      ? 'bg-foil pressable inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold transition disabled:opacity-40'
      : 'glass pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-brand-fg transition disabled:opacity-40';
    const icon = 'w-4 h-4';
    if (kind === 'open-wall' || kind === 'recap') {
      const href = kind === 'open-wall' ? `${origin}/e/${ev.slug}/wall` : `/r/${ev.slug}`;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
          {kind === 'open-wall' ? <><Play className={icon} /> Open the wall</> : <><Images className={icon} /> View recap</>}
        </a>
      );
    }
    if (kind === 'share') {
      return <button type="button" onClick={() => setQrTarget(ev)} className={cls}><QrCode className={icon} /> Share the QR</button>;
    }
    if (kind === 'go-live') {
      return (
        <button type="button" disabled={busy} onClick={() => setStatus(ev, 'live', 'You’re live — guests can scan now')} className={cls}>
          {busy ? <Loader2 className={`${icon} animate-spin`} /> : <Radio className={icon} />} Go live
        </button>
      );
    }
    return (
      <button type="button" disabled={busy} onClick={() => setStatus(ev, RESTORE_STATUS, `“${ev.name}” is back in your events`)} className={cls}>
        <ArchiveRestore className={icon} /> Restore
      </button>
    );
  };

  /** Everything else, in the ⋯ menu (the primary action is never repeated). */
  const menuItems = (ev: HostEventRow): MenuItem[] => {
    const kind = nextAction(ev);
    const archivedEv = isArchivedStatus(ev.status);
    const i = 'w-4 h-4';
    const items: (MenuItem | false)[] = [
      { label: 'Manage event', icon: <Settings2 className={i} />, onSelect: () => navigate(`/host/events/${ev.id}`) },
      { label: 'Open guest view', icon: <ExternalLink className={i} />, onSelect: () => { window.open(`${origin}/e/${ev.slug}`, '_blank', 'noopener,noreferrer'); } },
      { label: 'Copy guest link', icon: <Copy className={i} />, onSelect: () => { void copyText(welcomeUrlOf(ev)).then((ok) => { if (ok) push('Link copied', 'success'); }); } },
      kind !== 'share' && { label: 'Show QR code', icon: <QrCode className={i} />, onSelect: () => setQrTarget(ev) },
      !archivedEv && { label: 'Duplicate', icon: duplicatingId === ev.id ? <Loader2 className={`${i} animate-spin`} /> : <CopyPlus className={i} />, onSelect: () => void runDuplicate(ev), disabled: duplicatingId !== null },
      ev.status === 'live' && { label: 'End event', icon: <Square className={i} />, onSelect: () => void setStatus(ev, 'ended', 'Event ended'), disabled: busyId === ev.id },
      ev.status === 'ended' && { label: 'Re-open…', icon: <Radio className={i} />, onSelect: () => setReopenTarget(ev), disabled: busyId === ev.id },
      // No upgrade on an archived event — selling a bigger plan for something
      // the host has just retired is the wrong ask.
      !archivedEv && normalizeTier(ev.plan_tier) !== 'deluxe' && { label: 'Upgrade plan', icon: <ArrowUpRight className={i} />, onSelect: () => setUpgradeTarget(ev) },
      // Archiving a LIVE event is deliberately not offered — end it first, so
      // nobody retires a party that is still running.
      canArchiveStatus(ev.status) && { label: 'Archive', icon: <Archive className={i} />, onSelect: () => setArchiveTarget(ev), disabled: busyId === ev.id },
      // Permanent delete: archived events only, and the dialog asks for the name.
      canDeleteStatus(ev.status) && { label: 'Delete forever', icon: <Trash2 className={i} />, tone: 'danger', onSelect: () => { setDeleteTarget(ev); setDeleteTyped(''); }, disabled: busyId === ev.id },
    ];
    return items.filter((x): x is MenuItem => x !== false);
  };

  const qrButton = (ev: HostEventRow) => (
    <button
      type="button"
      onClick={() => setQrTarget(ev)}
      title="QR code"
      aria-label={`QR code for ${ev.name}`}
      className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-brand-fg/80 hover:text-brand-fg transition-colors"
    >
      <QrCode className="w-4 h-4" />
    </button>
  );

  /** The date · status · moments line. */
  const metaLine = (ev: HostEventRow) => {
    const when = formatEventDate(ev.starts_at);
    const look = statusLook(ev);
    const cover = covers[ev.id];
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-brand-muted">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5 shrink-0" aria-hidden />
          {when ? (
            <>{when.day} <span aria-hidden>·</span> <span className={when.relative === 'Today' ? 'text-emerald-300' : ''}>{when.relative}</span></>
          ) : 'No date set'}
        </span>
        <span aria-hidden className="text-white/30">|</span>
        <span>{look.label}</span>
        {cover && (
          <>
            <span aria-hidden className="text-white/30">|</span>
            <span>{cover.count.toLocaleString()} moment{cover.count === 1 ? '' : 's'}</span>
          </>
        )}
      </p>
    );
  };

  /** Notes a card owes the host: the link is shut, the event is archived, or
   *  the plan is filling up. */
  const notes = (ev: HostEventRow) => {
    // Started in the setup wizard and not finished: one tap back to the step
    // the host left (lib/wizard/wizardModel.setupChip).
    const setup = isArchivedStatus(ev.status) ? null : setupChip(ev.config);
    return (
    <>
      {setup && (
        <Link
          to={setupPath(ev.id, setup.step)}
          className="pressable self-start inline-flex min-h-10 items-center gap-2 rounded-full bg-white/[0.14] px-3.5 text-[13.5px] font-semibold text-brand-fg shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] hover:bg-white/[0.2]"
        >
          {setup.done >= setup.total ? (
            <>Finish setup · {setup.label}</>
          ) : (
            <>
              Continue setup · {setup.label}
              <span className="font-normal text-brand-muted">{setup.done} of {setup.total}</span>
            </>
          )}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
      {ev.status === 'draft' && (
        <p className="text-[13px] text-amber-200/90 leading-snug">Guests can’t open the link until you go live.</p>
      )}
      {isArchivedStatus(ev.status) && (
        <p className="text-[13px] text-brand-muted leading-snug">
          {archivedLabel(ev.archived_at)} — nothing was deleted. Restore it to bring it back.
        </p>
      )}
      {/* Posts-used / plan-cap meter — only for capped tiers whose count
          actually loaded (0 is a real count, keep !== undefined). */}
      {capFor(ev) !== null && postCounts[ev.id] !== undefined && (
        <CapMeter used={postCounts[ev.id]} cap={capFor(ev) as number} onUpgrade={() => setUpgradeTarget(ev)} />
      )}
    </>
    );
  };

  /** One event card, shared by the grid and the archived shelf so the two can
   *  never drift into looking like different products. The cover and the name
   *  open the event; the ⋯ menu holds everything else. A card lifts above its
   *  neighbours while its menu is open (each glass card is its own stacking
   *  context, so the menu would otherwise slide under the next card). */
  const renderCard = (ev: HostEventRow) => {
    const look = statusLook(ev);
    return (
      <article key={ev.id} className="group liquid-glass rounded-[22px] flex flex-col has-[[aria-expanded=true]]:z-30">
        <div className="relative">
          <Link
            to={`/host/events/${ev.id}`}
            tabIndex={-1}
            aria-hidden
            className="block overflow-hidden rounded-t-[22px]"
          >
            <Cover ev={ev} cover={covers[ev.id]} className="aspect-[16/10] w-full transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
          </Link>
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-[rgba(20,18,64,0.55)] px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur-md shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]">
            {typeLabel(ev.event_type)}
          </span>
          <EventMenu className="absolute right-2.5 top-2.5" label={`More for ${ev.name}`} items={menuItems(ev)} />
        </div>
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${look.dot}`} />
              <Link to={`/host/events/${ev.id}`} className="truncate font-serif text-[19px] leading-tight text-brand-fg hover:underline underline-offset-4">
                {ev.name}
              </Link>
            </p>
            <div className="mt-1">{metaLine(ev)}</div>
          </div>
          {notes(ev)}
          <div className="mt-auto flex items-center gap-2 pt-1">
            {renderAction(ev)}
            <CopyLinkButton text={welcomeUrlOf(ev)} />
            {nextAction(ev) !== 'share' && qrButton(ev)}
          </div>
        </div>
      </article>
    );
  };

  /** The list view: one row per event, for hosts with many. Columns past the
   *  name fold away on a phone, where the row keeps its thumbnail and menu. */
  // Fixed outer columns, so the header row and every event row line up.
  const rowGrid = 'grid grid-cols-[4.5rem_minmax(0,1fr)_auto] md:grid-cols-[4.5rem_minmax(0,2fr)_6.5rem_minmax(0,1.4fr)_5rem_2.75rem] lg:grid-cols-[4.5rem_minmax(0,2fr)_6.5rem_minmax(0,1.4fr)_5rem_13rem] items-center gap-3 md:gap-4';
  const renderRow = (ev: HostEventRow) => {
    const look = statusLook(ev);
    const when = formatEventDate(ev.starts_at);
    const cover = covers[ev.id];
    return (
      <div key={ev.id} className={`relative ${rowGrid} px-3 py-2.5 border-t border-white/10 first:border-t-0 has-[[aria-expanded=true]]:z-30`}>
        <Link to={`/host/events/${ev.id}`} tabIndex={-1} aria-hidden className="block h-12 w-[4.5rem] overflow-hidden rounded-xl">
          <Cover ev={ev} cover={cover} size="sm" className="h-full w-full" />
        </Link>
        <div className="min-w-0">
          <Link to={`/host/events/${ev.id}`} className="block truncate text-[15px] font-medium text-brand-fg hover:underline underline-offset-4">{ev.name}</Link>
          <p className="truncate font-mono text-[12px] text-brand-muted/80">/e/{ev.slug}</p>
        </div>
        <span className="hidden md:inline-flex items-center gap-2 text-[13px] text-brand-fg/90">
          <span aria-hidden className={`h-2 w-2 rounded-full ${look.dot}`} /> {look.label}
        </span>
        <span className="hidden md:block truncate text-[13px] text-brand-muted">{when ? `${when.day} · ${when.relative}` : 'No date set'}</span>
        <span className="hidden md:block text-[13px] text-brand-muted">{cover ? cover.count.toLocaleString() : '—'}</span>
        <div className="flex items-center justify-end gap-2">
          <span className="hidden lg:inline-flex">{renderAction(ev)}</span>
          <EventMenu label={`More for ${ev.name}`} items={menuItems(ev)} />
        </div>
      </div>
    );
  };

  const spotlightEyebrow = (ev: HostEventRow) =>
    ev.status === 'live' ? (
      <><span className="relative flex h-2.5 w-2.5"><span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping motion-reduce:animate-none" /><span className="relative h-2.5 w-2.5 rounded-full bg-emerald-400" /></span> Live now</>
    ) : ev.status === 'draft' ? <>Finish setting up</> : <>Up next</>;

  const chip = 'inline-flex min-h-8 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-[13px] text-brand-fg/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]';
  const control = 'glass min-h-11 rounded-full px-4 text-[14px] text-brand-fg';

  return (
    // pb-24 on phones: the Copilot FAB is fixed at bottom-6 right-6 and 56px
    // square, so it sat on top of the last card's actions at 390px.
    <div className="p-5 pb-24 md:p-10 md:pb-12 max-w-6xl mx-auto">
      <header className="relative mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[15px] text-brand-muted">
            {greetingFor(new Date().getHours())}{firstName ? `, ${firstName}` : ''}
          </p>
          <h1 className="mt-1 font-serif text-[34px] md:text-[40px] leading-none text-brand-fg">
            Your events
            {!loading && events !== null && active.length > 0 && (
              <span className="ml-2 align-middle text-[20px] text-brand-muted">({active.length})</span>
            )}
          </h1>
          {/* Counts what the page is showing — archived events have their own
              labelled shelf below, so folding them in here would not add up. */}
          <p className="mt-2 text-[14px] text-brand-muted">
            {loading ? 'Loading…' : events === null ? '' : summary.length > 0 ? summary.join(' · ') : active.length === 0 && archived.length > 0 ? 'Everything here is archived' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <img src={beamyCutout} alt="" aria-hidden className="pointer-events-none hidden md:block h-20 w-auto -mb-2 drop-shadow-[0_12px_20px_rgba(10,8,40,0.45)]" />
          <button
            onClick={load}
            disabled={loading}
            aria-label="Refresh events"
            className="glass pressable min-h-11 min-w-11 flex items-center justify-center rounded-full text-brand-fg/80 hover:text-brand-fg transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {/* The empty state has its own (single) primary CTA — two "New
              event" buttons on one screen is one too many. */}
          {!(events !== null && events.length === 0 && !loading) && (
            <Link to="/host/new" className="bg-foil pressable flex items-center gap-2 rounded-full px-5 min-h-11 text-[14px] font-semibold transition">
              <Plus className="w-4 h-4" /> New event
            </Link>
          )}
        </div>
      </header>

      {/* With no events yet the empty state below IS step 1 — showing the
          guide too put two cards and two routes to the same action on a
          brand-new host's first screen. It appears once an event exists. */}
      {showGuide && !loading && events !== null && events.length > 0 && !guideDone && (
        <div className="relative liquid-glass rounded-2xl px-5 py-4 mb-6">
          <button
            onClick={dismissGuide}
            aria-label="Dismiss guide"
            className="pressable absolute top-1.5 right-1.5 min-h-11 min-w-11 flex items-center justify-center rounded-lg text-brand-muted/50 hover:text-brand-fg text-xs transition-colors"
          >
            ✕
          </button>
          <div className="flex items-center gap-3 mb-3">
            {/* Conic progress ring — same pattern as the studio go-live checklist. */}
            <div
              className="shrink-0 flex items-center justify-center rounded-full"
              style={{
                width: 40, height: 40,
                background: `conic-gradient(var(--color-accent) ${guidePct * 3.6}deg, rgba(var(--accent-rgb),0.12) 0deg)`,
              }}
              aria-hidden
            >
              <div className="rounded-full bg-[color:var(--color-brand-bg)] flex items-center justify-center" style={{ width: 32, height: 32 }}>
                <span className="font-serif text-[11px] text-foil-static">{guidePct}%</span>
              </div>
            </div>
            <p className="font-label uppercase tracking-luxe text-[11px] text-accent">Getting started</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {guideSteps.map((s) => (
              <Link
                key={s.n}
                to={s.to}
                className="group flex items-start gap-2.5 rounded-xl -mx-1.5 px-1.5 py-1 hover:bg-white/[0.04] transition-colors"
              >
                {s.done ? (
                  <span className="shrink-0 w-5 h-5 rounded-full bg-accent/25 flex items-center justify-center">
                    <Check className="w-3 h-3 text-accent-2" />
                  </span>
                ) : (
                  <span className="shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent-2 font-label text-[11px] flex items-center justify-center">
                    {s.n}
                  </span>
                )}
                <p className="flex-1 font-sans text-[11px] text-brand-muted/70 leading-snug">
                  <span className={s.done ? 'text-brand-muted/60' : 'text-brand-fg'}>{s.title}</span> — {s.rest}
                </p>
                <ArrowRight className="shrink-0 mt-0.5 w-3 h-3 text-brand-muted/30 group-hover:text-accent-2 transition-colors" />
              </Link>
            ))}
          </div>
          <p className="mt-3 font-sans text-[11px] text-brand-muted/40">
            Your first 3 AI frames on every event are free; after that they use credits — top up any time in Billing.
          </p>
          <p className="mt-1 font-sans text-[11px] text-brand-muted/40">
            New to Beamwall?{' '}
            <Link to="/guides" className="rounded underline underline-offset-2 hover:text-brand-fg transition-colors">
              Read the guides
            </Link>
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <div className="h-[280px] liquid-glass rounded-[28px] animate-pulse" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-72 liquid-glass rounded-[22px] animate-pulse" />
            ))}
          </div>
        </div>
      ) : events === null ? (
        <div className="liquid-glass rounded-3xl p-12 text-center max-w-lg mx-auto">
          <p className="text-[15px] text-brand-muted leading-relaxed mb-6">
            Couldn’t load your events — check your connection and try again.
          </p>
          <button onClick={load} className="glass pressable inline-flex items-center gap-2 rounded-full px-6 min-h-11 text-[14px] font-medium text-brand-fg">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="liquid-glass rounded-[28px] px-6 py-10 sm:p-12 text-center max-w-xl mx-auto">
          <img src={beamyCutout} alt="" aria-hidden className="mx-auto mb-4 h-32 w-auto drop-shadow-[0_16px_26px_rgba(10,8,40,0.5)]" />
          <h2 className="font-serif text-[30px] leading-tight text-brand-fg mb-2">Create your first event</h2>
          <p className="text-[15px] text-brand-muted leading-relaxed mb-8">
            Describe the night or fill it in yourself, pick the frames guests can use, then go live and share
            the QR. About a minute, no design skills needed.
          </p>
          <Link to="/host/new" className="bg-foil pressable inline-flex items-center gap-2 whitespace-nowrap rounded-full px-7 min-h-12 text-[15px] font-semibold transition active:scale-[0.98]">
            <Plus className="w-4 h-4" /> Create your event
          </Link>
        </div>
      ) : (
        <>
          {spotlight && (
            <section aria-labelledby="spotlight-title" className="liquid-glass rounded-[28px] mb-8 grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] has-[[aria-expanded=true]]:z-30">
              <Link to={`/host/events/${spotlight.id}`} tabIndex={-1} aria-hidden className="block overflow-hidden rounded-t-[28px] md:rounded-tr-none md:rounded-l-[28px]">
                <Cover ev={spotlight} cover={covers[spotlight.id]} size="lg" className="h-[220px] md:h-[320px] w-full" />
              </Link>
              <div className="flex flex-col gap-4 p-6 md:p-8">
                <p className="flex items-center gap-2 text-[14px] font-medium text-accent-2">{spotlightEyebrow(spotlight)}</p>
                <h2 id="spotlight-title" className="font-serif text-[30px] md:text-[38px] leading-[1.04] text-brand-fg">
                  <Link to={`/host/events/${spotlight.id}`} className="hover:underline underline-offset-4">{spotlight.name}</Link>
                </h2>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const when = formatEventDate(spotlight.starts_at);
                    return (
                      <span className={chip}>
                        <CalendarDays className="w-3.5 h-3.5" aria-hidden />
                        {when ? `${when.day} · ${when.relative}` : 'No date set'}
                      </span>
                    );
                  })()}
                  {covers[spotlight.id] && (
                    <span className={chip}><Images className="w-3.5 h-3.5" aria-hidden /> {covers[spotlight.id].count.toLocaleString()} moment{covers[spotlight.id].count === 1 ? '' : 's'}</span>
                  )}
                  <span className={chip}>{typeLabel(spotlight.event_type)}</span>
                  <TierPill tier={spotlight.plan_tier} />
                </div>
                {notes(spotlight)}
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                  {renderAction(spotlight, 'lg')}
                  <Link to={`/host/events/${spotlight.id}`} className="glass pressable inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium text-brand-fg">
                    <Settings2 className="w-4 h-4" /> Manage
                  </Link>
                  <CopyLinkButton text={welcomeUrlOf(spotlight)} />
                  <EventMenu label={`More for ${spotlight.name}`} items={menuItems(spotlight)} />
                </div>
              </div>
            </section>
          )}

          {!soloSpotlight && active.length > 0 && (
            <>
              <div className="mb-5 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="relative min-w-[12rem] flex-1">
                    <span className="sr-only">Search events</span>
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" aria-hidden />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search events"
                      className="liquid-glass-inset w-full min-h-11 rounded-full pl-10 pr-4 text-[14px] text-brand-fg placeholder:text-brand-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                    />
                  </label>
                  {types.length > 1 && (
                    <label className="relative">
                      <span className="sr-only">Event type</span>
                      <select value={typeFilter ?? ''} onChange={(e) => setTypeFilter(e.target.value === '' ? null : e.target.value)} className={`${control} bg-[color:var(--color-brand-surface)]`}>
                        <option value="">All types</option>
                        {types.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="relative">
                    <span className="sr-only">Sort by</span>
                    <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={`${control} bg-[color:var(--color-brand-surface)]`}>
                      <option value="event-date">Event date</option>
                      <option value="created">Recently created</option>
                      <option value="name">Name A–Z</option>
                    </select>
                  </label>
                  <div role="group" aria-label="View" className="glass flex rounded-full p-1">
                    {([['grid', LayoutGrid, 'Grid'], ['list', List, 'List']] as const).map(([v, Icon, label]) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={view === v}
                        aria-label={`${label} view`}
                        onClick={() => pickView(v)}
                        className={`flex h-9 w-11 items-center justify-center rounded-full text-brand-fg/80 transition-colors hover:text-brand-fg ${view === v ? 'is-selected' : ''}`}
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                </div>
                <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
                  {([
                    ['all', 'All', active.length],
                    ['live', 'Live', counts.live],
                    ['upcoming', 'Upcoming', counts.upcoming],
                    ['drafts', 'Drafts', counts.drafts],
                    ['past', 'Past', counts.past],
                  ] as const).filter(([k, , n]) => k === 'all' || n > 0 || statusFilter === k).map(([k, label, n]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={statusFilter === k}
                      onClick={() => setStatusFilter(k)}
                      className={`glass pressable inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[14px] text-brand-fg/90 transition-colors hover:text-brand-fg ${statusFilter === k ? 'is-selected' : ''}`}
                    >
                      {label} <span className="text-brand-muted">{n}</span>
                    </button>
                  ))}
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="liquid-glass rounded-2xl p-10 text-center">
                  <p className="text-[15px] text-brand-muted mb-5">No events match{query.trim() ? ` “${query.trim()}”` : ''}.</p>
                  {filtersOn && (
                    <button onClick={clearFilters} className="glass pressable inline-flex min-h-11 items-center rounded-full px-5 text-[14px] font-medium text-brand-fg">Clear filters</button>
                  )}
                </div>
              ) : view === 'grid' ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{visible.map(renderCard)}</div>
              ) : (
                <div className="liquid-glass rounded-2xl">
                  <div className={`hidden md:grid ${rowGrid} px-3 pt-3 pb-2 text-[12px] text-brand-muted`} aria-hidden>
                    <span /><span>Event</span><span>Status</span><span>Date</span><span>Moments</span><span />
                  </div>
                  <div>{visible.map(renderRow)}</div>
                </div>
              )}

              {listed.length > shown && (
                <div className="mt-6 flex justify-center">
                  <button onClick={() => setShown((n) => n + PAGE)} className="glass pressable inline-flex min-h-11 items-center gap-2 rounded-full px-6 text-[14px] font-medium text-brand-fg">
                    Show more <span className="text-brand-muted">({listed.length - shown} left)</span>
                  </button>
                </div>
              )}
            </>
          )}

          {active.length === 0 && (
            <p className="text-[15px] text-brand-muted text-center py-8">
              Everything here is archived — open the shelf below to restore one, or start a new event.
            </p>
          )}

          {/* Archived shelf. Collapsed by default and rendered from the list
              already in hand — archiving is the product's soft-delete, so the
              events have to stay reachable, just out of the way. */}
          {archived.length > 0 && (
            <div className="mt-10">
              <button
                onClick={() => setShowArchived((v) => !v)}
                aria-expanded={showArchived}
                className="glass pressable inline-flex items-center gap-2 rounded-full px-4 min-h-11 text-[14px] text-brand-fg/80 hover:text-brand-fg transition-colors"
              >
                <Archive className="w-4 h-4" />
                Archived ({archived.length})
                <ChevronDown className={`w-4 h-4 transition-transform motion-reduce:transition-none ${showArchived ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {showArchived && (
                <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{archived.map(renderCard)}</div>
              )}
            </div>
          )}
        </>
      )}

      {qrTarget && (
        <QRModal
          url={`${origin}/e/${qrTarget.slug}/welcome`}
          name={qrTarget.name}
          draft={qrTarget.status === 'draft'}
          onClose={() => setQrTarget(null)}
        />
      )}
      {upgradeTarget && (
        <UpgradeModal
          eventUuid={upgradeTarget.id}
          currentTier={upgradeTarget.plan_tier}
          onClose={() => setUpgradeTarget(null)}
        />
      )}
      {/* Archiving is reversible and destroys nothing, so the copy says exactly
          that — every claim here is one the code actually keeps. Notably absent:
          "the wall stays live for guests". A signed-out guest gets the same
          "This event has ended" screen on an archived event as on an ended one
          (guestAccess in src/lib/eventAccess.ts), so promising otherwise would
          be a lie the host would only discover at the venue. */}
      {archiveTarget && (
        <ConfirmModal
          title={`Archive “${archiveTarget.name}”?`}
          body={
            <>
              It moves out of your events list and into the Archived shelf below it.
              Guests see no change — it isn’t live now and it won’t be after — and{' '}
              <span className="text-brand-fg">nothing is deleted</span>: the photos, the
              wall, keepsake cards and any credits you spent all stay where they are.
              Restore is one click, any time.
            </>
          }
          confirmLabel="Archive event"
          busy={busyId === archiveTarget.id}
          onConfirm={() => {
            const ev = archiveTarget;
            void setStatus(ev, 'archived', `“${ev.name}” archived`).then(() => setArchiveTarget(null));
          }}
          onCancel={() => setArchiveTarget(null)}
        />
      )}
      {reopenTarget && (
        <ConfirmModal
          title={`Re-open “${reopenTarget.name}”?`}
          body={
            <>
              This event has ended. Re-opening makes it <span className="text-brand-fg">live again</span>: the
              guest link and QR start working, and guests can post to the wall again. If this is a new
              occasion, Duplicate it instead — you keep the look and start with an empty wall.
            </>
          }
          confirmLabel="Re-open event"
          busy={busyId === reopenTarget.id}
          onConfirm={() => {
            const ev = reopenTarget;
            void setStatus(ev, 'live', `“${ev.name}” is live again`).then(() => setReopenTarget(null));
          }}
          onCancel={() => setReopenTarget(null)}
        />
      )}
      {/* Permanent delete. Every claim below is one the edge function keeps:
          it sweeps the posts, assets, cards and renders buckets and only then
          deletes the row (whose cascades take the posts, cards, challenges,
          experiences and settings with it). The QR sentence is here because a
          printed sign is the one piece of this a host cannot take back. */}
      {deleteTarget && (
        <ConfirmModal
          title={`Delete “${deleteTarget.name}” forever?`}
          tone="danger"
          confirmLabel="Delete forever"
          busy={deleting}
          confirmDisabled={!confirmNameMatches(deleteTyped, deleteTarget.name)}
          body={
            <>
              <span className="text-red-300">This cannot be undone.</span> It erases the event and
              everything under it — every guest photo and video, the guest galleries, keepsake cards
              and their films, your frames, 3D props, challenges and studio settings. The files are
              removed from storage, not just hidden.
              <span className="block mt-2">
                The guest link <span className="font-mono text-brand-fg/80">/e/{deleteTarget.slug}</span>{' '}
                and its QR code stop working — anything already printed or shared leads nowhere, and
                guests lose the moments saved on this wall.
              </span>
              <span className="block mt-2">
                Your billing history stays; credits already spent are not refunded.
              </span>
              <label htmlFor="delete-confirm-name" className="block mt-4 text-brand-muted/70">
                Type <span className="text-brand-fg">{deleteTarget.name}</span> to confirm
              </label>
              <input
                id="delete-confirm-name"
                value={deleteTyped}
                onChange={(e) => setDeleteTyped(e.target.value)}
                placeholder={deleteTarget.name}
                autoComplete="off"
                spellCheck={false}
                disabled={deleting}
                className="mt-2 w-full min-h-11 rounded-xl bg-white/[0.06] border border-white/10 px-3 font-sans text-xs text-brand-fg placeholder:text-brand-muted/25 focus:outline-none focus:border-red-400/40 disabled:opacity-50"
              />
            </>
          }
          onConfirm={() => { void runDelete(deleteTarget); }}
          onCancel={() => {
            if (deleting) return; // never abandon a sweep mid-flight
            setDeleteTarget(null);
            setDeleteTyped('');
          }}
        />
      )}
    </div>
  );
}
