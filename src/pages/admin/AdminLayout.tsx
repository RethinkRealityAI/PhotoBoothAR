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
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, CalendarRange, Receipt, Coins, Users, ScrollText, ShieldCheck,
  LifeBuoy, Tags, ToggleLeft, Megaphone, LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useSession, signOut } from '../../lib/auth';
import { checkIsPlatformAdmin } from '../../lib/admin';
import { adminSupportCounts } from '../../lib/support';
import { ToastProvider } from '../../components/ui/Toast';
import { haptic } from '../../lib/haptics';

interface NavItem { to: string; end?: boolean; label: string; Icon: LucideIcon; ready: boolean }

// The full suite structure; `ready` flips true as each phase lands so the rail
// never shows a link to a route that doesn't exist yet.
const NAV: NavItem[] = [
  { to: '/admin', end: true, label: 'Overview', Icon: LayoutDashboard, ready: true },
  { to: '/admin/customers', label: 'Customers', Icon: Building2, ready: true },
  { to: '/admin/events', label: 'Events', Icon: CalendarRange, ready: true },
  { to: '/admin/support', label: 'Support', Icon: LifeBuoy, ready: true },
  { to: '/admin/payments', label: 'Payments', Icon: Receipt, ready: true },
  { to: '/admin/catalog', label: 'Catalog', Icon: Tags, ready: true },
  { to: '/admin/features', label: 'Features', Icon: ToggleLeft, ready: true },
  { to: '/admin/landing', label: 'Landing', Icon: Megaphone, ready: true },
  { to: '/admin/credits', label: 'Credits', Icon: Coins, ready: true },
  { to: '/admin/users', label: 'Users', Icon: Users, ready: true },
  { to: '/admin/audit', label: 'Audit', Icon: ScrollText, ready: true },
  { to: '/admin/admins', label: 'Admins', Icon: ShieldCheck, ready: true },
];

function Spinner() {
  return (
    <div className="absolute inset-0 app-bg flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [adminState, setAdminState] = useState<'checking' | 'yes' | 'no'>('checking');
  const [unread, setUnread] = useState(0);

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

  const railLink =
    'pressable flex items-center gap-2.5 rounded-xl px-3.5 min-h-11 min-w-11 font-label uppercase tracking-luxe text-[10px] transition-colors shrink-0';

  return (
    <div className="absolute inset-0 app-bg text-brand-fg flex flex-col md:flex-row overflow-hidden md:gap-0">
      {/* Floating rail: inset from the window edge with its own rounding,
          bevel and shadow, so it reads as a panel resting on the canvas rather
          than a wall bolted to the side. Below md it becomes a scrollable
          strip — nine destinations in a non-wrapping row inside an
          overflow-hidden parent used to clip Audit, Admins and Sign out
          entirely at 390px, with no way to reach them. */}
      {/* On a phone this rail is the TOP strip, so it sits under the status bar
          / notch without a safe-area inset. Composed via --safe-top so the 8px
          design padding survives on a device with no inset at all. */}
      <aside
        className="liquid-glass-raised shrink-0 z-20 flex md:flex-col items-center md:items-stretch gap-1
                   m-2 md:my-3 md:ml-3 md:mr-0 md:w-56 rounded-2xl px-3 pb-2 md:px-3 md:pb-5
                   pt-safe-top [--safe-top:0.5rem] md:[--safe-top:1.25rem]
                   overflow-x-auto md:overflow-x-visible hide-scrollbar"
      >
        <Link
          to="/admin"
          onClick={() => haptic('tap')}
          className="font-serif text-lg md:text-2xl font-semibold tracking-wide text-foil-static md:px-2 shrink-0 flex items-center min-h-11"
        >
          Beamwall
        </Link>
        <p className="hidden md:block px-2 pb-4 font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">
          Platform admin
        </p>

        <div className="flex md:flex-col gap-1 md:flex-1 items-center md:items-stretch ml-auto md:ml-0">
          {NAV.filter((n) => n.ready).map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => haptic('tap')}
              aria-label={label}
              title={label}
              className={({ isActive }) =>
                `${railLink} ${isActive ? 'bg-white/[0.10] text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.05]'}`
              }
            >
              <span className="relative shrink-0">
                <Icon className="w-4 h-4" />
                {to === '/admin/support' && unread > 0 && (
                  <span
                    aria-hidden
                    className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[color:var(--color-accent)] ring-2 ring-[color:var(--color-brand-bg)]"
                  />
                )}
              </span>
              <span className="hidden sm:inline">
                {label}
                {to === '/admin/support' && unread > 0 && (
                  <span className="ml-1.5 text-[color:var(--color-accent)]">{unread}</span>
                )}
              </span>
            </NavLink>
          ))}

          <button
            onClick={handleSignOut}
            aria-label="Sign out"
            title="Sign out"
            className={`${railLink} text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.05] md:mt-auto`}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 relative overflow-y-auto">
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </main>
    </div>
  );
}
