/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/customers — every org on the platform: events, subscription tier,
 * outstanding credits. Row click drills into CustomerDetail.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { fetchOrgs, type OrgRow } from '../../lib/admin';
import { formatCount, formatDate } from '../../lib/adminFormat';
import { listFootnote, type ListQuery } from '../../lib/serverList';
import { useServerList } from '../../lib/useServerList';
import DataTable, { type Column } from '../../components/ui/DataTable';
import LoadError from '../../components/ui/LoadError';
import ListMore from '../../components/ui/ListMore';
import StatusPill from '../../components/ui/StatusPill';

/** Rows per request. The old client-side pager showed ten at a time out of a
 *  payload containing EVERY org; this is what the server actually sends. */
const PAGE_SIZE = 50;

export default function Customers() {
  const navigate = useNavigate();
  // Search and paging happen on the SERVER now: this screen used to receive
  // every org on the platform and filter them in JavaScript.
  const fetchPage = useCallback(async (q: ListQuery) => {
    const { data, error } = await fetchOrgs(q);
    return { rows: data?.orgs ?? [], hasMore: data?.hasMore ?? false, error };
  }, []);
  const list = useServerList<OrgRow>(fetchPage, PAGE_SIZE);

  const columns: Column<OrgRow>[] = [
    { key: 'name', label: 'Organization', render: (o) => <span className="text-brand-fg font-medium">{o.name}</span> },
    { key: 'events', label: 'Events', render: (o) => formatCount(o.eventCount) },
    {
      key: 'plan',
      label: 'Plan',
      render: (o) =>
        o.subscriptionTier ? <StatusPill status={o.subscriptionStatus ?? 'active'} /> : <span className="text-brand-muted/40">Free</span>,
    },
    { key: 'credits', label: 'Credits', render: (o) => formatCount(o.creditBalance) },
    { key: 'created', label: 'Joined', render: (o) => formatDate(o.createdAt) },
  ];

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Customers</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">
            {listFootnote(list.rows.length, list.hasMore, 'organization') || 'Loading…'}
          </p>
        </div>
        <button
          onClick={list.reload}
          disabled={list.loading}
          aria-label="Refresh"
          className="pressable p-2.5 min-h-11 min-w-11 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
        >
          <RefreshCw className={`w-4 h-4 ${list.loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {list.error && <LoadError what="customers" code={list.error} onRetry={list.reload} />}

      <div className="relative mb-4 max-w-xs">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/40" />
        <input
          value={list.query}
          onChange={(e) => list.setQuery(e.target.value)}
          placeholder="Search organizations…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-xs text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-white/20"
        />
      </div>

      <DataTable
        columns={columns}
        rows={list.rows}
        getRowKey={(o) => o.id}
        loading={list.loading}
        emptyMessage="No organizations match."
        onRowClick={(o) => navigate(`/admin/customers/${o.id}`)}
      />
      <ListMore
        hasMore={list.hasMore}
        loading={list.loadingMore}
        onMore={list.loadMore}
        note={listFootnote(list.rows.length, list.hasMore, 'organization')}
      />
    </div>
  );
}
