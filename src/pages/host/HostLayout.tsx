/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Session-gated platform shell for /host: Beamwall wordmark, slim liquid-glass
 * left sidebar at md+ (icon + label rows; credits pill + sign-out pinned to the
 * bottom account cluster) collapsing to a compact top bar on mobile, content
 * via <Outlet />. At md+ the sidebar can fold to an icon column with tooltips
 * (RailToggle + useRailCollapsed, remembered per browser).
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ALargeSmall, BookOpen, CalendarRange, Coins, CreditCard, LifeBuoy, LogOut, MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import { useSession, signOut } from '../../lib/auth';
import { fetchMyOrg, fetchCreditBalance } from '../../lib/host';
import { fetchMyUnreadCount } from '../../lib/support';
import { usePageTitle } from '../../lib/usePageTitle';
import { haptic } from '../../lib/haptics';
import { readTextSize, writeTextSize, type TextSize, type TextSizeStore } from '../../lib/textSize';
import { useAiJobSweep } from '../../lib/useAiJobSweep';
import { ToastProvider } from '../../components/ui/Toast';
import Tooltip from '../../components/ui/Tooltip';
import RailToggle from '../../components/ui/RailToggle';
import { useRailCollapsed } from '../../lib/useRailCollapsed';
import ConfirmModal from '../../components/ui/ConfirmModal';

/** Per-path /host titles, set from the layout: a child page adopting
 *  usePageTitle would NOT reliably override the layout's — child effects run
 *  before parent effects on mount, so the layout's title wins on a cold load.
 *  Route-keyed here instead, exactly as the old comment prescribed. */
function hostTitle(pathname: string): string {
  if (pathname === '/host') return 'Your events — Beamwall';
  if (pathname.startsWith('/host/new')) return 'New event — Beamwall';
  if (pathname.startsWith('/host/concierge')) return 'Concierge — Beamwall';
  if (pathname.startsWith('/host/billing')) return 'Billing — Beamwall';
  if (pathname.startsWith('/host/support')) return 'Support — Beamwall';
  return 'Host studio — Beamwall';
}

/** localStorage, or null where merely touching it throws (some private
 *  windows, blocked site data) — readTextSize/writeTextSize guard the rest. */
function textSizeStore(): TextSizeStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The CSS hook: `[data-textsize="lg"] .ui-scalable` raises `--ui-scale`, so
 *  the chats and cards grow while the studio canvas stays put. 'md' is the
 *  absence of the attribute, never a value. */
function applyTextSize(size: TextSize) {
  if (size === 'lg') document.documentElement.dataset.textsize = 'lg';
  else delete document.documentElement.dataset.textsize;
}

