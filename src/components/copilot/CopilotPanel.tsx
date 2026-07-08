/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The copilot drawer (right-side sheet, ManagerConsole overlay idiom).
 * Entry offers the two modes the owner asked for: jump into the full Event
 * Concierge (/host/new) or "Ask anything" — docs-grounded platform Q&A plus
 * event-aware queries/management over a selected event.
 *
 * Event targeting: on /host/events/:id the event is auto-selected from the
 * route; elsewhere a picker (fetchMyEvents) chooses one, or "just the
 * platform" for pure help questions. The zustand event store is NEVER used
 * here (it's only correct inside EventProvider) — everything is explicit.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, ChevronDown, Loader2, PartyPopper, Sparkles, X } from 'lucide-react';
import { useCopilotStore } from '../../lib/copilotStore';
import { fetchMyEvents, type HostEventRow } from '../../lib/host';
import { loadEventSnapshot, type EventSnapshot } from '../../lib/eventSnapshot';
import CopilotChat from './CopilotChat';

const UUID_RE = /^\/host\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export default function CopilotPanel() {
  const { isOpen, close } = useCopilotStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const routeUuid = useMemo(() => UUID_RE.exec(pathname)?.[1] ?? null, [pathname]);
  const [events, setEvents] = useState<HostEventRow[] | null>(null);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);

  // Load the host's events when the panel opens; auto-select the route event.
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    fetchMyEvents().then((rows) => {
      if (!alive) return;
      setEvents(rows);
      setSelectedUuid((cur) => cur ?? routeUuid ?? (rows.length === 1 ? rows[0].id : null));
    });
    return () => { alive = false; };
  }, [isOpen, routeUuid]);

  // (Re)load the snapshot whenever the selected event changes.
  const selected = events?.find((e) => e.id === selectedUuid) ?? null;
  useEffect(() => {
    if (!selected) { setSnapshot(null); return; }
    let alive = true;
    setSnapLoading(true);
    loadEventSnapshot({
      eventUuid: selected.id,
      slug: selected.slug,
      name: selected.name,
      status: selected.status,
      planTier: selected.plan_tier,
      eventType: selected.event_type,
    })
      .then((s) => { if (alive) setSnapshot(s); })
      .catch(() => { if (alive) setSnapshot(null); })
      .finally(() => { if (alive) setSnapLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const refreshSnapshot = () => {
    // Cheap trigger: re-run the selected-event effect by resetting selection.
    const cur = selectedUuid;
    setSelectedUuid(null);
    setTimeout(() => setSelectedUuid(cur), 0);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[80] flex justify-end bg-black/60 backdrop-blur-sm" onClick={close}>
          <motion.div
            initial={{ x: 480, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 480, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="h-full w-full max-w-md app-bg border-l border-white/10 flex flex-col"
          >
            {/* Header */}
            <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-white/10">
              <div className="w-8 h-8 rounded-full bg-foil glow-accent flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-noir-900" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-serif text-sm text-foil-static leading-tight">Beamwall Copilot</p>
                <p className="font-sans text-[10px] text-brand-muted/60 truncate">
                  {selected ? selected.name : 'Platform help & your events'}
                </p>
              </div>
              <button
                onClick={close}
                aria-label="Close copilot"
                className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick actions + event picker */}
            <div className="shrink-0 px-4 pt-3 flex flex-col gap-2">
              <button
                onClick={() => { close(); navigate('/host/new'); }}
                className="flex items-center gap-2.5 rounded-xl border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/10 px-3.5 py-2.5 text-left hover:bg-[color:var(--color-accent)]/15 transition-colors"
              >
                <PartyPopper className="w-4 h-4 text-[color:var(--color-accent)] shrink-0" />
                <span className="font-sans text-[12px] text-brand-fg">Create a new event with the Concierge</span>
              </button>

              <div className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-brand-muted/50 shrink-0" />
                <div className="relative flex-1">
                  <select
                    value={selectedUuid ?? ''}
                    onChange={(e) => setSelectedUuid(e.target.value || null)}
                    className="w-full appearance-none rounded-xl bg-white/[0.04] border border-white/10 pl-3 pr-8 py-2 text-[12px] text-brand-fg outline-none focus:border-[color:var(--color-accent)]/60"
                  >
                    <option value="">Just the platform (no event)</option>
                    {(events ?? []).map((e) => (
                      <option key={e.id} value={e.id}>{e.name} · {e.status}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-brand-muted/50 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                {snapLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-muted/50 shrink-0" />}
              </div>
            </div>

            {/* Chat */}
            <CopilotChat
              key={selectedUuid ?? 'platform'}
              snapshot={snapshot}
              onMutated={refreshSnapshot}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
