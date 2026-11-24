/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/audit — the append-only admin_audit trail, newest first. Read-only.
 *
 * Searched and paged on the server. It used to load a flat 200 rows and filter
 * them in the browser, which made the screen misleading for the question an
 * audit log exists to answer: "what happened to this org last month" searched
 * only the newest 200 entries, so on a busy platform the answer was always
 * "nothing" — indistinguishable from a clean record.
 */
import { useCallback } from 'react';
import { AdminHeader, AdminPage, AdminSearch, RefreshButton } from './AdminChrome';
import { fetchAudit, type AuditEntry } from '../../lib/admin';
import { formatDate, auditActionLabel, auditMetaSummary } from '../../lib/adminFormat';
import { listFootnote, type ListQuery } from '../../lib/serverList';
import { useServerList } from '../../lib/useServerList';
import DataTable, { type Column } from '../../components/ui/DataTable';
import LoadError from '../../components/ui/LoadError';
import ListMore from '../../components/ui/ListMore';

const PAGE_SIZE = 50;

export default function Audit() {
  // Server-side search over action, target type and target id. Actor email is
  // NOT searchable — it lives in auth.users rather than on the row, so matching
  // it would mean resolving every actor before paging. That is a real narrowing
  // versus the old client-side filter, and why the placeholder says what it
  // matches rather than a bare "Search".
  const fetchPage = useCallback(async (q: ListQuery) => {
    const { data, error } = await fetchAudit(q);
    return { rows: data?.entries ?? [], hasMore: data?.hasMore ?? false, error };
  }, []);
  const list = useServerList<AuditEntry>(fetchPage, PAGE_SIZE);

  const columns: Column<AuditEntry>[] = [
    { key: 'action', label: 'Action', render: (e) => <span className="text-brand-fg font-medium">{auditActionLabel(e.action)}</span> },
    { key: 'actor', label: 'Actor', render: (e) => <span className="break-all">{e.actorEmail ?? <span className="text-brand-muted/70">System</span>}</span> },
    {
      key: 'target',
      label: 'Target',
      render: (e) => e.target_type
        ? <span className="font-mono text-[10px] text-brand-muted/75 break-all">{e.target_type}:{e.target_id}</span>
        : <span className="text-brand-muted/60">None</span>,
    },
    {
      key: 'meta',
      label: 'Detail',
      render: (e) => {
        const summary = auditMetaSummary(e.meta);
        return summary
          ? <span className="text-[11px] text-brand-muted/75 sm:truncate block sm:max-w-xs" title={summary}>{summary}</span>
          : <span className="text-brand-muted/60">None</span>;
      },
    },
    { key: 'when', label: 'When', render: (e) => formatDate(e.created_at) },
  ];

  return (
    <AdminPage>
      <AdminHeader
        title="Audit log"
        subtitle="Every change an admin made, newest first. Nothing here can be edited."
        note={listFootnote(list.rows.length, list.hasMore, 'admin action') || 'Loading…'}
        actions={<RefreshButton onClick={list.reload} busy={list.loading} />}
      />

      {list.error && <LoadError what="the audit log" code={list.error} onRetry={list.reload} />}

      <AdminSearch
        value={list.query}
        onChange={list.setQuery}
        placeholder="Search action or target…"
        label="Search the audit log by action or target"
      />

      <DataTable columns={columns} rows={list.rows} getRowKey={(e) => String(e.id)} loading={list.loading} emptyMessage="No audit activity yet." />
      <ListMore
        hasMore={list.hasMore}
        loading={list.loadingMore}
        onMore={list.loadMore}
        note={listFootnote(list.rows.length, list.hasMore, 'admin action')}
      />
    </AdminPage>
  );
}
