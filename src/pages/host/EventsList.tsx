/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host — the member's events: guest link + QR, status toggles, Open studio,
 * and the New event CTA. Empty state sells the wizard.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '../../components/ui/Modal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { Archive, ArchiveRestore, ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, ExternalLink, Plus, QrCode, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { fetchMyEvents, updateEventStatus, deleteEvent, eventOrgHasActivePro, invalidateProSubscriptionCache, type HostEventRow } from '../../lib/host';
import { RESTORE_STATUS, archivedLabel, canArchiveStatus, canDeleteStatus, confirmNameMatches, isArchivedStatus, partitionByArchived } from '../../lib/eventArchive';
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
      className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
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
        <p className="font-mono text-[9px] text-brand-muted/60 break-all">{url}</p>
        {draft && (
          <p className="font-sans text-[10px] text-amber-400/90 leading-snug">
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
        <span className="font-sans text-[10px] text-brand-muted/50">
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
        <span className={`font-sans text-[10px] ${nearCap ? 'text-amber-400/90' : 'text-brand-muted/50'}`}>
          {used} / {cap} posts on this plan
        </span>
        {nearCap && (
          <button
            onClick={onUpgrade}
            className="font-label uppercase tracking-luxe text-[9px] text-accent-2 hover:underline underline-offset-2"
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
  const [postCounts, setPostCounts] = useState<Record<string, PostCount>>({});
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
    // Cap meters fill in after the cards render — one shot per load, no polling.
    if (list && list.length > 0) {
      setPostCounts(await fetchPostCounts(list));
    } else {
      setPostCounts({});
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    const ok = await updateEventStatus(ev.id, status);
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

  // Archived events are retired, not deleted: they come back in the same
  // fetchMyEvents payload and are split here, so the "Archived (N)" shelf costs
  // no second query. Order is preserved (created_at desc).
  const { active, archived } = partitionByArchived(events ?? []);

  // Getting-started guide, derived from data already in hand: the newest event
  // (fetchMyEvents orders created_at desc) anchors the links, done-ness comes
  // from the list itself. Step 3 is optional, so the ring and the auto-hide
  // track the two required steps only. An archived event only anchors the
  // guide when there is nothing active left to point at.
  const newest = active[0] ?? (events && events.length > 0 ? events[0] : null);
  const hasEvents = newest !== null;
  const anyLive = (events ?? []).some((e) => e.status === 'live');
  const guideSteps = [
    { n: '1', title: 'Create your event', rest: 'the AI concierge sets it up in a minute', done: hasEvents, to: '/host/new' },
    { n: '2', title: 'Go live & share the QR', rest: 'guests need no app', done: anyLive, to: newest ? `/host/events/${newest.id}/share` : '/host/new' },
    { n: '3', title: 'Make it yours (optional)', rest: 'AI frames, 3D props & challenges in the Studio', done: false, to: newest ? `/host/events/${newest.id}/studio` : '/host/new' },
  ];
  const guidePct = Math.round((([hasEvents, anyLive].filter(Boolean).length) / 2) * 100);
  const guideDone = hasEvents && anyLive;

  /** One event card. Shared verbatim by the live grid and the archived shelf so
   *  the two can never drift into looking like different products. */
  const renderCard = (ev: HostEventRow) => {
    const guestUrl = `${origin}/e/${ev.slug}`;
    // Guests should land on the welcome page — the product's own
    // recommended entry — so copy-link and the QR both point there.
    const welcomeUrl = `${origin}/e/${ev.slug}/welcome`;
    const busy = busyId === ev.id;
    const isArchived = isArchivedStatus(ev.status);
    return (
      <div key={ev.id} className="liquid-glass rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-serif text-lg text-brand-fg leading-tight truncate">{ev.name}</p>
            <p className="font-sans text-[10px] uppercase tracking-widest text-brand-muted/40 mt-0.5">{ev.event_type}</p>
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            <TierPill tier={ev.plan_tier} />
            <StatusPill status={ev.status} />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <p className="flex-1 font-mono text-[11px] text-brand-muted/70 truncate">/e/{ev.slug}</p>
          <CopyLinkButton text={welcomeUrl} />
          <button
            onClick={() => setQrTarget(ev)}
            title="QR code"
            className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
          >
            <QrCode className="w-3.5 h-3.5" />
          </button>
          <a
            href={guestUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open guest view"
            className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
        {ev.status === 'draft' && (
          <p className="font-sans text-[10px] text-amber-400/90 leading-snug">
            Guests can’t open this link until you Go live.
          </p>
        )}
        {isArchived && (
          <p className="font-sans text-[10px] text-brand-muted/50 leading-snug">
            {archivedLabel(ev.archived_at)} — nothing was deleted. Restore it to bring it back.
          </p>
        )}
        {/* Posts-used / plan-cap meter — only for capped tiers whose
            count actually loaded (0 is a real count, keep !== undefined). */}
        {capFor(ev) !== null && postCounts[ev.id] !== undefined && (
          <CapMeter
            used={postCounts[ev.id]}
            cap={capFor(ev) as number}
            onUpgrade={() => setUpgradeTarget(ev)}
          />
        )}

        {/* flex-wrap: four 44px-tall pills do not fit one line on a 390px
            phone, and a card that overflows sideways is worse than one row. */}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Link
            to={`/host/events/${ev.id}`}
            className="pressable flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-4 min-h-11 font-label uppercase tracking-luxe text-[9px] text-brand-fg/90 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" /> Open studio
          </Link>
          {(ev.status === 'draft' || ev.status === 'ended') && (
            <button
              onClick={() => setStatus(ev, 'live', 'You’re live — guests can scan now')}
              disabled={busy}
              className="rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 px-4 min-h-11 font-label uppercase tracking-luxe text-[9px] text-emerald-400 transition-colors disabled:opacity-40"
            >
              Go live
            </button>
          )}
          {ev.status === 'live' && (
            <button
              onClick={() => setStatus(ev, 'ended', 'Event ended')}
              disabled={busy}
              className="rounded-full bg-amber-500/15 hover:bg-amber-500/25 px-4 min-h-11 font-label uppercase tracking-luxe text-[9px] text-amber-400 transition-colors disabled:opacity-40"
            >
              End
            </button>
          )}
          {/* Archiving a LIVE event is deliberately not offered — end it first,
              so nobody retires a party that is still running. */}
          {canArchiveStatus(ev.status) && (
            <button
              onClick={() => setArchiveTarget(ev)}
              disabled={busy}
              className="pressable flex items-center gap-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] px-4 min-h-11 font-label uppercase tracking-luxe text-[9px] text-brand-muted/60 hover:text-brand-fg transition-colors disabled:opacity-40"
            >
              <Archive className="w-3.5 h-3.5" /> Archive
            </button>
          )}
          {isArchived && (
            <button
              onClick={() => setStatus(ev, RESTORE_STATUS, `“${ev.name}” is back in your events`)}
              disabled={busy}
              className="pressable flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-4 min-h-11 font-label uppercase tracking-luxe text-[9px] text-brand-fg/90 transition-colors disabled:opacity-40"
            >
              <ArchiveRestore className="w-3.5 h-3.5" /> Restore
            </button>
          )}
          {/* Permanent delete, archived events only — two deliberate acts, and
              the second one is guarded by typing the event's name. Styled quiet
              (not a red slab) so it is never the loud thing on an archived card;
              the dialog is where the danger is stated. */}
          {canDeleteStatus(ev.status) && (
            <button
              onClick={() => { setDeleteTarget(ev); setDeleteTyped(''); }}
              disabled={busy}
              className="pressable flex items-center gap-1.5 rounded-full bg-white/[0.04] hover:bg-red-500/15 px-4 min-h-11 font-label uppercase tracking-luxe text-[9px] text-brand-muted/60 hover:text-red-300 transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete forever
            </button>
          )}
          {/* No upgrade CTA on an archived event — selling a bigger plan for
              something the host has just retired is the wrong ask. */}
          {!isArchived && normalizeTier(ev.plan_tier) !== 'deluxe' && (
            <button
              onClick={() => setUpgradeTarget(ev)}
              className="ml-auto flex items-center gap-1 rounded-full bg-accent/10 hover:bg-accent/20 px-4 min-h-11 font-label uppercase tracking-luxe text-[9px] text-accent-2 transition-colors"
            >
              Upgrade <ArrowUpRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    // pb-24 on phones: the Copilot FAB is fixed at bottom-6 right-6 and 56px
    // square, so it sat on top of the last card's actions at 390px.
    <div className="p-6 pb-24 md:p-10 md:pb-10 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Your events</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">
            {/* Counts what the grid is showing — archived events have their own
                labelled shelf below, so folding them in here would not add up. */}
            {loading ? 'Loading…' : events === null ? '' : `${active.length} event${active.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            aria-label="Refresh events"
            className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            to="/host/new"
            className="pressable flex items-center gap-2 rounded-full bg-foil px-5 min-h-11 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition"
          >
            <Plus className="w-4 h-4" /> New event
          </Link>
        </div>
      </header>

      {showGuide && !loading && events !== null && !guideDone && (
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
                <span className="font-serif text-[10px] text-foil-static">{guidePct}%</span>
              </div>
            </div>
            <p className="font-label uppercase tracking-luxe text-[10px] text-accent">Getting started</p>
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
                  <span className="shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent-2 font-label text-[10px] flex items-center justify-center">
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
          <p className="mt-3 font-sans text-[10px] text-brand-muted/40">
            Credits power the AI studio — top up any time in Billing.
          </p>
          <p className="mt-1 font-sans text-[10px] text-brand-muted/40">
            New to Beamwall?{' '}
            <Link to="/guides" className="rounded underline underline-offset-2 hover:text-brand-fg transition-colors">
              Read the guides
            </Link>
          </p>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 liquid-glass rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : events === null ? (
        <div className="liquid-glass rounded-3xl p-12 text-center max-w-lg mx-auto">
          <p className="font-sans text-sm text-brand-muted/70 leading-relaxed mb-6">
            Couldn’t load your events — check your connection and try again.
          </p>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-6 py-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="liquid-glass rounded-3xl p-12 text-center max-w-lg mx-auto">
          <h2 className="font-serif text-2xl text-foil-static mb-2">Create your first event</h2>
          <p className="font-sans text-sm text-brand-muted/70 leading-relaxed mb-8">
            Booth, live wall and studio in under a minute — pick a name, claim your link, go live, and share the QR with your guests.
          </p>
          <Link
            to="/host/new"
            className="inline-flex items-center gap-2 rounded-full bg-foil px-8 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" /> New event
          </Link>
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">{active.map(renderCard)}</div>
          ) : (
            <p className="font-sans text-sm text-brand-muted/60 text-center py-8">
              Everything here is archived — open the shelf below to restore one, or start a new event.
            </p>
          )}

          {/* Archived shelf. Collapsed by default and rendered from the list
              already in hand — archiving is the product's soft-delete, so the
              events have to stay reachable, just out of the way. */}
          {archived.length > 0 && (
            <div className="mt-8">
              <button
                onClick={() => setShowArchived((v) => !v)}
                aria-expanded={showArchived}
                className="pressable inline-flex items-center gap-2 rounded-full bg-white/[0.04] hover:bg-white/[0.08] px-4 min-h-11 font-label uppercase tracking-luxe text-[9px] text-brand-muted/60 hover:text-brand-fg transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                Archived ({archived.length})
                <ChevronDown
                  className={`w-3 h-3 transition-transform motion-reduce:transition-none ${showArchived ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
              {showArchived && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">{archived.map(renderCard)}</div>
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
