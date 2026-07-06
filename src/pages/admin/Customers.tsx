/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/customers — every org on the platform: events, subscription tier,
 * outstanding credits. Row click drills into CustomerDetail.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { fetchOrgs, type OrgRow } from '../../lib/admin';
import { formatCount, formatDate } from '../../lib/adminFormat';
import { searchRows, sortRows, paginateRows } from '../../lib/adminFilters';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import StatusPill from '../../components/ui/StatusPill';

const PAGE_SIZE = 10;

export default function Customers() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    const { data } = await fetchOrgs();
    setOrgs(data?.orgs ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [query]);

  const filtered = useMemo(() => sortRows(searchRows(orgs, query, ['name']), 'createdAt', 'desc'), [orgs, query]);
  const paged = useMemo(() => paginateRows(filtered, page, PAGE_SIZE), [filtered, page]);

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
          <p className="mt-1 font-sans text-xs text-brand-muted/60">{formatCount(orgs.length)} organizations</p>
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
          placeholder="Search organizations…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-xs text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-white/20"
        />
      </div>

      <DataTable
        columns={columns}
        rows={paged.rows}
        getRowKey={(o) => o.id}
        loading={loading}
        emptyMessage="No organizations match."
        onRowClick={(o) => navigate(`/admin/customers/${o.id}`)}
      />
      <Pagination page={paged.page} totalPages={paged.totalPages} total={paged.total} onPageChange={setPage} />
    </div>
  );
}
