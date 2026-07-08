/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host/concierge — the Event Concierge workspace. Left: every event as a
 * selectable card (inline rename, go-live/end, guest link, open studio).
 * Right: the copilot chat INLINE (not the popup), scoped to whichever event
 * is selected — ask anything, add challenges/packs, make cards, get stats.
 * Creating a brand-new event stays at /host/new (the create concierge).
 *
 * Reuses CopilotChat wholesale: transcripts persist per event, tool proposals
 * render as confirm cards, and onMutated reloads the snapshot so the AI keeps
 * seeing fresh event data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Copy, ExternalLink, Loader2, PartyPopper, Pencil, Settings2, Sparkles, X } from 'lucide-react';
import { fetchMyEvents, updateEventName, updateEventStatus, type HostEventRow } from '../../lib/host';
import { loadEventSnapshot, type EventSnapshot } from '../../lib/eventSnapshot';
import { TierPill } from './UpgradeCard';
import CopilotChat from '../../components/copilot/CopilotChat';

function statusPill(status: string): string {
  switch (status) {
    case 'live': return 'bg-emerald-500/15 text-emerald-400';
    case 'ended': return 'bg-amber-500/15 text-amber-400';
    case 'archived': return 'bg-white/[0.05] text-brand-muted/40';
    default: return 'bg-white/[0.08] text-brand-muted/70'; // draft
  }
}

