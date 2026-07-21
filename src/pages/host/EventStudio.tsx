/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host/events/:id/* — the event studio: the nine admin screens (plus Manager
 * access) re-homed under the host platform, wrapped in an EventProvider so the
 * screens' useEvent()/useStore tenancy works unchanged.
 *
 * Gated explicitly below via `canEnterStudio` — `events_public_read` RLS
 * deliberately lets anyone read any non-draft event's row (guest pages need
 * that), so the row resolving is NOT proof of membership; that call is the
 * actual gate. Known accepted quirks: archived events render EventProvider's
 * "This event has ended" screen instead of the studio, and the event theme
 * (data-event attr, document title) lingers when navigating back to /host —
 * same as leaving /e/:slug today.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, Copy, FolderOpen, Gift, Image as ImageIcon, KeyRound,
  LayoutGrid, Palette, QrCode, Settings, ShieldCheck, Sparkles, Trophy, Wand2, X,
} from 'lucide-react';
import { useCopilotStore } from '../../lib/copilotStore';
import { supabase } from '../../lib/supabase';
import { canEnterStudio } from '../../lib/host';
import { subscribeToPosts } from '../../lib/db';
import type { Post } from '../../types';
import EventProvider, { useEvent } from '../../events/EventContext';
import { StudioBaseContext } from '../../components/admin/studioBase';
import Dashboard from '../../components/admin/Dashboard';
import Library from '../../components/admin/Library';
import Assets from '../../components/admin/Assets';
import StudioShell, { StudioRedirect } from '../../components/studio/StudioShell';
import StudioOnboarding, { useStudioOnboarding } from '../../components/studio/StudioOnboarding';
import { AnimatePresence } from 'motion/react';
import Moderation from '../../components/admin/Moderation';
import Challenges from '../../components/admin/Challenges';
import Branding from '../../components/admin/Branding';
import SettingsScreen from '../../components/admin/Settings';
import ManagerAccess from './ManagerAccess';
import CardsTab from './CardsTab';
import ShareKit from './ShareKit';
import UpgradeCard from './UpgradeCard';
import StatusPill from '../../components/ui/StatusPill';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StudioEvent {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan_tier: string;
  event_type: string;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'ready'; event: StudioEvent };

function GuestLinkCopy({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      title="Copy guest link"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass text-[10px] font-mono text-brand-muted/60 hover:text-accent-2 transition-colors max-w-[14rem]"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
      <span className="truncate hidden sm:inline">{url.replace(/^https?:\/\//, '')}</span>
    </button>
  );
}

type ModerationMode = 'post' | 'pre';

/**
 * Wall tab wrapper: the per-event moderation-mode toggle (events.config
 * .moderation, migration 014) plus a live pending-approval queue for 'pre'
 * events, stacked above the existing Moderation screen. Rendered inside
 * EventProvider, so useEvent()/event theming work as in the admin screens.
 */
