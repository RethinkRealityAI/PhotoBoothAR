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
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, Copy, FolderOpen, Gift, Image as ImageIcon, KeyRound,
  LayoutGrid, Palette, QrCode, Settings, ShieldCheck, Sparkles, Trophy, Wand2,
} from 'lucide-react';
import { useCopilotStore } from '../../lib/copilotStore';
import { supabase } from '../../lib/supabase';
import { canEnterStudio } from '../../lib/host';
import EventProvider from '../../events/EventContext';
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

export default function EventStudio() {
  const { id = '' } = useParams<{ id: string }>();
  const location = useLocation();
  const validId = UUID_RE.test(id);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  // First-run studio tour — shown once per browser, on the first studio entry.
  const { show: showIntro, dismiss: dismissIntro } = useStudioOnboarding();
  const [introOpen, setIntroOpen] = useState(showIntro);

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
    return <Navigate to="/host" replace />;
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
  // In Studio, the editor is full-bleed: StudioShell renders its OWN top bar
  // (with a back arrow that exits to the Experiences/Library surface), so the
  // event-level tab chrome + upgrade banner are hidden to avoid a double header.
  const isStudio = location.pathname.startsWith(`${base}/studio`);

  const tabs = [
    { to: base, label: 'Dashboard', icon: LayoutGrid, end: true },
    { to: `${base}/studio`, label: 'Studio', icon: Wand2, end: false },
    { to: `${base}/library`, label: 'Experiences', icon: ImageIcon, end: false },
    { to: `${base}/assets`, label: 'Assets', icon: FolderOpen, end: false },
    { to: `${base}/moderation`, label: 'Wall', icon: ShieldCheck, end: false },
    { to: `${base}/challenges`, label: 'Challenges', icon: Trophy, end: false },
    { to: `${base}/cards`, label: 'Cards', icon: Gift, end: false },
    { to: `${base}/share`, label: 'Share', icon: QrCode, end: false },
    { to: `${base}/branding`, label: 'Branding', icon: Palette, end: false },
    { to: `${base}/settings`, label: 'Settings', icon: Settings, end: false },
    { to: `${base}/access`, label: 'Manager access', icon: KeyRound, end: false },
  ];

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
          <nav className="h-16 shrink-0 flex items-center gap-3 px-4 liquid-glass border-b border-accent/15 z-50">
            <Link
              to="/host"
              title="Back to events"
              className="p-1.5 liquid-glass rounded-lg text-brand-muted/50 hover:text-brand-fg transition-colors shrink-0"
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
            <div className="flex-1 overflow-x-auto hide-scrollbar">
              <div className="flex items-center gap-1 min-w-max">
                {tabs.map((t) => (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    end={t.end}
                    className={({ isActive }) =>
                      `flex items-center gap-1.5 px-2.5 md:px-3.5 py-2 rounded-full text-[10px] font-label uppercase tracking-widest transition-colors whitespace-nowrap ${
                        isActive ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'text-brand-muted/50 hover:text-brand-fg'
                      }`
                    }
                  >
                    <t.icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden md:inline">{t.label}</span>
                  </NavLink>
                ))}
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
            <GuestLinkCopy url={`${origin}${basePath}`} />
          </nav>
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
              <Route path="moderation" element={<Moderation />} />
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
