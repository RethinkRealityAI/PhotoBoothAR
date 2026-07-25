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
import { RefreshCw, Search } from 'lucide-react';
import { fetchAudit, type AuditEntry } from '../../lib/admin';
import { formatDate } from '../../lib/adminFormat';
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
    { key: 'actor', label: 'Actor', render: (e) => e.actorEmail ?? <span className="text-brand-muted/40">system</span> },
    { key: 'action', label: 'Action', render: (e) => <span className="font-mono text-[11px]">{e.action}</span> },
    {
      key: 'target',
      label: 'Target',
      render: (e) => e.target_type
        ? <span className="font-mono text-[10px] text-brand-muted/60">{e.target_type}:{e.target_id}</span>
        : <span className="text-brand-muted/40">—</span>,
    },
    {
      key: 'meta',
      label: 'Detail',
      render: (e) => e.meta
        ? <span className="font-mono text-[10px] text-brand-muted/50 truncate block max-w-xs">{JSON.stringify(e.meta)}</span>
        : <span className="text-brand-muted/40">—</span>,
    },
    { key: 'when', label: 'When', render: (e) => formatDate(e.created_at) },
  ];

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Audit log</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">
            {listFootnote(list.rows.length, list.hasMore, 'admin action') || 'Loading…'}
          </p>
        </div>
        <button
          onClick={list.reload}
          disabled={list.loading}
          className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
        >
          <RefreshCw className={`w-4 h-4 ${list.loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {list.error && <LoadError what="the audit log" code={list.error} onRetry={list.reload} />}

      <div className="relative mb-4 max-w-xs">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/40" />
        <input
          value={list.query}
          onChange={(e) => list.setQuery(e.target.value)}
          placeholder="Search action or target…"
          className="w-full pl-9 pr-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-xs text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-white/20"
        />
      </div>

      <DataTable columns={columns} rows={list.rows} getRowKey={(e) => String(e.id)} loading={list.loading} emptyMessage="No audit activity yet." />
      <ListMore
        hasMore={list.hasMore}
        loading={list.loadingMore}
        onMore={list.loadMore}
        note={listFootnote(list.rows.length, list.hasMore, 'admin action')}
      />
    </div>
  );
}
