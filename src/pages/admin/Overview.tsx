/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin — platform overview. Cross-tenant counts (orgs, users, events by
 * status, active Pro subs, outstanding credits, engagement, revenue) from the
 * admin-api `overview_metrics` action. Revenue reads the `orders` table
 * (Phase 3) — it's genuinely $0 until Stripe keys are provisioned, not a
 * placeholder; see the Payments screen for the full breakdown.
 *
 * The triage strip on top answers "is anything on fire" before the operator
 * clicks anything: unread/open support tickets, disputes and refunds in the
 * recent order window, and how many walls are live right now. Its three reads
 * are INDEPENDENT — the counts still render when the support desk is
 * unreachable, and the tile that failed says "unknown" rather than "0". The
 * rules live in the pure lib/adminTriage.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CircleHelp, ShieldCheck, TriangleAlert } from 'lucide-react';
import { AdminHeader, AdminNotice, AdminPage, RefreshButton, StatTile } from './AdminChrome';
import { Link } from 'react-router-dom';
import { fetchOverviewMetrics, fetchOrders, type OverviewMetrics } from '../../lib/admin';
import { adminSupportCounts } from '../../lib/support';
import {
  overallSeverity, triageHeadline, triageSignals,
  type TriageSeverity, type TriageSignal,
} from '../../lib/adminTriage';
import { formatCount, formatCents } from '../../lib/adminFormat';

/** How many recent orders the money signal scans. Every claim it makes is
 *  scoped to this number in the UI — `list_orders` has no status filter, so a
 *  window is the only honest thing to say. */
const ORDERS_WINDOW = 50;

const TONE: Record<TriageSeverity, { ring: string; text: string; Icon: typeof AlertTriangle }> = {
  critical: { ring: 'border-red-400/40 bg-red-500/[0.07]', text: 'text-red-300', Icon: TriangleAlert },
  warning: { ring: 'border-amber-400/40 bg-amber-500/[0.06]', text: 'text-amber-300', Icon: AlertTriangle },
  unknown: { ring: 'border-white/15 bg-white/[0.03]', text: 'text-brand-muted/70', Icon: CircleHelp },
  calm: { ring: 'border-white/10 bg-white/[0.02]', text: 'text-emerald-300/80', Icon: ShieldCheck },
};

function TriageTile({ signal }: { signal: TriageSignal }) {
  const tone = TONE[signal.severity];
  return (
    <Link
      to={signal.to}
      className={`pressable flex items-center gap-3 rounded-2xl border p-4 min-h-11 transition-colors hover:bg-white/[0.06] ${tone.ring}`}
    >
      <tone.Icon className={`w-5 h-5 shrink-0 ${tone.text}`} />
      <div className="min-w-0 flex-1">
        <p className="font-sans text-[13px] font-medium text-brand-fg">{signal.label}</p>
        <p className="font-sans text-[11px] text-brand-muted/75 leading-snug">{signal.detail}</p>
      </div>
      <p className={`shrink-0 font-serif text-2xl leading-none tabular-nums ${tone.text}`}>{signal.value}</p>
    </Link>
  );
}

export default function Overview() {
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [support, setSupport] = useState<{ open: number; unread: number } | null>(null);
  const [orders, setOrders] = useState<{ status: string }[] | null>(null);
  /** The strip is only meaningful once its own reads have settled — before
   *  that it must not claim "0 unread", which is what `null` would render. */
  const [triageLoaded, setTriageLoaded] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setTriageLoaded(false);
    // Independent on purpose: a support-api outage must not blank the counts,
    // and a metrics failure must not hide an unread ticket.
    const [metricsRes, supportRes, ordersRes] = await Promise.all([
      fetchOverviewMetrics(),
      adminSupportCounts(),
      fetchOrders({ limit: ORDERS_WINDOW }),
    ]);
    setSupport(supportRes.error || !supportRes.data ? null : supportRes.data);
    setOrders(ordersRes.error || !ordersRes.data ? null : ordersRes.data.orders);
    setTriageLoaded(true);
    if (metricsRes.error || !metricsRes.data) { setState('error'); return; }
    setMetrics(metricsRes.data);
    setState('ready');
  }, []);

  useEffect(() => { load(); }, [load]);

  const signals = triageSignals({
    support,
    recentOrders: orders,
    ordersWindow: ORDERS_WINDOW,
    liveEvents: metrics?.events.live ?? null,
  });
  const worst = overallSeverity(signals);

  return (
    <AdminPage>
      <AdminHeader
        title="Platform overview"
        subtitle="Everything across every customer, at a glance."
        actions={<RefreshButton onClick={load} busy={state === 'loading'} />}
      />

      {/* Triage first: this is the part that is read in three seconds on the
          way past. It renders whether or not the metrics call succeeded. */}
      <section aria-label="Needs attention" className="mb-8">
        {!triageLoaded ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[4.5rem] glass rounded-2xl motion-safe:animate-pulse" />)}
          </div>
        ) : (
          <>
            <p className={`mb-3 font-sans text-sm ${worst === 'calm' ? 'text-brand-muted/75' : 'text-brand-fg'}`}>
              {triageHeadline(signals)}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {signals.map((s) => <TriageTile key={s.id} signal={s} />)}
            </div>
          </>
        )}
      </section>

      {state === 'loading' ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-28 glass rounded-2xl motion-safe:animate-pulse" />)}
        </div>
      ) : state === 'error' ? (
        <AdminNotice title="Couldn’t load metrics" action={{ label: 'Try again', onClick: load }}>
          The platform API didn’t respond. Check your connection and try again.
        </AdminNotice>
      ) : metrics ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatTile label="Organizations" value={formatCount(metrics.orgs)} />
          <StatTile label="People" value={formatCount(metrics.users)} sub="Accounts on the platform" />
          <StatTile
            label="Events"
            value={formatCount(metrics.events.total)}
            sub={`${metrics.events.live} live · ${metrics.events.draft} draft · ${metrics.events.ended} ended`}
          />
          <StatTile label="Active Pro" value={formatCount(metrics.activeSubscriptions)} sub="Pro subscriptions running now" />
          <StatTile label="Revenue" value={formatCents(metrics.revenueCents)} sub="Paid orders in USD, all time" />
          <StatTile label="Credits outstanding" value={formatCount(metrics.outstandingCredits)} />
          <StatTile label="Photos & videos" value={formatCount(metrics.engagement.posts)} sub="Posted to walls" />
          <StatTile label="Greeting cards" value={formatCount(metrics.engagement.cards)} />
        </div>
      ) : null}
    </AdminPage>
  );
}
