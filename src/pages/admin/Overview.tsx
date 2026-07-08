/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin — platform overview. Cross-tenant counts (orgs, users, events by
 * status, active Pro subs, outstanding credits, engagement, revenue) from the
 * admin-api `overview_metrics` action. Revenue reads the `orders` table
 * (Phase 3) — it's genuinely $0 until Stripe keys are provisioned, not a
 * placeholder; see the Payments screen for the full breakdown.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchOverviewMetrics, type OverviewMetrics } from '../../lib/admin';
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

export default function Overview() {
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    const { data, error } = await fetchOverviewMetrics();
    if (error || !data) { setState('error'); return; }
    setMetrics(data);
    setState('ready');
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
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
