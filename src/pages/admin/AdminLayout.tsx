/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform super-admin shell for /admin. Distinct from the per-event host
 * studio: NOT wrapped in an EventProvider (so it renders in the default
 * black/beam-blue platform theme via the semantic utilities), and gated on a THREE-state
 * check — session loading → spinner; no session → /login; signed in but not a
 * platform admin → bounced to /host. The client gate is UX only; admin-api
 * re-checks on every request.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, CalendarRange, Receipt, Coins, Users, ScrollText, ShieldCheck, QrCode,
  LifeBuoy, Tags, ToggleLeft, Megaphone, LogOut, BookImage, House, Sparkles, Menu, X,
  type LucideIcon,
} from 'lucide-react';
import { useSession, signOut } from '../../lib/auth';
import { checkIsPlatformAdmin } from '../../lib/admin';
import { adminSupportCounts } from '../../lib/support';
import { ToastProvider } from '../../components/ui/Toast';
import Tooltip from '../../components/ui/Tooltip';
import RailToggle from '../../components/ui/RailToggle';
import { useRailCollapsed } from '../../lib/useRailCollapsed';
import { haptic } from '../../lib/haptics';
import { useDialog } from '../../lib/useDialog';
import { ADMIN_NAV_GROUPS, currentAdminNav, type AdminNavEntry, type AdminNavId } from './adminNav';

const ICONS: Record<AdminNavId, LucideIcon> = {
  overview: LayoutDashboard,
  customers: Building2,
  events: CalendarRange,
  support: LifeBuoy,
  payments: Receipt,
  catalog: Tags,
  credits: Coins,
  library: BookImage,
  'home-assets': House,
  landing: Megaphone,
  reveals: Sparkles,
  'qr-cards': QrCode,
  features: ToggleLeft,
  users: Users,
  audit: ScrollText,
  admins: ShieldCheck,
};

// 44px rows for touch; a mouse-driven desktop rail packs to 40px so all
// fifteen fit a 900px laptop without scrolling.
const railLink =
  'pressable flex items-center gap-2.5 rounded-xl px-3 min-h-11 md:min-h-10 font-sans text-[13px] transition-colors shrink-0';
const groupLabel = 'px-3 pt-3 pb-1 font-sans text-[10px] font-medium tracking-wide text-brand-muted/60';

/** One labelled rail link. Shared by the desktop rail and the phone menu.
 *  `collapsed` (desktop rail only): icon alone, centred, named by a tooltip
 *  and its aria-label; the unread count becomes a dot on the icon. */
function RailItem({ item, unread, onPick, collapsed = false }: { item: AdminNavEntry; unread: number; onPick?: () => void; collapsed?: boolean }) {
  const Icon = ICONS[item.id];
  const showUnread = item.id === 'support' && unread > 0;
  if (collapsed) {
    return (
      <Tooltip label={showUnread ? `${item.label} · ${unread} unread` : item.label} side="right">
        <NavLink
          to={item.to}
          end={item.end}
          aria-label={showUnread ? `${item.label}, ${unread} unread` : item.label}
          onClick={() => { haptic('tap'); onPick?.(); }}
          className={({ isActive }) =>
            `${railLink} justify-center ${isActive ? 'is-selected bg-white/[0.10] text-brand-fg' : 'text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.05]'}`
          }
        >
          <span className="relative">
            <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden />
            {showUnread && (
              <span aria-hidden className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[color:var(--color-accent)] ring-2 ring-[color:var(--color-brand-bg)]" />
            )}
          </span>
        </NavLink>
      </Tooltip>
    );
  }
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={() => { haptic('tap'); onPick?.(); }}
      className={({ isActive }) =>
        `${railLink} ${isActive ? 'is-selected bg-white/[0.10] text-brand-fg' : 'text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.05]'}`
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{item.label}</span>
      {showUnread && (
        <span
          className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-[color:var(--color-accent)] text-[10px] font-semibold leading-5 text-center text-[color:var(--on-accent)] tabular-nums"
          aria-label={`${unread} unread`}
        >
          {unread}
        </span>
      )}
    </NavLink>
  );
}

/** Phone: every destination, labelled and grouped, one tap from anywhere.
 *  The old phone rail was fifteen bare icons in a sideways strip that clipped
 *  mid-icon, with no hint it scrolled and no names to read. */
