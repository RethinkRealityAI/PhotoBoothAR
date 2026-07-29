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
import { AlertTriangle, CircleHelp, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchOverviewMetrics, fetchOrders, type OverviewMetrics } from '../../lib/admin';
import { adminSupportCounts } from '../../lib/support';
import {
  overallSeverity, triageHeadline, triageSignals,
  type TriageSeverity, type TriageSignal,
} from '../../lib/adminTriage';
import { formatCount, formatCents } from '../../lib/adminFormat';

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass-strong rounded-2xl p-5 flex flex-col gap-1">
      <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">{label}</p>
      <p className="mt-1 font-serif text-3xl text-foil-static leading-none">{value}</p>
      {sub && <p className="mt-1 font-sans text-[11px] text-brand-muted/50">{sub}</p>}
    </div>
  );
}

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
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">{signal.label}</p>
        <p className="font-sans text-[11px] text-brand-muted/60 leading-snug">{signal.detail}</p>
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
    <div className="p-4 sm:p-6 md:p-10 max-w-5xl mx-auto pb-safe-bottom [--safe-bottom:1.5rem]">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Platform overview</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">Everything across every customer, at a glance.</p>
        </div>
        <button
          onClick={load}
          disabled={state === 'loading'}
          className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${state === 'loading' ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {/* Triage first: this is the part that is read in three seconds on the
          way past. It renders whether or not the metrics call succeeded. */}
      <section aria-label="Needs attention" className="mb-8">
        {!triageLoaded ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[4.5rem] glass rounded-2xl motion-safe:animate-pulse" />)}
          </div>
        ) : (
          <>
            <p className={`mb-3 font-sans text-sm ${worst === 'calm' ? 'text-brand-muted/50' : 'text-brand-fg'}`}>
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
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-28 glass rounded-2xl animate-pulse" />)}
        </div>
      ) : state === 'error' ? (
        <div className="liquid-glass rounded-3xl p-12 text-center max-w-lg mx-auto">
          <h2 className="font-serif text-2xl text-foil-static mb-2">Couldn’t load metrics</h2>
          <p className="font-sans text-sm text-brand-muted/70 leading-relaxed mb-6">
            The platform API didn’t respond. Check your connection and try again.
          </p>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-full bg-foil px-6 py-3 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : metrics ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatTile label="Organizations" value={formatCount(metrics.orgs)} />
          <StatTile label="People" value={formatCount(metrics.users)} sub="accounts on the platform" />
          <StatTile
            label="Events"
            value={formatCount(metrics.events.total)}
            sub={`${metrics.events.live} live · ${metrics.events.draft} draft · ${metrics.events.ended} ended`}
          />
          <StatTile label="Active Pro" value={formatCount(metrics.activeSubscriptions)} sub="monthly subscriptions" />
          <StatTile label="Revenue" value={formatCents(metrics.revenueCents)} sub="live once Stripe is connected" />
          <StatTile label="Credits outstanding" value={formatCount(metrics.outstandingCredits)} />
          <StatTile label="Photos & videos" value={formatCount(metrics.engagement.posts)} sub="posted to walls" />
          <StatTile label="Greeting cards" value={formatCount(metrics.engagement.cards)} />
        </div>
      ) : null}
    </div>
  );
}