function ModerationTab({ eventUuid }: { eventUuid: string }) {
  const { eventId } = useEvent(); // slug — posts.event_id = events.slug
  const [mode, setModeState] = useState<ModerationMode | null>(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Post[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('event_id', eventId)
      .eq('approved', false)
      .eq('hidden', false)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[ModerationTab] pending fetch', error);
      return;
    }
    setPending((data as Post[]) ?? []);
  }, [eventId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from('events').select('config').eq('id', eventUuid).maybeSingle();
      if (!alive) return;
      if (error) console.error('[ModerationTab] config fetch', error);
      const m = ((data?.config ?? {}) as Record<string, unknown>).moderation;
      setModeState(m === 'pre' ? 'pre' : 'post');
    })();
    loadPending();
    // Raw subscription (no visibleOnly): this queue exists precisely to see
    // unapproved posts arrive live.
    const unsub = subscribeToPosts(eventId, {
      onInsert: (p) => {
        if (p.approved || p.hidden) return;
        setPending((prev) => (prev.some((x) => x.id === p.id) ? prev : [p, ...prev]));
      },
      onUpdate: (p) => {
        setPending((prev) => {
          if (p.approved || p.hidden) return prev.filter((x) => x.id !== p.id);
          return prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [p, ...prev];
        });
      },
      onDelete: (id) => setPending((prev) => prev.filter((x) => x.id !== id)),
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [eventUuid, eventId, loadPending]);

  const setMode = async (next: ModerationMode) => {
    if (saving || mode === null || mode === next) return;
    const prev = mode;
    setSaving(true);
    setModeState(next); // optimistic
    // Read-merge-write on events.config — same idiom as primary_card (CardsTab).
    const { data, error: readErr } = await supabase.from('events').select('config').eq('id', eventUuid).maybeSingle();
    const cfg = { ...((data?.config ?? {}) as Record<string, unknown>), moderation: next };
    const { error } = readErr ? { error: readErr } : await supabase.from('events').update({ config: cfg }).eq('id', eventUuid);
    if (error) {
      console.error('[ModerationTab] moderation mode save', error);
      setModeState(prev);
    }
    setSaving(false);
  };

  /** Approve (approved=true → beams onto the wall) or reject (hidden=true). */
  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    const patch = approve ? { approved: true } : { hidden: true };
    const { error } = await supabase.from('posts').update(patch).eq('id', id).eq('event_id', eventId);
    if (error) console.error('[ModerationTab] decide', error);
    else setPending((prev) => prev.filter((x) => x.id !== id));
    setBusyId(null);
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="shrink-0 z-20 px-6 md:px-8 pt-4 flex flex-col gap-3">
        {/* Mode toggle */}
        <div className="glass rounded-2xl border border-gold-400/10 px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/70">Moderation mode</p>
            <p className="font-sans text-[10px] text-champagne/40">
              {mode === 'pre'
                ? 'New posts wait below for your approval before they hit the wall.'
                : 'New posts hit the wall instantly; hide anything after the fact.'}
            </p>
          </div>
          <div className="glass flex rounded-full p-0.5 ml-auto" style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
            {(['post', 'pre'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                disabled={mode === null || saving}
                className={`px-3.5 py-1.5 rounded-full font-label uppercase tracking-luxe text-[10px] transition-all duration-200 ${
                  mode === m ? 'bg-foil text-noir-900 glow-accent' : 'text-champagne/60 hover:text-champagne'
                } disabled:opacity-50`}
              >
                {m === 'post' ? 'Instant' : 'Approve first'}
              </button>
            ))}
          </div>
        </div>

        {/* Pending queue — shown whenever unapproved posts exist (they can
            linger after switching back to instant mode). */}
        {pending.length > 0 && (
          <div className="glass rounded-2xl border border-amber-400/20 px-4 py-3">
            <p className="font-label uppercase tracking-luxe text-[10px] text-amber-300 mb-2">
              Awaiting approval · {pending.length}
            </p>
            <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
              {pending.map((p) => (
                <div key={p.id} className="shrink-0 w-24 flex flex-col gap-1.5">
                  {p.media_type === 'video' ? (
                    <video src={p.image_url} muted playsInline preload="metadata" className="w-24 h-32 object-cover rounded-xl" />
                  ) : (
                    <img src={p.image_url} alt={p.guest_name ?? 'Pending post'} className="w-24 h-32 object-cover rounded-xl" loading="lazy" />
                  )}
                  <p className="font-sans text-[9px] text-champagne/50 truncate">{p.guest_name ?? 'Anonymous'}</p>
                  <div className="flex gap-1">
                    <button
                      onClick={() => decide(p.id, true)}
                      disabled={busyId === p.id}
                      title="Approve — beams onto the wall"
                      className="flex-1 flex items-center justify-center py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => decide(p.id, false)}
                      disabled={busyId === p.id}
                      title="Reject (hide)"
                      className="flex-1 flex items-center justify-center py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* The existing show/hide/delete moderation grid, unchanged. */}
      <div className="flex-1 relative overflow-hidden">
        <Moderation />
      </div>
    </div>
  );
}

export default function EventStudio() {
  const { id = '' } = useParams<{ id: string }>();
  const location = useLocation();
  const validId = UUID_RE.test(id);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  // In Studio, the editor is full-bleed: StudioShell renders its OWN top bar
  // (with a back arrow that exits to the Experiences/Library surface), so the
  // event-level tab chrome + upgrade banner are hidden to avoid a double header.
  const isStudio = location.pathname.startsWith(`/host/events/${id}/studio`);
  // First-run studio tour — shown once per browser, and only when the host is
  // actually IN the Studio editor (not Dashboard/other tabs) on a non-remote
  // event; introSeenRef stops a same-mount re-open after dismiss.
  const { show: introAvailable, dismiss: dismissIntro } = useStudioOnboarding();
  const [introOpen, setIntroOpen] = useState(false);
  const introSeenRef = useRef(false);

  useEffect(() => {
    if (!introAvailable || introSeenRef.current || !isStudio) return;
    if (state.phase !== 'ready' || state.event.event_type === 'remote') return;
    introSeenRef.current = true;
    setIntroOpen(true);
  }, [introAvailable, isStudio, state]);

  useEffect(() => {
    if (!validId) return;
    let alive = true;
    setState({ phase: 'loading' });
    (async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, slug, name, status, plan_tier, event_type')
        .eq('id', id)
        .maybeSingle();
      if (!alive) return;
      if (error || !data) {
        setState({ phase: 'missing' });
        return;
      }

      const allowed = await canEnterStudio(data.slug);
      if (!alive) return;
      if (!allowed) {
        setState({ phase: 'missing' });
        return;
      }
      setState({ phase: 'ready', event: data as StudioEvent });
    })();
    return () => { alive = false; };
  }, [id, validId]);

  if (!validId || state.phase === 'missing') {
    // EventsList reads this flag and shows a "couldn't open that studio" notice.
    return <Navigate to="/host" replace state={{ studioError: true }} />;
  }
  if (state.phase === 'loading') {
    return (
      <div className="absolute inset-0 app-bg flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
      </div>
    );
  }

  const { event } = state;
  const base = `/host/events/${id}`;
  const basePath = `/e/${event.slug}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const tabs = [
    { to: base, label: 'Dashboard', icon: LayoutGrid, end: true },
    { to: `${base}/studio`, label: 'Studio', icon: Wand2, end: false },
    { to: `${base}/library`, label: 'Experiences', icon: ImageIcon, end: false },
    { to: `${base}/assets`, label: 'Assets', icon: FolderOpen, end: false },
    { to: `${base}/moderation`, label: 'Wall', icon: ShieldCheck, end: false },
    { to: `${base}/challenges`, label: 'Challenges', icon: Trophy, end: false },
    { to: `${base}/cards`, label: 'Cards', icon: Gift, end: false },
    { to: `${base}/share`, label: 'Share', icon: QrCode, end: false },
  ];
  // Settings / Branding / Manager access consolidate into ONE "Settings" tab
  // (routes stay flat — the group entry lands on /settings and a sub-row keeps
  // the two siblings one tap away while inside the group).
  const settingsTabs = [
    { to: `${base}/settings`, label: 'General', icon: Settings },
    { to: `${base}/branding`, label: 'Branding', icon: Palette },
    { to: `${base}/access`, label: 'Manager access', icon: KeyRound },
  ];
  const inSettingsGroup = settingsTabs.some((t) => location.pathname.startsWith(t.to));

  return (
    <StudioBaseContext.Provider value={base}>
      <EventProvider slug={event.slug} basePath={basePath}>
        <AnimatePresence>
          {introOpen && (
            <StudioOnboarding
              key="studio-intro"
              onDismiss={() => {
                dismissIntro();
                setIntroOpen(false);
              }}
            />
          )}
        </AnimatePresence>
        <div className="absolute inset-0 flex flex-col">
          {/* Event tab chrome — hidden inside Studio so its editor is full-bleed
              and StudioShell's own header is the only top bar. */}
          {!isStudio && (
          <nav
            className="min-h-16 shrink-0 flex items-center gap-3 px-4 liquid-glass border-b border-accent/15 z-50"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <Link
              to="/host"
              title="Back to events"
              className="p-2.5 liquid-glass rounded-lg text-brand-muted/50 hover:text-brand-fg transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0 hidden lg:block">
              <p className="font-serif italic text-sm text-brand-fg leading-tight truncate max-w-[12rem]">{event.name}</p>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] text-brand-muted/40">/e/{event.slug}</span>
                <StatusPill status={event.status} />
              </div>
            </div>
            {/* Tab scroller — horizontal scroll with soft edge fades on overflow. */}
            <div
              className="flex-1 overflow-x-auto hide-scrollbar"
              style={{
                maskImage: 'linear-gradient(to right, transparent, black 14px, black calc(100% - 14px), transparent)',
                WebkitMaskImage: 'linear-gradient(to right, transparent, black 14px, black calc(100% - 14px), transparent)',
              }}
            >
              <div className="flex items-center gap-1 min-w-max px-1">
                {tabs.map((t) => (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    end={t.end}
                    className={({ isActive }) =>
                      `flex items-center gap-1.5 px-3 md:px-3.5 py-2 min-h-10 rounded-full text-[10px] font-label uppercase tracking-widest transition-colors whitespace-nowrap ${
                        isActive ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'text-brand-muted/50 hover:text-brand-fg'
                      }`
                    }
                  >
                    <t.icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden md:inline">{t.label}</span>
                  </NavLink>
                ))}
                {/* Consolidated Settings group — active for /settings, /branding
                    and /access; the sub-row below exposes the siblings. */}
                <NavLink
                  to={`${base}/settings`}
                  className={() =>
                    `flex items-center gap-1.5 px-3 md:px-3.5 py-2 min-h-10 rounded-full text-[10px] font-label uppercase tracking-widest transition-colors whitespace-nowrap ${
                      inSettingsGroup ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'text-brand-muted/50 hover:text-brand-fg'
                    }`
                  }
                >
                  <Settings className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden md:inline">Settings</span>
                </NavLink>
              </div>
            </div>
            <button
              onClick={() => useCopilotStore.getState().open()}
              title="Beamwall Copilot"
              aria-label="Open the Beamwall Copilot"
              className="shrink-0 w-8 h-8 rounded-full bg-foil glow-accent flex items-center justify-center text-noir-900 active:scale-95 transition-transform"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <GuestLinkCopy url={`${origin}${basePath}/welcome`} />
          </nav>
          )}

          {/* Settings group sub-nav — the consolidated tab's three flat routes,
              one tap apart. Labels always visible (only three entries). */}
          {!isStudio && inSettingsGroup && (
          <div className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 border-b border-white/10 bg-white/[0.02] overflow-x-auto hide-scrollbar z-40">
            {settingsTabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-2 min-h-10 rounded-full text-[10px] font-label uppercase tracking-widest transition-colors whitespace-nowrap ${
                    isActive ? 'bg-white/[0.07] text-brand-fg ring-1 ring-white/15' : 'text-brand-muted/50 hover:text-brand-fg'
                  }`
                }
              >
                <t.icon className="w-3.5 h-3.5 shrink-0" />
                <span>{t.label}</span>
              </NavLink>
            ))}
          </div>
          )}

          {/* Plan tier banner — compact upsell for non-deluxe events (hidden in Studio) */}
          {!isStudio && <UpgradeCard eventUuid={event.id} planTier={event.plan_tier} />}

          <main className="flex-1 relative overflow-hidden">
            <Routes>
              {/* Remote celebrations live in the Cards tab — make it home. */}
              <Route
                index
                element={event.event_type === 'remote' ? <Navigate to={`${base}/cards`} replace /> : <Dashboard />}
              />
              <Route path="library" element={<Library />} />
              <Route path="assets" element={<Assets />} />
              <Route path="studio" element={<StudioShell />} />
              {/* Retired creator tabs → unified studio (keep ?id= deep links). */}
              <Route path="creator" element={<StudioRedirect to={`${base}/studio`} />} />
              <Route path="creator3d" element={<StudioRedirect to={`${base}/studio`} />} />
              <Route path="moderation" element={<ModerationTab eventUuid={event.id} />} />
              <Route path="challenges" element={<Challenges />} />
              <Route path="cards" element={<CardsTab />} />
              <Route path="share" element={<ShareKit />} />
              <Route path="branding" element={<Branding />} />
              <Route path="settings" element={<SettingsScreen />} />
              <Route path="access" element={<ManagerAccess eventUuid={event.id} />} />
              <Route path="*" element={<Navigate to="." replace />} />
            </Routes>
          </main>
        </div>
      </EventProvider>
    </StudioBaseContext.Provider>
  );
}
