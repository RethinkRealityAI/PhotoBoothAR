/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/events — every event across every org, cross-tenant. Status changes
 * go through admin-api's `set_event_status` (audited) behind a confirm modal —
 * this bypasses the owning org's own host studio, so it should read as
 * deliberate, not a stray click. "Comp plan" (`set_event_tier`) is the same
 * pattern for admin-granted tiers outside of Stripe (support comps, trials).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { fetchEvents, setEventStatus, setEventTier, type AdminEventRow } from '../../lib/admin';
import { formatDate } from '../../lib/adminFormat';
import { searchRows, sortRows, paginateRows } from '../../lib/adminFilters';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import StatusPill from '../../components/ui/StatusPill';
import { useToast } from '../../components/ui/Toast';

const PAGE_SIZE = 10;
const STATUSES = ['draft', 'live', 'ended', 'archived'] as const;
const TIERS = ['free', 'essentials', 'premium', 'deluxe'] as const;

export default function Events() {
  const { push } = useToast();
  const [events, setEvents] = useState<AdminEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<AdminEventRow | null>(null);
  const [tierTarget, setTierTarget] = useState<AdminEventRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await fetchEvents();
    setEvents(data?.events ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [query]);

  const filtered = useMemo(
    () => sortRows(searchRows(events, query, ['name', 'slug', 'orgName']), 'created_at', 'desc'),
    [events, query],
  );
  const paged = useMemo(() => paginateRows(filtered, page, PAGE_SIZE), [filtered, page]);

  const applyStatus = async (status: string) => {
    if (!target) return;
    setBusy(true);
    const { error } = await setEventStatus(target.id, status);
    setBusy(false);
    if (error) { push('Could not change status.', 'error'); return; }
    setEvents((list) => list.map((e) => (e.id === target.id ? { ...e, status } : e)));
    push(`${target.name} is now ${status}.`, 'success');
    setTarget(null);
  };

  const applyTier = async (tier: string) => {
    if (!tierTarget) return;
    setBusy(true);
    const { error } = await setEventTier(tierTarget.id, tier);
    setBusy(false);
    if (error) { push('Could not comp this plan.', 'error'); return; }
    setEvents((list) => list.map((e) => (e.id === tierTarget.id ? { ...e, plan_tier: tier } : e)));
    push(`${tierTarget.name} comped to ${tier}.`, 'success');
    setTierTarget(null);
  };

  const columns: Column<AdminEventRow>[] = [
    {
      key: 'name',
      label: 'Event',
      render: (e) => (
        <div>
          <p className="text-brand-fg font-medium">{e.name}</p>
          <p className="font-mono text-[10px] text-brand-muted/40">/e/{e.slug}</p>
        </div>
      ),
    },
    {
      key: 'org',
      label: 'Organization',
      render: (e) => <Link to={`/admin/customers/${e.org_id}`} className="hover:text-brand-fg underline decoration-white/20">{e.orgName}</Link>,
    },
    { key: 'type', label: 'Type', render: (e) => <span className="capitalize">{e.event_type}</span> },
    { key: 'plan', label: 'Plan', render: (e) => <span className="capitalize">{e.plan_tier}</span> },
    { key: 'status', label: 'Status', render: (e) => <StatusPill status={e.status} /> },
    { key: 'created', label: 'Created', render: (e) => formatDate(e.created_at) },
    {
      key: 'actions',
      label: '',
      render: (e) => (
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={(ev) => { ev.stopPropagation(); setTierTarget(e); }}
            className="rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg/80 transition-colors"
          >
            Comp plan
          </button>
          <button
            onClick={(ev) => { ev.stopPropagation(); setTarget(e); }}
            className="rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg/80 transition-colors"
          >
            Change status
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Events</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">{events.length} events across every customer</p>
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
          placeholder="Search events…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-xs text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-white/20"
        />
      </div>

      <DataTable
        columns={columns}
        rows={paged.rows}
        getRowKey={(e) => e.id}
        loading={loading}
        emptyMessage="No events match."
      />
      <Pagination page={paged.page} totalPages={paged.totalPages} total={paged.total} onPageChange={setPage} />

      {target && (
        <Modal title={`Change status — ${target.name}`} onClose={() => setTarget(null)} maxWidthClass="max-w-sm">
          <p className="font-sans text-xs text-brand-muted/60 mb-5">Currently <StatusPill status={target.status} className="mx-1" />.</p>
          <div className="flex flex-col gap-2">
            {STATUSES.filter((s) => s !== target.status).map((s) => (
              <button
                key={s}
                onClick={() => applyStatus(s)}
                disabled={busy}
                className="rounded-xl bg-white/[0.06] hover:bg-white/[0.1] px-4 py-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors disabled:opacity-40 capitalize text-left"
              >
                Set to {s}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {tierTarget && (
        <Modal title={`Comp plan — ${tierTarget.name}`} onClose={() => setTierTarget(null)} maxWidthClass="max-w-sm">
          <p className="font-sans text-xs text-brand-muted/60 mb-5">
            Currently <span className="capitalize">{tierTarget.plan_tier}</span>. This grants the tier directly —
            it does not charge Stripe or create a purchase record.
          </p>
          <div className="flex flex-col gap-2">
            {TIERS.filter((t) => t !== tierTarget.plan_tier).map((t) => (
              <button
                key={t}
                onClick={() => applyTier(t)}
                disabled={busy}
                className="rounded-xl bg-white/[0.06] hover:bg-white/[0.1] px-4 py-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors disabled:opacity-40 capitalize text-left"
              >
                Comp to {t}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
