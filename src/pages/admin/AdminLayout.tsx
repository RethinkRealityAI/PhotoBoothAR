/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform super-admin shell for /admin. Distinct from the per-event host
 * studio: NOT wrapped in an EventProvider (so it renders in the default
 * champagne-gold theme via the semantic utilities), and gated on a THREE-state
 * check — session loading → spinner; no session → /login; signed in but not a
 * platform admin → bounced to /host. The client gate is UX only; admin-api
 * re-checks on every request.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, CalendarRange, Receipt, Users, ScrollText, ShieldCheck, LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useSession, signOut } from '../../lib/auth';
import { checkIsPlatformAdmin } from '../../lib/admin';
import { ToastProvider } from '../../components/ui/Toast';

interface NavItem { to: string; end?: boolean; label: string; Icon: LucideIcon; ready: boolean }

// The full suite structure; `ready` flips true as each phase lands so the rail
// never shows a link to a route that doesn't exist yet.
const NAV: NavItem[] = [
  { to: '/admin', end: true, label: 'Overview', Icon: LayoutDashboard, ready: true },
  { to: '/admin/customers', label: 'Customers', Icon: Building2, ready: true },
  { to: '/admin/events', label: 'Events', Icon: CalendarRange, ready: true },
  { to: '/admin/payments', label: 'Payments', Icon: Receipt, ready: true },
  { to: '/admin/users', label: 'Users', Icon: Users, ready: true },
  { to: '/admin/audit', label: 'Audit', Icon: ScrollText, ready: false },
  { to: '/admin/admins', label: 'Admins', Icon: ShieldCheck, ready: false },
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
    'flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 font-label uppercase tracking-luxe text-[10px] transition-colors';

  return (
    <div className="absolute inset-0 app-bg text-brand-fg flex flex-col md:flex-row overflow-hidden">
      <aside className="shrink-0 md:w-56 flex md:flex-col items-center md:items-stretch gap-2 md:gap-1 px-4 py-3 md:py-6 border-b md:border-b-0 md:border-r border-white/10">
        <Link to="/admin" className="font-serif text-xl md:text-2xl font-semibold tracking-wide text-foil-static md:px-2">
          Beamwall
        </Link>
        <p className="hidden md:block px-2 pb-4 font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">
          Platform admin
        </p>

        <div className="flex md:flex-col gap-1 flex-1 md:flex-none items-center md:items-stretch ml-auto md:ml-0">
          {NAV.filter((n) => n.ready).map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `${railLink} ${isActive ? 'bg-white/[0.08] text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.04]'}`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}

          <button onClick={handleSignOut} className={`${railLink} text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.04] md:mt-auto`}>
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
