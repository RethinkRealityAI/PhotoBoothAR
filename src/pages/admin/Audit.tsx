/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/audit — the append-only admin_audit trail (most recent 200 entries;
 * this is an operational view, not an archive). Read-only.
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { fetchAudit, type AuditEntry } from '../../lib/admin';
import { formatDate } from '../../lib/adminFormat';
import { searchRows, sortRows, paginateRows } from '../../lib/adminFilters';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';

const PAGE_SIZE = 15;

export default function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    const { data } = await fetchAudit();
    setEntries(data?.entries ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [query]);

  const filtered = useMemo(
    () => sortRows(searchRows(entries, query, ['actorEmail', 'action', 'target_type', 'target_id']), 'created_at', 'desc'),
    [entries, query],
  );
  const paged = useMemo(() => paginateRows(filtered, page, PAGE_SIZE), [filtered, page]);

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
          <p className="mt-1 font-sans text-xs text-brand-muted/60">Most recent {entries.length} admin actions</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="relative mb-4 max-w-xs">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search audit log…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-xs text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-white/20"
        />
      </div>

      <DataTable columns={columns} rows={paged.rows} getRowKey={(e) => String(e.id)} loading={loading} emptyMessage="No audit activity yet." />
      <Pagination page={paged.page} totalPages={paged.totalPages} total={paged.total} onPageChange={setPage} />
    </div>
  );
}
