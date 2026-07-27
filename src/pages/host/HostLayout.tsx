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
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CalendarRange, Coins, CreditCard, LifeBuoy, LogOut, Sparkles } from 'lucide-react';
import { useSession, signOut } from '../../lib/auth';
import { fetchMyOrg, fetchCreditBalance } from '../../lib/host';
import { fetchMyUnreadCount } from '../../lib/support';
import { usePageTitle } from '../../lib/usePageTitle';
import { haptic } from '../../lib/haptics';
import { useAiJobSweep } from '../../lib/useAiJobSweep';

export default function HostLayout() {
  // Layout-level title for every /host screen. NOTE: a child page adopting
  // usePageTitle would NOT reliably override this — child effects run before
  // parent effects on mount, so the layout's title wins on a cold load. If
  // per-page /host titles are ever wanted, set them from this layout (e.g.
  // route-keyed), not from the children.
  usePageTitle('Host studio — Beamwall');
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const { pathname } = useLocation();

  // Re-checked on every /host navigation rather than by a timer or a realtime
  // channel: a support reply is not time-critical to the second, and a poll
  // that runs while nobody is looking is a cost with no reader.
  useEffect(() => {
    if (!session) { setUnread(0); return; }
    let alive = true;
    fetchMyUnreadCount().then((n) => { if (alive) setUnread(n); });
    return () => { alive = false; };
  }, [session, pathname]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    fetchMyOrg().then(async (org) => {
      if (!alive || !org) return;
      setOrgName(org.name);
      setOrgId(org.orgId);
      const balance = await fetchCreditBalance(org.orgId);
      if (alive) setCredits(balance);
    });
    return () => { alive = false; };
  }, [session]);

  // Finish off AI jobs whose watcher is long gone. Nothing else polls ai_jobs,
  // so without this a 3D model the host paid for and navigated away from is
  // complete at Meshy and never becomes an experience — and Meshy deletes it
  // after three days. Silent by design; a refunded job also settles here, so
  // the balance is re-read whenever anything resolves.
  useAiJobSweep(orgId, () => {
    if (!orgId) return;
    void fetchCreditBalance(orgId).then((b) => setCredits(b));
  });

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
    'pressable flex items-center gap-2.5 rounded-xl px-3 md:px-3.5 py-2.5 min-h-11 min-w-11 font-label uppercase tracking-luxe text-[10px] transition-colors justify-center md:justify-start';
  const railState = (isActive: boolean) =>
    isActive ? 'bg-white/[0.10] text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.05]';

  return (
    <div className="absolute inset-0 app-bg text-brand-fg flex flex-col md:flex-row overflow-hidden">
      {/* Floating rail — inset from the window edge with its own rounding,
          bevel and drop shadow, so it lifts off the canvas instead of reading
          as a wall bolted to the side. Matches the guest surface's floating
          pill on mobile. */}
      <aside
        className="liquid-glass-raised shrink-0 z-20 md:w-60 flex md:flex-col items-center md:items-stretch gap-2 md:gap-1
                   m-2 md:my-3 md:ml-3 md:mr-0 rounded-2xl px-3 md:px-4 pb-2 md:pb-4 md:pt-6"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.5rem)' }}
      >
        <Link
          to="/host"
          className="font-serif text-xl md:text-2xl font-semibold tracking-wide text-foil-static md:mb-0.5 md:px-2 shrink-0 flex items-center min-h-11"
        >
          Beamwall
        </Link>
        {orgName && (
          <p className="hidden md:block px-2 pb-5 font-sans text-[11px] text-brand-muted/60 truncate">{orgName}</p>
        )}

        {/* Primary destinations — icon + label rows in the sidebar; icon-first
            (labels from sm) on the mobile top bar. */}
        <nav className="flex md:flex-col gap-1 md:gap-1.5 items-center md:items-stretch ml-auto md:ml-0 md:flex-1 md:min-h-0">
          <NavLink to="/host" end onClick={() => haptic('tap')} aria-label="Events" className={({ isActive }) => `${railLink} ${railState(isActive)}`}>
            <CalendarRange className="w-[18px] h-[18px] shrink-0" />
            <span className="hidden sm:inline">Events</span>
          </NavLink>

          <NavLink to="/host/concierge" onClick={() => haptic('tap')} aria-label="Concierge" className={({ isActive }) => `${railLink} ${railState(isActive)}`}>
            <Sparkles className="w-[18px] h-[18px] shrink-0 text-[color:var(--color-accent)]" />
            <span className="hidden sm:inline">Concierge</span>
          </NavLink>

          <NavLink to="/host/billing" onClick={() => haptic('tap')} aria-label="Billing" className={({ isActive }) => `${railLink} ${railState(isActive)}`}>
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
                onClick={() => haptic('tap')}
                className="pressable liquid-glass-inset hidden md:flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 min-h-11 text-brand-muted/80 hover:text-brand-fg transition-colors"
              >
                <Coins className="w-[18px] h-[18px] shrink-0 text-[color:var(--color-accent)]" />
                <span className="font-label uppercase tracking-luxe text-[10px]">
                  {credits} credit{credits === 1 ? '' : 's'}
                </span>
              </Link>
            )}
            {/* Was a mailto: into a personal inbox — no ticket, no status, no
                record. Now a real thread the customer can come back to. */}
            <NavLink
              to="/host/support"
              onClick={() => haptic('tap')}
              aria-label="Support"
              className={({ isActive }) => `${railLink} ${railState(isActive)} relative`}
            >
              <span className="relative shrink-0">
                <LifeBuoy className="w-[18px] h-[18px]" />
                {unread > 0 && (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[color:var(--color-accent)] ring-2 ring-[color:var(--color-brand-bg)]"
                  />
                )}
              </span>
              <span className="hidden sm:inline">
                Support
                {unread > 0 && <span className="ml-1.5 text-[color:var(--color-accent)]">{unread}</span>}
              </span>
            </NavLink>
            <button onClick={handleSignOut} aria-label="Sign out" className={`${railLink} ${railState(false)}`}>
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
