/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/payments — revenue across every customer. Reads admin-api's
 * `revenue_summary` (server-computed aggregate — no client PRICES copy) for
 * the header tiles and `list_orders` for the transaction table. Stripe keys
 * are unprovisioned as of this writing, so the honest state today is empty —
 * this renders that plainly instead of a fake zeroed dashboard.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { fetchOrders, fetchRevenueSummary, type OrderRow } from '../../lib/admin';
import type { RevenueSummary } from '../../lib/revenue';
import { formatCents, formatDate } from '../../lib/adminFormat';
import { listFootnote, type ListQuery } from '../../lib/serverList';
import { useServerList } from '../../lib/useServerList';
import DataTable, { type Column } from '../../components/ui/DataTable';
import ListMore from '../../components/ui/ListMore';
import StatusPill from '../../components/ui/StatusPill';

/** Rows per request. The header totals come from `revenue_summary`, which
 *  aggregates SERVER-side over every order — so paging the table below cannot
 *  make the money numbers wrong. */
const PAGE_SIZE = 50;

function currencyTotals(byCurrency: Record<string, number>): string {
  const entries = Object.entries(byCurrency);
  if (entries.length === 0) return formatCents(0);
  return entries.map(([currency, cents]) => formatCents(cents, currency)).join(' · ');
}

export default function Payments() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Orders are searched and paged by the server; this screen used to pull EVERY
  // order on the platform to show ten of them. Search matches the Stripe
  // reference — the thing an operator has in front of them when a customer
  // disputes a charge. Org name lives on another table and is not filterable
  // server-side, which the placeholder now states.
  const fetchPage = useCallback(async (q: ListQuery) => {
    const { data, error } = await fetchOrders(q);
    return { rows: data?.orders ?? [], hasMore: data?.hasMore ?? false, error };
  }, []);
  const list = useServerList<OrderRow>(fetchPage, PAGE_SIZE);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    const res = await fetchRevenueSummary();
    setSummary(res.data ?? null);
    setSummaryFailed(Boolean(res.error) || !res.data);
    setSummaryLoading(false);
  }, []);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const load = useCallback(() => { void loadSummary(); list.reload(); }, [loadSummary, list]);
  const state: 'loading' | 'ready' | 'error' = summaryLoading
    ? 'loading'
    : summaryFailed ? 'error' : 'ready';

  const columns: Column<OrderRow>[] = [
    { key: 'org', label: 'Organization', render: (o) => <span className="text-brand-fg font-medium">{o.orgName}</span> },
    { key: 'kind', label: 'Kind', render: (o) => <span className="capitalize">{o.kind.replace('_', ' ')}</span> },
    { key: 'tier', label: 'Tier', render: (o) => <span className="capitalize">{o.tier ?? '—'}</span> },
    { key: 'amount', label: 'Amount', render: (o) => formatCents(o.amount_total, o.currency) },
    { key: 'status', label: 'Status', render: (o) => <StatusPill status={o.status} /> },
    { key: 'date', label: 'Date', render: (o) => formatDate(o.created_at) },
  ];

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Payments</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">Revenue across every customer.</p>
        </div>
        <button
          onClick={load}
          disabled={state === 'loading'}
          className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
        >
          <RefreshCw className={`w-4 h-4 ${state === 'loading' ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {state === 'loading' ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 glass rounded-2xl animate-pulse" />)}
        </div>
      ) : state === 'error' ? (
        <div className="glass-strong rounded-3xl p-12 text-center max-w-lg mx-auto">
          <h2 className="font-serif text-2xl text-foil-static mb-2">Couldn't load payments</h2>
          <button
            onClick={load}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-foil px-6 py-3 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition active:scale-[0.98]"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : summary && summary.orderCount === 0 ? (
        <div className="glass-strong rounded-3xl p-12 text-center max-w-lg mx-auto">
          <h2 className="font-serif text-2xl text-foil-static mb-2">No live payments yet</h2>
          <p className="font-sans text-sm text-brand-muted/70 leading-relaxed">
            Stripe keys aren't provisioned yet, so nothing has been charged. Once billing goes live, every checkout
            and Pro renewal will show up here automatically.
          </p>
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 mb-8">
            <div className="glass-strong rounded-2xl p-5">
              <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Total revenue</p>
              <p className="mt-1 font-serif text-2xl text-foil-static">{currencyTotals(summary.totalsByCurrency)}</p>
            </div>
            <div className="glass-strong rounded-2xl p-5">
              <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">One-time</p>
              <p className="mt-1 font-serif text-2xl text-foil-static">{currencyTotals(summary.oneTimeByCurrency)}</p>
              <p className="mt-1 font-sans text-[11px] text-brand-muted/50">event packages + credit packs</p>
            </div>
            <div className="glass-strong rounded-2xl p-5">
              <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Subscriptions</p>
              <p className="mt-1 font-serif text-2xl text-foil-static">{currencyTotals(summary.subscriptionByCurrency)}</p>
              <p className="mt-1 font-sans text-[11px] text-brand-muted/50">Pro, incl. renewals</p>
            </div>
          </div>

          <div className="relative mb-4 max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/40" />
            <input
              value={list.query}
              onChange={(e) => list.setQuery(e.target.value)}
              placeholder="Search by Stripe reference…"
              className="w-full pl-9 pr-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-xs text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-white/20"
            />
          </div>

          <DataTable
            columns={columns}
            rows={list.rows}
            getRowKey={(o) => String(o.id)}
            loading={list.loading}
            emptyMessage="No payments match."
          />
          <ListMore
            hasMore={list.hasMore}
            loading={list.loadingMore}
            onMore={list.loadMore}
            note={listFootnote(list.rows.length, list.hasMore, 'payment')}
          />
        </>
      ) : null}
    </div>
  );
}
