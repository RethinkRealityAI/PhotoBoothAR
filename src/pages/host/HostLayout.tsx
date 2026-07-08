/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Session-gated platform shell for /host: Beamwall wordmark, left rail
 * (collapsing to a top bar on mobile) with Events / Billing / Sign out,
 * content via <Outlet />.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { CalendarRange, CreditCard, LogOut, Sparkles } from 'lucide-react';
import { useSession, signOut } from '../../lib/auth';
import { fetchMyOrg, fetchCreditBalance } from '../../lib/host';

export default function HostLayout() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    fetchMyOrg().then(async (org) => {
      if (!alive || !org) return;
      setOrgName(org.name);
      const balance = await fetchCreditBalance(org.orgId);
      if (alive) setCredits(balance);
    });
    return () => { alive = false; };
  }, [session]);

  if (loading) {
    return (
      <div className="absolute inset-0 app-bg flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const railLink =
    'flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 font-label uppercase tracking-luxe text-[10px] transition-colors';

  return (
    <div className="absolute inset-0 app-bg text-brand-fg flex flex-col md:flex-row overflow-hidden">
      {/* Rail (top bar on mobile) */}
      <aside className="shrink-0 md:w-56 flex md:flex-col items-center md:items-stretch gap-2 md:gap-1 px-4 py-3 md:py-6 border-b md:border-b-0 md:border-r border-white/10">
        <Link
          to="/host"
          className="font-serif text-xl md:text-2xl font-semibold tracking-wide text-foil-static md:mb-1 md:px-2"
        >
          Beamwall
        </Link>
        {orgName && (
          <p className="hidden md:block px-2 pb-4 font-sans text-[11px] text-brand-muted/60 truncate">{orgName}</p>
        )}

        <div className="flex md:flex-col gap-1 flex-1 md:flex-none items-center md:items-stretch ml-auto md:ml-0">
          <NavLink
            to="/host"
            end
            className={({ isActive }) =>
              `${railLink} ${isActive ? 'bg-white/[0.08] text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.04]'}`
            }
          >
            <CalendarRange className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Events</span>
          </NavLink>

          <NavLink
            to="/host/billing"
            className={({ isActive }) =>
              `${railLink} ${isActive ? 'bg-white/[0.08] text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.04]'}`
            }
          >
            <CreditCard className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">
              Billing
              {credits !== null && <span className="ml-1.5 text-brand-muted/60">· {credits} cr</span>}
            </span>
          </NavLink>

          <NavLink
            to="/host/concierge"
            className={({ isActive }) =>
              `${railLink} ${isActive ? 'bg-white/[0.08] text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.04]'}`
            }
          >
            <Sparkles className="w-4 h-4 shrink-0 text-[color:var(--color-accent)]" />
            <span className="hidden sm:inline">Concierge</span>
          </NavLink>

          <button onClick={handleSignOut} className={`${railLink} text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.04] md:mt-auto`}>
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 relative overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
