/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Session-gated platform shell for /host: Beamwall wordmark, slim liquid-glass
 * left sidebar at md+ (icon + label rows; credits pill + sign-out pinned to the
 * bottom account cluster) collapsing to a compact top bar on mobile, content
 * via <Outlet />.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { CalendarRange, Coins, CreditCard, LifeBuoy, LogOut, Sparkles } from 'lucide-react';
import { useSession, signOut } from '../../lib/auth';
import { fetchMyOrg, fetchCreditBalance } from '../../lib/host';
import { SUPPORT_EMAIL } from '../../lib/errorReport';
import { usePageTitle } from '../../lib/usePageTitle';

export default function HostLayout() {
  // Layout-level default for every /host screen (child pages may override).
  usePageTitle('Host studio — Beamwall');
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

  // Sidebar rows at md+; ≥44px-tall tap targets on the mobile top bar too.
  const railLink =
    'flex items-center gap-2.5 rounded-xl px-3 md:px-3.5 py-2.5 min-h-11 font-label uppercase tracking-luxe text-[10px] transition-colors justify-center md:justify-start';
  const railState = (isActive: boolean) =>
    isActive ? 'bg-white/[0.08] text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.04]';

  return (
    <div className="absolute inset-0 app-bg text-brand-fg flex flex-col md:flex-row overflow-hidden">
      {/* Nav — slim liquid-glass left sidebar at md+; compact top bar below md. */}
      <aside
        className="shrink-0 md:w-60 flex md:flex-col items-center md:items-stretch gap-2 md:gap-1 px-3 md:px-4 pb-2 md:pb-4 md:pt-6 liquid-glass border-b md:border-b-0 md:border-r border-white/10"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.5rem)' }}
      >
        <Link
          to="/host"
          className="font-serif text-xl md:text-2xl font-semibold tracking-wide text-foil-static md:mb-0.5 md:px-2 shrink-0"
        >
          Beamwall
        </Link>
        {orgName && (
          <p className="hidden md:block px-2 pb-5 font-sans text-[11px] text-brand-muted/60 truncate">{orgName}</p>
        )}

        {/* Primary destinations — icon + label rows in the sidebar; icon-first
            (labels from sm) on the mobile top bar. */}
        <nav className="flex md:flex-col gap-1 md:gap-1.5 items-center md:items-stretch ml-auto md:ml-0 md:flex-1 md:min-h-0">
          <NavLink to="/host" end className={({ isActive }) => `${railLink} ${railState(isActive)}`}>
            <CalendarRange className="w-[18px] h-[18px] shrink-0" />
            <span className="hidden sm:inline">Events</span>
          </NavLink>

          <NavLink to="/host/concierge" className={({ isActive }) => `${railLink} ${railState(isActive)}`}>
            <Sparkles className="w-[18px] h-[18px] shrink-0 text-[color:var(--color-accent)]" />
            <span className="hidden sm:inline">Concierge</span>
          </NavLink>

          <NavLink to="/host/billing" className={({ isActive }) => `${railLink} ${railState(isActive)}`}>
            <CreditCard className="w-[18px] h-[18px] shrink-0" />
            <span className="hidden sm:inline">
              Billing
              {/* Mobile keeps the inline credit hint; the sidebar shows the
                  dedicated pill in the account cluster below instead. */}
              {credits !== null && <span className="md:hidden ml-1.5 text-brand-muted/60">· {credits} cr</span>}
            </span>
          </NavLink>

          {/* Account cluster — pinned to the sidebar bottom at md+. */}
          <div className="contents md:flex md:flex-col md:gap-1.5 md:mt-auto md:pt-4 md:border-t md:border-white/10">
            {credits !== null && (
              <Link
                to="/host/billing"
                title="Credit balance — top up in Billing"
                className="hidden md:flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 bg-white/[0.04] text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.07] transition-colors"
              >
                <Coins className="w-[18px] h-[18px] shrink-0 text-[color:var(--color-accent)]" />
                <span className="font-label uppercase tracking-luxe text-[10px]">
                  {credits} credit{credits === 1 ? '' : 's'}
                </span>
              </Link>
            )}
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Beamwall support')}`}
              className={`${railLink} ${railState(false)}`}
            >
              <LifeBuoy className="w-[18px] h-[18px] shrink-0" />
              <span className="hidden sm:inline">Support</span>
            </a>
            <button onClick={handleSignOut} className={`${railLink} ${railState(false)}`}>
              <LogOut className="w-[18px] h-[18px] shrink-0" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 relative overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
