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
import { AdminHeader, AdminNotice, AdminPage, AdminSearch, RefreshButton, StatTile } from './AdminChrome';
import { fetchOrders, fetchRevenueSummary, type OrderRow } from '../../lib/admin';
import type { RevenueSummary } from '../../lib/revenue';
import { formatCents, formatDate } from '../../lib/adminFormat';
import { listFootnote, type ListQuery } from '../../lib/serverList';
import { useServerList } from '../../lib/useServerList';
import DataTable, { type Column } from '../../components/ui/DataTable';
import ListMore from '../../components/ui/ListMore';
import LoadError from '../../components/ui/LoadError';
import StatusPill from '../../components/ui/StatusPill';

/** Rows per request. The header totals come from `revenue_summary`, which
 *  aggregates SERVER-side over every order — so paging the table below cannot
 *  make the money numbers wrong. */
const PAGE_SIZE = 50;

const ORDER_KIND: Record<OrderRow['kind'], string> = {
  event_package: 'Event package',
  credit_pack: 'Credit pack',
  pro_subscription: 'Pro subscription',
};

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
    { key: 'kind', label: 'Kind', render: (o) => <span>{ORDER_KIND[o.kind] ?? o.kind}</span> },
    { key: 'tier', label: 'Tier', render: (o) => (o.tier ? <span className="capitalize">{o.tier}</span> : <span className="text-brand-muted/60">None</span>) },
    { key: 'amount', label: 'Amount', render: (o) => formatCents(o.amount_total, o.currency) },
    { key: 'status', label: 'Status', render: (o) => <StatusPill status={o.status} /> },
    { key: 'date', label: 'Date', render: (o) => formatDate(o.created_at) },
  ];

  return (
    <AdminPage>
      <AdminHeader
        title="Payments"
        subtitle="Revenue across every customer, from Stripe orders."
        actions={<RefreshButton onClick={load} busy={state === 'loading'} />}
      />

      {state === 'loading' ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 glass rounded-2xl motion-safe:animate-pulse" />)}
        </div>
      ) : state === 'error' ? (
        <AdminNotice title="Couldn’t load payments" action={{ label: 'Try again', onClick: load }}>
          The platform API didn’t answer. Nothing here means nothing was charged; it means we couldn’t ask.
        </AdminNotice>
      ) : summary && summary.orderCount === 0 ? (
        <AdminNotice title="No payments yet">
          Every checkout, credit pack and Pro renewal shows up here as soon as a customer pays.
        </AdminNotice>
      ) : summary ? (
        <>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3 mb-8">
            <StatTile label="Total revenue" value={currencyTotals(summary.totalsByCurrency)} sub={`${summary.orderCount} ${summary.orderCount === 1 ? 'order' : 'orders'}, refunds excluded`} />
            <StatTile label="One-time" value={currencyTotals(summary.oneTimeByCurrency)} sub="Event packages and credit packs" />
            <StatTile label="Subscriptions" value={currencyTotals(summary.subscriptionByCurrency)} sub="Pro, including renewals" />
          </div>

          {list.error !== null && <LoadError what="payments" code={list.error} onRetry={list.reload} />}

          <AdminSearch
            value={list.query}
            onChange={list.setQuery}
            placeholder="Search by Stripe reference…"
            label="Search payments by Stripe reference"
          />

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
    </AdminPage>
  );
}