function MobileMenu({ unread, onClose, onSignOut }: { unread: number; onClose: () => void; onSignOut: () => void }) {
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, 'Admin menu');
  return (
    <div className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={panelRef}
        {...dialogProps}
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-raised absolute inset-x-2 top-2 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-2xl p-3 pt-safe-top [--safe-top:0.75rem] outline-none"
      >
        <div className="flex items-center justify-between px-1 pb-1">
          <p className="font-serif text-lg font-semibold text-foil-static">Beamwall admin</p>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="pressable grid place-items-center w-11 h-11 rounded-xl text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.06]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav aria-label="Admin">
          {ADMIN_NAV_GROUPS.map((g) => (
            <div key={g.label}>
              <p className={groupLabel}>{g.label}</p>
              <div className="grid grid-cols-2 gap-1">
                {g.items.map((item) => <RailItem key={item.to} item={item} unread={unread} onPick={onClose} />)}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-3 border-t border-white/10 pt-2">
          <button onClick={onSignOut} className={`${railLink} w-full text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.05]`}>
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div data-surface="night" className="absolute inset-0 app-bg flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { session, loading } = useSession();
  const [adminState, setAdminState] = useState<'checking' | 'yes' | 'no'>('checking');
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Desktop rail only; the phone keeps its top bar + labelled menu. */
  const rail = useRailCollapsed('admin');
  const c = rail.collapsed;

  // A route change (a link, back/forward) always lands with the menu shut.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Only once the admin check has passed — support_api would 403 otherwise, and
  // a console full of 403s on every non-admin page load is its own bug report.
  useEffect(() => {
    if (adminState !== 'yes') { setUnread(0); return; }
    let alive = true;
    adminSupportCounts().then(({ data }) => {
      if (alive && data !== null) setUnread(data.unread);
    });
    return () => { alive = false; };
  }, [adminState]);

  useEffect(() => {
    if (loading) return;
    if (!session) { setAdminState('no'); return; }
    let alive = true;
    setAdminState('checking');
    checkIsPlatformAdmin().then((ok) => { if (alive) setAdminState(ok ? 'yes' : 'no'); });
    return () => { alive = false; };
  }, [session, loading]);

  if (loading || (session && adminState === 'checking')) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (adminState !== 'yes') return <Navigate to="/host" replace />;

  const handleSignOut = async () => { await signOut(); navigate('/'); };
  const here = currentAdminNav(pathname);

  return (
    <div data-surface="night" className="absolute inset-0 app-bg text-brand-fg flex flex-col md:flex-row overflow-hidden md:gap-0">
      {/* Phone: a slim top bar saying where you are, with the whole suite one
          tap away in a labelled menu. It sits under the status bar / notch, so
          it pads by --safe-top (8px on a device with no inset). */}
      <header
        className="md:hidden liquid-glass-raised shrink-0 z-20 m-2 rounded-2xl flex items-center gap-2 pl-4 pr-1.5 pb-1.5 pt-safe-top [--safe-top:0.375rem]"
      >
        <Link to="/admin" onClick={() => haptic('tap')} className="font-serif text-lg font-semibold text-foil-static min-h-11 flex items-center shrink-0">
          Beamwall
        </Link>
        {here && (
          <p className="min-w-0 truncate font-sans text-[13px] text-brand-muted/80">
            <span aria-hidden className="mr-2 text-brand-muted/40">/</span>{here.label}
          </p>
        )}
        <button
          onClick={() => { haptic('tap'); setMenuOpen(true); }}
          aria-label={unread > 0 ? `Menu, ${unread} unread support` : 'Menu'}
          aria-expanded={menuOpen}
          className="pressable relative ml-auto grid place-items-center w-11 h-11 rounded-xl text-brand-fg hover:bg-white/[0.06]"
        >
          <Menu className="w-5 h-5" />
          {unread > 0 && (
            <span aria-hidden className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[color:var(--color-accent)] ring-2 ring-[color:var(--color-brand-bg)]" />
          )}
        </button>
      </header>
      {menuOpen && <MobileMenu unread={unread} onClose={() => setMenuOpen(false)} onSignOut={handleSignOut} />}

      {/* Desktop: a floating rail inset from the window edge, so it reads as a
          panel resting on the canvas. The destinations sit in four named
          groups and scroll on their own, so a short laptop screen never clips
          Admins or Sign out. */}
      <aside
        id="admin-rail"
        className={`hidden md:flex liquid-glass-raised shrink-0 z-20 flex-col my-3 ml-3 rounded-2xl pb-3 pt-5 min-h-0 transition-[width] duration-200 motion-reduce:transition-none ${c ? 'w-[4.75rem] px-2' : 'w-60 px-3'}`}
      >
        <div className={`flex items-center gap-1 shrink-0 ${c ? 'flex-col' : 'justify-between'}`}>
          <Link
            to="/admin"
            onClick={() => haptic('tap')}
            aria-label="Beamwall admin overview"
            className={`font-serif text-2xl font-semibold text-foil-static shrink-0 flex items-center min-h-11 ${c ? 'justify-center' : 'px-3'}`}
          >
            {c ? <span aria-hidden>B</span> : 'Beamwall'}
          </Link>
          <RailToggle collapsed={c} onToggle={rail.toggle} label="menu" controls="admin-rail" />
        </div>
        {!c && <p className="px-3 font-sans text-[11px] text-brand-muted/60">Platform admin</p>}

        <nav aria-label="Admin" className="mt-1 flex-1 min-h-0 overflow-y-auto hide-scrollbar -mx-1 px-1 pb-2">
          {ADMIN_NAV_GROUPS.map((g, i) => (
            <div key={g.label} role={c ? 'group' : undefined} aria-label={c ? g.label : undefined}>
              {/* Collapsed, a group's name becomes a hairline: the icons stay
                  grouped without ten-pixel text squeezed into 76px. */}
              {c ? (
                i > 0 && <div aria-hidden className="mx-2 my-2 h-px bg-white/10" />
              ) : (
                <p className={groupLabel}>{g.label}</p>
              )}
              <div className="flex flex-col">
                {g.items.map((item) => <RailItem key={item.to} item={item} unread={unread} collapsed={c} />)}
              </div>
            </div>
          ))}
        </nav>

        <Tooltip label="Sign out" side="right" disabled={!c}>
          <button
            onClick={handleSignOut}
            aria-label={c ? 'Sign out' : undefined}
            className={`${railLink} border-t border-white/10 rounded-t-none pt-1 text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.05] ${c ? 'justify-center' : ''}`}
          >
            <LogOut className={c ? 'w-[18px] h-[18px] shrink-0' : 'w-4 h-4 shrink-0'} />
            {!c && 'Sign out'}
          </button>
        </Tooltip>
      </aside>

      <main className="flex-1 relative overflow-y-auto">
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </main>
    </div>
  );
}
