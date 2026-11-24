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
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminHeader, AdminPage, AdminSearch, RefreshButton } from './AdminChrome';
import { fetchEvents, setEventStatus, setEventTier, type AdminEventRow } from '../../lib/admin';
import { formatDate } from '../../lib/adminFormat';
import { listFootnote, type ListQuery } from '../../lib/serverList';
import { useServerList } from '../../lib/useServerList';
import DataTable, { type Column } from '../../components/ui/DataTable';
import LoadError from '../../components/ui/LoadError';
import ListMore from '../../components/ui/ListMore';
import Modal from '../../components/ui/Modal';
import StatusPill from '../../components/ui/StatusPill';
import { useToast } from '../../components/ui/Toast';

/** Rows per request — the server pages now; this screen used to receive every
 *  event on the platform and page it in JavaScript. */
const PAGE_SIZE = 50;
const STATUSES = ['draft', 'live', 'ended', 'archived'] as const;
const TIERS = ['free', 'essentials', 'premium', 'deluxe'] as const;

export default function Events() {
  const { push } = useToast();
  const [target, setTarget] = useState<AdminEventRow | null>(null);
  const [tierTarget, setTierTarget] = useState<AdminEventRow | null>(null);
  const [busy, setBusy] = useState(false);

  // Server-side search over name AND slug (an operator usually has the slug off
  // a QR code). Org name is on another table and so is not searchable here —
  // that is a real narrowing versus the old client-side filter, and the reason
  // the placeholder now says what it matches.
  const fetchPage = useCallback(async (q: ListQuery) => {
    const { data, error } = await fetchEvents(q);
    return { rows: data?.events ?? [], hasMore: data?.hasMore ?? false, error };
  }, []);
  const list = useServerList<AdminEventRow>(fetchPage, PAGE_SIZE);
  const load = list.reload;

  const applyStatus = async (status: string) => {
    if (!target) return;
    setBusy(true);
    const { error } = await setEventStatus(target.id, status);
    setBusy(false);
    if (error) { push('Could not change status.', 'error'); return; }
    list.patchRows((rows) => rows.map((e) => (e.id === target.id ? { ...e, status } : e)));
    push(`${target.name} is now ${status}.`, 'success');
    setTarget(null);
  };

  const applyTier = async (tier: string) => {
    if (!tierTarget) return;
    setBusy(true);
    const { error } = await setEventTier(tierTarget.id, tier);
    setBusy(false);
    if (error) { push('Could not comp this plan.', 'error'); return; }
    list.patchRows((rows) => rows.map((e) => (e.id === tierTarget.id ? { ...e, plan_tier: tier } : e)));
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
          <p className="font-mono text-[10px] text-brand-muted/70 break-all">/e/{e.slug}</p>
        </div>
      ),
    },
    {
      key: 'org',
      label: 'Organization',
      // A drill-in inside a row that is itself clickable, so this is a secondary
      // affordance rather than the row's tap target — but 14px tall was still
      // not a target at all.
      render: (e) => (
        <Link
          to={`/admin/customers/${e.org_id}`}
          className="inline-flex items-center min-h-11 hover:text-brand-fg underline decoration-white/20"
        >
          {e.orgName}
        </Link>
      ),
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
            className="pressable whitespace-nowrap rounded-full border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] px-3.5 min-h-11 font-sans text-[11px] text-brand-fg/90 transition-colors"
          >
            Comp plan
          </button>
          <button
            onClick={(ev) => { ev.stopPropagation(); setTarget(e); }}
            className="pressable whitespace-nowrap rounded-full border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] px-3.5 min-h-11 font-sans text-[11px] text-brand-fg/90 transition-colors"
          >
            Change status
          </button>
        </div>
      ),
    },
  ];

  return (
    <AdminPage>
      <AdminHeader
        title="Events"
        subtitle="Every event across every customer. Changes here skip the host's own studio, so each one asks first."
        note={listFootnote(list.rows.length, list.hasMore, 'event') || 'Loading…'}
        actions={<RefreshButton onClick={load} busy={list.loading} />}
      />

      {list.error && <LoadError what="events" code={list.error} onRetry={list.reload} />}

      <AdminSearch
        value={list.query}
        onChange={list.setQuery}
        placeholder="Search by event name or slug…"
        label="Search events"
      />

      <DataTable
        columns={columns}
        rows={list.rows}
        getRowKey={(e) => e.id}
        loading={list.loading}
        emptyMessage="No events match."
      />
      <ListMore
        hasMore={list.hasMore}
        loading={list.loadingMore}
        onMore={list.loadMore}
        note={listFootnote(list.rows.length, list.hasMore, 'event')}
      />

      {target && (
        <Modal title={`Change status — ${target.name}`} onClose={() => setTarget(null)} maxWidthClass="max-w-sm">
          <p className="font-sans text-xs text-brand-muted/60 mb-5">Currently <StatusPill status={target.status} className="mx-1" />.</p>
          <div className="flex flex-col gap-2">
            {STATUSES.filter((s) => s !== target.status).map((s) => (
              <button
                key={s}
                onClick={() => applyStatus(s)}
                disabled={busy}
                className="pressable rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] px-4 min-h-11 font-sans text-sm text-brand-fg/90 transition-colors disabled:opacity-40 text-left"
              >
                Set to {s}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {tierTarget && (
        <Modal title={`Comp plan — ${tierTarget.name}`} onClose={() => setTierTarget(null)} maxWidthClass="max-w-sm">
          <p className="font-sans text-xs text-brand-muted/75 mb-5">
            Currently <span className="capitalize">{tierTarget.plan_tier}</span>. This grants the tier directly.
            It does not charge Stripe or create a purchase record.
          </p>
          <div className="flex flex-col gap-2">
            {TIERS.filter((t) => t !== tierTarget.plan_tier).map((t) => (
              <button
                key={t}
                onClick={() => applyTier(t)}
                disabled={busy}
                className="pressable rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] px-4 min-h-11 font-sans text-sm text-brand-fg/90 transition-colors disabled:opacity-40 text-left"
              >
                Comp to {t}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