/** One selectable event card: inline rename, status toggle, link chips. */
function EventCard({
  ev,
  selected,
  busy,
  onSelect,
  onRename,
  onStatus,
}: {
  ev: HostEventRow;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onStatus: (status: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ev.name);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const guestUrl = `${origin}/e/${ev.slug}`;

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== ev.name) onRename(next);
    else setDraft(ev.name);
  };

  return (
    <div
      onClick={onSelect}
      className={`liquid-glass rounded-2xl p-4 flex flex-col gap-2.5 cursor-pointer transition-all ${
        selected
          ? 'ring-1 ring-[color:var(--color-accent)]/60 border-[color:var(--color-accent)]/40 shadow-[0_10px_40px_-12px_rgba(var(--accent-rgb),0.35)]'
          : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                value={draft}
                maxLength={80}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') { setDraft(ev.name); setEditing(false); }
                }}
                onBlur={commit}
                className="min-w-0 flex-1 rounded-lg bg-white/[0.06] border border-[color:var(--color-accent)]/40 px-2 py-1 font-serif text-base text-brand-fg outline-none"
              />
              <button onMouseDown={(e) => { e.preventDefault(); setDraft(ev.name); setEditing(false); }} aria-label="Cancel rename" className="p-1 text-brand-muted/50 hover:text-brand-fg">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <p className="group/name flex items-center gap-1.5 font-serif text-base text-brand-fg leading-tight truncate">
              <span className="truncate">{ev.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setDraft(ev.name); setEditing(true); }}
                aria-label={`Rename ${ev.name}`}
                className="shrink-0 p-0.5 text-brand-muted/40 hover:text-[color:var(--color-accent)] transition-colors"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </p>
          )}
          <p className="font-sans text-[9px] uppercase tracking-widest text-brand-muted/40 mt-0.5">{ev.event_type}</p>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <TierPill tier={ev.plan_tier} />
          <span className={`px-2 py-0.5 rounded-full text-[8px] font-label uppercase tracking-widest ${statusPill(ev.status)}`}>
            {ev.status}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <p className="flex-1 font-mono text-[10px] text-brand-muted/60 truncate">/e/{ev.slug}</p>
        <button
          onClick={() => navigator.clipboard.writeText(guestUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
          title="Copy guest link"
          className="p-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
        <a
          href={guestUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open guest view"
          className="p-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
        <Link
          to={`/host/events/${ev.id}`}
          title="Open studio"
          className="p-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
        >
          <Settings2 className="w-3 h-3" />
        </Link>
        {(ev.status === 'draft' || ev.status === 'ended') && (
          <button
            onClick={() => onStatus('live')}
            disabled={busy}
            className="rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-1 font-label uppercase tracking-luxe text-[8px] text-emerald-400 transition-colors disabled:opacity-40"
          >
            Go live
          </button>
        )}
        {ev.status === 'live' && (
          <button
            onClick={() => onStatus('ended')}
            disabled={busy}
            className="rounded-full bg-amber-500/15 hover:bg-amber-500/25 px-2.5 py-1 font-label uppercase tracking-luxe text-[8px] text-amber-400 transition-colors disabled:opacity-40"
          >
            End
          </button>
        )}
      </div>
    </div>
  );
}

export default function Concierge() {
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState<HostEventRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(params.get('event'));
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await fetchMyEvents();
    setEvents(rows);
    setSelectedId((cur) => cur && rows.some((r) => r.id === cur) ? cur : (rows[0]?.id ?? null));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Keep ?event= shareable/bookmarkable.
  useEffect(() => {
    if (selectedId && params.get('event') !== selectedId) {
      setParams({ event: selectedId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selected = events?.find((e) => e.id === selectedId) ?? null;

  const refreshSnapshot = useCallback(() => {
    if (!selected) { setSnapshot(null); return; }
    setSnapLoading(true);
    loadEventSnapshot({
      eventUuid: selected.id,
      slug: selected.slug,
      name: selected.name,
      status: selected.status,
      planTier: selected.plan_tier,
      eventType: selected.event_type,
    })
      .then(setSnapshot)
      .catch(() => setSnapshot(null))
      .finally(() => setSnapLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.name, selected?.status]);
  useEffect(() => { refreshSnapshot(); }, [refreshSnapshot]);

  const rename = async (ev: HostEventRow, name: string) => {
    setBusyId(ev.id);
    const prev = ev.name;
    setEvents((list) => (list ?? []).map((e) => (e.id === ev.id ? { ...e, name } : e))); // optimistic
    const ok = await updateEventName(ev.id, name);
    if (!ok) setEvents((list) => (list ?? []).map((e) => (e.id === ev.id ? { ...e, name: prev } : e)));
    setBusyId(null);
  };

  const setStatus = async (ev: HostEventRow, status: string) => {
    setBusyId(ev.id);
    const prev = ev.status;
    setEvents((list) => (list ?? []).map((e) => (e.id === ev.id ? { ...e, status } : e))); // optimistic
    const ok = await updateEventStatus(ev.id, status);
    if (!ok) setEvents((list) => (list ?? []).map((e) => (e.id === ev.id ? { ...e, status: prev } : e)));
    setBusyId(null);
  };

  return (
    <div className="h-full flex flex-col p-4 md:p-6 max-w-7xl mx-auto w-full min-h-0">
      <header className="shrink-0 flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl text-foil-static flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-[color:var(--color-accent)]" /> Event Concierge
          </h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">
            Pick an event and run it in plain words — challenges, cards, stats, share links.
          </p>
        </div>
        <Link
          to="/host/new"
          className="flex items-center gap-2 rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98]"
        >
          <PartyPopper className="w-4 h-4" /> New event with the Concierge
        </Link>
      </header>

      {events !== null && events.length === 0 ? (
        <div className="liquid-glass rounded-3xl p-12 text-center max-w-lg mx-auto my-auto">
          <h2 className="font-serif text-2xl text-foil-static mb-2">No events yet</h2>
          <p className="font-sans text-sm text-brand-muted/70 leading-relaxed mb-8">
            Describe your celebration to the Concierge and it designs the whole event — the look, the name, the guest link.
          </p>
          <Link
            to="/host/new"
            className="inline-flex items-center gap-2 rounded-full bg-foil px-8 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
          >
            <PartyPopper className="w-4 h-4" /> Start with the Concierge
          </Link>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[360px_minmax(0,1fr)] gap-4">
          {/* Event cards — the only scroll region on the left */}
          <div className="shrink-0 lg:shrink max-h-56 lg:max-h-none lg:h-full overflow-y-auto hide-scrollbar flex flex-col gap-3 pr-0.5">
            {events === null
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-28 liquid-glass rounded-2xl animate-pulse shrink-0" />
                ))
              : events.map((ev) => (
                  <EventCard
                    key={ev.id}
                    ev={ev}
                    selected={ev.id === selectedId}
                    busy={busyId === ev.id}
                    onSelect={() => setSelectedId(ev.id)}
                    onRename={(name) => rename(ev, name)}
                    onStatus={(status) => setStatus(ev, status)}
                  />
                ))}
          </div>

          {/* Inline copilot chat, scoped to the selected event */}
          <div
            className="flex-1 min-h-0 liquid-glass rounded-3xl border border-white/10 flex flex-col overflow-hidden"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-brand-bg) 72%, transparent)' }}
          >
            <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-white/10">
              <div className="w-8 h-8 rounded-full bg-foil glow-accent flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-serif text-sm text-foil-static leading-tight truncate">
                  {selected ? selected.name : 'Pick an event'}
                </p>
                <p className="font-sans text-[10px] text-brand-muted/60 truncate">
                  {selected ? `/e/${selected.slug} · ${selected.status}` : 'Select a card on the left to begin'}
                </p>
              </div>
              {snapLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-muted/50 shrink-0" />}
              {selected && (
                <Link
                  to={`/host/events/${selected.id}`}
                  className="shrink-0 flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-3.5 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg/90 transition-colors"
                >
                  <Settings2 className="w-3 h-3" /> Studio
                </Link>
              )}
            </div>
            <CopilotChat
              key={selectedId ?? 'none'}
              snapshot={snapshot}
              onMutated={refreshSnapshot}
            />
          </div>
        </div>
      )}
    </div>
  );
}