export default function HostLayout() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [textSize, setTextSize] = useState<TextSize>(() => readTextSize(textSizeStore()));
  /** Phone-only "More" menu: New / Events / Support stay on the bar, the rest
   *  live here instead of scrolling off the right edge. */
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { pathname, search } = useLocation();
  /** Desktop only: the md+ sidebar shrinks to an icon column. The phone top
   *  bar ignores it (its labels already hide below sm). */
  const rail = useRailCollapsed('host');
  const c = rail.collapsed;
  usePageTitle(hostTitle(pathname));

  // Close on navigation, on a tap outside, and focus the first item on open.
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const first = moreMenuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]');
    first?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (moreMenuRef.current?.contains(t) || moreBtnRef.current?.contains(t)) return;
      setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [moreOpen]);

  /** Menu keyboard model (WAI-ARIA menu button): arrows move, Home/End jump,
   *  Escape closes and returns focus to the button, Tab closes. */
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(moreMenuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setMoreOpen(false);
      moreBtnRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      setMoreOpen(false);
    }
  };

  // Larger-text preference: applied on mount from storage, and cleared when
  // the host leaves /host so a guest or admin surface never inherits it.
  useEffect(() => {
    applyTextSize(textSize);
    return () => applyTextSize('md');
  }, [textSize]);

  const toggleTextSize = () => {
    const next: TextSize = textSize === 'lg' ? 'md' : 'lg';
    haptic('tap');
    setTextSize(next);
    writeTextSize(textSizeStore(), next); // false = not persisted; the session still gets it
  };

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
    return <Navigate to="/login" replace state={{ from: `${pathname}${search}` }} />;
  }

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  // Sidebar rows at md+; ≥44px-tall tap targets on the mobile top bar too.
  const railLinkBase =
    `pressable items-center gap-2.5 rounded-xl px-3 md:px-3.5 py-2.5 min-h-11 min-w-11 font-label uppercase tracking-luxe text-[11px] transition-colors justify-center ${c ? 'md:justify-center' : 'md:justify-start'}`;
  // Rail labels: icon-first on the phone bar (labels from sm), and hidden
  // again at md+ while the sidebar is collapsed (the tooltip names the item).
  const lbl = c ? 'hidden sm:inline md:hidden' : 'hidden sm:inline';
  const railLink = `flex ${railLinkBase}`;
  const railState = (isActive: boolean) =>
    isActive ? 'is-selected bg-white/[0.10] text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.05]';
  // Rail items that move into the phone "More" menu: hidden below md only
  // (railLinkBase carries no display class, so `hidden md:flex` is unambiguous).
  const deskOnly = `hidden md:flex ${railLinkBase}`;
  const menuItem =
    'flex w-full items-center gap-3 rounded-xl px-3.5 min-h-[48px] font-sans text-[14px] text-brand-fg hover:bg-white/[0.06] focus:bg-white/[0.08] focus:outline-none';

  return (
    <div className="absolute inset-0 app-bg text-brand-fg flex flex-col md:flex-row overflow-hidden">
      {/* Floating rail — inset from the window edge with its own rounding,
          bevel and drop shadow, so it lifts off the canvas instead of reading
          as a wall bolted to the side. Matches the guest surface's floating
          pill on mobile. */}
      {/* Safe area COMPOSES with the design padding via --safe-top (see
          src/index.css). The inline `padding-top: max(env(...), 0.5rem)` this
          replaces won the cascade over `md:pt-6`, so every desktop sidebar was
          silently rendering with 8px of top padding instead of 24px. */}
      <aside
        id="host-rail"
        className={`liquid-glass-raised relative shrink-0 z-20 ${c ? 'md:w-[4.75rem] md:px-2.5' : 'md:w-60 md:px-4'} flex md:flex-col items-center md:items-stretch gap-2 md:gap-1
                   m-2 md:my-3 md:ml-3 md:mr-0 rounded-2xl px-3 pb-2 md:pb-4 md:transition-[width] md:duration-200 motion-reduce:transition-none
                   pt-safe-top [--safe-top:0.5rem] md:[--safe-top:1.5rem]`}
      >
        {/* Wordmark + the collapse control. `contents` on the phone so the
            wordmark stays a direct child of the top bar's row. Collapsed, the
            wordmark shrinks to its initial and the toggle stacks under it. */}
        <div className={`contents md:flex md:items-center md:gap-1 md:mb-0.5 ${c ? 'md:flex-col' : 'md:justify-between'}`}>
          <Link
            to="/host"
            aria-label="Beamwall, your events"
            className={`font-serif text-xl md:text-2xl font-semibold tracking-wide text-foil-static shrink-0 flex items-center min-h-11 ${c ? 'md:justify-center md:px-0' : 'md:px-2'}`}
          >
            <span className={c ? 'md:hidden' : ''}>Beamwall</span>
            {c && <span aria-hidden className="hidden md:inline">B</span>}
          </Link>
          <div className="hidden md:block">
            <RailToggle collapsed={c} onToggle={rail.toggle} label="menu" controls="host-rail" />
          </div>
        </div>
        {orgName && !c && (
          <p className="hidden md:block px-2 pb-5 font-sans text-[11px] text-brand-muted/60 truncate">{orgName}</p>
        )}
        {c && <div aria-hidden className="hidden md:block pb-3" />}

        {/* Primary destinations — icon + label rows in the sidebar; icon-first
            (labels from sm) on the mobile top bar. */}
        {/* The phone top bar holds more 44px targets than 390px fits (it
            already clipped Support and Sign out); it scrolls sideways instead
            of hiding controls. Vertical breathing room keeps the New-event
            glow from being cut by the scroll box; desktop stays a column. */}
        <nav className="flex md:flex-col gap-1 md:gap-1.5 items-center md:items-stretch ml-auto md:ml-0 md:flex-1 md:min-h-0 min-w-0 overflow-x-auto hide-scrollbar py-2 -my-2 md:py-0 md:my-0 md:overflow-visible">
          {/* The one action every journey starts with — promoted above the
              destinations so a returning host never hunts for it. */}
          <Tooltip label="New event" side="right" disabled={!c}>
          <Link
            to="/host/new"
            onClick={() => haptic('tap')}
            aria-label="New event"
            className={`pressable flex items-center gap-2.5 rounded-xl px-3 md:px-3.5 py-2.5 min-h-11 min-w-11 justify-center ${c ? 'md:justify-center' : 'md:justify-start'} font-label uppercase tracking-luxe text-[11px] font-bold text-white bg-foil glow-accent transition md:mb-1`}
          >
            <Plus className="w-[18px] h-[18px] shrink-0" />
            <span className={lbl}>New event</span>
          </Link>
          </Tooltip>
          <Tooltip label="Events" side="right" disabled={!c}>
          <NavLink to="/host" end onClick={() => haptic('tap')} aria-label="Events" className={({ isActive }) => `${railLink} ${railState(isActive)}`}>
            <CalendarRange className="w-[18px] h-[18px] shrink-0" />
            <span className={lbl}>Events</span>
          </NavLink>
          </Tooltip>

          <Tooltip label="Concierge" side="right" disabled={!c}>
          <NavLink to="/host/concierge" onClick={() => haptic('tap')} aria-label="Concierge" className={({ isActive }) => `${deskOnly} ${railState(isActive)}`}>
            <Sparkles className="w-[18px] h-[18px] shrink-0 text-[color:var(--color-accent)]" />
            <span className={lbl}>Concierge</span>
          </NavLink>
          </Tooltip>

          <Tooltip label={credits !== null ? `Billing · ${credits} credit${credits === 1 ? '' : 's'}` : 'Billing'} side="right" disabled={!c}>
          <NavLink to="/host/billing" onClick={() => haptic('tap')} aria-label="Billing" className={({ isActive }) => `${deskOnly} ${railState(isActive)}`}>
            <CreditCard className="w-[18px] h-[18px] shrink-0" />
            <span className={lbl}>
              Billing
              {/* Mobile keeps the inline credit hint; the sidebar shows the
                  dedicated pill in the account cluster below instead. */}
              {credits !== null && <span className="md:hidden ml-1.5 text-brand-muted/60">· {credits} cr</span>}
            </span>
          </NavLink>
          </Tooltip>

          {/* Account cluster — pinned to the sidebar bottom at md+. */}
          <div className="contents md:flex md:flex-col md:gap-1.5 md:mt-auto md:pt-4 md:border-t md:border-white/10">
            {credits !== null && (
              <Tooltip label={`${credits} credit${credits === 1 ? '' : 's'}`} hint="Top up in Billing" side="right" disabled={!c}>
              <Link
                to="/host/billing"
                title={c ? undefined : 'Credit balance — top up in Billing'}
                aria-label={c ? `${credits} credit${credits === 1 ? '' : 's'}, top up in Billing` : undefined}
                onClick={() => haptic('tap')}
                className={`pressable liquid-glass-inset hidden md:flex items-center gap-2.5 rounded-xl py-2.5 min-h-11 text-brand-muted/80 hover:text-brand-fg transition-colors ${c ? 'justify-center px-0' : 'px-3.5'}`}
              >
                <Coins className="w-[18px] h-[18px] shrink-0 text-[color:var(--color-accent)]" />
                {!c && (
                  <span className="font-label uppercase tracking-luxe text-[11px]">
                    {credits} credit{credits === 1 ? '' : 's'}
                  </span>
                )}
              </Link>
              </Tooltip>
            )}
            {/* Guides are a PUBLIC route, so they never render inside this
                layout — a plain Link with the resting rail state, not a
                NavLink whose isActive could never be true. */}
            <Tooltip label="Guides" side="right" disabled={!c}>
            <Link
              to="/guides"
              onClick={() => haptic('tap')}
              aria-label="Guides"
              className={`${deskOnly} ${railState(false)}`}
            >
              <BookOpen className="w-[18px] h-[18px] shrink-0" />
              <span className={lbl}>Guides</span>
            </Link>
            </Tooltip>
            {/* Was a mailto: into a personal inbox — no ticket, no status, no
                record. Now a real thread the customer can come back to. */}
            <Tooltip label={unread > 0 ? `Support · ${unread} unread` : 'Support'} side="right" disabled={!c}>
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
              <span className={lbl}>
                Support
                {unread > 0 && <span className="ml-1.5 text-[color:var(--color-accent)]">{unread}</span>}
              </span>
            </NavLink>
            </Tooltip>
            {/* A control, not a destination: scales the chats and cards via
                --ui-scale (textSize.ts). Not in visibleHostNav on purpose. */}
            <Tooltip label={textSize === 'lg' ? 'Larger text: on' : 'Larger text: off'} side="right" disabled={!c}>
            <button
              type="button"
              onClick={toggleTextSize}
              aria-pressed={textSize === 'lg'}
              aria-label="Larger text"
              title={c ? undefined : textSize === 'lg' ? 'Larger text is on — tap to use the standard size' : 'Larger text for chats and cards'}
              className={`${deskOnly} ${railState(textSize === 'lg')}`}
            >
              <ALargeSmall className="w-[18px] h-[18px] shrink-0" />
              <span className={lbl}>Larger text</span>
            </button>
            </Tooltip>
            <Tooltip label="Sign out" side="right" disabled={!c}>
            <button onClick={() => setConfirmingSignOut(true)} aria-label="Sign out" className={`${deskOnly} ${railState(false)}`}>
              <LogOut className="w-[18px] h-[18px] shrink-0" />
              <span className={lbl}>Sign out</span>
            </button>
            </Tooltip>
          </div>
          {/* Phone: everything else lives behind one menu button. */}
          <button
            ref={moreBtnRef}
            type="button"
            onClick={() => { haptic('tap'); setMoreOpen((v) => !v); }}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls="host-more-menu"
            aria-label="More"
            className={`${railLink} md:hidden ${railState(moreOpen)}`}
          >
            <MoreHorizontal className="w-[18px] h-[18px] shrink-0" />
            <span className={lbl}>More</span>
          </button>
        </nav>
        {moreOpen && (
          // The wrapper owns the position: `.liquid-glass-raised` sets
          // `position: relative` (index.css), which beat the `absolute`
          // utility and dropped the menu INTO the top bar's flex row.
          <div className="md:hidden absolute right-2 top-[calc(100%+0.25rem)] z-40 w-64 max-w-[calc(100vw-1rem)]">
          <div
            id="host-more-menu"
            ref={moreMenuRef}
            role="menu"
            aria-label="More"
            onKeyDown={onMenuKey}
            className="liquid-glass-raised rounded-2xl p-1.5 flex flex-col"
          >
            <Link role="menuitem" tabIndex={-1} to="/host/concierge" className={menuItem}>
              <Sparkles className="w-[18px] h-[18px] text-[color:var(--color-accent)]" aria-hidden /> Concierge
            </Link>
            <Link role="menuitem" tabIndex={-1} to="/host/billing" className={menuItem}>
              <CreditCard className="w-[18px] h-[18px]" aria-hidden /> Billing
              {credits !== null && <span className="ml-auto text-[12px] text-brand-muted">{credits} credit{credits === 1 ? '' : 's'}</span>}
            </Link>
            <Link role="menuitem" tabIndex={-1} to="/guides" className={menuItem}>
              <BookOpen className="w-[18px] h-[18px]" aria-hidden /> Guides
            </Link>
            <button
              role="menuitemcheckbox"
              aria-checked={textSize === 'lg'}
              tabIndex={-1}
              type="button"
              onClick={toggleTextSize}
              className={menuItem}
            >
              <ALargeSmall className="w-[18px] h-[18px]" aria-hidden /> Larger text
              <span className="ml-auto text-[12px] text-brand-muted">{textSize === 'lg' ? 'On' : 'Off'}</span>
            </button>
            <div role="separator" className="my-1 h-px bg-white/10" />
            <button
              role="menuitem"
              tabIndex={-1}
              type="button"
              onClick={() => { setMoreOpen(false); setConfirmingSignOut(true); }}
              className={menuItem}
            >
              <LogOut className="w-[18px] h-[18px]" aria-hidden /> Sign out
            </button>
          </div>
          </div>
        )}
      </aside>

      {/* Content */}
      {/* pb-24 keeps the last row scrollable clear of the floating assistant
          button (it sat on top of "Manage" on a phone). Not on /host/concierge:
          the button is hidden there and that page fills the height itself. */}
      <main className={`flex-1 relative overflow-y-auto ${pathname.startsWith('/host/concierge') ? '' : 'pb-24'}`}>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </main>

      {confirmingSignOut && (
        <ConfirmModal
          title="Sign out?"
          body="You'll be signed out of your Beamwall studio on this device. Your events keep running."
          confirmLabel="Sign out"
          onConfirm={handleSignOut}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}
    </div>
  );
}
