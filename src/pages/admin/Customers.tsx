/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/customers — every org on the platform: events, subscription tier,
 * outstanding credits. Row click drills into CustomerDetail.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminHeader, AdminPage, AdminSearch, RefreshButton } from './AdminChrome';
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
      // The tier is the answer to "what plan are they on"; the subscription's
      // status only earns a pill when it is NOT the healthy default (past due,
      // cancelled), which is the case an operator needs to see.
      render: (o) =>
        o.subscriptionTier ? (
          <span className="inline-flex items-center gap-2">
            <span className="capitalize text-brand-fg">{o.subscriptionTier}</span>
            {o.subscriptionStatus !== null && o.subscriptionStatus !== 'active' && <StatusPill status={o.subscriptionStatus} />}
          </span>
        ) : <span className="text-brand-muted/70">Free</span>,
    },
    { key: 'credits', label: 'Credits', render: (o) => formatCount(o.creditBalance) },
    { key: 'created', label: 'Joined', render: (o) => formatDate(o.createdAt) },
  ];

  return (
    <AdminPage>
      <AdminHeader
        title="Customers"
        subtitle="Every organization on Beamwall. Open one to see its people, events and credits."
        note={listFootnote(list.rows.length, list.hasMore, 'organization') || 'Loading…'}
        actions={<RefreshButton onClick={list.reload} busy={list.loading} />}
      />

      {list.error && <LoadError what="customers" code={list.error} onRetry={list.reload} />}

      <AdminSearch
        value={list.query}
        onChange={list.setQuery}
        placeholder="Search organizations…"
        label="Search customers"
      />

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
    </AdminPage>
  );
}
