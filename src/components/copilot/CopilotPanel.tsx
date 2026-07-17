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

  // Mobile soft-keyboard: when the keyboard opens, the *visual* viewport shrinks
  // but a position:fixed panel is laid out against the *layout* viewport (the
  // ICB, unchanged by the keyboard on iOS Safari where interactive-widget is
  // ignored). So the bottom-anchored input hides behind the keyboard. Track how
  // much the keyboard occludes and lift the panel's bottom edge above it; the
  // flex-1 chat scroll region shrinks so the input row stays visible. Desktop
  // has no soft keyboard (kbInset stays 0), so its md: bottom-6 anchor is
  // untouched. On browsers honoring interactive-widget=resizes-content the
  // layout viewport itself shrinks (innerHeight drops), so kbInset ≈ 0 and this
  // simply composes without double-adjusting.
  const [kbInset, setKbInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const isMobile = !window.matchMedia('(min-width: 768px)').matches;
      const occluded = isMobile
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      // Ignore sub-keyboard jitter (URL-bar collapse is a few px); real
      // keyboards occupy far more than 60px.
      setKbInset(occluded > 60 ? occluded : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

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
      const list = rows ?? []; // null = load failure; the popup degrades to no picker rows
      setEvents(list);
      setSelectedUuid((cur) => cur ?? routeUuid ?? (list.length === 1 ? list[0].id : null));
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

  // One assistant per surface: the Studio route has its own docked AI
  // Director, so the floating copilot panel must not render there even if
  // it was left open on another /host/** page before navigating in via
  // client-side routing (isOpen is global state, not reset per-route).
  const onStudio = pathname.includes('/studio');

  return (
    <AnimatePresence>
      {isOpen && !onStudio && (
        /* Floating chat window — NO backdrop: the page stays visible and
           interactive behind it, like a premium support widget. */
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          /* Mobile: inset on all four sides so the window can never be cut off
             by the browser chrome and stays centred (equal left/right insets).
             Desktop (md+): a compact floating window anchored bottom-right —
             explicit left/top/right/bottom classes, no inset-x shorthand (the
             shorthand's md: override lost the ordering fight and stranded the
             window top-left). The inline background re-solidifies the glass:
             liquid-glass alone is too transparent to read chat over a page. */
          className="fixed z-[80] left-3 right-3 top-3 bottom-3 md:left-auto md:top-auto md:right-6 md:bottom-6 md:w-[420px] md:h-[680px] md:max-h-[calc(100dvh-3rem)] rounded-3xl overflow-hidden liquid-glass border border-white/10 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.85)] flex flex-col"
          /* position INLINE because .liquid-glass (unlayered CSS) declares
             position:relative, which beats the layered Tailwind `fixed`
             utility — that collision stranded the popup at the page's static
             position instead of anchoring it to the viewport. */
          style={{
            position: 'fixed',
            backgroundColor: 'color-mix(in srgb, var(--color-brand-bg) 88%, transparent)',
            // When the mobile keyboard is up, override the bottom-3 (0.75rem)
            // anchor to sit above it. Only set inline when open so desktop's
            // md: bottom-6 class keeps winning at rest.
            ...(kbInset > 0 ? { bottom: `calc(0.75rem + ${kbInset}px)` } : null),
          }}
        >
            {/* Header */}
            <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-white/10">
              <div className="w-8 h-8 rounded-full bg-foil glow-accent flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
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
                    style={{ colorScheme: 'dark' }}
                    className="w-full appearance-none rounded-xl bg-white/[0.04] border border-white/10 pl-3 pr-8 py-2 text-[12px] text-brand-fg outline-none focus:border-[color:var(--color-accent)]/60 [&>option]:bg-brand-surface [&>option]:text-brand-fg"
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
      )}
    </AnimatePresence>
  );
}
